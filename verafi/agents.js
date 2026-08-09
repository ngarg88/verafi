import { deriveSignals } from '../packages/core/index.js';
import { expensesOnly } from './classify.js';

/**
 * The agents that actually run.
 *
 * Each one is a pure function over your transactions that returns FINDINGS. A finding
 * always carries evidence and a dollar figure — an agent that can't say what it saw and
 * what it's worth doesn't get to interrupt you.
 *
 * Every agent here is `observe` or `recommend`. Nothing in this file spends money.
 * Execution stays behind the policy engine and a biometric, exactly as designed.
 */

const DAY = 86400000;
const key = (f) => `${f.agent}:${f.ref}`;
/**
 * QUALITY GUARDS
 *
 * A finding you can't act on is worse than no finding — it trains you to ignore the app.
 * Every detector below has to pass these before it may claim a dollar.
 */

/** Is this merchant a fixed recurring charge (subscription-like), or just variable spend? */
function isFixedRecurring(list) {
  if (list.length < 3) return false;
  const amts = list.map(t => t.amountCents);
  const mean = amts.reduce((a,b)=>a+b,0) / amts.length;
  const sd = Math.sqrt(amts.reduce((a,x)=>a+(x-mean)**2,0)/amts.length);
  return mean > 0 && sd / mean < 0.10;          // amount barely moves = a plan, not a basket
}

/** Merchants where "you stopped going" means nothing — you just shop elsewhere. */
const NOT_A_MEMBERSHIP = /amazon|whole ?foods|trader ?joe|safeway|kroger|costco|target|walmart|shell|chevron|exxon|uber|lyft|doordash|grubhub|starbucks|cvs|walgreens|amzn/i;

/** Categories where a recurring identical charge is expected, not a duplicate. */
const EXPECTED_RECURRING = /rent|mortgage|payroll|insurance|utility|comcast|xfinity|verizon|at&t|t-mobile|loan|tuition/i;

/** Belt and braces: even if the flow classifier misses one, agents skip these. */
const INVESTMENT_ISH = /fid ?bkg|fidelity|vanguard|schwab|robinhood|etrade|e\*trade|merrill|betterment|wealthfront|acorns|coinbase|brokerage|trump ?account|401k|\bira\b|529|invest/i;

const FEE_RE = /\bfee\b|overdraft|nsf\b|surcharge|service charge|late payment|maintenance|interest charge/i;

export const AGENTS = {

  subscription_auditor: {
    surface: 'save', label: 'Subscription Auditor',
    run({ tx, now }) {
      const s = deriveSignals(tx, now);
      return s.dormantSubscriptions.map(d => ({
        agent: 'subscription_auditor', ref: d.merchantId,
        title: `${pretty(d.merchantId)} is still billing you`,
        detail: `$${(d.amountCents/100).toFixed(2)} every ~${Math.round(d.cadenceDays)} days, but the last charge was ${Math.round(d.daysSinceLast)} days ago and you haven't used it since.`,
        amountCents: d.amountCents, annualCents: d.amountCents * 12,
        action: 'cancel', evidence: { cadenceDays: d.cadenceDays, daysSinceLast: d.daysSinceLast }
      }));
    }
  },

  fee_catcher: {
    surface: 'spend', label: 'Fee Catcher',
    run({ tx }) {
      // Every fee in the whole history, itemised. An aggregate number you can't act on
      // is worthless - you need the date and the merchant to call and dispute it.
      // Only fees a bank would actually reverse. A $1.99 booking fee from a ticketing
      // site is a price, not a mistake, and telling someone to call about it is noise.
      const NOT_DISPUTABLE = /booking|convenience|processing|delivery|service charge from|ticket|resort fee|baggage/i;
      const fees = tx.filter(t => (t.isFee || FEE_RE.test(t.merchantName ?? t.merchantId ?? ''))
                               && !NOT_DISPUTABLE.test(t.merchantName ?? t.merchantId ?? '')
                               && t.amountCents >= 500);
      return fees.map(t => {
        const kind = /overdraft|nsf|insufficient/i.test(t.merchantName ?? '') ? 'overdraft'
                   : /atm|surcharge/i.test(t.merchantName ?? '')             ? 'ATM'
                   : /foreign|fx|international/i.test(t.merchantName ?? '')  ? 'foreign transaction'
                   : /late/i.test(t.merchantName ?? '')                      ? 'late payment'
                   : /annual|membership/i.test(t.merchantName ?? '')         ? 'annual'
                   : /maintenance|service charge|monthly fee/i.test(t.merchantName ?? '') ? 'account maintenance'
                   : 'bank';
        const advice = {
          overdraft: 'Banks reverse a first overdraft fee on request nearly every time. Call and ask - about four minutes.',
          ATM: 'Ask your bank about fee-free ATM networks, or switch to an account that reimburses them.',
          'foreign transaction': 'A no-FX-fee card removes this entirely. Worth it if you travel at all.',
          'late payment': 'Ask for a one-time waiver, then set autopay for the minimum so it cannot recur.',
          annual: 'Call retention and ask what they can do. Downgrade to a no-fee version if the answer is nothing.',
          'account maintenance': 'Usually waived by direct deposit or a minimum balance. Ask which applies.',
          bank: 'Call and ask for a waiver. Worst case they say no.'
        }[kind];
        return {
          agent: 'fee_catcher', ref: t.externalId,
          title: `${fmt(t.amountCents)} ${kind} fee - ${pretty(t.merchantName ?? t.merchantId)}`,
          detail: `Charged ${new Date(t.postedAt).toLocaleDateString()}. ${advice}`,
          amountCents: t.amountCents, annualCents: t.amountCents, oneOff: true,
          action: 'dispute', evidence: { txId: t.externalId, postedAt: t.postedAt, kind }
        };
      });
    }
  },

  price_creep: {
    surface: 'save', label: 'Price Creep Watch',
    run({ tx }) {
      // A subscription that quietly went up is the most common invisible leak.
      const byMerchant = {};
      for (const t of tx) { if (t.amountCents > 0) (byMerchant[t.merchantId] ??= []).push(t); }
      const out = [];
      for (const [m, list] of Object.entries(byMerchant)) {
        if (list.length < 4) continue;
        // A grocery bill going from $62 to $103 is a bigger basket, not a price rise.
        // Only flag charges that are supposed to be the same number every time.
        const s0 = list.slice().sort((a,b)=>a.postedAt-b.postedAt);
        const firstHalfFixed = isFixedRecurring(s0.slice(0, Math.ceil(s0.length/2)));
        const secondHalfFixed = isFixedRecurring(s0.slice(Math.floor(s0.length/2)));
        if (!firstHalfFixed || !secondHalfFixed) continue;
        const s = s0;
        const half = Math.floor(s.length/2);
        const avg = a => a.reduce((x,t)=>x+t.amountCents,0)/a.length;
        const before = avg(s.slice(0,half)), after = avg(s.slice(half));
        if (after < before * 1.12) continue;
        const delta = Math.round(after - before);
        out.push({
          agent:'price_creep', ref:`creep:${m}`,
          title:`${pretty(m)} costs you ${fmt(delta)} more than it used to`,
          detail:`Averaged ${fmt(before)} across your first ${half} purchases, now ${fmt(after)}. That is +${Math.round((after/before-1)*100)}% with no announcement.`,
          amountCents: delta, annualCents: delta * 12,
          action:'review', evidence:{ before:Math.round(before), after:Math.round(after), n:list.length }
        });
      }
      return out;
    }
  },

  overlap_watch: {
    surface: 'save', label: 'Overlap Watch',
    run({ tx, now }) {
      const s = deriveSignals(tx, now);
      const GROUPS = [
        ['cloud storage', /dropbox|google.?one|icloud|onedrive|box\.com/i],
        ['music',         /spotify|apple.?music|tidal|youtube.?premium|amazon.?music/i],
        ['video',         /netflix|hulu|disney|hbo|max|paramount|peacock|apple.?tv/i],
        ['fitness',       /equinox|planet.?fitness|classpass|peloton|whoop|strava|gym/i],
        ['AI tools',      /openai|anthropic|claude|perplexity|midjourney|copilot|gemini/i],
        ['news',          /nytimes|wsj|washington ?post|athletic|substack|medium/i]
      ];
      const out = [];
      for (const [name, re] of GROUPS) {
        const hits = s.recurring.filter(r => re.test(r.merchantId));
        if (hits.length < 2) continue;
        const total = hits.reduce((a,r)=>a+r.amountCents,0);
        const cheapest = Math.min(...hits.map(r=>r.amountCents));
        const save = total - cheapest;
        out.push({
          agent:'overlap_watch', ref:`overlap:${name}`,
          title:`${hits.length} ${name} subscriptions running at once`,
          detail:`${hits.map(h=>pretty(h.merchantId)+' '+fmt(h.amountCents)).join(', ')}. Keeping only the one you use most saves ${fmt(save)}/mo.`,
          amountCents: save, annualCents: save*12,
          action:'review', evidence:{ services: hits.map(h=>h.merchantId) }
        });
      }
      return out;
    }
  },

  weekend_drift: {
    surface: 'spend', label: 'Impulse Watch',
    run({ tx, now }) {
      const recent = tx.filter(t => t.postedAt > now - 90*DAY && t.amountCents > 0 &&
                                    ['dining','retail','entertainment'].includes(t.category));
      if (recent.length < 15) return [];
      const late = recent.filter(t => t.localHour >= 21 || t.localHour <= 3);
      if (!late.length) return [];
      const lateTotal = late.reduce((a,t)=>a+t.amountCents,0);
      const share = late.length / recent.length;
      if (share < 0.25) return [];
      const avgLate = lateTotal/late.length;
      const avgDay  = (recent.reduce((a,t)=>a+t.amountCents,0)-lateTotal)/(recent.length-late.length || 1);
      if (avgLate <= avgDay) return [];
      const excess = Math.round((avgLate-avgDay) * late.length / 3);
      return [{
        agent:'weekend_drift', ref:`impulse:${new Date(now).toISOString().slice(0,7)}`,
        title:`Late-night spending costs you about ${fmt(excess)}/mo extra`,
        detail:`${late.length} of your last ${recent.length} discretionary purchases were after 9pm, averaging ${fmt(avgLate)} vs ${fmt(avgDay)} the rest of the day.`,
        // Behaviour change is on you, not the app. Counted once, not twelve times.
        amountCents: excess, annualCents: excess, oneOff: true,
        action:'review', evidence:{ lateCount: late.length, total: recent.length }
      }];
    }
  },

  dormant_spend: {
    surface: 'save', label: 'Stopped Using',
    run({ tx, now }) {
      // Not a subscription, but a merchant you used regularly and abruptly stopped -
      // often a membership still quietly billing under a different descriptor.
      const byMerchant = {};
      for (const t of tx) { if (t.amountCents>0) (byMerchant[t.merchantId] ??= []).push(t); }
      const out = [];
      for (const [m, list] of Object.entries(byMerchant)) {
        if (list.length < 5) continue;
        // Only membership-shaped spend. "You stopped shopping at Whole Foods" is not a
        // saving - you buy groceries somewhere else. Claiming it would be a lie.
        if (NOT_A_MEMBERSHIP.test(m)) continue;
        if (!isFixedRecurring(list)) continue;
        const s = list.sort((a,b)=>a.postedAt-b.postedAt);
        const span = (s.at(-1).postedAt - s[0].postedAt)/DAY;
        const gap  = (now - s.at(-1).postedAt)/DAY;
        const cadence = span / (s.length-1);
        if (gap < cadence * 3 || gap < 60) continue;
        const monthly = s.slice(-3).reduce((a,t)=>a+t.amountCents,0)/3;
        out.push({
          agent:'dormant_spend', ref:`dormant:${m}`,
          title:`You stopped using ${pretty(m)} ${Math.round(gap)} days ago`,
          detail:`You bought there ${s.length} times every ~${Math.round(cadence)} days, then nothing. If a membership or plan is still attached to it, cancel it.`,
          amountCents: Math.round(monthly), annualCents: Math.round(monthly*12),
          action:'review', evidence:{ lastSeen: s.at(-1).postedAt, cadenceDays: Math.round(cadence) }
        });
      }
      return out;
    }
  },

  duplicate_watch: {
    surface: 'spend', label: 'Duplicate Watch',
    run({ tx, since, now }) {
      // Two Costco runs in the same week for a similar amount is a coincidence, not a
      // double charge. Real duplicates land the SAME DAY, at places you rarely visit.
      const visitsPerMonth = {};
      const months = Math.max(1, (now - Math.min(...tx.map(t=>t.postedAt))) / (30*DAY));
      for (const t of tx) visitsPerMonth[t.merchantId] = (visitsPerMonth[t.merchantId] ?? 0) + 1/months;

      // Groceries, coffee, rideshare and delivery are places you legitimately hit twice
      // in a day. Duplicate detection there is pure noise, so it is switched off for them.
      const HIGH_FREQUENCY = new Set(['grocery','dining','transport','retail','entertainment']);
      // Anything that charges the SAME amount on a schedule is a plan, not a mistake:
      // brokerage contributions, insurance, memberships. Flagging those as fraud is the
      // fastest way to make someone stop trusting the app.
      const byMerchantAll = {};
      for (const t of tx) (byMerchantAll[t.merchantId] ??= []).push(t);
      const scheduled = new Set(Object.entries(byMerchantAll)
        .filter(([, list]) => isFixedRecurring(list)).map(([m]) => m));

      const recent = tx.filter(t => t.postedAt > since && t.amountCents > 1000
                                 && !HIGH_FREQUENCY.has(t.category)
                                 && !scheduled.has(t.merchantId)
                                 && !INVESTMENT_ISH.test(t.merchantName ?? t.merchantId ?? '')
                                 && !EXPECTED_RECURRING.test(t.merchantName ?? t.merchantId ?? '')
                                 && (visitsPerMonth[t.merchantId] ?? 0) <= 2);
      const out = [], seen = new Set();
      const sameDay = (a,b) => new Date(a).toDateString() === new Date(b).toDateString();
      for (const a of recent) for (const b of recent) {
        if (a === b || a.merchantId !== b.merchantId || a.amountCents !== b.amountCents) continue;
        if (!sameDay(a.postedAt, b.postedAt)) continue;
        const id = [a.externalId, b.externalId].sort().join('|');
        if (seen.has(id)) continue; seen.add(id);
        out.push({
          agent: 'duplicate_watch', ref: id,
          title: `Possible double charge — ${pretty(a.merchantName ?? a.merchantId)}`,
          detail: `Two identical charges of ${fmt(a.amountCents)} on ${new Date(a.postedAt).toLocaleDateString()}. You only use this merchant about ${Math.round(visitsPerMonth[a.merchantId]*10)/10}x a month, so this is unlikely to be two real purchases. Worth 30 seconds to check.`,
          // A refund happens once. Annualising it would be fiction.
          amountCents: a.amountCents, annualCents: a.amountCents, oneOff: true,
          action: 'review', evidence: { ids: [a.externalId, b.externalId] }
        });
      }
      return out;
    }
  },

  budget_pacer: {
    surface: 'spend', label: 'Budget Pacer',
    run({ tx, now }) {
      const start = new Date(now); start.setDate(1); start.setHours(0,0,0,0);
      const dayOfMonth = new Date(now).getDate();
      const daysInMonth = new Date(new Date(now).getFullYear(), new Date(now).getMonth()+1, 0).getDate();
      const elapsed = dayOfMonth / daysInMonth;
      if (elapsed < 0.25) return [];                      // too early to call

      const thisMonth = {}, prior = {};
      for (const t of tx) {
        if (t.amountCents <= 0 || t.category === 'transfer' || t.category === 'bills') continue;
        if (t.postedAt >= +start) thisMonth[t.category] = (thisMonth[t.category] ?? 0) + t.amountCents;
        else if (t.postedAt > +start - 90*DAY) prior[t.category] = (prior[t.category] ?? 0) + t.amountCents;
      }
      const out = [];
      for (const [cat, spent] of Object.entries(thisMonth)) {
        const monthlyNormal = (prior[cat] ?? 0) / 3;
        if (monthlyNormal < 5000) continue;               // ignore trivial categories
        const projected = spent / elapsed;
        if (projected > monthlyNormal * 1.3) out.push({
          agent: 'budget_pacer', ref: `${cat}:${start.toISOString().slice(0,7)}`,
          title: `${pretty(cat)} is running hot this month`,
          detail: `${fmt(spent)} so far, on pace for ${fmt(projected)}. Your usual is about ${fmt(monthlyNormal)}.`,
          // An alert, not an opportunity. One hot month is not $X/year of savings, and
          // pretending otherwise is how the headline number stops meaning anything.
          amountCents: Math.round(projected - monthlyNormal),
          annualCents: Math.round(projected - monthlyNormal),
          oneOff: true, alertOnly: true,
          action: 'review', evidence: { spent, projected: Math.round(projected), normal: Math.round(monthlyNormal) }
        });
      }
      return out;
    }
  },

  card_router: {
    surface: 'save', label: 'Card Router',
    run({ tx, now, cardRules, instruments }) {
      const since = now - 90*DAY;
      const byCat = {};
      for (const t of tx) if (t.postedAt > since && t.amountCents > 0)
        byCat[t.category] = (byCat[t.category] ?? 0) + t.amountCents;

      const out = [];
      for (const [cat, cents] of Object.entries(byCat)) {
        if (cents < 20000) continue;
        const rules = cardRules[cat] ?? cardRules.default ?? {};
        let best = null;
        for (const i of instruments.filter(x => x.rail === 'card_credit')) {
          const m = rules[i.cardKey] ?? 1;
          if (!best || m > best.mult) best = { name: i.displayName, mult: m };
        }
        if (!best || best.mult <= 1) continue;
        const gain = Math.round(cents * (best.mult - 1) / 100);
        if (gain < 1000) continue;
        out.push({
          agent: 'card_router', ref: `card:${cat}`,
          title: `Use ${best.name} for ${pretty(cat)}`,
          detail: `You spent ${fmt(cents)} on ${cat} in 90 days. ${best.name} earns ${best.mult}x there — about ${fmt(gain)} you left behind.`,
          amountCents: gain, annualCents: Math.round(gain * 4),
          action: 'switch_card', evidence: { category: cat, spent90d: cents, multiplier: best.mult }
        });
      }
      return out;
    }
  }
};

const fmt = (c) => '$' + (c/100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pretty = (s) => String(s ?? '').replace(/[-_]/g,' ').replace(/\b\w/g, m => m.toUpperCase());

/**
 * Run every ENABLED agent, drop anything already reported, and return what's new.
 * Deduping is what makes a daily job tolerable instead of spam.
 */
export function runAgents({ store, now = Date.now(), lookbackDays = 45, cardRules }) {
  const D = store.data;
  // EVERY agent sees expenses only. Investments, transfers, card payments and taxes
  // never reach a detector, so they can never be reported as waste.
  const tx = expensesOnly(D.transactions);
  const since = now - lookbackDays * DAY;
  const enabled = new Set(D.agents.filter(a => a.enabled).map(a => a.name));
  D.seenFindings ??= {};

  const all = [], fresh = [];
  for (const [id, agent] of Object.entries(AGENTS)) {
    if (!enabled.has(agent.label)) continue;
    let found = [];
    try { found = agent.run({ tx, now, since, cardRules, instruments: D.instruments }) ?? []; }
    catch (e) { found = []; console.error(`agent ${id} failed:`, e.message); }
    for (const f of found) {
      all.push(f);
      if (!D.seenFindings[key(f)]) { D.seenFindings[key(f)] = now; fresh.push(f); }
    }
  }
  D.findings = all.sort((a,b) => b.annualCents - a.annualCents).slice(0, 100);
  store.save();
  // Recurring and one-off are different kinds of money and must never be added into one
  // headline. Conflating them is how these products end up quoting numbers nobody believes.
  const claimable = D.findings.filter(f => !f.alertOnly);
  const recurringAnnualCents = claimable.filter(f => !f.oneOff).reduce((a,f)=>a+f.annualCents,0);
  const oneOffCents          = claimable.filter(f =>  f.oneOff).reduce((a,f)=>a+f.annualCents,0);
  return { all: D.findings, fresh: fresh.sort((a,b) => b.annualCents - a.annualCents),
           recurringAnnualCents, oneOffCents };
}

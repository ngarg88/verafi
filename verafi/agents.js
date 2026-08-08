import { deriveSignals } from '../packages/core/index.js';

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
    run({ tx, now, since }) {
      return tx.filter(t => t.isFee && t.postedAt > since).map(t => ({
        agent: 'fee_catcher', ref: t.externalId,
        title: `${fmt(t.amountCents)} fee from ${pretty(t.merchantName ?? t.merchantId)}`,
        detail: `Posted ${new Date(t.postedAt).toLocaleDateString()}. Most banks reverse a first-time overdraft or ATM fee if you call and ask — it takes about four minutes.`,
        amountCents: t.amountCents, annualCents: t.amountCents,
        action: 'dispute', evidence: { txId: t.externalId, postedAt: t.postedAt }
      }));
    }
  },

  duplicate_watch: {
    surface: 'spend', label: 'Duplicate Watch',
    run({ tx, since }) {
      const recent = tx.filter(t => t.postedAt > since && t.amountCents > 500);
      const out = [], seen = new Set();
      for (const a of recent) for (const b of recent) {
        if (a === b || a.merchantId !== b.merchantId || a.amountCents !== b.amountCents) continue;
        if (Math.abs(a.postedAt - b.postedAt) > 3 * DAY) continue;
        const id = [a.externalId, b.externalId].sort().join('|');
        if (seen.has(id)) continue; seen.add(id);
        out.push({
          agent: 'duplicate_watch', ref: id,
          title: `Charged twice by ${pretty(a.merchantName ?? a.merchantId)}`,
          detail: `Two charges of ${fmt(a.amountCents)} within ${Math.round(Math.abs(a.postedAt-b.postedAt)/DAY)} day(s). Could be legitimate — worth 30 seconds to check.`,
          amountCents: a.amountCents, annualCents: a.amountCents,
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
          amountCents: Math.round(projected - monthlyNormal), annualCents: Math.round((projected - monthlyNormal) * 12),
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
  const tx = D.transactions;
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
  return { all: D.findings, fresh: fresh.sort((a,b) => b.annualCents - a.annualCents) };
}

import { deriveSignals } from '../packages/core/index.js';
import { expensesOnly } from './classify.js';

/**
 * RESEARCH AGENTS — capability level: `recommend`.
 *
 * Nothing here spends money. These answer questions about a purchase you're
 * considering, grounded entirely in YOUR transaction history. No external API,
 * no key, no cost — which is also why every answer cites your own data rather
 * than a generic tip.
 */

const DAY = 86400000;
const fmt = c => '$' + (c/100).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
const f0  = c => '$' + Math.round(c/100).toLocaleString('en-US');
const pretty = s => String(s ?? '').replace(/[-_]/g,' ').replace(/\b\w/g,m=>m.toUpperCase());

/** Preset research types. Each is a question the agent can answer from your data. */
export const RESEARCH = {

  timing: {
    label: 'Should I buy this now?',
    hint: 'Checks whether you historically overpay at this time, and what you last paid',
    icon: '⏳',
    run({ tx, query }) {
      const term = (query||'').toLowerCase().replace(/^(should i buy|buy|get)\s+/,'').trim();
      const hits = tx.filter(t => (t.merchantName||t.merchantId||'').toLowerCase().includes(term) && t.amountCents>0);
      if (!term) return { answer:'Tell me what you\'re thinking of buying — e.g. "should I buy airpods".', evidence:[] };
      if (!hits.length) return {
        answer:`You've never bought anything matching “${term}”, so I have no price history of your own to compare against. Worth checking a price-tracking site before you commit.`,
        evidence:[] };
      const prices = hits.map(h=>h.amountCents).sort((a,b)=>a-b);
      const med = prices[Math.floor(prices.length/2)];
      const last = hits.sort((a,b)=>b.postedAt-a.postedAt)[0];
      const days = Math.round((Date.now()-last.postedAt)/DAY);
      return {
        answer:`You've bought this ${hits.length} time${hits.length>1?'s':''}. Your median is ${fmt(med)}, cheapest ${fmt(prices[0])}, most recent ${fmt(last.amountCents)} — ${days} days ago. If today's price is above ${fmt(med)}, you're paying more than you usually do.`,
        evidence: hits.slice(0,5).map(h=>`${new Date(h.postedAt).toLocaleDateString()} · ${h.merchantName||h.merchantId} · ${fmt(h.amountCents)}`)
      };
    }
  },

  card: {
    label: 'Which card should I use?',
    hint: 'Best card for the category, based on the cards you actually hold',
    icon: '💳',
    run({ tx, query, instruments, cardRules }) {
      const q = (query||'').toLowerCase();
      const cat = ['dining','grocery','travel','retail','transport','bills','subscription']
        .find(c => q.includes(c) || q.includes(c.slice(0,5))) ?? guessCat(q, tx);
      const rules = cardRules[cat] ?? cardRules.default ?? {};
      const owned = instruments.filter(i => i.rail === 'card_credit');
      if (!owned.length) return { answer:'No credit cards linked yet, so I can\'t compare. Link them and this becomes useful.', evidence:[] };
      const untagged = owned.filter(i => !i.cardKey);
      let best = null;
      for (const i of owned) { const m = rules[i.cardKey] ?? 1; if (!best || m > best.mult) best = { name:i.displayName, mult:m, key:i.cardKey }; }
      const spend90 = tx.filter(t=>t.category===cat && t.postedAt>Date.now()-90*DAY && t.amountCents>0)
                        .reduce((a,t)=>a+t.amountCents,0);
      const missed = Math.round(spend90 * (best.mult-1) / 100);
      return {
        answer: best.mult>1
          ? `For ${cat}, use **${best.name}** — ${best.mult}x. You spent ${f0(spend90)} on ${cat} in the last 90 days; using the right card there is worth about ${f0(missed)}.`
          : `None of your linked cards earn a bonus on ${cat}. Any of them is equivalent — put it on whichever has the best purchase protection.`,
        evidence: [
          `90-day ${cat} spend: ${f0(spend90)}`,
          ...owned.map(i=>`${i.displayName} → ${i.cardKey ? (rules[i.cardKey] ?? 1)+'x' : 'not tagged, assuming 1x'}`),
          ...(untagged.length ? [`⚠ ${untagged.length} card(s) untagged — set them in Setup for accurate answers`] : [])
        ]
      };
    }
  },

  restock: {
    label: 'When will I need this again?',
    hint: 'Predicts your next reorder from how often you actually buy it',
    icon: '🔁',
    run({ tx }) {
      const s = deriveSignals(tx);
      const active = s.recurring.filter(r => !r.dormant).sort((a,b)=> (a.cadenceDays-a.daysSinceLast) - (b.cadenceDays-b.daysSinceLast));
      if (!active.length) return { answer:'Not enough repeat purchases yet to predict a cadence. Needs 3+ buys from the same merchant.', evidence:[] };
      const soon = active.slice(0,6).map(r=>{
        const due = Math.round(r.cadenceDays - r.daysSinceLast);
        return `${pretty(r.merchantId)} · every ~${Math.round(r.cadenceDays)}d · ${due<=0?'**due now**':'due in ~'+due+'d'} · ${fmt(r.amountCents)}`;
      });
      return { answer:`You have ${active.length} things on a predictable cadence. Nearest due first:`, evidence: soon };
    }
  },

  overpay: {
    label: 'What am I overpaying for?',
    hint: 'Finds merchants where your own prices have crept up',
    icon: '📈',
    run({ tx }) {
      const byMerchant = {};
      for (const t of tx) {
        if (t.amountCents<=0 || t.category==='transfer') continue;
        (byMerchant[t.merchantId] ??= []).push(t);
      }
      const risers = [];
      for (const [m, list] of Object.entries(byMerchant)) {
        if (list.length < 4) continue;
        const sorted = list.sort((a,b)=>a.postedAt-b.postedAt);
        const half = Math.floor(sorted.length/2);
        const avg = a => a.reduce((x,t)=>x+t.amountCents,0)/a.length;
        const before = avg(sorted.slice(0,half)), after = avg(sorted.slice(half));
        if (after > before * 1.15) risers.push({ m, before, after, pct: Math.round((after/before-1)*100), n:list.length });
      }
      risers.sort((a,b)=>(b.after-b.before)-(a.after-a.before));
      if (!risers.length) return { answer:'Nothing has crept up meaningfully across your history. That\'s a good sign.', evidence:[] };
      return {
        answer:`${risers.length} merchant${risers.length>1?'s have':' has'} got more expensive for you over time:`,
        evidence: risers.slice(0,6).map(r=>`${pretty(r.m)} · ${fmt(r.before)} → ${fmt(r.after)} (+${r.pct}%) across ${r.n} purchases`)
      };
    }
  },

  impact: {
    label: 'Can I afford this?',
    hint: 'What a purchase does to this month, against your own normal',
    icon: '⚖️',
    run({ tx, query }) {
      const m = (query||'').match(/\$?\s*([\d,]+(?:\.\d{2})?)/);
      if (!m) return { answer:'Give me an amount — e.g. "can I afford $890".', evidence:[] };
      const cents = Math.round(parseFloat(m[1].replace(/,/g,'')) * 100);
      const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonth = tx.filter(t=>t.postedAt>=+start && t.amountCents>0 && t.category!=='transfer')
                          .reduce((a,t)=>a+t.amountCents,0);
      const prior = tx.filter(t=>t.postedAt < +start && t.postedAt > +start-90*DAY && t.amountCents>0 && t.category!=='transfer')
                      .reduce((a,t)=>a+t.amountCents,0)/3;
      const after = thisMonth + cents;
      const pct = prior ? Math.round((after/prior-1)*100) : 0;
      return {
        answer: prior
          ? `You've spent ${f0(thisMonth)} so far this month. Adding ${f0(cents)} takes you to ${f0(after)} — ${pct>0?`${pct}% above`:`${Math.abs(pct)}% below`} your 3-month average of ${f0(prior)}.`
          : `You've spent ${f0(thisMonth)} this month. Not enough history yet to compare against a normal.`,
        evidence: [`This month so far: ${f0(thisMonth)}`, `3-month average month: ${f0(prior)}`, `After this purchase: ${f0(after)}`]
      };
    }
  },

  subscriptions: {
    label: 'Am I paying for anything twice?',
    hint: 'Overlapping services and forgotten duplicates',
    icon: '🔁',
    run({ tx }) {
      const s = deriveSignals(tx);
      const OVERLAP = [
        ['cloud storage', /dropbox|google.?one|icloud|onedrive|box\.com/i],
        ['music',         /spotify|apple.?music|tidal|youtube.?premium|amazon.?music/i],
        ['video',         /netflix|hulu|disney|max|paramount|peacock|apple.?tv/i],
        ['fitness',       /equinox|planet.?fitness|classpass|peloton|whoop|strava/i],
        ['ai tools',      /openai|anthropic|claude|perplexity|midjourney|copilot/i]
      ];
      const out = [];
      for (const [name, re] of OVERLAP) {
        const hits = [...new Set(s.recurring.filter(r=>re.test(r.merchantId)).map(r=>r.merchantId))];
        if (hits.length > 1) {
          const cost = s.recurring.filter(r=>re.test(r.merchantId)).reduce((a,r)=>a+r.amountCents,0);
          out.push(`**${name}** — ${hits.length} services: ${hits.map(pretty).join(', ')} · ${fmt(cost)}/mo combined`);
        }
      }
      if (!out.length) return { answer:'No overlapping subscriptions found. Nothing obviously doubled up.', evidence:[] };
      return { answer:`You're paying for ${out.length} overlapping categor${out.length>1?'ies':'y'}:`, evidence: out };
    }
  }
};

function guessCat(q, tx) {
  const map = [[/eat|restaurant|dinner|food|takeout|delivery/,'dining'],
               [/grocer|supermarket|costco|whole ?foods/,'grocery'],
               [/flight|hotel|trip|travel|airbnb/,'travel'],
               [/uber|lyft|gas|fuel|transit/,'transport'],
               [/rent|bill|utility|internet|phone/,'bills']];
  for (const [re,c] of map) if (re.test(q)) return c;
  return 'retail';
}

/** Route a free-text question to the right research agent. */
export function route(query) {
  const q = (query||'').toLowerCase();
  if (/which card|what card|best card|card should/.test(q))            return 'card';
  if (/afford|can i spend|impact|budget/.test(q))                       return 'impact';
  if (/again|restock|reorder|run out|when will|next need/.test(q))      return 'restock';
  if (/overpay|creep|more expensive|going up|raised/.test(q))           return 'overpay';
  if (/twice|duplicate|overlap|double|paying for both/.test(q))         return 'subscriptions';
  return 'timing';
}

export function ask({ query, preset, tx: allTx, instruments, cardRules }) {
  const tx = expensesOnly(allTx);   // research answers about spending, not investing
  const key = preset && RESEARCH[preset] ? preset : route(query);
  const agent = RESEARCH[key];
  const t0 = Date.now();
  const result = agent.run({ query, tx, instruments, cardRules });
  return {
    agent: key, label: agent.label, icon: agent.icon,
    steps: [
      { tool:'context.load',        detail:`read ${tx.length} transactions` },
      { tool:`research.${key}`,     detail: agent.hint },
      { tool:'evidence.assemble',   detail:`${result.evidence.length} supporting facts` }
    ],
    ...result, latencyMs: Date.now()-t0,
    disclaimer: 'Research only — this agent cannot spend money.'
  };
}

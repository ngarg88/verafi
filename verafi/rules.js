/**
 * PROGRAMMATIC HUNTS
 *
 * A hunt is a typed object, never a prompt: category, hard ceiling, required traits,
 * merchant allowlist, expiry. The agent evaluates it on a schedule and, when something
 * matches, drops it into the Spend queue for you to approve.
 *
 * Two invariants, both deliberate:
 *   1. A hunt can never buy. It can only surface a candidate for approval.
 *   2. The ceiling is HARD. Anything above it is not a match, no matter how good it looks.
 *      A "great deal" $200 over budget is not a deal, it is an upsell.
 */
import { expensesOnly } from './classify.js';
import { researchDeal, holdDeal, spendingContext } from './deals.js';

const DAY = 86400000;
const f0 = c => '$' + Math.round(c/100).toLocaleString('en-US');

export const SOURCE = Object.freeze({
  WEB: 'web',              // searches the internet — needs an API key
  OWN_HISTORY: 'history'   // watches your own repeat purchases — free, always works
});

export function makeRule(p) {
  if (!p.name) throw new Error('a hunt needs a name');
  if (!Number.isInteger(p.ceilingCents) || p.ceilingCents <= 0) throw new Error('a hunt needs a hard ceiling');
  return {
    id: 'hunt_' + Math.random().toString(36).slice(2, 9),
    name: p.name,
    category: p.category ?? 'other',
    source: p.source ?? SOURCE.WEB,
    ceilingCents: p.ceilingCents,
    idealCents: p.idealCents ?? Math.round(p.ceilingCents * 0.8),
    traits: (p.traits ?? []).filter(Boolean),      // ["nonstop", "4 nights", "2 adults 2 kids"]
    merchants: p.merchants ?? null,                 // allowlist, or null for any
    maxMatches: p.maxMatches ?? 3,
    checkEveryHours: p.checkEveryHours ?? 24,
    expiresAt: p.expiresAt ?? Date.now() + 90*DAY,
    enabled: p.enabled ?? true,
    createdAt: Date.now(), lastRunAt: null, runs: 0, matches: []
  };
}

/** Human-readable, so you can see exactly what you armed. */
export function describe(r) {
  const bits = [`under ${f0(r.ceilingCents)}`];
  if (r.traits.length) bits.push(r.traits.join(', '));
  if (r.merchants?.length) bits.push(`only ${r.merchants.join(', ')}`);
  bits.push(r.source === SOURCE.WEB ? 'searching the web' : 'watching your own purchases');
  return bits.join(' · ');
}

/** The query the agent will actually run. Built from typed fields, not free text. */
export function buildQuery(r) {
  const parts = [r.name];
  if (r.traits.length) parts.push(r.traits.join(', '));
  parts.push(`under $${Math.round(r.ceilingCents/100)}`);
  if (r.merchants?.length) parts.push(`from ${r.merchants.join(' or ')}`);
  parts.push('give current real prices with sources');
  return parts.join('. ');
}

/**
 * History hunts cost nothing: watch things you already buy and flag when the price you
 * would pay is meaningfully below your own normal.
 */
export function evaluateHistoryHunt(rule, tx, now = Date.now()) {
  const ex = expensesOnly(tx);
  const term = rule.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const hits = ex.filter(t => {
    const n = (t.merchantName ?? t.merchantId ?? '').toLowerCase();
    return term.some(w => n.includes(w));
  });
  if (hits.length < 3) return { matched: false, why: `only ${hits.length} past purchases match “${rule.name}” — need 3 to learn a normal price` };

  const prices = hits.map(h => h.amountCents).sort((a,b)=>a-b);
  const median = prices[Math.floor(prices.length/2)];
  const low = prices[0];
  const last = hits.sort((a,b)=>b.postedAt-a.postedAt)[0];

  if (rule.ceilingCents >= median) return {
    matched: false,
    why: `your ceiling ${f0(rule.ceilingCents)} is above what you normally pay (${f0(median)}) — nothing to wait for`
  };
  return {
    matched: true,
    title: `${rule.name} at or under ${f0(rule.ceilingCents)}`,
    priceCents: median,
    detail: `You've paid ${f0(median)} on average across ${hits.length} purchases, lowest ${f0(low)}, most recently ${f0(last.amountCents)} on ${new Date(last.postedAt).toLocaleDateString()}. Your ceiling of ${f0(rule.ceilingCents)} is below your normal, so wait for a sale rather than buying at list.`,
    evidence: hits.slice(0,5).map(h => `${new Date(h.postedAt).toLocaleDateString()} · ${h.merchantName ?? h.merchantId} · ${f0(h.amountCents)}`)
  };
}

/** Run one hunt. Returns matches; never purchases. */
export async function runRule({ rule, store, apiKey, now = Date.now() }) {
  const tx = store.tx();
  rule.lastRunAt = now; rule.runs++;

  if (now > rule.expiresAt) { rule.enabled = false; return { expired: true, matches: [] }; }

  if (rule.source === SOURCE.OWN_HISTORY) {
    const r = evaluateHistoryHunt(rule, tx, now);
    if (!r.matched) return { matches: [], why: r.why };
    const item = holdDeal({ store, title: r.title, priceCents: r.priceCents,
      targetCents: rule.ceilingCents, category: rule.category, notes: r.detail, url: '' });
    rule.matches.unshift({ at: now, itemId: item.id, priceCents: r.priceCents });
    return { matches: [item], why: r.detail, evidence: r.evidence };
  }

  if (!apiKey) return { matches: [], needsKey: true,
    why: 'This hunt searches the web, which needs an ANTHROPIC_API_KEY. Switch it to “watch my own purchases” to run for free.' };

  const out = await researchDeal({ query: buildQuery(rule), tx, apiKey });
  if (!out.ok) return { matches: [], why: out.answer };

  // The model returns prose; we do not let it decide what counts as a match. The ceiling
  // is enforced here, on parsed numbers, not by asking the model to behave.
  const prices = [...(out.answer.match(/\$\s?([\d,]+(?:\.\d{2})?)/g) ?? [])]
    .map(x => Math.round(parseFloat(x.replace(/[$,\s]/g,'')) * 100))
    .filter(c => c > 1000 && c <= rule.ceilingCents);
  if (!prices.length) return { matches: [], answer: out.answer, sources: out.sources,
    why: `Nothing found at or under ${f0(rule.ceilingCents)}.` };

  const best = Math.min(...prices);
  const item = holdDeal({ store, title: rule.name, priceCents: best,
    targetCents: rule.idealCents, category: rule.category,
    notes: out.answer.slice(0, 600), url: out.sources?.[0]?.url ?? '' });
  rule.matches.unshift({ at: now, itemId: item.id, priceCents: best });
  rule.matches = rule.matches.slice(0, rule.maxMatches);
  return { matches: [item], answer: out.answer, sources: out.sources, costUsd: out.costUsd };
}

/** Every hunt that is due. Called by the daily schedule. */
export function dueRules(rules, now = Date.now()) {
  return (rules ?? []).filter(r => r.enabled && now <= r.expiresAt &&
    (!r.lastRunAt || now - r.lastRunAt >= r.checkEveryHours * 3600_000));
}

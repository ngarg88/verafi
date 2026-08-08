import { CAPABILITY, SURFACE, makeAgent } from './capabilities.js';

/**
 * Tier 1: deterministic behavioural features from transactions. Cheap, explainable, no model.
 * Tier 2 (a model drafting presets from these) sits on top and is confidence-gated.
 */
export function deriveSignals(transactions, now = Date.now()) {
  const DAY = 86400000;
  const byMerchant = new Map();
  for (const t of transactions) {
    const k = t.merchantId;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }

  const recurring = [];
  for (const [merchantId, txs] of byMerchant) {
    if (txs.length < 3) continue;
    const ts = txs.map(t => t.postedAt).sort((a, b) => a - b);
    const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / DAY);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    if (sd / mean < 0.25) {                       // low variance = a real cadence
      const last = ts[ts.length - 1];
      recurring.push({
        merchantId, cadenceDays: +mean.toFixed(1),
        amountCents: txs[txs.length - 1].amountCents,
        daysSinceLast: +((now - last) / DAY).toFixed(1),
        dormant: (now - last) / DAY > mean * 1.8   // paying but not using
      });
    }
  }

  const lateNight = transactions.filter(t => t.category === 'dining' && t.localHour >= 21);
  const dining = transactions.filter(t => t.category === 'dining');
  const feeTx = transactions.filter(t => t.isFee);

  return {
    recurring,
    dormantSubscriptions: recurring.filter(r => r.dormant),
    lateNightDiningShare: dining.length ? +(lateNight.length / dining.length).toFixed(2) : 0,
    avoidableFeesCents: feeTx.reduce((a, t) => a + t.amountCents, 0),
    misroutedSpendCents: transactions
      .filter(t => t.cardRewardMultiplier === 1 && t.bestAvailableMultiplier > 1)
      .reduce((a, t) => a + t.amountCents, 0),
    txCount: transactions.length
  };
}

/**
 * Presets that cite the user's own history. A generic preset is worth nothing.
 * Everything proposed starts DISABLED — the user opts in, one at a time.
 */
export function proposeAgents(signals, userId) {
  const out = [];
  const add = (surface, name, capability, evidence, confidence) =>
    out.push({ ...makeAgent({ id:`agt_${out.length}`, userId, surface, name, capability, enabled:false }),
               evidence, confidence });

  if (signals.dormantSubscriptions.length > 0)
    add(SURFACE.SAVE, 'Subscription Auditor', CAPABILITY.EXECUTE_AUTHORIZED,
      `${signals.dormantSubscriptions.length} subscriptions unused for 30+ days right now`, 0.91);

  if (signals.misroutedSpendCents > 50_000)
    add(SURFACE.SAVE, 'Card Router', CAPABILITY.RECOMMEND,
      `$${(signals.misroutedSpendCents/100).toFixed(0)} spent on a 1x card where you hold a higher-earning card`, 0.88);

  if (signals.avoidableFeesCents > 0)
    add(SURFACE.SPEND, 'Fee Catcher', CAPABILITY.EXECUTE_AUTHORIZED,
      `$${(signals.avoidableFeesCents/100).toFixed(0)} in avoidable fees found in your history`, 0.86);

  if (signals.lateNightDiningShare > 0.4)
    add(SURFACE.SPEND, 'Late-Night Guard', CAPABILITY.OBSERVE,
      `${Math.round(signals.lateNightDiningShare*100)}% of your delivery orders are placed after 9pm`, 0.74);

  const staples = signals.recurring.filter(r => !r.dormant && r.cadenceDays < 60);
  if (staples.length)
    add(SURFACE.ASK, 'Restock Runner', CAPABILITY.EXECUTE_PREAUTHORIZED,
      `You reorder from ${staples.length} merchants on a steady ~${Math.round(staples[0].cadenceDays)}-day cadence`, 0.83);

  return out;
}

/** Below 0.70 the agent must always ask first. Above 0.85 it may act inside the mandate. */
export const CONFIDENCE_GATE = Object.freeze({ ALWAYS_ASK: 0.70, MAY_ACT: 0.85 });
export function gateFor(confidence) {
  if (confidence < CONFIDENCE_GATE.ALWAYS_ASK) return 'always_ask';
  if (confidence < CONFIDENCE_GATE.MAY_ACT)    return 'ask_once_then_remember';
  return 'may_act_within_mandate';
}

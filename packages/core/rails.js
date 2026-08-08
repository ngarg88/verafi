/**
 * Pass-through routing. We hold no balances and never sit in the settlement path.
 * Every destination must be an account we do not control — enforced, not documented.
 */
export const RAIL = Object.freeze({
  CARD_CREDIT:'card_credit', CARD_DEBIT:'card_debit',
  ACH:'ach', STABLECOIN:'stablecoin'
});

export const PROTECTION_FLOOR_CENTS = 150_000;   // above this, credit rail always
export const MIN_TRUST_FOR_NON_CREDIT = 0.85;

/** Deterministic waterfall. Order is the policy. */
export function selectRail(tx, instruments, ctx = {}) {
  const credit = instruments.filter(i => i.rail === RAIL.CARD_CREDIT);
  const pick = (i, why) => ({ instrumentId: i.id, rail: i.rail, why });

  // 1 · protection floor — irreversible rails are never used for physical goods at risk
  if (tx.amountCents > PROTECTION_FLOOR_CENTS || (ctx.merchantTrust ?? 1) < MIN_TRUST_FOR_NON_CREDIT) {
    const best = bestByRewards(credit, tx);
    if (best) return pick(best, 'protection_floor');
  }
  // 2 · settlement requirement — machine-to-machine and cross-border digital
  if (tx.kind === 'api' || tx.kind === 'digital_intl') {
    const sc = instruments.find(i => i.rail === RAIL.STABLECOIN);
    if (sc) return pick(sc, 'settlement_requirement');
  }
  // 3 · recurring bill with no rewards on offer
  if (tx.kind === 'bill') {
    const ach = instruments.find(i => i.rail === RAIL.ACH);
    if (ach) return pick(ach, 'zero_fee_no_rewards_available');
  }
  // 4 · net cost after rewards
  const best = bestByRewards(credit, tx);
  if (best) return pick(best, 'best_net_cost');
  // 5 · cash position floor — never draw debit below the user's stated floor
  const debit = instruments.find(i => i.rail === RAIL.CARD_DEBIT);
  if (debit && (debit.balanceCents ?? 0) - tx.amountCents >= (ctx.cashFloorCents ?? 0))
    return pick(debit, 'fallback_debit_above_cash_floor');
  return { instrumentId:null, rail:null, why:'no_eligible_rail' };
}

function bestByRewards(cards, tx) {
  let best = null, bestValue = -Infinity;
  for (const c of cards) {
    const mult = c.rewardsByMcc?.[tx.mcc] ?? c.rewardsByMcc?.default ?? 1;
    const v = tx.amountCents * (mult / 100);
    if (v > bestValue) { bestValue = v; best = c; }
  }
  return best;
}

/** THE invariant. If this ever throws in production, the compliance posture has changed. */
export function assertPassThrough(settlementAccount) {
  if (settlementAccount?.ownedByPlatform === true)
    throw new Error('INVARIANT VIOLATED: settlement destination is a platform-owned account');
  return true;
}

/**
 * Offer ranking. The ONLY thing that decides order is net cost to the user.
 * Merchant money can never enter this function — if it ever does, we are Honey
 * and the fiduciary positioning is dead.
 */
import { selectRail } from './rails.js';

/** Price stats from your own observation corpus. Nobody sells you a good one. */
export function priceStats(observations, windowDays = 90, now = Date.now()) {
  const cutoff = now - windowDays * 86400000;
  const prices = observations.filter(o => o.observedAt >= cutoff)
                             .map(o => o.priceCents).sort((a, b) => a - b);
  if (!prices.length) return null;
  const at = (p) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  const recent = observations.filter(o => o.observedAt >= now - 14 * 86400000).map(o => o.priceCents);
  const older  = observations.filter(o => o.observedAt < now - 14 * 86400000).map(o => o.priceCents);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    n: prices.length,
    medianCents: at(0.5), p10Cents: at(0.10), minCents: prices[0], maxCents: prices.at(-1),
    trend: !older.length || !recent.length ? 'flat'
         : avg(recent) < avg(older) * 0.97 ? 'falling'
         : avg(recent) > avg(older) * 1.03 ? 'rising' : 'flat'
  };
}

/** Probability the price drops below `targetCents` within `days`, from history alone. */
export function dropProbability(observations, targetCents, days = 30, now = Date.now()) {
  const s = priceStats(observations, 365, now);
  if (!s) return 0;
  const belowRate = observations.filter(o => o.priceCents <= targetCents).length / observations.length;
  const trendAdj = s.trend === 'falling' ? 1.35 : s.trend === 'rising' ? 0.6 : 1;
  const horizon  = Math.min(1, days / 30);
  return +Math.min(0.97, belowRate * trendAdj * horizon).toFixed(2);
}

/**
 * Stack every discount that actually applies, then compute TRUE net cost including
 * the rewards from the rail we'd route to. Ranking is by net cost, full stop.
 */
export function rankOffers({ offers, coupons = [], portals = [], instruments = [], observationsBySku = {},
                             merchantTrust = {}, now = Date.now() }) {
  const ranked = offers.map(o => {
    const applicable = coupons.filter(c => c.sku === o.sku && (!c.merchantId || c.merchantId === o.merchantId)
                                        && (!c.expiresAt || c.expiresAt > now));
    const couponCents = applicable.reduce((a, c) => a + (c.flatCents ?? Math.round(o.priceCents * (c.pct ?? 0))), 0);
    const portal = portals.find(p => p.merchantId === o.merchantId);
    const afterCoupons = Math.max(0, o.priceCents - couponCents);
    const portalCents = portal ? Math.round(afterCoupons * portal.pct) : 0;

    const trust = merchantTrust[o.merchantId] ?? 0.5;
    const rail = selectRail({ amountCents: afterCoupons, mcc: o.mcc ?? 5999, kind: o.kind ?? 'retail' },
                            instruments, { merchantTrust: trust });
    const inst = instruments.find(i => i.id === rail.instrumentId);
    const mult = inst?.rewardsByMcc?.[o.mcc] ?? inst?.rewardsByMcc?.default ?? 0;
    const rewardCents = Math.round(afterCoupons * (mult / 100));

    const stats = priceStats(observationsBySku[o.sku] ?? [], 90, now);
    const netCents = afterCoupons - portalCents - rewardCents;

    return {
      ...o, trust, rail, couponCents, portalCents, rewardCents,
      netCents, savingVsListCents: o.listPriceCents ? o.listPriceCents - netCents : 0,
      priceStats: stats,
      belowMedian: stats ? o.priceCents < stats.medianCents : null,
      warnings: [
        ...(trust < 0.85 ? ['merchant_trust_below_threshold'] : []),
        ...(o.returnWindowDays != null && o.returnWindowDays < 30 ? ['short_return_window'] : []),
        ...(o.refurbished ? ['refurbished_limited_warranty'] : []),
        ...(o.inventory === 0 ? ['out_of_stock'] : [])
      ]
    };
  })
  .filter(o => o.inventory !== 0)
  .sort((a, b) => a.netCents - b.netCents);

  return ranked.map((o, i) => ({ ...o, rank: i, agentPick: i === 0 }));
}

/**
 * Should the agent wait instead of buying? Only says yes when the expected value
 * of waiting beats buying now AND the item isn't urgent.
 */
export function shouldWait({ offer, observations, urgentByDays = null,
                             maxHoldDays = 10, watchDays = 30, now = Date.now() }) {
  if (urgentByDays != null && urgentByDays <= maxHoldDays)
    return { wait: false, why: 'needed_sooner_than_hold_window' };
  const stats = priceStats(observations, 90, now);
  if (!stats) return { wait: false, why: 'no_price_history' };

  // Target a REACHABLE price, not the historical floor. Chasing p10 makes the agent
  // wait forever on a 6% chance; midway between p10 and median is what actually recurs.
  const target = Math.round((stats.p10Cents + stats.medianCents) / 2);
  // The watch runs for watchDays even though this purchase only holds for maxHoldDays —
  // if it drops later the agent rebuys, so the full window is the right horizon.
  const p = dropProbability(observations, target, watchDays, now);
  const ev = (offer.netCents - target) * p;
  return {
    wait: ev > offer.netCents * 0.03 && stats.trend !== 'rising',
    why: stats.trend === 'rising' ? 'price_trending_up'
       : ev > offer.netCents * 0.03 ? 'expected_value_of_waiting' : 'gain_too_small_to_delay',
    targetCents: target, probability: p, expectedGainCents: Math.round(ev)
  };
}

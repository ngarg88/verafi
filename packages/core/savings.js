/**
 * Savings must be ATTRIBUTABLE, not claimed. Every event carries a method, evidence
 * and a verification timestamp. This is the pricing justification, the marketing,
 * and the churn defence. If you build it later you will never backfill it.
 */
export const METHOD = Object.freeze({
  SUBSCRIPTION_CANCEL:'subscription_cancel',
  PRICE_TIMING:'price_timing',
  COUPON_STACK:'coupon_stack',
  CARD_ROUTING:'card_routing',
  FEE_REFUND:'fee_refund',
  NEGOTIATION:'negotiation',
  DUPLICATE_REFUND:'duplicate_refund'
});

/** Unverified savings are worth zero. They stay pending until proof lands. */
export const STATUS = Object.freeze({ PENDING:'pending', VERIFIED:'verified', REVERSED:'reversed' });

export function makeSavingsEvent(p) {
  if (!Object.values(METHOD).includes(p.method)) throw new Error(`bad method: ${p.method}`);
  if (!p.evidence) throw new Error('savings event requires evidence — no evidence, no claim');
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new Error('bad amount');
  return {
    id: p.id, userId: p.userId, agentId: p.agentId ?? null,
    method: p.method, amountCents: p.amountCents,
    recurringMonths: p.recurringMonths ?? 0,      // cancels recur; a coupon does not
    evidence: p.evidence,                          // {kind, url|txId, before, after}
    status: STATUS.PENDING, createdAt: p.now ?? Date.now(), verifiedAt: null
  };
}

export function verify(evt, now = Date.now()) { return { ...evt, status: STATUS.VERIFIED, verifiedAt: now }; }
export function reverse(evt) { return { ...evt, status: STATUS.REVERSED }; }

/** Only verified events count. This is the number the whole company rests on. */
export function verifiedTotalCents(events) {
  return events.filter(e => e.status === STATUS.VERIFIED)
               .reduce((a, e) => a + e.amountCents + e.amountCents * e.recurringMonths, 0);
}

/**
 * Honest forecasting: baseline minus interventions weighted by CALIBRATED probability.
 * Categories that need the USER to change are discounted hard and labelled as such.
 */
export function forecast({ baselineMonthlyCents, interventions, months = 12 }) {
  const out = [];
  for (let m = 0; m < months; m++) {
    let saved = 0, low = 0, high = 0;
    for (const i of interventions) {
      const start = i.startsInMonths ?? 0;
      if (m < start) continue;
      if (i.oneTime && m > start) continue;
      // Interventions land progressively — you do not capture 100% in month one.
      const ramp = i.rampMonths ? Math.min(1, (m - start + 1) / i.rampMonths) : 1;
      const p = i.probability * ramp;
      saved += i.amountCents * p;
      low   += i.amountCents * Math.max(0, p - i.uncertainty);
      high  += i.amountCents * Math.min(1, p + i.uncertainty);
    }
    out.push({
      month: m,
      projectedCents: Math.round(baselineMonthlyCents - saved),
      bandLowCents:  Math.round(baselineMonthlyCents - high),
      bandHighCents: Math.round(baselineMonthlyCents - low)
    });
  }
  return out;
}

/** Grade yourself monthly or don't ship a forecast at all. */
export function reconcile(forecastRow, actualCents) {
  const err = actualCents - forecastRow.projectedCents;
  return {
    month: forecastRow.month, actualCents, projectedCents: forecastRow.projectedCents,
    errorCents: err,
    withinBand: actualCents >= forecastRow.bandLowCents && actualCents <= forecastRow.bandHighCents,
    errorPct: forecastRow.projectedCents ? +(err / forecastRow.projectedCents * 100).toFixed(1) : 0
  };
}

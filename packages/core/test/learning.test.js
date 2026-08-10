import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSignals, proposeAgents, gateFor, CONFIDENCE_GATE,
         makeSavingsEvent, verify, verifiedTotalCents, METHOD, STATUS,
         forecast, reconcile } from '../index.js';

const DAY = 86400000, NOW = Date.UTC(2026, 7, 7);
function stream({ merchantId, everyDays, count, amountCents, endOffsetDays = 0, extra = {} }) {
  return Array.from({ length: count }, (_, i) => ({
    merchantId, amountCents,
    postedAt: NOW - (endOffsetDays + (count - 1 - i) * everyDays) * DAY,
    category: extra.category ?? 'subscription', localHour: extra.localHour ?? 12,
    isFee: false, cardRewardMultiplier: 1, bestAvailableMultiplier: 1, ...extra
  }));
}

test('detects a real cadence and ignores noise', () => {
  const txs = [
    ...stream({ merchantId:'netflix', everyDays:30, count:8, amountCents:2499 }),
    ...stream({ merchantId:'random',  everyDays:3,  count:2, amountCents:1200 })
  ];
  const s = deriveSignals(txs, NOW);
  assert.equal(s.recurring.length, 1);
  assert.equal(s.recurring[0].merchantId, 'netflix');
  assert.ok(Math.abs(s.recurring[0].cadenceDays - 30) < 1);
});

test('detects a recurring stream that appears to have stopped', () => {
  const s = deriveSignals(stream({ merchantId:'equinox', everyDays:30, count:6, amountCents:30500, endOffsetDays:70 }), NOW);
  assert.equal(s.dormantSubscriptions.length, 1);
});

test('proposed agents cite evidence and start DISABLED', () => {
  const txs = [
    ...stream({ merchantId:'equinox', everyDays:30, count:6, amountCents:30500, endOffsetDays:70 }),
    ...stream({ merchantId:'coffee',  everyDays:24, count:6, amountCents:2200 }),
    ...Array.from({ length: 10 }, () => ({ merchantId:'doordash', amountCents:3800, postedAt:NOW-DAY,
      category:'dining', localHour:22, isFee:false, cardRewardMultiplier:1, bestAvailableMultiplier:4 })),
    { merchantId:'chase', amountCents:3500, postedAt:NOW-DAY, category:'fee', localHour:9, isFee:true,
      cardRewardMultiplier:1, bestAvailableMultiplier:1 }
  ];
  const agents = proposeAgents(deriveSignals(txs, NOW), 'u1');
  assert.ok(agents.length >= 3);
  for (const a of agents) {
    assert.equal(a.enabled, false, `${a.name} must start disabled`);
    assert.ok(a.evidence && a.evidence.length > 10, `${a.name} must cite what it learned`);
    assert.ok(a.confidence > 0 && a.confidence <= 1);
  }
  assert.ok(agents.some(a => a.surface === 'save' && a.name === 'Subscription Auditor'));
});

test('confidence gating', () => {
  assert.equal(gateFor(0.5),  'always_ask');
  assert.equal(gateFor(0.8),  'ask_once_then_remember');
  assert.equal(gateFor(0.92), 'may_act_within_mandate');
  assert.ok(CONFIDENCE_GATE.ALWAYS_ASK < CONFIDENCE_GATE.MAY_ACT);
});

test('a savings event without evidence is rejected', () => {
  assert.throws(() => makeSavingsEvent({ id:'s1', userId:'u1', method:METHOD.COUPON_STACK, amountCents:4000 }), /evidence/);
});

test('only verified savings count, and recurring cancels compound', () => {
  const one = makeSavingsEvent({ id:'s1', userId:'u1', method:METHOD.COUPON_STACK, amountCents:4000, evidence:{ kind:'coupon', before:31800, after:27800 } });
  const sub = makeSavingsEvent({ id:'s2', userId:'u1', method:METHOD.SUBSCRIPTION_CANCEL, amountCents:2499, recurringMonths:11, evidence:{ kind:'email', url:'x' } });
  assert.equal(verifiedTotalCents([one, sub]), 0, 'pending savings are worth zero');
  assert.equal(verifiedTotalCents([verify(one), verify(sub)]), 4000 + 2499 * 12);
  assert.equal(one.status, STATUS.PENDING);
});

test('forecast carries a confidence band and reconciles against actuals', () => {
  const f = forecast({
    baselineMonthlyCents: 318_400,
    interventions: [
      { amountCents: 6_499, probability: 0.91, uncertainty: 0.05 },                   // subscription cancels
      { amountCents: 23_210, probability: 0.42, uncertainty: 0.25 }                   // needs the USER to change
    ]
  });
  assert.equal(f.length, 12);
  assert.ok(f[0].bandLowCents < f[0].projectedCents && f[0].projectedCents < f[0].bandHighCents);
  assert.ok(f[0].projectedCents < 318_400);
  const r = reconcile(f[0], f[0].projectedCents + 500);
  assert.equal(r.withinBand, true);
  const miss = reconcile(f[0], f[0].bandHighCents + 50_000);
  assert.equal(miss.withinBand, false, 'a forecast that never grades itself is a churn machine');
});

test('interventions ramp in — savings are front-loaded, not flat from month one', () => {
  const f = forecast({ baselineMonthlyCents: 300_000, interventions: [
    { amountCents: 20_000, probability: 0.9, uncertainty: 0.05, rampMonths: 3 }
  ]});
  assert.ok(f[11].projectedCents < f[0].projectedCents, 'later months must save more');
  assert.equal(f[3].projectedCents, f[11].projectedCents, 'fully ramped by month 3, then flat');
  const gain = f[0].projectedCents - f[11].projectedCents;
  assert.ok(gain > 0 && gain < 20_000);
});

test('one-time interventions do not recur', () => {
  const f = forecast({ baselineMonthlyCents: 100_000, interventions: [
    { amountCents: 50_000, probability: 1, uncertainty: 0, oneTime: true }
  ]});
  assert.equal(f[0].projectedCents, 50_000);
  assert.equal(f[1].projectedCents, 100_000);
});

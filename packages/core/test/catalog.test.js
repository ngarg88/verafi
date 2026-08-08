import test from 'node:test';
import assert from 'node:assert/strict';
import { priceStats, dropProbability, rankOffers, shouldWait } from '../catalog.js';

const NOW = Date.UTC(2026,7,7), DAY = 86400000;
const obs = (prices) => prices.map((p,i) => ({ priceCents:p, observedAt: NOW - (prices.length-i)*3*DAY }));
const instruments = [
  { id:'amex', rail:'card_credit', rewardsByMcc:{ 5732:4, default:1 } },
  { id:'csr',  rail:'card_credit', rewardsByMcc:{ default:1 } }
];

test('price stats and falling-trend detection', () => {
  const s = priceStats(obs([39999,38000,36000,34800,30000,28000,27800]), 90, NOW);
  assert.equal(s.n, 7);
  assert.equal(s.minCents, 27800);
  assert.equal(s.trend, 'falling');
});

test('ranking is by TRUE net cost, not sticker price', () => {
  const ranked = rankOffers({
    offers: [
      { sku:'xm6', merchantId:'amazon', priceCents:31800, listPriceCents:39999, mcc:5732, inventory:5, returnWindowDays:30 },
      { sku:'xm6', merchantId:'bestbuy', priceCents:29900, listPriceCents:42900, mcc:5732, inventory:2, returnWindowDays:15 }
    ],
    coupons: [{ sku:'xm6', merchantId:'amazon', flatCents:4000 }],
    portals: [{ merchantId:'amazon', pct:0.02 }],
    instruments, merchantTrust:{ amazon:0.94, bestbuy:0.91 }, now: NOW });

  assert.equal(ranked[0].merchantId, 'amazon', 'higher sticker but lower net must win');
  assert.ok(ranked[0].netCents < ranked[1].netCents);
  assert.equal(ranked[0].agentPick, true);
  assert.equal(ranked[0].couponCents, 4000);
  assert.ok(ranked[0].rewardCents > 0, 'rewards from the routed card count toward net');
  assert.ok(ranked[1].warnings.includes('short_return_window'));
});

test('out of stock is excluded; low trust is flagged not hidden', () => {
  const ranked = rankOffers({
    offers: [
      { sku:'x', merchantId:'woot', priceCents:18900, mcc:5732, inventory:3 },
      { sku:'x', merchantId:'amazon', priceCents:27800, mcc:5732, inventory:0 }
    ],
    instruments, merchantTrust:{ woot:0.72, amazon:0.94 }, now: NOW });
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].warnings.includes('merchant_trust_below_threshold'));
});

test('waiting is only advised when the expected value beats buying now', () => {
  const falling = obs([39999,38000,36000,34800,30000,28000,27800]);
  const w = shouldWait({ offer:{ netCents: 34800 }, observations: falling, now: NOW });
  assert.equal(w.wait, true);
  assert.ok(w.probability > 0);
  const urgent = shouldWait({ offer:{ netCents: 34800 }, observations: falling, urgentByDays: 2, now: NOW });
  assert.equal(urgent.wait, false);
  const rising = obs([27800,28000,30000,34800,36000,38000,39999]);
  assert.equal(shouldWait({ offer:{ netCents:39999 }, observations: rising, now: NOW }).wait, false);
});

test('drop probability responds to trend', () => {
  const falling = obs([39999,38000,36000,34800,30000,28000,27800]);
  const rising  = obs([27800,28000,30000,34800,36000,38000,39999]);
  assert.ok(dropProbability(falling, 30000, 30, NOW) > dropProbability(rising, 30000, 30, NOW));
});

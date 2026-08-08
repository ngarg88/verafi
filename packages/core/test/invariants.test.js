import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import {
  evaluate, authorize, DECISION, STEP_UP_REASON,
  createCartMandate, createIntentMandate, cartPayload, NonceCache,
  CAPABILITY, makeAgent, SURFACE,
  selectRail, assertPassThrough, RAIL, PROTECTION_FLOOR_CENTS
} from '../index.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = publicKey.export({ type:'spki', format:'pem' });
const signCart = (cart) => nodeSign('sha256', Buffer.from(cartPayload(cart)), { key: privateKey, dsaEncoding:'der' }).toString('base64');

const NOW = Date.UTC(2026, 7, 7);
const rootMandate = {
  id:'mnd_root', perTxCents: 50_000, dailyCents: 120_000, monthlyCents: 400_000,
  allowedCategories:['retail','travel','grocery','subscription'],
  blockedCategories:['crypto','gambling','gift_card','p2p'],
  minMerchantTrust: 0.6, expiresAt: NOW + 90*86400000, revokedAt: null
};
const baseCtx = {
  now: NOW, mandate: rootMandate, merchantTrust: 0.94, merchantSeenBefore: true,
  deviceKnown: true, biometricInvalidated: false, lastPresenceAt: NOW - 3600_000,
  spentTodayCents: 0, spentThisMonthCents: 0, signatureVerified: true
};
const intent = (o={}) => ({ amountCents: 27_800, category:'retail', merchantId:'m_amazon', railId:'amex', unattended:false, ...o });

test('INVARIANT · no payment without a verified signature', () => {
  const d = evaluate(intent(), { ...baseCtx, signatureVerified: false });
  assert.equal(d.decision, DECISION.STEP_UP);
  assert.ok(d.reasons.includes(STEP_UP_REASON.NO_SIGNATURE));
});

test('INVARIANT · a policy ALLOW alone cannot authorize — crypto must also check out', () => {
  const cart = createCartMandate({ userId:'u1', merchantId:'m_amazon', amountCents:27_800, itemHash:'h1', railId:'amex', parentMandateId:'mnd_root' });
  const decision = evaluate(intent(), baseCtx);
  assert.equal(decision.decision, DECISION.ALLOW);
  const bad = authorize({ cart, decision, devicePublicKeyPem: pem, nonceCache: new NonceCache() });
  assert.equal(bad.authorized, false, 'unsigned cart must not authorize despite ALLOW');
  assert.equal(bad.reason, 'signature_invalid');
  cart.signature = signCart(cart);
  const good = authorize({ cart, decision, devicePublicKeyPem: pem, nonceCache: new NonceCache() });
  assert.equal(good.authorized, true);
});

test('INVARIANT · signature is bound to the exact cart — tampering the amount breaks it', () => {
  const cart = createCartMandate({ userId:'u1', merchantId:'m_amazon', amountCents:27_800, itemHash:'h1', railId:'amex', parentMandateId:'mnd_root' });
  cart.signature = signCart(cart);
  cart.amountCents = 127_800;                       // attacker inflates after signing
  const decision = evaluate(intent({ amountCents:127_800 }), baseCtx);
  const r = authorize({ cart, decision, devicePublicKeyPem: pem, nonceCache: new NonceCache() });
  assert.equal(r.authorized, false);
});

test('INVARIANT · a signature cannot be replayed', () => {
  const cache = new NonceCache();
  const cart = createCartMandate({ userId:'u1', merchantId:'m_amazon', amountCents:27_800, itemHash:'h1', railId:'amex', parentMandateId:'mnd_root' });
  cart.signature = signCart(cart);
  const decision = evaluate(intent(), baseCtx);
  assert.equal(authorize({ cart, decision, devicePublicKeyPem: pem, nonceCache: cache }).authorized, true);
  const second = authorize({ cart, decision, devicePublicKeyPem: pem, nonceCache: cache });
  assert.equal(second.authorized, false);
  assert.equal(second.reason, 'nonce_replayed');
});

test('INVARIANT · blocked categories are a hard deny — no biometric can pass them', () => {
  const d = evaluate(intent({ category:'gambling' }), baseCtx);
  assert.equal(d.decision, DECISION.DENY);
  assert.ok(d.reasons.includes('blocked_category'));
});

test('INVARIANT · a rule can never widen its parent mandate', () => {
  const env = createIntentMandate({ userId:'u1', ceilingCents: 90_000, merchantAllowlist:['m_dyson'], parentMandateId:'mnd_root' });
  env.signature = 'sig';                             // envelope itself was biometrically signed
  const d = evaluate(intent({ amountCents: 90_000, merchantId:'m_dyson', unattended:true }),
    { ...baseCtx, envelope: env, agent: makeAgent({ id:'a1', userId:'u1', surface:SURFACE.ASK, name:'Watcher', capability: CAPABILITY.EXECUTE_PREAUTHORIZED }) });
  assert.notEqual(d.decision, DECISION.ALLOW, 'envelope ceiling above per-tx limit must not execute');
  assert.ok(d.reasons.includes('above_per_transaction_limit'));
});

test('unattended execution is allowed ONLY inside a signed envelope', () => {
  const agent = makeAgent({ id:'a1', userId:'u1', surface:SURFACE.ASK, name:'Restock', capability: CAPABILITY.EXECUTE_PREAUTHORIZED });
  const env = createIntentMandate({ userId:'u1', ceilingCents: 47_900, merchantAllowlist:['m_dyson'], parentMandateId:'mnd_root' });
  const i = intent({ amountCents: 44_900, merchantId:'m_dyson', unattended:true });
  const unsigned = evaluate(i, { ...baseCtx, agent, envelope: env });
  assert.equal(unsigned.decision, DECISION.STEP_UP, 'unsigned envelope must not execute');
  env.signature = 'sig';
  const signed = evaluate(i, { ...baseCtx, agent, envelope: env });
  assert.equal(signed.decision, DECISION.ALLOW);
  assert.ok(signed.reasons.includes('inside_signed_envelope'));
});

test('envelope exhaustion and expiry both force a step-up', () => {
  const agent = makeAgent({ id:'a1', userId:'u1', surface:SURFACE.ASK, name:'Restock', capability: CAPABILITY.EXECUTE_PREAUTHORIZED });
  const i = intent({ amountCents: 44_900, merchantId:'m_dyson', unattended:true });
  const spent = createIntentMandate({ userId:'u1', ceilingCents:47_900, merchantAllowlist:['m_dyson'], maxFires:1, parentMandateId:'mnd_root' });
  spent.signature='sig'; spent.fires = 1;
  assert.equal(evaluate(i, { ...baseCtx, agent, envelope: spent }).reasons.at(-1), 'envelope_exhausted');
  const old = createIntentMandate({ userId:'u1', ceilingCents:47_900, merchantAllowlist:['m_dyson'], ttlMs: 1, now: NOW - 1000, parentMandateId:'mnd_root' });
  old.signature='sig';
  assert.equal(evaluate(i, { ...baseCtx, agent, envelope: old }).reasons.at(-1), 'envelope_expired');
});

test('an observe/recommend agent can never spend', () => {
  for (const cap of [CAPABILITY.OBSERVE, CAPABILITY.RECOMMEND]) {
    const agent = makeAgent({ id:'a1', userId:'u1', surface:SURFACE.ASK, name:'Deal Hunter', capability: cap });
    const d = evaluate(intent(), { ...baseCtx, agent });
    assert.equal(d.decision, DECISION.DENY, `${cap} must not spend`);
  }
});

test('every mandatory step-up trigger fires', () => {
  const cases = [
    [{ deviceKnown:false },                       STEP_UP_REASON.NEW_DEVICE],
    [{ biometricInvalidated:true },               STEP_UP_REASON.KEY_INVALIDATED],
    [{ lastPresenceAt: NOW - 15*86400000 },       STEP_UP_REASON.STALE_PRESENCE],
    [{ merchantTrust: 0.7 },                      STEP_UP_REASON.LOW_TRUST],
    [{ merchantSeenBefore:false },                STEP_UP_REASON.NEW_MERCHANT]
  ];
  for (const [patch, reason] of cases) {
    const d = evaluate(intent(), { ...baseCtx, ...patch });
    assert.equal(d.decision, DECISION.STEP_UP, JSON.stringify(patch));
    assert.ok(d.reasons.includes(reason), `expected ${reason}, got ${d.reasons}`);
  }
  const near = evaluate(intent(), { ...baseCtx, mandate: { ...rootMandate, expiresAt: NOW + 3600_000 } });
  assert.equal(near.reasons.at(-1), STEP_UP_REASON.MANDATE_EXPIRING);
});

test('daily and monthly ceilings deny', () => {
  assert.equal(evaluate(intent(), { ...baseCtx, spentTodayCents: 100_000 }).reasons.at(-1), 'daily_ceiling_exceeded');
  assert.equal(evaluate(intent(), { ...baseCtx, spentThisMonthCents: 390_000 }).reasons.at(-1), 'monthly_ceiling_exceeded');
});

test('INVARIANT · settlement destination is never a platform-owned account', () => {
  assert.equal(assertPassThrough({ id:'acct_user_chase', ownedByPlatform:false }), true);
  assert.throws(() => assertPassThrough({ id:'acct_platform_float', ownedByPlatform:true }), /INVARIANT VIOLATED/);
});

test('rail routing · protection floor beats rewards above $1,500', () => {
  const instruments = [
    { id:'amex', rail:RAIL.CARD_CREDIT, rewardsByMcc:{ 5812: 4, default: 1 } },
    { id:'csr',  rail:RAIL.CARD_CREDIT, rewardsByMcc:{ 4511: 3, default: 1 } },
    { id:'usdc', rail:RAIL.STABLECOIN },
    { id:'ach',  rail:RAIL.ACH }
  ];
  const big = selectRail({ amountCents: PROTECTION_FLOOR_CENTS + 1, mcc: 5812, kind:'retail' }, instruments, { merchantTrust: 0.95 });
  assert.equal(big.rail, RAIL.CARD_CREDIT);
  assert.equal(big.why, 'protection_floor');
  const api = selectRail({ amountCents: 12, mcc: 7372, kind:'api' }, instruments, { merchantTrust: 0.95 });
  assert.equal(api.rail, RAIL.STABLECOIN);
  const dining = selectRail({ amountCents: 4_400, mcc: 5812, kind:'retail' }, instruments, { merchantTrust: 0.95 });
  assert.equal(dining.instrumentId, 'amex');
  assert.equal(dining.why, 'best_net_cost');
  const bill = selectRail({ amountCents: 9_900, mcc: 4900, kind:'bill' }, instruments, { merchantTrust: 0.95 });
  assert.equal(bill.rail, RAIL.ACH);
});

test('a low-trust merchant never reaches an irreversible rail', () => {
  const instruments = [{ id:'amex', rail:RAIL.CARD_CREDIT, rewardsByMcc:{ default:1 } }, { id:'usdc', rail:RAIL.STABLECOIN }];
  const r = selectRail({ amountCents: 5_000, mcc: 5999, kind:'digital_intl' }, instruments, { merchantTrust: 0.4 });
  assert.equal(r.rail, RAIL.CARD_CREDIT, 'low trust must force the chargeback-bearing rail');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FakePlaid, FakeKnot, FakePsp } from '../../connectors/index.js';

test('plaid transfer requires an explicit destination — no implicit routing', async () => {
  const p = new FakePlaid();
  await assert.rejects(() => p.initiateTransfer({ fromAccountId:'a', amountCents:1000 }), /destination/);
  const ok = await p.initiateTransfer({ fromAccountId:'a', toAccountId:'b', amountCents:1000 });
  assert.equal(ok.status, 'pending');
});

test('knot coverage is a hard ceiling on the cancel feature', async () => {
  const k = new FakeKnot({ supported:['netflix'] });
  assert.equal((await k.cancelSubscription({ merchantId:'netflix' })).ok, true);
  const miss = await k.cancelSubscription({ merchantId:'some-gym' });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'merchant_not_supported');
});

test('INVARIANT · psp refuses to settle into a platform-owned account', async () => {
  const psp = new FakePsp();
  await assert.rejects(() => psp.authorizeCard({ networkTokenRef:'tkn', amountCents:100,
    mandateId:'m1', merchantAccount:{ id:'platform_float', ownedByPlatform:true } }), /INVARIANT VIOLATED/);
  await assert.rejects(() => psp.initiateAch({ fromAccount:{id:'a'}, amountCents:100,
    mandateId:'m1', toAccount:{ id:'platform_float', ownedByPlatform:true } }), /INVARIANT VIOLATED/);
});

test('card authorization is impossible without a token AND a signed mandate', async () => {
  const psp = new FakePsp();
  const merchantAccount = { id:'acct_amazon', ownedByPlatform:false };
  await assert.rejects(() => psp.authorizeCard({ amountCents:100, mandateId:'m1', merchantAccount }), /network token/);
  await assert.rejects(() => psp.authorizeCard({ networkTokenRef:'tkn', amountCents:100, merchantAccount }), /signed mandate/);
  const ok = await psp.authorizeCard({ networkTokenRef:'tkn', amountCents:100, mandateId:'m1', merchantAccount });
  assert.equal(ok.settlesTo, 'acct_amazon');
});

test('stablecoin is non-custodial — we return an UNSIGNED tx for the user to sign', async () => {
  const r = await new FakePsp().prepareStablecoinTx({ toAddress:'0xabc', amountCents:2500 });
  assert.equal(r.custodial, false);
  assert.equal(r.requiresUserSignature, true);
  assert.equal(r.unsignedTx.valueUsdc, 25);
});

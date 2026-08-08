/** End-to-end smoke test against a live server. Exercises the whole money path. */
const B = process.env.API ?? 'http://localhost:8787';
let pass = 0, fail = 0;
const ck = (n, c, x='') => { console.log((c?'  ok  ':'  FAIL')+'  '+n+(x?'  '+x:'')); c?pass++:fail++; };
const get  = (p)    => fetch(B+p).then(r=>r.json());
const post = (p,b={}) => fetch(B+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());

console.log('\n== health + static ==');
ck('health', (await get('/v1/health')).ok === true);
ck('prototype served at /', (await fetch(B+'/').then(r=>r.text())).includes('agentsSection'));

console.log('\n== onboarding: link → learn → propose ==');
const link = await post('/v1/connections/plaid');
ck('linked', link.linked === true);
ck('signals derived', link.signals.txCount > 50, link.signals.txCount+' tx');
ck('dormant subscription found', link.signals.dormantSubscriptions.length > 0);
ck('misrouted spend found', link.signals.misroutedSpendCents > 0, '$'+(link.signals.misroutedSpendCents/100).toFixed(0));
ck('agents proposed', link.proposed.length >= 3, link.proposed.length+' agents');
ck('ALL proposals start disabled', link.proposed.every(a => a.enabled === false));
ck('ALL proposals cite evidence', link.proposed.every(a => a.evidence?.length > 10));

console.log('\n== agents ==');
const ag = await get('/v1/agents?surface=save');
ck('save agents scoped', ag.agents.length > 0 && ag.agents.every(a => a.surface === 'save'));
const noEvidence = await post('/v1/agents', { surface:'ask', name:'Nope' });
ck('agent without evidence rejected', noEvidence.status === 422);
const custom = await post('/v1/agents', { surface:'ask', name:"Kids' clothes restock",
  evidence:'You size-up every ~4 months across 6 merchants', ceilingCents: 15000 });
ck('custom agent created disabled', custom.agent.custom === true && custom.agent.enabled === false);

console.log('\n== spend + save ==');
const sum = await get('/v1/spend/summary');
ck('spend summary', sum.transactionCount > 50 && Object.keys(sum.byCategoryCents).length > 2);
const fc = await get('/v1/spend/forecast');
ck('forecast has 12 months', fc.months.length === 12);
ck('forecast has confidence bands', fc.months.every(m => m.bandLowCents < m.projectedCents && m.projectedCents < m.bandHighCents));
ck('forecast bends down', fc.months[11].projectedCents < fc.months[0].projectedCents);
const sv = await get('/v1/save/summary');
ck('only verified savings counted', sv.verifiedTotalCents > 0 && sv.pendingCount === 1);

console.log('\n== policy gate ==');
const blocked = await post('/v1/policy/evaluate', { amountCents: 20000, category:'gambling', merchantSlug:'amazon' });
ck('blocked category → deny', blocked.decision.decision === 'deny', blocked.decision.reasons.join());
const lowTrust = await post('/v1/policy/evaluate', { amountCents: 5000, category:'retail', merchantSlug:'sketchy-store' });
ck('low-trust merchant → deny', lowTrust.decision.decision === 'deny');
const big = await post('/v1/policy/evaluate', { amountCents: 200000, category:'retail', merchantSlug:'amazon' });
ck('above per-tx → step_up', big.decision.decision === 'step_up');
ck('big-ticket routed to credit rail', big.rail.why === 'protection_floor', big.rail.rail);
const ok = await post('/v1/policy/evaluate', { amountCents: 27800, category:'retail', merchantSlug:'amazon' });
ck('no signature yet → step_up', ok.decision.decision === 'step_up', ok.decision.reasons.at(-1));

console.log('\n== checkout: unsigned must fail, signed must pass ==');
const cart = await post('/v1/mandates/cart', { amountCents: 27800, merchantSlug:'amazon', mcc: 5999 });
ck('cart mandate issued', !!cart.mandate.id && cart.mandate.signature === null);
ck('server returns payload hash to sign', /^[0-9a-f]{64}$/.test(cart.payloadHash));
const unsigned = await post('/v1/checkout', { mandateId: cart.mandate.id, category:'retail' });
ck('UNSIGNED checkout blocked', unsigned.authorization.authorized === false, unsigned.decision.reasons.at(-1));
await post('/v1/dev/sign', { mandateId: cart.mandate.id });
const signed = await post('/v1/checkout', { mandateId: cart.mandate.id, category:'retail',
  savedCents: 12199, savingsMethod:'coupon_stack', evidence:{ kind:'price_history', ref:'90d-median' } });
ck('SIGNED checkout authorized', signed.authorization.authorized === true, signed.authorization.reason);
ck('settlement instrument is not platform-owned', signed.instrument.ownedByPlatform === false);
const replay = await post('/v1/checkout', { mandateId: cart.mandate.id, category:'retail' });
ck('replay rejected', replay.authorization.authorized === false && replay.authorization.reason === 'nonce_replayed');

console.log('\n== envelopes: rules cannot widen the mandate ==');
const env = await post('/v1/mandates/intent', { ceilingCents: 90000, merchantAllowlist:['amazon'] });
ck('envelope clamped to per-tx limit', env.envelope.ceilingCents === 50000 && env.envelope.clampedFrom === 90000);

console.log('\n== savings attribution ==');
const sv2 = await get('/v1/save/summary');
ck('savings recorded from checkout', sv2.verifiedTotalCents > sv.verifiedTotalCents,
   '+$'+((sv2.verifiedTotalCents - sv.verifiedTotalCents)/100).toFixed(2));
ck('every savings event has evidence', sv2.events.every(e => e.evidence && Object.keys(e.evidence).length));

console.log('\n== audit trail ==');
const runs = await get('/v1/runs');
ck('runs traced', runs.runs.length >= 5, runs.runs.length+' runs');
const audit = await get('/v1/audit');
ck('every decision logged with reasons', audit.steps.length > 0 && audit.steps.every(s => Array.isArray(s.reasons)));
ck('denials present in audit', audit.steps.some(s => s.decision === 'deny'));

console.log(`\n${fail ? '❌ '+fail+' FAILED' : '✅ ALL '+pass+' CHECKS PASSED'}  (${pass}/${pass+fail})`);
process.exit(fail ? 1 : 0);

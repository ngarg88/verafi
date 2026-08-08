import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createRepo } from './repo.js';
import { seed } from './seed.js';
import {
  evaluate, authorize, DECISION, createCartMandate, createIntentMandate,
  cartPayload, payloadHash, NonceCache, selectRail, assertPassThrough,
  deriveSignals, proposeAgents, verifiedTotalCents, forecast,
  makeSavingsEvent, verify as verifySavings, METHOD, CAPABILITY
} from '../../packages/core/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

// DEV ONLY. In production the private key lives in the phone's secure element and
// the server never sees it — it only ever verifies signatures against devices.public_key_pem.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve:'P-256' });
const devicePublicKeyPem = publicKey.export({ type:'spki', format:'pem' });

const repo = createRepo();
const { user, device } = seed(repo, { publicKeyPem: devicePublicKeyPem });
const nonces = new NonceCache();

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type':'application/json', 'access-control-allow-origin':'*',
                        'access-control-allow-headers':'content-type' });
  res.end(JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b?JSON.parse(b):{})); });

function ctxFor(u, opts = {}) {
  const m = repo.rootMandateFor(u.id);
  const d = repo.deviceFor(u.id);
  const merch = repo.merchant(opts.merchantSlug) ?? { trustScore: 0.5 };
  return {
    now: Date.now(), mandate: m,
    merchantTrust: merch.trustScore,
    merchantSeenBefore: repo.transactionsFor(u.id).some(t => t.merchantId === opts.merchantSlug),
    deviceKnown: !!d, biometricInvalidated: !!d?.invalidatedAt,
    lastPresenceAt: d?.lastPresenceAt,
    spentTodayCents: u.spentTodayCents, spentThisMonthCents: u.spentThisMonthCents,
    signatureVerified: false, ...opts
  };
}

const ROUTES = {
  'GET /v1/health': async () => ({ ok:true, user: user.id, device: device.id, ts: Date.now() }),

  // ---- onboarding: link → derive signals → propose agents (all start disabled) ----
  'POST /v1/connections/plaid': async () => {
    const run = repo.startRun(user.id, 'plaid link');
    repo.step(run.id, 'plaid.link.exchange', { public_token:'***' },
      { institutions: 2, transactions: repo.transactionsFor(user.id).length });
    const signals = deriveSignals(repo.transactionsFor(user.id));
    repo.step(run.id, 'profile.derive', { window:'18mo' }, signals);
    const proposed = proposeAgents(signals, user.id);
    for (const a of proposed) {
      const existing = repo.agentsFor(user.id).find(x => x.name === a.name);
      if (existing) { existing.evidence = a.evidence; existing.confidence = a.confidence; }
      else repo.saveAgent(a);
    }
    repo.finishRun(run.id);
    user.linked = true;
    return { linked:true, runId: run.id, signals, proposed: proposed.map(a => ({ ...a, enabled:false })) };
  },

  'GET /v1/agents': async (_b, q) => ({ agents: repo.agentsFor(user.id, q.get('surface')) }),
  'POST /v1/agents': async (b) => {
    if (!b.evidence) return { error:'an agent must cite what it learned', status:422 };
    const a = repo.saveAgent({ id:'agt_'+Date.now(), userId:user.id, surface:b.surface, name:b.name,
      capability: b.capability ?? CAPABILITY.RECOMMEND, enabled:false, custom:true,
      evidence:b.evidence, ceilingCents: b.ceilingCents ?? null });
    return { agent: a };
  },
  'POST /v1/agents/toggle': async (b) => {
    const a = repo.agentsFor(user.id).find(x => x.id === b.id);
    if (!a) return { error:'not found', status:404 };
    a.enabled = !!b.enabled; return { agent: a };
  },

  // ---- spend ----
  'GET /v1/spend/summary': async () => {
    const txs = repo.transactionsFor(user.id);
    const byCat = {};
    for (const t of txs) byCat[t.category] = (byCat[t.category] ?? 0) + t.amountCents;
    return { transactionCount: txs.length, byCategoryCents: byCat, signals: deriveSignals(txs) };
  },
  'GET /v1/spend/forecast': async () => {
    const s = deriveSignals(repo.transactionsFor(user.id));
    const baseline = repo.transactionsFor(user.id)
      .filter(t => t.postedAt > Date.now() - 30*86400000)
      .reduce((a,t) => a + t.amountCents, 0);
    return { baselineMonthlyCents: baseline, months: forecast({
      baselineMonthlyCents: baseline,
      interventions: [
        // rampMonths: how long until the intervention is fully realised. Honest, and it
        // makes the front-loaded shape of real savings visible instead of a flat line.
        { name:'subscription_cancels', amountCents: s.dormantSubscriptions.reduce((a,r)=>a+r.amountCents,0),
          probability:0.91, uncertainty:0.05, rampMonths:2 },
        { name:'card_routing', amountCents: Math.round(s.misroutedSpendCents*0.03),
          probability:0.84, uncertainty:0.08, rampMonths:3 },
        // needs the USER to change, not just the agent — discounted hard and slow to land
        { name:'behaviour_change', amountCents: Math.round(s.lateNightDiningShare*60000),
          probability:0.42, uncertainty:0.25, rampMonths:6 }
      ]})};
  },

  // ---- save ----
  'GET /v1/save/summary': async () => {
    const ev = repo.savingsFor(user.id);
    return { verifiedTotalCents: verifiedTotalCents(ev), pendingCount: ev.filter(e=>e.status==='pending').length, events: ev };
  },

  // ---- the money path ----
  'POST /v1/policy/evaluate': async (b) => {
    const run = repo.startRun(user.id, b.intentText ?? 'policy check', b.agentId);
    const instruments = repo.instrumentsFor(user.id);
    const merch = repo.merchant(b.merchantSlug) ?? { trustScore: 0.5 };
    const railPick = selectRail(
      { amountCents:b.amountCents, mcc:b.mcc ?? 5999, kind:b.kind ?? 'retail' },
      instruments, { merchantTrust: merch.trustScore, cashFloorCents: user.cashFloorCents });
    repo.step(run.id, 'rail.select', { amountCents:b.amountCents, kind:b.kind }, railPick);

    const agent = b.agentId ? repo.agentsFor(user.id).find(a => a.id === b.agentId) : null;
    const intent = { amountCents:b.amountCents, category:b.category, merchantId:b.merchantSlug,
                     railId: railPick.instrumentId, unattended: !!b.unattended,
                     nonce:'n', issuedAt:Date.now(), expiresAt:Date.now()+9e5 };
    const decision = evaluate(intent, { ...ctxFor(user, { merchantSlug:b.merchantSlug }),
                                        agent, envelope: b.envelopeId ? repo.mandate(b.envelopeId) : null,
                                        signatureVerified: false });
    repo.step(run.id, 'policy.evaluate', intent, decision, { decision: decision.decision, reasons: decision.reasons });
    repo.finishRun(run.id);
    return { runId: run.id, rail: railPick, decision };
  },

  'POST /v1/mandates/cart': async (b) => {
    const railPick = selectRail({ amountCents:b.amountCents, mcc:b.mcc ?? 5999, kind:b.kind ?? 'retail' },
      repo.instrumentsFor(user.id), { merchantTrust: (repo.merchant(b.merchantSlug)?.trustScore) ?? 0.5 });
    const cart = createCartMandate({ userId:user.id, merchantId:b.merchantSlug, amountCents:b.amountCents,
      itemHash:b.itemHash ?? 'sha256:demo', railId: railPick.instrumentId, parentMandateId:'mnd_root' });
    repo.saveMandate(cart);
    return { mandate: cart, payloadHash: payloadHash(cartPayload(cart)),
             note:'sign this payload on-device; the server never holds a signing key' };
  },

  'POST /v1/mandates/intent': async (b) => {
    const root = repo.rootMandateFor(user.id);
    const env = createIntentMandate({ userId:user.id, ceilingCents: Math.min(b.ceilingCents, root.perTxCents),
      merchantAllowlist: b.merchantAllowlist ?? null, maxFires: b.maxFires ?? 1, parentMandateId:'mnd_root' });
    if (b.ceilingCents > root.perTxCents) env.clampedFrom = b.ceilingCents;   // a rule can never widen its parent
    repo.saveMandate(env);
    return { envelope: env, payloadHash: payloadHash(JSON.stringify(env)) };
  },

  // DEV shortcut: signs on the server so you can exercise the flow end to end.
  // In the app this happens inside the secure enclave after Face ID.
  'POST /v1/dev/sign': async (b) => {
    const m = repo.mandate(b.mandateId);
    if (!m) return { error:'not found', status:404 };
    const { sign } = await import('node:crypto');
    m.signature = sign('sha256', Buffer.from(cartPayload(m)), { key: privateKey, dsaEncoding:'der' }).toString('base64');
    const d = repo.deviceFor(user.id); d.lastPresenceAt = Date.now();
    return { mandateId: m.id, signed:true };
  },

  'POST /v1/checkout': async (b) => {
    const run = repo.startRun(user.id, 'checkout', b.agentId);
    const cart = repo.mandate(b.mandateId);
    if (!cart) return { error:'unknown mandate', status:404 };

    const instrument = repo.instrumentsFor(user.id).find(i => i.id === cart.railId);
    assertPassThrough(instrument);                       // THE invariant, checked on every charge

    const merch = repo.merchant(cart.merchantId) ?? { trustScore:0.5 };
    const agent = b.agentId ? repo.agentsFor(user.id).find(a => a.id === b.agentId) : null;
    const decision = evaluate(
      { amountCents:cart.amountCents, category:b.category ?? 'retail', merchantId:cart.merchantId,
        railId:cart.railId, unattended:!!b.unattended, nonce:cart.nonce,
        issuedAt:cart.issuedAt, expiresAt:cart.expiresAt },
      { ...ctxFor(user, { merchantSlug: cart.merchantId }), agent,
        envelope: b.envelopeId ? repo.mandate(b.envelopeId) : null,
        signatureVerified: !!cart.signature });
    repo.step(run.id, 'policy.evaluate', { mandateId:cart.id }, decision, { decision:decision.decision, reasons:decision.reasons });

    const auth = authorize({ cart, decision, devicePublicKeyPem, nonceCache: nonces });
    repo.step(run.id, 'psp.authorize', { rail:cart.railId, amountCents:cart.amountCents }, auth);

    if (auth.authorized) {
      user.spentTodayCents += cart.amountCents;
      user.spentThisMonthCents += cart.amountCents;
      if (b.savedCents > 0) {
        const ev = verifySavings(makeSavingsEvent({ id:'sv_'+Date.now(), userId:user.id, agentId:b.agentId ?? null,
          method: b.savingsMethod ?? METHOD.COUPON_STACK, amountCents:b.savedCents,
          evidence: b.evidence ?? { kind:'price_history', ref: cart.id } }));
        repo.addSavings(ev);
        repo.step(run.id, 'savings.attribute', { amountCents:b.savedCents }, { id: ev.id, status: ev.status });
      }
    }
    repo.finishRun(run.id, auth.authorized ? 'completed' : 'blocked');
    return { runId: run.id, decision, authorization: auth,
             instrument: instrument && { id:instrument.id, rail:instrument.rail, ownedByPlatform:instrument.ownedByPlatform } };
  },

  'GET /v1/runs': async () => ({ runs: repo.runsFor(user.id).map(r => ({ ...r, steps: r.steps.length })) }),
  'GET /v1/audit': async () => ({ steps: repo.db.runSteps.filter(s => s.decision).map(s => ({
      runId:s.runId, tool:s.tool, decision:s.decision, reasons:s.reasons, at:s.at })) })
};

const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;

  if (ROUTES[key]) {
    try {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await ROUTES[key](body, url.searchParams);
      return json(res, out?.status ?? 200, out);
    } catch (e) {
      return json(res, 500, { error: e.message, stack: e.stack?.split('\n').slice(0,3) });
    }
  }
  // static: the clickable prototype
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(__dir, '../web/public', p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    return res.end(buf);
  } catch { return json(res, 404, { error:'not found', route:key }); }
});

server.listen(PORT, () => console.log(`agentpay api → http://localhost:${PORT}  (prototype at /)`));
export { server, repo, user, devicePublicKeyPem };

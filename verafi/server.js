#!/usr/bin/env node
/**
 * Verafi — personal edition.
 *
 * One user: you. No accounts, no cloud, no other people's data to protect.
 * Your transactions live in ./data/verafi.json on this machine. The only network
 * calls are to Plaid. Bind to your LAN and it works on your phone.
 */
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { Store } from './store.js';
import { Plaid, toCoreTx } from './plaid.js';
import { importCsv, importOfx } from './importers.js';
import { runAgents, AGENTS } from './agents.js';
import { expensesOnly, breakdown, classify, FLOW } from './classify.js';
import { categoriseAll, categorise, TAXONOMY } from './categories.js';
import { VERSION, BUILT, FEATURES } from './version.js';
import { RESEARCH, ask as askResearch } from './research.js';
import { isDealQuery, researchDeal, spendingContext, COST, dealPresets, holdDeal, approvalSummary } from './deals.js';
import { makeRule, describe as describeRule, runRule, dueRules, SOURCE } from './rules.js';

/**
 * Seed the full agent catalog so you can enable any of them, not just the ones your
 * data happened to trigger. Auto-proposed agents keep their derived evidence; the rest
 * get a plain description until they have something of yours to point at.
 */
const CATALOG_BLURB = {
  'Subscription Auditor': 'Watches for anything still billing you that you have stopped using',
  'Fee Catcher':          'Flags overdraft, ATM and foreign-transaction fees worth disputing',
  'Duplicate Watch':      'Catches the same merchant charging the same amount twice in a few days',
  'Budget Pacer':         'Warns when a category is on pace to run well past your normal',
  'Card Router':          'Tells you which of your cards earns most in each category'
};
function seedAgentCatalog(D) {
  for (const a of Object.values(AGENTS)) {
    if (D.agents.some(x => x.name === a.label)) continue;
    D.agents.push({ id: 'agt_' + a.label.toLowerCase().replace(/\W+/g,'_'), userId:'me',
      surface: a.surface, name: a.label, capability: 'observe', enabled: false,
      custom: false, evidence: CATALOG_BLURB[a.label] ?? a.label, confidence: null });
  }
}
import { notify } from './notify.js';
import { authRequired, checkPasscode, issueCookie, verifyCookie, cookieFrom, setCookieHeader } from './auth.js';
import {
  deriveSignals, proposeAgents, gateFor,
  verifiedTotalCents, forecast, makeSavingsEvent, verify as verifySavings, METHOD,
  selectRail, assertPassThrough, evaluate, DECISION,
  priceStats, rankOffers, shouldWait,
  CAPABILITY, SURFACE, makeAgent
} from '../packages/core/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// --- .env (no dotenv dependency) ---
const envPath = join(__dir, '.env');
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const PORT = +(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '0.0.0.0';
const store = new Store(process.env.DATA_DIR
  ? join(process.env.DATA_DIR, 'verafi.json')
  : join(__dir, 'data', 'verafi.json'));
const plaid = process.env.PLAID_CLIENT_ID
  ? new Plaid({ clientId: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, env: process.env.PLAID_ENV ?? 'sandbox' })
  : null;

const json = (res, code, body) => { res.writeHead(code, { 'content-type':'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b?JSON.parse(b):{})); });
const D = store.data;

seedAgentCatalog(D);   // keep the catalog current across upgrades

/**
 * Personal-mode default: every agent on.
 *
 * The consumer product deliberately ships agents DISABLED — an agent you switched on
 * yourself is one you'll trust with money later. That reasoning doesn't apply when you
 * are the only user and you asked for zero manual steps. Set AUTO_ENABLE_AGENTS=0 to
 * get the product behaviour back.
 */
if (process.env.AUTO_ENABLE_AGENTS !== '0') for (const a of D.agents) a.enabled = true;
store.save();

/** Anything dropped in verafi/statements/ is imported automatically. No clicking. */
const WATCH_DIR = process.env.STATEMENTS_DIR ?? join(__dir, 'statements');
async function scanStatements() {
  let files = [];
  try { files = await readdir(WATCH_DIR); } catch { return 0; }
  let added = 0;
  for (const f of files) {
    // NEVER auto-import demo data. Shipping a sample file that the watcher picks up
    // means a redeploy silently injects fake transactions into someone's real finances.
    if (!/\.(csv|ofx|qfx)$/i.test(f) || /^readme/i.test(f) || /^sample[-_]/i.test(f)) continue;
    let text;
    try { text = await readFile(join(WATCH_DIR, f), 'utf8'); } catch { continue; }
    const isOfx = /<OFX>|<STMTTRN>/i.test(text) || /\.(ofx|qfx)$/i.test(f);
    let parsed;
    try { parsed = isOfx ? importOfx(text, {}) : importCsv(text, { source: f }); }
    catch (e) { console.error(`  skipped ${f}: ${e.message}`); continue; }
    const seen = new Set(D.transactions.map(t => t.externalId));
    const fresh = parsed.filter(t => !seen.has(t.externalId));
    if (!fresh.length) continue;
    D.transactions.push(...fresh); added += fresh.length;
    console.log(`  imported ${fresh.length} new transactions from ${f}`);
  }
  if (added) {
    D.transactions.sort((a,b) => b.postedAt - a.postedAt);
    if (!D.profile.linkedAt) D.profile.linkedAt = Date.now();
    for (const a of proposeAgents(deriveSignals(D.transactions), 'me')) {
      const existing = D.agents.find(x => x.name === a.name);
      if (existing) existing.evidence = a.evidence;
    }
    store.save();
  }
  return added;
}

function ensureRootMandate() {
  if (store.root()) return store.root();
  const m = { id:'mnd_root', type:'root', perTxCents: 50_000, dailyCents: 120_000, monthlyCents: 400_000,
    allowedCategories: null, blockedCategories: ['gambling','crypto','gift_card'],
    minMerchantTrust: 0.6, issuedAt: Date.now(), expiresAt: Date.now() + 365*86400000, revokedAt: null };
  D.mandates.push(m); store.save(); return m;
}

/** Real card reward rules. Edit these to match the cards you actually hold. */
export const CARD_RULES = {
  dining: { amex_gold: 4, csr: 3, freedom: 3, citi_dc: 2 },
  grocery:{ amex_gold: 4, bofa_cash: 3, citi_dc: 2 },
  travel: { csr: 3, venture_x: 2, amex_gold: 3 },
  default:{ citi_dc: 2, freedom: 1.5 }
};
function bestCardFor(category) {
  const rules = CARD_RULES[category] ?? CARD_RULES.default;
  const owned = D.instruments.filter(i => i.rail === 'card_credit');
  let best = null;
  for (const i of owned) { const m = rules[i.cardKey] ?? 1; if (!best || m > best.mult) best = { id:i.id, name:i.displayName, mult:m }; }
  return best;
}

const ROUTES = {
  'GET /api/state': async () => {
    const tx = store.tx();
    const signals = tx.length ? deriveSignals(tx) : null;
    return {
      plaidConfigured: !!plaid, plaidEnv: process.env.PLAID_ENV ?? 'sandbox', version: VERSION,
      authRequired: authRequired(), findings: D.findings ?? [],
      linked: !!D.profile.linkedAt, transactions: tx.length,
      connections: D.connections.map(c => ({ id:c.id, institution:c.institution, accounts:c.accounts, linkedAt:c.linkedAt })),
      instruments: D.instruments, agents: D.agents, signals,
      savings: { verifiedTotalCents: verifiedTotalCents(D.savings), events: D.savings.slice(0, 30) },
      mandate: ensureRootMandate(), runs: D.runs.slice(0, 12).map(r => ({ ...r, steps: r.steps.length }))
    };
  },

  'POST /api/link/token': async () => {
    if (!plaid) return { status:400, error:'add PLAID_CLIENT_ID and PLAID_SECRET to verafi/.env' };
    const { link_token } = await plaid.createLinkToken('verafi-local-user');
    return { linkToken: link_token, env: plaid.env };
  },

  'POST /api/link/exchange': async (b) => {
    const run = store.startRun('link account');
    const ex = await plaid.exchange(b.publicToken);
    const accts = await plaid.accounts(ex.access_token);
    let institution = b.institutionName ?? 'Bank';
    try { if (b.institutionId) institution = (await plaid.institution(b.institutionId)).institution.name; } catch {}

    const conn = { id:'con_'+Date.now().toString(36), provider:'plaid', itemId: ex.item_id,
                   accessToken: ex.access_token, institution, linkedAt: Date.now(),
                   accounts: accts.accounts.map(a => a.name) };
    D.connections.push(conn);
    store.step(run, 'plaid.exchange', { institution }, { accounts: accts.accounts.length });

    const byAccount = {};
    for (const a of accts.accounts) {
      const rail = a.type === 'credit' ? 'card_credit' : a.subtype === 'checking' || a.subtype === 'savings' ? 'card_debit' : 'card_debit';
      const inst = { id:'ins_'+a.account_id.slice(0,10), connectionId: conn.id, accountId: a.account_id,
        rail, displayName: `${a.name} ···${a.mask ?? '????'}`,
        cardKey: null,                                  // set this in the UI to match your real card
        balanceCents: a.balances.available != null ? Math.round(a.balances.available*100) : null,
        rewardsByMcc: { default: 1 }, ownedByPlatform: false };
      D.instruments.push(inst); byAccount[a.account_id] = inst.id;
    }

    const { added, cursor } = await plaid.syncAll(ex.access_token);
    D.cursors[conn.id] = cursor;
    const seen = new Set(store.tx().map(t => t.externalId));
    const fresh = added.map(t => toCoreTx(t, byAccount)).filter(t => !seen.has(t.externalId));
    D.transactions.push(...fresh);
    D.transactions.sort((a,b) => b.postedAt - a.postedAt);
    store.step(run, 'plaid.transactions.sync', { cursor: !!cursor }, { added: fresh.length });

    const signals = deriveSignals(store.tx());
    store.step(run, 'profile.derive', { window:'all' }, signals);
    const proposed = proposeAgents(signals, 'me');
    for (const a of proposed) {
      if (D.agents.some(x => x.name === a.name)) continue;
      D.agents.push({ ...a, enabled:false, gate: gateFor(a.confidence) });
    }
    seedAgentCatalog(D);
    D.profile.linkedAt = Date.now();
    store.finishRun(run);
    return { linked:true, institution, accounts: conn.accounts.length, transactions: fresh.length, signals, proposed };
  },

  'POST /api/refresh': async () => {
    const run = store.startRun('refresh');
    let total = 0;
    for (const c of D.connections) {
      const { added, cursor } = await plaid.syncAll(c.accessToken, D.cursors[c.id]);
      D.cursors[c.id] = cursor;
      const byAccount = Object.fromEntries(D.instruments.filter(i => i.connectionId === c.id).map(i => [i.accountId, i.id]));
      const seen = new Set(store.tx().map(t => t.externalId));
      const fresh = added.map(t => toCoreTx(t, byAccount)).filter(t => !seen.has(t.externalId));
      D.transactions.push(...fresh); total += fresh.length;
    }
    D.transactions.sort((a,b) => b.postedAt - a.postedAt);
    store.step(run, 'plaid.transactions.sync', {}, { added: total });
    store.finishRun(run);
    return { added: total, transactions: store.tx().length };
  },

  'GET /api/spend': async (_b, q) => {
    const days = +(q.get('days') ?? 30);
    const since = Date.now() - days*86400000;
    const all = store.tx().filter(t => t.postedAt >= since);
    const tx = expensesOnly(all).filter(t => t.amountCents > 0);
    const flows = breakdown(all);
    // Full taxonomy with subcategories and per-merchant rollups, so the UI can drill in.
    const categories = categoriseAll(tx);
    const byCat = Object.fromEntries(categories.map(c => [c.key, c.cents]));
    const byMerchant = {};
    for (const t of tx) byMerchant[t.merchantName ?? t.merchantId] = (byMerchant[t.merchantName ?? t.merchantId] ?? 0) + t.amountCents;
    const top = Object.entries(byMerchant).sort((a,b)=>b[1]-a[1]).slice(0,12);
    const uncat = categories.find(c => c.key === 'other');
    return { days, totalCents: tx.reduce((a,t)=>a+t.amountCents,0),
             categories,
             uncategorisedShare: uncat ? uncat.share : 0,
             byCategoryCents: byCat, topMerchants: top,
             recent: tx.slice(0,40), signals: deriveSignals(expensesOnly(store.tx())),
             // shown in the UI so exclusions are visible, not silent
             excluded: {
               investmentCents: flows.cents.investment, transferCents: flows.cents.transfer,
               debtPaymentCents: flows.cents.debt_payment, taxCents: flows.cents.tax,
               incomeCents: flows.cents.income, counts: flows.counts } };
  },

  'GET /api/forecast': async () => {
    const s = deriveSignals(expensesOnly(store.tx()));
    const since = Date.now() - 30*86400000;
    const baseline = expensesOnly(store.tx()).filter(t => t.postedAt >= since && t.amountCents > 0)
      .reduce((a,t)=>a+t.amountCents,0);
    const dormant = s.dormantSubscriptions.reduce((a,r)=>a+r.amountCents,0);
    return { baselineMonthlyCents: baseline, signals: s, months: forecast({
      baselineMonthlyCents: baseline, interventions: [
        { name:'cancel dormant subscriptions', amountCents: dormant, probability:0.91, uncertainty:0.05, rampMonths:2 },
        { name:'route to the right card', amountCents: Math.round(s.misroutedSpendCents*0.03), probability:0.84, uncertainty:0.08, rampMonths:3 },
        { name:'refund avoidable fees', amountCents: Math.round(s.avoidableFeesCents/12), probability:0.6, uncertainty:0.2, rampMonths:2 },
        { name:'change late-night ordering', amountCents: Math.round(s.lateNightDiningShare*40000), probability:0.42, uncertainty:0.25, rampMonths:6 }
      ]})};
  },

  'GET /api/save': async () => {
    // Opportunities come straight from the agents, so every line has a title AND an
    // explanation. A number with no detail is not something you can act on.
    const { all, recurringAnnualCents, oneOffCents } = runAgents({ store, cardRules: CARD_RULES });
    return {
      verifiedTotalCents: verifiedTotalCents(D.savings),
      events: D.savings,
      opportunities: all,
      recurringAnnualCents, oneOffCents,
      totalAnnualOpportunityCents: recurringAnnualCents,
      agentsEnabled: D.agents.filter(a => a.enabled).length,
      agentsAvailable: D.agents.length
    };
  },

  'POST /api/save/claim': async (b) => {
    const ev = verifySavings(makeSavingsEvent({ id:'sv_'+Date.now().toString(36), userId:'me',
      method: b.method ?? METHOD.SUBSCRIPTION_CANCEL, amountCents: b.amountCents,
      recurringMonths: b.recurringMonths ?? 0,
      evidence: b.evidence ?? { kind:'manual', note:'confirmed by me' } }));
    D.savings.unshift(ev); store.save();
    return { event: ev, verifiedTotalCents: verifiedTotalCents(D.savings) };
  },

  'POST /api/agents/toggle': async (b) => {
    const a = store.agent(b.id); if (!a) return { status:404, error:'not found' };
    a.enabled = !!b.enabled; store.save(); return { agent: a };
  },
  'POST /api/agents': async (b) => {
    if (!b.evidence || b.evidence.length < 10) return { status:422, error:'an agent must cite what it learned' };
    const a = { ...makeAgent({ id:'agt_'+Date.now().toString(36), userId:'me', surface:b.surface,
      name:b.name, capability: b.capability ?? CAPABILITY.RECOMMEND, enabled:false, custom:true }),
      evidence:b.evidence, confidence: 1, ceilingCents: b.ceilingCents ?? null };
    D.agents.push(a); store.save(); return { agent: a };
  },
  'GET /api/cards': async () => {
    const keys = new Set();
    for (const cat of Object.values(CARD_RULES)) for (const k of Object.keys(cat)) keys.add(k);
    return { cardKeys: [...keys].sort(), rules: CARD_RULES,
             instruments: D.instruments.filter(i => i.rail === 'card_credit') };
  },

  'POST /api/instruments/card': async (b) => {
    const i = store.instrument(b.id); if (!i) return { status:404, error:'not found' };
    i.cardKey = b.cardKey; store.save(); return { instrument: i };
  },

  /** No aggregator needed. Export CSV or OFX from online banking and drop it in. */
  'POST /api/import': async (b) => {
    const run = store.startRun('import ' + (b.filename ?? 'file'));
    const text = b.text ?? '';
    const isOfx = /<OFX>|<STMTTRN>/i.test(text) || /\.(ofx|qfx)$/i.test(b.filename ?? '');
    let parsed;
    try { parsed = isOfx ? importOfx(text, { instrumentId: b.instrumentId })
                         : importCsv(text, { instrumentId: b.instrumentId, source: b.filename ?? 'csv' }); }
    catch (e) { store.finishRun(run, 'failed'); return { status:422, error: e.message }; }

    const seen = new Set(store.tx().map(t => t.externalId));
    const fresh = parsed.filter(t => !seen.has(t.externalId));
    D.transactions.push(...fresh);
    D.transactions.sort((a,b) => b.postedAt - a.postedAt);
    store.step(run, 'import.' + (isOfx ? 'ofx' : 'csv'), { filename: b.filename }, { parsed: parsed.length, added: fresh.length });

    const signals = deriveSignals(store.tx());
    store.step(run, 'profile.derive', {}, signals);
    for (const a of proposeAgents(signals, 'me')) {
      if (D.agents.some(x => x.name === a.name)) continue;
      D.agents.push({ ...a, enabled:false, gate: gateFor(a.confidence) });
    }
    seedAgentCatalog(D);
    if (!D.profile.linkedAt) D.profile.linkedAt = Date.now();
    store.finishRun(run);
    return { added: fresh.length, skipped: parsed.length - fresh.length, total: store.tx().length, signals };
  },

  'POST /api/auth': async (b, _q, res) => {
    if (!authRequired()) return { ok:true, note:'no passcode configured' };
    if (!checkPasscode(b.passcode)) { await new Promise(r=>setTimeout(r, 600)); return { status:401, error:'wrong passcode' }; }
    res.setHeader('set-cookie', setCookieHeader(issueCookie(), !!process.env.PUBLIC_URL));
    return { ok:true };
  },

  /** Run every enabled agent now. Also what the daily schedule calls. */
  'POST /api/agents/run': async () => {
    const run = store.startRun('agents');
    const { all, fresh } = runAgents({ store, cardRules: CARD_RULES });
    store.step(run, 'agents.run', { enabled: D.agents.filter(a=>a.enabled).map(a=>a.name) },
      { findings: all.length, fresh: fresh.length });
    let channel = null;
    if (fresh.length) {
      try {
        channel = await notify({
          title: `Verafi found ${fresh.length} thing${fresh.length>1?'s':''} worth ${'$'+Math.round(fresh.reduce((a,f)=>a+f.annualCents,0)/100)}/yr`,
          lines: fresh.slice(0,6).map(f => `${f.title} — ${f.detail}`),
          url: process.env.PUBLIC_URL });
      } catch (e) { store.step(run, 'notify', {}, { error: e.message }); }
    }
    store.finishRun(run);
    return { findings: all, fresh, notified: channel };
  },

  'GET /api/findings': async () => ({
    findings: D.findings ?? [],
    totalAnnualCents: (D.findings ?? []).reduce((a,f)=>a+f.annualCents, 0),
    available: Object.values(AGENTS).map(a => a.label),
    enabled: D.agents.filter(a => a.enabled).map(a => a.name),
    lastRun: (D.runs.find(r => r.intentText === 'agents') ?? {}).startedAt ?? null
  }),

  'POST /api/findings/dismiss': async (b) => {
    D.findings = (D.findings ?? []).filter(f => `${f.agent}:${f.ref}` !== b.key);
    store.save(); return { ok:true };
  },

  /** Research agents. capability = recommend. Nothing here can spend money. */
  /** Deal surface tuned to this user's own categories and budgets. */
  'GET /api/deals/presets': async () => ({ categories: dealPresets(store.tx()) }),

  /** Programmatic hunts: typed parameters, hard ceiling, never buys. */
  'GET /api/hunts': async () => ({
    hunts: (D.hunts ?? []).map(h => ({ ...h, summary: describeRule(h) })),
    sources: [{ key: SOURCE.OWN_HISTORY, label: 'Watch my own purchases', cost: 'free' },
              { key: SOURCE.WEB, label: 'Search the web', cost: 'needs an API key' }]
  }),
  'POST /api/hunts': async (b) => {
    try {
      const r = makeRule({ ...b, ceilingCents: Math.round(Number(b.ceilingCents)) });
      (D.hunts ??= []).unshift(r); store.save();
      return { hunt: { ...r, summary: describeRule(r) } };
    } catch (e) { return { status: 422, error: e.message }; }
  },
  'POST /api/hunts/toggle': async (b) => {
    const h = (D.hunts ?? []).find(x => x.id === b.id);
    if (!h) return { status:404, error:'not found' };
    h.enabled = !!b.enabled; store.save(); return { hunt: h };
  },
  'POST /api/hunts/delete': async (b) => {
    D.hunts = (D.hunts ?? []).filter(x => x.id !== b.id); store.save(); return { ok:true };
  },
  'POST /api/hunts/run': async (b) => {
    const h = (D.hunts ?? []).find(x => x.id === b.id);
    if (!h) return { status:404, error:'not found' };
    const run = store.startRun('hunt: ' + h.name);
    const out = await runRule({ rule: h, store, apiKey: process.env.ANTHROPIC_API_KEY });
    store.step(run, 'hunt.evaluate', { ceiling: h.ceilingCents, traits: h.traits },
      { matches: out.matches.length, why: out.why });
    store.finishRun(run);
    store.save();
    return { ...out, hunt: { ...h, summary: describeRule(h) } };
  },

  /** Pin a deal. Cannot pay - keeps watching and hands off to the merchant checkout. */
  'POST /api/deals/hold': async (b) => ({ item: holdDeal({ store, ...b }) }),
  'GET /api/deals/watchlist': async () => ({ items: D.watchlist ?? [] }),
  'POST /api/deals/approve': async (b) => {
    const item = (D.watchlist ?? []).find(i => i.id === b.id);
    if (!item) return { status:404, error:'not found' };
    return approvalSummary(item, store.tx());
  },
  'POST /api/deals/drop': async (b) => {
    D.watchlist = (D.watchlist ?? []).filter(i => i.id !== b.id); store.save();
    return { ok:true };
  },

  'GET /api/research': async () => ({
    presets: Object.entries(RESEARCH).map(([k, r]) => ({ key:k, label:r.label, hint:r.hint, icon:r.icon }))
  }),
  'POST /api/ask': async (b) => {
    const run = store.startRun(b.query || b.preset || 'research');
    // "find me a deal" needs the outside world; "what am I overpaying for" needs your data.
    // Route on intent rather than making the user pick.
    if (!b.preset && isDealQuery(b.query)) {
      const month = new Date().toISOString().slice(0,7);
      D.meter ??= {}; D.meter[month] ??= { monthUsd: 0, queries: 0, cache: {} };
      const out = await researchDeal({ query: b.query, tx: store.tx(),
                                       apiKey: process.env.ANTHROPIC_API_KEY,
                                       meter: D.meter[month] });
      store.save();
      store.step(run, 'research.deal', { query: b.query }, { ok: out.ok, sources: (out.sources||[]).length });
      store.finishRun(run, out.ok ? 'completed' : 'blocked');
      return { agent:'deal', label:'Deal research', icon:'🔎', kind:'deal',
               steps:[{tool:'context.load',detail:out.context.summary},
                      {tool:'web.search',detail: out.ok ? `${(out.sources||[]).length} sources` : 'unavailable'}],
               answer: out.answer, evidence: (out.sources||[]).map(s=>`${s.title||s.url} — ${s.url}`),
               howToFix: out.howToFix, ok: out.ok, cached: out.cached, capped: out.capped,
               costUsd: out.costUsd,
               meter: { spentUsd: D.meter[month].monthUsd, queries: D.meter[month].queries,
                        capUsd: COST.monthlyCapUsd },
               disclaimer:'Research only — this agent cannot book or pay for anything.' };
    }
    const out = askResearch({ query: b.query, preset: b.preset, tx: store.tx(),
                              instruments: D.instruments, cardRules: CARD_RULES });
    store.step(run, 'research.' + out.agent, { query: b.query }, { evidence: out.evidence.length });
    store.finishRun(run);
    return out;
  },

  /** Wipe any demo rows that a redeploy may have injected, without touching real data. */
  'POST /api/purge-demo': async () => {
    const DEMO = /equinox sf union|dropbox\*plus|payroll direct dep|rent - property mgmt|blue bottle|onyx/i;
    const before = D.transactions.length;
    D.transactions = D.transactions.filter(t => !/^(s\.csv|sample)/i.test(t.source ?? '') && !DEMO.test(t.merchantName ?? ''));
    D.findings = []; D.seenFindings = {};
    store.save();
    return { removed: before - D.transactions.length, remaining: D.transactions.length };
  },

  'POST /api/reset': async () => { store.reset(); return { reset:true }; },
  'GET /api/runs': async () => ({ runs: D.runs.slice(0, 30) }),
  'GET /api/health': async () => ({ ok:true, version: VERSION, built: BUILT, features: FEATURES,
     plaid: !!plaid, env: process.env.PLAID_ENV ?? 'sandbox' })
};

const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;

  // Auth gate. Open only when no passcode is set (local-only mode).
  const OPEN = new Set(['POST /api/auth', 'GET /api/health']);
  if (authRequired() && url.pathname.startsWith('/api/') && !OPEN.has(key) && !verifyCookie(cookieFrom(req)))
    return json(res, 401, { error: 'locked' });

  if (ROUTES[key]) {
    try {
      const out = await ROUTES[key](req.method === 'GET' ? {} : await readBody(req), url.searchParams, res);
      return json(res, out?.status ?? 200, out);
    } catch (e) { console.error(e); return json(res, 500, { error: e.message }); }
  }
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(__dir, 'public', p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    return res.end(buf);
  } catch { return json(res, 404, { error:'not found' }); }
});

/**
 * Daily agent run. Deliberately a plain interval, not cron — this process is meant to
 * stay up, and one dependency-free timer is easier to reason about than a scheduler.
 */
const EVERY = +(process.env.AGENT_INTERVAL_HOURS ?? 24) * 3600_000;
async function scheduled() {
  try {
    if (plaid && D.connections.length) {
      for (const c of D.connections) {
        const { added, cursor } = await plaid.syncAll(c.accessToken, D.cursors[c.id]);
        D.cursors[c.id] = cursor;
        const byAccount = Object.fromEntries(D.instruments.filter(i => i.connectionId === c.id).map(i => [i.accountId, i.id]));
        const seen = new Set(D.transactions.map(t => t.externalId));
        D.transactions.push(...added.map(t => toCoreTx(t, byAccount)).filter(t => !seen.has(t.externalId)));
      }
      D.transactions.sort((a,b) => b.postedAt - a.postedAt);
    }
    // Hunts run on the same daily beat. Matches land in the Spend queue for approval.
    for (const h of dueRules(D.hunts)) {
      try {
        const out = await runRule({ rule: h, store, apiKey: process.env.ANTHROPIC_API_KEY });
        if (out.matches?.length) await notify({
          title: `Verafi found a match: ${h.name}`,
          lines: out.matches.map(m => `${m.title} — $${Math.round(m.foundPriceCents/100)}`),
          url: process.env.PUBLIC_URL }).catch(()=>{});
      } catch (e) { console.error('hunt failed:', h.name, e.message); }
    }
    store.save();
    const { fresh } = runAgents({ store, cardRules: CARD_RULES });
    if (fresh.length) await notify({
      title: `Verafi found ${fresh.length} thing${fresh.length>1?'s':''} worth $${Math.round(fresh.reduce((a,f)=>a+f.annualCents,0)/100)}/yr`,
      lines: fresh.slice(0,6).map(f => `${f.title} — ${f.detail}`),
      url: process.env.PUBLIC_URL });
    console.log(`[${new Date().toISOString()}] agents ran · ${fresh.length} new findings`);
  } catch (e) { console.error('scheduled run failed:', e.message); }
}
setInterval(scheduled, EVERY);
setTimeout(scheduled, 15_000);                       // once shortly after boot

// Watch the statements folder. New file → import → run agents → notify. No interaction.
setInterval(async () => {
  const added = await scanStatements();
  if (added) {
    // Hunts run on the same daily beat. Matches land in the Spend queue for approval.
    for (const h of dueRules(D.hunts)) {
      try {
        const out = await runRule({ rule: h, store, apiKey: process.env.ANTHROPIC_API_KEY });
        if (out.matches?.length) await notify({
          title: `Verafi found a match: ${h.name}`,
          lines: out.matches.map(m => `${m.title} — $${Math.round(m.foundPriceCents/100)}`),
          url: process.env.PUBLIC_URL }).catch(()=>{});
      } catch (e) { console.error('hunt failed:', h.name, e.message); }
    }
    store.save();
    const { fresh } = runAgents({ store, cardRules: CARD_RULES });
    if (fresh.length) await notify({
      title: `Verafi found ${fresh.length} thing${fresh.length>1?'s':''} worth $${Math.round(fresh.reduce((a,f)=>a+f.annualCents,0)/100)}/yr`,
      lines: fresh.slice(0,6).map(f => `${f.title} — ${f.detail}`),
      url: process.env.PUBLIC_URL }).catch(()=>{});
  }
}, 60_000);

await scanStatements();
runAgents({ store, cardRules: CARD_RULES });

server.listen(PORT, HOST, () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  Verafi (personal)  ·  ${process.env.PLAID_ENV ?? 'sandbox'} mode`);
  console.log(`  this machine   http://localhost:${PORT}`);
  lan.forEach(a => console.log(`  your phone     http://${a}:${PORT}   ← same wifi, add to home screen`));
  if (!plaid) console.log(`\n  ⚠  no Plaid keys yet — copy verafi/.env.example to verafi/.env`);
  else console.log(`  data           verafi/data/verafi.json`);
  if (!authRequired() && HOST === '0.0.0.0')
    console.log(`  ⚠  NO PASSCODE SET — anyone on this network can read your finances.`);
  if (authRequired()) console.log(`  🔒 passcode required`);
  console.log(`  agents         ${D.agents.filter(a=>a.enabled).length} on · every ${(EVERY/3600000).toFixed(0)}h · ${process.env.NTFY_TOPIC ? 'ntfy alerts' : 'no notifications configured'}`);
  console.log(`  statements     drop CSV/OFX files in verafi/statements/ — imported automatically`);
  console.log(`  version        ${VERSION} (${BUILT})`);
  console.log(`  findings       ${(D.findings ?? []).length} worth $${Math.round((D.findings ?? []).reduce((a,f)=>a+f.annualCents,0)/100).toLocaleString()}/yr\n`);
});

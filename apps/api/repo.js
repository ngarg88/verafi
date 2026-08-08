/**
 * Dev repository: in-memory, seeded. Swap for Postgres by implementing the same
 * six methods against db/001_init.sql. Nothing above this file knows the difference.
 */
import { randomUUID } from 'node:crypto';

export function createRepo() {
  const db = {
    users: new Map(), devices: new Map(), instruments: [], transactions: [],
    agents: [], mandates: new Map(), rules: [], runs: new Map(), runSteps: [],
    savings: [], merchants: new Map()
  };

  const api = {
    db,
    user: (id) => db.users.get(id),
    createUser(email) {
      const u = { id: 'usr_' + randomUUID().slice(0,8), email, cashFloorCents: 200_000,
                  spentTodayCents: 0, spentThisMonthCents: 0, linked: false };
      db.users.set(u.id, u); return u;
    },
    addDevice(userId, publicKeyPem, platform='ios') {
      const d = { id:'dev_'+randomUUID().slice(0,8), userId, publicKeyPem, platform,
                  invalidatedAt:null, lastPresenceAt: Date.now() };
      db.devices.set(d.id, d); return d;
    },
    deviceFor: (userId) => [...db.devices.values()].find(d => d.userId === userId),
    instrumentsFor: (userId) => db.instruments.filter(i => i.userId === userId),
    transactionsFor: (userId) => db.transactions.filter(t => t.userId === userId),
    agentsFor: (userId, surface) => db.agents.filter(a => a.userId === userId && (!surface || a.surface === surface)),
    saveAgent(a) { const i = db.agents.findIndex(x => x.id === a.id); i >= 0 ? db.agents[i] = a : db.agents.push(a); return a; },
    mandate: (id) => db.mandates.get(id),
    saveMandate(m) { db.mandates.set(m.id, m); return m; },
    rootMandateFor: (userId) => [...db.mandates.values()].find(m => m.userId === userId && m.type === 'root'),
    savingsFor: (userId) => db.savings.filter(s => s.userId === userId),
    addSavings(e) { db.savings.push(e); return e; },
    merchant: (slug) => db.merchants.get(slug),

    startRun(userId, intentText, agentId = null) {
      const r = { id:'run_'+randomUUID().slice(0,8), userId, agentId, intentText,
                  status:'running', startedAt:Date.now(), finishedAt:null, steps:[] };
      db.runs.set(r.id, r); return r;
    },
    step(runId, tool, request, response, extra = {}) {
      const run = db.runs.get(runId);
      const s = { seq: run.steps.length, tool, request, response, ...extra, at: Date.now() };
      run.steps.push(s); db.runSteps.push({ runId, ...s });
      return s;
    },
    finishRun(runId, status='completed') {
      const r = db.runs.get(runId); r.status = status; r.finishedAt = Date.now(); return r;
    },
    run: (id) => db.runs.get(id),
    runsFor: (userId) => [...db.runs.values()].filter(r => r.userId === userId)
  };
  return api;
}

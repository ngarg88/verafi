import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Single-user local store. Your bank data lives in ONE json file on YOUR machine
 * and goes nowhere else. Atomic writes so a crash mid-save can't corrupt it.
 */
const EMPTY = {
  profile: { email: null, cashFloorCents: 200000, linkedAt: null },
  connections: [], instruments: [], transactions: [], agents: [],
  mandates: [], rules: [], runs: [], savings: [], savingsActions: [], cursors: {},
  customCategories: [], hunts: [], watchlist: [], imports: [], notificationHistory: []
};

export class Store {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try { this.data=JSON.parse(readFileSync(path,'utf8')); }
      catch(e) {
        const backup=path+'.bak';
        if(!existsSync(backup))throw new Error(`Verafi data is unreadable and no backup is available: ${e.message}`);
        this.data=JSON.parse(readFileSync(backup,'utf8'));
      }
      try{chmodSync(path,0o600);}catch{}
    } else this.data=structuredClone(EMPTY);
    for (const k of Object.keys(EMPTY)) if (this.data[k] === undefined) this.data[k] = structuredClone(EMPTY[k]);
  }
  save() {
    const tmp = this.path + '.tmp';
    if(existsSync(this.path))copyFileSync(this.path,this.path+'.bak');
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), {mode:0o600});
    renameSync(tmp, this.path);          // atomic on the same filesystem
    try{chmodSync(this.path,0o600);chmodSync(this.path+'.bak',0o600);}catch{}
    return this;
  }
  /** Mutate in place — callers hold a reference to `data` and must not be orphaned. */
  reset() {
    for (const k of Object.keys(EMPTY)) this.data[k] = structuredClone(EMPTY[k]);
    return this.save();
  }

  // --- convenience accessors used by the server ---
  tx()        { return this.data.transactions; }
  agents(s)   { return s ? this.data.agents.filter(a => a.surface === s) : this.data.agents; }
  agent(id)   { return this.data.agents.find(a => a.id === id); }
  mandate(id) { return this.data.mandates.find(m => m.id === id); }
  root()      { return this.data.mandates.find(m => m.type === 'root' && !m.revokedAt); }
  instrument(id) { return this.data.instruments.find(i => i.id === id); }

  startRun(intentText, agentId = null) {
    const r = { id: 'run_' + Math.random().toString(36).slice(2, 10), agentId, intentText,
                status: 'running', startedAt: Date.now(), finishedAt: null, steps: [] };
    this.data.runs.unshift(r);
    this.data.runs = this.data.runs.slice(0, 200);      // keep the file small
    return r;
  }
  step(run, tool, request, response, extra = {}) {
    run.steps.push({ seq: run.steps.length, tool, request, response, ...extra, at: Date.now() });
    return run;
  }
  finishRun(run, status = 'completed') { run.status = status; run.finishedAt = Date.now(); this.save(); return run; }
}

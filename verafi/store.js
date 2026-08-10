import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Single-user local store. Your bank data lives in ONE json file on YOUR machine
 * and goes nowhere else. Atomic writes so a crash mid-save can't corrupt it.
 */
const EMPTY = {
  profile: { email: null, cashFloorCents: 200000, linkedAt: null },
  connections: [], instruments: [], transactions: [], agents: [],
  mandates: [], rules: [], runs: [], savings: [], cursors: {},
  customCategories: [], hunts: [], watchlist: []
};

export class Store {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : structuredClone(EMPTY);
    for (const k of Object.keys(EMPTY)) if (this.data[k] === undefined) this.data[k] = structuredClone(EMPTY[k]);
  }
  save() {
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);          // atomic on the same filesystem
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

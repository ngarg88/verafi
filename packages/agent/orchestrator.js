import { evaluate, DECISION } from '../core/policy.js';
import { isUntrusted } from './tools.js';

/**
 * The run loop. The planner proposes steps; this executes them, traces everything,
 * and hands any money-moving step to the deterministic policy gate.
 *
 * Design rule: the plan is DATA. A planner (LLM or rules) returns typed steps.
 * No model output is ever executed directly.
 */
export class Orchestrator {
  constructor({ registry, repo, planner, onEvent = () => {} }) {
    Object.assign(this, { registry, repo, planner, onEvent });
  }

  async run({ userId, intentText, agent, ctx = {} }) {
    const capability = agent?.capability ?? 'recommend';
    const run = this.repo.startRun(userId, intentText, agent?.id ?? null);
    const emit = (type, data) => this.onEvent({ runId: run.id, type, data, at: Date.now() });
    emit('run.started', { intentText, agent: agent?.name ?? null, capability });

    const plan = await this.planner.plan({ intentText, capability,
      tools: this.registry.for(capability).map(t => ({ name: t.name, description: t.description })) });
    this.repo.step(run.id, 'planner.plan', { intentText, capability }, { steps: plan.map(s => s.tool) });
    emit('plan.ready', { steps: plan.map(s => ({ tool: s.tool, label: s.label })) });

    const state = { ...ctx, userId };
    for (const step of plan) {
      let tool;
      try { tool = this.registry.assertAllowed(step.tool, capability); }
      catch (e) {
        this.repo.step(run.id, step.tool, step.args ?? {}, { error: e.message });
        emit('step.blocked', { tool: step.tool, error: e.message });
        this.repo.finishRun(run.id, 'blocked');
        return { runId: run.id, status: 'blocked', error: e.message, state };
      }

      emit('step.started', { tool: step.tool, label: step.label });
      const t0 = Date.now();
      let out;
      try { out = await tool.run({ ...state, ...(step.args ?? {}) }); }
      catch (e) {
        this.repo.step(run.id, step.tool, step.args ?? {}, { error: e.message }, { latencyMs: Date.now() - t0 });
        emit('step.failed', { tool: step.tool, error: e.message });
        this.repo.finishRun(run.id, 'failed');
        return { runId: run.id, status: 'failed', error: e.message, state };
      }

      // Quarantined content is carried but can never be assigned into decision state.
      if (isUntrusted(out)) {
        state.__evidence = [...(state.__evidence ?? []), out];
      } else {
        Object.assign(state, out);
      }
      this.repo.step(run.id, step.tool, step.args ?? {},
        isUntrusted(out) ? { quarantined: true } : out, { latencyMs: Date.now() - t0 });
      emit('step.completed', { tool: step.tool, latencyMs: Date.now() - t0,
                               summary: isUntrusted(out) ? '[quarantined]' : summarise(out) });
    }

    // Any run that ends in a purchase must pass the gate before a mandate is offered.
    if (state.proposedPurchase) {
      const decision = evaluate(state.proposedPurchase, { ...state.policyCtx, agent, signatureVerified: false });
      this.repo.step(run.id, 'policy.evaluate', state.proposedPurchase, decision,
        { decision: decision.decision, reasons: decision.reasons });
      emit('approval.required', { decision, purchase: state.proposedPurchase });
      state.decision = decision;
      if (decision.decision === DECISION.DENY) {
        this.repo.finishRun(run.id, 'denied');
        emit('run.completed', { status: 'denied' });
        return { runId: run.id, status: 'denied', state };
      }
    }

    this.repo.finishRun(run.id, 'completed');
    emit('run.completed', { status: 'completed' });
    return { runId: run.id, status: 'completed', state };
  }
}

function summarise(o) {
  if (o == null) return null;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = Array.isArray(v) ? `${v.length} items`
           : typeof v === 'object' ? '{…}' : v;
  }
  return out;
}

import { CAPABILITY, CAPABILITY_RANK } from '../core/capabilities.js';

/**
 * Every tool declares the capability it requires. The registry refuses to hand a
 * tool to an agent that isn't allowed to hold it. This is enforcement, not convention.
 */
export function defineTool({ name, requires, description, run }) {
  if (!Object.values(CAPABILITY).includes(requires)) throw new Error(`bad capability on ${name}`);
  return { name, requires, description, run };
}

export class ToolRegistry {
  #tools = new Map();
  register(t) { this.#tools.set(t.name, t); return this; }
  get(name) { return this.#tools.get(name); }

  /** Tools an agent at this capability may use. Never more. */
  for(capability) {
    const rank = CAPABILITY_RANK[capability];
    return [...this.#tools.values()].filter(t => CAPABILITY_RANK[t.requires] <= rank);
  }

  assertAllowed(toolName, capability) {
    const t = this.get(toolName);
    if (!t) throw new Error(`unknown tool: ${toolName}`);
    if (CAPABILITY_RANK[t.requires] > CAPABILITY_RANK[capability])
      throw new Error(`capability_violation: ${toolName} requires ${t.requires}, agent has ${capability}`);
    return t;
  }
}

/** Merchant/web content is HOSTILE input. It must never reach the policy engine. */
export function quarantine(untrustedText) {
  return {
    __untrusted: true,
    text: String(untrustedText).slice(0, 8000),
    toString() { throw new Error('untrusted content cannot be coerced into a decision path'); }
  };
}
export function isUntrusted(v) { return !!v?.__untrusted; }

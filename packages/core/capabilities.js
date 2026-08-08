/**
 * The capability ladder. An agent is an object with a level, not a personality.
 * Preset agents and user-built agents are the same row; presets are ones we ship with.
 */
export const CAPABILITY = Object.freeze({
  OBSERVE:                'observe',                 // read + flag. needs: bank link
  RECOMMEND:              'recommend',               // search, compare, propose. needs: catalog
  EXECUTE_AUTHORIZED:     'execute_authorized',      // act with a LIVE biometric each time
  EXECUTE_PREAUTHORIZED:  'execute_preauthorized'    // act inside a pre-signed envelope
});

export const CAPABILITY_RANK = {
  [CAPABILITY.OBSERVE]: 0,
  [CAPABILITY.RECOMMEND]: 1,
  [CAPABILITY.EXECUTE_AUTHORIZED]: 2,
  [CAPABILITY.EXECUTE_PREAUTHORIZED]: 3
};

/** Capabilities that move money. Anything here requires a verified signature. */
export const SPENDING_CAPABILITIES = new Set([
  CAPABILITY.EXECUTE_AUTHORIZED,
  CAPABILITY.EXECUTE_PREAUTHORIZED
]);

export const SURFACE = Object.freeze({ ASK:'ask', SPEND:'spend', SAVE:'save' });

/** @typedef {{id:string,userId:string,surface:string,name:string,capability:string,
 *             enabled:boolean,custom:boolean,evidence:string|null,ceilingCents:number|null}} Agent */

export function makeAgent(p) {
  if (!Object.values(SURFACE).includes(p.surface)) throw new Error(`bad surface: ${p.surface}`);
  if (!Object.values(CAPABILITY).includes(p.capability)) throw new Error(`bad capability: ${p.capability}`);
  return {
    id: p.id, userId: p.userId, surface: p.surface, name: p.name,
    capability: p.capability,
    enabled: p.enabled ?? false,
    custom: p.custom ?? false,
    evidence: p.evidence ?? null,           // MUST cite what it learned, or it stays generic
    ceilingCents: p.ceilingCents ?? null
  };
}

/** An agent may never exceed the capability its user has granted it. */
export function effectiveCapability(agent, grantedCapability) {
  return CAPABILITY_RANK[agent.capability] <= CAPABILITY_RANK[grantedCapability]
    ? agent.capability : grantedCapability;
}

import { SPENDING_CAPABILITIES, CAPABILITY } from './capabilities.js';
import { withinEnvelope, verifySignature, cartPayload } from './mandate.js';

export const DECISION = Object.freeze({
  ALLOW:'allow',       // execute now — signature already verified
  STEP_UP:'step_up',   // needs a fresh live biometric
  DENY:'deny'          // refused. no prompt offered.
});

export const STEP_UP_REASON = Object.freeze({
  ABOVE_ENVELOPE:'amount_exceeds_signed_envelope',
  NEW_MERCHANT:'merchant_not_previously_used',
  LOW_TRUST:'merchant_trust_below_threshold',
  NEW_DEVICE:'unrecognised_device',
  KEY_INVALIDATED:'biometric_enrollment_changed',
  MANDATE_EXPIRING:'mandate_within_24h_of_expiry',
  STALE_PRESENCE:'no_user_presence_in_14_days',
  NO_SIGNATURE:'no_verified_signature_present'
});

const DAY = 24 * 3600 * 1000;

/**
 * The deterministic gate. The model proposes a PaymentIntent; this disposes of it.
 * No LLM output ever reaches this function — only typed fields.
 */
export function evaluate(intent, ctx) {
  const reasons = [];
  const deny = (r) => ({ decision: DECISION.DENY, reasons: [...reasons, r], railId: null });
  const stepUp = (r) => ({ decision: DECISION.STEP_UP, reasons: [...reasons, r], railId: intent.railId });

  const { mandate, agent } = ctx;
  if (!mandate) return deny('no_root_mandate');
  if (mandate.revokedAt) return deny('mandate_revoked');

  // --- hard denies. no prompt, no override, not even by us. ---
  if (mandate.blockedCategories?.includes(intent.category))
    return deny('blocked_category');                       // user cannot biometric past their own blocklist
  if (mandate.allowedCategories && !mandate.allowedCategories.includes(intent.category))
    return deny('category_not_allowed');
  if ((ctx.merchantTrust ?? 0) < (mandate.minMerchantTrust ?? 0.6))
    return deny('merchant_trust_hard_floor');
  if (intent.amountCents <= 0) return deny('non_positive_amount');

  // --- an agent may only spend if its capability says so ---
  if (agent && !SPENDING_CAPABILITIES.has(agent.capability))
    return deny(`agent_capability_${agent.capability}_cannot_spend`);
  if (agent?.ceilingCents != null && intent.amountCents > agent.ceilingCents)
    return deny('above_agent_ceiling');

  // --- ceilings. min() always wins; a rule can never widen its parent. ---
  if (intent.amountCents > mandate.perTxCents) return stepUp('above_per_transaction_limit');
  if ((ctx.spentTodayCents ?? 0) + intent.amountCents > mandate.dailyCents)
    return deny('daily_ceiling_exceeded');
  if ((ctx.spentThisMonthCents ?? 0) + intent.amountCents > mandate.monthlyCents)
    return deny('monthly_ceiling_exceeded');

  // --- mandatory step-up triggers ---
  if (ctx.deviceKnown === false)         return stepUp(STEP_UP_REASON.NEW_DEVICE);
  if (ctx.biometricInvalidated === true) return stepUp(STEP_UP_REASON.KEY_INVALIDATED);
  if (ctx.lastPresenceAt != null && (ctx.now - ctx.lastPresenceAt) > 14 * DAY)
    return stepUp(STEP_UP_REASON.STALE_PRESENCE);
  if (mandate.expiresAt != null && (mandate.expiresAt - ctx.now) < DAY)
    return stepUp(STEP_UP_REASON.MANDATE_EXPIRING);
  if ((ctx.merchantTrust ?? 0) < 0.85) return stepUp(STEP_UP_REASON.LOW_TRUST);
  if (ctx.merchantSeenBefore === false) return stepUp(STEP_UP_REASON.NEW_MERCHANT);

  // --- unattended path: must sit inside a signed envelope ---
  if (intent.unattended) {
    if (agent?.capability !== CAPABILITY.EXECUTE_PREAUTHORIZED)
      return deny('agent_not_preauthorized');
    const w = withinEnvelope(intent, ctx.envelope, ctx);
    if (!w.ok) return stepUp(w.reason);
    reasons.push('inside_signed_envelope');
    return { decision: DECISION.ALLOW, reasons, railId: intent.railId };
  }

  // --- attended path: a verified signature over THIS cart, or nothing ---
  if (!ctx.signatureVerified) return stepUp(STEP_UP_REASON.NO_SIGNATURE);
  reasons.push('live_signature_verified');
  return { decision: DECISION.ALLOW, reasons, railId: intent.railId };
}

/**
 * The only function permitted to authorize a charge. Enforces the invariant that
 * a decision alone is never sufficient — the cryptography must also check out.
 */
export function authorize({ cart, decision, devicePublicKeyPem, nonceCache }) {
  if (decision.decision !== DECISION.ALLOW)
    return { authorized:false, reason:'policy_' + decision.decision };
  if (!nonceCache.check(cart.nonce))
    return { authorized:false, reason:'nonce_replayed' };
  if (Date.now() > cart.expiresAt)
    return { authorized:false, reason:'cart_mandate_expired' };
  const ok = verifySignature({
    payloadStr: cartPayload(cart),
    signatureB64: cart.signature,
    devicePublicKeyPem
  });
  if (!ok) return { authorized:false, reason:'signature_invalid' };
  return { authorized:true, reason:'ok' };
}

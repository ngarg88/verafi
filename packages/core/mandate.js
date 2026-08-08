import { createHash, createVerify, randomUUID } from 'node:crypto';

export const MANDATE_TYPE = Object.freeze({ ROOT:'root', INTENT:'intent', CART:'cart' });

/**
 * Canonical payload that the device signs. Order matters — both sides must hash identically.
 * The signature covers the transaction, never a boolean.
 */
export function cartPayload(c) {
  return JSON.stringify([
    c.merchantId, c.amountCents, c.currency, c.itemHash,
    c.railId, c.nonce, c.issuedAt, c.expiresAt, c.parentMandateId
  ]);
}
export function payloadHash(payloadStr) {
  return createHash('sha256').update(payloadStr).digest('hex');
}

export function createCartMandate(p) {
  const now = p.now ?? Date.now();
  return {
    id: 'mnd_' + randomUUID().slice(0, 8),
    type: MANDATE_TYPE.CART,
    userId: p.userId,
    merchantId: p.merchantId,
    amountCents: p.amountCents,
    currency: p.currency ?? 'USD',
    itemHash: p.itemHash,
    railId: p.railId,
    nonce: randomUUID(),
    issuedAt: now,
    expiresAt: now + (p.ttlMs ?? 15 * 60 * 1000),
    parentMandateId: p.parentMandateId,
    signature: null
  };
}

/**
 * Pre-signed envelope for unattended execution. A rule that fires at 3am is not
 * unauthorized — the user biometrically signed this envelope in advance.
 */
export function createIntentMandate(p) {
  const now = p.now ?? Date.now();
  return {
    id: 'mnd_' + randomUUID().slice(0, 8),
    type: MANDATE_TYPE.INTENT,
    userId: p.userId,
    ceilingCents: p.ceilingCents,
    merchantAllowlist: p.merchantAllowlist ?? null,   // null = any merchant above minTrust
    minMerchantTrust: p.minMerchantTrust ?? 0.85,
    categories: p.categories ?? null,
    maxFires: p.maxFires ?? 1,
    fires: 0,
    issuedAt: now,
    expiresAt: now + (p.ttlMs ?? 90 * 24 * 3600 * 1000),
    parentMandateId: p.parentMandateId,
    signature: null,
    revokedAt: null
  };
}

/** Replay protection. In production this is Redis with a TTL, not a Set. */
export class NonceCache {
  #seen = new Set();
  check(nonce) { if (this.#seen.has(nonce)) return false; this.#seen.add(nonce); return true; }
}

/**
 * Verify an ES256/RSA device signature over the payload.
 * A client returning `true` from evaluatePolicy is NOT authorization — this is.
 */
export function verifySignature({ payloadStr, signatureB64, devicePublicKeyPem }) {
  if (!signatureB64 || !devicePublicKeyPem) return false;
  try {
    const v = createVerify('SHA256');
    v.update(payloadStr);
    v.end();
    return v.verify(devicePublicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch { return false; }
}

/** Does this cart fall strictly inside a pre-signed envelope? */
export function withinEnvelope(cart, envelope, ctx = {}) {
  const fail = (r) => ({ ok:false, reason:r });
  if (!envelope || envelope.revokedAt) return fail('no_envelope');
  if (envelope.signature == null) return fail('envelope_unsigned');
  if ((ctx.now ?? Date.now()) > envelope.expiresAt) return fail('envelope_expired');
  if (envelope.fires >= envelope.maxFires) return fail('envelope_exhausted');
  if (cart.amountCents > envelope.ceilingCents) return fail('amount_above_ceiling');
  if (envelope.merchantAllowlist && !envelope.merchantAllowlist.includes(cart.merchantId))
    return fail('merchant_not_allowlisted');
  if ((ctx.merchantTrust ?? 0) < envelope.minMerchantTrust) return fail('merchant_trust_too_low');
  if (envelope.categories && ctx.category && !envelope.categories.includes(ctx.category))
    return fail('category_not_in_envelope');
  return { ok:true, reason:'within_envelope' };
}

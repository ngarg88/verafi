import { NextResponse } from 'next/server';
import { requireUser, supabaseAdmin } from '@/lib/supabase';
import { evaluate, authorize, NonceCache, assertPassThrough, makeSavingsEvent, verify } from '@/lib/core';

const nonces = new NonceCache();   // TODO(prod): Redis with a TTL matching mandate expiry

/**
 * POST /api/checkout — the money path.
 * policy gate → signature verification → authorize → attribute savings.
 * A policy ALLOW alone is never sufficient.
 */
export async function POST(req: Request) {
  const { user } = await requireUser();
  const body = await req.json();
  const admin = supabaseAdmin();

  const { data: cart }   = await admin.from('mandates').select('*').eq('id', body.mandateId).eq('user_id', user.id).single();
  const { data: root }   = await admin.from('mandates').select('*').eq('user_id', user.id).eq('type','root').is('revoked_at', null).single();
  const { data: device } = await admin.from('devices').select('*').eq('user_id', user.id).is('invalidated_at', null).order('created_at',{ascending:false}).limit(1).single();
  const { data: inst }   = await admin.from('instruments').select('*').eq('id', cart!.rail_instrument_id).single();
  const { data: merch }  = await admin.from('merchants').select('*').eq('slug', cart!.merchant_slug).single();
  const { data: agent }  = body.agentId
    ? await admin.from('agents').select('*').eq('id', body.agentId).eq('user_id', user.id).single() : { data: null };

  assertPassThrough({ ownedByPlatform: inst!.owned_by_platform });   // invariant 6, every charge

  const { data: run } = await admin.from('runs')
    .insert({ user_id: user.id, agent_id: body.agentId ?? null, intent_text: 'checkout' }).select().single();

  const decision = evaluate(
    { amountCents: cart!.ceiling_cents, category: body.category, merchantId: cart!.merchant_slug,
      railId: inst!.id, unattended: !!body.unattended,
      nonce: cart!.nonce, issuedAt: +new Date(cart!.issued_at), expiresAt: +new Date(cart!.expires_at) },
    { now: Date.now(), mandate: {
        perTxCents: root!.per_tx_cents, dailyCents: root!.daily_cents, monthlyCents: root!.monthly_cents,
        allowedCategories: root!.allowed_categories, blockedCategories: root!.blocked_categories,
        minMerchantTrust: root!.min_merchant_trust, expiresAt: +new Date(root!.expires_at), revokedAt: root!.revoked_at },
      merchantTrust: merch?.trust_score ?? 0.5, merchantSeenBefore: true,
      deviceKnown: !!device, biometricInvalidated: !!device?.invalidated_at,
      lastPresenceAt: device?.last_presence_at ? +new Date(device.last_presence_at) : null,
      spentTodayCents: body.spentTodayCents ?? 0, spentThisMonthCents: body.spentThisMonthCents ?? 0,
      agent, signatureVerified: !!cart!.signature });

  await admin.from('run_steps').insert({ run_id: run!.id, seq: 0, tool: 'policy.evaluate',
    request: { mandateId: cart!.id }, response: decision, decision: decision.decision, reasons: decision.reasons });

  const auth = authorize({
    cart: { ...cart, amountCents: cart!.ceiling_cents, merchantId: cart!.merchant_slug,
            railId: inst!.id, itemHash: cart!.payload_hash, currency: 'USD',
            issuedAt: +new Date(cart!.issued_at), expiresAt: +new Date(cart!.expires_at),
            parentMandateId: cart!.parent_mandate_id, signature: cart!.signature, nonce: cart!.nonce },
    decision, devicePublicKeyPem: device?.public_key_pem, nonceCache: nonces });

  await admin.from('run_steps').insert({ run_id: run!.id, seq: 1, tool: 'psp.authorize',
    request: { rail: inst!.rail, amountCents: cart!.ceiling_cents }, response: auth });

  if (auth.authorized && body.savedCents > 0) {
    const ev = verify(makeSavingsEvent({ id: crypto.randomUUID(), userId: user.id, agentId: body.agentId ?? null,
      method: body.savingsMethod ?? 'coupon_stack', amountCents: body.savedCents,
      evidence: body.evidence ?? { kind: 'price_history', ref: cart!.id } }));
    await admin.from('savings_events').insert({ user_id: user.id, agent_id: body.agentId ?? null, run_id: run!.id,
      method: ev.method, amount_cents: ev.amountCents, recurring_months: ev.recurringMonths,
      evidence: ev.evidence, status: 'verified', verified_at: new Date().toISOString() });
  }

  await admin.from('runs').update({ status: auth.authorized ? 'completed' : 'blocked',
    finished_at: new Date().toISOString() }).eq('id', run!.id);

  return NextResponse.json({ runId: run!.id, decision, authorization: auth });
}

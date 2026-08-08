import { NextResponse } from 'next/server';
import { requireUser, supabaseAdmin } from '@/lib/supabase';
import { deriveSignals, proposeAgents } from '@/lib/core';

/**
 * POST /api/link — exchange a Plaid public token, pull transactions, derive behaviour
 * signals, and PROPOSE agents. Every proposal is written with enabled=false.
 */
export async function POST(req: Request) {
  const { user } = await requireUser();
  const { publicToken } = await req.json();
  const admin = supabaseAdmin();

  // --- Plaid exchange (server-only; the access token never reaches the browser) ---
  const { PlaidApi, Configuration, PlaidEnvironments } = await import('plaid');
  const plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!, 'PLAID-SECRET': process.env.PLAID_SECRET! } }
  }));
  const ex = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = ex.data.access_token;

  const { data: conn } = await admin.from('connections')
    .insert({ user_id: user.id, provider: 'plaid', item_id: ex.data.item_id, scopes: ['transactions','auth','balance'] })
    .select().single();
  await admin.from('connection_secrets').insert({ connection_id: conn!.id, access_token: accessToken });

  // --- pull 18 months ---
  let cursor: string | undefined, added: any[] = [], more = true;
  while (more) {
    const s = await plaid.transactionsSync({ access_token: accessToken, cursor });
    added.push(...s.data.added); cursor = s.data.next_cursor; more = s.data.has_more;
  }
  await admin.from('connection_secrets').update({ cursor }).eq('connection_id', conn!.id);

  const rows = added.map(t => ({
    user_id: user.id, external_id: t.transaction_id,
    merchant_slug: (t.merchant_name ?? t.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
    amount_cents: Math.round(t.amount * 100), posted_at: t.date,
    local_hour: t.datetime ? new Date(t.datetime).getHours() : 13,
    category: t.personal_finance_category?.primary?.toLowerCase() ?? 'other',
    mcc: t.merchant_entity_id ? undefined : undefined,
    is_fee: /fee|overdraft|atm/i.test(t.name ?? ''), raw: t
  }));
  if (rows.length) await admin.from('transactions').upsert(rows, { onConflict: 'user_id,external_id' });

  // --- derive → propose. ALL proposals start disabled. ---
  const signals = deriveSignals(rows.map((r: any) => ({
    merchantId: r.merchant_slug, amountCents: r.amount_cents,
    postedAt: new Date(r.posted_at).getTime(), category: r.category,
    localHour: r.local_hour, isFee: r.is_fee,
    cardRewardMultiplier: 1, bestAvailableMultiplier: 1
  })));
  const proposed = proposeAgents(signals, user.id);

  if (proposed.length) {
    await admin.from('agents').upsert(proposed.map((a: any) => ({
      user_id: user.id, surface: a.surface, name: a.name, capability: a.capability,
      enabled: false, custom: false, evidence: a.evidence, confidence: a.confidence
    })));
  }
  await admin.from('profiles').update({ linked_at: new Date().toISOString() }).eq('id', user.id);

  return NextResponse.json({ linked: true, transactions: rows.length, signals, proposed });
}

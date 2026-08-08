import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/** Insert-only by RLS; nobody can read the list back. */
export async function POST(req: Request) {
  const { email, referrer } = await req.json();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) return NextResponse.json({ error: 'bad email' }, { status: 422 });
  const { data, error } = await supabaseAdmin().from('waitlist')
    .upsert({ email, referrer }, { onConflict: 'email' }).select('ref_code').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, refCode: data.ref_code,
    shareUrl: `https://your-domain.com/?ref=${data.ref_code}` });
}

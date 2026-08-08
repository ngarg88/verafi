import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/** Request-scoped client. Respects RLS — this is what user-facing reads must use. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => store.getAll(),
        setAll: (all) => { try { all.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} }
    }}
  );
}

/**
 * Bypasses RLS. Use ONLY in server code that has already run the policy engine,
 * and only for the tables the client is forbidden to write:
 * mandates, savings_events, run_steps, instruments, connection_secrets.
 */
export function supabaseAdmin() {
  if (typeof window !== 'undefined') throw new Error('admin client must never reach the browser');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } });
}

export async function requireUser() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  return { user, sb };
}

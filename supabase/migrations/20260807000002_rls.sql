-- ============================================================================
-- agentpay · Row Level Security
--
-- READ THIS BEFORE CHANGING ANYTHING HERE.
--
-- Supabase exposes Postgres directly to the browser via the anon key. RLS is not a
-- nice-to-have — it is the ONLY thing standing between one user's bank data and
-- every other user. Default-deny everything, then grant narrowly.
--
-- Three rules we enforce below:
--   1. A user can read only their own rows. Always. No exceptions.
--   2. The client may NEVER write to security-relevant tables: mandates, savings_events,
--      run_steps, instruments, connection_secrets. Those are service_role only, written
--      by server code that ran the policy engine first.
--   3. connection_secrets has NO policy at all — unreachable with the anon key, period.
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.devices             enable row level security;
alter table public.connections         enable row level security;
alter table public.connection_secrets  enable row level security;
alter table public.instruments         enable row level security;
alter table public.transactions        enable row level security;
alter table public.agents              enable row level security;
alter table public.mandates            enable row level security;
alter table public.rules               enable row level security;
alter table public.runs                enable row level security;
alter table public.run_steps           enable row level security;
alter table public.savings_events      enable row level security;
alter table public.forecasts           enable row level security;
alter table public.merchants           enable row level security;
alter table public.offers              enable row level security;
alter table public.price_observations  enable row level security;
alter table public.waitlist            enable row level security;

-- ---------- owner-read ----------
create policy "own profile"        on public.profiles       for select using (auth.uid() = id);
create policy "own profile update" on public.profiles       for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "own devices"        on public.devices        for select using (auth.uid() = user_id);
create policy "own connections"    on public.connections    for select using (auth.uid() = user_id);
create policy "own instruments"    on public.instruments    for select using (auth.uid() = user_id);
create policy "own transactions"   on public.transactions   for select using (auth.uid() = user_id);
create policy "own mandates"       on public.mandates       for select using (auth.uid() = user_id);
create policy "own runs"           on public.runs           for select using (auth.uid() = user_id);
create policy "own savings"        on public.savings_events for select using (auth.uid() = user_id);
create policy "own forecasts"      on public.forecasts      for select using (auth.uid() = user_id);

create policy "own run steps" on public.run_steps for select
  using (exists (select 1 from public.runs r where r.id = run_steps.run_id and r.user_id = auth.uid()));

-- ---------- the only two things a client may write directly ----------
-- Toggling an agent on/off is a preference, not a security decision.
create policy "own agents read"   on public.agents for select using (auth.uid() = user_id);
create policy "own agents insert" on public.agents for insert with check (auth.uid() = user_id and custom = true);
create policy "own agents toggle" on public.agents for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rules read"    on public.rules  for select using (auth.uid() = user_id);
create policy "own rules toggle"  on public.rules  for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- NOTE: rules INSERT is deliberately absent. Creating a rule mints a signed intent
-- mandate; that must go through the server so the ceiling gets clamped to the parent.

-- ---------- public reference data ----------
create policy "merchants readable"   on public.merchants          for select using (true);
create policy "offers readable"      on public.offers             for select using (true);
create policy "prices readable"      on public.price_observations for select using (true);

-- ---------- waitlist: insert-only, never readable ----------
create policy "waitlist signup" on public.waitlist for insert with check (true);
-- deliberately NO select policy. nobody scrapes your list.

-- ---------- connection_secrets: no policy whatsoever ----------
-- RLS is enabled and zero policies exist, so anon/authenticated get nothing.
-- Only service_role (which bypasses RLS) can touch it.

-- ---------- profile bootstrap ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- belt and braces ----------
-- Even with a policy bug, the client role cannot write these tables.
revoke insert, update, delete on public.mandates, public.savings_events,
  public.run_steps, public.runs, public.instruments, public.transactions,
  public.connections, public.connection_secrets, public.devices, public.forecasts
  from anon, authenticated;
revoke all on public.connection_secrets from anon, authenticated;

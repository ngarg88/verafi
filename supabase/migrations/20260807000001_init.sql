-- ============================================================================
-- agentpay · Supabase migration 001
-- Run:  supabase db push       (or paste into the SQL editor)
-- ============================================================================
create extension if not exists "pgcrypto";
create extension if not exists "citext";

create type capability     as enum ('observe','recommend','execute_authorized','execute_preauthorized');
create type surface        as enum ('ask','spend','save');
create type mandate_type   as enum ('root','intent','cart');
create type decision       as enum ('allow','step_up','deny');
create type savings_status as enum ('pending','verified','reversed');
create type rail           as enum ('card_credit','card_debit','ach','stablecoin');

-- profiles hang off Supabase auth.users
create table public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  email            citext not null,
  cash_floor_cents integer not null default 200000,
  linked_at        timestamptz,
  created_at       timestamptz not null default now()
);

create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles on delete cascade,
  public_key_pem   text not null,
  credential_id    text unique,
  platform         text not null,
  attestation      jsonb,
  invalidated_at   timestamptz,
  last_presence_at timestamptz,
  created_at       timestamptz not null default now()
);

create table public.connections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  provider   text not null,
  item_id    text not null,
  scopes     text[] not null default '{}',
  status     text not null default 'active',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Access tokens NEVER live in a table readable by the client.
-- service_role only; no RLS policy grants select to authenticated.
create table public.connection_secrets (
  connection_id uuid primary key references public.connections on delete cascade,
  access_token  text not null,
  cursor        text
);

create table public.instruments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles on delete cascade,
  connection_id     uuid references public.connections on delete set null,
  rail              rail not null,
  display_name      text not null,
  network_token_ref text,
  balance_cents     bigint,
  rewards_by_mcc    jsonb not null default '{"default":1}',
  owned_by_platform boolean not null default false,
  created_at        timestamptz not null default now(),
  -- INVARIANT 6, in the database. we are an initiator, never a transmitter.
  constraint instruments_never_platform_owned check (owned_by_platform = false)
);

create table public.merchants (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  name               text not null,
  trust_score        numeric(3,2) not null default 0.50,
  return_window_days integer,
  knot_supported     boolean not null default false,
  accepted_rails     rail[] not null default '{card_credit}',
  agent_endpoint     text
);

create table public.offers (
  id                     uuid primary key default gen_random_uuid(),
  merchant_id            uuid not null references public.merchants,
  sku                    text not null,
  title                  text,
  price_cents            integer not null,
  list_price_cents       integer,
  agent_only_price_cents integer,
  inventory              integer,
  mcc                    integer,
  return_window_days     integer,
  accepted_rails         rail[] not null default '{card_credit}',
  observed_at            timestamptz not null default now(),
  expires_at             timestamptz
);
create index on public.offers (sku, price_cents);

create table public.price_observations (
  id          bigserial primary key,
  sku         text not null,
  merchant_id uuid references public.merchants,
  price_cents integer not null,
  observed_at timestamptz not null default now()
);
create index on public.price_observations (sku, observed_at desc);

create table public.transactions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles on delete cascade,
  instrument_id             uuid references public.instruments on delete set null,
  merchant_slug             text,
  external_id               text not null,
  amount_cents              bigint not null,
  posted_at                 timestamptz not null,
  local_hour                smallint,
  category                  text,
  mcc                       integer,
  is_fee                    boolean not null default false,
  is_recurring              boolean not null default false,
  agent_initiated           boolean not null default false,
  card_reward_multiplier    numeric(4,2),
  best_available_multiplier numeric(4,2),
  raw                       jsonb,
  unique (user_id, external_id)
);
create index on public.transactions (user_id, posted_at desc);

create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles on delete cascade,
  surface       surface not null,
  name          text not null,
  capability    capability not null,
  enabled       boolean not null default false,
  custom        boolean not null default false,
  evidence      text,
  confidence    numeric(3,2),
  ceiling_cents integer,
  created_at    timestamptz not null default now(),
  -- an agent that cannot say what it learned is a generic preset, and worth nothing
  constraint agents_must_cite_evidence check (evidence is not null and length(evidence) > 10)
);

create table public.mandates (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles on delete cascade,
  parent_mandate_id  uuid references public.mandates,
  type               mandate_type not null,
  device_id          uuid references public.devices,
  per_tx_cents       integer, daily_cents integer, monthly_cents integer,
  ceiling_cents      integer,
  merchant_allowlist text[],
  min_merchant_trust numeric(3,2) default 0.85,
  allowed_categories text[], blocked_categories text[],
  max_fires          integer default 1,
  fires              integer not null default 0,
  payload_hash       text,
  signature          text,
  nonce              text unique,
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz
);
create index on public.mandates (user_id, type, revoked_at);

create table public.rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles on delete cascade,
  agent_id          uuid references public.agents on delete cascade,
  intent_mandate_id uuid references public.mandates,
  name              text not null,
  trigger_type      text not null,
  trigger_config    jsonb not null,
  enabled           boolean not null default false,
  runs              integer not null default 0,
  created_at        timestamptz not null default now()
);

create table public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  agent_id    uuid references public.agents,
  rule_id     uuid references public.rules,
  intent_text text,
  status      text not null default 'running',
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table public.run_steps (
  id         bigserial primary key,
  run_id     uuid not null references public.runs on delete cascade,
  seq        integer not null,
  tool       text not null,
  request    jsonb, response jsonb,
  decision   decision, reasons text[],
  latency_ms integer,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create table public.savings_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles on delete cascade,
  agent_id         uuid references public.agents,
  run_id           uuid references public.runs,
  method           text not null,
  amount_cents     integer not null check (amount_cents > 0),
  recurring_months integer not null default 0,
  evidence         jsonb not null,
  status           savings_status not null default 'pending',
  created_at       timestamptz not null default now(),
  verified_at      timestamptz,
  -- no evidence, no claim
  constraint savings_needs_evidence check (jsonb_typeof(evidence) = 'object' and evidence <> '{}'::jsonb)
);
create index on public.savings_events (user_id, status, created_at desc);

create table public.forecasts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles on delete cascade,
  month           date not null,
  projected_cents integer not null,
  band_low_cents  integer not null,
  band_high_cents integer not null,
  actual_cents    integer,
  created_at      timestamptz not null default now(),
  unique (user_id, month)
);

create table public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      citext unique not null,
  referrer   text,
  ref_code   text unique default encode(gen_random_bytes(4),'hex'),
  invited_at timestamptz,
  created_at timestamptz not null default now()
);

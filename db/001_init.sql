-- agentpay · initial schema
-- Design notes that are expensive to retrofit, so they are here from day one:
--   1. every agent action writes an immutable run + run_steps trace
--   2. savings_events carry method + evidence + verified_at, never a bare number
--   3. merchants/offers are shaped for a two-sided marketplace we will not build until 2027
--   4. NO balances table. We are a payment initiator, not a transmitter.

CREATE TYPE capability     AS ENUM ('observe','recommend','execute_authorized','execute_preauthorized');
CREATE TYPE surface        AS ENUM ('ask','spend','save');
CREATE TYPE mandate_type   AS ENUM ('root','intent','cart');
CREATE TYPE decision       AS ENUM ('allow','step_up','deny');
CREATE TYPE savings_status AS ENUM ('pending','verified','reversed');
CREATE TYPE rail           AS ENUM ('card_credit','card_debit','ach','stablecoin');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cash_floor_cents integer NOT NULL DEFAULT 200000
);

-- Hardware-backed key per device. Private key never leaves the secure element.
CREATE TABLE devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  public_key_pem text NOT NULL,
  attestation    jsonb,
  platform       text NOT NULL,
  invalidated_at timestamptz,          -- set when the OS destroys the key on biometric re-enrollment
  last_presence_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider    text NOT NULL,                    -- plaid | knot | gmail | wallet_connect
  item_id     text NOT NULL,
  scopes      text[] NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Instruments are the USER'S accounts. ownedByPlatform is always false; the column
-- exists so the invariant is checkable in SQL, not just in code.
CREATE TABLE instruments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  connection_id      uuid REFERENCES connections ON DELETE SET NULL,
  rail               rail NOT NULL,
  display_name       text NOT NULL,
  network_token_ref  text,                      -- never a PAN. we are not PCI L1 and will stay that way.
  balance_cents      bigint,                    -- read-only mirror, refreshed from Plaid
  rewards_by_mcc     jsonb NOT NULL DEFAULT '{"default":1}',
  owned_by_platform  boolean NOT NULL DEFAULT false CHECK (owned_by_platform = false),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  trust_score     numeric(3,2) NOT NULL DEFAULT 0.50,
  return_window_days integer,
  knot_supported  boolean NOT NULL DEFAULT false,
  accepted_rails  rail[] NOT NULL DEFAULT '{card_credit}',
  agent_endpoint  text                          -- 2027: where this merchant receives RFQs
);

-- Built now so the marketplace is not a six-month retrofit later.
CREATE TABLE offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       uuid NOT NULL REFERENCES merchants,
  sku               text NOT NULL,
  price_cents       integer NOT NULL,
  agent_only_price_cents integer,
  inventory         integer,
  ship_by           date,
  return_window_days integer,
  accepted_rails    rail[] NOT NULL DEFAULT '{card_credit}',
  observed_at       timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz
);

-- Your proprietary corpus. Nobody sells you a good one; start collecting on day one.
CREATE TABLE price_observations (
  sku          text NOT NULL,
  merchant_id  uuid NOT NULL REFERENCES merchants,
  price_cents  integer NOT NULL,
  observed_at  timestamptz NOT NULL DEFAULT now()
);
SELECT create_hypertable('price_observations','observed_at', if_not_exists => TRUE);
CREATE INDEX ON price_observations (sku, observed_at DESC);

CREATE TABLE transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  instrument_id      uuid REFERENCES instruments ON DELETE SET NULL,
  merchant_id        uuid REFERENCES merchants,
  external_id        text NOT NULL,
  amount_cents       bigint NOT NULL,
  posted_at          timestamptz NOT NULL,
  local_hour         smallint,
  category           text,
  mcc                integer,
  is_fee             boolean NOT NULL DEFAULT false,
  is_recurring       boolean NOT NULL DEFAULT false,
  agent_initiated    boolean NOT NULL DEFAULT false,
  card_reward_multiplier    numeric(4,2),
  best_available_multiplier numeric(4,2),
  raw                jsonb,
  UNIQUE (user_id, external_id)
);
CREATE INDEX ON transactions (user_id, posted_at DESC);

-- Presets and user-built agents are the same row. Presets are ones we ship with.
CREATE TABLE agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  surface        surface NOT NULL,
  name           text NOT NULL,
  capability     capability NOT NULL,
  enabled        boolean NOT NULL DEFAULT false,   -- proposed agents ALWAYS start off
  custom         boolean NOT NULL DEFAULT false,
  evidence       text,                             -- must cite what it learned
  confidence     numeric(3,2),
  ceiling_cents  integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mandates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  parent_mandate_id   uuid REFERENCES mandates,
  type                mandate_type NOT NULL,
  device_id           uuid REFERENCES devices,
  per_tx_cents        integer, daily_cents integer, monthly_cents integer,
  ceiling_cents       integer,
  merchant_allowlist  text[],
  min_merchant_trust  numeric(3,2) DEFAULT 0.85,
  allowed_categories  text[], blocked_categories text[],
  max_fires           integer DEFAULT 1,
  fires               integer NOT NULL DEFAULT 0,
  payload_hash        text,
  signature           text,                        -- ES256 over the canonical payload
  nonce               text UNIQUE,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz
);
CREATE INDEX ON mandates (user_id, type, revoked_at);

CREATE TABLE rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  agent_id          uuid REFERENCES agents ON DELETE CASCADE,
  intent_mandate_id uuid REFERENCES mandates,       -- the pre-signed envelope. no envelope, no unattended run.
  name              text NOT NULL,
  trigger_type      text NOT NULL,                  -- price_below | schedule | inventory_restock | balance_below | stock_depleted
  trigger_config    jsonb NOT NULL,
  enabled           boolean NOT NULL DEFAULT false,
  runs              integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Full replayable trace. Audit log, debugger, dispute evidence and training data in one table.
CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  agent_id     uuid REFERENCES agents,
  rule_id      uuid REFERENCES rules,
  intent_text  text,
  status       text NOT NULL DEFAULT 'running',
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE TABLE run_steps (
  id          bigserial PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES runs ON DELETE CASCADE,
  seq         integer NOT NULL,
  tool        text NOT NULL,
  request     jsonb,
  response    jsonb,
  decision    decision,
  reasons     text[],
  latency_ms  integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE TABLE savings_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  agent_id         uuid REFERENCES agents,
  run_id           uuid REFERENCES runs,
  method           text NOT NULL,
  amount_cents     integer NOT NULL CHECK (amount_cents > 0),
  recurring_months integer NOT NULL DEFAULT 0,
  evidence         jsonb NOT NULL,                 -- no evidence, no claim
  status           savings_status NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  verified_at      timestamptz
);
CREATE INDEX ON savings_events (user_id, status, created_at DESC);

CREATE TABLE forecasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  month         date NOT NULL,
  projected_cents integer NOT NULL,
  band_low_cents  integer NOT NULL,
  band_high_cents integer NOT NULL,
  actual_cents    integer,                         -- reconcile monthly or don't ship a forecast
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

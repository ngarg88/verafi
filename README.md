# agentpay — MVP backend

Working code, not a scaffold. `npm test` passes 23 unit tests; `npm run smoke` passes 34
end-to-end checks against a live server. Zero dependencies — runs on Node 22 as-is.

```bash
node --version          # needs >= 22
npm test                # 23 unit tests, incl. every safety invariant
npm run dev             # api on :8787, clickable prototype at /
npm run smoke           # 34 end-to-end checks (run in a second terminal)
```

Open <http://localhost:8787> for the prototype; the API is at `/v1/*`.

---

## What's here

```
packages/core/          zero-dep domain logic — the part that is expensive to get wrong
  capabilities.js       the capability ladder. an agent is an object, not a personality.
  mandate.js            cart + intent mandates, canonical payload, signature verification
  policy.js             THE deterministic gate. no LLM output reaches it.
  rails.js              pass-through rail routing + the no-custody invariant
  savings.js            attribution with evidence, forecasting with confidence bands
  presets.js            behaviour signals → proposed agents that cite what they learned
  test/                 23 tests. the invariant suite is the important one.

apps/api/               node:http server, in-memory repo, seeded demo user
apps/web/public/        the clickable prototype, served at /
db/001_init.sql         production Postgres schema
```

## The six invariants the test suite enforces

These are the ones that end the company if they break. Each has a test that fails loudly.

1. **No payment without a verified signature.** A policy `ALLOW` is not sufficient —
   `authorize()` re-checks the cryptography every time.
2. **The signature is bound to the exact cart.** Tamper with the amount after signing
   and verification fails. It signs a transaction, never a boolean.
3. **Signatures cannot be replayed.** Nonce cache, checked on every authorization.
4. **Blocked categories are a hard deny.** No prompt is offered. A user cannot
   biometric past their own blocklist in a moment of weakness — that's the point of it.
5. **A rule can never widen its parent mandate.** `min(rule.ceiling, mandate.perTx)` wins,
   enforced in `policy.evaluate` and clamped again at envelope creation.
6. **Settlement never lands in a platform-owned account.** `assertPassThrough()` runs on
   every checkout and the DB has `CHECK (owned_by_platform = false)`. This is what keeps
   you a payment initiator rather than a money transmitter.

## Two design decisions worth defending in a review

**An agent is an object with a capability level, not a personality.**
`observe → recommend → execute_authorized → execute_preauthorized`. Preset agents and
user-built agents are the same row; presets are ones you ship with. This is why "let
users build agents" is a form, not a feature.

**Unattended execution is still authorized.** A rule that fires at 3am presents a
pre-signed *intent mandate* — the user biometrically signed its ceiling, merchant
allowlist, fire count and expiry in advance. One cent outside the envelope and it
step-ups. That's how "always requires authorization" and "works while you sleep" are
both true.

## API

```
POST /v1/connections/plaid     link → derive signals → propose agents (all start disabled)
GET  /v1/agents?surface=       list; POST /v1/agents to create (evidence REQUIRED, 422 without)
POST /v1/agents/toggle
GET  /v1/spend/summary         enriched totals + behavioural signals
GET  /v1/spend/forecast        12 months with confidence bands and ramped interventions
GET  /v1/save/summary          verified savings only; pending counts as zero
POST /v1/policy/evaluate       dry-run the gate. returns decision + reasons + chosen rail.
POST /v1/mandates/cart         issue an unsigned cart + the payload hash to sign on-device
POST /v1/mandates/intent       issue a pre-auth envelope (auto-clamped to the root mandate)
POST /v1/checkout              policy → signature verify → authorize → attribute savings
GET  /v1/runs, /v1/audit       full replayable trace of every decision and reason
POST /v1/dev/sign              DEV ONLY — signs server-side so you can exercise the flow
```

## Going to production — in order

1. **Delete `/v1/dev/sign`.** Replace with real WebAuthn: P-256 keypair in the Secure
   Enclave / StrongBox, `setInvalidatedByBiometricEnrollment(true)`, passcode fallback
   allowed. The server only ever verifies against `devices.public_key_pem`.
2. **Swap `apps/api/repo.js` for Postgres** using `db/001_init.sql`. Nothing above that
   file knows the difference — that's the whole point of the interface.
3. **Replace the seed with real Plaid.** `deriveSignals()` already takes the exact
   transaction shape Plaid Enrich returns.
4. **Add the catalog + price corpus.** `price_observations` is a hypertable because you
   will collect this forever and nobody will sell you a good one.
5. **Move `NonceCache` to Redis** with a TTL matching mandate expiry.
6. **Pen-test the agent loop specifically.** Merchant page content is hostile input; it
   must never reach the policy engine.

## Deliberately NOT here

Held balances, a top-up endpoint, or anything that credits a platform account. If
`topup`, `hold`, or `balance.credit` ever appear in this codebase, the compliance posture
has silently changed and someone needs to notice.

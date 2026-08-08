# Verafi — personal edition

Built for one person: you. No accounts, no cloud, no other people's data to protect.
Your transactions live in `verafi/data/verafi.json` on your own machine.

```bash
node --version            # needs >= 22
node verafi/server.js
```

```
  Verafi (personal)  ·  sandbox mode
  this machine   http://localhost:8788
  your phone     http://192.168.1.24:8788   ← same wifi, add to home screen
```

On your phone: open that address in Safari → Share → **Add to Home Screen**. It runs
full-screen like a native app, no App Store, no signing, no review.

---

## Two ways to get your data in

### 1 · CSV / OFX import — no third party at all
Export from online banking (every US bank offers "Download transactions"), then drag the
file onto the app. Nobody sees your credentials, it costs nothing, and it works today.

Try it right now without a bank:
```
verafi/sample/sample-statement.csv     # 339 transactions, 18 months
```
That file produces **$4,049/yr of findings** — two dormant subscriptions, $245 of avoidable
fees, and three agents proposed with evidence.

**Limitation, and it's real:** CSV exports carry a date but no time, so anything that
depends on time-of-day (late-night ordering patterns) can't be computed. Plaid gives you
`datetime`. That's the honest trade.

### 2 · Plaid — live, refreshes itself
```bash
cp verafi/.env.example verafi/.env    # add PLAID_CLIENT_ID and PLAID_SECRET
```
- `PLAID_ENV=sandbox` — fake banks, works instantly (`user_good` / `pass_good`)
- `PLAID_ENV=production` — **your real accounts.** Since April 2026, new signups get a
  **Trial plan**: auto-approved for most developers, real production data, up to 10 Items.
  For one person that's plenty, and there's no review queue to wait on.

---

## What it does

**Find** — every opportunity ranked by annual value, each citing what it saw in your data.
**Spend** — 30-day totals, categories, top merchants, and a 12-month forecast with an
honest confidence band. The wide part of the band is the bit that needs *you* to change.
**Save** — a ledger of what you've actually banked. Pending savings count as **zero** until
you confirm you did the thing. That rule is what makes the number mean anything.

Agents are proposed, never switched on for you. Each cites its evidence — *"2 subscriptions
unused for 30+ days right now"* — and starts disabled.

---

## Privacy, concretely

- Everything is on your machine. `data/` and `.env` are gitignored.
- Outbound network: Plaid only, and only if you configure it. CSV mode makes zero calls.
- `HOST=0.0.0.0` lets your phone reach it on your LAN. Set `HOST=127.0.0.1` for laptop-only.
- **There is no auth.** Anyone on your wifi who finds the port can read it. That's an
  acceptable trade for a personal tool on a home network — it is *not* acceptable the
  moment a second person uses this. Add auth before you show anyone.

## Files
```
server.js       routes + wiring
store.js        atomic json persistence
plaid.js        Plaid REST over fetch (no SDK, no npm install)
importers.js    CSV / OFX parsing, merchant normalisation, categorisation
public/         the PWA
sample/         339-transaction sample statement
```

Domain logic lives in `../packages/core` — the same tested code the production build uses.

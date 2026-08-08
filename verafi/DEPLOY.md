# Running Verafi for real

## Do you need Vercel, GitHub and Supabase?

**No — none of them are required.** Here's the honest read:

| | Need it? | Why |
|---|---|---|
| **Vercel** | **No** | It's serverless: functions wake for a request and die. Your agents need a process that *stays alive* to run on a schedule. Wrong shape for this. |
| **Supabase** | **No** | Postgres + auth + row-level security solve *multi-user* problems. You have one user and a JSON file. Adding a database for one person is a rewrite that buys nothing. |
| **GitHub** | **Not required — but do it** | Not for deploying. For backup and history. Free private repo, five minutes. If your laptop dies, this is all gone otherwise. |

They all become right answers the day a second person logs in. Not before.

---

## Option A · keep it local (start here)

Leave your computer on, double-click `START-VERAFI.bat`, done. Agents run every 24 hours
while the window is open.

**Good:** nothing leaves your machine, zero cost, zero setup.
**Bad:** laptop asleep = no agents. Fine for a first month of testing.

---

## Option B · deploy it (always on, ~$3/mo)

**Fly.io** runs the exact code you already have. No rewrite, no database, no framework.

```bash
# once
brew install flyctl          # or: iwr https://fly.io/install.ps1 -useb | iex
fly auth signup

cd agentpay
fly launch --no-deploy       # accept the app name; it reads fly.toml
fly volumes create verafi_data --size 1

# secrets — never in the repo
fly secrets set APP_PASSCODE="pick-something-long"
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
fly secrets set PLAID_CLIENT_ID="..." PLAID_SECRET="..." PLAID_ENV="production"
fly secrets set PUBLIC_URL="https://YOURAPP.fly.dev"
fly secrets set NTFY_TOPIC="verafi-$(openssl rand -hex 6)"

fly deploy
fly open
```

That's it. HTTPS, a real URL, always-on, agents firing daily, notifications to your phone.

**`APP_PASSCODE` is not optional once this is on the internet.** The app will start without
it and warn you loudly. Don't ignore that warning — it's your entire financial life on a
public URL.

Alternatives that work identically: **Railway**, **Render**, a **$5 Hetzner/DigitalOcean
box**. Anything that runs a long-lived Node process with a persistent disk.

---

## Notifications — pick one, takes 2 minutes

| | Setup | Notes |
|---|---|---|
| **ntfy** ← easiest | Install the ntfy app, invent an unguessable topic, set `NTFY_TOPIC` | No signup at all. Anyone who guesses your topic sees your alerts, so make it random. |
| **Telegram** | Message `@BotFather` → new bot → set `TELEGRAM_BOT_TOKEN`; message your bot once, then get the chat id | Private, rich formatting |
| **Email (Resend)** | Free key at resend.com → `RESEND_API_KEY` + `NOTIFY_EMAIL` | 100/day free |

---

## The agents that run

All five are `observe`/`recommend` — **nothing in this app spends money.** That stays behind
the policy engine and a biometric, which is a different build.

| Agent | What it does | Fires when |
|---|---|---|
| **Subscription Auditor** | Finds things still billing you that you stopped using | A charge cadence continues past ~1.8× its normal gap with no usage |
| **Fee Catcher** | Overdraft, ATM and FX fees worth disputing | Any new fee transaction |
| **Duplicate Watch** | Same merchant, same amount, within 3 days | Possible double-charge |
| **Budget Pacer** | A category on pace to overrun your normal | Past the 25% mark of a month and tracking >30% above your 90-day average |
| **Card Router** | Which of your cards earns most where | You spent >$200 in a category where a card you hold pays more |

Switch them on in the app. They dedupe — you're told about a finding once, not daily.

**Card Router needs a small setup step:** CSV imports don't say which card was used, so tell
the app which card is which via `POST /api/instruments/card` with a `cardKey` matching
`CARD_RULES` in `server.js`. Edit those rules to your actual cards.

---

## Integrations, honestly ranked

**1 · Plaid — do this one.** Turns a manual CSV chore into something that refreshes itself
daily. New signups get a **Trial plan**: auto-approved, real bank data, ~10 accounts, no
review queue. This is the single highest-value integration.

**2 · A notification channel.** An agent that finds something you never see is worth zero.

**3 · Gmail receipt parsing** — later. Order details, warranty windows and price-protection
deadlines that no bank feed has. Genuinely differentiated, but a bigger build.

**4 · Knot** — sales-led, business entity required. It's what would let the app *cancel*
rather than tell you to. Not available to a personal project, and honestly: you cancelling
it yourself after the app finds it is 100% of the value.

---

## When you outgrow this

The day a second person logs in, the JSON file and the single passcode both stop being
acceptable. That's the day for Supabase (Postgres + RLS), Vercel, and real auth — all of
which are already scaffolded in `web/` and `supabase/`. Not before.

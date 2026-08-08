# Ship by August 31 — what's actually possible

Written Aug 7. You have **24 days.**

---

## The honest answer on the App Store

**You will not be live on the App Store by Aug 31.** Not because of code — because of
three queues you don't control:

| Blocker | Typical time | Can you compress it? |
|---|---|---|
| **Apple Developer Program, organization** — needs a **D-U-N-S number** | 1–3 weeks (D-U-N-S alone can be 5–14 days) | Enroll as an **individual** in ~48h and transfer later |
| **Plaid production access** — an application review, not a toggle | 1–3 weeks; they ask about entity, security, use case | No. Start it **today**. |
| **App Store review, finance category** | 1–7 days, and finance apps that touch bank data draw extra scrutiny under 3.2.1 | Partly — a clean privacy policy, support URL and demo account help a lot |

Anyone who tells you a bank-linked finance app goes from zero to App Store in 24 days
has not shipped one.

**What you CAN do by Aug 31, and it's better anyway:**

| Target | Date | Why it works |
|---|---|---|
| **Web app live on Vercel** | **Aug 18** | No gatekeeper. Installable to the iOS home screen as a PWA. |
| **1,000 users on the web app** | **Aug 31** | Achievable. This is where your users actually come from. |
| **TestFlight build in testers' hands** | **Aug 28** | Real iOS app, real Face ID, up to 10,000 external testers |
| **App Store submission** | **Sep 2** | Live ~Sep 8–12 |

Ship the web app. Get the 1,000 users there. The App Store becomes a distribution
upgrade in September rather than a blocker in August.

---

## Stack — and why

| Layer | Choice | Reason |
|---|---|---|
| DB + auth | **Supabase** | Postgres you already have a schema for, plus auth and RLS. One less service. |
| Web | **Next.js on Vercel** | API routes and the client in one deploy. `packages/core` drops in unchanged. |
| iOS | **Expo + EAS** | EAS handles signing and TestFlight submission — the part that eats days otherwise. |
| Bank data | **Plaid** | Sandbox today, production application submitted today |
| Merchant actions | **Knot** | Sales-led. Get the coverage list under NDA before promising cancellations. |

**The one thing to get right on day one: Row Level Security.** Supabase exposes Postgres
to the browser. RLS is the only thing between one user's bank data and everyone else's.
`supabase/migrations/…_rls.sql` is default-deny, and `connection_secrets` has **zero
policies** so Plaid access tokens are unreachable with the anon key. Do not weaken it to
unblock yourself — write a server route instead.

---

## Week by week

### Week 1 · Aug 7–13 — unblock the queues, then build
**Day 1, before any code:**
- [ ] Apply for **Plaid production access**. Longest lead time you control. Today.
- [ ] Enroll in **Apple Developer as an individual** ($99, ~48h). Start the D-U-N-S in parallel.
- [ ] Register the entity if you haven't (Stripe Atlas or a local lawyer, ~1 week).
- [ ] Buy the domain. Trademark clearance on your 3 finalists.

**Then:**
- [ ] `supabase init`, push all three migrations, verify RLS with a second test account
- [ ] Next.js app on Vercel, Supabase auth (magic link — no password reset flow to build)
- [ ] Plaid Link in sandbox → `/api/link` → signals → proposed agents
- [ ] Spend tab: real transactions, real categories

**Ship gate:** you can log in, link a sandbox bank, and see your own agents proposed with evidence.

### Week 2 · Aug 14–20 — the product people pay for
- [ ] Save tab: subscription audit, card routing, verified savings ledger
- [ ] Ask tab at `recommend` level — search, compare, hand off to the merchant. **No checkout.**
- [ ] Waitlist + referral codes (the table is already in the migration)
- [ ] Privacy policy, terms, support page. Required by both Apple and Plaid.
- [ ] **Aug 18: web app public.**

**Ship gate:** a stranger connects a real bank and sees a real dollar number in under 90 seconds.

### Week 3 · Aug 21–27 — iOS + distribution
- [ ] Expo app: the same three tabs against the same API
- [ ] Face ID enrollment + mandate signing (`mobile/lib/biometric.ts`)
- [ ] `eas build --profile preview` → TestFlight internal
- [ ] App Store Connect listing: screenshots, description, demo account for review
- [ ] Launch pushes (see channels below)

### Week 4 · Aug 28–31 — push to 1,000
- [ ] TestFlight external testers
- [ ] Referral loop live
- [ ] Daily: watch connect-rate and verified-savings-per-user. Those two numbers decide everything.
- [ ] **Sep 2: submit to App Store.**

---

## Getting to 1,000 users

Blunt version: **1,000 users in 24 days is achievable, but only with a share-shaped hook.**
Paid acquisition at $80–200 CAC would cost you $80k–200k. You don't buy this — you earn it.

**The hook is one screenshot: "agentpay found $1,840/year I was wasting."**
Everything below is a way of putting that screenshot somewhere.

| Channel | Realistic yield | Effort | Notes |
|---|---|---|---|
| Personal network + warm intros | 50–150 | Low | Do this first. Also your best interview pool. |
| **Build in public on X/LinkedIn** | 100–400 | Daily, 3 wks | Post the savings number, the agent evidence lines, the RLS work. Fintech founders repost this. |
| **Product Hunt** | 200–600 | 1 week prep | Launch Tue–Thu. Needs assets ready 5 days early. Top-5 day gets you 400+. |
| **Reddit** — r/personalfinance, r/frugal, r/ynab | 100–300 | Medium | **Read each sub's self-promo rules first.** Value post, not a launch post. r/churning will destroy you if you spam. |
| **TikTok / Reels** — "AI found $X of waste in my bank account" | 0–2,000 | High variance | The only channel with real upside. One video does it or none do. |
| Hacker News (Show HN) | 50–300 | Low | Weekday morning ET. Expect hard questions about RLS and custody — you have good answers. |
| Referral loop (built in) | 15–25% lift | Already built | "Give a friend a free month, get one" |

**Realistic composite: 700–1,400.** The variance is almost entirely TikTok.

**Two things that will kill your funnel, in order:**
1. **Bank-connect drop-off.** Expect to lose 50–65% at the Plaid screen. Show the value
   *before* asking — a demo account, a sample report, anything. Measure install→connect
   daily; if it's under 35%, nothing else matters.
2. **Sandbox data.** If Plaid production hasn't landed, users connecting real banks see
   nothing. This is why you apply on day one.

**Measure only these:**
- install → bank connected (target ≥35%)
- **verified** savings per user per month (target ≥$40 median)
- savings realized / savings surfaced
- day-7 return rate

---

## What to cut when you fall behind — and you will

Cut in this order, without negotiating with yourself:

1. **Ask tab.** Spend + Save alone is a complete product. Rocket Money sold for ~$1.3B on less.
2. **The custom agent builder.** Presets that cite evidence are the magic; the builder is a form.
3. **Forecasting.** Nice, not load-bearing.
4. **iOS.** The web app is the product this month.

**Never cut:** RLS, the policy engine, savings evidence, or the audit trail. Those are the
things you cannot retrofit and the things that end you if they're wrong.

---

## Legal minimum before a stranger connects a bank

Not optional, and all of it is week 1–2:

- [ ] Entity formed, so you can sign the Plaid production agreement
- [ ] Privacy policy + terms (GLBA/Reg P applies to financial data)
- [ ] Support email and URL — Apple and Plaid both require them
- [ ] Explicit consent screen per data scope, and one-tap revocation that actually revokes
- [ ] Counsel scoping call: **initiator-not-transmitter** posture, and acting-on-behalf for
      cancellations. You are not holding funds, which is exactly why this is a short call.
- [ ] Incident plan. If you leak bank data on day 30, there is no day 31.

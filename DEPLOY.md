# Deploy runbook

Zero to live. Every command, in order.

## 0 · Accounts (do these first, they have queues)
```
Plaid       dashboard.plaid.com          → apply for PRODUCTION access on day 1
Apple       developer.apple.com          → enroll (individual = ~48h, org needs D-U-N-S)
Supabase    supabase.com                 → new project, pick a region near your users
Vercel      vercel.com                   → connect your GitHub repo
Expo        expo.dev                     → for EAS build + TestFlight submission
```

## 1 · Database
```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_REF
supabase db push                      # runs all three migrations in order
```
Verify RLS actually works before writing another line:
```sql
-- as user A, in the SQL editor with the anon role
select * from transactions;           -- must return ONLY user A's rows
select * from connection_secrets;     -- must return ZERO rows, always
```
If `connection_secrets` returns anything, stop and fix it before continuing.

## 2 · Web
```bash
cd web
cp .env.example .env.local            # fill in Supabase + Plaid
npm install
npm run dev                           # http://localhost:3000
vercel                                # preview
vercel --prod                         # live
```
Set the same env vars in Vercel → Settings → Environment Variables.
`SUPABASE_SERVICE_ROLE_KEY` must **not** be prefixed `NEXT_PUBLIC_`.

## 3 · Domain
Vercel → Domains → add yours. Vercel issues the TLS cert automatically.

## 4 · iOS
```bash
cd mobile
npm install
npm i -g eas-cli && eas login
eas build:configure
# edit app.json: bundleIdentifier → com.YOURORG.agentpay
# edit eas.json: appleId, ascAppId, appleTeamId
eas build --platform ios --profile preview     # ~15 min, cloud build
eas submit --platform ios                      # → TestFlight
```

## 5 · Before you submit to review
- [ ] Privacy policy + support URL live and reachable
- [ ] App Privacy questionnaire filled in App Store Connect (financial data = declare it)
- [ ] **Demo account with seeded data** in App Review notes — reviewers cannot link a real
      bank, and "can't test it" is the most common finance-app rejection
- [ ] Face ID usage string is human ("Face ID signs each purchase you approve")
- [ ] `usesNonExemptEncryption: false` set (already in app.json)

## 6 · Day-one monitoring
```
Vercel Analytics    traffic + funnel
Supabase logs       RLS denials — a spike means a bug, investigate immediately
Sentry              free tier is fine
One SQL query       install → connect rate, checked daily
```
```sql
select
  count(*) filter (where linked_at is not null)::float / nullif(count(*),0) as connect_rate,
  count(*) as signups
from profiles where created_at > now() - interval '7 days';
```

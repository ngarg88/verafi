# Running Verafi for free

Fly's free tier is gone. It was removed for new signups in 2024 — new accounts get a
7-day / 2-VM-hour trial and then pay-as-you-go, roughly **$2–5/mo** minimum. Fine, but
not free.

Two options that genuinely cost nothing.

---

## Option 1 · Your own PC — free, most private, recommended first

The app already runs on your machine. This just makes it start on its own and stay up.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-service.ps1
```

Registers Verafi as a scheduled task that starts when you log in and restarts itself if it
crashes. Agents fire every 24 hours in the background.

```
Open        http://localhost:8788
Stop        schtasks /End /TN Verafi
Remove      schtasks /Delete /TN Verafi /F
```

**Cost:** $0. **Privacy:** your bank data never leaves the house.
**Catch:** PC off or asleep = agents don't run. For a daily job that's usually fine —
you're not missing much if it runs at 9am instead of 3am.

### Reaching it from your phone, anywhere — still free

`http://192.168.x.x:8788` works on your home wifi. For access from outside, **don't**
forward a port. Use a Cloudflare Tunnel — free, gives you real HTTPS, and opens nothing
on your router:

```powershell
winget install cloudflare.cloudflared
cloudflared tunnel login                     # needs a domain on Cloudflare (~$10/yr)
cloudflared tunnel create verafi
cloudflared tunnel route dns verafi verafi.yourdomain.com
cloudflared tunnel run --url http://localhost:8788 verafi
```

No domain? `cloudflared tunnel --url http://localhost:8788` gives you a random
`*.trycloudflare.com` URL instantly, no account, no cost. It changes on every restart —
fine for testing, annoying long-term.

**Set `APP_PASSCODE` before you tunnel anything.** A tunnel is the public internet.

---

## Option 2 · Oracle Cloud Always Free — free forever, always on

Oracle still gives away a permanent ARM VM. It's the only real "free forever" always-on
option left.

**Current allowance: 2 OCPU / 12 GB RAM** — Oracle quietly halved this from 4/24 in June
2026, and starts **terminating instances that exceed it on August 18, 2026**. Provision at
or under 2 OCPU / 12 GB and you're fine. Verafi needs about 100 MB, so this is enormous
headroom either way. You also get 200 GB of block storage.

1. Sign up at `cloud.oracle.com` → **Always Free** (a card is required for identity
   verification; it isn't charged)
2. Create a Compute instance: **Ampere A1 Flex**, Ubuntu 22.04, **2 OCPU / 12 GB**
3. Copy this folder to it and run:

```bash
bash deploy-oracle.sh
```

That installs Node, writes a systemd service that restarts on failure and survives reboots,
opens the port, and installs cloudflared for HTTPS.

**Cost:** $0 forever. **Catch:** Oracle's console is unpleasant, capacity for free ARM
instances is sometimes unavailable in a region (retry, or pick another region), and
"free forever" clearly ships with fine print — they changed the limits once with no
announcement, so they can do it again.

---

## What I'd actually do

**Start with Option 1 this week.** Your PC, zero setup, zero cost, data stays home. Run it
against your real statements and find out whether the number it produces is worth anything.

**Move to Oracle only if you find yourself wanting it always-on** — genuinely useful once
Plaid is wired up and you want the daily sync happening whether or not your laptop is open.

**Pay for Fly ($2–5/mo) only if Oracle's console defeats you**, which is a real possibility
and not a character flaw. `deploy.ps1` is already there if you want the easy path.

---

## Bank data, free

**Plaid is already free for what you're doing.** Since April 2026 new US/Canada signups get
a **Trial plan** — free, real production data, no credit card, and access to most OAuth
institutions including Chase, Bank of America and Wells Fargo before full Production
approval. The cap is **10 Production Items**, which is 10 linked accounts. For one person
that's not a limitation, it's the whole product.

So: sign up, take the keys, set `PLAID_ENV=production`. You pay nothing.

| Option | Cost | Notes |
|---|---|---|
| **Plaid Trial** | **Free** | 10 accounts, real data, no card. Auto-approved for most developers. Start here. |
| **CSV / OFX import** | **Free forever** | Already built. No signup, no third party, nothing leaves your machine. Your fallback if Plaid ever says no. |
| **GoCardless Bank Account Data** | Free | Genuinely free at production scale — but **UK/EU only**. Useless if you're US. |
| **Teller** | Free dev tier | Clean API, certificate auth, smaller institution coverage than Plaid. Worth knowing as a backup. |
| **SimpleFIN Bridge** | ~$1.50/mo | Not free, but built specifically for personal finance apps. |
| MX, Finicity, Akoya, Yodlee | Enterprise | Sales calls and contracts. Not for one person. |

**Total cost of a fully working deployment: $0.** PC or Oracle for hosting, Plaid Trial for
data, ntfy for alerts, Cloudflare Tunnel for HTTPS. Nothing in that list bills you.

---

## Ruled out, and why

| | Why not |
|---|---|
| **Vercel / Netlify free** | Serverless. Functions wake for a request and die — your agents need a process that stays alive. |
| **Render free** | Spins down after 15 minutes idle and has no persistent disk on the free plan. Your data would vanish. |
| **Railway** | $5 trial credit, then paid. |
| **Heroku** | No free tier since 2022. |
| **GitHub Actions on a cron** | Tempting — free minutes, runs on a schedule. But no persistent storage between runs and you'd be putting bank credentials in repo secrets. Don't. |

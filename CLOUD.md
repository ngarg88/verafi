# Verafi in the cloud, on your phone, for $0

No PC involved. Always on. Real HTTPS URL. Nothing bills you.

---

## What I automated vs. what only you can do

I've automated everything that can be automated. Three things are irreducible — not
because I got lazy, but because they require *you*:

| Step | Time | Why it can't be automated |
|---|---|---|
| Create an Oracle Cloud account | ~10 min | Identity verification. A card is required to prove you're a person; it is never charged on Always Free. |
| Create the VM and paste one file | ~3 min | It's a form in their console. The file does everything after. |
| Link your bank inside the app | ~2 min | You type your bank password into Plaid's widget. **Nobody can automate this, and you should be suspicious of anything that claims to.** |

Total hands-on: about **15 minutes, once.** After that it runs itself — daily bank sync,
agents, push notifications, forever.

---

## Step 1 · Put the code somewhere the VM can fetch it (2 min, automated)

```powershell
powershell -ExecutionPolicy Bypass -File .\push-to-github.ps1
```

Installs git and the GitHub CLI if needed, signs you in, creates a public repo, pushes,
and copies the URL to your clipboard.

**Public is fine.** There are no secrets in the code — passcode, Plaid keys and your
transactions all live on the server, never in the repo. `.gitignore` is written for you.

## Step 2 · Oracle account (10 min, one time)

1. `cloud.oracle.com` → **Start for free**
2. Pick a home region close to you — **this cannot be changed later**
3. Card for verification. Always Free resources are never charged.

## Step 3 · Create the VM (3 min)

**Compute → Instances → Create instance**

- Image: **Ubuntu 22.04**
- Shape: **Ampere A1 Flex**, **2 OCPU / 12 GB**
  (Oracle halved the free allowance from 4/24 in June 2026 and begins terminating
  over-limit instances on **Aug 18, 2026** — stay at or under 2/12 and you're fine.
  Verafi needs about 100 MB, so this is enormous headroom.)
- **Show advanced options → Management → Paste cloud-init script**
- Paste all of `cloud-init.yaml`, then edit the three marked lines:

```yaml
REPO_URL=https://github.com/YOURNAME/verafi.git   # from step 1, on your clipboard
APP_PASSCODE=something-long-you-will-remember
NTFY_TOPIC=verafi-<random letters, keep it unguessable>
```

- **Create**

> If Oracle says "out of capacity" for A1 — common — just retry, or try a different
> availability domain. It usually works within a few attempts.

## Step 4 · Your phone (1 min)

1. Install **ntfy** (App Store / Play Store)
2. Subscribe to the topic you chose
3. In ~4 minutes you'll get a push: **"Verafi is live"** with an `https://….trycloudflare.com`
   link
4. Open it, unlock with your passcode, **Share → Add to Home Screen**

Done. It's an app on your phone, running in the cloud, costing nothing.

---

## Getting your data in — no PC needed

**Plaid (free, and the right answer):**
1. `dashboard.plaid.com` → sign up → copy Client ID and Secret
2. In the Oracle console, **Connect → Cloud Shell** (a terminal in the browser), then:
   ```bash
   ssh ubuntu@YOUR_VM_IP
   sudo nano /etc/verafi.env      # paste the keys, set PLAID_ENV=production
   sudo systemctl restart verafi
   ```
3. Open the app on your phone → **⚙ → Link an account**

Plaid's **Trial plan** is free, needs no credit card, gives real production data on up to
10 accounts, and covers Chase, BofA and Wells Fargo. That's your whole use case.

**Or CSV, from your phone:** the app's ⚙ screen has an import button — download a statement
in your bank's mobile app and pick it from your phone's Files.

---

## Things worth knowing

**The URL changes when the tunnel restarts.** Quick tunnels are free but ephemeral. Verafi
pushes you the new URL via ntfy on every boot, and stores it at `/var/lib/verafi/url.txt`.
For a permanent address, register a domain on Cloudflare (~$10/yr) and use a named tunnel —
that's the only thing in this entire setup that would cost money.

**The passcode is the only thing between your finances and the open internet.** The tunnel
URL is unguessable but it is public. Make the passcode long.

**Backups.** Your data is one file on the VM: `/var/lib/verafi/verafi.json`. Copy it
occasionally — `scp ubuntu@IP:/var/lib/verafi/verafi.json .`

**Check on it:**
```bash
sudo systemctl status verafi
sudo journalctl -u verafi -f
cat /var/lib/verafi/url.txt
```

---

## Why not the easier-sounding options

| | Why not |
|---|---|
| **Vercel / Netlify** | Serverless. Functions wake for a request and die — your agents need a process that stays alive on a schedule. |
| **Render free** | Sleeps after 15 minutes idle and has no persistent disk on the free plan. Your data would disappear. |
| **Railway / Fly** | Both fine, both cost $2–5/mo. Fly's free tier ended for new signups in 2024. |
| **GitHub Actions cron** | Free minutes and a scheduler, but no persistent storage between runs — and it would mean putting bank credentials in repo secrets. Don't. |

Oracle Always Free is the only genuinely free, always-on, persistent-disk option left.

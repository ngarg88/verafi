# Verafi — setup, one step at a time

There are **69 steps** (Parts 1–3 are already done for you — start at Part 4). Each one is a single action. Do them in order and don't skip any.

If you get stuck, note the step number — that's all I need to help.

**Time:** about 40 minutes · **Cost:** $0 forever

**What you get at the end:** an app on your phone that reads your bank accounts and tells
you what you're wasting. It runs on a free server in the cloud, so it works whether or not
your computer is on.

---

## First: open Notepad and paste this in

You'll collect four values as you go. You paste all four into one box at step 50.

```
TS_AUTHKEY   =
APP_PASSCODE =
NTFY_TOPIC   =
```
(REPO_URL is already done — I created the repo for you.)

Leave Notepad open the whole time.

---

# PART 1 — Get the files onto your computer

**1.** In this chat, find the file card called **`verafi-app.zip`** and click it.

**2.** Choose **Save** or **Download**. It goes to your Downloads folder.

**3.** Press **Windows key + E** together. File Explorer opens.

**4.** In the left sidebar, click **Downloads**.

**5.** Find **`verafi-app.zip`** in the list.

**6.** **Right-click** it → click **Extract All…**

**7.** Click the **Extract** button.

**8.** A new window opens showing a folder called **`verafi-app`**. Double-click it.

> ✅ **Checkpoint:** you should now see files including `START-HERE.txt` and
> `1-PUSH-TO-GITHUB.bat`. Leave this window open — you'll come back to it.
>
> ⚠️ **If you skipped step 6 and just double-clicked the zip, nothing will work.**
> Windows shows zips like folders but programs inside them can't run. Go back and do
> Extract All.

---

# PART 2 — Install Node.js

This is a free tool that runs the code. You install it once and never think about it again.

**9.** Go to **<https://nodejs.org>**

**10.** Click the big green button that says **LTS** (it will also show a version number
like 22.x — that's fine).

**11.** Run the file it downloads.

**12.** Click **Next** through every screen, accept the licence, click **Install**.

**13.** When it finishes, **restart your computer.**

> This restart matters. Windows won't find Node until you do.

---

# PART 3 — Upload the app to GitHub  ✅ ALREADY DONE FOR YOU

Your repository is live at **<https://github.com/ngarg88/verafi>** and the app zip is
already uploaded. Nothing to do here.

The server downloads the app from that address. Because it's already filled into your
`cloud-init.yaml`, **you no longer need a REPO_URL value** — you only need three:

```
TS_AUTHKEY   =
APP_PASSCODE =
NTFY_TOPIC   =
```

> Parts 1 and 2 (extracting the zip, installing Node) are also no longer required.
> Skip to Part 4.

---

# PART 4 — Tailscale (value 2 of 4)

Tailscale creates a private network between your phone and your server. It's what keeps
your bank data off the public internet — the app will be reachable from your phone and
from nowhere else.

**22.** Go to **<https://login.tailscale.com/start>** and sign up (Google or GitHub is
fastest).

**23.** Go to **<https://login.tailscale.com/admin/settings/keys>**

**24.** Click the **Generate auth key…** button.

**25.** Turn **Reusable** **ON**.

**26.** Make sure **Ephemeral** is **OFF**.

> ⚠️ **This one matters.** If Ephemeral is on, your server disappears from the network
> every time it restarts and nothing will work.

**27.** Click **Generate key**.

**28.** Copy the key it shows you into Notepad next to **TS_AUTHKEY**. It starts with
`tskey-auth-`

> ⚠️ **You only get to see this once.** Copy it before closing the box.

**29.** On your **phone**, install the Tailscale app and sign in with the same account:
[iPhone](https://apps.apple.com/app/tailscale/id1470499037) · [Android](https://play.google.com/store/apps/details?id=com.tailscale.ipn)

> ✅ **Checkpoint:** TS_AUTHKEY is in Notepad, Tailscale is on your phone.

---

# PART 5 — Notifications (value 3 of 4)

This is how the app tells you when it finds something.

**30.** On your **phone**, install ntfy:
[iPhone](https://apps.apple.com/app/ntfy/id1625396347) · [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)

**31.** Open it and tap the **+** button.

**32.** Type a topic name. **Make it random and unguessable**, for example:
`verafi-7k2m9x4qp1`

> Not `verafi`. Not `verafi-neel`. Anyone who guesses the name can read your
> notifications. Add random letters and numbers.

**33.** Tap **Subscribe**, then type that exact same name into Notepad next to
**NTFY_TOPIC**.

---

# PART 6 — Your passcode (value 4 of 4)

**34.** Invent a passcode and write it in Notepad next to **APP_PASSCODE**.

Make it long — four random words is ideal, like `otter-piano-cactus-9417`.
This is what unlocks the app on your phone.

> ✅ **Checkpoint: all four values in Notepad.** Do not continue until they're all filled in.

---

# PART 7 — Create a free Oracle Cloud account

This gives you a real server that runs forever, free.

**35.** Go to **<https://www.oracle.com/cloud/free/>** and click **Start for free**.

**36.** Fill in your details. When it asks for a **home region**, pick the one closest to
where you live.

> ⚠️ **The region can never be changed later.** Take a moment on this one.

**37.** Enter a credit card. This is only to prove you're a real person —
**Always Free resources are never charged**, and your account cannot start costing money
unless you manually upgrade it.

**38.** Verify your email, then sign in to the Oracle console.

---

# PART 8 — Create your server

**39.** In the Oracle console, click the **☰ menu** (top left) → **Compute** → **Instances**.

**40.** Click the blue **Create instance** button.

**41.** In the **Name** box, type: `verafi`

**42.** Find the section called **Image and shape** and click its **Edit** button.

**43.** Click **Change image** → choose **Canonical Ubuntu** → pick **22.04** → click
**Select image**.

**44.** Click **Change shape** → click the **Ampere** tab → choose
**VM.Standard.A1.Flex** → set **OCPUs to 2** and **Memory to 12 GB** → click
**Select shape**.

> ⚠️ **Do not go above 2 OCPUs / 12 GB.** Oracle deletes instances that exceed the free
> limit. The app only needs a fraction of this anyway.

**45.** Scroll down to **Add SSH keys** → choose **Generate a key pair for me** → click
**Save private key** and put the file somewhere you'll remember.

> You'll probably never need it, but recovering the server without it is painful.

**46.** Scroll to the bottom and click **Show advanced options**.

**47.** Click the **Management** tab, then choose **Paste cloud-init script**.

**48.** Open the `verafi-app` folder → open **`cloud-init.yaml`** with Notepad →
press **Ctrl+A** then **Ctrl+C**.

**49.** Click into the Oracle box and press **Ctrl+V**.

**50.** In that box you'll see four lines with placeholder text. Replace each one with
your value from Notepad:

```
REPO_URL=https://github.com/yourname/verafi.git
TS_AUTHKEY=tskey-auth-kX9....
APP_PASSCODE=otter-piano-cactus-9417
NTFY_TOPIC=verafi-7k2m9x4qp1
```

> Keep the exact format: `NAME=value`. No quotes. No spaces around the `=`.

**51.** Click the blue **Create** button.

**52.** Wait about **5 minutes.**

> **Red "Out of capacity" error?** Very common — free servers are popular. Just click
> **Create** again. If it keeps failing, change the **Availability Domain** dropdown
> (AD-1 → AD-2 → AD-3) and retry.

> ✅ **Checkpoint:** your phone gets a notification saying **"Verafi is live."**

---

# PART 9 — Open the app on your phone

**53.** Open the **Tailscale** app on your phone and make sure the toggle is **on** (it
should say Connected).

**54.** Open Safari or Chrome on your phone.

**55.** Type this address exactly: **`http://verafi:8788`**

**56.** Enter your **APP_PASSCODE**.

**57.** Tap the **Share** button → **Add to Home Screen**.

> ✅ **Done.** It comes loaded with a sample statement so you'll immediately see about
> **$6,156/yr** of findings. That's fake demo data proving it works — not your money.

---

# PART 10 — Add your real accounts

## The easy way: import a statement (5 minutes, nothing to sign up for)

**58.** Open your bank's app and download a **CSV** statement. Choose the longest date
range they offer — 12 to 18 months is ideal.

**59.** In Verafi, tap **⚙** → **Erase everything and start over**. This clears the demo data.

**60.** Tap **⚙** → **Import a CSV / OFX file** → choose the file you downloaded.

Your bank password never leaves your bank.

## The better way: Plaid (updates itself every day)

**61.** Sign up at **<https://dashboard.plaid.com/signup>**

**62.** Go to **Team Settings → Keys**. Copy your **client_id** and your **Production**
secret.

> New signups get a free **Trial plan**: real bank data, up to 10 accounts, no credit
> card. It covers Chase, Bank of America and Wells Fargo.

**63.** In the Oracle console, click the **`>_` Cloud Shell** icon in the top right.

**64.** Type this and press Enter:
```bash
tailscale ssh verafi
```

**65.** Type this and press Enter:
```bash
sudo nano /etc/verafi.env
```

**66.** Use the arrow keys to find these three lines and fill them in:
```
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_production_secret
PLAID_ENV=production
```

**67.** Press **Ctrl+O**, then **Enter**, then **Ctrl+X** to save and exit.

**68.** Type this and press Enter:
```bash
sudo systemctl restart verafi
```

**69.** On your phone, open Verafi → **⚙** → **Link an account** → choose your bank →
sign in.

---

# If something goes wrong

| What you're seeing | What to do |
|---|---|
| Black window closes instantly (step 15) | Node.js isn't installed, or you skipped the restart. Redo Part 2. |
| "installed but not on PATH" (step 15) | Normal the first time. Close it and double-click the file again. |
| No "Verafi is live" notification after 10 min | Your NTFY_TOPIC in step 50 doesn't exactly match what you typed on your phone in step 32. Capital letters count. |
| `http://verafi:8788` won't load (step 55) | Tailscale on your phone must show **Connected**. Then check <https://login.tailscale.com/admin/machines> — is `verafi` listed and online? |
| `verafi` vanished from Tailscale after a reboot | Your key had **Ephemeral** on. Make a new key with it off (steps 24–28), then run `sudo tailscale up --authkey=NEW_KEY --hostname=verafi` |
| "Out of capacity" (step 52) | Retry, or change Availability Domain. Completely normal. |
| Bank won't connect (step 69) | Check you used the **Production** secret, not the Sandbox one, and that `PLAID_ENV=production`. Redo steps 65–68. |
| Want to see what went wrong on the server | `sudo cat /var/log/verafi-setup.log` |

---

# What this costs

| | |
|---|---|
| Oracle server | **$0** — permanent, not a trial |
| Tailscale | **$0** |
| Plaid | **$0** — 10 accounts, real data, no card |
| ntfy, GitHub | **$0** |
| **Total** | **$0 per month** |

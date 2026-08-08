# Bank data: your options beyond Plaid

Plaid is the default, not the only answer — and for a personal build it may not even be
the best one.

## For a personal app (you, right now)

| Option | Cost | Real bank data? | Notes |
|---|---|---|---|
| **CSV / OFX export** | Free | Yes | Every US bank offers it. **No third party ever sees your credentials.** Zero setup. Loses time-of-day and doesn't auto-refresh. Built into Verafi. |
| **Plaid Trial plan** | Free | Yes | Since Apr 2026, auto-approved for most developers, ~10 Items, near-full institution coverage. Best free live option. |
| **SimpleFIN Bridge** | ~$1.50/mo | Yes | Purpose-built for personal finance apps. No business entity required. Popular with indie/self-hosted finance tools. |
| **Teller** | Free dev tier | Yes | Developer-friendly, clean API, strong US coverage. Certificate-based auth. |
| **GoCardless Bank Account Data** (was Nordigen) | **Free** | Yes | UK + EU only, but genuinely free at production scale. Irrelevant if you're US-only. |

**My recommendation for you: start with CSV, add Plaid Trial once it's earning its keep.**
CSV gets you a real answer about your own money in ten minutes with no signup, no vendor,
and no credentials leaving your laptop. If the findings are good, wire up Plaid so it
refreshes itself.

## For the consumer product later

| Provider | Strength | Watch out for |
|---|---|---|
| **Plaid** | Coverage, docs, ecosystem; Knot partnership | Priciest at scale; everyone's default so no edge |
| **MX** | Best-in-class data cleansing and enrichment | Enterprise sales motion, slower to start |
| **Finicity** (Mastercard) | Bank-direct via open banking; strong for lending | Heavier onboarding |
| **Akoya** | **No credential sharing** — direct API network owned by the big banks | Coverage is the FDX bank set, not the long tail |
| **Teller** | Fast, developer-first, transparent pricing | Smaller institution coverage than Plaid |
| **Yodlee** (Envestnet) | Widest long-tail coverage, decades of history | Legacy DX |
| **Salt Edge / Belvo / Basiq** | Europe / LatAm / Australia | Only if you go international |

**Two things worth knowing:**

1. **Multi-aggregator is normal at scale.** Mature apps route by institution — one provider
   covers a bank better or cheaper than another. Build behind an interface (Verafi's
   `importers.js` + `plaid.js` split is already that shape) so swapping is a day, not a quarter.
2. **Akoya is the strategic hedge.** It's the banks' own answer to credential sharing. If
   screen-scraping gets regulated harder, the aggregators that are bank-direct win. Worth
   a conversation once you have volume, not before.

## Merchant-side (a different problem)

Bank aggregators tell you what you *spent*. They can't cancel anything. For that:

- **Knot** — card-on-file switching and subscription cancellation. Sales-led. **Ask for the
  merchant coverage list under NDA before you promise users cancellations** — that list is
  the hard ceiling on the feature.
- **Email receipt parsing** — Gmail/Outlook API. Gets you order details, warranties and
  price-protection windows that no aggregator has. High-signal, low-cost, and genuinely
  differentiated data.
- **Manual, with a script** — for a personal app, you cancelling the subscription yourself
  after the app finds it is 100% of the value at 0% of the integration cost.

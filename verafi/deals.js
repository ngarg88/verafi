/**
 * DEAL RESEARCH — "find me an all-inclusive to the Bahamas for Labor Day, 2 adults 2 kids"
 *
 * This is the one kind of question that CANNOT be answered from your transaction history.
 * It needs live prices from the outside world. Two honest options:
 *
 *   1. With an ANTHROPIC_API_KEY set, this uses Claude with web search to research real
 *      current options and grounds the budget advice in YOUR spending.
 *   2. Without a key, it refuses rather than inventing plausible-looking prices. A made-up
 *      hotel rate is worse than no answer.
 *
 * Capability: recommend. It researches and hands you links. It never books, never pays.
 */
import { expensesOnly } from './classify.js';

/**
 * COGS MODEL
 *
 * In a consumer product the model call is not an expense to avoid, it is cost of goods.
 * What matters is that it is METERED, CAPPED and CACHED — an unmetered LLM endpoint in a
 * consumer app is how you wake up to a $9,000 bill because one user wrote a loop.
 *
 * Rough per-query cost at current pricing:
 *   web search        ~$0.01 per search  ×  up to 6 searches
 *   input + output    ~$0.01-0.02 for a 2k-token answer
 *   → about $0.02-0.07 per deal query, call it $0.05
 *
 * At 20 queries/user/month that is ~$1.00/user/month of COGS.
 * On a $12/month subscription: ~8% — healthy, IF capped.
 * The daily agents cost nothing at all: they are deterministic and never call a model.
 */
export const COST = Object.freeze({
  perSearchUsd: 0.01,
  perQueryEstimateUsd: 0.05,
  monthlyCapUsd: Number(process.env.RESEARCH_MONTHLY_CAP_USD ?? 5),
  maxSearchesPerQuery: 6
});

const DAY = 86400000;
const f0 = c => '$' + Math.round(c/100).toLocaleString('en-US');

/**
 * DEAL CATEGORIES, DERIVED FROM WHAT YOU ACTUALLY BUY
 *
 * Generic "browse deals" is a coupon site. The point of sitting on top of a bank feed is
 * that the questions can be specific to this person: they fly twice a year, they spend
 * $400/month on dining, they buy running shoes every eight months. Presets are generated
 * from that, not from a static list.
 */
export const DEAL_CATEGORIES = {
  travel:        { icon:'✈️', label:'Travel',        match:/travel|flights|hotels/,
                   asks: (c)=>[`Best value trip under $${c.budget} for my family`,
                               `Cheapest nonstop flights for a long weekend under $${Math.round(c.budget/3)}`,
                               `All-inclusive resorts under $${c.budget} for 4 people`] },
  entertainment: { icon:'🎟️', label:'Entertainment', match:/entertainment|events|cinema/,
                   asks: (c)=>[`Concerts and shows near me under $${c.budget}`,
                               `Best value family activities this month`] },
  clothing:      { icon:'👕', label:'Clothing',      match:/clothing|shopping/,
                   asks: (c)=>[`Current sales at the brands I actually buy`,
                               `Best price on running shoes under $${c.budget}`] },
  watches:       { icon:'⌚', label:'Watches & jewellery', match:/jewel|watch/,
                   asks: (c)=>[`Best value watches under $${c.budget}`,
                               `Where to buy pre-owned safely under $${c.budget}`] },
  electronics:   { icon:'💻', label:'Electronics',   match:/electronics/,
                   asks: (c)=>[`Best laptop under $${c.budget} right now`,
                               `Is now a good time to buy, or is a new model due?`] },
  home:          { icon:'🛋️', label:'Home',          match:/home|furniture/,
                   asks: (c)=>[`Best value furniture sales under $${c.budget}`] },
  dining:        { icon:'🍽️', label:'Dining',        match:/dining/,
                   asks: ()=>[`Restaurant deals and prix-fixe menus near me`,
                              `Which delivery service is cheapest for my usual orders?`] }
};

/**
 * Build the deal surface for THIS user: their biggest categories first, with budgets
 * anchored to what they have actually spent rather than numbers we invented.
 */
export function dealPresets(tx, now = Date.now()) {
  const ex = expensesOnly(tx);
  const yr = ex.filter(t => t.postedAt > now - 365*DAY && t.amountCents > 0);
  const byCat = {};
  for (const t of yr) byCat[t.category] = (byCat[t.category] ?? 0) + t.amountCents;

  const out = [];
  for (const [key, def] of Object.entries(DEAL_CATEGORIES)) {
    const spent = Object.entries(byCat)
      .filter(([c]) => def.match.test(c)).reduce((a,[,v])=>a+v,0);
    const largest = Math.max(0, ...yr.filter(t => def.match.test(t.category)).map(t=>t.amountCents));
    // budget anchor: their biggest single purchase in the category, else a twelfth of the year
    const budget = Math.round((largest || spent/12) / 100) || 250;
    out.push({
      key, icon: def.icon, label: def.label,
      spentYearCents: spent,
      basis: spent ? `You spent $${Math.round(spent/100).toLocaleString()} here in the last year`
                   : 'No spending here yet — budget is a starting guess',
      budget,
      asks: def.asks({ budget })
    });
  }
  return out.sort((a,b) => b.spentYearCents - a.spentYearCents);
}

/** Does this read like "find me something to buy" rather than "analyse my spending"? */
export function isDealQuery(q) {
  return /\b(find|best|deal|cheap|book|trip|vacation|holiday|flight|hotel|resort|all.?inclusive|buy|shop|looking for|recommend|compare|sale|price|worth it|under \$)\b/i.test(q ?? '');
}

/**
 * HOLDING A DEAL
 *
 * We cannot take your money — no agent payment rails for a personal account. What we can
 * honestly do is: pin the option, keep checking the price, tell you when it moves, and
 * hand you a link to the merchant's own checkout where Apple Pay already works.
 *
 * That is the whole flow minus the part that needs a business entity, and it is the part
 * that actually saves money anyway.
 */
export function holdDeal({ store, title, url, priceCents, targetCents, category, notes }) {
  const D = store.data;
  D.watchlist ??= [];
  const item = {
    id: 'hold_' + Math.random().toString(36).slice(2,9),
    title, url, category,
    foundPriceCents: priceCents, targetCents: targetCents ?? Math.round(priceCents * 0.9),
    currentPriceCents: priceCents, notes: notes ?? null,
    status: 'watching', createdAt: Date.now(), lastCheckedAt: Date.now(), history: [{ at: Date.now(), priceCents }]
  };
  D.watchlist.unshift(item);
  store.save();
  return item;
}

/** What the approval sheet shows before handing off. No charge happens here. */
export function approvalSummary(item, tx) {
  const ctx = spendingContext(tx);
  const drop = item.foundPriceCents - item.currentPriceCents;
  return {
    item,
    priceMovedCents: drop,
    affordability: ctx.summary,
    monthlyImpactPct: ctx.monthlySpendCents
      ? +(item.currentPriceCents / ctx.monthlySpendCents * 100).toFixed(1) : null,
    handoff: {
      method: 'merchant_checkout',
      url: item.url,
      why: 'Verafi cannot charge your card. This opens the merchant\'s own checkout, where Apple Pay works normally and your card details never pass through us.'
    }
  };
}

/** What we know about this user, so the answer is theirs and not generic. */
export function spendingContext(tx, now = Date.now()) {
  const ex = expensesOnly(tx);
  const last90 = ex.filter(t => t.postedAt > now - 90*DAY && t.amountCents > 0);
  const monthly = Math.round(last90.reduce((a,t)=>a+t.amountCents,0) / 3);
  const travel = ex.filter(t => t.category === 'travel' && t.amountCents > 0);
  const biggestTravel = travel.length ? Math.max(...travel.map(t=>t.amountCents)) : null;
  const travelYear = travel.filter(t => t.postedAt > now - 365*DAY).reduce((a,t)=>a+t.amountCents,0);
  return {
    monthlySpendCents: monthly,
    travelLast12mCents: travelYear,
    biggestSingleTravelCents: biggestTravel,
    typicalTripCount: travel.length,
    summary: [
      `Spends about ${f0(monthly)}/month`,
      travelYear ? `Spent ${f0(travelYear)} on travel in the last 12 months` : 'No travel spending on record',
      biggestTravel ? `Largest single travel charge to date: ${f0(biggestTravel)}` : null
    ].filter(Boolean).join('. ')
  };
}

/**
 * Ask Claude to research it, with web search, constrained to the user's real budget.
 * Returns a structured answer or an honest refusal.
 */
export async function researchDeal({ query, tx, apiKey, model = 'claude-sonnet-5', meter }) {
  const ctx = spendingContext(tx);

  // Cap before spending, not after. Consumer apps die on unmetered inference.
  if (meter && meter.monthUsd >= COST.monthlyCapUsd) return {
    ok: false, capped: true,
    answer: `You've used $${meter.monthUsd.toFixed(2)} of research this month, which is the cap. It resets next month, or raise RESEARCH_MONTHLY_CAP_USD on the server.`,
    context: ctx
  };

  // Identical question inside 24h returns the cached answer for free. Travel prices do
  // not move minute to minute, and this alone removes most repeat cost.
  const cacheKey = (query ?? '').trim().toLowerCase();
  if (meter?.cache?.[cacheKey] && Date.now() - meter.cache[cacheKey].at < 86400000) {
    return { ...meter.cache[cacheKey].result, cached: true };
  }

  if (!apiKey) return {
    ok: false,
    answer: 'Deal research needs live prices from the web, and no API key is configured — so I won\'t guess. Anything I made up here would look convincing and be wrong.',
    howToFix: [
      'Get a key at console.anthropic.com (pay-as-you-go, a query like this costs a cent or two)',
      'On the server:  sudo nano /etc/verafi.env',
      'Add:  ANTHROPIC_API_KEY=sk-ant-...',
      'Then: sudo systemctl restart verafi'
    ],
    context: ctx
  };

  const system = `You are a research agent inside a personal finance app. You find real, current options and you never book or pay for anything.

Rules:
- Use web search. Cite the sources you used.
- Give 3 concrete options with real current prices, not ranges you invented.
- Ground affordability in the user's actual spending, provided below.
- If you cannot find current prices, say so plainly. Do not estimate.
- End with what the user should verify themselves before booking.

What we know about this user's finances: ${ctx.summary}.`;

  const body = {
    model, max_tokens: 2000,
    system,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
    messages: [{ role: 'user', content: query }]
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'x-api-key': apiKey, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok:false, answer:`Research call failed (${r.status}). ${text.slice(0,200)}`, context: ctx };
  }
  const j = await r.json();
  const answer = (j.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  // Real usage, not an estimate — so the cost number shown to the user is the true one.
  const searches = (j.content ?? []).filter(c => c.type === 'web_search_tool_result').length;
  const inTok  = j.usage?.input_tokens ?? 0, outTok = j.usage?.output_tokens ?? 0;
  const costUsd = searches * COST.perSearchUsd + (inTok/1e6)*3 + (outTok/1e6)*15;
  const sources = [];
  for (const c of j.content ?? []) {
    if (c.type === 'web_search_tool_result') for (const s of c.content ?? []) if (s.url) sources.push({ url:s.url, title:s.title });
  }
  const result = {
    ok: true, answer, sources, context: ctx,
    costUsd: +costUsd.toFixed(4), searches,
    disclaimer: 'Research only. This agent cannot book or pay for anything.'
  };
  if (meter) {
    meter.monthUsd = +(meter.monthUsd + costUsd).toFixed(4);
    meter.queries = (meter.queries ?? 0) + 1;
    (meter.cache ??= {})[cacheKey] = { at: Date.now(), result };
  }
  return result;
}

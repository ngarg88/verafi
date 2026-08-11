/**
 * DEAL RESEARCH — "find me an all-inclusive to the Bahamas for Labor Day, 2 adults 2 kids"
 *
 * This is the one kind of question that CANNOT be answered from your transaction history.
 * It needs live prices from the outside world. Two honest options:
 *
 *   1. With Tavily plus a reasoning provider, or a provider with built-in search,
 *      this researches real current options and grounds the budget advice in YOUR spending.
 *   2. Without one, it refuses rather than inventing plausible-looking prices. A made-up
 *      hotel rate is worse than no answer.
 *
 * Capability: recommend. It researches and hands you links. It never books, never pays.
 */
import { expensesOnly } from './classify.js';
import { complete, providerInfo } from './llm.js';
import { normalizeTransactions } from './categories.js';

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
 * (Gemini's free tier has no per-call dollar cost, but is still metered by call count.)
 */
export const COST = Object.freeze({
  perSearchUsd: 0.01,
  perQueryEstimateUsd: 0.05,
  monthlyCapUsd: Number(process.env.RESEARCH_MONTHLY_CAP_USD ?? 5),
  maxSearchesPerQuery: 6
});

const DAY = 86400000;
const f0 = c => '$' + Math.round(c/100).toLocaleString('en-US');

const QUERY_CATEGORIES = [
  ['dining', /restaurant|dining|dinner|lunch|brunch|breakfast|prix.?fixe|menu|takeout|delivery|coffee|bar\b/i],
  ['travel', /flight|hotel|trip|travel|vacation|holiday|resort|airbnb|cruise|rental car/i],
  ['shopping', /clothing|shoe|sneaker|laptop|phone|electronics|furniture|watch|jewel|carry.?on|luggage|suitcase/i],
  ['entertainment', /concert|show|movie|event|ticket|activity/i],
  ['grocery', /grocery|supermarket|food shopping/i]
];

export function categoryForDealQuery(query='') {
  return QUERY_CATEGORIES.find(([, re]) => re.test(query))?.[0] ?? null;
}

export function purchaseContext(query, tx, now=Date.now()) {
  const category = categoryForDealQuery(query);
  const ex = normalizeTransactions(expensesOnly(tx)).filter(t => t.amountCents > 0 && t.postedAt > now - 365*DAY);
  const hits = category ? ex.filter(t => t.category === category) : [];
  const amounts = hits.map(t=>t.amountCents).sort((a,b)=>a-b);
  const cities = hits.map(t=>[t.location?.city,t.location?.region].filter(Boolean).join(', ')).filter(Boolean);
  const commonLocation = cities.length
    ? Object.entries(cities.reduce((a,c)=>(a[c]=(a[c]??0)+1,a),{})).sort((a,b)=>b[1]-a[1])[0][0]
    : null;
  return {
    category,
    transactionCount:hits.length,
    spentYearCents:hits.reduce((a,t)=>a+t.amountCents,0),
    typicalCents:amounts.length ? amounts[Math.floor(amounts.length/2)] : null,
    commonLocation,
    statement: hits.length
      ? `${hits.length} ${category} purchases reviewed across the last 12 months`
      : category ? `No ${category} purchases were found in the available history; live research still ran`
      : 'Live research ran without needing a matching past purchase'
  };
}

export function parseDealDecision(text, sources, images = []) {
  const raw = String(text ?? '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const known = (sources ?? []).filter(s => s?.url);
    const products = (Array.isArray(parsed.products) ? parsed.products : []).slice(0, 3)
      .map((p, i) => {
        const sourceIndex = Number(p.sourceIndex) - 1;
        const source = known[sourceIndex] ?? known.find(s => s.url === p.url) ?? known[i];
        const price = Number(p.price);
        const imageIndex = Number(p.imageIndex) - 1;
        const image = images[imageIndex];
        return {
          name: String(p.name ?? '').trim().slice(0, 120),
          label: String(p.label ?? (i === 0 ? 'Best overall' : `Option ${i + 1}`)).trim().slice(0, 32),
          price: Number.isFinite(price) && price > 0 ? +price.toFixed(2) : null,
          seller: String(p.seller ?? source?.title ?? 'Seller').trim().slice(0, 60),
          url: source?.url ?? '',
          image: /^https?:\/\//.test(image?.url ?? '') ? image.url : '',
          highlights: (Array.isArray(p.highlights) ? p.highlights : []).map(String).slice(0, 3),
          shipping: String(p.shipping ?? '').trim().slice(0, 100),
          tradeoff: String(p.tradeoff ?? '').trim().slice(0, 180),
          why: String(p.why ?? '').trim().slice(0, 220)
        };
      }).filter(p => p.name && p.price && p.url);
    if (!products.length) return null;
    return {
      summary: String(parsed.summary ?? products[0].why ?? '').trim().slice(0, 360),
      verification: String(parsed.verification ?? '').trim().slice(0, 260),
      products
    };
  } catch { return null; }
}

/** Return grounded merchant cards when live search succeeded but a queued free model
 * did not finish. Prices are accepted only when literally present in source evidence. */
export function fallbackDealDecision(sources = [], images = []) {
  const products = sources.slice(0, 5).map((s, i) => {
    const content = String(s.content ?? '');
    const match = content.match(/(?:\$|USD\s?)([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
    const price = match ? Number(match[1].replace(/,/g,'')) : null;
    let seller = 'Merchant';
    try { seller = new URL(s.url).hostname.replace(/^www\./,'').split('.')[0].replace(/^./,c=>c.toUpperCase()); } catch {}
    const words = String(s.title ?? '').toLowerCase().split(/\W+/).filter(w=>w.length>4);
    const image = images.find(x => words.some(w => String(x.description ?? '').toLowerCase().includes(w)));
    return {
      name:String(s.title ?? seller).replace(/\s*[|–—]\s*.+$/,'').trim().slice(0,120),
      label:i===0?'Live result':`Option ${i+1}`, price, seller, url:s.url,
      image:image?.url ?? '', highlights:['Price found in live source'],
      shipping:'Verify availability at merchant',
      tradeoff:'The ranking model was busy, so this is grounded live evidence rather than a completed ranking.',
      why:'Live merchant evidence was available even though model ranking did not finish.'
    };
  }).filter(p=>p.name&&p.url&&Number.isFinite(p.price)&&p.price>0).slice(0,3);
  if (!products.length) return null;
  return {
    summary:'Live prices were found. The ranking model was busy, so these are shown as grounded options rather than a fully ranked recommendation.',
    verification:'Confirm price, availability, shipping and returns on the merchant page.', products
  };
}

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

const CUSTOM_ICONS = Object.freeze({
  clothing:'ph:t-shirt-bold', family:'ph:baby-bold', travel:'ph:airplane-tilt-bold',
  home:'ph:house-line-bold', electronics:'ph:laptop-bold', dining:'ph:fork-knife-bold',
  other:'ph:sparkle-bold'
});

/** User-owned shopping category. It is useful even when transaction history is empty. */
export function makeDealCategory(p = {}) {
  const label = String(p.label ?? '').trim().slice(0, 48);
  const context = String(p.context ?? '').trim().slice(0, 320);
  const kind = CUSTOM_ICONS[p.kind] ? p.kind : 'other';
  const budgetCents = Math.round(Number(p.budgetCents));
  const defaultDropPct = Math.round(Number(p.defaultDropPct ?? 15));
  if (label.length < 2) throw new Error('give this category a name');
  if (context.length < 5) throw new Error('add who or what this category is for');
  if (!Number.isInteger(budgetCents) || budgetCents <= 0) throw new Error('add a valid budget');
  if (!Number.isInteger(defaultDropPct) || defaultDropPct < 1 || defaultDropPct > 90)
    throw new Error('price-drop alerts must be between 1% and 90%');
  return {
    id:'cat_' + Math.random().toString(36).slice(2, 9),
    key:'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,32)
      + '_' + Math.random().toString(36).slice(2,5),
    label, context, kind, icon:CUSTOM_ICONS[kind], budgetCents, defaultDropPct,
    createdAt:Date.now(), custom:true
  };
}

function customPreset(c) {
  const budget = Math.max(1, Math.round(c.budgetCents/100));
  const subject = c.label.toLowerCase();
  return {
    ...c, budget, spentYearCents:0,
    basis:c.context,
    asks:[
      `Find the best ${subject} under $${budget}. ${c.context}`,
      `Compare current sales for ${subject}. ${c.context}`,
      `What ${subject} should I buy now versus wait for? ${c.context}`
    ]
  };
}

/**
 * Build the deal surface for THIS user: their biggest categories first, with budgets
 * anchored to what they have actually spent rather than numbers we invented.
 */
export function dealPresets(tx, now = Date.now(), customCategories = []) {
  const ex = normalizeTransactions(expensesOnly(tx));
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
    const matches = yr.filter(t => def.match.test(t.category));
    out.push({
      key, icon: def.icon, label: def.label,
      spentYearCents: spent,
      basis: spent ? `${matches.length} purchases · $${Math.round(spent/100).toLocaleString()} in the last year`
                   : 'No matching history yet — research still works',
      budget,
      asks: def.asks({ budget }), custom:false, defaultDropPct:15
    });
  }
  return [
    ...(customCategories ?? []).map(customPreset),
    ...out.sort((a,b) => b.spentYearCents - a.spentYearCents)
  ];
}

/** Does this read like "find me something to buy" rather than "analyse my spending"? */
export function isDealQuery(q) {
  return /\b(find|best|deals?|cheap(?:er|est)?|book|trip|vacation|holiday|flights?|hotels?|resorts?|all.?inclusive|buy|shop|looking for|recommend|compare|sales?|prices?|worth it|under \$|restaurants?|dining|prix.?fixe|menus?)\b/i.test(q ?? '');
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
export function holdDeal({ store, title, url, priceCents, targetCents, category, notes, recommendation }) {
  const D = store.data;
  D.watchlist ??= [];
  const item = {
    id: 'hold_' + Math.random().toString(36).slice(2,9),
    title, url, category,
    foundPriceCents: priceCents, targetCents: targetCents ?? Math.round(priceCents * 0.9),
    currentPriceCents: priceCents, notes: notes ?? null, recommendation:recommendation ?? null,
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
  const ex = normalizeTransactions(expensesOnly(tx));
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
 * Ask the active provider to research it, with web search, constrained to the user's
 * real budget. Returns a structured answer or an honest refusal.
 *
 * Deliberately takes no apiKey argument — the active provider and its capabilities
 * (available? can it search the web? does it train on data?) all come from llm.js's
 * providerInfo(), which is the single source of truth for what is configured. A
 * previous version of this function checked a passed-in ANTHROPIC_API_KEY directly,
 * which meant it silently ignored Groq/Gemini/etc once those were added.
 */
export async function researchDeal({ query, tx, model = 'claude-sonnet-5', meter }) {
  const ctx = spendingContext(tx);
  const personalContext = purchaseContext(query, tx);
  // search: true — this call needs a provider that can actually reach the live web.
  // Without this flag, provider selection ignores that requirement and can hand back
  // a provider (Groq, Cerebras, ...) that will always refuse a search request.
  const info = providerInfo({ search: true });

  // Cap before spending, not after. Consumer apps die on unmetered inference.
  if (meter && meter.monthUsd >= COST.monthlyCapUsd) return {
    ok: false, capped: true,
    answer: `You've used $${meter.monthUsd.toFixed(2)} of research this month, which is the cap. It resets next month, or raise RESEARCH_MONTHLY_CAP_USD on the server.`,
    context: ctx, personalContext
  };

  // Identical question inside 24h returns the cached answer for free. Travel prices do
  // not move minute to minute, and this alone removes most repeat cost.
  const cacheKey = (query ?? '').trim().toLowerCase();
  if (meter?.cache?.[cacheKey] && Date.now() - meter.cache[cacheKey].at < 86400000) {
    return { ...meter.cache[cacheKey].result, personalContext, cached: true };
  }

  // providerInfo({ search: true }) only returns a provider that can reach the live
  // web directly or can reason over Tavily results. If none is configured, this is unavailable
  // regardless of whether a non-search provider like Groq is active for everything else.
  if (!info.available) return {
    ok: false,
    answer: 'Deal research needs live web search, and no search-capable provider is configured — so I won\'t guess. Anything I made up here would look convincing and be wrong.',
    howToFix: [
      'Free option: add TAVILY_API_KEY and OPENROUTER_API_KEY on the server',
      'Set LLM_PROVIDER=openrouter, OPENROUTER_MODEL to a :free model, and ZERO_SPEND_MODE=1',
      'Then: sudo systemctl restart verafi'
    ],
    context: ctx, personalContext
  };

  // On a provider that trains on prompts, send the budget number and nothing else about
  // this person. A hotel search does not need to know their monthly spend.
  const safeContext = info.allowPersonal ? ctx.summary
    : 'Budget-conscious shopper. (Personal financial detail withheld from this provider.)';

  const system = `You are a research agent inside a personal finance app. You find real, current options and you never book or pay for anything.

Rules:
- Use the supplied web evidence and give exactly 3 concrete options with real current prices, not ranges you invented.
- Ground affordability in the context provided.
- If you cannot find current prices, say so plainly. Do not estimate.
- Return ONLY one JSON object. No markdown or prose outside JSON.
- Each product must cite one supplied source by its 1-based sourceIndex. Never invent a URL.
- Use merchant product or booking pages as product sources, not review articles, listicles, or search-result pages.
- If an available product image clearly matches the named product, include its 1-based imageIndex. Otherwise use null.
- Use short factual highlights and one honest tradeoff per product.

Schema:
{"summary":"why the first option is the best match","products":[{"name":"product name","label":"Best overall","price":139.99,"seller":"merchant","sourceIndex":1,"imageIndex":1,"highlights":["7.2 lbs","Hardside","4 spinner wheels"],"shipping":"Free shipping and returns","tradeoff":"Slightly heavier","why":"why it fits"}],"verification":"what to verify at merchant checkout"}

Context: ${safeContext}.`;

  const out = await complete({
    system, user: query, maxTokens: 2000, search: true,
    sensitivity: 'generic',          // the query itself, not their transaction history
    meter
  });

  if (!out.ok && out.reason === 'timeout' && out.sources?.length) {
    const decision = fallbackDealDecision(out.sources, out.images ?? []);
    return {
      ok:true, partial:true, context:ctx, personalContext,
      answer:decision?.summary ?? 'Live sources were found, but the ranking model was busy. Open the current sources below while Verafi keeps the evidence grounded.',
      decision, sources:out.sources, provider:out.provider, costUsd:0,
      disclaimer:'Research only. Prices and availability must be verified with the merchant.'
    };
  }

  if (!out.ok) return {
    ok: false, context: ctx, personalContext,
    answer: out.reason === 'timeout'
      ? 'Live search did not return usable merchant evidence in time. Verafi stopped safely without inventing options; retry the same question.'
      : out.reason === 'privacy_blocked' ? out.detail
      : out.reason === 'search_quota_reached' ? 'The free monthly search allowance has been reached. Search is paused so Verafi cannot incur charges.'
      : out.reason === 'reasoning_quota_reached' ? 'The free daily reasoning allowance has been reached. Try again tomorrow; Verafi will not use a paid fallback.'
      : `Could not reach the research service (${out.reason}${out.detail ? ': ' + out.detail : ''}).`
  };

  const answer = out.text;
  const sources = out.sources ?? [];
  const decision = parseDealDecision(answer, sources, out.images ?? []);
  const costUsd = out.costUsd ?? 0;

  const result = {
    ok: true,
    answer: decision?.summary || answer,
    decision,
    sources, context: ctx, personalContext, provider: out.provider,
    costUsd: +costUsd.toFixed(4),
    disclaimer: 'Research only. This agent cannot book or pay for anything.'
  };
  if (meter) {
    meter.monthUsd = +(meter.monthUsd + costUsd).toFixed(4);
    meter.queries = (meter.queries ?? 0) + 1;
    (meter.cache ??= {})[cacheKey] = { at: Date.now(), result };
  }
  return result;
}

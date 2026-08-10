/**
 * THE REASONING LAYER
 *
 * Rules find candidates and do arithmetic. The model reads the result and decides what
 * actually matters to THIS person, in what order, and how to say it.
 *
 * The division is deliberate and worth defending:
 *   code computes every dollar amount and enforces every ceiling
 *   the model interprets, prioritises, explains and categorises
 *
 * A model that invents "$340/yr" is worse than no app. A rule engine that says
 * "Other is running hot" is useless. You need both halves.
 *
 * Everything here is metered, cached and capped, and degrades to pure rules with no key.
 */

/**
 * PROVIDERS
 *
 * Several are supported. Two things vary between them, and both matter:
 *
 *   1. Does it train on your prompts? (trainsOnYourData)
 *   2. Can it search the live web? (noSearch)
 *
 * Groq/Cerebras/Ollama never train on your data but also cannot search the web at all —
 * they are pure reasoning over data you already gave them (findings, categorisation).
 * Gemini's free tier CAN search the web but may train on prompts, which is why deal
 * research strips personal financial detail before sending anything to it.
 *
 * Provider selection is therefore capability-aware, not just priority-ordered: a call
 * that needs web search (deal research) must land on a provider that can actually do
 * that, even if a different provider is preferred for everything else.
 */
const API = 'https://api.anthropic.com/v1/messages';

const PROVIDERS = {
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.LLM_MODEL ?? 'claude-sonnet-5',
    trainsOnYourData: false
  },
  gemini: {
    key: () => process.env.GEMINI_API_KEY,
    model: () => process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    // true unless you have moved to Google's paid tier, in which case set GEMINI_PAID=1
    trainsOnYourData: () => process.env.GEMINI_PAID !== '1',
    style: 'gemini'
  },
  // OpenAI-compatible free providers. Same wire format, so one adapter covers them all.
  groq: {
    key: () => process.env.GROQ_API_KEY,
    model: () => process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    base: 'https://api.groq.com/openai/v1/chat/completions',
    trainsOnYourData: false,        // Groq states it does not train on API data
    noSearch: true,                 // no built-in web search
    style: 'openai'
  },
  cerebras: {
    key: () => process.env.CEREBRAS_API_KEY,
    model: () => process.env.CEREBRAS_MODEL ?? 'llama-3.3-70b',
    base: 'https://api.cerebras.ai/v1/chat/completions',
    trainsOnYourData: false,
    noSearch: true,
    style: 'openai'
  },
  openrouter: {
    key: () => process.env.OPENROUTER_API_KEY,
    model: () => process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
    base: 'https://openrouter.ai/api/v1/chat/completions',
    // free models on OpenRouter may be logged by the upstream provider
    trainsOnYourData: () => process.env.OPENROUTER_PAID !== '1',
    noSearch: true,
    style: 'openai'
  },
  ollama: {
    // runs on your own server. nothing leaves the machine, so nothing to trust.
    key: () => process.env.OLLAMA_HOST ? 'local' : null,
    model: () => process.env.OLLAMA_MODEL ?? 'llama3.1:8b',
    base: () => `${process.env.OLLAMA_HOST}/v1/chat/completions`,
    trainsOnYourData: false,
    noSearch: true,
    style: 'openai',
    local: true
  }
};

export function providerOptions() {
  return [
    { key:'anthropic', label:'Anthropic', cost:'~$1-3/mo', private:true,  search:true,
      note:'Best quality. Prompts are not used for training.' },
    { key:'gemini', label:'Google Gemini', cost:'free', private:false, search:true,
      note:'Free tier may train on prompts. Deal search only - financial data is withheld.' },
    { key:'groq', label:'Groq', cost:'free', private:true, search:false,
      note:'Free and fast, no training on API data. No web search, so no deal research.' },
    { key:'cerebras', label:'Cerebras', cost:'free', private:true, search:false,
      note:'Same trade as Groq. Very fast.' },
    { key:'openrouter', label:'OpenRouter', cost:'free models', private:false, search:false,
      note:'Free models may be logged upstream.' },
    { key:'ollama', label:'Ollama (self-hosted)', cost:'free', private:true, search:false,
      note:'Runs on your own server. Nothing leaves the machine. Needs ~8GB RAM - your free VM has 1GB, so not viable there.' }
  ];
}

/**
 * Pick the active provider. When `search` is true, a provider that cannot search the
 * web is not a valid candidate at all — not "less preferred", genuinely unusable for
 * this call — so it is skipped even if it would normally win on priority.
 */
function activeProvider({ search = false } = {}) {
  const usable = (p) => PROVIDERS[p].key() && !(search && PROVIDERS[p].noSearch);

  const want = (process.env.LLM_PROVIDER ?? '').toLowerCase();
  if (want && PROVIDERS[want] && usable(want)) return want;

  // Prefer providers that do not train on your data, but only among ones that can
  // actually do what's being asked.
  const order = search
    ? ['anthropic', 'gemini']                                        // only these can search
    : ['anthropic', 'groq', 'cerebras', 'ollama', 'gemini', 'openrouter'];
  for (const p of order) if (usable(p)) return p;
  return null;
}

/**
 * @param {{ search?: boolean }} opts - pass { search: true } when the caller needs a
 * provider capable of live web search (e.g. deal research). Without this, provider
 * selection ignores search capability entirely and can hand back a provider (Groq,
 * Cerebras, ...) that will always refuse a search request.
 */
export function providerInfo({ search = false } = {}) {
  const p = activeProvider({ search });
  if (!p) return { provider: null, available: false, canSearchWeb: false };
  const trains = typeof PROVIDERS[p].trainsOnYourData === 'function'
    ? PROVIDERS[p].trainsOnYourData() : PROVIDERS[p].trainsOnYourData;
  return { provider: p, available: true, model: PROVIDERS[p].model(), trainsOnYourData: trains,
           canSearchWeb: !PROVIDERS[p].noSearch,
           allowPersonal: !trains || process.env.ALLOW_PERSONAL_ON_FREE_TIER === '1' };
}

export function hasLLM() { return !!activeProvider(); }

/** Low-level call with usage accounting. Never throws — returns {ok:false} instead. */
export async function complete({ system, user, maxTokens = 1200, json = false, meter,
                                 sensitivity = 'personal', search = false }) {
  const info = providerInfo({ search });
  if (!info.available) return {
    ok: false,
    reason: search ? 'no_search_provider' : 'no_api_key'
  };

  // The guard that matters: never send someone's finances to a provider that trains on it.
  if (sensitivity === 'personal' && !info.allowPersonal) return {
    ok: false, reason: 'privacy_blocked', provider: info.provider,
    detail: `${info.provider} free tier may use prompts for training and human review. This request contains your financial data, so it was not sent. Use an Anthropic key for this, upgrade Gemini to paid and set GEMINI_PAID=1, or set ALLOW_PERSONAL_ON_FREE_TIER=1 if you accept the trade.`
  };

  const key = PROVIDERS[info.provider].key();

  const cap = Number(process.env.RESEARCH_MONTHLY_CAP_USD ?? 5);
  if (meter && meter.monthUsd >= cap) return { ok: false, reason: 'monthly_cap_reached', spent: meter.monthUsd };

  // A model call must NEVER be able to wedge the app. Hard timeout, always.
  const ctrl = new AbortController();
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 20000);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // One adapter for every OpenAI-compatible provider: groq, cerebras, openrouter, ollama.
  const cfg = PROVIDERS[info.provider];
  if (cfg.style === 'openai') {
    try {
      const base = typeof cfg.base === 'function' ? cfg.base() : cfg.base;
      const r = await fetch(base, {
        method:'POST', signal: ctrl.signal,
        headers: { 'content-type':'application/json', authorization:`Bearer ${key}` },
        body: JSON.stringify({ model: info.model, max_tokens: maxTokens, temperature: 0.3,
          messages: [{ role:'system', content: system }, { role:'user', content: user }] })
      });
      if (!r.ok) return { ok:false, reason:`http_${r.status}`, detail:(await r.text()).slice(0,200) };
      const j = await r.json();
      let text = (j.choices?.[0]?.message?.content ?? '').trim();
      if (json && !text.trim().startsWith('[')) { const i = text.indexOf('['); if (i>=0) text = text.slice(i); }
      if (meter) meter.calls = (meter.calls ?? 0) + 1;
      return { ok:true, text, costUsd:0, provider: info.provider, sources: [] };
    } catch (e) {
      return { ok:false, reason: e.name==='AbortError' ? 'timeout' : 'network', detail:e.message };
    } finally { clearTimeout(timer); }
  }

  if (info.provider === 'gemini') {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${info.model}:generateContent?key=${key}`;
      const r = await fetch(url, {
        method:'POST', signal: ctrl.signal, headers:{'content-type':'application/json'},
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role:'user', parts:[{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
          ...(search ? { tools: [{ googleSearch: {} }] } : {})
        })
      });
      if (!r.ok) return { ok:false, reason:`http_${r.status}`, detail:(await r.text()).slice(0,200) };
      const j = await r.json();
      let text = (j.candidates?.[0]?.content?.parts ?? []).map(p=>p.text).filter(Boolean).join('').trim();
      if (json && !text.trim().startsWith('[')) { const i = text.indexOf('['); if (i>=0) text = text.slice(i); }
      const sources = (j.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .map(c => ({ url: c.web?.uri, title: c.web?.title })).filter(x=>x.url);
      if (meter) meter.calls = (meter.calls ?? 0) + 1;        // free tier: no cost to add
      return { ok:true, text, costUsd:0, provider:'gemini', sources };
    } catch (e) {
      return { ok:false, reason: e.name==='AbortError' ? 'timeout' : 'network', detail:e.message };
    } finally { clearTimeout(timer); }
  }

  try {
    const r = await fetch(API, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type':'application/json', 'x-api-key': key, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: info.model, max_tokens: maxTokens, system,
        messages: [{ role:'user', content: user }],
        ...(json ? { messages: [{ role:'user', content: user },
                                 { role:'assistant', content: '[' }] } : {})
      })
    });
    if (!r.ok) return { ok:false, reason:`http_${r.status}`, detail:(await r.text()).slice(0,200) };
    const j = await r.json();
    let text = (j.content ?? []).filter(c=>c.type==='text').map(c=>c.text).join('').trim();
    if (json) text = '[' + text;

    const cost = (j.usage?.input_tokens ?? 0)/1e6*3 + (j.usage?.output_tokens ?? 0)/1e6*15;
    if (meter) { meter.monthUsd = +((meter.monthUsd ?? 0) + cost).toFixed(4); meter.calls = (meter.calls ?? 0) + 1; }
    return { ok:true, text, costUsd:+cost.toFixed(5), provider:'anthropic' };
  } catch (e) {
    return { ok:false, reason: e.name === 'AbortError' ? 'timeout' : 'network', detail:e.message };
  } finally { clearTimeout(timer); }
}

/**
 * CATEGORISE THE LONG TAIL
 * One batched call for every merchant our rules could not place. Results are cached
 * forever, so each merchant costs a fraction of a cent exactly once.
 */
export async function categoriseMerchants({ merchants, taxonomy, meter }) {
  if (!merchants.length) return { ok:true, map:{} };
  const cats = taxonomy.map(t => `${t.key} (${t.subs.join('/')})`).join('\n');
  const out = await complete({
    meter, maxTokens: 1500, json: true, sensitivity: 'personal',   // merchant names are yours
    system: `You classify bank transaction descriptors into categories. Descriptors are abbreviated and messy.
Return ONLY a JSON array: [{"merchant":"<exact input>","category":"<key>","subcategory":"<sub>","flow":"expense|investment|transfer|debt_payment|tax"}]
Rules:
- flow "expense" only for actual spending. Money to a brokerage is "investment". Money to a card issuer or lender is "debt_payment". Money moved between the user's own accounts is "transfer".
- If genuinely unsure, use category "other" rather than guessing.
Categories:\n${cats}`,
    user: merchants.map(m => `${m.name} — $${Math.round(m.cents/100)} across ${m.count} transaction(s)`).join('\n')
  });
  if (!out.ok) return out;
  try {
    const arr = JSON.parse(out.text.slice(out.text.indexOf('['), out.text.lastIndexOf(']')+1));
    const map = {};
    for (const r of arr) if (r.merchant) map[String(r.merchant).toLowerCase().slice(0,40)] =
      { category:r.category, subcategory:r.subcategory, flow:r.flow };
    return { ok:true, map, costUsd: out.costUsd, count: Object.keys(map).length };
  } catch { return { ok:false, reason:'bad_json', raw: out.text.slice(0,200) }; }
}

/**
 * INTERPRET THE FINDINGS
 * The rules produce candidates with exact amounts. The model decides which three matter,
 * why, and what to do — but is explicitly forbidden from inventing or altering figures.
 */
export async function interpretFindings({ findings, context, meter }) {
  if (!findings.length) return { ok:true, headline:null, items:[] };
  const out = await complete({
    meter, maxTokens: 1000, sensitivity: 'personal',   // amounts and balances
    system: `You are the analyst inside a personal finance app. You are given findings that were
computed by deterministic code, with exact amounts. Your job:
1. Pick the 3 that genuinely matter most to this person and say why, referencing their situation.
2. Give each a concrete next action in one sentence.
3. Write one honest headline for the whole set.

Hard rules:
- NEVER invent, change or round a dollar amount. Use exactly the figures given.
- If the findings are trivial, say so plainly rather than inflating them.
- No motivational filler. Talk like a smart friend who has seen the numbers.
Return JSON: {"headline":"...","items":[{"ref":"<agent:ref>","why":"...","action":"..."}]}`,
    user: `Their situation: ${context}\n\nFindings:\n` +
      findings.slice(0,12).map(f => `[${f.agent}:${f.ref}] ${f.title} — $${Math.round(f.annualCents/100)}${f.oneOff?' one-off':'/yr'}. ${f.detail}`).join('\n')
  });
  if (!out.ok) return out;
  try {
    const j = JSON.parse(out.text.slice(out.text.indexOf('{'), out.text.lastIndexOf('}')+1));
    return { ok:true, ...j, costUsd: out.costUsd };
  } catch { return { ok:false, reason:'bad_json' }; }
}

/** A short, specific read on the month. Rules cannot write this. */
export async function monthlyNarrative({ context, categories, findings, meter }) {
  const out = await complete({
    meter, maxTokens: 600, sensitivity: 'personal',
    system: `You write a 3-4 sentence read on someone's month for a finance app.
Be specific and use only the numbers provided. No greetings, no filler, no advice they did not ask for.
If nothing notable happened, say that in one sentence rather than manufacturing insight.`,
    user: `Situation: ${context}\nCategories: ${categories}\nOpen findings: ${findings}`
  });
  return out.ok ? { ok:true, text: out.text, costUsd: out.costUsd } : out;
}

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

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.LLM_MODEL ?? 'claude-sonnet-5';

export function hasLLM() { return !!process.env.ANTHROPIC_API_KEY; }

/** Low-level call with usage accounting. Never throws — returns {ok:false} instead. */
export async function complete({ system, user, maxTokens = 1200, json = false, meter }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'no_api_key' };

  const cap = Number(process.env.RESEARCH_MONTHLY_CAP_USD ?? 5);
  if (meter && meter.monthUsd >= cap) return { ok: false, reason: 'monthly_cap_reached', spent: meter.monthUsd };

  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type':'application/json', 'x-api-key': key, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: maxTokens, system,
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
    return { ok:true, text, costUsd:+cost.toFixed(5) };
  } catch (e) { return { ok:false, reason:'network', detail:e.message }; }
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
    meter, maxTokens: 1500, json: true,
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
    meter, maxTokens: 1000,
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
    meter, maxTokens: 600,
    system: `You write a 3-4 sentence read on someone's month for a finance app.
Be specific and use only the numbers provided. No greetings, no filler, no advice they did not ask for.
If nothing notable happened, say that in one sentence rather than manufacturing insight.`,
    user: `Situation: ${context}\nCategories: ${categories}\nOpen findings: ${findings}`
  });
  return out.ok ? { ok:true, text: out.text, costUsd: out.costUsd } : out;
}

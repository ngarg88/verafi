import assert from 'node:assert/strict';
import test from 'node:test';

test('OpenAI provider performs live search and returns cited sources', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldProvider = process.env.LLM_PROVIDER;
  const oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.LLM_PROVIDER = 'openai';

  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      output: [{ type:'message', content:[{ type:'output_text', text:'Two current options.',
        annotations:[{ type:'url_citation', url:'https://merchant.example/item', title:'Merchant' }] }] }],
      usage: { input_tokens:100, output_tokens:25 }
    }), { status:200, headers:{ 'content-type':'application/json' } });
  };

  try {
    const { complete } = await import(`../verafi/llm.js?test=${Date.now()}`);
    const out = await complete({ system:'Find products.', user:'running shoes', search:true });
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.deepEqual(request.body.tools, [{ type:'web_search' }]);
    assert.equal(out.ok, true);
    assert.equal(out.text, 'Two current options.');
    assert.deepEqual(out.sources, [{ url:'https://merchant.example/item', title:'Merchant' }]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldProvider == null) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = oldProvider;
  }
});

test('zero-spend Shop uses Tavily search and an OpenRouter free model', async () => {
  const names = ['TAVILY_API_KEY','OPENROUTER_API_KEY','OPENROUTER_MODEL','LLM_PROVIDER','ZERO_SPEND_MODE'];
  const old = Object.fromEntries(names.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    TAVILY_API_KEY:'tvly-test', OPENROUTER_API_KEY:'or-test',
    OPENROUTER_MODEL:'meta-llama/llama-3.3-70b-instruct:free',
    LLM_PROVIDER:'openrouter', ZERO_SPEND_MODE:'1'
  });
  const calls = [];
  const oldFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, body:JSON.parse(options.body) });
    if (String(url).includes('tavily.com')) return new Response(JSON.stringify({ results:[
      { title:'Example shoe', url:'https://shop.example/shoe', content:'Current price $89.' }
    ] }), { status:200 });
    return new Response(JSON.stringify({ choices:[{ message:{ content:'Example shoe is $89 [1].' } }] }), { status:200 });
  };
  try {
    const { complete } = await import(`../verafi/llm.js?free-search=${Date.now()}`);
    const meter = { monthUsd:0, calls:0, tavilySearches:0 };
    const out = await complete({ system:'Find products.', user:'running shoes', search:true,
      sensitivity:'generic', meter });
    assert.equal(out.ok, true);
    assert.equal(out.provider, 'openrouter');
    assert.equal(out.sources[0].url, 'https://shop.example/shoe');
    assert.equal(calls[0].body.search_depth, 'basic');
    assert.equal(calls[1].body.model.endsWith(':free'), true);
    assert.equal(meter.tavilySearches, 1);
    assert.equal(meter.openRouterDaily.calls, 1);
  } finally {
    global.fetch = oldFetch;
    for (const k of names) old[k] == null ? delete process.env[k] : process.env[k] = old[k];
  }
});

test('zero-spend mode blocks paid OpenRouter models before any request', async () => {
  const names = ['OPENROUTER_API_KEY','OPENROUTER_MODEL','LLM_PROVIDER','ZERO_SPEND_MODE'];
  const old = Object.fromEntries(names.map(k => [k, process.env[k]]));
  Object.assign(process.env, { OPENROUTER_API_KEY:'or-test', OPENROUTER_MODEL:'openai/gpt-5',
    LLM_PROVIDER:'openrouter', ZERO_SPEND_MODE:'1' });
  try {
    const { complete, providerInfo } = await import(`../verafi/llm.js?paid-block=${Date.now()}`);
    assert.equal(providerInfo().available, false);
    const out = await complete({ system:'x', user:'y', sensitivity:'generic' });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no_api_key');
  } finally {
    for (const k of names) old[k] == null ? delete process.env[k] : process.env[k] = old[k];
  }
});

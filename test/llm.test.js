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

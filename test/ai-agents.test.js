import test from 'node:test';
import assert from 'node:assert/strict';
import { runAIAgents } from '../verafi/ai-agents.js';

const NOW=Date.UTC(2026,7,11), originalFetch=global.fetch;
const originalKey=process.env.OPENAI_API_KEY, originalProvider=process.env.LLM_PROVIDER;

function storeWith(transactions, agent) {
  return { data:{transactions,learned:{},customAgents:[agent],findings:[],seenFindings:{},dismissed:{}}, saves:0,
    save(){this.saves++;} };
}

test.afterEach(()=>{global.fetch=originalFetch;process.env.OPENAI_API_KEY=originalKey;process.env.LLM_PROVIDER=originalProvider;});

test('AI agent citations are resolved and dollar totals are calculated by code',async()=>{
  process.env.OPENAI_API_KEY='test-key';process.env.LLM_PROVIDER='openai';
  global.fetch=async()=>({ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({agents:[{id:'c1',status:'finding',summary:'Dining rose.',finding:{title:'Review recent dining',detail:'Several recent restaurant charges form the change.',transactionIds:['t1','t2'],confidence:.8}}]})}]}],usage:{input_tokens:10,output_tokens:10}})});
  const s=storeWith([
    {externalId:'t1',merchantId:'a',merchantName:'Cafe A',amountCents:1234,postedAt:NOW-1000,category:'dining'},
    {externalId:'t2',merchantId:'b',merchantName:'Cafe B',amountCents:4566,postedAt:NOW-2000,category:'dining'}
  ],{id:'c1',name:'Dining investigator',goal:'Investigate whether dining changed.',method:'ai',enabled:true});
  const out=await runAIAgents({store:s,now:NOW,meter:{monthUsd:0,calls:0,cache:{}}});
  assert.equal(out.status,'completed');assert.equal(out.findings.length,1);
  assert.equal(out.findings[0].amountCents,5800);assert.equal(out.findings[0].annualCents,5800);
  assert.deepEqual(out.findings[0].evidence.transactionIds,['t1','t2']);assert.equal(out.findings[0].alertOnly,true);
});

test('AI agent drops a finding with invented transaction evidence',async()=>{
  process.env.OPENAI_API_KEY='test-key';process.env.LLM_PROVIDER='openai';
  global.fetch=async()=>({ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({agents:[{id:'c1',status:'finding',summary:'Found it.',finding:{title:'Unsupported claim',detail:'This does not exist.',transactionIds:['invented'],confidence:.9}}]})}]}],usage:{}})});
  const agent={id:'c1',name:'Investigator',goal:'Find unusual charges.',method:'ai',enabled:true};
  const s=storeWith([{externalId:'real',merchantId:'a',amountCents:1000,postedAt:NOW-1000,category:'other'}],agent);
  const out=await runAIAgents({store:s,now:NOW,meter:{monthUsd:0,calls:0,cache:{}}});
  assert.equal(out.findings.length,0);assert.equal(agent.lastStatus,'failed');assert.match(agent.blocker,/valid transaction evidence/i);
});

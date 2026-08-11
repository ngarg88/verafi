import assert from 'node:assert/strict';
import test from 'node:test';
import { isDealQuery, purchaseContext, makeDealCategory, dealPresets, fallbackDealDecision } from '../verafi/deals.js';
import { AGENTS, reviewAgents } from '../verafi/agents.js';
import { Plaid } from '../verafi/plaid.js';
import { makeRule, recommendWatch } from '../verafi/rules.js';

const DAY=86400000, NOW=Date.UTC(2026,7,10);
const tx=(merchant,amount,daysAgo,o={})=>({externalId:`${merchant}-${daysAgo}`,merchantId:merchant.toLowerCase().replace(/\W+/g,'-'),
  merchantName:merchant,amountCents:amount*100,postedAt:NOW-daysAgo*DAY,category:o.category??'dining',
  instrumentId:o.instrumentId??'card1',localHour:13});

test('Dining discovery always routes to live research',()=>{
  assert.equal(isDealQuery('Restaurant deals and prix-fixe menus near me'),true);
  assert.equal(isDealQuery('Which delivery service is cheapest for my usual orders?'),true);
});

test('Dining history personalizes but never gates research',()=>{
  const withHistory=purchaseContext('restaurant deals',[tx('Cafe A',40,10),tx('Bistro B',80,20)],NOW);
  assert.equal(withHistory.category,'dining');
  assert.equal(withHistory.transactionCount,2);
  assert.match(withHistory.statement,/2 dining purchases reviewed/);
  const empty=purchaseContext('restaurant deals',[],NOW);
  assert.match(empty.statement,/live research still ran/);
});

test('Subscription Auditor creates honest review candidates, not claimed savings',()=>{
  const rows=[90,60,30].map(d=>tx('Netflix',25,d,{category:'subscription'}));
  const data={transactions:rows,instruments:[],agents:[{name:'Subscription Auditor',enabled:true}],findings:[],seenFindings:{},dismissed:{}};
  const store={data,save(){}};
  const found=AGENTS.subscription_auditor.run({tx:rows,now:NOW});
  assert.equal(found.length,1);
  assert.equal(found[0].reviewOnly,true);
  assert.doesNotMatch(found[0].detail,/haven't used|still billing.*but/);
  data.findings=found;
  const audit=reviewAgents({data,now:NOW,cardRules:{}}).agents.find(a=>a.id==='subscription_auditor');
  assert.equal(audit.needsReview,1);
  assert.ok(audit.candidates>=1);
});

test('Subscription Auditor investigates a clear two-charge pattern in short history',()=>{
  const rows=[60,30].map(d=>tx('Netflix',25,d,{category:'subscription'}));
  const found=AGENTS.subscription_auditor.run({tx:rows,now:NOW});
  assert.equal(found.length,1);
  assert.equal(found[0].reviewOnly,true);
  assert.match(found[0].detail,/available history/);
});

test('wire fees are not overdrafts and overlapping imports are consolidated',()=>{
  const rows=[
    {...tx('Outgoing Wire Transfer Fee',25,4,{category:'fee'}),externalId:'plaid-1',instrumentId:'checking1',isFee:true},
    {...tx('Outgoing Wire Transfer Fee',25,4,{category:'fee'}),externalId:'csv-1',instrumentId:'checking1',isFee:true}
  ];
  const found=AGENTS.fee_catcher.run({tx:rows,now:NOW});
  assert.equal(found.length,1);
  assert.match(found[0].title,/wire transfer fee/i);
  assert.doesNotMatch(found[0].title,/overdraft/i);
  assert.equal(found[0].annualCents,2500);
  assert.equal(found[0].evidence.matchingRows,2);
  assert.equal(AGENTS.duplicate_watch.run({tx:rows,now:NOW,since:NOW-45*DAY}).length,0);
});

test('discretionary drift works when Plaid has no purchase times',()=>{
  const rows=[];
  for(let i=0;i<10;i++)rows.push({...tx('Restaurant recent '+i,100,2+i*3,{category:'dining'}),localHour:undefined});
  for(let i=0;i<10;i++)rows.push({...tx('Restaurant prior '+i,40,48+i*3,{category:'dining'}),localHour:undefined});
  const found=AGENTS.weekend_drift.run({tx:rows,now:NOW});
  assert.equal(found.length,1);
  assert.match(found[0].title,/increased/i);
  assert.equal(found[0].alertOnly,true);
});

test('Shop timeout fallback uses literal prices from live evidence only',()=>{
  const decision=fallbackDealDecision([
    {title:'Kids Coat — Example Store',url:'https://store.example/coat',content:'Today $79.99 with free returns'},
    {title:'No price article',url:'https://review.example/coat',content:'A good coat'}
  ]);
  assert.equal(decision.products.length,1);
  assert.equal(decision.products[0].price,79.99);
  assert.equal(decision.products[0].url,'https://store.example/coat');
});

test('Card Router counts only attributable, proven multiplier gaps',()=>{
  const rows=[tx('Restaurant A',1000,10,{instrumentId:'card1'}),tx('Restaurant B',1000,20,{instrumentId:'card2'})];
  const instruments=[{id:'card1',rail:'card_credit',cardKey:'amex_gold',displayName:'Gold'},
    {id:'card2',rail:'card_credit',cardKey:'citi_dc',displayName:'Double Cash'}];
  const found=AGENTS.card_router.run({tx:rows,now:NOW,instruments,cardRules:{dining:{amex_gold:4,citi_dc:2},default:{}}});
  assert.equal(found.length,1);
  assert.equal(found[0].evidence.misroutedPurchases,1);
  assert.equal(found[0].evidence.attributablePurchases,2);
});

test('Plaid Link requests the full supported history window',async()=>{
  const p=new Plaid({clientId:'id',secret:'secret'});
  let body;
  p.call=async(_path,b)=>{body=b;return {link_token:'x'};};
  await p.createLinkToken('me');
  assert.equal(body.transactions.days_requested,730);
});

test('custom shopping categories work without matching transaction history',()=>{
  const c=makeDealCategory({label:"Kids' clothes",context:'Two boys under 5; sizes 4T and 5T',kind:'family',budgetCents:15000,defaultDropPct:20});
  const presets=dealPresets([],NOW,[c]);
  assert.equal(presets[0].custom,true);
  assert.equal(presets[0].label,"Kids' clothes");
  assert.match(presets[0].asks[0],/Two boys under 5/);
  assert.equal(presets[0].defaultDropPct,20);
});

test('percentage price alerts produce deterministic buy-now and wait decisions',()=>{
  const rule=makeRule({name:'Winter coats',referencePriceCents:12000,alertDropPct:20,traits:[],source:'web'});
  assert.equal(rule.ceilingCents,9600);
  const wait=recommendWatch(rule,10500);
  assert.equal(wait.status,'wait');
  assert.equal(wait.triggered,false);
  const buy=recommendWatch(rule,9400);
  assert.equal(buy.status,'buy_now');
  assert.equal(buy.triggered,true);
  assert.equal(buy.dropPct,21.7);
});

test('email notifications escape untrusted product text',async()=>{
  const names=['NTFY_TOPIC','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','RESEND_API_KEY','NOTIFY_EMAIL'];
  const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  for(const k of names)delete process.env[k];
  process.env.RESEND_API_KEY='test';process.env.NOTIFY_EMAIL='owner@example.com';
  const oldFetch=global.fetch;let request;
  global.fetch=async(_url,init)=>{request=JSON.parse(init.body);return new Response('{}',{status:200});};
  try{
    const {notify}=await import(`../verafi/notify.js?escape=${Date.now()}`);
    await notify({title:'Price <script>',lines:['Coat <img src=x>'],url:'https://verafi.example'});
    assert.match(request.html,/Price &lt;script&gt;/);
    assert.match(request.html,/Coat &lt;img src=x&gt;/);
    assert.doesNotMatch(request.html,/<script>|<img/);
  }finally{
    global.fetch=oldFetch;
    for(const k of names)old[k]==null?delete process.env[k]:process.env[k]=old[k];
  }
});

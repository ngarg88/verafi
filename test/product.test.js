import assert from 'node:assert/strict';
import test from 'node:test';
import { isDealQuery, purchaseContext } from '../verafi/deals.js';
import { AGENTS, reviewAgents } from '../verafi/agents.js';
import { Plaid } from '../verafi/plaid.js';

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

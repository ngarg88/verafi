/**
 * VERAFI USER-ACCEPTANCE TEST
 *
 * Boots the real personal server against a temporary multi-account household and walks
 * every shipped capability through HTTP. No production data, keys or services are used.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DAY=86400000, NOW=Date.now(), PORT=18888, BASE=`http://127.0.0.1:${PORT}`;
const temp=mkdtempSync(join(tmpdir(),'verafi-uat-'));
const tx=(id,name,dollars,daysAgo,o={})=>({externalId:id,merchantId:name.toLowerCase().replace(/\W+/g,'-'),merchantName:name,
  amountCents:Math.round(dollars*100),postedAt:NOW-daysAgo*DAY,category:o.category??'other',
  instrumentId:o.instrumentId??'card-citi',isFee:o.isFee??false,source:o.source??'uat'});

const transactions=[];
for(const d of [60,30,2])transactions.push(tx(`netflix-${d}`,'Netflix',24.99,d,{category:'subscription'}));
for(let i=0;i<8;i++)transactions.push(tx(`adobe-${i}`,'Adobe Creative Cloud',i<4?39.99:59.99,210-i*30,{category:'subscription'}));
for(let i=0;i<8;i++)transactions.push(tx(`hulu-${i}`,'Hulu',17.99,210-i*30+2,{category:'subscription'}));
transactions.push(tx('wire-plaid','Outgoing Wire Transfer Fee',25,4,{category:'fee',instrumentId:'checking',isFee:true,source:'plaid'}));
transactions.push(tx('wire-csv','Outgoing Wire Transfer Fee',25,4,{category:'fee',instrumentId:'checking',isFee:true,source:'statement.csv'}));
transactions.push(tx('od-1','Chase Overdraft Fee',35,12,{category:'fee',instrumentId:'checking',isFee:true}));
for(let i=0;i<10;i++)transactions.push(tx(`dining-current-${i}`,`Restaurant Current ${i}`,100,2+i*3,{category:'dining',instrumentId:'card-citi'}));
for(let i=0;i<10;i++)transactions.push(tx(`dining-prior-${i}`,`Restaurant Prior ${i}`,40,48+i*3,{category:'dining',instrumentId:'card-amex'}));
transactions.push(tx('dup-a','Rare Furniture Store',67,8,{category:'shopping'}));
transactions.push(tx('dup-b','Rare Furniture Store',67,8,{category:'shopping'}));
transactions.push(tx('transfer','Wire Transfer To Savings',1500,5,{category:'transfer',instrumentId:'checking'}));

writeFileSync(join(temp,'verafi.json'),JSON.stringify({
  profile:{email:null,cashFloorCents:200000,linkedAt:NOW-400*DAY},
  connections:[{id:'con-1',provider:'plaid',institution:'UAT Bank',accounts:['Checking','Two cards'],linkedAt:NOW-400*DAY,historyDaysRequested:730,transactionsUpdateStatus:'HISTORICAL_UPDATE_COMPLETE'}],
  instruments:[
    {id:'checking',rail:'card_debit',displayName:'Checking ···1000',balanceCents:500000},
    {id:'card-amex',rail:'card_credit',displayName:'Gold ···2000',cardKey:'amex_gold'},
    {id:'card-citi',rail:'card_credit',displayName:'Double Cash ···3000',cardKey:'citi_dc'}
  ],transactions,agents:[],mandates:[],rules:[],runs:[],savings:[],savingsActions:[],cursors:{},customCategories:[],hunts:[],watchlist:[],findings:[],seenFindings:{},dismissed:{}
},null,2));

const child=spawn(process.execPath,['verafi/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',DATA_DIR:temp,
  AUTO_ENABLE_AGENTS:'1',AGENT_INTERVAL_HOURS:'24',ZERO_SPEND_MODE:'1',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',TAVILY_API_KEY:'',VERAFI_PASSCODE:''},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);

const wait=async()=>{for(let i=0;i<40;i++){try{if((await fetch(BASE+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('UAT server did not start\n'+logs);};
const get=async p=>{const r=await fetch(BASE+p);const j=await r.json();assert.equal(r.ok,true,`${p}: ${JSON.stringify(j)}`);return j;};
const post=async(p,b,expected=200)=>{const r=await fetch(BASE+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const j=await r.json();assert.equal(r.status,expected,`${p}: ${JSON.stringify(j)}`);return j;};
let passed=0;const ck=(name,fn)=>{fn();passed++;console.log(`  ok  ${name}`);};

try{
  await wait();
  const health=await get('/api/health');
  ck('startup and health',()=>assert.equal(health.ok,true));

  const state=await get('/api/state');
  ck('Home data contract',()=>{assert.ok(state.coverage.transactions>=transactions.length);assert.ok(state.agentReview.agents.length>=9);});
  ck('Home receives fresh agent findings on first load',()=>assert.ok(state.findings.length>=4));
  ck('multi-account coverage',()=>{assert.equal(state.coverage.cards,2);assert.equal(state.coverage.legacyConnections,0);});
  ck('Agents explain completed investigations',()=>assert.ok(state.agentReview.agents.every(a=>typeof a.result==='string'&&a.result.length>10)));

  const spend=await get('/api/spend?days=90');
  ck('Spend excludes transfers',()=>{assert.ok(spend.excluded.transferCents>=150000);assert.ok(spend.categories.some(c=>c.key==='dining'));});
  ck('Spend drill-down contract',()=>assert.ok(spend.categories.every(c=>Array.isArray(c.subs)&&Array.isArray(c.merchants))));

  const save=await get('/api/save');
  ck('Subscription review candidates',()=>assert.ok(save.reviewQueue.some(f=>f.agent==='subscription_auditor')));
  ck('Wire fee is not overdraft',()=>{const f=save.opportunities.find(f=>/wire transfer fee/i.test(f.title));assert.ok(f);assert.doesNotMatch(f.title,/overdraft/i);});
  ck('Overlapping wire imports count once',()=>assert.equal(save.opportunities.filter(f=>/wire transfer fee/i.test(f.title)).length,1));
  ck('Actual agent findings surface',()=>assert.ok(save.opportunities.length+save.reviewQueue.length>=4));
  ck('Card routing uses proven card attribution',()=>assert.ok(save.opportunities.some(f=>f.agent==='card_router')));
  ck('Discretionary drift works without time-of-day',()=>assert.ok(save.alerts.some(f=>f.agent==='weekend_drift')));
  ck('Behavioral alerts cannot be claimed as savings',()=>assert.ok(save.opportunities.every(f=>!f.alertOnly)));

  const candidate=save.reviewQueue.find(f=>f.agent==='subscription_auditor');
  const started=await post('/api/save/actions/start',{findingKey:`${candidate.agent}:${candidate.ref}`});
  ck('Review candidate starts an action without counting savings',()=>{assert.equal(started.action.status,'action_started');assert.equal(started.action.verifiedAt,null);});
  await post('/api/save/actions/verify',{id:started.action.id,confirmed:true},422);
  ck('Savings cannot be verified without outcome proof',()=>assert.ok(true));
  await post('/api/save/actions/await',{id:started.action.id});
  const awaitingSave=await get('/api/save');
  ck('Active action leaves decision queue and awaits proof',()=>{assert.ok(awaitingSave.actions.some(a=>a.id===started.action.id&&a.status==='awaiting_verification'));assert.ok(!awaitingSave.reviewQueue.some(f=>`${f.agent}:${f.ref}`===started.action.findingKey));assert.equal(awaitingSave.verifiedTotalCents,0);});
  const verified=await post('/api/save/actions/verify',{id:started.action.id,confirmed:true,proofKind:'cancellation_confirmation'});
  ck('Verified outcome alone creates savings',()=>{assert.equal(verified.action.status,'verified');assert.equal(verified.verifiedTotalCents,candidate.amountCents*12);});
  await post('/api/save/claim',{amountCents:9999,method:'subscription_cancel',evidence:{kind:'manual'}},410);
  ck('Legacy one-click claim path is disabled',()=>assert.ok(true));

  const cards=await get('/api/cards');
  ck('Cards recommendation contract',()=>{assert.equal(cards.instruments.length,2);assert.ok(cards.rules.dining.amex_gold>cards.rules.dining.citi_dc);});

  const category=await post('/api/deals/categories',{label:"Kids' clothes",context:'Two boys under 5; sizes 4T and 5T',kind:'family',budgetCents:15000,defaultDropPct:20});
  const presets=await get('/api/deals/presets');
  ck('Custom Shop category persists',()=>assert.ok(presets.categories.some(c=>c.key===category.category.key&&c.defaultDropPct===20)));
  await post('/api/deals/categories',{label:'',context:'x',budgetCents:0},422);
  ck('Invalid category is rejected',()=>assert.ok(true));

  const hunt=await post('/api/hunts',{name:'Winter coats',referencePriceCents:12000,alertDropPct:20,traits:['sizes 4T and 5T'],source:'web',category:category.category.key});
  ck('Percentage alert calculates exact trigger',()=>assert.equal(hunt.hunt.ceilingCents,9600));
  const hunts=await get('/api/hunts');
  ck('Price watch persists with buy/wait state',()=>{assert.equal(hunts.hunts.length,1);assert.equal(hunts.hunts[0].recommendation.status,'monitoring');});
  await post('/api/hunts',{name:'Bad alert',referencePriceCents:10000,alertDropPct:95},422);
  ck('Unsafe alert threshold is rejected',()=>assert.ok(true));

  const held=await post('/api/deals/hold',{title:'Winter Coat',url:'https://merchant.example/coat',priceCents:12000,targetCents:9600,category:category.category.key});
  const approval=await post('/api/deals/approve',{id:held.item.id});
  ck('Shop merchant handoff remains direct',()=>{assert.equal(approval.handoff.method,'merchant_checkout');assert.equal(approval.handoff.url,'https://merchant.example/coat');});
  await post('/api/deals/drop',{id:held.item.id});
  const emptiedWatchlist=await get('/api/deals/watchlist');
  ck('Saved product can be removed',()=>assert.equal(emptiedWatchlist.items.length,0));

  const research=await get('/api/research');
  ck('Research agents are available',()=>assert.ok(research.presets.length>=5));
  const localAsk=await post('/api/ask',{preset:'subscriptions',query:'What subscriptions overlap?'});
  ck('Local research returns evidence without web',()=>assert.ok(Array.isArray(localAsk.evidence)));

  const run=await post('/api/agents/run',{});
  ck('Manual agent rerun completes',()=>assert.ok(Array.isArray(run.findings)&&run.findings.length>=4));
  const runs=await get('/api/runs');
  ck('Activity log records the run',()=>assert.ok(runs.runs.some(r=>r.intentText==='agents')));

  const html=await fetch(BASE+'/').then(r=>r.text());
  const app=await fetch(BASE+'/app.js').then(r=>r.text());
  ck('App shell and versioned assets serve',()=>{assert.match(html,/app\.js\?v=/);assert.match(app,/function viewHome/);});

  console.log(`\nUAT verified ${passed} cross-capability user stories`);
} finally {
  child.kill('SIGTERM');
  rmSync(temp,{recursive:true,force:true});
}

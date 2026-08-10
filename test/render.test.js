/**
 * RENDER-PATH TEST
 *
 * The bug I kept shipping: verifying that an endpoint returns 200 and calling it done,
 * when what actually matters is whether the answer reaches the screen. Twice the API was
 * perfect and the app looked dead. This runs the real client code against realistic
 * server responses and asserts the text lands in the DOM.
 *
 *   node test/render.test.js
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const js=fs.readFileSync(path.join(__dirname,'..','verafi','public','app.js'),'utf8');
function El(i){return{id:i,innerHTML:'',value:'',className:'',children:[],style:{},
  classList:{add(){},remove(){},toggle:()=>true},appendChild(c){this.children.push(c)},
  addEventListener(){},insertAdjacentHTML(p,h){this.innerHTML=h+this.innerHTML},focus(){}};}
const els={};['app','tabs','q','pc'].forEach(i=>els[i]=El(i));
const openCalls=[],alertCalls=[];
const ctx={document:{getElementById:i=>els[i]||null,createElement:()=>El('t'),
    querySelector:()=>({setAttribute(){}}),querySelectorAll:()=>[],
    documentElement:{style:{setProperty(){}}},body:{className:'',classList:{toggle:()=>1,add(){},remove(){}}}},
  console,setTimeout:(f)=>{},clearTimeout(){},Math,Date,JSON,Number,String,Object,Array,URL,
  matchMedia:()=>({matches:false}),fetch:async()=>({ok:true,json:async()=>({}),text:async()=>''}),
  alert:x=>alertCalls.push(x),prompt(){return null},confirm(){return false},open:(...x)=>openCalls.push(x),scrollTo(){},AbortController:class{constructor(){this.signal={}}abort(){}}};
ctx.window=ctx; vm.createContext(ctx); vm.runInContext(js,ctx);
vm.runInContext('globalThis.__S=S;',ctx); const S=ctx.__S;

let fail=0; const ck=(n,c,x='')=>{console.log((c?'  ok  ':'  FAIL')+'  '+n+(x?'  — '+x:''));if(!c)fail++};

// realistic state, as the server actually returns it
S.locked=false;
S.state={version:'v15',llm:true,linked:true,transactions:161,agents:[{id:'agt_sub',name:'Subscription Auditor',surface:'save',capability:'recommend',enabled:true}],connections:[],instruments:[],findings:[],runs:[],
  llmProvider:{provider:'openrouter',allowPersonal:false},coverage:{transactions:161,historyDays:365,cards:3,categorisedPct:96,perInstrument:[]},
  agentReview:{coverage:{transactions:161,days:365,attributableToAccount:150},agents:[{id:'subscription_auditor',label:'Subscription Auditor',enabled:true,candidates:5,confirmed:0,needsReview:1,scope:'fixed recurring charges',next:'Review active candidates'}]}};
S.spend={totalCents:2792200,categories:[{key:'bills',label:'Bills',icon:'📄',cents:1834400,share:65.7,subs:[{key:'rent',cents:1,count:1}],merchants:[{name:'X',cents:1,count:1,sub:'rent'}]}],recent:[],excluded:{},uncategorisedShare:2.5};
S.save={verifiedTotalCents:0,events:[],opportunities:[],reviewQueue:[],recurringAnnualCents:0};
S.forecast={months:Array.from({length:12},(_,i)=>({month:i,projectedCents:300000-i*100,bandLowCents:290000,bandHighCents:310000}))};
S.dealCats=[{key:'travel',icon:'✈️',label:'Travel',basis:'You spent $6,200 here',budget:2763,asks:['Best value trip under $2763 for my family']}];
S.watchlist=[]; S.hunts=[]; S.unknowns=[]; S.taxonomy=[]; S.presets=[]; S.insight=null; S.cards={instruments:[],cardKeys:[]};

// ---- THE ACTUAL QUESTION: does an answer render? ----
S.tab='ask';
S.answer={ agent:'overpay', label:'What am I overpaying for?', icon:'📈',
  answer:'3 merchants have got more expensive for you over time:',
  evidence:['Safeway · $62.31 → $103.80 (+67%) across 16 purchases','Uber · $21.84 → $44.71'],
  steps:[{tool:'context.load',detail:'read 71 transactions'}],
  disclaimer:'Research only.', latencyMs:12, ok:false };
ctx.render();
const h1=els.app.innerHTML;
ck('answer text renders', h1.includes('more expensive for you over time'));
ck('evidence renders', h1.includes('Safeway') && h1.includes('103.80'));
ck('steps render', h1.includes('read 71 transactions'));
ck('disclaimer renders', h1.includes('Research only'));

// deal answer with the no-key path
S.answer={ agent:'deal', label:'Deal research', ok:false,
  answer:'Deal research needs live prices from the web, and no API key is configured.',
  howToFix:['Get a key at console.anthropic.com','Add ANTHROPIC_API_KEY'], evidence:[],
  steps:[{tool:'web.search',detail:'unavailable'}], disclaimer:'Research only.' };
ctx.render();
const h2=els.app.innerHTML;
ck('no-key answer renders', h2.includes('no API key is configured'));
ck('setup steps render', h2.includes('console.anthropic.com'));

// error path
S.answer=null; S.error='That took over 30 seconds and was stopped.';
ctx.render();
ck('error renders', els.app.innerHTML.includes('over 30 seconds'));

// busy state
S.error=null; S.busy=true; ctx.render();
ck('busy state shows', els.app.innerHTML.includes('Researching'));

// structured Shop results render as a dedicated decision workspace with real actions
S.busy=false; S.lastQuery='lightweight carry-on suitcase under $150';
S.answer={kind:'deal',label:'Deal research',ok:true,evidence:['Amazon — https://amazon.com'],decision:{
  summary:'The best balance of weight and value.',products:[
    {name:'Samsonite Freeform Carry-On',label:'Best overall',price:139.99,seller:'Amazon',url:'https://amazon.com/item',highlights:['7.8 lbs','Hardside'],shipping:'Free shipping',tradeoff:'A little heavier.'},
    {name:'Travelpro Maxlite 5',label:'Lightest',price:144.49,seller:'Travelpro',url:'https://travelpro.com/item',highlights:['5.4 lbs','Softside'],shipping:'Free shipping',tradeoff:'Higher price.'}
  ]}};
ctx.render(); const shop=els.app.innerHTML;
ck('structured Shop results render',shop.includes('Best match')&&shop.includes('Samsonite Freeform'));
ck('Shop actions render',shop.includes('Buy at Amazon')&&shop.includes('Watch price')&&shop.includes('Save'));
ck('results replace the Shop homepage',!shop.includes('Price watches')&&!shop.includes('Your categories'));

// category drill-in still renders the ask surface
S.openDeal='travel'; S.answer=null; ctx.render();
const h3=els.app.innerHTML;
ck('category detail renders', h3.includes('Travel') && h3.includes('2763'));
ck('preset question renders', h3.includes('Best value trip'));

// every tab renders without throwing
S.openDeal=null;
S.watchlist=[{id:'w1',title:'Example Carry-On',url:'https://merchant.example/item',foundPriceCents:12999,currentPriceCents:12999,targetCents:11999}];
await vm.runInContext("approveDeal('w1')",ctx);
ck('buy action opens merchant directly',openCalls.some(x=>String(x[0]).startsWith('https://merchant.example/item'))&&alertCalls.length===0,JSON.stringify({openCalls,alertCalls}));
S.save.reviewQueue=[{agent:'subscription_auditor',ref:'subscription:netflix',title:'Review Netflix',detail:'Fixed monthly charge.',amountCents:2499,annualCents:29988,confidence:.9,reviewOnly:true}];
for (const t of ['ask','spend','save','wallet','agent','settings']) {
  try { S.tab=t; ctx.render(); ck('tab renders: '+t, els.app.innerHTML.length>200, els.app.innerHTML.length+' chars'); }
  catch(e){ ck('tab renders: '+t, false, e.message); }
}
S.tab='save';ctx.render();ck('review candidates are visible and not called savings',els.app.innerHTML.includes('Needs your review')&&els.app.innerHTML.includes('not claimed savings'));
S.tab='agent';ctx.render();ck('agent coverage and candidate depth render',els.app.innerHTML.includes('Transactions reviewed')&&els.app.innerHTML.includes('5 candidates'));
S.tab='settings';ctx.render();ck('per-source data coverage renders',els.app.innerHTML.includes('Data coverage')&&els.app.innerHTML.includes('365'));
console.log('\n'+(fail?fail+' FAILURES':'render path verified — answers reach the DOM'));
process.exit(fail?1:0);

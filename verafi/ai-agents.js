import { expensesOnly } from './classify.js';
import { normalizeTransactions } from './categories.js';
import { complete, providerInfo } from './llm.js';

const DAY = 86400000;
const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
const signature = f => JSON.stringify([f.amountCents, f.annualCents, f.title, f.evidence]);
const findingKey = f => `${f.agent}:${f.ref}`;

function parseObject(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return structured JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Run user-authored AI investigations in one bounded model call. The model may select
 * and interpret evidence; code owns transaction identity, dollar totals and suppression.
 */
export async function runAIAgents({ store, now=Date.now(), meter }) {
  const D = store.data;
  const defs = (D.customAgents ?? []).filter(a => a.enabled && a.method === 'ai');
  if (!defs.length) return { findings:[], fresh:[], status:'no_agents' };

  const info = providerInfo();
  if (!info.available || !info.allowPersonal) {
    for (const a of defs) Object.assign(a, { lastRunAt:now, lastStatus:'blocked',
      blocker:!info.available?'Connect a private AI provider to run this agent.':'The selected provider is not approved for personal financial data.' });
    store.save();
    return { findings:[], fresh:[], status:'blocked', blocker:defs[0].blocker };
  }

  const tx = normalizeTransactions(expensesOnly(D.transactions ?? []), D.learned)
    .filter(t => t.postedAt >= now - 365*DAY && t.amountCents > 0)
    .sort((a,b) => b.postedAt-a.postedAt).slice(0,500);
  const packet = tx.map(t => ({ id:t.externalId, date:new Date(t.postedAt).toISOString().slice(0,10),
    merchant:t.merchantName ?? t.merchantId, category:t.category, amountCents:t.amountCents,
    account:t.instrumentId ?? null }));
  const goals = defs.map(a => ({ id:a.id, name:a.name, goal:a.goal }));
  const out = await complete({ meter, maxTokens:2400, json:false, sensitivity:'personal',
    system:`You operate user-created investigation agents inside a personal-finance app. Analyze only the supplied transactions.
For each agent, determine whether the evidence supports one useful result. Do not invent transactions, refunds, merchant facts, usage, intent, or savings. A charge is not proof of waste. If the goal cannot be answered from transactions, return a blocker or a question instead of a finding.
Return ONLY JSON with this shape:
{"agents":[{"id":"exact agent id","status":"finding|clear|needs_input","summary":"one concise sentence","question":"only when needed","finding":{"title":"concise","detail":"new information only","transactionIds":["exact supplied id"],"confidence":0.0}}]}
Rules: transactionIds must be exact supplied IDs; omit finding unless status is finding; never calculate or state a dollar amount; at most one finding per agent; no generic advice or repeated commentary.`,
    user:`Agents:\n${JSON.stringify(goals)}\n\nTransactions (amounts are cents):\n${JSON.stringify(packet)}` });

  if (!out.ok) {
    for (const a of defs) Object.assign(a,{lastRunAt:now,lastStatus:'failed',blocker:`AI run failed: ${out.reason}`});
    store.save(); return { findings:[],fresh:[],status:'failed',blocker:out.reason };
  }

  let parsed;
  try { parsed=parseObject(out.text); }
  catch (e) { for (const a of defs) Object.assign(a,{lastRunAt:now,lastStatus:'failed',blocker:e.message}); store.save(); return {findings:[],fresh:[],status:'failed',blocker:'bad_json'}; }
  const byId = new Map(tx.map(t => [String(t.externalId),t]));
  const results = new Map((parsed.agents ?? []).map(r => [r.id,r]));
  const findings=[], fresh=[]; D.seenFindings ??= {}; D.dismissed ??= {};
  for (const a of defs) {
    const r=results.get(a.id);
    a.lastRunAt=now; a.lastStatus=['finding','clear','needs_input'].includes(r?.status)?r.status:'failed';
    a.lastSummary=String(r?.summary ?? '').slice(0,240); a.followUp=String(r?.question ?? '').slice(0,240)||null;
    a.blocker=a.lastStatus==='needs_input'?a.followUp:a.lastStatus==='failed'?'The AI response was incomplete.':null;
    if (a.lastStatus!=='finding' || !r.finding) continue;
    const ids=[...new Set((r.finding.transactionIds??[]).map(String))].filter(id=>byId.has(id)).slice(0,50);
    if (!ids.length) { a.lastStatus='failed';a.blocker='The AI result did not cite valid transaction evidence.';continue; }
    const rows=ids.map(id=>byId.get(id)), total=rows.reduce((n,t)=>n+t.amountCents,0);
    const f={agent:`custom:${a.id}`,ref:`${a.id}:${ids.slice().sort().join('|')}`,
      title:String(r.finding.title??a.name).slice(0,100),
      detail:`${String(r.finding.detail??r.summary??'').slice(0,360)} Evidence: ${ids.length} transaction${ids.length===1?'':'s'} totaling ${money(total)}.`,
      amountCents:total,annualCents:total,oneOff:true,alertOnly:true,action:'review',confidence:Math.max(0,Math.min(1,Number(r.finding.confidence)||0)),
      evidence:{transactionIds:ids,count:ids.length,totalCents:total,agentGoal:a.goal,provider:out.provider}};
    const dismissed=D.dismissed[findingKey(f)];
    if (dismissed&&typeof dismissed==='object'&&dismissed.signature===signature(f)) continue;
    findings.push(f); if(!D.seenFindings[findingKey(f)]){D.seenFindings[findingKey(f)]=now;fresh.push(f);}
  }
  const customIds=new Set(defs.map(a=>`custom:${a.id}`));
  D.findings=[...(D.findings??[]).filter(f=>!customIds.has(f.agent)),...findings]
    .sort((a,b)=>b.annualCents-a.annualCents).slice(0,100);
  store.save();
  return {findings,fresh,status:'completed',provider:out.provider,costUsd:out.costUsd};
}

const $ = (id) => document.getElementById(id);
const api = async (p, body) => {
  const r = await fetch(p, body ? { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? 'request failed');
  return j;
};
const $m = (c) => (c/100).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});
const $m0 = (c) => (c/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const title = (s) => String(s ?? '').replace(/[-_]/g,' ').replace(/\b\w/g, m => m.toUpperCase());

const S = { tab:'ask', locked:false, state:null, cards:null, spend:null, save:null, forecast:null, busy:false, error:null };

const ICONS = {
  ask:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  spend:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 9.5h20"/>',
  save:'<path d="M12 3v18"/><path d="M17 7.5c0-2-2.2-3-5-3s-5 1-5 3 2.2 2.7 5 3.3 5 1.4 5 3.4-2.2 3.3-5 3.3-5-1.2-5-3.2"/>'
};

async function load() {
  try { S.state = await api('/api/state'); S.locked = false; }
  catch (e) { if (/locked/i.test(e.message)) { S.locked = true; S.state = null; return render(); } throw e; }
  if (S.state.linked) {
    const [sp, sv, fc, cd] = await Promise.all([api('/api/spend?days=30'), api('/api/save'), api('/api/forecast'), api('/api/cards')]);
    Object.assign(S, { spend:sp, save:sv, forecast:fc, cards:cd });
  }
  render();
}

/* ---------------------------------------------------------------- lock */
function viewLock() {
  return `
  <div style="padding-top:22vh;text-align:center">
    <h1>Verafi</h1>
    <p class="tiny muted" style="margin-top:8px">Enter your passcode</p>
    <div style="max-width:240px;margin:18px auto 0">
      <input id="pc" type="password" inputmode="numeric" autocomplete="current-password"
             placeholder="passcode" style="text-align:center"
             onkeydown="if(event.key==='Enter')unlock()"/>
      <button class="btn go" onclick="unlock()">Unlock</button>
    </div>
    ${S.error ? `<div class="err" style="max-width:240px;margin:12px auto">${esc(S.error)}</div>` : ''}
  </div>`;
}
async function unlock() {
  S.error = null;
  try {
    await api('/api/auth', { passcode: $('pc').value });
    S.locked = false; await load();
  } catch (e) { S.error = 'That passcode did not work.'; render(); }
}

/* ---------------------------------------------------------------- onboarding */
function viewOnboard() {
  const st = S.state;
  return `
  <div class="top"><h1>Verafi</h1><span class="sp"></span>
    <button class="chipbtn" onclick="toggleTheme()">◐</button></div>
  <p class="muted" style="font-size:14px;line-height:1.6">Connect your accounts and I'll tell you what you're wasting. Your data stays on this machine — the only thing that leaves is the request to your bank.</p>

  <div class="sec"><span class="lbl">Option 1 · live connection</span></div>
  <div class="card">
    <div style="font-weight:650;font-size:14px">Connect a bank with Plaid</div>
    <div class="tiny muted" style="margin-top:6px;line-height:1.55">
      ${st.plaidConfigured
        ? `Running in <b>${st.plaidEnv}</b> mode.${st.plaidEnv==='sandbox' ? ' Use <code>user_good</code> / <code>pass_good</code> to test with fake data.' : ' This will connect your <b>real</b> accounts.'}`
        : 'Not configured yet. Copy <code>verafi/.env.example</code> → <code>verafi/.env</code> and add your Plaid keys.'}
    </div>
    <button class="btn ${st.plaidConfigured?'go':''}" ${st.plaidConfigured?'':'disabled'} onclick="linkPlaid()">
      ${st.plaidConfigured ? 'Connect with Plaid' : 'Add Plaid keys first'}</button>
  </div>

  <div class="sec"><span class="lbl">Option 2 · no third party at all</span></div>
  <div class="card">
    <div style="font-weight:650;font-size:14px">Import a CSV or OFX from your bank</div>
    <div class="tiny muted" style="margin-top:6px;line-height:1.55">Every US bank lets you export statements. Nobody but you ever sees your credentials, and it costs nothing. Good enough to test the whole product today.</div>
    <div class="drop" id="drop" style="margin-top:12px" onclick="$('file').click()">
      Drop a .csv / .ofx / .qfx here<br/><span class="tiny">or tap to choose</span>
    </div>
    <input type="file" id="file" accept=".csv,.ofx,.qfx,.txt" style="display:none" onchange="importFiles(this.files)"/>
  </div>
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

/* ---------------------------------------------------------------- ask */
function viewAsk() {
  const sv = S.save, st = S.state;
  const opp = sv?.totalAnnualOpportunityCents ?? 0;
  return `
  <div class="top"><h1>Verafi</h1><span class="sp"></span>
    <button class="chipbtn" onclick="runAgentsNow()">${S.busy?'<span class="spin"></span>':'↻ run'}</button>
    <button class="chipbtn" onclick="S.tab='settings';render();scrollTo(0,0)">⚙</button>
    <button class="chipbtn" onclick="toggleTheme()">◐</button></div>

  <div class="card" style="background:linear-gradient(160deg,color-mix(in srgb,var(--save) 8%,transparent),transparent 70%),var(--card)">
    <div class="tiny muted">Found in your accounts</div>
    <div class="big ${opp?'ok':''}" style="margin-top:5px">${$m0(opp)}<span style="font-size:15px;font-family:ui-sans-serif" class="muted"> / year</span></div>
    <div class="tiny muted" style="margin-top:8px">${sv?.opportunities.length ?? 0} things worth fixing · ${st.transactions} transactions read</div>
  </div>

  ${(st.findings ?? []).length ? `
  <div class="sec"><span class="lbl">Your agents found</span>
    <button class="act" onclick="runAgentsNow()">${S.busy?'running…':'run now'}</button></div>
  ${st.findings.slice(0,6).map(f=>`
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div style="font-weight:650;font-size:14px">${esc(f.title)}</div>
          <div class="tiny muted" style="margin-top:5px;line-height:1.55">${esc(f.detail)}</div>
          <div class="tiny" style="margin-top:7px;color:var(--dim)">${esc(f.agent.replace(/_/g,' '))}</div>
        </div>
        <div style="text-align:right;flex:0 0 auto">
          <div style="font-weight:700;color:var(--save)">${$m0(f.annualCents)}</div>
          <div class="tiny muted">a year</div>
        </div>
      </div>
      <button class="btn ghost" onclick="dismiss('${f.agent}:${String(f.ref).replace(/'/g,"")}')">Dismiss</button>
    </div>`).join('')}` : `
  <div class="sec"><span class="lbl">Your agents</span>
    <button class="act" onclick="runAgentsNow()">${S.busy?'running…':'run now'}</button></div>
  <div class="card"><div class="tiny muted">No findings yet. Switch on an agent below, then tap <b>run now</b>.</div></div>`}

  <div class="sec"><span class="lbl">Biggest wins</span><span class="act">By annual value</span></div>
  ${(sv?.opportunities ?? []).slice(0,5).map((o,i)=>`
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <div class="dot">${o.kind==='cancel'?'✕':o.kind==='fees'?'$':'↻'}</div>
        <div class="grow">
          <div style="font-weight:650;font-size:14px">${title(o.merchant)}</div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${esc(o.evidence)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--save)">${$m0(o.annualCents)}</div>
          <div class="tiny muted">a year</div>
        </div>
      </div>
      <button class="btn ghost" onclick="claim(${i})">I did this — count it</button>
    </div>`).join('') || '<div class="card"><div class="empty tiny">Nothing found yet. Import more history.</div></div>'}

  <div class="sec"><span class="lbl">Agents watching</span><span class="act">${(st.agents??[]).filter(a=>a.enabled).length} on</span></div>
  ${(st.agents ?? []).map(a=>`
    <div class="card" style="${a.enabled?'':'opacity:.6'}">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div class="row" style="gap:6px"><span style="font-weight:650;font-size:13.5px">${esc(a.name)}</span>
            <span class="badge b-spend">${a.surface}</span></div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.5"><b>Learned:</b> ${esc(a.evidence)}</div>
          ${a.confidence!=null?`<div class="row" style="margin-top:7px;gap:7px">
            <div class="bar" style="width:56px;margin:0"><i style="width:${a.confidence*100}%"></i></div>
            <span class="tiny" style="color:var(--dim)">${Math.round(a.confidence*100)}% confident</span></div>`:''}
        </div>
        <div class="tog ${a.enabled?'on':''}" onclick="toggleAgent('${a.id}',${!a.enabled})"><i></i></div>
      </div>
    </div>`).join('')}
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

/* ---------------------------------------------------------------- spend */
function viewSpend() {
  const sp = S.spend, fc = S.forecast;
  const cats = Object.entries(sp?.byCategoryCents ?? {}).sort((a,b)=>b[1]-a[1]);
  const max = cats[0]?.[1] ?? 1;
  return `
  <div class="top"><h1>Spend</h1><span class="sp"></span>
    <button class="chipbtn" onclick="refresh()">${S.busy?'<span class="spin"></span>':'↻'}</button></div>
  <div class="tiny muted">Last 30 days · ${sp?.recent.length ?? 0} transactions</div>

  <div class="card"><div class="tiny muted">Total out</div>
    <div class="big" style="margin-top:4px">${$m0(sp?.totalCents ?? 0)}</div></div>

  <div class="sec"><span class="lbl">By category</span></div>
  <div class="card">
    ${cats.map(([c,v],i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
      <div class="grow"><div class="row"><span style="font-size:13.5px;font-weight:600" class="grow">${title(c)}</span>
        <span class="tiny muted">${$m0(v)}</span></div>
        <div class="bar"><i style="width:${v/max*100}%"></i></div></div></div>`).join('') || '<div class="tiny muted">No data yet</div>'}
  </div>

  ${fc ? `<div class="sec"><span class="lbl">12-month forecast</span><span class="act">With bands</span></div>
  <div class="card">
    ${sparkline(fc.months)}
    <div class="tiny muted" style="margin-top:11px;padding-top:11px;border-top:1px solid var(--line);line-height:1.6">
      If you act on what's in Save, monthly spend trends from <b>${$m0(fc.months[0].projectedCents)}</b> to
      <b class="ok">${$m0(fc.months[11].projectedCents)}</b>. Shaded band is the honest uncertainty —
      the wide part is the bit that needs <i>you</i> to change, not just the app.
    </div>
  </div>` : ''}

  <div class="sec"><span class="lbl">Top merchants</span></div>
  <div class="card">
    ${(sp?.topMerchants ?? []).map(([n,v],i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
      <div class="dot">${esc(String(n).trim()[0] ?? '?').toUpperCase()}</div>
      <div class="grow" style="font-size:13px;font-weight:600">${esc(n)}</div>
      <div style="font-size:13px;font-weight:650">${$m0(v)}</div></div>`).join('')}
  </div>

  <div class="sec"><span class="lbl">Recent</span></div>
  <div class="card">
    ${(sp?.recent ?? []).slice(0,25).map((t,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
      <div class="grow"><div style="font-size:13px;font-weight:600">${esc(t.merchantName ?? t.merchantId)}</div>
        <div class="tiny muted" style="margin-top:2px">${title(t.category)} · ${new Date(t.postedAt).toLocaleDateString()}</div></div>
      <div style="font-size:13px;font-weight:650">${$m(t.amountCents)}</div></div>`).join('')}
  </div>`;
}

function sparkline(months) {
  const W=320,H=90,P=4;
  const all = months.flatMap(m=>[m.bandLowCents,m.bandHighCents]);
  const mn=Math.min(...all)*0.97, mx=Math.max(...all)*1.03;
  const x=(i)=>P+i*(W-2*P)/(months.length-1), y=(v)=>H-P-((v-mn)/(mx-mn))*(H-2*P);
  const line=(k)=>months.map((m,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(m[k]).toFixed(1)).join(' ');
  const band='M'+months.map((m,i)=>x(i).toFixed(1)+' '+y(m.bandHighCents).toFixed(1)).join(' L')
    +' L'+months.slice().reverse().map((m,i)=>x(months.length-1-i).toFixed(1)+' '+y(m.bandLowCents).toFixed(1)).join(' L')+' Z';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
    <path d="${band}" fill="var(--save)" opacity=".14"/>
    <path d="${line('projectedCents')}" fill="none" stroke="var(--save)" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}

/* ---------------------------------------------------------------- save */
function viewSave() {
  const sv = S.save;
  return `
  <div class="top"><h1>Save</h1><span class="sp"></span></div>
  <div class="tiny muted">Only counts once you've actually done it</div>

  <div class="card" style="border-color:var(--save)">
    <div class="tiny muted">Confirmed saved</div>
    <div class="big ok" style="margin-top:4px">${$m(sv?.verifiedTotalCents ?? 0)}</div>
    <div class="tiny muted" style="margin-top:8px">${sv?.events.length ?? 0} recorded · ${$m0(sv?.totalAnnualOpportunityCents ?? 0)}/yr still on the table</div>
  </div>

  <div class="sec"><span class="lbl">Everything found</span></div>
  ${(sv?.opportunities ?? []).map((o,i)=>`
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div class="row" style="gap:6px"><span style="font-weight:650;font-size:13.5px">${title(o.merchant)}</span>
            <span class="badge ${o.kind==='cancel'?'b-warn':'b-spend'}">${o.kind.replace('_',' ')}</span></div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${esc(o.evidence)}</div>
        </div>
        <div style="text-align:right"><div style="font-weight:700;color:var(--save)">${$m0(o.annualCents)}</div>
          <div class="tiny muted">${$m0(o.monthlyCents)}/mo</div></div>
      </div>
      <button class="btn ghost" onclick="claim(${i})">Count it</button>
    </div>`).join('')}

  ${sv?.events.length ? `<div class="sec"><span class="lbl">Ledger</span></div>
  <div class="card">${sv.events.map((e,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
    <div class="grow"><div style="font-size:13px;font-weight:600">${title(e.method)}</div>
      <div class="tiny muted" style="margin-top:2px">${new Date(e.createdAt).toLocaleDateString()} · ${esc(e.evidence?.note ?? e.evidence?.kind ?? '')}</div></div>
    <div style="font-weight:700;color:var(--save)">${$m(e.amountCents + e.amountCents*e.recurringMonths)}</div></div>`).join('')}</div>`:''}`;
}

/* ---------------------------------------------------------------- settings */
function viewSettings() {
  const st = S.state, cards = S.cards;
  return `
  <div class="top"><button class="chipbtn" onclick="S.tab='ask';render()">← Back</button>
    <span class="sp"></span><h1 style="font-size:20px">Setup</h1></div>

  <div class="sec"><span class="lbl">Linked accounts</span>
    <button class="act" onclick="refresh()">${S.busy?'syncing…':'sync now'}</button></div>
  ${(st.connections ?? []).length ? st.connections.map(c=>`
    <div class="card"><div class="row">
      <div class="dot">🏦</div>
      <div class="grow"><div style="font-weight:650;font-size:13.5px">${esc(c.institution)}</div>
        <div class="tiny muted" style="margin-top:3px">${(c.accounts??[]).length} account(s) · linked ${new Date(c.linkedAt).toLocaleDateString()}</div></div>
    </div></div>`).join('')
    : '<div class="card"><div class="tiny muted">No live connection yet — you\'re running on imported files.</div></div>'}

  <div class="card">
    ${st.plaidConfigured
      ? `<div class="tiny muted" style="line-height:1.55">Plaid is configured in <b>${st.plaidEnv}</b> mode.${st.plaidEnv==='sandbox'?' Test with <code>user_good</code> / <code>pass_good</code>.':''}</div>
         <button class="btn go" onclick="linkPlaid()">Link ${st.connections?.length?'another':'an'} account</button>`
      : `<div class="tiny muted" style="line-height:1.55">To link a bank, add your Plaid keys to <code>verafi/.env</code> and restart. Until then, import CSV files.</div>`}
    <button class="btn ghost" onclick="$('file2').click()">Import a CSV / OFX file</button>
    <input type="file" id="file2" multiple accept=".csv,.ofx,.qfx,.txt" style="display:none" onchange="importFiles(this.files)"/>
  </div>

  ${cards?.instruments?.length ? `
  <div class="sec"><span class="lbl">Which card is which</span></div>
  <div class="card">
    <div class="tiny muted" style="margin-bottom:10px;line-height:1.55">Card Router can't tell your cards apart from a bank feed. Tag them here and it'll tell you which one to use where.</div>
    ${cards.instruments.map(i=>`
      <div class="li"><div class="grow">
        <div style="font-size:13px;font-weight:600">${esc(i.displayName)}</div>
        <select style="margin-top:6px" onchange="setCard('${i.id}',this.value)">
          <option value="">— not set —</option>
          ${cards.cardKeys.map(k=>`<option value="${k}" ${i.cardKey===k?'selected':''}>${k.replace(/_/g,' ')}</option>`).join('')}
        </select></div></div>`).join('')}
  </div>` : ''}

  <div class="sec"><span class="lbl">Agents</span>
    <button class="act" onclick="runAgentsNow()">${S.busy?'running…':'run all now'}</button></div>
  ${(st.agents ?? []).map(a=>`
    <div class="card" style="${a.enabled?'':'opacity:.62'}">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div class="row" style="gap:6px"><span style="font-weight:650;font-size:13.5px">${esc(a.name)}</span>
            <span class="badge b-spend">${a.surface}</span></div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${esc(a.evidence)}</div>
        </div>
        <div class="tog ${a.enabled?'on':''}" onclick="toggleAgent('${a.id}',${!a.enabled})"><i></i></div>
      </div>
    </div>`).join('')}

  <div class="sec"><span class="lbl">Danger</span></div>
  <div class="card"><button class="btn ghost" style="color:var(--dang)" onclick="wipe()">Erase everything and start over</button></div>
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

async function setCard(id, cardKey) { await api('/api/instruments/card', { id, cardKey }); await load(); }
async function wipe() {
  if (!confirm('Erase all imported data on this device?')) return;
  await api('/api/reset', {}); location.reload();
}

/* ---------------------------------------------------------------- actions */
async function linkPlaid() {
  try {
    S.error = null;
    const { linkToken } = await api('/api/link/token', {});
    Plaid.create({ token: linkToken, onSuccess: async (publicToken, meta) => {
        S.busy = true; render();
        try {
          await api('/api/link/exchange', { publicToken,
            institutionId: meta.institution?.institution_id, institutionName: meta.institution?.name });
          await load();
        } catch (e) { S.error = e.message; }
        S.busy = false; render();
      }, onExit: (err) => { if (err) { S.error = err.display_message ?? err.error_message; render(); } }
    }).open();
  } catch (e) { S.error = e.message; render(); }
}

async function importFiles(files) {
  S.busy = true; S.error = null; render();
  try {
    for (const f of files) {
      const text = await f.text();
      const r = await api('/api/import', { filename: f.name, text });
      if (r.error) throw new Error(r.error);
    }
    await load();
  } catch (e) { S.error = e.message; }
  S.busy = false; render();
}

async function refresh() {
  S.busy = true; render();
  try { if (S.state.connections.length) await api('/api/refresh', {}); await load(); }
  catch (e) { S.error = e.message; }
  S.busy = false; render();
}

async function toggleAgent(id, enabled) { await api('/api/agents/toggle', { id, enabled }); await load(); }

async function runAgentsNow() {
  S.busy = true; S.error = null; render();
  try { const r = await api('/api/agents/run', {}); if (r.notified) console.log('notified via', r.notified); await load(); }
  catch (e) { S.error = e.message; }
  S.busy = false; render();
}
async function dismiss(key) { await api('/api/findings/dismiss', { key }); await load(); }

async function claim(i) {
  const o = S.save.opportunities[i];
  const recurring = o.kind === 'cancel' || o.kind === 'card_routing' ? 11 : 0;
  await api('/api/save/claim', { amountCents: o.monthlyCents || o.annualCents,
    recurringMonths: recurring, method: o.kind === 'cancel' ? 'subscription_cancel'
      : o.kind === 'fees' ? 'fee_refund' : 'card_routing',
    evidence: { kind:'confirmed_by_me', note: o.evidence } });
  await load();
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  document.querySelector('meta[name=theme-color]')
    .setAttribute('content', document.body.classList.contains('dark') ? '#0C0F0A' : '#F6F7F3');
}

/* ---------------------------------------------------------------- render */
function render() {
  const st = S.state;
  $('app').innerHTML = S.locked ? viewLock()
    : !st ? '<div class="empty"><span class="spin"></span></div>'
    : !st.linked ? viewOnboard()
    : S.tab === 'spend' ? viewSpend()
    : S.tab === 'settings' ? viewSettings()
    : S.tab === 'save' ? viewSave() : viewAsk();

  if (S.locked) { $('tabs').innerHTML = ''; setTimeout(()=>$('pc')?.focus(), 60); return; }
  $('tabs').innerHTML = !st?.linked ? '' :
    [['ask','Find'],['spend','Spend'],['save','Save']].map(([k,l])=>
      `<button class="${S.tab===k?'on':''}" onclick="S.tab='${k}';render();scrollTo(0,0)">
         <svg viewBox="0 0 24 24">${ICONS[k]}</svg>${l}</button>`).join('');

  const d = $('drop');
  if (d) ['dragover','dragleave','drop'].forEach(ev => d.addEventListener(ev, e => {
    e.preventDefault();
    d.classList.toggle('over', ev === 'dragover');
    if (ev === 'drop') importFiles(e.dataTransfer.files);
  }));
}

if (matchMedia('(prefers-color-scheme: dark)').matches) document.body.classList.add('dark');
load().catch(e => { S.error = e.message; render(); });

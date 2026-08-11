const $ = (id) => document.getElementById(id);

/** The mark: a V that reads as a checkmark. Verified finance. */
const MARK = (size=22) => `<svg viewBox="0 0 192 192" style="width:${size}px;height:${size}px;flex:0 0 auto">
  <defs><linearGradient id="vg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#8B7CF6"/><stop offset="100%" stop-color="#34E1A6"/></linearGradient></defs>
  <rect width="192" height="192" rx="44" fill="#161923"/>
  <path d="M52 74 L86 128 L140 52" fill="none" stroke="url(#vg)" stroke-width="17"
        stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const BRAND = (sub) => `<div class="brand">
  ${MARK(24)}<span class="wordmark">Verafi</span>
  ${sub ? `<span class="brandsub">${sub}</span>` : ''}</div>`;
const api = async (p, body) => {
  const r = await fetch(p, body ? { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ?? 'request failed');
  return j;
};
const $m = (c) => (c/100).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});
const $m0 = (c) => (c/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escAttr = (s) => esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const title = (s) => String(s ?? '').replace(/[-_]/g,' ').replace(/\b\w/g, m => m.toUpperCase());

const S = { tab:'home', locked:false, state:null, cards:null, presets:null, answer:null, openCat:null, openDeal:null, dealCats:null, watchlist:null, hunts:null, unknowns:null, taxonomy:null, insight:null, lastQuery:null, spend:null, spendDays:30, save:null, busy:false, error:null, compare:[], compareOpen:false, actionNote:null, addCategoryOpen:false, watchDraft:null, openAgent:null, modal:null };

const ICONS = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  ask:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  spend:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 9.5h20"/>',
  save:'<path d="M12 3v18"/><path d="M17 7.5c0-2-2.2-3-5-3s-5 1-5 3 2.2 2.7 5 3.3 5 1.4 5 3.4-2.2 3.3-5 3.3-5-1.2-5-3.2"/>',
  wallet:'<rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18"/><circle cx="16.5" cy="13" r="1.3"/>',
  agent:'<path d="M12 3 4 6.5v5c0 4.4 3.2 8.3 8 9.5 4.8-1.2 8-5.1 8-9.5v-5L12 3Z"/><path d="m9 12 2 2 4-4"/>'
};

function go(tab){S.tab=tab;S.openCat=null;S.openDeal=null;render();scrollTo(0,0);}
function openModal(kind,data={}){S.modal={kind,...data};render();setTimeout(()=>$('modalPrimary')?.focus(),30);}
function closeModal(){S.modal=null;render();}

async function load() {
  try { S.state = await api('/api/state'); S.locked = false; }
  catch (e) { if (/locked/i.test(e.message)) { S.locked = true; S.state = null; return render(); } throw e; }
  if (S.state.linked) {
    // Agent evaluation is an explicit capability request, never a hidden mutation in
    // Home's read endpoint. Load Save first, then refresh the read-only dashboard state.
    const firstSave = await api('/api/save').catch(e => ({ __failed:'/api/save', __error:e.message }));
    if(!firstSave.__failed)S.state=await api('/api/state');
    // One missing endpoint must never blank the whole app. Each call fails on its own.
    const safe = (p) => api(p).catch(e => ({ __failed: p, __error: e.message }));
    const [sp, sv, cd, rs, dc, wl, hu, un, ins] = await Promise.all([
      safe(`/api/spend?days=${S.spendDays}`), Promise.resolve(firstSave),
      safe('/api/cards'), safe('/api/research'), safe('/api/deals/presets'), safe('/api/deals/watchlist'), safe('/api/hunts'), safe('/api/unknowns'), safe('/api/insight')
    ]);
    const failed = [sp,sv,cd,rs,dc,wl,hu,un,ins].filter(x => x?.__failed).map(x => x.__failed);
    Object.assign(S, {
      spend: sp.__failed ? null : sp, save: sv.__failed ? null : sv,
      cards: cd.__failed ? null : cd,
      presets: rs.__failed ? null : rs.presets,
      dealCats: dc?.__failed ? [] : dc.categories,
      watchlist: wl?.__failed ? [] : wl.items,
      hunts: hu?.__failed ? [] : hu.hunts,
      notificationChannel: hu?.__failed ? null : hu.notificationChannel,
      unknowns: un?.__failed ? [] : un.unknowns,
      taxonomy: un?.__failed ? [] : un.taxonomy,
      insight: ins?.__failed ? null : ins,
      staleServer: failed.length ? failed : null
    });
  }
  render();
}

/* ---------------------------------------------------------------- lock */
function viewLock() {
  return `
  <div style="padding-top:20vh;text-align:center">
    <div style="display:flex;justify-content:center;margin-bottom:14px">${MARK(54)}</div>
    <h1>Verafi</h1>
    <p class="tiny muted" style="margin-top:8px">Enter your passcode</p>
    <div style="max-width:240px;margin:18px auto 0">
      <input id="pc" type="password" autocomplete="current-password"
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
  <p class="muted" style="font-size:14px;line-height:1.6">Connect your accounts and Verafi will build a private review of your spending. Your financial history stays in your private Verafi environment. Generic shopping searches may use an external search provider; personal financial details remain behind the privacy gate.</p>

  <div class="sec"><span class="lbl">Option 1 · live connection</span></div>
  <div class="card">
    <div style="font-weight:650;font-size:14px">Connect a bank with Plaid</div>
    <div class="tiny muted" style="margin-top:6px;line-height:1.55">
      ${st.plaidConfigured
        ? `Running in <b>${st.plaidEnv}</b> mode.${st.plaidEnv==='sandbox' ? ' Use <code>user_good</code> / <code>pass_good</code> to test with fake data.' : ' This will connect your <b>real</b> accounts.'}`
        : 'Bank connection is not available yet. You can import a statement now and connect a bank later.'}
    </div>
    <button class="btn ${st.plaidConfigured?'go':''}" ${st.plaidConfigured?'':'disabled'} onclick="linkPlaid()">
      ${st.plaidConfigured ? 'Connect with Plaid' : 'Bank connection unavailable'}</button>
  </div>

  <div class="sec"><span class="lbl">Option 2 · no third party at all</span></div>
  <div class="card">
    <div style="font-weight:650;font-size:14px">Import a CSV or OFX from your bank</div>
    <div class="tiny muted" style="margin-top:6px;line-height:1.55">Every US bank lets you export statements. Nobody but you ever sees your credentials, and it costs nothing. Good enough to test the whole product today.</div>
    <div class="drop" id="drop" role="button" tabindex="0" aria-label="Choose a statement file to import" style="margin-top:12px" onclick="$('file').click()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();$('file').click()}">
      Drop a .csv / .ofx / .qfx here<br/><span class="tiny">or tap to choose</span>
    </div>
    <input type="file" id="file" accept=".csv,.ofx,.qfx,.txt" style="display:none" onchange="importFiles(this.files)"/>
  </div>
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

/* ---------------------------------------------------------------- home */
function viewHome() {
  const st=S.state, sp=S.spend, sv=S.save;
  const reviews=sv?.reviewQueue??[], actions=sv?.opportunities??[];
  const findings=st.findings??[], watches=(S.hunts??[]).filter(h=>h.enabled);
  const confirmed=findings.filter(f=>!f.reviewOnly&&!f.alertOnly).length;
  const top=(sp?.categories??[]).slice().sort((a,b)=>b.cents-a.cents)[0];
  const agentReview=st.agentReview?.agents??[];
  const needsSetup=agentReview.filter(a=>a.blocker).length;
  const latest=findings.slice(0,3);
  return `
  ${BRAND()}
  <div class="top home-top"><div><span class="eyebrow">Your money, today</span><h1>What needs attention</h1></div><span class="sp"></span>
    <button class="chipbtn" aria-label="Setup" onclick="go('settings')">⚙</button></div>

  <button class="home-priority" onclick="go('${reviews.length||actions.length?'save':'agent'}')">
    <span class="priority-icon"><iconify-icon icon="ph:sparkle-fill"></iconify-icon></span>
    <span><small>${reviews.length+actions.length?'Next best action':'Agent check-in'}</small>
      <b>${reviews.length+actions.length?`${reviews.length+actions.length} decision${reviews.length+actions.length===1?'':'s'} waiting`:'Review what your agents checked'}</b>
      <em>${reviews.length+actions.length?`${reviews.length} need review · ${actions.length} ready to act — nothing counted yet`:`${confirmed} evidence-backed finding${confirmed===1?'':'s'} in the current data`}</em></span><strong>›</strong>
  </button>

  <div class="home-grid">
    <button onclick="go('spend')"><span>Last 30 days</span><b>${$m0(sp?.totalCents??0)}</b><small>${top?`${esc(top.label)} is the largest category`:'Open spending detail'}</small></button>
    <button onclick="go('save')"><span>Confirmed saved</span><b class="money-good">${$m0(sv?.verifiedTotalCents??0)}</b><small>${sv?.events?.length??0} completed action${(sv?.events?.length??0)===1?'':'s'}</small></button>
    <button onclick="go('agent')"><span>Agent findings</span><b>${confirmed+reviews.length}</b><small>${reviews.length} need your review${needsSetup?` · ${needsSetup} need setup`:''}</small></button>
    <button onclick="go('ask')"><span>Price watches</span><b>${watches.length}</b><small>${watches.filter(h=>h.recommendation?.status==='buy_now').length} at buy-now trigger</small></button>
  </div>

  <div class="sec"><span class="lbl">Agent activity</span><button class="act" onclick="go('agent')">See all →</button></div>
  ${latest.length?latest.map(f=>`<button class="home-finding" onclick="go('${f.reviewOnly?'save':'agent'}')"><span class="finding-dot ${f.reviewOnly?'review':'found'}"></span><span><b>${esc(f.title)}</b><small>${esc(f.detail)}</small></span><em>${f.reviewOnly?'Review':'Evidence'}</em></button>`).join(''):
    `<button class="home-finding" onclick="go('agent')"><span class="finding-dot neutral"></span><span><b>No surfaced finding yet</b><small>Open Agents to see candidate depth, blockers, and the next investigation for each agent.</small></span><em>Inspect</em></button>`}

  <div class="sec"><span class="lbl">Quick actions</span></div>
  <div class="home-actions">
    <button onclick="go('ask')"><iconify-icon icon="ph:magnifying-glass-bold"></iconify-icon><span><b>Research a purchase</b><small>Compare live options</small></span><em>›</em></button>
    <button onclick="go('save')"><iconify-icon icon="ph:check-square-offset-bold"></iconify-icon><span><b>Review savings</b><small>Decide what to act on</small></span><em>›</em></button>
    <button onclick="go('wallet')"><iconify-icon icon="ph:credit-card-bold"></iconify-icon><span><b>Cards & accounts</b><small>${st.coverage?.cards??0} linked cards · balances and rewards</small></span><em>›</em></button>
  </div>`;
}

/* ---------------------------------------------------------------- shop */
function viewShop() {
  const r = S.answer, cats = S.dealCats ?? [], watch = S.watchlist ?? [];
  const open = S.openDeal;

  if (open) {
    const c = cats.find(x => x.key === open);
    if (!c) { S.openDeal=null; return viewShop(); }
    return `
    <div class="top"><button class="chipbtn" onclick="S.openDeal=null;S.answer=null;render()">← Shop</button><span class="sp"></span></div>
    <div class="card"><div class="row">
      <div class="dot">${categoryIcon(c)}</div>
      <div class="grow"><div style="font-weight:650;font-size:15px">${esc(c.label)}</div>
      <div class="tiny muted" style="margin-top:3px">${esc(c.basis)}</div></div></div>
    </div>
    <div class="sec"><span class="lbl">Ask the agent</span><span class="act">budget ~$${c.budget}</span></div>
    ${c.asks.map((a,i)=>`<div class="card" role="button" tabindex="0" onclick="doCategoryAsk('${c.key}',${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();doCategoryAsk('${c.key}',${i})}" style="cursor:pointer">
      <div class="row"><span class="grow" style="font-size:13.5px;line-height:1.45">${esc(a)}</span><span class="muted">›</span></div></div>`).join('')}
    <div class="card">
      <input id="q" placeholder="or ask your own…" style="border:0;padding:4px 0;font-size:15px"
             onkeydown="if(event.key==='Enter')doAsk()"/>
      <button class="btn go" onclick="doAsk(null,null,'${c.key}')">${S.busy?'Researching…':'Search'}</button>
    </div>
    ${answerCard(r)}${watchSheet()}`;
  }

  if (r?.kind === 'deal' && r.decision?.products?.length) {
    return `${BRAND()}${answerCard(r)}${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
  }

  return `
  ${BRAND()}
  <div class="top"><h1>Shop</h1><span class="sp"></span>
    <button class="chipbtn" onclick="S.tab='settings';render()">⚙</button></div>
  <div class="tiny muted">Ask for anything, then compare live options, tradeoffs and sources.</div>

  <div class="card">
    <input id="q" placeholder="all-inclusive to the Bahamas, Labor Day, 2 adults 2 kids"
           style="border:0;padding:4px 0;font-size:15px" onkeydown="if(event.key==='Enter')doAsk()"/>
    <button class="btn go" onclick="doAsk()">${S.busy?'Researching…':'Find it'}</button>
  </div>

  ${watch.length ? `<div class="sec"><span class="lbl">Saved shopping</span><span class="act">${watch.length} waiting</span></div>
  ${watch.map(w=>{const moved=w.foundPriceCents-w.currentPriceCents;return `<div class="card" style="border-color:var(--save)"><div class="row" style="align-items:flex-start"><div class="grow"><div style="font-size:13.5px;font-weight:650;line-height:1.4">${esc(w.title)}</div><div class="tiny muted" style="margin-top:5px">Current ${$m0(w.currentPriceCents)} · target ${$m0(w.targetCents)}</div>${moved>0?`<div class="tiny ok" style="margin-top:3px">↓ ${$m0(moved)} since saved</div>`:''}</div></div><div class="row" style="gap:8px;margin-top:10px"><button class="btn go" onclick="approveDeal('${w.id}')">Open merchant</button><button class="btn ghost" style="width:auto;padding:13px 16px" onclick="openModal('dropDeal',{id:'${w.id}',name:'${escAttr(w.title)}'})">Remove</button></div></div>`;}).join('')}` : ''}

  <div class="sec"><span class="lbl">Price watches</span>
    <button class="act" onclick="newHunt()">+ new</button></div>
  <div class="tiny muted alert-channel"><iconify-icon icon="ph:bell-bold"></iconify-icon>${S.notificationChannel?`${title(S.notificationChannel)} alerts are on`:'Alerts appear in Verafi; add a notification channel in Setup for off-app alerts'}</div>
  ${(S.hunts ?? []).length ? S.hunts.map(h=>`
    <div class="card" style="${h.enabled?'':'opacity:.6'}">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div style="font-size:13.5px;font-weight:650">${esc(h.name)}</div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${esc(h.summary)}</div>
          <div class="watch-recommendation ${h.recommendation?.status??'monitoring'}"><b>${esc(h.recommendation?.label??'Monitoring')}</b><span>${esc(h.recommendation?.detail??'Waiting for the next check.')}</span></div>
          <div class="tiny" style="color:var(--dim);margin-top:5px">
            ${h.runs} checks${h.matches.length?` · ${h.matches.length} match${h.matches.length>1?'es':''}`:' · nothing yet'}</div>
        </div>
        <button class="tog ${h.enabled?'on':''}" role="switch" aria-checked="${h.enabled}" aria-label="${h.enabled?'Disable':'Enable'} ${escAttr(h.name)}" onclick="toggleHunt('${h.id}',${!h.enabled})"><i></i></button>
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn ghost" onclick="runHunt('${h.id}')">${S.busy?'Checking…':'Check now'}</button>
        <button class="btn ghost" style="width:auto;padding:13px 16px" aria-label="Delete ${escAttr(h.name)}" onclick="deleteHunt('${h.id}','${escAttr(h.name)}')">✕</button>
      </div>
    </div>`).join('')
   : `<div class="card"><div class="tiny muted" style="line-height:1.6">No price watches yet. Set a maximum price and your requirements; Verafi checks daily and keeps matching options here in Shop.</div></div>`}

  <div class="sec"><span class="lbl">Your categories</span><button class="act" onclick="S.addCategoryOpen=!S.addCategoryOpen;render()">${S.addCategoryOpen?'close':'+ add your own'}</button></div>
  ${S.addCategoryOpen ? customCategoryForm() : ''}
  ${cats.map(c=>`
    <div class="card category-card" role="button" tabindex="0" onclick="S.openDeal='${c.key}';S.answer=null;render();scrollTo(0,0)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();S.openDeal='${c.key}';S.answer=null;render();scrollTo(0,0)}" style="cursor:pointer">
      <div class="row">
        <div class="dot">${categoryIcon(c)}</div>
        <div class="grow"><div style="font-size:13.5px;font-weight:650">${esc(c.label)}</div>
          <div class="tiny muted" style="margin-top:3px">${esc(c.basis)}</div>
          ${c.custom?`<div class="agent-counts"><span>${c.defaultDropPct}% default alert</span><span>budget $${c.budget}</span></div>`:''}</div>
        ${c.custom?`<button class="category-delete" aria-label="Delete ${escAttr(c.label)}" onclick="event.stopPropagation();deleteCustomCategory('${c.id}')">×</button>`:''}<span class="muted">›</span>
      </div>
    </div>`).join('')}

  ${answerCard(r)}
  ${watchSheet()}
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

function categoryIcon(c) {
  return String(c?.icon??'').startsWith('ph:')
    ? `<iconify-icon icon="${esc(c.icon)}"></iconify-icon>` : esc(c?.icon ?? '');
}

function customCategoryForm() {
  return `<div class="card category-builder">
    <div class="builder-head"><iconify-icon icon="ph:sparkle-bold"></iconify-icon><div><b>Create a shopping agent</b><span>Teach Verafi a need that transaction history cannot infer.</span></div></div>
    <label>Name<input id="catName" placeholder="Kids' clothes" maxlength="48"/></label>
    <label>Who or what is this for?<textarea id="catContext" placeholder="Two boys under 5; sizes 4T and 5T; durable everyday clothes; avoid dry-clean only" maxlength="320"></textarea></label>
    <div class="form-grid"><label>Type<select id="catKind"><option value="family">Kids & family</option><option value="clothing">Clothing</option><option value="travel">Travel</option><option value="home">Home</option><option value="electronics">Electronics</option><option value="dining">Dining</option><option value="other">Other</option></select></label>
      <label>Budget per purchase<input id="catBudget" type="number" min="1" step="1" value="150" inputmode="decimal"/></label></div>
    <label>Default price alert<div class="percent-field"><input id="catDrop" type="number" min="1" max="90" value="20" inputmode="numeric"/><span>% drop</span></div></label>
    <button class="btn go" onclick="saveCustomCategory()">Create agent</button>
  </div>`;
}

function answerCard(r) {
  if (!r) return '';
  if (r.kind === 'deal' && r.decision?.products?.length) return shopDecision(r);
  return `
    <div class="sec"><span class="lbl">${esc(r.label ?? 'Answer')}</span>${r.costUsd?`<span class="act">$${r.costUsd.toFixed(3)}</span>`:''}</div>
    <div class="card">
      <div style="font-size:14px;line-height:1.65;white-space:pre-wrap">${md(r.answer)}</div>
      ${r.howToFix ? `<div class="guard" style="margin-top:12px">
        <div style="color:var(--ink);font-weight:650;margin-bottom:6px">To switch this on</div>
        ${r.howToFix.map(h=>`<div style="line-height:1.7">· ${esc(h)}</div>`).join('')}</div>`:''}
      ${(r.evidence||[]).length ? `<div style="margin-top:12px;padding-top:11px;border-top:1px solid var(--line)">
        <div class="tiny" style="color:var(--dim);font-weight:700;letter-spacing:.6px;margin-bottom:7px">WHAT I LOOKED AT</div>
        ${r.evidence.map(e=>`<div class="tiny muted" style="line-height:1.7">· ${md(e)}</div>`).join('')}</div>`:''}
      ${r.ok ? `<button class="btn ghost" onclick="holdFromAnswer()">Hold this and watch the price</button>`:''}
      <div class="tiny" style="color:var(--dim);margin-top:11px;padding-top:9px;border-top:1px solid var(--line)">
        ${(r.steps||[]).map(st=>`<div style="line-height:1.6">✓ ${esc(st.tool)} — ${esc(st.detail)}</div>`).join('')}
        <div style="margin-top:6px">🔒 ${esc(r.disclaimer ?? 'Research only.')}</div>
      </div>
    </div>`;
}

function safeUrl(v) {
  try { const u = new URL(String(v)); return u.protocol==='https:' ? u.href : ''; }
  catch { return ''; }
}
function money(v) { return Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'}); }
function productIcon(query='') {
  const q=String(query).toLowerCase();
  if (/luggage|suitcase|carry.?on|bag/.test(q)) return 'ph:suitcase-rolling-bold';
  if (/flight|trip|hotel|travel|vacation/.test(q)) return 'ph:airplane-tilt-bold';
  if (/laptop|computer|tablet|phone|electronics/.test(q)) return 'ph:laptop-bold';
  if (/shoe|sneaker|running/.test(q)) return 'ph:sneaker-bold';
  if (/watch|jewel/.test(q)) return 'ph:watch-bold';
  if (/sofa|furniture|home/.test(q)) return 'ph:armchair-bold';
  return 'ph:package-bold';
}
function sourceName(url, titleText) {
  try { return new URL(url).hostname.replace(/^www\./,'').split('.')[0].replace(/^./,c=>c.toUpperCase()); }
  catch { return String(titleText||'Source').split(/[|—-]/)[0].trim().slice(0,18); }
}
function shopDecision(r) {
  const d=r.decision, products=d.products||[], selected=new Set(S.compare||[]);
  const sources=(r.evidence||[]).map(x=>{
    const m=String(x).match(/^(.*?)\s+—\s+(https?:\/\/\S+)/); return m?{title:m[1],url:m[2]}:null;
  }).filter(Boolean);
  if (S.compareOpen) return compareDecision(products);
  return `<section class="shop-results">
    <div class="shop-query"><iconify-icon icon="ph:magnifying-glass-bold"></iconify-icon>
      <span>${esc(S.lastQuery||'Your search')}</span><button onclick="editShopSearch()">Edit</button></div>
    <div class="source-strip"><div class="source-status"><span></span><b>Researched now</b><em>Checked ${sources.length} live source${sources.length===1?'':'s'} for current prices.</em></div>
      <div class="source-badges">${sources.slice(0,5).map(s=>`<a href="${safeUrl(s.url)}" target="_blank" rel="noopener"><i>${esc(sourceName(s.url,s.title).slice(0,1))}</i>${esc(sourceName(s.url,s.title))}</a>`).join('')}</div></div>
    ${r.personalContext?`<div class="agent-context"><iconify-icon icon="ph:database-bold"></iconify-icon><span><b>Your history informed the decision</b><small>${esc(r.personalContext.statement)}${r.personalContext.spentYearCents?` · ${$m0(r.personalContext.spentYearCents)} total`:''}${r.personalContext.typicalCents?` · ${$m0(r.personalContext.typicalCents)} typical charge`:''}. History personalizes the answer; it never blocks live research.</small></span></div>`:''}
    <div class="best-intro"><iconify-icon icon="ph:sparkle-fill"></iconify-icon><div><h2>Best match</h2><p>${esc(d.summary)}</p></div></div>
    <div class="product-stack">${products.map((p,i)=>productCard(p,i,selected.has(i))).join('')}</div>
    <button class="compare-all" onclick="openComparison()"><iconify-icon icon="ph:scales-bold"></iconify-icon><span>Compare all ${products.length}<small>See prices, features and tradeoffs side by side</small></span><b>›</b></button>
    ${S.actionNote?`<div class="action-toast">${esc(S.actionNote)}</div>`:''}
    <div class="merchant-guard"><iconify-icon icon="ph:shield-check-bold"></iconify-icon><span><b>Your checkout stays with the merchant.</b><small>Verafi never sees or stores your payment information.</small></span></div>
  </section>${watchSheet()}`;
}
function productCard(p,i,isCompared) {
  const url=safeUrl(p.url), top=i===0;
  return `<article class="product-card ${top?'featured':''}">
    <div class="product-rank">${i+1}</div>
    <div class="product-visual">${safeUrl(p.image)?`<img src="${safeUrl(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"/>`:''}<iconify-icon icon="${productIcon(S.lastQuery)}"></iconify-icon></div>
    <div class="product-copy"><span class="product-label label-${i}">${esc(p.label)}</span>
      <h3>${esc(p.name)}</h3>
      <div class="product-highlights">${(p.highlights||[]).map(esc).join('<b>•</b>')}</div>
      <div class="price-line"><strong>${money(p.price)}</strong><span>${esc(p.seller)}</span></div>
      ${p.shipping?`<div class="shipping">${esc(p.shipping)}</div>`:''}
      ${p.tradeoff?`<div class="tradeoff"><b>Tradeoff</b> ${esc(p.tradeoff)}</div>`:''}
    </div>
    <div class="product-actions">
      ${top?`<button class="save-spend" onclick="visitProduct(${i})" ${url?'':'disabled'}><iconify-icon icon="ph:arrow-square-out-bold"></iconify-icon><span>Buy at ${esc(p.seller)}<small>Open the verified merchant product page</small></span><b>›</b></button>`:''}
      <div class="secondary-actions ${top?'':'four-actions'}"><button class="${isCompared?'selected':''}" onclick="toggleProductCompare(${i})"><iconify-icon icon="ph:scales-bold"></iconify-icon>${isCompared?'Added':'Compare'}</button>
      <button onclick="saveProduct(${i})"><iconify-icon icon="ph:wallet-bold"></iconify-icon>Save</button>
      <button onclick="watchProduct(${i})"><iconify-icon icon="ph:bell-bold"></iconify-icon>Watch price</button>
      ${top?'':`<button onclick="visitProduct(${i})" ${url?'':'disabled'}><iconify-icon icon="ph:arrow-square-out-bold"></iconify-icon>Buy at seller</button>`}</div>
    </div>
  </article>`;
}
function compareDecision(products) {
  return `<section class="shop-results compare-view"><button class="back-result" onclick="S.compareOpen=false;render()">← Results</button>
    <div class="compare-head"><span>Side-by-side</span><h2>Compare your best matches</h2><p>Current prices and the tradeoffs that matter.</p></div>
    <div class="compare-grid">${products.map((p,i)=>`<article class="compare-card ${i===0?'picked':''}"><span>${esc(p.label)}</span><iconify-icon icon="${productIcon(S.lastQuery)}"></iconify-icon><h3>${esc(p.name)}</h3><strong>${money(p.price)}</strong><small>${esc(p.seller)}</small><ul>${(p.highlights||[]).map(h=>`<li>${esc(h)}</li>`).join('')}</ul><p>${esc(p.tradeoff||p.why)}</p><button onclick="visitProduct(${i})">Buy at ${esc(p.seller)}</button><button class="quiet" onclick="saveProduct(${i})">Save for later</button></article>`).join('')}</div>
    <div class="merchant-guard"><iconify-icon icon="ph:shield-check-bold"></iconify-icon><span><b>Your checkout stays with the merchant.</b><small>Prices and availability can change at checkout.</small></span></div></section>`;
}
function decisionProduct(i) { return S.answer?.decision?.products?.[i]; }
function editShopSearch(){ S.answer=null;S.compare=[];S.compareOpen=false;render();setTimeout(()=>$('q')?.focus(),40); }
function toggleProductCompare(i){ S.compare=S.compare.includes(i)?S.compare.filter(x=>x!==i):[...S.compare,i];render(); }
function openComparison(){ S.compareOpen=true;render();scrollTo(0,0); }
function visitProduct(i){ const u=safeUrl(decisionProduct(i)?.url);if(u)open(u,'_blank','noopener'); }
async function saveProduct(i){
  const p=decisionProduct(i); if(!p)return;
  await api('/api/deals/hold',{title:p.name,url:safeUrl(p.url),priceCents:Math.round(p.price*100),category:S.openDeal??'other',notes:p.tradeoff||p.why});
  S.actionNote=`${p.name} was saved in Shop.`; await load();
}
async function watchProduct(i){
  const p=decisionProduct(i); if(!p)return;
  const category=(S.dealCats??[]).find(c=>c.key===S.openDeal);
  S.watchDraft={mode:'product',index:i,dropPct:category?.defaultDropPct??15}; render();
}

const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--ink)">$1</b>');

async function doAsk(preset, presetQuery, categoryKey=null) {
  const q = presetQuery ?? ($('q') ? $('q').value : '');
  if (!q && !preset) { S.error = 'Type what you are looking for first.'; render(); return; }
  S.busy = true; S.error = null; S.answer = null; S.lastQuery = q; S.compare=[];S.compareOpen=false;S.actionNote=null; render();
  // Never let a hung request look like a dead button.
  const ctrl = new AbortController();
  // Live search and ranking have separate server budgets. The client waits long enough
  // for the grounded fallback rather than aborting while the server is still working.
  const t = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch('/api/ask', { method:'POST', signal: ctrl.signal,
      headers:{'content-type':'application/json'}, body: JSON.stringify({ query: q, preset, categoryKey:categoryKey??S.openDeal }) });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    S.answer = await r.json();
  } catch (e) {
    S.error = e.name === 'AbortError'
      ? 'Research could not finish after 55 seconds. Nothing was charged; try again or make the request more specific.'
      : e.message;
  } finally { clearTimeout(t); S.busy = false; render(); }
}
function doCategoryAsk(categoryKey,index){
  const c=(S.dealCats??[]).find(x=>x.key===categoryKey);if(!c)return;
  return doAsk(null,c.asks?.[index]??'',categoryKey);
}

async function holdFromAnswer() {
  openModal('holdDeal',{name:(S.lastQuery||'Saved deal').slice(0,80)});
}
async function newHunt() {
  const category=(S.dealCats??[]).find(c=>c.key===S.openDeal);
  S.watchDraft={mode:'custom',dropPct:category?.defaultDropPct??15}; render();
}
async function createWatch() {
  const d=S.watchDraft;if(!d)return;
  const p=d.mode==='product'?decisionProduct(d.index):null;
  const name=p?.name??String(d.name??$('watchName')?.value??'').trim();
  const baseline=p?.price??Number(d.baseline??$('watchBaseline')?.value);
  const dropPct=Number(d.dropPct??$('watchDrop')?.value);
  const traits=d.mode==='product'?[p.seller]:String(d.traits??$('watchTraits')?.value??'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!name||!Number.isFinite(baseline)||baseline<=0||!Number.isFinite(dropPct)||dropPct<1||dropPct>90){
    S.error='Add a name, today\'s price, and a drop between 1% and 90%.';render();return;
  }
  try {
    await api('/api/hunts', { name, referencePriceCents:Math.round(baseline*100), alertDropPct:Math.round(dropPct),
      traits, productUrl:p?.url??null, source:'web', category:S.openDeal??'other' });
    S.actionNote=`Watching ${name}. Verafi will alert you after a ${Math.round(dropPct)}% drop and recommend buy or wait.`;
    S.watchDraft=null;
    await load();
  } catch (e) { S.error = e.message; render(); }
}

function watchSheet(){
  const d=S.watchDraft;if(!d)return '';
  const p=d.mode==='product'?decisionProduct(d.index):null;
  const baseline=Number(p?.price??d.baseline??0), target=baseline?baseline*(1-(d.dropPct??15)/100):0;
  return `<div class="sheet-backdrop" onclick="if(event.target===this){S.watchDraft=null;render()}"><section class="sheet" role="dialog" aria-modal="true" aria-label="Create price alert">
    <div class="sheet-handle"></div><div class="sheet-title"><div><span>Price agent</span><h2>${p?esc(p.name):'Create a custom alert'}</h2></div><button aria-label="Close" onclick="S.watchDraft=null;render()">×</button></div>
    ${p?`<div class="watch-baseline"><span>Price today</span><b>${money(p.price)}</b></div>`:`<label>What should Verafi watch?<input id="watchName" placeholder="Winter coats for both boys" maxlength="80" value="${escAttr(d.name??'')}" oninput="S.watchDraft.name=this.value"/></label><label>Price today / baseline<input id="watchBaseline" type="number" min="1" step="0.01" placeholder="120" value="${escAttr(d.baseline??'')}" oninput="S.watchDraft.baseline=this.value" inputmode="decimal"/></label><label>Must-haves (optional)<input id="watchTraits" placeholder="waterproof, sizes 4T and 5T" value="${escAttr(d.traits??'')}" oninput="S.watchDraft.traits=this.value"/></label>`}
    <label>Tell me when the price drops by<div class="percent-field"><input id="watchDrop" type="number" min="1" max="90" value="${d.dropPct??15}" oninput="S.watchDraft.dropPct=Number(this.value)" inputmode="numeric"/><span>%</span></div></label>
    ${baseline?`<div class="trigger-preview"><iconify-icon icon="ph:bell-ringing-bold"></iconify-icon><div><b>Alert at ${money(target)}</b><span>Then Verafi checks the evidence and recommends buy now or keep waiting.</span></div></div>`:''}
    <div class="quick-pcts">${[10,15,20,25].map(x=>`<button class="${d.dropPct===x?'selected':''}" onclick="S.watchDraft.dropPct=${x};render()">${x}%</button>`).join('')}</div>
    <button class="btn go" onclick="createWatch()">Start monitoring</button><div class="tiny muted sheet-note">Checked daily. Alerts stop at your trigger; Verafi never buys automatically.</div>
  </section></div>`;
}

async function saveCustomCategory(){
  const budget=Number($('catBudget')?.value), drop=Number($('catDrop')?.value);
  try{await api('/api/deals/categories',{label:$('catName')?.value,context:$('catContext')?.value,kind:$('catKind')?.value,budgetCents:Math.round(budget*100),defaultDropPct:Math.round(drop)});
    S.addCategoryOpen=false;await load();}
  catch(e){S.error=e.message;render();}
}
async function deleteCustomCategory(id){
  openModal('deleteCategory',{id});
}
async function toggleHunt(id, enabled) { await api('/api/hunts/toggle', { id, enabled }); await load(); }
async function deleteHunt(id,name) { openModal('deleteHunt',{id,name}); }
async function runHunt(id) {
  S.busy = true; render();
  try {
    const r = await api('/api/hunts/run', { id });
    S.answer = { label:r.recommendation?.label??'Price watch result', answer: r.why ?? r.answer ?? (r.matches.length?`Found ${r.matches.length} match — it is saved in Shop.`:'No match yet.'),
                 evidence: r.evidence ?? (r.sources||[]).map(s=>`${s.title||s.url} — ${s.url}`),
                 steps:[{tool:'price_watch.evaluate',detail:'your percentage trigger was enforced on verified prices'}],
                 disclaimer:'Price watches surface candidates. They cannot buy.', ok:false };
    await load();
  } catch (e) { S.error = e.message; }
  S.busy = false; render();
}
async function dropDeal(id) { await api('/api/deals/drop', { id }); await load(); }
async function approveDeal(id) {
  const item=(S.watchlist??[]).find(x=>x.id===id);
  const url=safeUrl(item?.url);
  if(url) open(url,'_blank','noopener');
  else { S.error='This saved item has no verified merchant link. Search again to get a current product page.'; render(); }
}

/* ---------------------------------------------------------------- spend */
function viewCategoryDetail(open) {
  const sp = S.spend, cats = sp?.categories ?? [];
  {
    const c = cats.find(x => x.key === open);
    if (!c) { S.openCat = null; return viewSpend(); }
    return `
    <div class="top"><button class="chipbtn" onclick="S.openCat=null;render()">← Spend</button>
      <span class="sp"></span></div>
    <div class="card">
      <div class="row"><div class="dot">${c.icon}</div>
        <div class="grow"><div style="font-weight:650;font-size:15px">${esc(c.label)}</div>
        <div class="tiny muted" style="margin-top:3px">${c.count} transactions · ${c.share}% of spending</div></div>
        <div class="big" style="font-size:22px">${$m0(c.cents)}</div></div>
    </div>

    <div class="sec"><span class="lbl">Breakdown</span></div>
    <div class="card">
      ${c.subs.map((sb,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
        <div class="grow"><div class="row"><span style="font-size:13px;font-weight:600" class="grow">${title(sb.key)}</span>
          <span class="tiny muted">${$m0(sb.cents)}</span></div>
          <div class="bar"><i style="width:${sb.cents/c.cents*100}%"></i></div>
          <div class="tiny" style="color:var(--dim);margin-top:4px">${sb.count} transactions</div></div></div>`).join('')}
    </div>

    <div class="sec"><span class="lbl">Where it went</span><span class="act">${c.merchants.length} merchants</span></div>
    <div class="card">
      ${c.merchants.map((m,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
        <div class="dot">${esc((m.name||'?').trim()[0] ?? '?').toUpperCase()}</div>
        <div class="grow"><div style="font-size:13px;font-weight:600">${esc(m.name)}</div>
        <div class="tiny muted" style="margin-top:2px">${title(m.sub)} · ${m.count}×</div></div>
        <div style="font-weight:650">${$m0(m.cents)}</div></div>`).join('')}
    </div>`;
  }
}

function viewSpend() {
  const sp = S.spend;
  if(S.openCat)return viewCategoryDetail(S.openCat);
  const cats=sp?.categories??[],max=cats[0]?.cents??1;
  return `
  ${BRAND()}
  <div class="top"><h1>Spend</h1><span class="sp"></span>
    <button class="chipbtn" onclick="refresh()">${S.busy?'<span class="spin"></span>':'↻'}</button></div>
  <div class="tiny muted">Your spending activity and category breakdown. Shopping research and saved products stay in Shop.</div>
  <div class="period-picker" role="group" aria-label="Spending period">${[30,90,365].map(d=>`<button class="${S.spendDays===d?'selected':''}" onclick="setSpendDays(${d})">${d===365?'1 year':`${d} days`}</button>`).join('')}</div>

  <div class="sec"><span class="lbl">Recent activity</span><span class="act">last ${S.spendDays===365?'year':`${S.spendDays} days`}</span></div>
  <div class="card"><div class="row">
    <span class="tiny muted grow">Spent ${$m0(sp?.totalCents ?? 0)} · investments, payments, taxes and transfers excluded</span></div></div>

  <div class="sec"><span class="lbl">Where it went</span><span class="act">tap for detail</span></div>
  ${cats.map(c=>`<div class="card" role="button" tabindex="0" onclick="S.openCat='${c.key}';render();scrollTo(0,0)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();S.openCat='${c.key}';render();scrollTo(0,0)}" style="cursor:pointer"><div class="row"><div class="dot">${c.icon}</div><div class="grow"><div class="row"><span class="grow" style="font-size:13px;font-weight:650">${esc(c.label)}</span><b>${$m0(c.cents)}</b></div><div class="bar"><i style="width:${c.cents/max*100}%"></i></div><div class="tiny muted" style="margin-top:4px">${c.share}% · ${c.count} transactions</div></div><span class="muted">›</span></div></div>`).join('')}

  <div class="sec"><span class="lbl">Recent</span></div>
  <div class="card">
    ${(sp?.recent ?? []).slice(0,25).map((t,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
      <div class="grow"><div style="font-size:13px;font-weight:600">${esc(t.merchantName ?? t.merchantId)}</div>
        <div class="tiny muted" style="margin-top:2px">${title(t.category)} · ${new Date(t.postedAt).toLocaleDateString()}</div></div>
      <div style="font-size:13px;font-weight:650">${$m(t.amountCents)}</div></div>`).join('')}
  </div>`;
}

/* ---------------------------------------------------------------- save */
function viewSave() {
  const sv = S.save, sp = S.spend;
  const reviews=sv?.reviewQueue??[], actions=sv?.opportunities??[], alerts=sv?.alerts??[];
  const workflows=(sv?.actions??[]).filter(a=>a.status==='action_started'||a.status==='awaiting_verification');
  const potential=[...reviews,...actions].reduce((a,x)=>a+(x.annualCents??0),0);
  const monitoring=(S.hunts??[]).filter(h=>h.enabled);
  return `
  ${BRAND()}
  <div class="top"><h1>Save</h1><span class="sp"></span>
    <button class="chipbtn" onclick="runAgentsNow()">${S.busy?'<span class="spin"></span>':'↻ recheck'}</button></div>
  <div class="tiny muted">Find an opportunity, take action, then verify the financial outcome. Only verified results count as savings.</div>

  <div class="save-summary">
    <div class="confirmed"><span>Verified saved</span><b>${$m0(sv?.verifiedTotalCents??0)}</b><small>${sv?.events.length??0} outcome${(sv?.events.length??0)===1?'':'s'} with proof</small></div>
    <div><span>Needs your decision</span><b>${reviews.length+actions.length}</b><small>${$m0(potential)}/yr potential · not counted</small></div>
  </div>

  <div class="sec"><span class="lbl">Needs your decision</span><button class="act" onclick="S.tab='agent';render()">See agent work →</button></div>
  ${reviews.map((o,i)=>`
    <div class="card decision-card review">
      <div class="decision-status"><span class="badge b-warn">Review needed</span><span>${esc(agentName(o.agent))}</span></div>
      <div class="row" style="align-items:flex-start"><div class="decision-icon"><iconify-icon icon="ph:magnifying-glass-bold"></iconify-icon></div>
        <div class="grow"><div class="decision-title">${esc(o.title)}</div>
          <div class="decision-detail">${esc(o.detail)}</div>
          <div class="agent-evidence"><span>${Math.round((o.confidence??0)*100)}% pattern confidence</span><span>${$m0(o.annualCents)} annual cost under review</span></div></div></div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn go" onclick="startReview(${i})">Start action</button>
        <button class="btn ghost" onclick="keepReview(${i})">Worth keeping</button>
      </div>
    </div>`).join('')}
  ${actions.map((o,i)=>`
    <div class="card decision-card ready">
      <div class="decision-status"><span class="badge b-save">Evidence ready</span><span>${esc(agentName(o.agent))}</span></div>
      <div class="row" style="align-items:flex-start"><div class="decision-icon"><iconify-icon icon="ph:check-circle-bold"></iconify-icon></div><div class="grow">
        <div class="decision-title">${esc(o.title)}</div><div class="decision-detail">${esc(o.detail)}</div>
        <div class="agent-evidence"><span>${$m0(o.annualCents)} annual potential</span><span>not counted yet</span></div></div></div>
      <button class="btn go" onclick="startOpportunity(${i})">Start action</button>
    </div>`).join('')}
  ${!reviews.length&&!actions.length?`<div class="card empty-decision"><iconify-icon icon="ph:check-circle-bold"></iconify-icon><b>No decisions waiting</b><span>Your agents found no evidence-backed savings action in the current data. Open Agents to see what each one checked.</span><button class="btn ghost" onclick="S.tab='agent';render()">Review agent investigations</button></div>`:''}

  ${workflows.length?`<div class="sec"><span class="lbl">Savings actions</span><span class="act">verification required</span></div>
  ${workflows.map(a=>`<div class="card decision-card workflow-card"><div class="decision-status"><span class="badge ${a.status==='awaiting_verification'?'b-warn':'b-save'}">${a.status==='awaiting_verification'?'Awaiting proof':'Action started'}</span><span>${esc(agentName(a.agent))}</span></div><div class="row" style="align-items:flex-start"><div class="decision-icon"><iconify-icon icon="ph:hourglass-medium-bold"></iconify-icon></div><div class="grow"><div class="decision-title">${esc(a.title)}</div><div class="decision-detail">${esc(a.detail)}</div><div class="agent-evidence"><span>${$m0(a.annualCents??a.amountCents)} potential</span><span>not counted</span></div></div></div><div class="workflow-steps"><span class="done">1 · Started</span><span class="${a.status==='awaiting_verification'?'done':''}">2 · Awaiting proof</span><span>3 · Verified</span></div><div class="row workflow-actions">${a.status==='action_started'?`<button class="btn ghost" onclick="awaitSaving('${a.id}')">Action submitted</button>`:''}<button class="btn go" onclick="verifySaving('${a.id}','${proofKind(a.agent)}')">${proofLabel(a.agent)}</button><button class="btn ghost" onclick="rejectSaving('${a.id}')">No savings realized</button></div></div>`).join('')}`:''}

  ${monitoring.length||alerts.length||sp?.uncategorisedShare>5?`<div class="sec"><span class="lbl">Monitoring</span><span class="act">observations, not savings</span></div>
  <div class="card progress-list">
    ${alerts.map(a=>`<button class="progress-row" onclick="S.tab='agent';render()"><iconify-icon icon="ph:trend-up-bold"></iconify-icon><span><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></span><em>Review →</em></button>`).join('')}
    ${monitoring.length?`<button class="progress-row" onclick="S.tab='ask';render()"><iconify-icon icon="ph:bell-ringing-bold"></iconify-icon><span><b>${monitoring.length} price agent${monitoring.length===1?'':'s'} monitoring</b><small>${monitoring.map(h=>h.name).slice(0,2).map(esc).join(' · ')}</small></span><em>Shop →</em></button>`:''}
    ${sp?.uncategorisedShare>5?`<button class="progress-row" onclick="teachNext()"><iconify-icon icon="ph:tag-bold"></iconify-icon><span><b>${sp.uncategorisedShare}% needs categorization</b><small>${(S.unknowns||[]).length} merchant${(S.unknowns||[]).length===1?'':'s'} need your input</small></span><em>Review →</em></button>`:''}
  </div>`:''}

  <div class="sec"><span class="lbl">Savings confirmed</span><span class="act">your completed actions</span></div>
  ${sv?.events.length?`<div class="card confirmed-ledger">${sv.events.map((e,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
    <div class="decision-icon done"><iconify-icon icon="ph:check-bold"></iconify-icon></div><div class="grow"><div style="font-size:13px;font-weight:650">${esc(e.evidence?.note??title(e.method))}</div>
      <div class="tiny muted" style="margin-top:2px">${new Date(e.createdAt).toLocaleDateString()} · ${title(e.method)}</div></div>
    <div style="font-weight:750;color:var(--save)">${$m0(e.amountCents+e.amountCents*e.recurringMonths)}</div></div>`).join('')}</div>`
    :'<div class="card"><div class="tiny muted">Nothing verified yet. Verafi counts savings only after a completed action has a confirmed financial outcome.</div></div>'}`;
}

function agentName(id='') {
  const a=(S.state?.agentReview?.agents??[]).find(x=>x.id===id);
  return a?.label??title(id||'Agent');
}

/* ---------------------------------------------------------------- wallet */
function viewWallet() {
  const st = S.state, cards = S.cards, sp = S.spend;
  const held = (st.instruments ?? []).filter(i => i.balanceCents != null);
  const total = held.reduce((a,i)=>a+i.balanceCents,0);
  const ex = sp?.excluded ?? {};
  const cardIdeas = cardRecommendations(cards);
  return `
  ${BRAND()}
  <div class="top"><h1>Cards</h1><span class="sp"></span>
    <button class="chipbtn" onclick="S.tab='settings';render()">⚙</button></div>
  <div class="tiny muted">Your accounts, read through Plaid. Verafi holds nothing.</div>

  <div class="card" style="border-color:var(--save)">
    <div class="row" style="align-items:flex-start">
      <div class="dot" style="background:color-mix(in srgb,var(--save) 12%,transparent)">🔒</div>
      <div class="grow">
        <div style="font-weight:700;font-size:14px">Verafi holds $0.00 of your money</div>
        <div class="tiny muted" style="margin-top:5px;line-height:1.6">Read-only access. It can see balances and transactions but cannot move a cent. Your funds are not held here; keep the Verafi data file backed up so its history is recoverable.</div>
      </div>
    </div>
  </div>

  ${held.length ? `<div class="card">
    <div class="tiny muted">Visible across your linked accounts</div>
    <div class="big" style="margin-top:4px">${$m(total)}</div>
  </div>` : ''}

  ${cardIdeas.length?`<div class="sec"><span class="lbl">Agent card guide</span><span class="act">from cards you tagged</span></div>
  <div class="card agent-guide">${cardIdeas.map((x,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
    <div class="grow"><div style="font-size:13px;font-weight:650">${title(x.category)}</div>
      <div class="tiny muted" style="margin-top:2px">Use ${esc(x.name)}</div></div><span class="badge b-save">${x.mult}x</span></div>`).join('')}</div>`:''}

  <div class="sec"><span class="lbl">Connected instruments</span></div>
  ${(st.instruments ?? []).map(i=>`
    <div class="card">
      <div class="row">
        <div class="dot">${i.rail==='card_credit'?'💳':i.rail==='card_debit'?'🏦':'⬡'}</div>
        <div class="grow"><div style="font-size:13.5px;font-weight:650">${esc(i.displayName)}</div>
          <div class="tiny muted" style="margin-top:3px">${i.rail.replace('_',' ')}${i.cardKey?' · tagged '+i.cardKey.replace(/_/g,' '):''}</div></div>
        ${i.balanceCents!=null?`<div style="font-weight:650">${$m(i.balanceCents)}</div>`:'<div class="tiny muted">credit</div>'}
      </div>
      <div class="row" style="margin-top:10px;padding-top:9px;border-top:1px solid var(--line);gap:6px;flex-wrap:wrap">
        <span class="badge b-save">read · live</span>
        <span class="badge b-warn">automatic payments unavailable</span>
      </div>
      <div class="tiny" style="color:var(--dim);margin-top:7px;line-height:1.5">
        Verafi can recommend the right card, but it cannot move money or pay a bill. Checkout and payments stay with your bank or merchant.
      </div>
    </div>`).join('') || '<div class="card"><div class="tiny muted">No accounts linked yet. ⚙ → Link an account.</div></div>'}

  <div class="sec"><span class="lbl">Not counted as spending</span></div>
  <div class="card">
    <div class="tiny muted" style="line-height:1.6;margin-bottom:11px">Money leaving your account isn't always money spent. These are excluded from every total and every finding:</div>
    ${[['Investments','investmentCents','You got richer, not poorer'],
       ['Card & loan payments','debtPaymentCents','Already counted when you spent it'],
       ['Taxes','taxCents','Not optional, not an opportunity'],
       ['Transfers','transferCents','Still your money']]
      .map(([label,key,why],i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
        <div class="grow"><div style="font-size:13px;font-weight:600">${label}</div>
        <div class="tiny muted" style="margin-top:2px">${why}</div></div>
        <div style="font-weight:650">${$m0(ex[key] ?? 0)}</div></div>`).join('')}
  </div>`;
}

function cardRecommendations(cards) {
  if(!cards?.rules||!cards?.instruments?.length)return [];
  return ['dining','grocery','travel'].map(category=>{
    const rules=cards.rules[category]??cards.rules.default??{};
    return cards.instruments.map(i=>({category,name:i.displayName,mult:rules[i.cardKey]??1}))
      .sort((a,b)=>b.mult-a.mult)[0];
  }).filter(x=>x&&x.mult>1);
}

/* ---------------------------------------------------------------- agent */
function viewAgent() {
  const st = S.state, f = st.findings ?? [];
  const review=st.agentReview??{coverage:{},agents:[]};
  const customCats=(S.dealCats??[]).filter(c=>c.custom);
  const CAP = { observe:'Watches and flags', recommend:'Researches and advises',
                execute_authorized:'Acts with your approval', execute_preauthorized:'Acts inside a signed limit' };
  return `
  ${BRAND()}
  <div class="top"><h1>Agents</h1><span class="sp"></span>
    <button class="chipbtn" onclick="runAgentsNow()">${S.busy?'<span class="spin"></span>':'↻ run'}</button></div>
  <div class="tiny muted">${(st.agents??[]).filter(a=>a.enabled).length} of ${(st.agents??[]).length} running · every 24h</div>

  <div class="agent-brief">
    <div><span>Transactions reviewed</span><b>${review.coverage.transactions??0}</b></div>
    <div><span>History</span><b>${review.coverage.days??0} days</b></div>
    <div><span>Account-attributed</span><b>${review.coverage.attributableToAccount??0}</b></div>
  </div>

  ${S.insight?.ok ? `<div class="card" style="border-color:var(--spend)">
    <div class="tiny muted">Latest agent readout</div>
    <div style="font-weight:650;font-size:14px;line-height:1.5;margin-top:6px">${esc(S.insight.headline)}</div>
  </div>` : ''}

  <div class="card" style="border-color:${st.llmProvider?.allowPersonal?'var(--save)':'var(--warn)'}">
    <div style="font-weight:700;font-size:13.5px">Reasoning status · ${st.llmProvider?.allowPersonal?'hybrid':'local analysis only'}</div>
    <div class="tiny muted" style="margin-top:5px;line-height:1.6">${st.llmProvider?.allowPersonal
      ? `Detectors calculate exact candidates locally; ${esc(st.llmProvider.provider)} prioritizes and explains them.`
      : 'The free model is not receiving personal transaction data. Detectors still run locally, but an LLM has not independently investigated each agent. Verafi will not pretend otherwise.'}</div>
  </div>

  <div class="sec"><span class="lbl">Your agents</span></div>
  ${(st.agents ?? []).map((a,i)=>{
    const audit=review.agents?.find(x=>x.label===a.name);
    const mine = f.filter(x => x.agent === (audit?.id ?? a.name.toLowerCase().replace(/\s+/g,'_')));
    const expanded=S.openAgent===a.id;
    return `<div class="card agent-card" style="${a.enabled?'':'opacity:.6'}">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div class="row" style="gap:6px"><span style="font-weight:650;font-size:13.5px">${esc(a.name)}</span>
            <span class="badge b-spend">${esc(a.surface)}</span>
            ${mine.length?`<span class="badge b-save">${mine.length} found</span>`:''}</div>
          <div class="agent-counts"><span>${audit?.candidates??0} candidates</span><span>${audit?.confirmed??0} confirmed</span><span>${audit?.needsReview??0} need review</span></div>
          <div class="tiny muted" style="margin-top:7px;line-height:1.55">${a.enabled
            ? (mine.length ? esc(mine[0].detail ?? mine[0].title)
              : esc(audit?.result??`No usable evidence was available for ${audit?.scope??'this investigation'}.`))
            : `Off — ${esc(audit?.scope??'no analysis is being run')}.`}</div>
          <div class="tiny" style="color:var(--dim);margin-top:6px">Next: ${esc(audit?.next??CAP[a.capability]??a.capability)}</div>
        </div>
        <button class="tog ${a.enabled?'on':''}" role="switch" aria-checked="${a.enabled}" aria-label="${a.enabled?'Disable':'Enable'} ${escAttr(a.name)}" onclick="toggleAgent('${a.id}',${!a.enabled})"><i></i></button>
      </div>
      <button class="agent-expand" onclick="S.openAgent=S.openAgent==='${a.id}'?null:'${a.id}';render()">${expanded?'Hide investigation':'View investigation'} <span>${expanded?'⌃':'⌄'}</span></button>
      ${expanded?`<div class="agent-investigation">
        <div><span>What it checked</span><b>${esc(audit?.scope??'No defined scope')}</b></div>
        <div><span>Current result</span><b>${a.enabled?`${audit?.candidates??0} candidates · ${audit?.confirmed??0} confirmed · ${audit?.needsReview??0} need review`:'Agent is off'}</b></div>
        <div><span>Evidence</span><b>${mine.length?esc(mine.map(x=>x.title).slice(0,3).join(' · ')):audit?.blocker?esc(audit.blocker):audit?.candidates?`${audit.candidates} candidates were checked; the evidence was not strong enough to interrupt you.`:`No qualifying evidence was available.`}</b></div>
        <div><span>Next action</span><b>${esc(audit?.next??CAP[a.capability]??a.capability)}</b></div>
        <div class="agent-method"><iconify-icon icon="ph:shield-check-bold"></iconify-icon><span>${st.llmProvider?.allowPersonal?'Local calculations find exact amounts; the reasoning model prioritizes and explains them.':'This agent ran locally. The free model did not inspect personal financial details.'}</span></div>
      </div>`:''}
    </div>`;}).join('')}

  ${customCats.length?`<div class="sec"><span class="lbl">Custom shopping agents</span><span class="act">created by you</span></div>
  ${customCats.map(c=>{const watches=(S.hunts??[]).filter(h=>h.category===c.key);return `<div class="card agent-card"><div class="row" style="align-items:flex-start"><div class="decision-icon"><iconify-icon icon="${esc(c.icon)}"></iconify-icon></div><div class="grow">
    <div class="row" style="gap:6px"><b style="font-size:13.5px">${esc(c.label)}</b><span class="badge b-spend">custom</span></div><div class="tiny muted" style="margin-top:5px;line-height:1.55">${esc(c.context)}</div>
    <div class="agent-counts"><span>$${c.budget} budget</span><span>${c.defaultDropPct}% default alert</span><span>${watches.length} active watch${watches.length===1?'':'es'}</span></div></div></div>
    <button class="agent-expand" onclick="S.openDeal='${c.key}';S.tab='ask';render();scrollTo(0,0)">Research this category <span>→</span></button></div>`;}).join('')}`:''}

  ${(S.hunts??[]).length?`<div class="sec"><span class="lbl">Shopping agents</span><span class="act">custom price triggers</span></div>
  ${(S.hunts??[]).map(h=>`<div class="card agent-card"><div class="row" style="align-items:flex-start"><div class="decision-icon"><iconify-icon icon="ph:bell-ringing-bold"></iconify-icon></div><div class="grow">
    <div class="row" style="gap:6px"><b style="font-size:13.5px">${esc(h.name)}</b><span class="badge ${h.recommendation?.status==='buy_now'?'b-save':'b-spend'}">${esc(h.recommendation?.label??'Monitoring')}</span></div>
    <div class="tiny muted" style="margin-top:5px;line-height:1.55">${esc(h.summary)}</div><div class="tiny" style="color:var(--dim);margin-top:6px">${esc(h.recommendation?.detail??'Waiting for its first price check.')}</div></div>
    <button class="tog ${h.enabled?'on':''}" role="switch" aria-checked="${h.enabled}" aria-label="${h.enabled?'Disable':'Enable'} ${escAttr(h.name)}" onclick="toggleHunt('${h.id}',${!h.enabled})"><i></i></button></div>
    <button class="agent-expand" onclick="runHunt('${h.id}')">Check current price <span>→</span></button></div>`).join('')}`:''}

  <div class="sec"><span class="lbl">Activity log</span><span class="act">${(st.runs??[]).length} runs</span></div>
  <div class="card">
    ${(st.runs ?? []).slice(0,12).map((r,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
      <div class="grow"><div style="font-size:12.5px;font-weight:600">${esc(r.intentText ?? 'run')}</div>
      <div class="tiny muted" style="margin-top:2px">${new Date(r.startedAt).toLocaleString()} · ${r.steps} steps</div></div>
      <span class="badge ${r.status==='completed'?'b-save':'b-warn'}">${esc(r.status)}</span></div>`).join('')
      || '<div class="tiny muted">No runs yet.</div>'}
  </div>`;
}

/* ---------------------------------------------------------------- settings */
function viewSettings() {
  const st = S.state, cards = S.cards;
  return `
  <div class="top"><button class="chipbtn" onclick="S.tab='ask';render()">← Back</button>
    <span class="sp"></span><h1 style="font-size:20px">Setup</h1></div>
  ${S.actionNote?`<div class="action-toast" role="status">${esc(S.actionNote)}</div>`:''}

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
      : `<div class="tiny muted" style="line-height:1.55">Bank connection is not available in this environment. You can continue by importing a statement.</div>`}
    <button class="btn ghost" onclick="$('file2').click()">Import a CSV / OFX file</button>
    <input type="file" id="file2" multiple accept=".csv,.ofx,.qfx,.txt" style="display:none" onchange="importFiles(this.files)"/>
  </div>

  ${coveragePanel(st.coverage)}

  ${(st.imports??[]).length?`<div class="sec"><span class="lbl">Import history</span><span class="act">latest files</span></div><div class="card">${st.imports.slice(0,6).map((x,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}><div class="grow"><div style="font-size:12.5px;font-weight:650">${esc(x.filename)}</div><div class="tiny muted">${new Date(x.importedAt).toLocaleString()} · ${x.format}</div></div><span class="badge ${x.added?'b-save':'b-warn'}">${x.added} added · ${x.skipped} skipped</span></div>`).join('')}</div>`:''}

  ${(st.notifications??[]).length?`<div class="sec"><span class="lbl">Notification history</span><span class="act">delivery status</span></div><div class="card">${st.notifications.slice(0,6).map((x,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}><div class="grow"><div style="font-size:12.5px;font-weight:650">${esc(x.title)}</div><div class="tiny muted">${new Date(x.createdAt).toLocaleString()}${x.error?` · ${esc(x.error)}`:''}</div></div><span class="badge ${x.status==='sent'?'b-save':x.status==='failed'?'b-warn':'b-spend'}">${title(x.status)}</span></div>`).join('')}</div>`:''}

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
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${a.enabled
            ? 'Analyzes your connected transactions and reports only evidence-backed findings.'
            : 'Off — no analysis is being run.'}</div>
        </div>
        <button class="tog ${a.enabled?'on':''}" role="switch" aria-checked="${a.enabled}" aria-label="${a.enabled?'Disable':'Enable'} ${escAttr(a.name)}" onclick="toggleAgent('${a.id}',${!a.enabled})"><i></i></button>
      </div>
    </div>`).join('')}

  <div class="sec"><span class="lbl">Build</span></div>
  <div class="card"><div class="row">
    <span class="tiny muted grow">Running version</span>
    <span class="badge b-save">${esc(st.version ?? 'unknown')}</span></div>
    <div class="tiny" style="color:var(--dim);margin-top:8px">The page assets and server are version-stamped together. A hard refresh should show this same version after every deployment.</div>
  </div>

  <div class="sec"><span class="lbl">Danger</span></div>
  <div class="card"><button class="btn ghost" style="color:var(--dang)" onclick="wipe()">Erase everything and start over</button></div>
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

function coveragePanel(c) {
  if(!c)return '';
  return `<div class="sec"><span class="lbl">Data coverage</span><span class="act">what every agent can actually see</span></div>
  <div class="card coverage-card">
    <div class="coverage-grid"><div><b>${c.transactions}</b><span>transactions</span></div><div><b>${c.historyDays}</b><span>days observed</span></div><div><b>${c.cards}</b><span>credit cards</span></div><div><b>${c.categorisedPct}%</b><span>categorised</span></div></div>
    ${(c.perInstrument??[]).map(i=>`<div class="li"><div class="grow"><div style="font-size:12.5px;font-weight:650">${esc(i.name)}</div><div class="tiny muted">${i.transactions} transactions · ${i.historyDays} days</div></div><span class="badge ${i.historyDays>=180?'b-save':'b-warn'}">${i.historyDays>=180?'usable':'thin'}</span></div>`).join('')}
    ${c.legacyConnections?`<div class="guard" style="border-color:var(--warn)"><b style="color:var(--warn)">Older Plaid connection detected.</b><br/>It was initialized before Verafi requested 730 days. Plaid cannot expand that Item after initialization; a controlled relink is required to retrieve older available history.</div>`:''}
    ${c.historicalSyncPending?`<div class="tiny muted" style="margin-top:9px">Plaid is still completing the historical pull. Verafi will keep syncing it.</div>`:''}
  </div>`;
}

async function autoCategorise() {
  S.busy = true; render();
  try {
    const r = await api('/api/autocategorise', {});
    if (r.ok) S.actionNote=`Categorised ${r.learned} merchants for $${(r.costUsd||0).toFixed(3)}.`;
    else S.error=r.error||r.reason||'Automatic categorization could not finish.';
    await load();
  } catch (e) { S.error = e.message; }
  S.busy = false; render();
}

async function teachNext() {
  const u = (S.unknowns || [])[0];
  if (!u) { S.actionNote='Everything is categorized.';render();return; }
  openModal('teach',{merchant:u});
}

async function setCard(id, cardKey) { await api('/api/instruments/card', { id, cardKey }); await load(); }
async function wipe() {
  openModal('wipe');
}

function modalView(){
  const m=S.modal;if(!m)return '';
  let titleText='Confirm action',body='',primary='Continue',field='';
  if(m.kind==='deleteHunt'){titleText='Delete price watch?';body=`${esc(m.name||'This watch')} will stop checking prices.`;primary='Delete watch';}
  if(m.kind==='deleteCategory'){titleText='Delete shopping agent?';body='Existing price watches will keep running until you remove them separately.';primary='Delete agent';}
  if(m.kind==='dropDeal'){titleText='Remove saved product?';body=`${esc(m.name||'This product')} will leave your Shop list.`;primary='Remove';}
  if(m.kind==='wipe'){titleText='Erase all Verafi data?';body='This permanently removes imported transactions, settings, findings, and savings history from this private environment.';primary='Erase everything';field='<label>Type ERASE to confirm<input id="modalValue" autocomplete="off" placeholder="ERASE"/></label>';}
  if(m.kind==='holdDeal'){titleText='Save this research';body='Enter the current price so Verafi can track the item without guessing.';primary='Save product';field='<label>Current price<input id="modalValue" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="99.99"/></label>';}
  if(m.kind==='teach'){titleText='Categorize this merchant';body=`${esc(m.merchant?.name)} · ${m.merchant?.count??0} transaction${m.merchant?.count===1?'':'s'} · ${$m0(m.merchant?.cents??0)}`;primary='Save category';field=`<label>Category<select id="modalValue"><option value="">Choose a category</option>${(S.taxonomy??[]).map(c=>`<option value="${escAttr(c.key)}">${esc(c.label)}</option>`).join('')}</select></label>`;}
  return `<div class="sheet-backdrop" onclick="if(event.target===this)closeModal()"><section class="sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="sheet-title"><div><span>Verafi</span><h2 id="modalTitle">${titleText}</h2></div><button aria-label="Close dialog" onclick="closeModal()">×</button></div><p class="muted modal-copy">${body}</p>${field}<div class="row modal-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button id="modalPrimary" class="btn go" onclick="confirmModal()">${primary}</button></div></section></div>`;
}
async function confirmModal(){
  const m=S.modal;if(!m)return;
  try{
    if(m.kind==='deleteHunt')await api('/api/hunts/delete',{id:m.id});
    if(m.kind==='deleteCategory')await api('/api/deals/categories/delete',{id:m.id});
    if(m.kind==='dropDeal')await api('/api/deals/drop',{id:m.id});
    if(m.kind==='holdDeal'){const price=Number($('modalValue')?.value);if(!Number.isFinite(price)||price<=0)throw new Error('Enter a valid current price.');await api('/api/deals/hold',{title:m.name,priceCents:Math.round(price*100),category:S.openDeal??'other',url:''});}
    if(m.kind==='teach'){const category=$('modalValue')?.value;if(!category)throw new Error('Choose a category.');await api('/api/teach',{merchant:String(m.merchant.name).toLowerCase().slice(0,40),category});S.actionNote=`Categorized ${m.merchant.name}.`;}
    if(m.kind==='wipe'){if($('modalValue')?.value!=='ERASE')throw new Error('Type ERASE exactly to continue.');await api('/api/reset',{});location.reload();return;}
    S.modal=null;await load();
  }catch(e){S.error=e.message;render();}
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
    let added=0,skipped=0;
    for (const f of files) {
      const text = await f.text();
      const r = await api('/api/import', { filename: f.name, text });
      if (r.error) throw new Error(r.error);
      added+=r.added??0;skipped+=r.skipped??0;
    }
    S.actionNote=`Import complete: ${added} transactions added${skipped?`, ${skipped} duplicates skipped`:''}.`;
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
async function setSpendDays(days){S.spendDays=days;S.busy=true;render();try{S.spend=await api(`/api/spend?days=${days}`);}catch(e){S.error=e.message;}S.busy=false;render();}

async function toggleAgent(id, enabled) { await api('/api/agents/toggle', { id, enabled }); await load(); }

async function runAgentsNow() {
  S.busy = true; S.error = null; render();
  try { const r = await api('/api/agents/run', {}); if (r.notified) console.log('notified via', r.notified); await load(); }
  catch (e) { S.error = e.message; }
  S.busy = false; render();
}
async function dismiss(key) { await api('/api/findings/dismiss', { key }); await load(); }

async function startOpportunity(i) { return startSaving((S.save.opportunities??[])[i]); }
async function startReview(i) { return startSaving((S.save.reviewQueue??[])[i]); }

async function keepReview(i) {
  const o=(S.save.reviewQueue??[])[i];
  if(!o)return;
  await api('/api/findings/dismiss',{key:`${o.agent}:${o.ref}`});
  await load();
}

async function startSaving(o) { if(!o)return;await api('/api/save/actions/start',{findingKey:`${o.agent}:${o.ref}`});await load(); }
async function awaitSaving(id) { await api('/api/save/actions/await',{id});await load(); }
function proofKind(agent){return ['subscription_auditor','overlap_watch','dormant_spend'].includes(agent)?'cancellation_confirmation':agent==='fee_catcher'?'fee_reversal':agent==='duplicate_watch'?'refund_received':agent==='card_router'?'card_charge_confirmed':'lower_price_confirmed';}
function proofLabel(agent){return ['subscription_auditor','overlap_watch','dormant_spend'].includes(agent)?'Cancellation confirmed':agent==='fee_catcher'?'Fee reversed':agent==='duplicate_watch'?'Refund received':agent==='card_router'?'Card charge confirmed':'Lower price confirmed';}
async function verifySaving(id,kind){await api('/api/save/actions/verify',{id,proofKind:kind,confirmed:true});await load();}
async function rejectSaving(id){await api('/api/save/actions/reject',{id,reason:'No savings realized'});await load();}

function toggleTheme() {
  document.body.classList.toggle('dark');
  document.querySelector('meta[name=theme-color]')
    .setAttribute('content', document.body.classList.contains('dark') ? '#0C0F0A' : '#F6F7F3');
}

/* ---------------------------------------------------------------- render */
function render() {
  const st = S.state;
  if (S.staleServer && st) {
    const banner = `<div class="card" style="border-color:var(--warn);margin-bottom:4px">
      <div class="tiny" style="line-height:1.6"><b style="color:var(--warn)">Server is out of date.</b>
      ${S.staleServer.length} endpoint(s) missing: ${S.staleServer.map(esc).join(', ')}.
      The app files updated but the server didn't — redeploy and restart it.
      Running version: <b style="color:var(--ink)">${esc(st.version ?? 'pre-v8')}</b></div></div>`;
    setTimeout(()=>{ const a=$('app'); if(a && !a.innerHTML.includes('Server is out of date')) a.insertAdjacentHTML('afterbegin', banner); }, 0);
  }
  $('app').innerHTML = S.locked ? viewLock()
    : !st ? '<div class="empty"><span class="spin"></span></div>'
    : !st.linked ? viewOnboard()
    : S.tab === 'home' ? viewHome()
    : S.tab === 'spend' ? viewSpend()
    : S.tab === 'settings' ? viewSettings()
    : S.tab === 'wallet' ? viewWallet()
    : S.tab === 'agent' ? viewAgent()
    : S.tab === 'save' ? viewSave() : viewShop();
  $('app').insertAdjacentHTML('beforeend',modalView());

  if (S.locked) { $('tabs').innerHTML = ''; setTimeout(()=>$('pc')?.focus(), 60); return; }
  $('tabs').innerHTML = !st?.linked ? '' :
    [['home','Home'],['ask','Shop'],['spend','Spend'],['save','Save'],['wallet','Cards'],['agent','Agents']].map(([k,l])=>
      `<button class="${S.tab===k?'on':''}" aria-current="${S.tab===k?'page':'false'}" onclick="go('${k}')">
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

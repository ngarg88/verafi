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
const title = (s) => String(s ?? '').replace(/[-_]/g,' ').replace(/\b\w/g, m => m.toUpperCase());

const S = { tab:'ask', locked:false, state:null, cards:null, presets:null, answer:null, openCat:null, openDeal:null, dealCats:null, watchlist:null, hunts:null, unknowns:null, taxonomy:null, insight:null, lastQuery:null, spend:null, save:null, forecast:null, busy:false, error:null, compare:[], compareOpen:false, actionNote:null };

const ICONS = {
  ask:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  spend:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 9.5h20"/>',
  save:'<path d="M12 3v18"/><path d="M17 7.5c0-2-2.2-3-5-3s-5 1-5 3 2.2 2.7 5 3.3 5 1.4 5 3.4-2.2 3.3-5 3.3-5-1.2-5-3.2"/>',
  wallet:'<rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18"/><circle cx="16.5" cy="13" r="1.3"/>',
  agent:'<path d="M12 3 4 6.5v5c0 4.4 3.2 8.3 8 9.5 4.8-1.2 8-5.1 8-9.5v-5L12 3Z"/><path d="m9 12 2 2 4-4"/>'
};

async function load() {
  try { S.state = await api('/api/state'); S.locked = false; }
  catch (e) { if (/locked/i.test(e.message)) { S.locked = true; S.state = null; return render(); } throw e; }
  if (S.state.linked) {
    // One missing endpoint must never blank the whole app. Each call fails on its own.
    const safe = (p) => api(p).catch(e => ({ __failed: p, __error: e.message }));
    const [sp, sv, fc, cd, rs, dc, wl, hu, un, ins] = await Promise.all([
      safe('/api/spend?days=30'), safe('/api/save'), safe('/api/forecast'),
      safe('/api/cards'), safe('/api/research'), safe('/api/deals/presets'), safe('/api/deals/watchlist'), safe('/api/hunts'), safe('/api/unknowns'), safe('/api/insight')
    ]);
    const failed = [sp,sv,fc,cd,rs,dc,wl,hu,un,ins].filter(x => x?.__failed).map(x => x.__failed);
    Object.assign(S, {
      spend: sp.__failed ? null : sp, save: sv.__failed ? null : sv,
      forecast: fc.__failed ? null : fc, cards: cd.__failed ? null : cd,
      presets: rs.__failed ? null : rs.presets,
      dealCats: dc?.__failed ? [] : dc.categories,
      watchlist: wl?.__failed ? [] : wl.items,
      hunts: hu?.__failed ? [] : hu.hunts,
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

/* ---------------------------------------------------------------- shop */
function viewShop() {
  const r = S.answer, cats = S.dealCats ?? [], watch = S.watchlist ?? [];
  const open = S.openDeal;

  if (open) {
    const c = cats.find(x => x.key === open);
    return `
    <div class="top"><button class="chipbtn" onclick="S.openDeal=null;S.answer=null;render()">← Shop</button><span class="sp"></span></div>
    <div class="card"><div class="row">
      <div class="dot">${c.icon}</div>
      <div class="grow"><div style="font-weight:650;font-size:15px">${esc(c.label)}</div>
      <div class="tiny muted" style="margin-top:3px">${esc(c.basis)}</div></div></div>
    </div>
    <div class="sec"><span class="lbl">Ask the agent</span><span class="act">budget ~$${c.budget}</span></div>
    ${c.asks.map(a=>`<div class="card" onclick="doAsk(null,${JSON.stringify(a).replace(/"/g,'&quot;')})" style="cursor:pointer">
      <div class="row"><span class="grow" style="font-size:13.5px;line-height:1.45">${esc(a)}</span><span class="muted">›</span></div></div>`).join('')}
    <div class="card">
      <input id="q" placeholder="or ask your own…" style="border:0;padding:4px 0;font-size:15px"
             onkeydown="if(event.key==='Enter')doAsk()"/>
      <button class="btn go" onclick="doAsk()">${S.busy?'Researching…':'Search'}</button>
    </div>
    ${answerCard(r)}`;
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

  ${watch.length ? `<div class="card" onclick="S.tab='spend';render()" style="cursor:pointer;border-color:var(--save)">
    <div class="row"><span class="grow tiny" style="line-height:1.5">
      <b style="color:var(--ink)">${watch.length} item${watch.length>1?'s':''} waiting in Spend</b> for you to review and buy.</span>
      <span class="muted">›</span></div></div>` : ''}

  <div class="sec"><span class="lbl">Price watches</span>
    <button class="act" onclick="newHunt()">+ new</button></div>
  ${(S.hunts ?? []).length ? S.hunts.map(h=>`
    <div class="card" style="${h.enabled?'':'opacity:.6'}">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div style="font-size:13.5px;font-weight:650">${esc(h.name)}</div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${esc(h.summary)}</div>
          <div class="tiny" style="color:var(--dim);margin-top:5px">
            ${h.runs} checks${h.matches.length?` · ${h.matches.length} match${h.matches.length>1?'es':''}`:' · nothing yet'}</div>
        </div>
        <div class="tog ${h.enabled?'on':''}" onclick="toggleHunt('${h.id}',${!h.enabled})"><i></i></div>
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn ghost" onclick="runHunt('${h.id}')">${S.busy?'Checking…':'Check now'}</button>
        <button class="btn ghost" style="width:auto;padding:13px 16px" onclick="deleteHunt('${h.id}')">✕</button>
      </div>
    </div>`).join('')
   : `<div class="card"><div class="tiny muted" style="line-height:1.6">No price watches yet. Set a maximum price and your requirements; Verafi checks daily and puts matching options in Spend for your review.</div></div>`}

  <div class="sec"><span class="lbl">Your categories</span><span class="act">by what you spend</span></div>
  ${cats.map(c=>`
    <div class="card" onclick="S.openDeal='${c.key}';S.answer=null;render();scrollTo(0,0)" style="cursor:pointer">
      <div class="row">
        <div class="dot">${c.icon}</div>
        <div class="grow"><div style="font-size:13.5px;font-weight:650">${esc(c.label)}</div>
          <div class="tiny muted" style="margin-top:3px">${esc(c.basis)}</div></div>
        <span class="muted">›</span>
      </div>
    </div>`).join('')}

  ${answerCard(r)}
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
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
  try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.href : ''; }
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
    <div class="best-intro"><iconify-icon icon="ph:sparkle-fill"></iconify-icon><div><h2>Best match</h2><p>${esc(d.summary)}</p></div></div>
    <div class="product-stack">${products.map((p,i)=>productCard(p,i,selected.has(i))).join('')}</div>
    <button class="compare-all" onclick="openComparison()"><iconify-icon icon="ph:scales-bold"></iconify-icon><span>Compare all ${products.length}<small>See prices, features and tradeoffs side by side</small></span><b>›</b></button>
    ${S.actionNote?`<div class="action-toast">${esc(S.actionNote)}</div>`:''}
    <div class="merchant-guard"><iconify-icon icon="ph:shield-check-bold"></iconify-icon><span><b>Your checkout stays with the merchant.</b><small>Verafi never sees or stores your payment information.</small></span></div>
  </section>`;
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
      ${top?`<button class="save-spend" onclick="saveProduct(${i})"><iconify-icon icon="ph:wallet-bold"></iconify-icon><span>Save to Spend<small>Add to your plan & track price</small></span><b>›</b></button>`:''}
      <div class="secondary-actions ${top?'':'four-actions'}"><button class="${isCompared?'selected':''}" onclick="toggleProductCompare(${i})"><iconify-icon icon="ph:scales-bold"></iconify-icon>${isCompared?'Added':'Compare'}</button>
      ${top?'':`<button onclick="saveProduct(${i})"><iconify-icon icon="ph:wallet-bold"></iconify-icon>Save</button>`}
      <button onclick="watchProduct(${i})"><iconify-icon icon="ph:bell-bold"></iconify-icon>Watch price</button>
      <button onclick="visitProduct(${i})" ${url?'':'disabled'}><iconify-icon icon="ph:arrow-square-out-bold"></iconify-icon>Visit seller</button></div>
    </div>
  </article>`;
}
function compareDecision(products) {
  return `<section class="shop-results compare-view"><button class="back-result" onclick="S.compareOpen=false;render()">← Results</button>
    <div class="compare-head"><span>Side-by-side</span><h2>Compare your best matches</h2><p>Current prices and the tradeoffs that matter.</p></div>
    <div class="compare-grid">${products.map((p,i)=>`<article class="compare-card ${i===0?'picked':''}"><span>${esc(p.label)}</span><iconify-icon icon="${productIcon(S.lastQuery)}"></iconify-icon><h3>${esc(p.name)}</h3><strong>${money(p.price)}</strong><small>${esc(p.seller)}</small><ul>${(p.highlights||[]).map(h=>`<li>${esc(h)}</li>`).join('')}</ul><p>${esc(p.tradeoff||p.why)}</p><button onclick="saveProduct(${i})">Save to Spend</button></article>`).join('')}</div>
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
  S.actionNote=`${p.name} was saved to Spend.`; await load();
}
async function watchProduct(i){
  const p=decisionProduct(i); if(!p)return;
  const target=prompt(`Notify me at or below what price?`, String(Math.floor(p.price)));
  if(!target)return;
  const ceiling=Number(target); if(!Number.isFinite(ceiling)||ceiling<=0){S.error='Enter a valid target price.';render();return;}
  await api('/api/hunts',{name:p.name,ceilingCents:Math.round(ceiling*100),traits:[p.seller,p.url].filter(Boolean),source:'web',category:S.openDeal??'other'});
  S.actionNote=`Price watch created for ${p.name} at ${money(ceiling)}.`; await load();
}

const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--ink)">$1</b>');

async function doAsk(preset, presetQuery) {
  const q = presetQuery ?? ($('q') ? $('q').value : '');
  if (!q && !preset) { S.error = 'Type what you are looking for first.'; render(); return; }
  S.busy = true; S.error = null; S.answer = null; S.lastQuery = q; S.compare=[];S.compareOpen=false;S.actionNote=null; render();
  // Never let a hung request look like a dead button.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch('/api/ask', { method:'POST', signal: ctrl.signal,
      headers:{'content-type':'application/json'}, body: JSON.stringify({ query: q, preset }) });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    S.answer = await r.json();
  } catch (e) {
    S.error = e.name === 'AbortError'
      ? 'That took over 30 seconds and was stopped. The server may be busy — try again.'
      : e.message;
  } finally { clearTimeout(t); S.busy = false; render(); }
}

async function holdFromAnswer() {
  const title = (S.lastQuery || 'Saved deal').slice(0, 80);
  const price = prompt('Price you found (in dollars, numbers only):');
  if (!price) return;
  await api('/api/deals/hold', { title, priceCents: Math.round(parseFloat(price)*100),
    category: S.openDeal ?? 'other', url: '' });
  await load();
}
async function newHunt() {
  const name = prompt('What should Verafi watch for?\ne.g. all-inclusive Bahamas');
  if (!name) return;
  const ceiling = prompt('Hard ceiling in dollars (never exceeded):');
  if (!ceiling) return;
  const traits = prompt('Must-haves, comma separated (optional)\ne.g. nonstop, 4 nights, 2 adults 2 kids') || '';
  const web = confirm('Search the web?\n\nOK = search the web (needs an API key)\nCancel = watch my own purchases (free)');
  try {
    await api('/api/hunts', { name, ceilingCents: Math.round(parseFloat(ceiling)*100),
      traits: traits.split(',').map(t=>t.trim()).filter(Boolean),
      source: web ? 'web' : 'history', category: S.openDeal ?? 'other' });
    await load();
  } catch (e) { S.error = e.message; render(); }
}
async function toggleHunt(id, enabled) { await api('/api/hunts/toggle', { id, enabled }); await load(); }
async function deleteHunt(id) { if (confirm('Delete this price watch?')) { await api('/api/hunts/delete', { id }); await load(); } }
async function runHunt(id) {
  S.busy = true; render();
  try {
    const r = await api('/api/hunts/run', { id });
    S.answer = { label:'Price watch result', answer: r.why ?? r.answer ?? (r.matches.length?`Found ${r.matches.length} match — it's in Spend.`:'No match yet.'),
                 evidence: r.evidence ?? (r.sources||[]).map(s=>`${s.title||s.url} — ${s.url}`),
                 steps:[{tool:'price_watch.evaluate',detail:'maximum price enforced on parsed prices'}],
                 disclaimer:'Price watches surface candidates. They cannot buy.', ok:false };
    await load();
  } catch (e) { S.error = e.message; }
  S.busy = false; render();
}
async function dropDeal(id) { await api('/api/deals/drop', { id }); await load(); }
async function approveDeal(id) {
  const a = await api('/api/deals/approve', { id });
  alert(`${a.item.title}\n\nNow ${(a.item.currentPriceCents/100).toFixed(2)}\n${a.affordability}\n` +
        (a.monthlyImpactPct ? `That is ${a.monthlyImpactPct}% of a typical month.\n\n` : '\n') +
        a.handoff.why);
  if (a.item.url) open(a.item.url, '_blank');
}

/* ---------------------------------------------------------------- spend */
function viewCategoryDetail(open) {
  const sp = S.spend, cats = sp?.categories ?? [];
  {
    const c = cats.find(x => x.key === open);
    if (!c) { S.openCat = null; return viewSave(); }
    return `
    <div class="top"><button class="chipbtn" onclick="S.openCat=null;render()">← Save</button>
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
  return `
  ${BRAND()}
  <div class="top"><h1>Spend</h1><span class="sp"></span>
    <button class="chipbtn" onclick="refresh()">${S.busy?'<span class="spin"></span>':'↻'}</button></div>
  <div class="tiny muted">What you're about to buy, and what you already do.</div>

  ${(S.watchlist ?? []).length ? `
  <div class="sec"><span class="lbl">Ready to review</span><span class="act">${S.watchlist.length} queued</span></div>
  ${S.watchlist.map(w=>{
    const moved = w.foundPriceCents - w.currentPriceCents;
    return `<div class="card" style="border-color:var(--spend)">
      <div class="row" style="align-items:flex-start">
        <div class="grow"><div style="font-size:13.5px;font-weight:650;line-height:1.4">${esc(w.title)}</div>
          <div class="tiny muted" style="margin-top:5px">Found at ${$m0(w.foundPriceCents)} · auto-flags at ${$m0(w.targetCents)}</div>
          ${moved>0?`<div class="tiny ok" style="margin-top:3px">↓ ${$m0(moved)} since you saved it</div>`:''}</div>
        <div style="text-align:right"><div style="font-weight:700">${$m0(w.currentPriceCents)}</div></div>
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn go" onclick="approveDeal('${w.id}')">Review &amp; buy</button>
        <button class="btn ghost" style="width:auto;padding:13px 16px" onclick="dropDeal('${w.id}')">Drop</button>
      </div>
    </div>`;}).join('')}
  <div class="tiny" style="color:var(--dim);margin-top:8px;line-height:1.5">Approving opens the merchant's own checkout — Apple Pay works there and your card never passes through Verafi.</div>
  ` : `<div class="card"><div class="tiny muted">Nothing queued. Find something in <b style="color:var(--ink)">Shop</b> and hold it — it lands here for review.</div></div>`}

  <div class="sec"><span class="lbl">Recent activity</span><span class="act">last 30 days</span></div>
  <div class="card"><div class="row">
    <span class="tiny muted grow">Spent ${$m0(sp?.totalCents ?? 0)} · full breakdown lives in <b style="color:var(--ink)">Save</b></span>
    <button class="chipbtn" onclick="S.tab='save';render()">Open</button></div></div>

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
  const sv = S.save, sp = S.spend, fc = S.forecast, cats = sp?.categories ?? [];
  const max = cats[0]?.cents ?? 1;
  const open = S.openCat;
  if (open) return viewCategoryDetail(open);
  return `
  ${BRAND()}
  <div class="top"><h1>Save</h1><span class="sp"></span>
    <button class="chipbtn" onclick="runAgentsNow()">${S.busy?'<span class="spin"></span>':'↻ recheck'}</button></div>
  <div class="tiny muted">Purchases worth reviewing, and things worth stopping. Counts only once you've done it.</div>

  <div class="card" style="border-color:var(--save)">
    <div class="tiny muted">Confirmed saved</div>
    <div class="big ok" style="margin-top:4px">${$m(sv?.verifiedTotalCents ?? 0)}</div>
    <div class="tiny muted" style="margin-top:8px">${sv?.events.length ?? 0} recorded · ${$m0(sv?.totalAnnualOpportunityCents ?? 0)}/yr still on the table</div>
  </div>

  <div class="sec"><span class="lbl">What you actually spend</span><span class="act">last 30 days</span></div>
  <div class="card"><div class="tiny muted">Total spent</div>
    <div class="big" style="margin-top:4px">${$m0(sp?.totalCents ?? 0)}</div>
    <div class="tiny muted" style="margin-top:6px">Investments, card payments, taxes and transfers excluded — see Pay</div></div>

  <div class="sec"><span class="lbl">Categories</span><span class="act">tap to open</span></div>
  ${cats.map(c=>`
    <div class="card" onclick="S.openCat='${c.key}';render();scrollTo(0,0)" style="cursor:pointer">
      <div class="row">
        <div class="dot">${c.icon}</div>
        <div class="grow">
          <div class="row"><span style="font-size:13.5px;font-weight:650" class="grow">${esc(c.label)}</span>
            <span style="font-weight:650">${$m0(c.cents)}</span></div>
          <div class="bar" style="margin-top:7px"><i style="width:${c.cents/max*100}%"></i></div>
          <div class="row" style="margin-top:5px">
            <span class="tiny grow" style="color:var(--dim)">${c.subs.slice(0,3).map(s=>title(s.key)).join(' · ')}</span>
            <span class="tiny muted">${c.share}%</span></div>
        </div>
        <span class="muted" style="margin-left:2px">›</span>
      </div>
    </div>`).join('') || '<div class="card"><div class="tiny muted">No spending in this period.</div></div>'}

  ${S.insight?.ok ? `
  <div class="card" style="border-color:var(--spend)">
    <div class="row" style="align-items:flex-start">
      <div class="dot" style="background:color-mix(in srgb,var(--spend) 14%,transparent)">✦</div>
      <div class="grow"><div style="font-weight:650;font-size:14px;line-height:1.45">${esc(S.insight.headline)}</div></div>
    </div>
    ${(S.insight.items||[]).map(it=>`
      <div style="margin-top:12px;padding-top:11px;border-top:1px solid var(--line)">
        <div class="tiny" style="line-height:1.6">${esc(it.why)}</div>
        <div class="tiny ok" style="margin-top:5px;line-height:1.5">→ ${esc(it.action)}</div>
      </div>`).join('')}
    <div class="tiny" style="color:var(--dim);margin-top:11px">Reasoned by the agent · amounts computed in code, never by the model</div>
  </div>` : (S.state?.llm === false ? `
  <div class="card" style="border-style:dashed">
    <div class="tiny muted" style="line-height:1.6"><b style="color:var(--ink)">Findings are rule-based right now.</b>
    Add an <code>ANTHROPIC_API_KEY</code> and the agent will read them, tell you which three matter and why, and auto-categorise every unknown merchant.</div>
  </div>` : '')}

  ${sp?.uncategorisedShare > 5 ? `<div class="card" style="border-color:var(--warn)">
    <div class="tiny" style="line-height:1.6"><b style="color:var(--warn)">${sp.uncategorisedShare}% uncategorised.</b>
    No rule list covers every merchant. Tell me what these are and I'll remember them permanently.</div>
    ${S.state?.llm ? `<button class="btn go" onclick="autoCategorise()">${S.busy?'Thinking…':'Let the agent categorise them'}</button>`:''}
    <button class="btn ghost" onclick="teachNext()">Do it myself (${(S.unknowns||[]).length} left)</button>
  </div>` : ''}

  ${fc ? `<div class="sec"><span class="lbl">12-month forecast</span><span class="act">with bands</span></div>
  <div class="card">
    ${sparkline(fc.months)}
    <div class="tiny muted" style="margin-top:11px;padding-top:11px;border-top:1px solid var(--line);line-height:1.6">
      Acting on what's in Save trends monthly spend from <b style="color:var(--ink)">${$m0(fc.months[0].projectedCents)}</b>
      to <b class="ok">${$m0(fc.months[11].projectedCents)}</b>. The shaded band is real uncertainty — the wide part needs <i>you</i> to change, not just the app.
    </div>
  </div>` : ''}


  <div class="sec"><span class="lbl">Worth stopping</span><span class="act">${(sv?.opportunities??[]).length} found</span></div>
  ${(sv?.opportunities ?? []).map((o,i)=>`
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div style="font-weight:650;font-size:13.5px;line-height:1.4">${esc(o.title)}</div>
          <div class="tiny muted" style="margin-top:6px;line-height:1.6">${esc(o.detail)}</div>
          <div class="tiny" style="color:var(--dim);margin-top:7px">${esc(o.agent.replace(/_/g,' '))}</div>
        </div>
        <div style="text-align:right;flex:0 0 auto"><div style="font-weight:700;color:var(--save)">${$m0(o.annualCents)}</div>
          <div class="tiny muted">a year</div></div>
      </div>
      <button class="btn ghost" onclick="claim(${i})">I did this — count it</button>
    </div>`).join('') || '<div class="card"><div class="tiny muted">No opportunities found yet. Switch more agents on in ⚙, or import more history.</div></div>'}

  ${sv?.events.length ? `<div class="sec"><span class="lbl">Ledger</span></div>
  <div class="card">${sv.events.map((e,i)=>`<div class="li" ${i===0?'style="padding-top:0"':''}>
    <div class="grow"><div style="font-size:13px;font-weight:600">${title(e.method)}</div>
      <div class="tiny muted" style="margin-top:2px">${new Date(e.createdAt).toLocaleDateString()} · ${esc(e.evidence?.note ?? e.evidence?.kind ?? '')}</div></div>
    <div style="font-weight:700;color:var(--save)">${$m(e.amountCents + e.amountCents*e.recurringMonths)}</div></div>`).join('')}</div>`:''}`;
}

/* ---------------------------------------------------------------- wallet */
function viewWallet() {
  const st = S.state, cards = S.cards, sp = S.spend;
  const held = (st.instruments ?? []).filter(i => i.balanceCents != null);
  const total = held.reduce((a,i)=>a+i.balanceCents,0);
  const ex = sp?.excluded ?? {};
  return `
  ${BRAND()}
  <div class="top"><h1>Pay</h1><span class="sp"></span>
    <button class="chipbtn" onclick="S.tab='settings';render()">⚙</button></div>
  <div class="tiny muted">Your accounts, read through Plaid. Verafi holds nothing.</div>

  <div class="card" style="border-color:var(--save)">
    <div class="row" style="align-items:flex-start">
      <div class="dot" style="background:color-mix(in srgb,var(--save) 12%,transparent)">🔒</div>
      <div class="grow">
        <div style="font-weight:700;font-size:14px">Verafi holds $0.00 of your money</div>
        <div class="tiny muted" style="margin-top:5px;line-height:1.6">Read-only access. It can see balances and transactions and cannot move a cent. There is no held balance, no custody, and nothing to lose if this server disappears.</div>
      </div>
    </div>
  </div>

  ${held.length ? `<div class="card">
    <div class="tiny muted">Visible across your linked accounts</div>
    <div class="big" style="margin-top:4px">${$m(total)}</div>
  </div>` : ''}

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
        <span class="badge b-warn">pay · not available</span>
      </div>
      <div class="tiny" style="color:var(--dim);margin-top:7px;line-height:1.5">
        Agent-initiated payments need Visa Intelligent Commerce or Mastercard Agent Pay — both require a registered business. Not available to a personal account.
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

/* ---------------------------------------------------------------- agent */
function viewAgent() {
  const st = S.state, f = st.findings ?? [];
  const CAP = { observe:'Watches and flags', recommend:'Researches and advises',
                execute_authorized:'Acts with your approval', execute_preauthorized:'Acts inside a signed limit' };
  return `
  ${BRAND()}
  <div class="top"><h1>Agents</h1><span class="sp"></span>
    <button class="chipbtn" onclick="runAgentsNow()">${S.busy?'<span class="spin"></span>':'↻ run'}</button></div>
  <div class="tiny muted">${(st.agents??[]).filter(a=>a.enabled).length} of ${(st.agents??[]).length} running · every 24h</div>

  ${S.insight?.ok ? `<div class="card" style="border-color:var(--spend)">
    <div class="tiny muted">Latest agent readout</div>
    <div style="font-weight:650;font-size:14px;line-height:1.5;margin-top:6px">${esc(S.insight.headline)}</div>
  </div>` : ''}

  <div class="card" style="border-color:var(--save)">
    <div style="font-weight:700;font-size:13.5px">None of these can spend money</div>
    <div class="tiny muted" style="margin-top:5px;line-height:1.6">Every agent here is <b style="color:var(--ink)">observe</b> or <b style="color:var(--ink)">recommend</b>. Spending would require a signed limit and a biometric on your phone — deliberately not built while this is read-only.</div>
  </div>

  <div class="sec"><span class="lbl">Your agents</span></div>
  ${(st.agents ?? []).map((a,i)=>{
    const mine = f.filter(x => x.agent === a.name.toLowerCase().replace(/\s+/g,'_'));
    return `<div class="card" style="${a.enabled?'':'opacity:.6'}">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <div class="row" style="gap:6px"><span style="font-weight:650;font-size:13.5px">${esc(a.name)}</span>
            <span class="badge b-spend">${esc(a.surface)}</span>
            ${mine.length?`<span class="badge b-save">${mine.length} found</span>`:''}</div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.55">${mine.length
            ? esc(mine[0].detail ?? mine[0].title)
            : (a.enabled ? 'No current issue found in your data.' : 'Off — turn on to analyze your data.')}</div>
          <div class="tiny" style="color:var(--dim);margin-top:5px">${CAP[a.capability] ?? a.capability}</div>
        </div>
        <div class="tog ${a.enabled?'on':''}" onclick="toggleAgent('${a.id}',${!a.enabled})"><i></i></div>
      </div>
    </div>`;}).join('')}

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
          <div class="tiny muted" style="margin-top:4px;line-height:1.5">${a.enabled
            ? 'Analyzes your connected transactions and reports only evidence-backed findings.'
            : 'Off — no analysis is being run.'}</div>
        </div>
        <div class="tog ${a.enabled?'on':''}" onclick="toggleAgent('${a.id}',${!a.enabled})"><i></i></div>
      </div>
    </div>`).join('')}

  <div class="sec"><span class="lbl">Build</span></div>
  <div class="card"><div class="row">
    <span class="tiny muted grow">Running version</span>
    <span class="badge b-save">${esc(st.version ?? 'unknown')}</span></div>
    <div class="tiny" style="color:var(--dim);margin-top:8px">If this isn't <b style="color:var(--mut)">v8</b>, the server is still on old code and the deploy didn't take.</div>
  </div>

  <div class="sec"><span class="lbl">Danger</span></div>
  <div class="card"><button class="btn ghost" style="color:var(--dang)" onclick="wipe()">Erase everything and start over</button></div>
  ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}`;
}

async function autoCategorise() {
  S.busy = true; render();
  try {
    const r = await api('/api/autocategorise', {});
    if (r.ok) alert(`Categorised ${r.learned} merchants for $${(r.costUsd||0).toFixed(3)}.`);
    else alert(r.error || r.reason);
    await load();
  } catch (e) { S.error = e.message; }
  S.busy = false; render();
}

async function teachNext() {
  const u = (S.unknowns || [])[0];
  if (!u) { alert('Nothing left to categorise.'); return; }
  const t = S.taxonomy || [];
  const pick = prompt(`${u.name}\n$${Math.round(u.cents/100).toLocaleString()} across ${u.count} transaction(s)\n\n` +
    t.map((c,i)=>`${i+1}. ${c.label}`).join('\n') + '\n\nType a number:');
  if (!pick) return;
  const c = t[parseInt(pick,10)-1];
  if (!c) return;
  await api('/api/teach', { merchant: u.name.toLowerCase().slice(0,40), category: c.key });
  await load();
  if ((S.unknowns||[]).length) setTimeout(teachNext, 200);
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
  const METHOD = { subscription_auditor:'subscription_cancel', fee_catcher:'fee_refund',
    card_router:'card_routing', price_creep:'negotiation', overlap_watch:'subscription_cancel',
    dormant_spend:'subscription_cancel', duplicate_watch:'duplicate_refund' };
  const recurs = ['subscription_auditor','card_router','overlap_watch','dormant_spend','price_creep'].includes(o.agent);
  await api('/api/save/claim', { amountCents: o.amountCents,
    recurringMonths: recurs ? 11 : 0, method: METHOD[o.agent] ?? 'fee_refund',
    evidence: { kind:'confirmed_by_me', note: o.title } });
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
    : S.tab === 'spend' ? viewSpend()
    : S.tab === 'settings' ? viewSettings()
    : S.tab === 'wallet' ? viewWallet()
    : S.tab === 'agent' ? viewAgent()
    : S.tab === 'save' ? viewSave() : viewShop();

  if (S.locked) { $('tabs').innerHTML = ''; setTimeout(()=>$('pc')?.focus(), 60); return; }
  $('tabs').innerHTML = !st?.linked ? '' :
    [['ask','Shop'],['spend','Spend'],['save','Save'],['wallet','Wallet'],['agent','Agents']].map(([k,l])=>
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

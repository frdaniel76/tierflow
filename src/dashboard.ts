/**
 * TierFlow Dashboard — monitoring, quality tiers, and integrations.
 * Vanilla HTML/JS, no framework, no build step.
 * Served at GET /dashboard, polls GET /stats every 5s.
 */

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TierFlow Dashboard</title>
<style>
  :root {
    --bg: #0f1117; --bg2: #1a1d27; --bg3: #242837;
    --fg: #e4e6eb; --fg2: #9ca3af; --fg3: #6b7280;
    --accent: #22c55e; --accent2: #16a34a;
    --blue: #3b82f6; --yellow: #eab308; --red: #ef4444; --purple: #a855f7;
    --border: #2d3348; --radius: 8px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f8fafc; --bg2: #ffffff; --bg3: #f1f5f9;
      --fg: #1e293b; --fg2: #64748b; --fg3: #94a3b8;
      --accent: #16a34a; --accent2: #15803d;
      --blue: #2563eb; --yellow: #ca8a04; --red: #dc2626; --purple: #9333ea;
      --border: #e2e8f0;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; margin-bottom: 0; flex-wrap: wrap; gap: 12px; }
  header h1 { font-size: 20px; font-weight: 600; }
  header h1 span { color: var(--accent); }
  .header-right { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--fg2); }
  select { background: var(--bg3); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 12px; }

  /* Tabs */
  .tab-bar { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  .tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 20px; cursor: pointer; color: var(--fg2); font-size: 14px; font-weight: 500; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  /* Cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
  .card-label { font-size: 12px; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .card-value { font-size: 28px; font-weight: 700; }
  .card-sub { font-size: 12px; color: var(--fg2); margin-top: 2px; }
  .section { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 20px; }
  .section h2 { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--fg2); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--fg3); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; }
  td { padding: 8px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .no-data { color: var(--fg3); font-style: italic; padding: 20px; text-align: center; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }

  /* Tier bars */
  .tier-row { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 6px; }
  .tier-label { width: 90px; font-weight: 500; }
  .tier-track { flex: 1; height: 24px; background: var(--bg3); border-radius: 4px; overflow: hidden; }
  .tier-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding: 0 8px; font-size: 11px; font-weight: 600; color: #fff; min-width: fit-content; transition: width 0.5s; }
  .tier-pct { width: 50px; text-align: right; font-size: 12px; color: var(--fg2); }

  /* Mini bars */
  .mini-bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 6px; }
  .mini-bar-label { width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg2); }
  .mini-bar-track { flex: 1; height: 14px; background: var(--bg3); border-radius: 3px; overflow: hidden; }
  .mini-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
  .mini-bar-val { width: 50px; text-align: right; color: var(--fg2); }

  /* Savings */
  .savings-pct { font-size: 28px; font-weight: 700; color: var(--accent); }
  .cost-bar-track { height: 8px; background: var(--bg3); border-radius: 4px; overflow: hidden; margin: 8px 0; }
  .cost-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.5s; }

  /* Quality tab */
  .preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .preset-card { background: var(--bg2); border: 2px solid var(--border); border-radius: var(--radius); padding: 16px; cursor: pointer; transition: border-color 0.2s; text-align: center; }
  .preset-card:hover { border-color: var(--fg3); }
  .preset-card.active { border-color: var(--accent); }
  .preset-icon { font-size: 28px; margin-bottom: 8px; }
  .preset-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
  .preset-desc { font-size: 12px; color: var(--fg2); margin-bottom: 8px; }
  .preset-cost { font-size: 13px; color: var(--accent); font-weight: 600; }
  .global-slider-section { margin-bottom: 20px; }
  .global-slider { width: 100%; accent-color: var(--accent); }
  .slider-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--fg3); margin-top: 4px; }
  .cat-overrides { margin-top: 16px; }
  .cat-override-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .cat-override-row:last-child { border-bottom: none; }
  .cat-icon { font-size: 16px; width: 24px; }
  .cat-name { width: 100px; font-weight: 500; }
  .cat-slider { flex: 1; accent-color: var(--accent); }
  .cat-model { font-size: 11px; color: var(--fg2); width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat-price { font-size: 11px; color: var(--fg3); width: 100px; text-align: right; }
  .apply-bar { display: flex; align-items: center; gap: 16px; padding: 12px 0; }
  .apply-btn { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .apply-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Integrations tab */
  .provider-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 12px; }
  .provider-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .status-dot.ok { background: var(--accent); }
  .status-dot.off { background: var(--fg3); }
  .chip { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; display: inline-block; margin: 2px; }
  .chip.on { background: #16a34a22; color: var(--accent); }
  .chip.off { background: var(--bg3); color: var(--fg3); }
  .test-btn { padding: 4px 12px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--fg2); font-size: 12px; cursor: pointer; }
  .test-btn:hover { border-color: var(--accent); color: var(--accent); }

  footer { text-align: center; color: var(--fg3); font-size: 12px; padding: 20px 0; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span>Tier</span>Flow</h1>
    <div class="header-right">
      <span id="uptime">--</span>
      <label>Refresh: <select id="refresh-rate">
        <option value="5000">5s</option><option value="10000">10s</option>
        <option value="30000">30s</option><option value="0">Off</option>
      </select></label>
    </div>
  </header>

  <div class="tab-bar">
    <button class="tab active" data-tab="stats">Stats</button>
    <button class="tab" data-tab="quality">Quality</button>
    <button class="tab" data-tab="integrations">Integrations</button>
  </div>

  <!-- ═══ STATS TAB ═══ -->
  <div id="tab-stats" class="tab-panel active">
    <div class="cards">
      <div class="card"><div class="card-label">Total Requests</div><div class="card-value" id="total-requests">--</div><div class="card-sub" id="errors-sub">0 errors</div></div>
      <div class="card"><div class="card-label">Cache Hit Rate</div><div class="card-value" id="cache-rate">--</div><div class="card-sub" id="cache-sub">0 hits / 0 misses</div></div>
      <div class="card"><div class="card-label">Actual Cost</div><div class="card-value" id="total-cost">--</div><div class="card-sub" id="tokens-sub">0 tokens</div></div>
      <div class="card"><div class="card-label">Savings</div><div class="savings-pct" id="savings-pct">--%</div><div class="card-sub" id="savings-sub">$0 saved vs Opus baseline</div></div>
    </div>

    <div class="section">
      <h2>Cost Efficiency</h2>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Your cost: <strong id="eff-actual">$0</strong></span><span>Opus baseline: <strong id="eff-baseline">$0</strong></span></div>
      <div class="cost-bar-track"><div class="cost-bar-fill" id="eff-bar" style="width:100%"></div></div>
    </div>

    <div class="section">
      <h2>Tier Distribution</h2>
      <div id="tier-bars"><div class="no-data">No requests yet</div></div>
    </div>

    <div class="stats-row">
      <div class="section">
        <h2>By Category</h2>
        <table id="cat-table"><thead><tr><th>Category</th><th class="num">Reqs</th><th class="num">Cost</th><th class="num">Saved</th></tr></thead>
        <tbody><tr><td colspan="4" class="no-data">No data</td></tr></tbody></table>
      </div>
      <div class="section">
        <h2>By Model</h2>
        <table id="mod-table"><thead><tr><th>Model</th><th class="num">Reqs</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody><tr><td colspan="4" class="no-data">No data</td></tr></tbody></table>
      </div>
    </div>

    <div class="section">
      <h2>PII &amp; Compression</h2>
      <div id="pii-compress" class="no-data">No activity</div>
    </div>
  </div>

  <!-- ═══ QUALITY TAB ═══ -->
  <div id="tab-quality" class="tab-panel">
    <div class="section">
      <h2>Choose a Profile</h2>
      <div class="preset-grid" id="preset-grid"><div class="no-data">Loading...</div></div>
    </div>
    <div class="section global-slider-section">
      <h2>Fine-Tune</h2>
      <input type="range" min="1" max="5" value="2" class="global-slider" id="global-slider">
      <div class="slider-labels"><span>Budget</span><span>Value</span><span>Balanced</span><span>Premium</span><span>Best</span></div>
    </div>
    <div class="section">
      <h2>Per-Category Overrides</h2>
      <div id="cat-overrides"><div class="no-data">Loading...</div></div>
    </div>
    <div class="apply-bar">
      <button class="apply-btn" id="apply-btn" disabled>Apply Changes</button>
      <span id="apply-status" style="font-size:13px;color:var(--fg2)"></span>
    </div>
  </div>

  <!-- ═══ INTEGRATIONS TAB ═══ -->
  <div id="tab-integrations" class="tab-panel">
    <div class="section">
      <h2>API Providers</h2>
      <div id="providers-list"><div class="no-data">Loading...</div></div>
    </div>
    <div class="section">
      <h2>ML Classifier</h2>
      <div id="ml-status-detail"><div class="no-data">Loading...</div></div>
    </div>
    <div class="section">
      <h2>System</h2>
      <div id="system-info"><div class="no-data">Loading...</div></div>
    </div>
  </div>

  <footer>TierFlow v2.0 &mdash; Stats since <span id="started">--</span></footer>
</div>

<script>
const $ = id => document.getElementById(id);
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtCost = n => n === 0 ? 'Free' : n < 0.001 ? '$'+n.toFixed(6) : n < 1 ? '$'+n.toFixed(4) : '$'+n.toFixed(2);
const tierColors = { SIMPLE:'#22c55e', MEDIUM:'#3b82f6', COMPLEX:'#eab308', REASONING:'#a855f7' };
const catIcons = { simple_chat:'\\uD83D\\uDCAC', general:'\\uD83C\\uDF10', coding:'\\u2699', reasoning:'\\uD83E\\uDDEE', creative:'\\u270D', data:'\\uD83D\\uDCCA', agentic:'\\uD83E\\uDD16', transcription:'\\uD83C\\uDFA4' };

let refreshTimer = null, qualityData = null, pendingPreset = null, pendingOverrides = {};

// ─── Tab switching ───
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('tab-' + t.dataset.tab).classList.add('active');
    localStorage.setItem('tf-tab', t.dataset.tab);
    if (t.dataset.tab === 'quality' && !qualityData) loadQuality();
    if (t.dataset.tab === 'integrations') loadIntegrations();
  });
});

// ─── Stats refresh ───
function formatUptime(s) { const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); return d>0?d+'d '+h+'h':h>0?h+'h '+m+'m':m+'m'; }

async function refresh() {
  try {
    const [sr, hr] = await Promise.all([fetch('/stats'), fetch('/health')]);
    const stats = await sr.json(), health = await hr.json();
    window._lastStats = stats;

    $('uptime').textContent = formatUptime(health.uptime);
    $('started').textContent = new Date(stats.started).toLocaleString();
    $('total-requests').textContent = fmt(stats.requests);
    $('errors-sub').textContent = stats.errors + ' errors, ' + stats.timeouts + ' timeouts';

    const cache = stats.cache || {};
    $('cache-rate').textContent = cache.hitRate || '0%';
    $('cache-sub').textContent = (cache.hits||0) + ' hits / ' + (cache.misses||0) + ' misses';

    const tu = stats.tokenUsage?.allTime || {};
    $('total-cost').textContent = fmtCost(tu.cost || 0);
    $('tokens-sub').textContent = fmt(tu.totalTokens || 0) + ' tokens';

    const baseline = tu.baselineCost || 0, actual = tu.cost || 0;
    const saved = Math.max(0, baseline - actual);
    const savPct = baseline > 0 ? (saved/baseline*100) : 0;
    $('savings-pct').textContent = savPct.toFixed(1) + '%';
    $('savings-sub').textContent = fmtCost(saved) + ' saved vs Opus';

    $('eff-actual').textContent = fmtCost(actual);
    $('eff-baseline').textContent = fmtCost(baseline);
    const barPct = baseline > 0 ? Math.min(100, actual/baseline*100) : 100;
    $('eff-bar').style.width = barPct.toFixed(1) + '%';

    // Tier bars
    const bt = stats.byTier || {};
    const tierTotal = Object.values(bt).reduce((a,b) => a + Number(b), 0) || 1;
    if (tierTotal > 1) {
      $('tier-bars').innerHTML = ['SIMPLE','MEDIUM','COMPLEX','REASONING'].map(t => {
        const c = bt[t]||0, pct = (c/tierTotal*100).toFixed(1);
        return '<div class="tier-row"><span class="tier-label">'+t+'</span><div class="tier-track"><div class="tier-fill" style="width:'+Math.max(Number(pct),2)+'%;background:'+(tierColors[t]||'#666')+'">'+c+'</div></div><span class="tier-pct">'+pct+'%</span></div>';
      }).join('');
    }

    // Category table
    const bc = stats.tokenUsage?.byCategory || {};
    const ck = Object.keys(bc).sort((a,b) => bc[b].requests - bc[a].requests);
    if (ck.length) {
      $('cat-table').querySelector('tbody').innerHTML = ck.map(k => {
        const sv = Math.max(0, (bc[k].baselineCost||0) - bc[k].cost);
        return '<tr><td>'+k+'</td><td class="num">'+bc[k].requests+'</td><td class="num">'+fmtCost(bc[k].cost)+'</td><td class="num" style="color:var(--accent)">'+fmtCost(sv)+'</td></tr>';
      }).join('');
    }

    // Model table
    const bm = stats.tokenUsage?.byModel || {};
    const mk = Object.keys(bm).sort((a,b) => bm[b].requests - bm[a].requests);
    if (mk.length) {
      $('mod-table').querySelector('tbody').innerHTML = mk.map(k =>
        '<tr><td title="'+k+'">'+k.split('/').pop()+'</td><td class="num">'+bm[k].requests+'</td><td class="num">'+fmt(bm[k].tokens)+'</td><td class="num">'+fmtCost(bm[k].cost)+'</td></tr>'
      ).join('');
    }

    // PII & Compression
    const pii = stats.pii||{}, comp = stats.compress||{};
    if (pii.scrubbed > 0 || comp.compressed > 0) {
      $('pii-compress').innerHTML = '<span>PII: '+pii.scrubbed+' scrubbed, '+pii.rehydrated+' rehydrated'+(pii.errors?' <span style="color:var(--red)">'+pii.errors+' errors</span>':'')+'</span>' +
        (comp.compressed > 0 ? ' &middot; <span>CtxPack: '+comp.compressed+' compressed, '+fmt(comp.tokensSaved)+' tokens saved</span>' : '');
      $('pii-compress').classList.remove('no-data');
    }
  } catch(e) { console.error('Refresh failed:', e); }
}

// ─── Quality tab ───
async function loadQuality() {
  try {
    const r = await fetch('/quality-tiers');
    qualityData = await r.json();
    renderPresets();
    renderOverrides();
    $('global-slider').value = String(qualityData.globalLevel);
  } catch(e) { console.error('Quality load failed:', e); }
}

function renderPresets() {
  if (!qualityData) return;
  $('preset-grid').innerHTML = qualityData.presets.map(p => {
    const isActive = qualityData.activePreset === p.name;
    return '<div class="preset-card'+(isActive?' active':'')+'" data-preset="'+p.name+'">' +
      '<div class="preset-icon">'+p.icon+'</div>' +
      '<div class="preset-name">'+p.label+'</div>' +
      '<div class="preset-desc">'+p.description+'</div>' +
      '<div class="preset-cost">'+p.estimatedDailyCost+'</div></div>';
  }).join('');
  document.querySelectorAll('.preset-card').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.preset-card').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      pendingPreset = c.dataset.preset;
      updateApply();
    });
  });
}

function renderOverrides() {
  if (!qualityData) return;
  const cats = Object.entries(qualityData.categories);
  $('cat-overrides').innerHTML = cats.map(([cat, info]) => {
    const lv = info.overrideLevel || 2;
    const level = info.levels[lv - 1] || info.levels[0];
    const price = level.inputPrice === 0 && level.outputPrice === 0 ? 'Free' : '$'+level.outputPrice+'/M';
    return '<div class="cat-override-row">' +
      '<span class="cat-icon">'+(catIcons[cat]||'\\u25C6')+'</span>' +
      '<span class="cat-name">'+cat+'</span>' +
      '<input type="range" min="1" max="5" value="'+lv+'" class="cat-slider" data-cat="'+cat+'">' +
      '<span class="cat-model" id="cm-'+cat+'">'+level.model.replace('openrouter/','')+'</span>' +
      '<span class="cat-price" id="cp-'+cat+'">'+price+'</span></div>';
  }).join('');
  document.querySelectorAll('.cat-slider').forEach(s => {
    s.addEventListener('input', (e) => {
      const cat = e.target.dataset.cat, lv = parseInt(e.target.value);
      const level = qualityData.categories[cat].levels[lv-1];
      $('cm-'+cat).textContent = level.model.replace('openrouter/','');
      const price = level.inputPrice===0&&level.outputPrice===0?'Free':'$'+level.outputPrice+'/M';
      $('cp-'+cat).textContent = price;
      pendingOverrides[cat] = lv;
      updateApply();
    });
  });
}

function updateApply() {
  const hasChanges = pendingPreset || Object.keys(pendingOverrides).length > 0;
  $('apply-btn').disabled = !hasChanges;
}

$('apply-btn').addEventListener('click', async () => {
  $('apply-btn').disabled = true;
  $('apply-status').textContent = 'Applying...';
  try {
    if (pendingPreset) {
      await fetch('/quality-preset', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({preset: pendingPreset}) });
    }
    for (const [cat, lv] of Object.entries(pendingOverrides)) {
      await fetch('/quality-level', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({category: cat, level: lv}) });
    }
    pendingPreset = null; pendingOverrides = {};
    $('apply-status').textContent = 'Applied!';
    await loadQuality();
    setTimeout(() => { $('apply-status').textContent = ''; }, 3000);
  } catch(e) {
    $('apply-status').textContent = 'Error: ' + e.message;
    $('apply-btn').disabled = false;
  }
});

$('global-slider').addEventListener('input', (e) => {
  pendingPreset = null; pendingOverrides = {};
  const lv = parseInt(e.target.value);
  // Map global slider to preset
  const map = {1:'free',2:'smart_saver',3:null,4:'quality_first',5:'maximum'};
  if (map[lv]) { pendingPreset = map[lv]; }
  else { pendingPreset = '__global_' + lv; }
  document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
  if (map[lv]) { const card = document.querySelector('[data-preset="'+map[lv]+'"]'); if(card) card.classList.add('active'); }
  updateApply();
});

// ─── Integrations tab ───
async function loadIntegrations() {
  try {
    const [cr, hr] = await Promise.all([fetch('/config'), fetch('/health')]);
    const cfgData = await cr.json(), health = await hr.json();
    const cfg = cfgData.config || {};

    // Providers
    const provs = Object.entries(cfg.providers || {});
    $('providers-list').innerHTML = provs.map(([name, p]) => {
      const hasPii = p.pii === true || (p.pii && p.pii.enabled);
      const hasComp = p.compress === true || (p.compress && p.compress.enabled);
      const isDisabled = p.disabled === true;
      return '<div class="provider-card"><div class="provider-header">' +
        '<span class="status-dot '+(isDisabled?'off':'ok')+'"></span>' +
        '<strong>'+name+'</strong> <span style="color:var(--fg3);font-size:12px">'+((p.api)||'')+'</span>' +
        '<span style="flex:1"></span>' +
        '<button class="test-btn" onclick="testProv(\\''+name+'\\')">Test</button></div>' +
        '<div style="font-size:12px;color:var(--fg2);margin-bottom:6px">'+((p.baseUrl)||'')+'</div>' +
        '<div><span class="chip '+(hasPii?'on':'off')+'">PII '+(hasPii?'on':'off')+'</span>' +
        '<span class="chip '+(hasComp?'on':'off')+'">Compress '+(hasComp?'on':'off')+'</span></div>' +
        '<div id="test-result-'+name+'" style="font-size:12px;margin-top:6px"></div></div>';
    }).join('') || '<div class="no-data">No providers configured</div>';

    // ML classifier
    const ml = cfg.mlClassifier;
    if (ml) {
      $('ml-status-detail').innerHTML = '<div style="font-size:13px"><strong>LLMRouter Service</strong>' +
        '<div style="color:var(--fg2);margin-top:4px">URL: <code>'+ml.url+'</code></div>' +
        '<div style="color:var(--fg2)">Timeout: '+ml.timeout_ms+'ms &middot; Fallback: '+ml.fallback_category+'</div></div>';
    } else {
      $('ml-status-detail').innerHTML = '<div class="no-data">Not configured (using rule-based routing)</div>';
    }

    // System
    const cache = cfg.cache || {};
    $('system-info').innerHTML =
      '<div style="font-size:13px">' +
      '<div>Cache: <span class="chip '+(cache.enabled?'on':'off')+'">'+(cache.enabled?'enabled':'disabled')+'</span>' +
      (cache.enabled ? ' TTL: '+(cache.ttl_seconds||300)+'s, max: '+(cache.max_entries||5000) : '') + '</div>' +
      '<div style="margin-top:8px">Config: <code>'+(cfgData.configPath||'built-in defaults')+'</code> ' +
      '<button class="test-btn" onclick="reloadCfg()">Reload</button></div>' +
      '<div style="margin-top:8px">Version: '+health.version+' &middot; Uptime: '+formatUptime(health.uptime)+'</div></div>';
  } catch(e) { console.error('Integrations load failed:', e); }
}

window.testProv = async function(name) {
  const el = document.getElementById('test-result-' + name);
  if (el) el.innerHTML = '<span style="color:var(--fg3)">Testing...</span>';
  try {
    const r = await fetch('/test-provider', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider:name}) });
    const data = await r.json();
    if (el) el.innerHTML = data.ok
      ? '<span style="color:var(--accent)">Connected ('+data.latency_ms+'ms'+(data.models?', '+data.models+' models':'')+') </span>'
      : '<span style="color:var(--red)">Failed: '+data.error+'</span>';
  } catch(e) { if(el) el.innerHTML = '<span style="color:var(--red)">Error: '+e.message+'</span>'; }
};

window.reloadCfg = async function() {
  await fetch('/reload-config', { method:'POST' });
  loadIntegrations();
};

// ─── Init ───
const rateSelect = $('refresh-rate');
const savedRate = localStorage.getItem('tf-refresh') || '5000';
rateSelect.value = savedRate;
function setRefreshRate(ms) { if(refreshTimer) clearInterval(refreshTimer); if(ms>0) refreshTimer=setInterval(refresh,ms); localStorage.setItem('tf-refresh',String(ms)); }
rateSelect.addEventListener('change', () => setRefreshRate(Number(rateSelect.value)));
setRefreshRate(Number(savedRate));
refresh();

const savedTab = localStorage.getItem('tf-tab') || 'stats';
const tabBtn = document.querySelector('[data-tab="'+savedTab+'"]');
if (tabBtn) tabBtn.click();
</script>
</body>
</html>`;
}

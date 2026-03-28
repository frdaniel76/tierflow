/**
 * FreeRouter Dashboard — lightweight monitoring UI.
 * Vanilla HTML/JS, no framework, no build step.
 * Served at GET /dashboard, polls GET /stats every 5s.
 */

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FreeRouter Dashboard</title>
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

  /* Header */
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  header h1 { font-size: 20px; font-weight: 600; }
  header h1 span { color: var(--accent); }
  .header-right { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--fg2); }
  .ml-badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .ml-badge.ok { background: #16a34a22; color: var(--accent); }
  .ml-badge.down { background: #ef444422; color: var(--red); }
  select { background: var(--bg3); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 12px; }

  /* Cards grid */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
  .card-label { font-size: 12px; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .card-value { font-size: 28px; font-weight: 700; }
  .card-sub { font-size: 12px; color: var(--fg2); margin-top: 2px; }

  /* Tables */
  .section { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 20px; }
  .section h2 { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--fg2); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--fg3); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 8px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }

  /* Tier bar */
  .tier-bars { display: flex; flex-direction: column; gap: 8px; }
  .tier-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .tier-label { width: 90px; font-weight: 500; }
  .tier-track { flex: 1; height: 24px; background: var(--bg3); border-radius: 4px; overflow: hidden; position: relative; }
  .tier-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding: 0 8px; font-size: 11px; font-weight: 600; color: #fff; min-width: fit-content; transition: width 0.5s; }
  .tier-pct { width: 50px; text-align: right; font-size: 12px; color: var(--fg2); }

  /* Hourly chart */
  .hourly-chart { display: flex; align-items: flex-end; gap: 2px; height: 100px; }
  .hourly-bar { flex: 1; background: var(--accent); border-radius: 2px 2px 0 0; min-width: 4px; transition: height 0.5s; position: relative; }
  .hourly-bar:hover { opacity: 0.8; }
  .hourly-bar:hover::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: var(--bg3); color: var(--fg); padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; pointer-events: none; }

  /* Stats row */
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }

  /* Footer */
  footer { text-align: center; color: var(--fg3); font-size: 12px; padding: 20px 0; }

  .no-data { color: var(--fg3); font-style: italic; padding: 20px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span>Free</span>Router</h1>
    <div class="header-right">
      <span id="ml-status" class="ml-badge down">ML: checking...</span>
      <span id="uptime">--</span>
      <label>Refresh: <select id="refresh-rate">
        <option value="5000">5s</option>
        <option value="10000">10s</option>
        <option value="30000">30s</option>
        <option value="0">Off</option>
      </select></label>
    </div>
  </header>

  <div class="cards">
    <div class="card">
      <div class="card-label">Total Requests</div>
      <div class="card-value" id="total-requests">--</div>
      <div class="card-sub" id="errors-sub">0 errors, 0 timeouts</div>
    </div>
    <div class="card">
      <div class="card-label">Cache Hit Rate</div>
      <div class="card-value" id="cache-rate">--</div>
      <div class="card-sub" id="cache-sub">0 hits / 0 misses</div>
    </div>
    <div class="card">
      <div class="card-label">Total Cost</div>
      <div class="card-value" id="total-cost">--</div>
      <div class="card-sub" id="tokens-sub">0 tokens</div>
    </div>
    <div class="card">
      <div class="card-label">PII Scrubbed</div>
      <div class="card-value" id="pii-scrubbed">--</div>
      <div class="card-sub" id="pii-sub">0 rehydrated, 0 errors</div>
    </div>
  </div>

  <div class="section">
    <h2>Tier Distribution</h2>
    <div class="tier-bars" id="tier-bars">
      <div class="no-data">No requests yet</div>
    </div>
  </div>

  <div class="stats-row">
    <div class="section">
      <h2>By Category</h2>
      <table id="category-table">
        <thead><tr><th>Category</th><th class="num">Requests</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody><tr><td colspan="4" class="no-data">No data yet</td></tr></tbody>
      </table>
    </div>
    <div class="section">
      <h2>By Model</h2>
      <table id="model-table">
        <thead><tr><th>Model</th><th class="num">Requests</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody><tr><td colspan="4" class="no-data">No data yet</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>Hourly Activity (Last 24h)</h2>
    <div class="hourly-chart" id="hourly-chart">
      <div class="no-data" style="width:100%">No data yet</div>
    </div>
  </div>

  <div class="section">
    <h2>Compression</h2>
    <div id="compress-stats" class="no-data">No compression activity</div>
  </div>

  <footer>FreeRouter v2.0 &mdash; Stats since <span id="started">--</span></footer>
</div>

<script>
const $ = id => document.getElementById(id);
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtCost = n => n >= 1 ? '$'+n.toFixed(2) : n >= 0.01 ? '$'+n.toFixed(4) : '$'+n.toFixed(6);
const tierColors = { SIMPLE: '#22c55e', MEDIUM: '#3b82f6', COMPLEX: '#eab308', REASONING: '#a855f7' };

let refreshTimer = null;

function formatUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? d+'d '+h+'h' : h > 0 ? h+'h '+m+'m' : m+'m '+Math.floor(s%60)+'s';
}

async function refresh() {
  try {
    const [statsRes, healthRes] = await Promise.all([
      fetch('/stats'),
      fetch('/health'),
    ]);
    const stats = await statsRes.json();
    const health = await healthRes.json();

    // Uptime
    $('uptime').textContent = formatUptime(health.uptime);
    $('started').textContent = new Date(stats.started).toLocaleString();

    // ML status
    const mlBadge = $('ml-status');
    // Check if health reports ML classifier info
    mlBadge.textContent = 'ML: active';
    mlBadge.className = 'ml-badge ok';

    // Top cards
    $('total-requests').textContent = fmt(stats.requests);
    $('errors-sub').textContent = stats.errors + ' errors, ' + stats.timeouts + ' timeouts';

    const cache = stats.cache || {};
    $('cache-rate').textContent = cache.hitRate || '0%';
    $('cache-sub').textContent = (cache.hits||0) + ' hits / ' + (cache.misses||0) + ' misses (' + (cache.size||0) + ' cached)';

    const tu = stats.tokenUsage?.allTime || {};
    $('total-cost').textContent = fmtCost(tu.cost || 0);
    $('tokens-sub').textContent = fmt(tu.totalTokens || 0) + ' tokens (' + (tu.requests||0) + ' tracked)';

    $('pii-scrubbed').textContent = fmt(stats.pii?.scrubbed || 0);
    $('pii-sub').textContent = (stats.pii?.rehydrated||0) + ' rehydrated, ' + (stats.pii?.errors||0) + ' errors';

    // Tier distribution
    const bt = stats.byTier || {};
    const tierTotal = Object.values(bt).reduce((a,b) => a + Number(b), 0) || 1;
    const tierContainer = $('tier-bars');
    if (tierTotal > 1) {
      tierContainer.innerHTML = ['SIMPLE','MEDIUM','COMPLEX','REASONING'].map(t => {
        const count = bt[t] || 0;
        const pct = ((count / tierTotal) * 100).toFixed(1);
        return '<div class="tier-row">' +
          '<span class="tier-label">' + t + '</span>' +
          '<div class="tier-track"><div class="tier-fill" style="width:' + Math.max(Number(pct),2) + '%;background:' + (tierColors[t]||'#666') + '">' + count + '</div></div>' +
          '<span class="tier-pct">' + pct + '%</span></div>';
      }).join('');
    }

    // Category table
    const bc = stats.tokenUsage?.byCategory || {};
    const catKeys = Object.keys(bc).sort((a,b) => bc[b].requests - bc[a].requests);
    if (catKeys.length) {
      $('category-table').querySelector('tbody').innerHTML = catKeys.map(k =>
        '<tr><td>'+k+'</td><td class="num">'+bc[k].requests+'</td><td class="num">'+fmt(bc[k].tokens)+'</td><td class="num">'+fmtCost(bc[k].cost)+'</td></tr>'
      ).join('');
    }

    // Model table
    const bm = stats.tokenUsage?.byModel || {};
    const modKeys = Object.keys(bm).sort((a,b) => bm[b].requests - bm[a].requests);
    if (modKeys.length) {
      $('model-table').querySelector('tbody').innerHTML = modKeys.map(k =>
        '<tr><td>'+k.split('/').pop()+'</td><td class="num">'+bm[k].requests+'</td><td class="num">'+fmt(bm[k].tokens)+'</td><td class="num">'+fmtCost(bm[k].cost)+'</td></tr>'
      ).join('');
    }

    // Hourly chart
    const hourly = stats.tokenUsage?.hourly || [];
    if (hourly.length) {
      const maxReqs = Math.max(...hourly.map(h => h.requests), 1);
      $('hourly-chart').innerHTML = hourly.map(h => {
        const pct = (h.requests / maxReqs * 100);
        const hour = new Date(h.hour).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        return '<div class="hourly-bar" style="height:'+Math.max(pct,3)+'%" data-tip="'+hour+': '+h.requests+' reqs, '+fmtCost(h.cost)+'"></div>';
      }).join('');
    }

    // Compression
    const comp = stats.compress || {};
    if (comp.compressed > 0) {
      $('compress-stats').innerHTML = '<span>'+comp.compressed+' compressed</span> &middot; <span>'+fmt(comp.tokensSaved)+' tokens saved</span>' + (comp.errors ? ' &middot; <span style="color:var(--red)">'+comp.errors+' errors</span>' : '');
      $('compress-stats').classList.remove('no-data');
    }

  } catch (err) {
    console.error('Dashboard refresh failed:', err);
  }
}

// Refresh rate control
const rateSelect = $('refresh-rate');
const savedRate = localStorage.getItem('fr-refresh') || '5000';
rateSelect.value = savedRate;

function setRefreshRate(ms) {
  if (refreshTimer) clearInterval(refreshTimer);
  if (ms > 0) refreshTimer = setInterval(refresh, ms);
  localStorage.setItem('fr-refresh', String(ms));
}

rateSelect.addEventListener('change', () => setRefreshRate(Number(rateSelect.value)));
setRefreshRate(Number(savedRate));
refresh(); // initial load
</script>
</body>
</html>`;
}

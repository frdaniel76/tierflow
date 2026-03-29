/**
 * TierFlow Dashboard — monitoring, models, quality tiers, integrations, about.
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
    --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
    --fg: #e6edf3; --fg2: #8b949e; --fg3: #484f58;
    --accent: #3fb950; --accent2: #238636; --accent-bg: #3fb95015;
    --blue: #58a6ff; --yellow: #d29922; --red: #f85149; --purple: #bc8cff; --cyan: #39d2c0;
    --border: #30363d; --radius: 8px;
    --shadow: 0 1px 3px rgba(0,0,0,.3);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f8fa; --bg2: #ffffff; --bg3: #f0f3f6;
      --fg: #1f2328; --fg2: #656d76; --fg3: #8b949e;
      --accent: #1a7f37; --accent2: #116329; --accent-bg: #1a7f3710;
      --blue: #0969da; --yellow: #9a6700; --red: #cf222e; --purple: #8250df; --cyan: #0d9488;
      --border: #d0d7de;
      --shadow: 0 1px 3px rgba(0,0,0,.08);
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; font-size: 14px; line-height: 1.5; }

  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

  /* ─── Header ─── */
  header { display: flex; justify-content: space-between; align-items: center; padding: 0 0 20px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .logo h1 .t { color: var(--accent); }
  .logo .version { font-size: 11px; background: var(--bg3); color: var(--fg2); padding: 2px 8px; border-radius: 12px; font-weight: 500; }
  .header-right { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--fg2); }
  .header-right select { background: var(--bg3); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
  .header-right select:hover { border-color: var(--fg3); }
  .status-badge { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .status-badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

  /* ─── Tabs ─── */
  .tab-bar { display: flex; gap: 2px; background: var(--bg3); border-radius: 8px; padding: 3px; margin-bottom: 24px; width: fit-content; }
  .tab { background: none; border: none; border-radius: 6px; padding: 8px 18px; cursor: pointer; color: var(--fg2); font-size: 13px; font-weight: 500; transition: all 0.15s; }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--fg); background: var(--bg2); box-shadow: var(--shadow); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  /* ─── Cards ─── */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
  .card-label { font-size: 11px; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; margin-bottom: 8px; }
  .card-value { font-size: 32px; font-weight: 800; letter-spacing: -1px; }
  .card-sub { font-size: 12px; color: var(--fg2); margin-top: 4px; }

  /* ─── Sections ─── */
  .section { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 20px; box-shadow: var(--shadow); }
  .section h2 { font-size: 13px; font-weight: 600; margin-bottom: 16px; color: var(--fg2); text-transform: uppercase; letter-spacing: 0.5px; }

  /* ─── Tables ─── */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--fg3); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--bg3); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .no-data { color: var(--fg3); font-style: italic; padding: 24px; text-align: center; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }

  /* ─── Tier bars ─── */
  .tier-row { display: flex; align-items: center; gap: 10px; font-size: 13px; margin-bottom: 8px; }
  .tier-label { width: 90px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
  .tier-track { flex: 1; height: 28px; background: var(--bg3); border-radius: 6px; overflow: hidden; }
  .tier-fill { height: 100%; border-radius: 6px; display: flex; align-items: center; padding: 0 10px; font-size: 11px; font-weight: 700; color: #fff; min-width: fit-content; transition: width 0.5s ease; }
  .tier-pct { width: 55px; text-align: right; font-size: 12px; color: var(--fg2); font-weight: 500; }

  /* ─── Savings ─── */
  .savings-pct { font-size: 32px; font-weight: 800; color: var(--accent); letter-spacing: -1px; }
  .cost-bar-track { height: 10px; background: var(--bg3); border-radius: 6px; overflow: hidden; margin: 10px 0; }
  .cost-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 6px; transition: width 0.5s ease; }

  /* ─── Quality tab ─── */
  .preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .preset-card { background: var(--bg2); border: 2px solid var(--border); border-radius: var(--radius); padding: 20px; cursor: pointer; transition: all 0.2s; text-align: center; }
  .preset-card:hover { border-color: var(--fg3); transform: translateY(-1px); }
  .preset-card.active { border-color: var(--accent); background: var(--accent-bg); }
  .preset-icon { font-size: 32px; margin-bottom: 10px; }
  .preset-name { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .preset-desc { font-size: 12px; color: var(--fg2); margin-bottom: 10px; line-height: 1.4; }
  .preset-cost { font-size: 13px; color: var(--accent); font-weight: 700; }
  .global-slider-section { margin-bottom: 20px; }
  .global-slider { width: 100%; accent-color: var(--accent); height: 6px; }
  .slider-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--fg3); margin-top: 6px; font-weight: 500; }
  .cat-overrides { margin-top: 16px; }
  .cat-override-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .cat-override-row:last-child { border-bottom: none; }
  .cat-icon { font-size: 16px; width: 24px; text-align: center; }
  .cat-name { width: 100px; font-weight: 600; }
  .cat-slider { flex: 1; accent-color: var(--accent); }
  .cat-model { font-size: 12px; color: var(--fg2); width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat-price { font-size: 12px; color: var(--fg3); width: 100px; text-align: right; font-weight: 500; }
  .apply-bar { display: flex; align-items: center; gap: 16px; padding: 16px 0; }
  .apply-btn { background: var(--accent2); color: #fff; border: none; border-radius: 8px; padding: 10px 28px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
  .apply-btn:hover { background: var(--accent); }
  .apply-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  /* ─── Provider cards ─── */
  .provider-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 12px; box-shadow: var(--shadow); }
  .provider-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .provider-name { font-weight: 700; font-size: 15px; }
  .provider-api { color: var(--fg3); font-size: 12px; background: var(--bg3); padding: 2px 8px; border-radius: 4px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .status-dot.ok { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .status-dot.off { background: var(--fg3); }
  .chip { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; margin: 3px 2px; }
  .chip.on { background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent); }
  .chip.off { background: var(--bg3); color: var(--fg3); border: 1px solid var(--border); }
  .test-btn { padding: 6px 14px; border-radius: 6px; background: var(--bg3); border: 1px solid var(--border); color: var(--fg2); font-size: 12px; cursor: pointer; font-weight: 500; transition: all 0.15s; }
  .test-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }

  /* ─── Models tab ─── */
  .model-table th { position: sticky; top: 0; background: var(--bg2); }
  .model-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: 4px; }
  .model-badge.reasoning { background: #bc8cff20; color: var(--purple); }
  .model-badge.vision { background: #58a6ff20; color: var(--blue); }
  .model-badge.agentic { background: #39d2c020; color: var(--cyan); }
  .model-badge.free { background: var(--accent-bg); color: var(--accent); }
  .model-provider { font-size: 11px; color: var(--fg3); }

  /* ─── Info cards (ML, System) ─── */
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; }
  .info-label { color: var(--fg3); font-weight: 500; }
  .info-value { color: var(--fg); font-weight: 600; }
  .info-value code { background: var(--bg3); padding: 2px 6px; border-radius: 4px; font-size: 12px; }

  /* ─── About tab ─── */
  .about-hero { text-align: center; padding: 40px 20px; }
  .about-hero h2 { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
  .about-hero p { color: var(--fg2); max-width: 500px; margin: 0 auto; }
  .docs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .doc-link { display: block; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; text-decoration: none; color: var(--fg); transition: all 0.15s; }
  .doc-link:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow); }
  .doc-link .doc-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .doc-link .doc-desc { font-size: 12px; color: var(--fg2); }

  /* ─── Footer ─── */
  footer { text-align: center; color: var(--fg3); font-size: 12px; padding: 24px 0; border-top: 1px solid var(--border); margin-top: 24px; }
  footer a { color: var(--blue); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">
      <h1><span class="t">Tier</span>Flow</h1>
      <span class="version" id="version-badge">v2.0.0</span>
    </div>
    <div class="header-right">
      <div class="status-badge"><span class="dot"></span> <span id="uptime">--</span></div>
      <label>Refresh <select id="refresh-rate">
        <option value="5000">5s</option><option value="10000">10s</option>
        <option value="30000">30s</option><option value="0">Off</option>
      </select></label>
    </div>
  </header>

  <div class="tab-bar">
    <button class="tab active" data-tab="stats">Stats</button>
    <button class="tab" data-tab="models">Models</button>
    <button class="tab" data-tab="quality">Quality</button>
    <button class="tab" data-tab="integrations">Integrations</button>
    <button class="tab" data-tab="about">About</button>
  </div>

  <!-- ═══ STATS TAB ═══ -->
  <div id="tab-stats" class="tab-panel active">
    <div class="cards">
      <div class="card"><div class="card-label">Total Requests</div><div class="card-value" id="total-requests">--</div><div class="card-sub" id="errors-sub">0 errors</div></div>
      <div class="card"><div class="card-label">Cache Hit Rate</div><div class="card-value" id="cache-rate">--</div><div class="card-sub" id="cache-sub">0 hits / 0 misses</div></div>
      <div class="card"><div class="card-label">Actual Cost</div><div class="card-value" id="total-cost">--</div><div class="card-sub" id="tokens-sub">0 tokens</div></div>
      <div class="card"><div class="card-label">Cost Savings</div><div class="savings-pct" id="savings-pct">--%</div><div class="card-sub" id="savings-sub">$0 saved vs always-best</div></div>
    </div>

    <div class="section">
      <h2>Cost Efficiency</h2>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>Your cost: <strong id="eff-actual">$0</strong></span><span>Always-best baseline: <strong id="eff-baseline">$0</strong></span></div>
      <div class="cost-bar-track"><div class="cost-bar-fill" id="eff-bar" style="width:100%"></div></div>
      <div style="font-size:11px;color:var(--fg3);margin-top:4px">Green bar = your actual cost as % of what the most expensive model would cost</div>
    </div>

    <div class="section">
      <h2>Tier Distribution</h2>
      <div id="tier-bars"><div class="no-data">No requests yet</div></div>
    </div>

    <div class="stats-row">
      <div class="section">
        <h2>By Category</h2>
        <table id="cat-table"><thead><tr><th>Category</th><th class="num">Reqs</th><th class="num">Cost</th><th class="num">Saved</th></tr></thead>
        <tbody><tr><td colspan="4" class="no-data">No data yet</td></tr></tbody></table>
      </div>
      <div class="section">
        <h2>By Model</h2>
        <table id="mod-table"><thead><tr><th>Model</th><th class="num">Reqs</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody><tr><td colspan="4" class="no-data">No data yet</td></tr></tbody></table>
      </div>
    </div>

    <div class="stats-row">
      <div class="section">
        <h2>PII Scrubbing</h2>
        <div id="pii-stats" class="no-data">No PII activity yet</div>
        <div style="font-size:11px;color:var(--fg3);margin-top:8px" id="pii-help" style="display:none">PII (emails, API keys, SSNs, etc.) is auto-scrubbed before sending to external providers, then rehydrated in the response. Data never leaves your machine.</div>
      </div>
      <div class="section">
        <h2>Context Compression</h2>
        <div id="compress-stats" class="no-data">No compression activity yet</div>
        <div style="font-size:11px;color:var(--fg3);margin-top:8px" id="compress-help" style="display:none">CtxPack applies 6 compression passes (ANSI, whitespace, JSON, dedup, comments, stack traces) to reduce token count before forwarding.</div>
      </div>
    </div>

    <div class="section">
      <h2>Security Scanner</h2>
      <div id="security-stats" class="no-data">No requests scanned yet</div>
      <div style="font-size:11px;color:var(--fg3);margin-top:8px">252 patterns across 8 categories and 9 languages detect prompt injection, data exfiltration, command injection, and secret leakage.</div>
    </div>
  </div>

  <!-- ═══ MODELS TAB ═══ -->
  <div id="tab-models" class="tab-panel">
    <div class="section">
      <h2>Model Catalog</h2>
      <p style="font-size:13px;color:var(--fg2);margin-bottom:16px">Models available for routing. Pricing is per 1M tokens. TierFlow routes each request to the cheapest model that can handle it.</p>
      <table class="model-table" id="models-table">
        <thead><tr><th>Model</th><th>Provider</th><th class="num">Input $/1M</th><th class="num">Output $/1M</th><th class="num">Context</th><th>Capabilities</th></tr></thead>
        <tbody><tr><td colspan="6" class="no-data">Loading...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ QUALITY TAB ═══ -->
  <div id="tab-quality" class="tab-panel">
    <div class="section">
      <h2>Choose a Profile</h2>
      <p style="font-size:13px;color:var(--fg2);margin-bottom:16px">Profiles change which models are used for each category. Select a profile, then click Apply to update your running config.</p>
      <div class="preset-grid" id="preset-grid"><div class="no-data">Loading...</div></div>
    </div>
    <div class="section global-slider-section">
      <h2>Fine-Tune</h2>
      <p style="font-size:13px;color:var(--fg2);margin-bottom:12px">Slide to adjust the cost/quality balance globally across all categories.</p>
      <input type="range" min="1" max="5" value="2" class="global-slider" id="global-slider">
      <div class="slider-labels"><span>Budget</span><span>Value</span><span>Balanced</span><span>Premium</span><span>Best</span></div>
    </div>
    <div class="section">
      <h2>Per-Category Overrides</h2>
      <p style="font-size:13px;color:var(--fg2);margin-bottom:12px">Override the quality level for individual categories. Drag to select which model tier handles each type of request.</p>
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
      <p style="font-size:13px;color:var(--fg2);margin-bottom:16px">Configured LLM providers. Click Test to verify connectivity. PII scrubbing and compression are per-provider settings.</p>
      <div id="providers-list"><div class="no-data">Loading...</div></div>
    </div>
    <div class="stats-row">
      <div class="section">
        <h2>ML Classifier</h2>
        <div id="ml-status-detail"><div class="no-data">Loading...</div></div>
      </div>
      <div class="section">
        <h2>Security Scanner</h2>
        <div id="security-status-detail"><div class="no-data">Loading...</div></div>
      </div>
    </div>
    <div class="section">
      <h2>System</h2>
      <div id="system-info"><div class="no-data">Loading...</div></div>
    </div>
  </div>

  <!-- ═══ ABOUT TAB ═══ -->
  <div id="tab-about" class="tab-panel">
    <div class="section about-hero">
      <h2><span style="color:var(--accent)">Tier</span>Flow</h2>
      <p>Self-hosted AI model router with ML-powered classification, PII scrubbing, and automatic fallback.</p>
      <div style="margin-top:16px;font-size:13px;color:var(--fg2)">
        <span id="about-version">v2.0.0</span> &middot; MIT License &middot; Zero Dependencies
      </div>
    </div>
    <div class="section">
      <h2>Documentation</h2>
      <div class="docs-grid">
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow" target="_blank"><div class="doc-title">GitHub Repository</div><div class="doc-desc">Source code, issues, and releases</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/README.md" target="_blank"><div class="doc-title">Getting Started</div><div class="doc-desc">Quick start, install options, configuration</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/docs/architecture.md" target="_blank"><div class="doc-title">Architecture</div><div class="doc-desc">System design and component overview</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/docs/configuration.md" target="_blank"><div class="doc-title">Configuration</div><div class="doc-desc">Full config reference and examples</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/docs/providers.md" target="_blank"><div class="doc-title">Provider Cookbook</div><div class="doc-desc">Setup guides for each LLM provider</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/docs/live-benchmarks.md" target="_blank"><div class="doc-title">Live Benchmarks</div><div class="doc-desc">Real cost-savings data from actual API calls</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/docs/docker.md" target="_blank"><div class="doc-title">Docker Setup</div><div class="doc-desc">Docker Compose deployment guide</div></a>
        <a class="doc-link" href="https://github.com/frdaniel76/tierflow/blob/main/docs/troubleshooting.md" target="_blank"><div class="doc-title">Troubleshooting</div><div class="doc-desc">Common issues and solutions</div></a>
      </div>
    </div>
    <div class="section">
      <h2>API Endpoints</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Method</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>/v1/chat/completions</code></td><td>POST</td><td>OpenAI-compatible chat — set model to "auto" for smart routing</td></tr>
          <tr><td><code>/v1/models</code></td><td>GET</td><td>List configured models</td></tr>
          <tr><td><code>/health</code></td><td>GET</td><td>Health check, uptime, classifier status</td></tr>
          <tr><td><code>/stats</code></td><td>GET</td><td>Request statistics, costs, token usage</td></tr>
          <tr><td><code>/config</code></td><td>GET</td><td>Current config (secrets redacted)</td></tr>
          <tr><td><code>/reload-config</code></td><td>POST</td><td>Hot-reload config without restart</td></tr>
          <tr><td><code>/dashboard</code></td><td>GET</td><td>This dashboard</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <footer>
    <a href="https://github.com/frdaniel76/tierflow" target="_blank">TierFlow</a> &middot;
    <span id="footer-version">v2.0.0</span> &middot;
    Stats since <span id="started">--</span> &middot;
    <a href="https://github.com/frdaniel76/tierflow/issues" target="_blank">Report Issue</a> &middot;
    <a href="https://github.com/frdaniel76/tierflow/releases" target="_blank">Check for Updates</a>
  </footer>
</div>

<script>
const $ = id => document.getElementById(id);
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtCost = n => n === 0 ? 'Free' : n < 0.001 ? '$'+n.toFixed(6) : n < 1 ? '$'+n.toFixed(4) : '$'+n.toFixed(2);
const fmtCtx = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? Math.round(n/1e3)+'K' : String(n);
const tierColors = { SIMPLE:'#3fb950', MEDIUM:'#58a6ff', COMPLEX:'#d29922', REASONING:'#bc8cff' };
const catIcons = { simple_chat:'\\uD83D\\uDCAC', general:'\\uD83C\\uDF10', coding:'\\u2699\\uFE0F', reasoning:'\\uD83E\\uDDEE', creative:'\\u270D\\uFE0F', data:'\\uD83D\\uDCCA', agentic:'\\uD83E\\uDD16', transcription:'\\uD83C\\uDFA4' };

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
    if (t.dataset.tab === 'models') loadModels();
  });
});

// ─── Stats refresh ───
function formatUptime(s) { const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); return d>0?d+'d '+h+'h':h>0?h+'h '+m+'m':m+'m'; }

async function refresh() {
  try {
    const [sr, hr] = await Promise.all([fetch('/stats'), fetch('/health')]);
    const stats = await sr.json(), health = await hr.json();
    window._lastStats = stats;
    window._lastHealth = health;

    // Version
    const ver = 'v' + (health.version || '2.0.0');
    $('version-badge').textContent = ver;
    $('about-version').textContent = ver;
    $('footer-version').textContent = ver;

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
    $('savings-sub').textContent = fmtCost(saved) + ' saved vs always-best';

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
        return '<tr><td>'+(catIcons[k]||'')+' '+k+'</td><td class="num">'+bc[k].requests+'</td><td class="num">'+fmtCost(bc[k].cost)+'</td><td class="num" style="color:var(--accent)">'+fmtCost(sv)+'</td></tr>';
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

    // PII stats (separate section)
    const pii = stats.pii||{};
    if (pii.scrubbed > 0 || pii.rehydrated > 0) {
      $('pii-stats').innerHTML =
        '<div class="info-grid">' +
        '<span class="info-label">Scrubbed</span><span class="info-value">'+pii.scrubbed+' items</span>' +
        '<span class="info-label">Rehydrated</span><span class="info-value">'+pii.rehydrated+' items</span>' +
        (pii.errors ? '<span class="info-label">Errors</span><span class="info-value" style="color:var(--red)">'+pii.errors+'</span>' : '') +
        '</div>';
      $('pii-stats').classList.remove('no-data');
    }

    // Security stats
    const sec = stats.security||{};
    if (sec.scanned > 0) {
      const catEntries = Object.entries(sec.byCategory||{}).sort((a,b) => (b[1] as number) - (a[1] as number));
      $('security-stats').innerHTML =
        '<div class="info-grid">' +
        '<span class="info-label">Scanned</span><span class="info-value">'+sec.scanned+'</span>' +
        '<span class="info-label">Clean</span><span class="info-value" style="color:var(--accent)">'+sec.clean+'</span>' +
        '<span class="info-label">Warnings</span><span class="info-value" style="color:var(--yellow)">'+(sec.warnings||0)+'</span>' +
        '<span class="info-label">Blocked</span><span class="info-value" style="color:var(--red)">'+(sec.blocked||0)+'</span>' +
        '<span class="info-label">Avg scan time</span><span class="info-value">'+(sec.avgScanTimeMs||0)+'ms</span>' +
        '</div>' +
        (catEntries.length > 0 ? '<div style="margin-top:10px;font-size:12px"><strong>By category:</strong>' +
          catEntries.map(([cat,cnt]) => '<div style="margin-top:4px;color:var(--fg2)">' + cat + ': <span style="color:var(--red)">' + cnt + '</span></div>').join('') + '</div>' : '');
      $('security-stats').classList.remove('no-data');
    }

    // Compression stats (separate section)
    const comp = stats.compress||{};
    if (comp.compressed > 0) {
      $('compress-stats').innerHTML =
        '<div class="info-grid">' +
        '<span class="info-label">Compressed</span><span class="info-value">'+comp.compressed+' requests</span>' +
        '<span class="info-label">Tokens Saved</span><span class="info-value" style="color:var(--accent)">'+fmt(comp.tokensSaved)+'</span>' +
        (comp.errors ? '<span class="info-label">Errors</span><span class="info-value" style="color:var(--red)">'+comp.errors+'</span>' : '') +
        '</div>';
      $('compress-stats').classList.remove('no-data');
    }
  } catch(e) { console.error('Refresh failed:', e); }
}

// ─── Models tab ───
async function loadModels() {
  try {
    const r = await fetch('/models-info');
    const data = await r.json();
    const models = data.models || [];

    if (!models.length) {
      $('models-table').querySelector('tbody').innerHTML = '<tr><td colspan="6" class="no-data">No models configured</td></tr>';
      return;
    }

    // Sort by provider then price
    models.sort((a,b) => {
      const pa = a.id.split('/')[0], pb = b.id.split('/')[0];
      if (pa !== pb) return pa.localeCompare(pb);
      return a.inputPrice - b.inputPrice;
    });

    $('models-table').querySelector('tbody').innerHTML = models.map(m => {
      const provider = m.id.split('/')[0];
      const badges = [];
      if (m.inputPrice === 0 && m.outputPrice === 0) badges.push('<span class="model-badge free">FREE</span>');
      if (m.reasoning) badges.push('<span class="model-badge reasoning">Reasoning</span>');
      if (m.vision) badges.push('<span class="model-badge vision">Vision</span>');
      if (m.agentic) badges.push('<span class="model-badge agentic">Agentic</span>');
      return '<tr>' +
        '<td><strong>'+m.name+'</strong> '+badges.join('')+'<br><span class="model-provider">'+m.id+'</span></td>' +
        '<td>'+provider+'</td>' +
        '<td class="num">'+(m.inputPrice === 0 ? '<span style="color:var(--accent)">Free</span>' : '$'+m.inputPrice)+'</td>' +
        '<td class="num">'+(m.outputPrice === 0 ? '<span style="color:var(--accent)">Free</span>' : '$'+m.outputPrice)+'</td>' +
        '<td class="num">'+fmtCtx(m.contextWindow)+'</td>' +
        '<td>'+(m.maxOutput ? fmtCtx(m.maxOutput)+' max out' : '-')+'</td>' +
        '</tr>';
    }).join('');
  } catch(e) { console.error('Models load failed:', e); }
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
    $('apply-status').textContent = 'Applied! Config reloaded.';
    $('apply-status').style.color = 'var(--accent)';
    await loadQuality();
    setTimeout(() => { $('apply-status').textContent = ''; $('apply-status').style.color = 'var(--fg2)'; }, 3000);
  } catch(e) {
    $('apply-status').textContent = 'Error: ' + e.message;
    $('apply-status').style.color = 'var(--red)';
    $('apply-btn').disabled = false;
  }
});

$('global-slider').addEventListener('input', (e) => {
  pendingPreset = null; pendingOverrides = {};
  const lv = parseInt(e.target.value);
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
      const piiLabel = hasPii ? 'PII scrubbing enabled \u2014 sensitive data is redacted before sending to this provider' : 'PII scrubbing disabled \u2014 data sent as-is (safe for local/trusted providers)';
      const compLabel = hasComp ? 'Compression enabled \u2014 CtxPack reduces token count before sending' : 'Compression disabled \u2014 full context sent to provider';
      return '<div class="provider-card"><div class="provider-header">' +
        '<span class="status-dot '+(isDisabled?'off':'ok')+'"></span>' +
        '<span class="provider-name">'+name+'</span>' +
        '<span class="provider-api">'+((p.api)||'openai')+'</span>' +
        '<span style="flex:1"></span>' +
        '<button class="test-btn" onclick="testProv(\\''+name+'\\')">Test Connection</button></div>' +
        '<div style="font-size:12px;color:var(--fg2);margin-bottom:10px">'+((p.baseUrl)||'')+'</div>' +
        '<div title="'+piiLabel+'"><span class="chip '+(hasPii?'on':'off')+'">'+(hasPii?'\\u2713 PII Scrubbing':'\\u2212 PII Scrubbing')+'</span>' +
        '<span title="'+compLabel+'" class="chip '+(hasComp?'on':'off')+'">'+(hasComp?'\\u2713 Compression':'\\u2212 Compression')+'</span></div>' +
        '<div id="test-result-'+name+'" style="font-size:12px;margin-top:8px"></div></div>';
    }).join('') || '<div class="no-data">No providers configured</div>';

    // ML classifier — use health endpoint data (not config)
    const ml = health.mlClassifier;
    if (ml && ml.available) {
      $('ml-status-detail').innerHTML =
        '<div class="info-grid">' +
        '<span class="info-label">Status</span><span class="info-value" style="color:var(--accent)">\\u2713 Active</span>' +
        '<span class="info-label">Model</span><span class="info-value"><code>'+ml.model+'</code></span>' +
        '<span class="info-label">Method</span><span class="info-value">'+ml.method+'</span>' +
        '<span class="info-label">Training Examples</span><span class="info-value">'+ml.training_examples+'</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--fg3);margin-top:10px">The ML classifier uses sentence-transformer embeddings + KNN to classify queries into 8 categories in ~40ms.</div>';
    } else {
      $('ml-status-detail').innerHTML =
        '<div class="info-grid">' +
        '<span class="info-label">Status</span><span class="info-value" style="color:var(--yellow)">Loading...</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--fg3);margin-top:10px">The ML classifier loads on first request. If unavailable, TierFlow falls back to a 14-dimension rule-based scorer (&lt;1ms).</div>';
    }

    // Security scanner — use health endpoint data
    const sec = health.securityScanner;
    if (sec && sec.available) {
      $('security-status-detail').innerHTML =
        '<div class="info-grid">' +
        '<span class="info-label">Status</span><span class="info-value" style="color:var(--accent)">\\u2713 Active</span>' +
        '<span class="info-label">Patterns</span><span class="info-value">'+sec.totalPatterns+'</span>' +
        '<span class="info-label">Categories</span><span class="info-value">'+sec.categories+'</span>' +
        '<span class="info-label">Languages</span><span class="info-value">'+sec.languages.join(', ')+'</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--fg3);margin-top:10px">Scans every request for prompt injection, data exfiltration, command injection, social engineering, and secret leakage. Blocks HIGH/CRITICAL threats.</div>';
    } else {
      $('security-status-detail').innerHTML = '<div class="no-data">Security scanner not available</div>';
    }

    // System
    const cache = cfg.cache || {};
    const cacheEnabled = cache.enabled !== false; // default true
    $('system-info').innerHTML =
      '<div class="info-grid">' +
      '<span class="info-label">Version</span><span class="info-value">'+health.version+'</span>' +
      '<span class="info-label">Uptime</span><span class="info-value">'+formatUptime(health.uptime)+'</span>' +
      '<span class="info-label">Cache</span><span class="info-value">'+(cacheEnabled ? '<span style="color:var(--accent)">\\u2713 Enabled</span> (TTL: '+(cache.ttl_seconds||300)+'s)' : '<span style="color:var(--fg3)">Disabled</span>')+'</span>' +
      '<span class="info-label">Config</span><span class="info-value"><code>'+(cfgData.configPath ? cfgData.configPath.split('/').pop() : 'defaults')+'</code></span>' +
      '</div>' +
      '<div style="margin-top:12px"><button class="test-btn" onclick="reloadCfg()">Reload Config</button></div>';
  } catch(e) { console.error('Integrations load failed:', e); }
}

window.testProv = async function(name) {
  const el = document.getElementById('test-result-' + name);
  if (el) el.innerHTML = '<span style="color:var(--fg3)">Testing connection...</span>';
  try {
    const r = await fetch('/test-provider', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider:name}) });
    const data = await r.json();
    if (el) el.innerHTML = data.ok
      ? '<span style="color:var(--accent)">\\u2713 Connected ('+data.latency_ms+'ms'+(data.models?', '+data.models+' models':'')+') </span>'
      : '<span style="color:var(--red)">\\u2717 Failed: '+data.error+'</span>';
  } catch(e) { if(el) el.innerHTML = '<span style="color:var(--red)">\\u2717 Error: '+e.message+'</span>'; }
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

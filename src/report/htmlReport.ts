import * as fs from 'fs';
import * as path from 'path';
import type { CoverageSummary } from './coverage.js';
import type { Anomaly } from './anomalies.js';
import type { DriftReport } from './drift.js';
import type { SchemaManifest } from './schemaManifest.js';
import type { AuthAuditResult } from './authAudit.js';
import type { HarEntry } from '../utils/harFilter.js';
import { generateWaterfall } from './waterfall.js';
import type { CausalGraph } from './causalGraph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function methodCls(m: string): string {
  return `m-${m.toLowerCase()}`;
}

function statusCls(codes: number[]): string {
  const worst = Math.max(...codes);
  if (worst >= 500) return 's-err';
  if (worst >= 400) return 's-warn';
  if (worst >= 300) return 's-redir';
  return 's-ok';
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildAnomalySection(anomalies: Anomaly[]): string {
  if (anomalies.length === 0) {
    return `<section id="anomalies" class="tab-panel">
  <h2>Anomalies</h2>
  <p class="none">✓ No anomalies detected</p>
</section>`;
  }

  const warns = anomalies.filter((a) => a.severity === 'warn');
  const infos = anomalies.filter((a) => a.severity === 'info');

  const rows = (items: Anomaly[], cls: string) =>
    items
      .map(
        (a) => `<tr class="${cls}">
      <td>${esc(a.endpoint)}</td>
      <td>${esc(a.rule)}</td>
      <td>${esc(a.message)}</td>
    </tr>`
      )
      .join('\n');

  return `<section id="anomalies" class="tab-panel">
  <h2>Anomalies</h2>
  <table>
    <thead><tr><th>Endpoint</th><th>Rule</th><th>Message</th></tr></thead>
    <tbody>
      ${rows(warns, 'a-warn')}
      ${rows(infos, 'a-info')}
    </tbody>
  </table>
</section>`;
}

function buildDriftSection(drift: DriftReport | null): string {
  if (!drift) return '';

  if (!drift.hasChanges) {
    return `<section id="drift" class="tab-panel">
  <h2>API Drift <span class="vs">vs ${esc(drift.baseSession)}</span></h2>
  <p class="none">↕ No drift detected</p>
</section>`;
  }

  const row = (sym: string, cls: string, endpoint: string, detail = '') =>
    `<tr class="${cls}"><td>${sym}</td><td>${esc(endpoint)}</td><td>${esc(detail)}</td></tr>`;

  const rows = [
    ...drift.added.map((d) => row('+', 'd-add', d.endpoint)),
    ...drift.removed.map((d) => row('-', 'd-rem', d.endpoint)),
    ...drift.changed.map((d) => row('~', 'd-chg', d.endpoint, d.detail ?? '')),
  ].join('\n');

  return `<section id="drift" class="tab-panel">
  <h2>API Drift <span class="vs">vs ${esc(drift.baseSession)}</span></h2>
  <table>
    <thead><tr><th></th><th>Endpoint</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function buildCausalSection(graph: CausalGraph): string {
  if (graph.edges.length === 0) return '';

  // Group edges by source node
  const bySource = new Map<number, typeof graph.edges>();
  for (const e of graph.edges) {
    const list = bySource.get(e.from) ?? [];
    list.push(e);
    bySource.set(e.from, list);
  }

  const rows = [...bySource.entries()]
    .map(([fromIdx, edges]) => {
      const src = graph.nodes[fromIdx];
      return edges
        .map(
          (e) =>
            `<tr>
      <td><span class="${'m-' + src.method.toLowerCase()}">${esc(src.method)}</span> ${esc(src.path)}</td>
      <td class="dim">${esc(e.sourceField)}</td>
      <td class="val">${esc(e.value)}</td>
      <td><span class="${'m-' + graph.nodes[e.to].method.toLowerCase()}">${esc(graph.nodes[e.to].method)}</span> ${esc(graph.nodes[e.to].path)}</td>
      <td class="dim">${esc(e.targetLocation)}</td>
    </tr>`
        )
        .join('\n');
    })
    .join('\n');

  return `<section id="causal" class="tab-panel">
  <h2>Causal Data Flow — ${graph.edges.length} link${graph.edges.length !== 1 ? 's' : ''}</h2>
  <table>
    <thead>
      <tr>
        <th>Source endpoint</th>
        <th>Response field</th>
        <th>Value</th>
        <th>Target endpoint</th>
        <th>Used in</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function buildWaterfallSection(entries: HarEntry[]): string {
  const svg = generateWaterfall(entries);
  if (!svg) return '';
  return `<section id="waterfall" class="tab-panel">
  <h2>Request Waterfall</h2>
  <div class="waterfall">${svg}</div>
</section>`;
}

function buildAuthSection(audit: AuthAuditResult): string {
  const total = audit.withAuth + audit.withoutAuth;
  const pct = total > 0 ? Math.round((audit.withAuth / total) * 100) : 0;

  const warnings: string[] = [];
  for (const t of audit.tokenInUrl) {
    warnings.push(`<tr class="a-warn"><td>token-in-url</td><td>${esc(t.param)}</td><td>${esc(t.url)}</td></tr>`);
  }
  if (audit.postLogoutReuse) {
    warnings.push(`<tr class="a-warn"><td>post-logout-reuse</td><td>—</td><td>Token used after ${esc(audit.logoutUrl ?? 'logout')}</td></tr>`);
  }

  const warningBlock =
    warnings.length > 0
      ? `<table style="margin-top:8px">
    <thead><tr><th>Finding</th><th>Param / Detail</th><th>URL</th></tr></thead>
    <tbody>${warnings.join('\n')}</tbody>
  </table>`
      : `<p class="none">✓ No auth findings</p>`;

  return `<section id="auth" class="tab-panel">
  <h2>Auth Token Lifecycle</h2>
  <div class="stat-row">
    <div class="stat"><span>${audit.withAuth}</span>With auth</div>
    <div class="stat"><span>${audit.withoutAuth}</span>Without auth</div>
    <div class="stat"><span>${pct}%</span>Auth coverage</div>
  </div>
  ${warningBlock}
</section>`;
}

function buildCoverageSection(summary: CoverageSummary): string {
  const rows = summary.endpoints
    .map((ep) => {
      const status = ep.statusCodes.join(', ');
      const auth = ep.hasAuth ? '<span class="auth-y">/</span>' : '<span class="auth-n">x</span>';
      const avgRaw = ep.avgResponseMs;
      const avgCls = avgRaw > 2000 ? 's-warn' : avgRaw > 800 ? 's-redir' : '';

      return `<tr>
      <td><span class="${methodCls(ep.method)}">${esc(ep.method)}</span></td>
      <td class="path">${esc(ep.path)}</td>
      <td class="${statusCls(ep.statusCodes)}">${esc(status)}</td>
      <td>${auth}</td>
      <td class="${avgCls}" data-val="${avgRaw}">${avgRaw}ms</td>
      <td data-val="${ep.callCount}">${ep.callCount}</td>
    </tr>`;
    })
    .join('\n');

  return `<section id="coverage" class="tab-panel">
  <h2>Coverage — ${summary.uniqueEndpoints} endpoint${summary.uniqueEndpoints !== 1 ? 's' : ''}, ${summary.totalRequests} request${summary.totalRequests !== 1 ? 's' : ''}</h2>
  <table id="cov">
    <thead>
      <tr>
        <th data-sort="str">Method</th>
        <th data-sort="str">Path</th>
        <th data-sort="str">Status</th>
        <th data-sort="str">Auth</th>
        <th data-sort="num">Avg</th>
        <th data-sort="num">Calls</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

// ---------------------------------------------------------------------------
// CSS + JS
// ---------------------------------------------------------------------------

const CSS = `
:root{
  --bg:#fbfbfc;--bg-sidebar:#f3f3f5;--bg-card:#ffffff;--border:#e1e2e6;
  --text:#1c1d21;--text-dim:#61646b;--text-faint:#9a9da4;
  --green:#1e7e34;--orange:#b25900;--red:#c62828;--blue:#1565c0;--purple:#7b1fa2;
  --accent:#1c1d21;
  --font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --font-mono:'SF Mono',Menlo,Consolas,'Courier New',Courier,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--font-mono);font-size:14px;line-height:1.5}
.shell{display:flex;min-height:100vh}
/* sidebar — UI font, not monospace: this is chrome/navigation, not data */
.sidebar{position:sticky;top:0;height:100vh;width:230px;flex:0 0 230px;background:var(--bg-sidebar);border-right:1px solid var(--border);padding:22px 18px;display:flex;flex-direction:column;overflow-y:auto;font-family:var(--font-ui)}
.sidebar h1{font-size:15px;font-weight:600;margin-bottom:3px;word-break:break-word}
.sidebar .subtitle{color:var(--text-dim);font-size:12px;margin-bottom:20px}
.sidebar-stats{display:flex;flex-direction:column;gap:8px;margin-bottom:22px}
.ov-stat{border:1px solid var(--border);background:var(--bg-card);border-radius:6px;padding:9px 12px}
.ov-stat .n{font-size:19px;font-weight:600;color:var(--text);display:block;line-height:1.3}
.ov-stat .l{font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px}
.ov-stat.warn .n{color:var(--orange)}
.ov-stat.err .n{color:var(--red)}
.ov-stat.ok .n{color:var(--green)}
nav.toc{display:flex;flex-direction:column;gap:2px;font-size:13px;margin-bottom:auto}
nav.toc a{color:var(--text-dim);text-decoration:none;padding:8px 10px;border-radius:6px;display:block;font-weight:500}
nav.toc a:hover{color:var(--text);background:var(--border)}
nav.toc a.active{color:#fff;background:var(--accent)}
.sidebar footer{color:var(--text-faint);font-size:11px;padding-top:14px;margin-top:14px;border-top:1px solid var(--border)}
/* main content */
.content{flex:1;min-width:0;padding:28px 36px;overflow-x:hidden}
.tab-panel{display:none}
.tab-panel.active{display:block}
section{background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:18px 20px;max-width:100%}
h2{font-family:var(--font-ui);font-size:13px;color:var(--text);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.vs{color:var(--text-faint);font-weight:normal;text-transform:none;letter-spacing:0;margin-left:6px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:6px 8px;color:var(--text-dim);font-family:var(--font-ui);font-size:11px;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:var(--text)}
th[data-dir=asc]::after{content:' ▲';font-size:9px}
th[data-dir=desc]::after{content:' ▼';font-size:9px}
td{padding:6px 8px;border-top:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}
tr:hover td{background:#f4f5f7}
.path{color:#3a3b40;word-break:break-all}
.none{color:var(--text-dim);font-size:13px;padding:6px 0}
.dim{color:var(--text-dim)}
/* method */
.m-get{color:var(--green)}.m-post{color:var(--orange)}.m-put{color:var(--blue)}
.m-delete{color:var(--red)}.m-patch{color:var(--purple)}.m-options,.m-head{color:#546e7a}
/* status */
.s-ok{color:var(--green)}.s-warn{color:var(--orange)}.s-err{color:var(--red)}.s-redir{color:var(--blue)}
/* auth */
.auth-y{color:var(--green)}.auth-n{color:var(--text-faint)}
/* anomaly — left border stripe so severity reads without parsing color */
.a-warn td{color:var(--orange)}.a-warn td:first-child{border-left:3px solid var(--orange)}
.a-info td{color:var(--text-dim)}.a-info td:first-child{border-left:3px solid var(--border)}
/* drift */
.d-add td{color:var(--green)}.d-add td:first-child{border-left:3px solid var(--green)}
.d-rem td{color:var(--red)}.d-rem td:first-child{border-left:3px solid var(--red)}
.d-chg td{color:var(--orange)}.d-chg td:first-child{border-left:3px solid var(--orange)}
/* schemathesis failures */
.fail-list{margin-top:10px}
.fail-block{border-top:1px solid var(--border);padding:8px 0;font-size:12px;color:var(--text-dim)}
.fail-block .a-warn{color:var(--red)}
footer{color:var(--text-faint);font-size:11px}
/* waterfall */
.waterfall{overflow-x:auto;background:#f4f5f7;padding:8px;border-radius:4px}
/* auth + stat row */
.stat-row{display:flex;gap:28px;flex-wrap:wrap;margin-bottom:10px}
.stat{color:var(--text-dim);font-size:12px}.stat span{color:var(--text);font-size:15px;display:block}
/* responsive: collapse the sidebar to a horizontal top bar below tablet width */
@media (max-width:760px){
  .shell{flex-direction:column}
  .sidebar{position:relative;top:auto;height:auto;width:100%;flex:none;border-right:none;border-bottom:1px solid var(--border);padding:16px}
  .sidebar-stats{flex-direction:row;flex-wrap:wrap}
  .ov-stat{flex:1 1 100px}
  nav.toc{flex-direction:row;flex-wrap:wrap;margin-bottom:0}
  .sidebar footer{display:none}
  .content{padding:20px}
}
@media (max-width:480px){
  .content{padding:14px}
  section{padding:14px}
}
`.trim();

// ---------------------------------------------------------------------------
// JS — table sort widget
// ---------------------------------------------------------------------------

const JS = `
(function(){
  var t=document.getElementById('cov');
  if(t){
    var ths=t.querySelectorAll('th[data-sort]');
    var sc=-1,asc=true;
    ths.forEach(function(th,i){
      th.addEventListener('click',function(){
        if(sc===i){asc=!asc}else{sc=i;asc=true}
        ths.forEach(function(h){delete h.dataset.dir});
        th.dataset.dir=asc?'asc':'desc';
        var tb=t.querySelector('tbody');
        var rows=[].slice.call(tb.querySelectorAll('tr'));
        var type=th.dataset.sort;
        rows.sort(function(a,b){
          var av=a.cells[i].dataset.val||a.cells[i].textContent.trim();
          var bv=b.cells[i].dataset.val||b.cells[i].textContent.trim();
          var cmp=type==='num'?(parseFloat(av)||0)-(parseFloat(bv)||0):av.localeCompare(bv);
          return asc?cmp:-cmp;
        });
        rows.forEach(function(r){tb.appendChild(r)});
      });
    });
  }

  // Tab switching — only one section visible at a time, no full-page scroll
  var links=[].slice.call(document.querySelectorAll('nav.toc a'));
  var panels=[].slice.call(document.querySelectorAll('.tab-panel'));
  function show(id){
    panels.forEach(function(p){p.classList.toggle('active',p.id===id)});
    links.forEach(function(l){l.classList.toggle('active',l.getAttribute('href')==='#'+id)});
  }
  links.forEach(function(l){
    l.addEventListener('click',function(e){
      e.preventDefault();
      var id=l.getAttribute('href').slice(1);
      show(id);
      history.replaceState(null,'','#'+id);
    });
  });
  var initial=(location.hash||'').slice(1);
  if(!panels.some(function(p){return p.id===initial})) initial=panels[0]&&panels[0].id;
  if(initial) show(initial);
})();
`.trim();

// ---------------------------------------------------------------------------
// Nav + overview strip
// ---------------------------------------------------------------------------

function buildNav(sections: Array<{ id: string; label: string }>): string {
  const links = sections.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join('\n    ');
  return `<nav class="toc">
    ${links}
  </nav>`;
}

function buildOverview(
  summary: CoverageSummary,
  anomalies: Anomaly[],
  drift: DriftReport | null,
  authAudit: AuthAuditResult | null
): string {
  const warnCount = anomalies.filter((a) => a.severity === 'warn').length;
  const stats: string[] = [
    `<div class="ov-stat"><span class="n">${summary.uniqueEndpoints}</span><span class="l">Endpoints</span></div>`,
    `<div class="ov-stat"><span class="n">${summary.totalRequests}</span><span class="l">Requests</span></div>`,
    `<div class="ov-stat ${warnCount > 0 ? 'warn' : 'ok'}"><span class="n">${anomalies.length}</span><span class="l">Anomalies</span></div>`,
  ];
  if (drift) {
    const changeCount = drift.added.length + drift.removed.length + drift.changed.length;
    stats.push(
      `<div class="ov-stat ${changeCount > 0 ? 'warn' : 'ok'}"><span class="n">${changeCount}</span><span class="l">Drift changes</span></div>`
    );
  }
  if (authAudit) {
    const total = authAudit.withAuth + authAudit.withoutAuth;
    const pct = total > 0 ? Math.round((authAudit.withAuth / total) * 100) : 0;
    stats.push(`<div class="ov-stat"><span class="n">${pct}%</span><span class="l">Auth coverage</span></div>`);
  }
  return `<div class="sidebar-stats">
    ${stats.join('\n    ')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateHtmlReport(
  summary: CoverageSummary,
  anomalies: Anomaly[],
  drift: DriftReport | null,
  outDir: string,
  entries: HarEntry[] = [],
  authAudit: AuthAuditResult | null = null,
  causalGraph: CausalGraph | null = null
): void {
  const capturedAt = new Date(summary.capturedAt).toLocaleString();

  const navSections: Array<{ id: string; label: string }> = [];
  if (generateWaterfall(entries)) navSections.push({ id: 'waterfall', label: 'Waterfall' });
  if (authAudit) navSections.push({ id: 'auth', label: 'Auth' });
  if (causalGraph && causalGraph.edges.length > 0) navSections.push({ id: 'causal', label: 'Causal Flow' });
  navSections.push({ id: 'anomalies', label: 'Anomalies' });
  if (drift) navSections.push({ id: 'drift', label: 'Drift' });
  navSections.push({ id: 'coverage', label: 'Coverage' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>API Report — ${esc(summary.sessionName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="shell">
<aside class="sidebar">
  <h1>${esc(summary.sessionName)}</h1>
  <p class="subtitle">Captured ${capturedAt}</p>

  ${buildOverview(summary, anomalies, drift, authAudit)}

  ${buildNav(navSections)}

  <footer>Generated by Specothesis</footer>
</aside>
<main class="content">
${buildWaterfallSection(entries)}

${authAudit ? buildAuthSection(authAudit) : ''}

${causalGraph ? buildCausalSection(causalGraph) : ''}

${buildAnomalySection(anomalies)}

${buildDriftSection(drift)}

${buildCoverageSection(summary)}
</main>
</div>
<script>${JS}</script>
</body>
</html>`;

  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`  [report]   ${outPath}`);
}

// ---------------------------------------------------------------------------
// Schemathesis report (generated separately by schema-manifest CLI)
// ---------------------------------------------------------------------------

export function generateSchemaHtmlReport(manifest: SchemaManifest, outDir: string): void {
  const ranAt = new Date(manifest.ranAt).toLocaleString();

  const epRows = manifest.endpoints
    .map((ep) => {
      const failCls = ep.failed > 0 ? 's-err' : 's-ok';
      return `<tr>
      <td><span class="${methodCls(ep.method)}">${esc(ep.method)}</span></td>
      <td class="path">${esc(ep.path)}</td>
      <td class="${failCls}" data-val="${ep.failed}">${ep.failed}</td>
      <td data-val="${ep.skipped}">${ep.skipped}</td>
    </tr>`;
    })
    .join('\n');

  const failureBlocks = manifest.endpoints
    .filter((ep) => ep.failures.length > 0)
    .flatMap((ep) =>
      ep.failures.map(
        (f) => `<div class="fail-block">
        <span class="s-err">${esc(ep.method)} ${esc(ep.path)}</span>
        ${f.statusReceived !== undefined ? `<br><span class="dim">received:</span> <span class="s-warn">${f.statusReceived}</span>` : ''}
        <br><span class="dim">reason:</span>   ${esc(f.failureReason)}
        ${f.reproduceCurl ? `<br><span class="dim">curl:</span>     <span class="curl">${esc(f.reproduceCurl)}</span>` : ''}
      </div>`
      )
    )
    .join('\n');

  const schemaJS = `
(function(){
  var t=document.getElementById('stbl');
  if(!t)return;
  var ths=t.querySelectorAll('th[data-sort]');
  var sc=-1,asc=true;
  ths.forEach(function(th,i){
    th.addEventListener('click',function(){
      if(sc===i){asc=!asc}else{sc=i;asc=true}
      ths.forEach(function(h){delete h.dataset.dir});
      th.dataset.dir=asc?'asc':'desc';
      var tb=t.querySelector('tbody');
      var rows=[].slice.call(tb.querySelectorAll('tr'));
      var type=th.dataset.sort;
      rows.sort(function(a,b){
        var av=a.cells[i].dataset.val||a.cells[i].textContent.trim();
        var bv=b.cells[i].dataset.val||b.cells[i].textContent.trim();
        var cmp=type==='num'?(parseFloat(av)||0)-(parseFloat(bv)||0):av.localeCompare(bv);
        return asc?cmp:-cmp;
      });
      rows.forEach(function(r){tb.appendChild(r)});
    });
  });
})();`.trim();

  const schemaCss =
    CSS +
    `
.curl{color:#607d8b;word-break:break-all}
.fail-block{border-top:1px solid #1c1c1c;padding:10px 0;font-size:12px;line-height:1.8}
.stat-row{display:flex;gap:32px;margin-bottom:24px}
.stat{color:#555;font-size:12px}.stat span{color:#d0d0d0;font-size:14px;display:block}`.trim();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Schemathesis Report — ${esc(manifest.sessionName)}</title>
<style>${schemaCss}</style>
</head>
<body>
<h1>Schemathesis Report — ${esc(manifest.sessionName)}</h1>
<p class="subtitle">Run ${ranAt} · ${esc(manifest.sourceSpec)}</p>

<div class="stat-row">
  <div class="stat"><span>${manifest.totalOperations}</span>Operations</div>
  <div class="stat"><span class="${manifest.totalFailed > 0 ? 's-err' : 's-ok'}">${manifest.totalFailed}</span>Failed</div>
  <div class="stat"><span>${manifest.totalSkipped}</span>Skipped</div>
</div>

<section>
  <h2>Results</h2>
  <table id="stbl">
    <thead>
      <tr>
        <th data-sort="str">Method</th>
        <th data-sort="str">Path</th>
        <th data-sort="num">Fail</th>
        <th data-sort="num">Skip</th>
      </tr>
    </thead>
    <tbody>${epRows}</tbody>
  </table>
</section>

${
  failureBlocks
    ? `<section>
  <h2>Failures</h2>
  ${failureBlocks}
</section>`
    : '<section><h2>Failures</h2><p class="none">✓ No failures</p></section>'
}

<footer>Generated by Specothesis · schema-manifest</footer>
<script>${schemaJS}</script>
</body>
</html>`;

  const outPath = path.join(outDir, 'schemathesis-report.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`  [schema-report] ${outPath}`);
}

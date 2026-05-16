import * as fs from 'fs';
import * as path from 'path';
import type { CoverageSummary } from './coverage.js';
import type { Anomaly } from './anomalies.js';
import type { DriftReport } from './drift.js';
import type { SchemaManifest } from './schemaManifest.js';

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
    return `<section>
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

  return `<section>
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
    return `<section>
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

  return `<section>
  <h2>API Drift <span class="vs">vs ${esc(drift.baseSession)}</span></h2>
  <table>
    <thead><tr><th></th><th>Endpoint</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
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

  return `<section>
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
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d0d;color:#d0d0d0;font-family:'Courier New',Courier,monospace;font-size:13px;padding:28px 32px;max-width:1200px}
h1{font-size:15px;color:#fff;font-weight:normal;margin-bottom:3px}
.subtitle{color:#555;font-size:11px;margin-bottom:28px}
section{margin-bottom:28px}
h2{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid #1c1c1c;padding-bottom:4px}
.vs{color:#444;font-weight:normal;margin-left:6px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:5px 8px;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:#999}
th[data-dir=asc]::after{content:' ▲';font-size:9px}
th[data-dir=desc]::after{content:' ▼';font-size:9px}
td{padding:5px 8px;border-top:1px solid #141414;vertical-align:top}
tr:hover td{background:#111}
.path{color:#bbb}
.none{color:#444;font-size:12px;padding:6px 0}
.dim{color:#555}
/* method */
.m-get{color:#4caf50}.m-post{color:#ff9800}.m-put{color:#2196f3}
.m-delete{color:#f44336}.m-patch{color:#9c27b0}.m-options,.m-head{color:#607d8b}
/* status */
.s-ok{color:#4caf50}.s-warn{color:#ff9800}.s-err{color:#f44336}.s-redir{color:#2196f3}
/* auth */
.auth-y{color:#4caf50}.auth-n{color:#333}
/* anomaly */
.a-warn td{color:#f44336}.a-info td{color:#555}
/* drift */
.d-add td{color:#4caf50}.d-rem td{color:#f44336}.d-chg td{color:#ff9800}
/* schemathesis failures */
.fail-list{margin-top:10px}
.fail-block{border-top:1px solid #1c1c1c;padding:8px 0;font-size:12px;color:#888}
.fail-block .a-warn{color:#f44336}
footer{color:#2a2a2a;font-size:11px;margin-top:32px;border-top:1px solid #1a1a1a;padding-top:8px}
`.trim();

// ---------------------------------------------------------------------------
// JS — table sort widget
// ---------------------------------------------------------------------------

const JS = `
(function(){
  var t=document.getElementById('cov');
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
})();
`.trim();

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateHtmlReport(
  summary: CoverageSummary,
  anomalies: Anomaly[],
  drift: DriftReport | null,
  outDir: string
): void {
  const capturedAt = new Date(summary.capturedAt).toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>API Report — ${esc(summary.sessionName)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>Specothesis Report — ${esc(summary.sessionName)}</h1>
<p class="subtitle">Captured ${capturedAt}</p>

${buildAnomalySection(anomalies)}

${buildDriftSection(drift)}

${buildCoverageSection(summary)}

<footer>Generated by Specothesis</footer>

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

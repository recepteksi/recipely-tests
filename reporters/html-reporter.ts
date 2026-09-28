import fs from 'fs';
import path from 'path';
import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  FullConfig,
  Suite,
} from '@playwright/test/reporter';

/**
 * Recipely HTML report.
 *
 * Produces a single self-contained, English-language dashboard
 * (playwright-report/recipely-report.html) that is far easier to read than the
 * stock Playwright report: results are grouped by SURFACE (where the request
 * came from) and then by SERVICE (which part of the product), every test row
 * explains itself, and quick filters let you jump straight to failures.
 *
 * The headline idea the report communicates: each backend service is verified
 * twice — once as a "direct" server-to-server caller and once with the mobile
 * app's request signature — so coverage spans both how the app calls the API
 * and how any authorized client does.
 */

interface Row {
  surfaceKey: string;
  surface: string;
  surfaceHint: string;
  service: string;
  title: string;
  fullTitle: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  error?: string;
  location: string;
}

const stripAnsi = (s: unknown): string => String(s ?? '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

/** Maps a Playwright project name to a human surface + one-line description. */
function surfaceOf(project: string): { key: string; name: string; hint: string } {
  if (project === 'backend-direct')
    return {
      key: 'backend-direct',
      name: 'Backend · Direct',
      hint: 'Server-to-server caller (like curl/Node) — proves each service works for any authorized client.',
    };
  if (project === 'backend-mobile')
    return {
      key: 'backend-mobile',
      name: 'Backend · Mobile',
      hint: "The SAME requests carrying the React Native app's headers — proves each service works as the installed app calls it.",
    };
  if (project.startsWith('desktop-'))
    return {
      key: 'web-desktop',
      name: 'Web · Desktop',
      hint: 'The Firebase-hosted web build driven in real desktop browsers (Chromium / Firefox / WebKit).',
    };
  if (project.startsWith('mobile-') || project.startsWith('tablet-'))
    return {
      key: 'web-mobile',
      name: 'Web · Mobile Emulation',
      hint: 'The web build under iPhone / Pixel / iPad device emulation (touch, DPR, mobile viewport).',
    };
  return { key: project, name: project, hint: '' };
}

/** Turns `tests/backend/auth.spec.ts` into a tidy service label like "Auth". */
function serviceOf(file: string): string {
  const base = path.basename(file).replace(/\.spec\.ts$/, '');
  const map: Record<string, string> = {
    'static-pages': 'Static Pages',
    ai: 'AI',
    me: 'Me / Profile',
  };
  if (map[base]) return map[base];
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function projectNameOf(test: TestCase): string {
  let s: Suite | undefined = test.parent;
  while (s) {
    try {
      const p = s.project?.();
      if (p?.name) return p.name;
    } catch {
      /* climb */
    }
    s = s.parent;
  }
  return 'default';
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default class RecipelyHtmlReporter implements Reporter {
  private rows: Row[] = [];
  private startedAt = Date.now();
  private outputFile: string;
  private targetApi = process.env.RECIPELY_API_URL ?? 'https://api.recipely.net';
  private targetWeb = process.env.RECIPELY_WEB_URL ?? 'https://recipely.net';

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile ?? 'playwright-report/recipely-report.html';
  }

  onBegin(_config: FullConfig): void {
    this.startedAt = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const outcome = test.outcome();
    // Record only the FINAL attempt of each test to avoid double counting retries.
    if (typeof test.retries === 'number' && result.retry < test.retries && result.status === 'failed') {
      return;
    }

    let status: Row['status'];
    if (outcome === 'flaky') status = 'flaky';
    else if (result.status === 'skipped' || outcome === 'skipped') status = 'skipped';
    else if (result.status === 'passed') status = 'passed';
    else status = 'failed';

    const project = projectNameOf(test);
    const surface = surfaceOf(project);
    const file = path.relative(process.cwd(), test.location.file);
    const titles = test.titlePath().filter(Boolean);

    this.rows.push({
      surfaceKey: surface.key,
      surface: surface.name,
      surfaceHint: surface.hint,
      service: serviceOf(file),
      title: test.title,
      fullTitle: titles.slice(1).join(' › '),
      status,
      durationMs: result.duration,
      error: status === 'failed' ? stripAnsi(result.error?.message).trim().slice(0, 600) : undefined,
      location: `${file}:${test.location.line}`,
    });
  }

  onEnd(_result: FullResult): void {
    const html = this.render();
    try {
      const dir = path.dirname(this.outputFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.outputFile, html);
      // eslint-disable-next-line no-console
      console.log(`\n  📊 Recipely report: ${this.outputFile}\n`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('Could not write recipely-report.html:', (e as Error).message);
    }
  }

  private counts(rows: Row[]) {
    return {
      total: rows.length,
      passed: rows.filter((r) => r.status === 'passed').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      flaky: rows.filter((r) => r.status === 'flaky').length,
      skipped: rows.filter((r) => r.status === 'skipped').length,
    };
  }

  private render(): string {
    const c = this.counts(this.rows);
    const durationMs = Date.now() - this.startedAt;
    const passRate = c.total ? Math.round(((c.passed + c.flaky) / c.total) * 100) : 0;
    const generated = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    });

    // Group rows: surface → service.
    const surfaceOrder = [
      'backend-direct',
      'backend-mobile',
      'web-desktop',
      'web-mobile',
    ];
    const bySurface = new Map<string, Row[]>();
    for (const r of this.rows) {
      const arr = bySurface.get(r.surfaceKey) ?? [];
      arr.push(r);
      bySurface.set(r.surfaceKey, arr);
    }
    const orderedSurfaces = [
      ...surfaceOrder.filter((k) => bySurface.has(k)),
      ...[...bySurface.keys()].filter((k) => !surfaceOrder.includes(k)),
    ];

    const badge = (status: Row['status']): string =>
      `<span class="badge ${status}">${status}</span>`;

    let sections = '';
    for (const key of orderedSurfaces) {
      const rows = bySurface.get(key)!;
      const sc = this.counts(rows);
      const hint = rows[0]?.surfaceHint ?? '';
      const name = rows[0]?.surface ?? key;

      // Sub-group by service.
      const byService = new Map<string, Row[]>();
      for (const r of rows) {
        const arr = byService.get(r.service) ?? [];
        arr.push(r);
        byService.set(r.service, arr);
      }

      let serviceBlocks = '';
      for (const [service, srows] of [...byService.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        const vc = this.counts(srows);
        const testRows = srows
          .map(
            (r) => `
            <tr class="row ${r.status}" data-status="${r.status}">
              <td class="st">${badge(r.status)}</td>
              <td class="tt">
                <div class="ttl">${esc(r.fullTitle || r.title)}</div>
                ${r.error ? `<pre class="err">${esc(r.error)}</pre>` : ''}
              </td>
              <td class="dur">${fmtMs(r.durationMs)}</td>
            </tr>`,
          )
          .join('');

        serviceBlocks += `
          <div class="service">
            <div class="service-head">
              <h4>${esc(service)}</h4>
              <span class="mini">
                <b class="ok">${vc.passed}</b>/${vc.total} passed${
                  vc.failed ? ` · <b class="bad">${vc.failed} failed</b>` : ''
                }${vc.skipped ? ` · <span class="muted">${vc.skipped} skipped</span>` : ''}
              </span>
            </div>
            <table><tbody>${testRows}</tbody></table>
          </div>`;
      }

      sections += `
        <section class="surface" data-surface="${key}">
          <div class="surface-head">
            <div>
              <h3>${esc(name)}</h3>
              <p class="hint">${esc(hint)}</p>
            </div>
            <div class="surface-stats">
              <span class="pill ok">${sc.passed} passed</span>
              ${sc.failed ? `<span class="pill bad">${sc.failed} failed</span>` : ''}
              ${sc.flaky ? `<span class="pill warn">${sc.flaky} flaky</span>` : ''}
              ${sc.skipped ? `<span class="pill muted">${sc.skipped} skipped</span>` : ''}
            </div>
          </div>
          ${serviceBlocks}
        </section>`;
    }

    const overallClass = c.failed > 0 ? 'bad' : 'ok';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Recipely — Test Report</title>
<style>
  :root {
    --bg:#0d1117; --panel:#161b22; --panel2:#1c2230; --border:#2a3140;
    --text:#e6edf3; --muted:#8b97a7; --ok:#3fb950; --bad:#f85149; --warn:#d29922;
    --accent:#58a6ff; --skip:#6e7681;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  a { color:var(--accent); }
  .wrap { max-width:1080px; margin:0 auto; padding:32px 20px 80px; }
  header h1 { margin:0 0 4px; font-size:26px; letter-spacing:-.3px; }
  header .sub { color:var(--muted); margin:0 0 24px; font-size:14px; }
  header .sub code { background:var(--panel2); padding:2px 6px; border-radius:5px; color:var(--text); }

  .hero { display:flex; align-items:center; gap:24px; background:var(--panel);
    border:1px solid var(--border); border-radius:14px; padding:22px 24px; margin-bottom:18px; }
  .donut { --p:0; width:104px; height:104px; border-radius:50%; flex:0 0 auto;
    background:conic-gradient(var(--ok) calc(var(--p)*1%), var(--bad) 0);
    display:grid; place-items:center; position:relative; }
  .donut::before { content:""; position:absolute; inset:12px; border-radius:50%; background:var(--panel); }
  .donut span { position:relative; font-size:24px; font-weight:700; }
  .hero-meta { flex:1; }
  .hero-meta h2 { margin:0 0 6px; font-size:18px; }
  .hero-meta h2.ok { color:var(--ok); } .hero-meta h2.bad { color:var(--bad); }
  .hero-meta p { margin:0; color:var(--muted); font-size:14px; }

  .cards { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:18px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px;
    padding:14px 16px; text-align:center; }
  .card .n { font-size:24px; font-weight:700; }
  .card .l { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; }
  .card.ok .n { color:var(--ok); } .card.bad .n { color:var(--bad); }
  .card.warn .n { color:var(--warn); } .card.muted .n { color:var(--muted); }

  .explain { background:var(--panel); border:1px solid var(--border); border-left:3px solid var(--accent);
    border-radius:10px; padding:14px 18px; margin-bottom:22px; font-size:13.5px; color:var(--muted); }
  .explain b { color:var(--text); }

  .filters { display:flex; gap:8px; margin-bottom:18px; flex-wrap:wrap; }
  .filters button { background:var(--panel); color:var(--muted); border:1px solid var(--border);
    border-radius:999px; padding:6px 14px; cursor:pointer; font-size:13px; }
  .filters button.active { background:var(--accent); border-color:var(--accent); color:#04101f; font-weight:600; }

  section.surface { background:var(--panel); border:1px solid var(--border);
    border-radius:14px; padding:4px 0 8px; margin-bottom:20px; overflow:hidden; }
  .surface-head { display:flex; justify-content:space-between; align-items:flex-start;
    gap:16px; padding:18px 20px 12px; border-bottom:1px solid var(--border); }
  .surface-head h3 { margin:0 0 4px; font-size:17px; }
  .surface-head .hint { margin:0; color:var(--muted); font-size:13px; max-width:620px; }
  .surface-stats { display:flex; gap:6px; flex-wrap:wrap; flex:0 0 auto; }
  .pill { font-size:12px; padding:3px 9px; border-radius:999px; border:1px solid var(--border); white-space:nowrap; }
  .pill.ok { color:var(--ok); } .pill.bad { color:var(--bad); }
  .pill.warn { color:var(--warn); } .pill.muted { color:var(--muted); }

  .service { padding:6px 20px 2px; }
  .service-head { display:flex; align-items:baseline; gap:12px; padding:12px 0 4px; }
  .service-head h4 { margin:0; font-size:14.5px; }
  .mini { font-size:12.5px; color:var(--muted); }
  .mini .ok { color:var(--ok); } .mini .bad { color:var(--bad); } .mini .muted { color:var(--muted); }

  table { width:100%; border-collapse:collapse; }
  td { padding:8px 6px; border-top:1px solid var(--border); vertical-align:top; }
  td.st { width:74px; } td.dur { width:74px; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
  .ttl { font-size:13.5px; }
  .err { margin:8px 0 2px; background:#2d1517; border:1px solid #5c1f1f; color:#ffb4ab;
    padding:8px 10px; border-radius:7px; font-size:12px; white-space:pre-wrap; overflow-x:auto; }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px;
    padding:3px 8px; border-radius:6px; }
  .badge.passed { background:rgba(63,185,80,.15); color:var(--ok); }
  .badge.failed { background:rgba(248,81,73,.15); color:var(--bad); }
  .badge.flaky { background:rgba(210,153,34,.15); color:var(--warn); }
  .badge.skipped { background:rgba(110,118,129,.18); color:var(--skip); }
  .row.hide { display:none; }
  footer { text-align:center; color:var(--muted); font-size:12px; margin-top:30px; }
  @media (max-width:720px){ .cards{grid-template-columns:repeat(2,1fr);} .surface-head{flex-direction:column;} }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🍳 Recipely — End-to-End Test Report</h1>
    <p class="sub">
      Target API <code>${esc(this.targetApi)}</code> · Web <code>${esc(this.targetWeb)}</code>
      · Generated ${esc(generated)} · Duration ${fmtMs(durationMs)}
    </p>
  </header>

  <div class="hero">
    <div class="donut" style="--p:${passRate}"><span>${passRate}%</span></div>
    <div class="hero-meta">
      <h2 class="${overallClass}">${c.failed === 0 ? 'All executed tests passed' : `${c.failed} test${c.failed === 1 ? '' : 's'} failed`}</h2>
      <p>${c.passed + c.flaky} of ${c.total} executed checks passed${c.skipped ? `, ${c.skipped} skipped (auth not configured)` : ''}.</p>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="n">${c.total}</div><div class="l">Total</div></div>
    <div class="card ok"><div class="n">${c.passed}</div><div class="l">Passed</div></div>
    <div class="card bad"><div class="n">${c.failed}</div><div class="l">Failed</div></div>
    <div class="card warn"><div class="n">${c.flaky}</div><div class="l">Flaky</div></div>
    <div class="card muted"><div class="n">${c.skipped}</div><div class="l">Skipped</div></div>
  </div>

  <div class="explain">
    <b>How to read this report.</b> Every backend service is tested twice — once as a
    <b>Direct</b> server-to-server caller and once with the <b>Mobile</b> app's request
    headers — so coverage spans both how the installed app calls the API and how any
    authorized client does. The <b>Web</b> surfaces drive the hosted build in real desktop
    browsers and under mobile device emulation. <b>Skipped</b> rows are authenticated flows
    that need the real AES key + test account (see <code>.env.example</code>).
  </div>

  <div class="filters">
    <button data-filter="all" class="active">All (${c.total})</button>
    <button data-filter="failed">Failed (${c.failed})</button>
    <button data-filter="passed">Passed (${c.passed})</button>
    <button data-filter="skipped">Skipped (${c.skipped})</button>
  </div>

  ${sections || '<p class="hint">No tests were executed.</p>'}

  <footer>Recipely automated test suite · Playwright · report rendered locally, no data leaves your machine.</footer>
</div>
<script>
  const buttons = document.querySelectorAll('.filters button');
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const f = b.dataset.filter;
    document.querySelectorAll('tr.row').forEach((row) => {
      row.classList.toggle('hide', f !== 'all' && row.dataset.status !== f);
    });
  }));
</script>
</body>
</html>`;
  }
}

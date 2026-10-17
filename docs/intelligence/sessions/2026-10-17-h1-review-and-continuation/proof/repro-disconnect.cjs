const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

const REPO = path.resolve(process.env.KF_H1_REPO || process.cwd());
const OUT = path.resolve(process.env.KF_H1_OUTPUT || process.cwd());
const WEB = path.join(REPO, 'apps/web/src');
const PAGE = path.join(WEB, 'app/admin/mission-control/handoffs/page.tsx');
const PANELS = path.join(WEB, 'app/admin/mission-control/handoffs/_components/handoff-panels.tsx');
const CLIENT = path.join(WEB, 'lib/api/handoff-monitor.ts');
const sourceHashes = Object.fromEntries([PAGE, PANELS, CLIENT].map(file => [path.relative(REPO, file), require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin/mission-control/handoffs', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
const T0 = Date.parse('2026-10-17T20:00:00.000Z');
const clock = FakeTimers.install({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

let client;
let panels;
let apiGet;
function loadActualTs(file) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = name => {
    if (name === '@/lib/api') return { apiGet: (...args) => apiGet(...args) };
    if (name === '@/lib/api/handoff-monitor') return client;
    if (name === './_components/handoff-panels') return panels;
    if (name === '@/lib/utils') return { cn: (...classes) => classes.filter(Boolean).join(' ') };
    if (name === 'lucide-react') return { ArrowLeftRight: () => null, ExternalLink: () => null };
    return require(name);
  };
  m._compile(js, file);
  return m.exports;
}

(async () => {
  const lib = path.join(REPO, 'scripts/agent-control/lib');
  const { createHandoffMonitor } = await import(pathToFileURL(path.join(lib, 'handoff-collector.mjs')).href);
  const { viewOf } = await import(pathToFileURL(path.join(lib, 'handoff-projector.mjs')).href);
  const { createFixtureTransport, loadFixture } = await import(pathToFileURL(path.join(lib, 'handoff-fixture-transport.mjs')).href);
  const fixture = loadFixture(path.join(REPO, 'scripts/agent-control/fixtures/handoff-irp177.json'));
  const monitor = createHandoffMonitor({ transport: createFixtureTransport(fixture), now: () => Date.now() });
  let failApi = false;
  let forcedStatus = null;
  let requests = 0;
  let lastSuccessPayload;
  apiGet = async url => {
    requests += 1;
    if (failApi) return { data: null, error: 'SYNTHETIC_API_DISCONNECT' };
    const result = await monitor.read();
    const params = new URL(url, 'http://localhost').searchParams;
    const payload = {
      mode: 'FIXTURE', detail: null, refresh_hint_ms: 15_000,
      freshness: { ...result.freshness, ...(forcedStatus ? { status: forcedStatus } : {}) },
      view: viewOf(result.snapshot, { task: params.has('task') ? Number(params.get('task')) : undefined, includeNoise: params.get('noise') === '1' }),
    };
    lastSuccessPayload = payload;
    return { data: payload, error: null };
  };
  client = loadActualTs(CLIENT);
  panels = loadActualTs(PANELS);
  const AdminHandoffs = loadActualTs(PAGE).default;
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(AdminHandoffs)); });
  await act(async () => { await clock.tickAsync(5); });
  await act(async () => { await clock.tickAsync(5); });
  const status = () => document.querySelector('[data-testid="handoff-freshness"]').textContent;
  const sourceBar = () => document.querySelector('[data-testid="handoff-source-bar"]').textContent;
  const initial = { now: new Date().toISOString(), status: status(), requests, last_success_at: lastSuccessPayload.freshness.last_success_at };
  assert.equal(initial.status, 'FRESH');
  assert.ok(document.querySelector('[data-testid="handoff-task-detail"]'));
  failApi = true;
  await act(async () => { await clock.tickAsync(300_000); });
  const disconnected = {
    now: new Date().toISOString(), status: status(), requests,
    last_success_at: lastSuccessPayload.freshness.last_success_at,
    age_since_success_seconds: (Date.now() - Date.parse(lastSuccessPayload.freshness.last_success_at)) / 1000,
    stale_after_seconds: lastSuccessPayload.freshness.stale_after_seconds,
    error: document.querySelector('[data-testid="handoff-error"]').textContent,
    source_bar: sourceBar(),
  };
  fs.writeFileSync(path.join(OUT, 'disconnected-page.html'), dom.serialize());
  assert.ok(disconnected.age_since_success_seconds > disconnected.stale_after_seconds);
  assert.equal(disconnected.status, 'FRESH');
  assert.equal(disconnected.error, 'SYNTHETIC_API_DISCONNECT');
  // Control: when the server explicitly sends STALE, the same unmodified
  // page and SourceBar render it. The missing behavior is local ageing on
  // failed API reads, not a harness unable to render a stale badge.
  failApi = false;
  forcedStatus = 'STALE';
  await act(async () => { await clock.tickAsync(15_000); });
  const control = { status: status(), requests, errorCleared: !document.querySelector('[data-testid="handoff-error"]') };
  assert.equal(control.status, 'STALE');
  const output = {
    outcome: 'DEFECT_REPRODUCED',
    environment: { node: process.version, react: React.version, jsdom: require('jsdom/package.json').version, typescript: ts.version, fakeTimers: require('@sinonjs/fake-timers/package.json').version },
    sourceHashes,
    method: 'Unmodified exact-head page, panels and client transpiled by TypeScript; React DOM in JSDOM. Real shared projector/collector fixture. Only API transport, SVG icons and styling helper stubbed; fake clock advances five minutes. No real browser, live API, account or production traffic.',
    initial, disconnected, control,
  };
  fs.writeFileSync(path.join(OUT, 'disconnect-result.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  await act(async () => root.unmount());
  clock.uninstall();
  dom.window.close();
})().catch(error => { console.error(error); clock.uninstall(); dom.window.close(); process.exitCode = 1; });

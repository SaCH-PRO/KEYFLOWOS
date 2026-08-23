// Generates the KEYFLOWOS system-map dataset.
//
//   node scripts/system-map/generate.mjs [--out docs/system-map/data]
//
// Writes one CSV per grain. Every number in the markdown map should be
// re-derivable from these files; if a hand-written figure and a generated one
// disagree, the generated one is right — re-run this and diff.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as X from './extract.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = join(X.REPO, outArg > -1 ? process.argv[outArg + 1] : 'docs/system-map/data');
mkdirSync(OUT, { recursive: true });

const SRC_RE = /\.(ts|tsx|mjs|js)$/;
const files = X.tracked();
const srcFiles = files.filter((f) => SRC_RE.test(f) && !f.includes('node_modules'));

console.log(`tracked=${files.length} source=${srcFiles.length}`);

// ── pass 1: read and extract ────────────────────────────────────────────────

/** @type {Map<string, any>} */
const info = new Map();

for (const f of srcFiles) {
  const src = X.read(f);
  if (src == null) continue;
  const clean = X.stripComments(src);
  info.set(f, {
    path: f,
    src,
    clean,
    lines: X.lineCount(src),
    workspace: X.workspaceOf(f),
    module: X.serverModuleOf(f),
    kind: X.kindOf(f),
    classes: X.classNames(clean),
    imports: X.imports(clean),
    injections: X.injections(src),
    emits: X.eventsEmitted(clean),
    handles: X.eventsHandled(clean),
    crons: X.cronJobs(clean),
    prisma: X.prismaModels(clean),
    routes: f.endsWith('.controller.ts') ? X.routes(src) : [],
    webCalls: f.startsWith('apps/web/') ? X.webCalls(clean) : [],
  });
}

// ── module graph ────────────────────────────────────────────────────────────

/** class name -> file that declares it */
const classToFile = new Map();
for (const [f, i] of info) for (const c of i.classes) if (!classToFile.has(c)) classToFile.set(c, f);

/** NestModule class -> { file, imports, controllers, providers, exports } */
const nestModules = new Map();
for (const [f, i] of info) {
  if (!f.endsWith('.module.ts') || !f.startsWith('apps/server/')) continue;
  const cls = i.classes.find((c) => /Module$/.test(c)) || i.classes[0];
  if (!cls) continue;
  nestModules.set(cls, {
    cls,
    file: f,
    imports: X.moduleArray(i.clean, 'imports'),
    controllers: X.moduleArray(i.clean, 'controllers'),
    providers: X.moduleArray(i.clean, 'providers'),
    exports: X.moduleArray(i.clean, 'exports'),
  });
}

// Reachability from AppModule — this is the check that catches a module which
// exists, compiles, and is never registered.
const mounted = new Set();
(function walk(cls) {
  if (!cls || mounted.has(cls)) return;
  const m = nestModules.get(cls);
  if (!m) return;
  mounted.add(cls);
  for (const dep of m.imports) walk(dep);
})('AppModule');

const mountedControllers = new Set();
const mountedProviders = new Set();
for (const cls of mounted) {
  const m = nestModules.get(cls);
  if (!m) continue;
  for (const c of m.controllers) mountedControllers.add(c);
  for (const p of m.providers) mountedProviders.add(p);
}

console.log(`nest modules=${nestModules.size} reachable from AppModule=${mounted.size}`);

// ── routes ──────────────────────────────────────────────────────────────────

const routeRows = [];
for (const [f, i] of info) {
  if (!i.routes.length) continue;
  const ctrlCls = i.classes.find((c) => /Controller$/.test(c)) || i.classes[0] || '';
  const declaring = [...nestModules.values()].find((m) => m.controllers.includes(ctrlCls));
  const isMounted = declaring ? mounted.has(declaring.cls) : false;
  for (const r of i.routes) {
    routeRows.push({
      method: r.method,
      path: r.path,
      normalized_path: X.normRoute(r.path),
      handler: r.handler,
      controller: ctrlCls,
      controller_file: f,
      module: i.module,
      declaring_module: declaring ? declaring.cls : '(none)',
      mounted: isMounted ? 'TRUE' : 'FALSE',
      guards: r.guards.join(' '),
      guard_count: r.guards.length,
      scopes: r.scopes.join(' '),
      body_auth_check: r.bodyAuth ? 'TRUE' : '',
      unguarded: r.guards.length === 0 && !r.bodyAuth ? 'TRUE' : 'FALSE',
    });
  }
}

// ── web -> server route reconciliation ──────────────────────────────────────

const serverPaths = new Map(); // normalized -> rows
for (const r of routeRows) {
  if (!serverPaths.has(r.normalized_path)) serverPaths.set(r.normalized_path, []);
  serverPaths.get(r.normalized_path).push(r);
}

// Next.js route handlers serve their own paths from the web app itself; a call
// to one is not a call to the Nest API and must not be reported as missing.
const nextRoutes = new Set(
  files
    .filter((f) => /^apps\/web\/src\/app\/api\/.*\/route\.ts$/.test(f))
    .map((f) => f.replace(/^apps\/web\/src\/app/, '').replace(/\/route\.ts$/, ''))
    .map((p) => p.replace(/\[\.{3}[^\]]+\]|\[[^\]]+\]/g, ':param')),
);

const callRows = [];
for (const [f, i] of info) {
  for (const p of i.webCalls) {
    const n = X.normRoute(p);
    const servedByNext = nextRoutes.has(n) || [...nextRoutes].some((r) => n.startsWith(r + '/'));
    const matches = servedByNext ? [] : serverPaths.get(n) || [];
    const anyMounted = matches.some((m) => m.mounted === 'TRUE');
    const external = X.isExternalPath(n);
    callRows.push({
      caller_file: f,
      requested_path: p,
      normalized_path: n,
      external: external ? 'TRUE' : 'FALSE',
      server_route_exists: matches.length ? 'TRUE' : 'FALSE',
      server_route_mounted: matches.length ? (anyMounted ? 'TRUE' : 'FALSE') : '',
      matched_controller: matches.map((m) => m.controller).filter((v, k, a) => a.indexOf(v) === k).join(' '),
      status: external
        ? 'EXTERNAL'
        : servedByNext
          ? 'NEXT_ROUTE_HANDLER'
          : !matches.length
            ? 'NO_SERVER_ROUTE'
            : anyMounted
              ? 'OK'
              : 'ROUTE_NOT_MOUNTED',
    });
  }
}

// ── edges ───────────────────────────────────────────────────────────────────

const edges = [];
const push = (from, to, kind, evidence, confidence = 'high') =>
  edges.push({ from, to, kind, evidence, confidence });

for (const [f, i] of info) {
  // import edges (relative only — resolvable to a real file)
  for (const spec of i.imports) {
    if (spec.startsWith('.')) {
      const base = X.resolveImport(f, spec);
      const hit = [base + '.ts', base + '.tsx', base + '/index.ts', base + '.mjs'].find((c) => info.has(c));
      if (hit) push(f, hit, 'imports', spec);
    } else {
      push(f, spec, 'imports-external', spec, spec.startsWith('@keyflow/') ? 'high' : 'high');
    }
  }
  // DI edges — resolve injected class to its declaring file
  for (const t of i.injections) {
    const target = classToFile.get(t);
    if (target && target !== f) push(f, target, 'injects', t);
  }
  // events
  for (const e of i.emits) push(f, e, 'emits', e);
  for (const e of i.handles) push(f, e, 'listens', e);
  // prisma
  for (const { model, op } of i.prisma) {
    push(f, `model:${model}`, X.isWrite(op) ? 'writes-model' : 'reads-model', `${model}.${op}()`);
  }
  // web -> server
  for (const p of i.webCalls) {
    const n = X.normRoute(p);
    const matches = serverPaths.get(n) || [];
    if (matches.length) push(f, matches[0].controller_file, 'http-call', p);
    else push(f, `route:${n}`, 'http-call-unresolved', p, 'medium');
  }
}

// ── events ──────────────────────────────────────────────────────────────────

const evMap = new Map();
const ev = (name) => {
  if (!evMap.has(name)) evMap.set(name, { event: name, emitters: [], listeners: [] });
  return evMap.get(name);
};
for (const [f, i] of info) {
  for (const e of i.emits) ev(e).emitters.push(f);
  for (const e of i.handles) ev(e).listeners.push(f);
}
// A name emitted as a pattern (`content_request.*`, from a computed suffix)
// satisfies every listener it covers, and a wildcard subscription is satisfied
// by any emit it covers. Compare across the whole set rather than by exact key,
// or every computed event name reads as an orphan on both sides.
const allEmitted = [...evMap.values()].filter((e) => e.emitters.length).map((e) => e.event);
const allListened = [...evMap.values()].filter((e) => e.listeners.length).map((e) => e.event);

const eventRows = [...evMap.values()]
  .map((e) => {
    const coveredByEmit = e.emitters.length > 0 || allEmitted.some((x) => X.eventMatches(x, e.event));
    const coveredByListener = e.listeners.length > 0 || allListened.some((x) => X.eventMatches(e.event, x));
    return {
      event: e.event,
      emitter_count: e.emitters.length,
      listener_count: e.listeners.length,
      status: !coveredByListener
        ? 'EMITTED_NO_LISTENER'
        : !coveredByEmit
          ? 'LISTENED_NEVER_EMITTED'
          : 'OK',
      matched_by_pattern: (e.emitters.length && e.listeners.length) || !coveredByEmit || !coveredByListener ? '' : 'TRUE',
      emitters: e.emitters.join(' '),
      listeners: e.listeners.join(' '),
    };
  })
  .sort((a, b) => a.event.localeCompare(b.event));

// ── prisma models ───────────────────────────────────────────────────────────

const schemaPath = 'packages/db/prisma/schema.prisma';
const schema = X.read(schemaPath) || '';
const modelRows = [];
{
  const re = /^model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  const readers = new Map();
  const writers = new Map();
  for (const [f, i] of info) {
    for (const { model, op } of i.prisma) {
      const key = model.toLowerCase();
      const bag = X.isWrite(op) ? writers : readers;
      if (!bag.has(key)) bag.set(key, new Set());
      bag.get(key).add(i.module || i.workspace);
    }
  }
  while ((m = re.exec(schema))) {
    const name = m[1];
    const body = m[2];
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    const lk = key.toLowerCase();
    const hasBiz = /\bbusinessId\b/.test(body);
    const idxBiz = /@@index\(\[[^\]]*businessId/.test(body) || /businessId[^\n]*@unique/.test(body) || /@@unique\(\[[^\]]*businessId/.test(body);
    const r = [...(readers.get(lk) || [])].sort();
    const w = [...(writers.get(lk) || [])].sort();
    modelRows.push({
      model: name,
      has_businessId: hasBiz ? 'TRUE' : 'FALSE',
      indexed_on_businessId: hasBiz ? (idxBiz ? 'TRUE' : 'FALSE') : '',
      field_count: (body.match(/^\s{2}\w+\s+\w/gm) || []).length,
      relation_count: (body.match(/@relation/g) || []).length,
      reader_modules: r.join(' '),
      writer_modules: w.join(' '),
      accessed_by_module_count: new Set([...r, ...w]).size,
      unreferenced: r.length + w.length === 0 ? 'TRUE' : 'FALSE',
    });
  }
}

// ── modules ─────────────────────────────────────────────────────────────────

const moduleAgg = new Map();
for (const [f, i] of info) {
  if (!i.module) continue;
  if (!moduleAgg.has(i.module)) {
    moduleAgg.set(i.module, { module: i.module, files: 0, lines: 0, specs: 0, controllers: 0, services: 0, routes: 0 });
  }
  const a = moduleAgg.get(i.module);
  a.files++;
  if (i.kind === 'spec') a.specs++;
  else a.lines += i.lines;
  if (i.kind === 'controller') a.controllers++;
  if (i.kind === 'service') a.services++;
  a.routes += i.routes.length;
}
const moduleRows = [...moduleAgg.values()]
  .map((a) => {
    const nm = [...nestModules.values()].filter((m) => X.serverModuleOf(m.file) === a.module);
    const isMounted = nm.length ? nm.some((m) => mounted.has(m.cls)) : null;
    return {
      ...a,
      nest_modules: nm.map((m) => m.cls).join(' '),
      mounted: isMounted === null ? '' : isMounted ? 'TRUE' : 'FALSE',
      has_tests: a.specs > 0 ? 'TRUE' : 'FALSE',
      unmounted_with_routes: isMounted === false && a.routes > 0 ? 'TRUE' : '',
    };
  })
  .sort((a, b) => b.lines - a.lines);

// ── files ───────────────────────────────────────────────────────────────────

const fanIn = new Map();
for (const e of edges) if (e.kind === 'imports' || e.kind === 'injects') fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);

const fileRows = [...info.values()]
  .map((i) => ({
    path: i.path,
    workspace: i.workspace,
    module: i.module,
    kind: i.kind,
    lines: i.lines,
    classes: i.classes.join(' '),
    imports_count: i.imports.length,
    injects_count: i.injections.length,
    fan_in: fanIn.get(i.path) || 0,
    routes: i.routes.length,
    emits: i.emits.join(' '),
    listens: i.handles.join(' '),
    cron: i.crons.join(' | '),
    prisma_models: X.dedupe(i.prisma.map((p) => p.model)).join(' '),
    orphan: (fanIn.get(i.path) || 0) === 0 && i.kind !== 'spec' && i.routes.length === 0 ? 'TRUE' : 'FALSE',
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

// ── write ───────────────────────────────────────────────────────────────────

const tables = [
  ['modules.csv', moduleRows, ['module', 'files', 'lines', 'nest_modules', 'mounted', 'controllers', 'services', 'routes', 'specs', 'has_tests', 'unmounted_with_routes']],
  ['files.csv', fileRows, ['path', 'workspace', 'module', 'kind', 'lines', 'classes', 'imports_count', 'injects_count', 'fan_in', 'routes', 'emits', 'listens', 'cron', 'prisma_models', 'orphan']],
  ['edges.csv', edges, ['from', 'to', 'kind', 'evidence', 'confidence']],
  ['routes.csv', routeRows, ['method', 'path', 'normalized_path', 'handler', 'controller', 'controller_file', 'module', 'declaring_module', 'mounted', 'guards', 'guard_count', 'scopes', 'body_auth_check', 'unguarded']],
  ['models.csv', modelRows, ['model', 'has_businessId', 'indexed_on_businessId', 'field_count', 'relation_count', 'reader_modules', 'writer_modules', 'accessed_by_module_count', 'unreferenced']],
  ['events.csv', eventRows, ['event', 'emitter_count', 'listener_count', 'status', 'matched_by_pattern', 'emitters', 'listeners']],
  ['web-api-calls.csv', callRows, ['caller_file', 'requested_path', 'normalized_path', 'external', 'server_route_exists', 'server_route_mounted', 'matched_controller', 'status']],
];

for (const [name, rows, headers] of tables) {
  writeFileSync(join(OUT, name), X.csv(rows, headers), 'utf8');
  console.log(`${String(rows.length).padStart(6)}  ${name}`);
}

// ── headline findings, printed so a run is self-checking ────────────────────

const unmountedWithRoutes = moduleRows.filter((m) => m.unmounted_with_routes === 'TRUE');
const brokenCalls = callRows.filter((c) => c.status !== 'OK');
const orphanEvents = eventRows.filter((e) => e.status === 'EMITTED_NO_LISTENER');
const ghostListeners = eventRows.filter((e) => e.status === 'LISTENED_NEVER_EMITTED');
const unguarded = routeRows.filter((r) => r.unguarded === 'TRUE' && r.mounted === 'TRUE');
const noBiz = modelRows.filter((m) => m.has_businessId === 'FALSE');
const unindexed = modelRows.filter((m) => m.has_businessId === 'TRUE' && m.indexed_on_businessId === 'FALSE');

console.log(`
── findings ─────────────────────────────────────────────
 modules on disk                ${moduleRows.filter((m) => !m.module.startsWith('core/') && m.module !== '(server root)').length}
 nest modules declared          ${nestModules.size}
 reachable from AppModule       ${mounted.size}
 modules w/ routes NOT mounted  ${unmountedWithRoutes.length}  ${unmountedWithRoutes.map((m) => m.module).join(' ')}
 routes total                   ${routeRows.length}
 routes mounted                 ${routeRows.filter((r) => r.mounted === 'TRUE').length}
 mounted routes w/ NO guard     ${unguarded.length}
 web api calls                  ${callRows.length}
 web calls w/ no server route   ${brokenCalls.filter((c) => c.status === 'NO_SERVER_ROUTE').length}
 web calls to unmounted route   ${brokenCalls.filter((c) => c.status === 'ROUTE_NOT_MOUNTED').length}
 prisma models                  ${modelRows.length}
 models w/o businessId          ${noBiz.length}
 models w/ businessId, no index ${unindexed.length}
 models never referenced        ${modelRows.filter((m) => m.unreferenced === 'TRUE').length}
 events                         ${eventRows.length}
 emitted with no listener       ${orphanEvents.length}
 listened but never emitted     ${ghostListeners.length}
 edges                          ${edges.length}
─────────────────────────────────────────────────────────`);

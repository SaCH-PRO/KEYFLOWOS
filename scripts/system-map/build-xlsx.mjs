// Packs the generated CSVs into a single Excel workbook.
//
//   node scripts/system-map/generate.mjs && node scripts/system-map/build-xlsx.mjs
//
// One sheet per grain, each with a frozen header row and an autofilter, so the
// relations can be pivoted without any further preparation. Problem rows are
// tinted so a reader scrolling the sheet sees them without building a filter.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './extract.mjs';

// exceljs is a dependency of apps/server and apps/web, not of the root
// workspace, and pnpm does not hoist it. Resolve it from a workspace that
// declares it rather than adding a root dependency just for this script.
const require = createRequire(import.meta.url);
const ExcelJS = (() => {
  for (const from of ['apps/server', 'apps/web']) {
    try {
      return require(require.resolve('exceljs', { paths: [join(REPO, from)] }));
    } catch {
      /* try the next workspace */
    }
  }
  throw new Error('exceljs not found — run `pnpm install` first');
})();

const DATA = join(REPO, 'docs/system-map/data');
const OUT = join(REPO, 'docs/system-map/KEYFLOWOS-system-map.xlsx');

/** Minimal RFC4180 reader — the CSVs are ours, but quoting must round-trip. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// Sheet order matters: the ones you act on first come first.
const ORDER = ['modules.csv', 'routes.csv', 'web-api-calls.csv', 'events.csv', 'models.csv', 'files.csv', 'edges.csv'];

const RED = 'FFFFD7D5';
const AMBER = 'FFFFF1CC';

/** Row tinting per sheet: returns a fill colour, or null to leave it alone. */
const HIGHLIGHT = {
  'modules.csv': (r) => (r.unmounted_with_routes === 'TRUE' ? RED : r.has_tests === 'FALSE' ? AMBER : null),
  'routes.csv': (r) => (r.mounted === 'FALSE' ? RED : r.unguarded === 'TRUE' ? AMBER : null),
  'web-api-calls.csv': (r) => (r.status === 'NO_SERVER_ROUTE' ? RED : r.status === 'ROUTE_NOT_MOUNTED' ? RED : null),
  'events.csv': (r) => (r.status === 'LISTENED_NEVER_EMITTED' ? RED : r.status === 'EMITTED_NO_LISTENER' ? AMBER : null),
  'models.csv': (r) => (r.has_businessId === 'FALSE' ? AMBER : r.indexed_on_businessId === 'FALSE' ? RED : null),
  'files.csv': () => null,
  'edges.csv': () => null,
};

const wb = new ExcelJS.Workbook();
wb.creator = 'scripts/system-map/generate.mjs';
wb.created = new Date(0); // deterministic — a rebuild with no data change diffs clean

const readme = wb.addWorksheet('README');
const present = ORDER.filter((f) => readdirSync(DATA).includes(f));

const notes = [
  ['KEYFLOWOS — system map'],
  [],
  ['Generated, not written. Rebuild with:'],
  ['    node scripts/system-map/generate.mjs && node scripts/system-map/build-xlsx.mjs'],
  [],
  ['If a figure here disagrees with a number in a markdown doc, this is the one to trust —'],
  ['it was measured from the working tree at build time. Re-run and diff rather than editing cells.'],
  [],
  ['Sheet', 'Grain', 'What to look for'],
  ['modules', 'one row per server module', 'mounted=FALSE with routes>0 — code that cannot be reached; has_tests=FALSE'],
  ['routes', 'one row per HTTP route', 'unguarded=TRUE on a mounted route — no auth decorator on the handler or its class'],
  ['web-api-calls', 'one row per fetch from the web app', 'status=NO_SERVER_ROUTE — the client calls a path the server does not serve'],
  ['events', 'one row per event name', 'LISTENED_NEVER_EMITTED — a handler that can never run'],
  ['models', 'one row per Prisma model', 'has_businessId=FALSE — outside the tenant boundary; unreferenced=TRUE'],
  ['files', 'one row per source file', 'fan_in=0 with orphan=TRUE — nothing imports it'],
  ['edges', 'one row per relationship', 'the dependency graph: imports, injects, emits, listens, reads/writes-model, http-call'],
  [],
  ['Caveats — this is a static regex extraction, not a type-aware parse:'],
  ['  · DI and event edges are a LOWER bound; anything resolved dynamically is invisible.'],
  ['  · Route paths are literal-only; a computed prefix is recorded as its template text.'],
  ['  · "mounted" follows the static @Module import graph from AppModule.'],
  ['  · reads-model / writes-model are attributed to the file holding the prisma call, so'],
  ['    anything behind a repository wrapper lands on the wrapper, not on its callers.'],
  [],
  ['DO NOT DELETE CODE ON THE STRENGTH OF orphan / fan_in ALONE.'],
  ['fan_in counts STATIC relative imports. It is wrong in BOTH directions:'],
  ['  · It UNDER-reports use. Dynamic import(), barrel re-exports consumed by path, and'],
  ['    Next.js file-convention entry points (page.tsx, route.ts, layout.tsx are entered by'],
  ['    the framework and never imported) all read as orphan=TRUE while being live.'],
  ['  · A name grep is not the fix — it OVER-reports. Checking whether "ActivityItem" is'],
  ['    referenced returns 27 hits in this repo, every one of them a different module:'],
  ['    ActivityItem comes from @/lib/client, ActivityType is declared locally in'],
  ['    money-activity-feed.tsx. Same names, unrelated code.'],
  ['The property is "does anything import this FROM THIS MODULE", which neither check'],
  ['answers on its own. Confirm both ways, then let the typechecker decide.'],
  [],
  ['unguarded=TRUE means no guard DECORATOR was found. It is NOT proof a route is publicly'],
  ['reachable: some handlers enforce auth in their own body (see body_auth_check), and many'],
  ['routes are public by design. apps/server/src/core/auth/public-surface.spec.ts measures'],
  ['closer to the real property AND ratchets — it fails the build when the count goes the'],
  ['wrong way. Where that ledger and this column disagree, believe the ledger.'],
];
notes.forEach((r) => readme.addRow(r));
readme.getRow(1).font = { bold: true, size: 14 };
readme.getRow(9).font = { bold: true };
// The two hard warnings, made visually distinct from the caveat list. Found by
// content rather than by row number, which drifts every time a line is added.
notes.forEach((row, i) => {
  const text = String(row[0] ?? '');
  if (text.startsWith('DO NOT DELETE') || text.startsWith('unguarded=TRUE')) {
    readme.getRow(i + 1).font = { bold: true };
  }
});
readme.getColumn(1).width = 22;
readme.getColumn(2).width = 34;
readme.getColumn(3).width = 90;

for (const file of present) {
  const rows = parseCsv(readFileSync(join(DATA, file), 'utf8'));
  if (!rows.length) continue;
  const headers = rows[0];
  const name = file.replace('.csv', '');
  const ws = wb.addWorksheet(name);

  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(Math.max(h.length + 2, 12), 60),
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const tint = HIGHLIGHT[file] || (() => null);
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    headers.forEach((h, k) => {
      const v = rows[i][k] ?? '';
      obj[h] = /^-?\d+$/.test(v) && v.length < 15 ? Number(v) : v;
    });
    const added = ws.addRow(obj);
    const colour = tint(obj);
    if (colour) added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  console.log(`${String(rows.length - 1).padStart(6)} rows  ${name}`);
}

await wb.xlsx.writeFile(OUT);
console.log(`\nwrote ${OUT}`);

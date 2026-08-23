// Route-existence oracle. Recreated 2026-08-23 as a COMMITTED script — its
// untracked predecessor (apps/server/probe-listen.js) solved the
// path-mismatch bug class (commits 8a740f12, 060f02e7, bdb6b16c) and then
// vanished from disk the same day it was written. Untracked oracles die.
//
// The trick (architecture/VERIFIED_STATE_2026-08-11.md): probe with no auth
// header — **401/403 means the route exists and wants a token, 404 means the
// router has no such route.** The router itself resolves literal-vs-parameter
// ambiguity, which is why this has ~0% false positives where the static
// comparison had 28%. GET only: a POST-only route answers 404 to GET whether
// or not it exists.
//
// Modes:
//   node scripts/os/probe-routes.mjs --base https://keyflowos.com/api [--routes file]
//     Probe an already-running server (production-safe: read-only GETs).
//   node scripts/os/probe-routes.mjs --boot [--routes file]
//     Boot apps/server/dist locally on an ephemeral port first. Requires a
//     built dist and reachable db+redis (PrismaService connects at init) —
//     rebuild before trusting a boot result (measurement rule 6).
//
// Routes file: one path per line, `#` comments. `:param` segments are
// substituted with `probe-1`. Without --routes, only the controls run.
//
// Exit: 0 all probed routes exist and controls behaved; 1 any absent route;
// 2 the oracle itself is blind (a control misbehaved — including 429, which
// means the rate limiter fired before routing and every answer is noise).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const BASE = opt('--base');
const BOOT = args.includes('--boot');
const ROUTES_FILE = opt('--routes');

const CONTROL_PRESENT = { path: '/webhooks/health', expect: 'exists-open' }; // 200 in prod
const CONTROL_ABSENT = { path: '/definitely/not/a/route-xyz', expect: 'absent' }; // probed LAST

function classify(status) {
  if (status === 404) return 'absent';
  if (status === 401 || status === 403) return 'exists-guarded';
  if (status === 429) return 'blind-rate-limited';
  return 'exists-open'; // 200/400/405/409/422/500 all prove routing
}

async function probe(base, path) {
  const url = base.replace(/\/$/, '') + path.replace(/:([A-Za-z_]+)/g, 'probe-1');
  const res = await fetch(url, { redirect: 'manual' }).catch((e) => ({ status: -1, error: e }));
  return { path, status: res.status, verdict: res.status === -1 ? 'unreachable' : classify(res.status) };
}

async function main() {
  let base = BASE;
  let app;
  if (BOOT) {
    const require = createRequire(resolve(ROOT, 'apps/server/package.json'));
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require(resolve(ROOT, 'apps/server/dist/app.module.js'));
    const { configureNestApp } = require(resolve(ROOT, 'apps/server/dist/app-bootstrap.js'));
    app = await NestFactory.create(AppModule, { logger: false });
    configureNestApp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    console.log(`booted dist at ${base}`);
  }
  if (!base) {
    console.error('need --base <url> or --boot');
    process.exit(2);
  }

  const routes = [];
  if (ROUTES_FILE) {
    for (const line of readFileSync(ROUTES_FILE, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) routes.push(t);
    }
  }

  let absent = 0;
  let blind = false;

  const present = await probe(base, CONTROL_PRESENT.path);
  console.log(`CONTROL ${present.path} -> ${present.status} (${present.verdict})`);
  if (present.verdict === 'absent' || present.verdict === 'unreachable' || present.verdict === 'blind-rate-limited') blind = true;

  for (const r of routes) {
    const res = await probe(base, r);
    console.log(`${res.verdict.padEnd(15)} ${res.status} ${res.path}`);
    if (res.verdict === 'absent') absent++;
    if (res.verdict === 'blind-rate-limited' || res.verdict === 'unreachable') blind = true;
  }

  // Absent-control LAST: if the limiter has started firing by now, this
  // returns 429 instead of 404 and converts every earlier answer into noise.
  const absentCtl = await probe(base, CONTROL_ABSENT.path);
  console.log(`CONTROL ${absentCtl.path} -> ${absentCtl.status} (${absentCtl.verdict})`);
  if (absentCtl.verdict !== 'absent') blind = true;

  if (app) await app.close();

  if (blind) {
    console.error('ORACLE BLIND: a control misbehaved — results are not trustworthy');
    process.exit(2);
  }
  if (absent > 0) {
    console.error(`${absent} route(s) absent`);
    process.exit(1);
  }
  console.log('all probed routes exist; controls behaved');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

#!/usr/bin/env node
/**
 * Loopback proof server for the handoff viewer (KF-META-HANDOFF-MONITOR-001).
 *
 * Boots ONLY the handoff route from the compiled server (apps/server/dist):
 * the real HandoffMonitorController, HandoffMonitorService (with its default
 * native-import loader), AuthMiddleware, AuthGuard and AdminGuard. No other
 * module, no database, no Redis, no scheduler, no provider. Identity comes
 * from HMAC admin tokens minted here with a per-run random secret; the
 * Supabase and user-table lookups are stubbed to "unknown". Data comes from a
 * fixture file through the collector's fixture transport. Binds 127.0.0.1.
 *
 * Usage (after `tsc` has built apps/server/dist):
 *   node apps/server/test/handoff-monitor-loopback.cjs --fixture=<file> [--port=3101]
 *        [--web-origin=http://127.0.0.1:5000] [--tokens-out=<file>] [--self-test]
 *
 * --self-test makes the requests itself, prints the results and exits:
 * 0 when every expectation holds, 1 otherwise.
 */
require('reflect-metadata');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.NODE_ENV === 'production') {
  console.error('handoff loopback: refused under NODE_ENV=production');
  process.exit(2);
}

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`) || a === `--${name}`);
  if (!hit) return fallback;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const fixture = arg('fixture');
if (typeof fixture !== 'string') {
  console.error('handoff loopback: --fixture=<file> is required');
  process.exit(2);
}
const port = Number(arg('port', '3101'));
const webOrigin = String(arg('web-origin', 'http://127.0.0.1:5000'));
const dist = path.resolve(__dirname, '..', 'dist');

// Several fixtures (comma-separated) are merged into one temporary file.
function fixtureFile(spec) {
  const files = spec.split(',').map((f) => path.resolve(f));
  if (files.length === 1) return files[0];
  const merged = { issue: { comments: 0 }, comments: [], pulls: {} };
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    merged.comments.push(...data.comments);
    Object.assign(merged.pulls, data.pulls || {});
  }
  merged.issue.comments = merged.comments.length;
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kf-handoff-'));
  const out = path.join(dir, 'fixture.json');
  fs.writeFileSync(out, JSON.stringify(merged));
  return out;
}
const fixturePath = fixtureFile(fixture);

// The secret exists only for this process; nothing it signs is valid elsewhere.
process.env.ADMIN_JWT_SECRET = crypto.randomBytes(32).toString('hex');

const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { HandoffMonitorController } = require(path.join(dist, 'modules/admin-platform/handoff-monitor.controller'));
const { HandoffMonitorService } = require(path.join(dist, 'modules/admin-platform/handoff-monitor.service'));
const { AuthMiddleware } = require(path.join(dist, 'core/auth/auth.middleware'));
const { SupabaseAuthService } = require(path.join(dist, 'core/auth/supabase-auth.service'));
const { PrismaService } = require(path.join(dist, 'core/prisma/prisma.service'));
const { REDIS_CLIENT } = require(path.join(dist, 'core/redis/redis.constants'));
const { buildAdminToken } = require(path.join(dist, 'core/auth/admin-token.util'));

class LoopbackModule {
  configure(consumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
Module({
  controllers: [HandoffMonitorController],
  providers: [
    {
      provide: HandoffMonitorService,
      useFactory: () => new HandoffMonitorService({ KEYFLOW_HANDOFF_MONITOR_FIXTURE: fixturePath, NODE_ENV: 'development' }),
    },
    { provide: SupabaseAuthService, useValue: { getUserFromToken: async () => null } },
    { provide: PrismaService, useValue: { client: { user: { findUnique: async () => null } } } },
    { provide: REDIS_CLIENT, useValue: { get: async () => null } },
    AuthMiddleware,
  ],
})(LoopbackModule);

const mint = (role) => buildAdminToken({ id: `loopback-${role.toLowerCase()}`, email: `${role.toLowerCase()}@loopback.test`, role }, process.env.ADMIN_JWT_SECRET);

async function selfTest(base, tokens) {
  const route = `${base}/api/admin/mission-control/handoffs`;
  const get = async (url, token) => {
    const res = await fetch(url, { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body, cacheControl: res.headers.get('cache-control') };
  };
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

  const admin = await get(`${route}?task=6229439023`, tokens.superAdmin);
  const task = admin.body?.view?.task;
  check('SUPER_ADMIN 200', admin.status === 200, admin.status);
  check('no-store', admin.cacheControl === 'no-store', admin.cacheControl);
  check('loaded through the default native importer (FIXTURE mode)', admin.body?.mode === 'FIXTURE', admin.body?.mode);
  check('delivery DECISION_RECORDED', task?.delivery?.stage === 'DECISION_RECORDED', task?.delivery?.stage);
  check('review CHANGES_REQUIRED, 6 findings', task?.review?.outcome === 'CHANGES_REQUIRED' && task?.review?.unresolved_substantive_findings === 6, task?.review);
  check('merge NOT_GRANTED', task?.merge_authority?.status === 'NOT_GRANTED', task?.merge_authority);
  check('worker UNKNOWN', admin.body?.view?.worker?.status === 'UNKNOWN', admin.body?.view?.worker?.status);
  for (const [name, token, expected] of [['no credential', null, 401], ['admin token role USER', tokens.user, 403], ['bad token', 'x.y.z', 401]]) {
    const res = await get(route, token);
    check(`${name} -> ${expected} after warm cache`, res.status === expected && !JSON.stringify(res.body).includes('CG-DIR-IRP177'), res.status);
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${typeof r.detail === 'object' ? JSON.stringify(r.detail) : r.detail}`);
  return results.every((r) => r.ok);
}

(async () => {
  const app = await NestFactory.create(LoopbackModule, { logger: ['error', 'warn'] });
  app.enableCors({ origin: webOrigin, methods: ['GET'], allowedHeaders: ['Authorization', 'Content-Type'] });
  await app.listen(port, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const tokens = { superAdmin: mint('SUPER_ADMIN'), user: mint('USER') };
  const out = arg('tokens-out');
  if (typeof out === 'string') fs.writeFileSync(out, JSON.stringify({ base, ...tokens }));
  console.log(`handoff loopback listening on ${base} (fixture ${fixture}, web origin ${webOrigin})`);
  if (arg('self-test')) {
    const ok = await selfTest(base, tokens);
    await app.close();
    process.exit(ok ? 0 : 1);
  }
})().catch((err) => {
  console.error(`handoff loopback failed: ${err && err.message}`);
  process.exit(1);
});

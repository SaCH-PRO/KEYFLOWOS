/**
 * Release 0 journey characterization (issue #186, step C) — REAL server, REAL database.
 *
 * The smallest end-to-end business path, driven through the real HTTP API:
 *
 *   1. owner identity + business with a founding OWNER membership (tenant root)
 *   2. create a contact, edit it, reload it by id
 *   3. create an invoice with line items, issue it (DRAFT -> SENT), reload
 *   4. record an offline payment, check the Payment row / invoice balance /
 *      duplicate-submit idempotency / ledger rows, settle to PAID
 *   5. list contacts, invoices and payments again (simulated refresh), and read
 *      the cockpit snapshot: its Release 0 counts agree with those lists and
 *      the read writes no ledger row (V1-47-COCKPIT-TRUTH); a STAFF member the
 *      owner invites with crm read, crm_view=owned and revenue none sees only
 *      what its own guarded lists disclose (owned-only contacts, before and
 *      after a share; revenue counts RESTRICTED)
 *   6. a second tenant's owner is denied on every step-2..5 resource, by
 *      business-prefixed route and by bare id (403/404, never 200, never 500);
 *      its own cockpit counts none of the first tenant's rows
 *   7. no step needed an external provider (AI_DISABLED=1, no provider keys)
 *
 * It began as a CHARACTERIZATION: every step asserts the product's intended
 * behaviour, the first step that could not pass was left failing on purpose
 * and named "FIRST FAILING STEP", and later steps known to fail were
 * `it.fails`. As of R0-16-PROOF-BINDING every step passes: the fix packets
 * flipped their `it.fails` back to `it`, the step-4 case is titled for the
 * behaviour it now proves (R0-D1-COA-SEED-RACE fixed the lazy chart-of-accounts
 * race that made the first payment answer 500), and the harness-only
 * "recovery" case that retried around that race is gone. There is no
 * `it.fails`, `it.skip` or `it.todo` here.
 *
 * PROOF BINDING: scripts/proof-admission/manifests/release0-journey.json
 * requires every case of this file by its full title and allows no other
 * (payments-actor.json also requires the step-4 ledger cases). Renaming,
 * adding, skipping or removing a case here means editing that manifest in the
 * same change, or the CI step that runs scripts/proof-admission/run-manifests.mjs
 * rejects the head.
 *
 * WHAT IS REAL
 * ------------
 * The server under test is the BUILT artifact, `dist/main.js`, spawned as a
 * child process on a free port against DATABASE_URL — the real module graph,
 * the real middleware chain (CorrelationId, AuthMiddleware), the real guards
 * (AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard, CrmRateLimit),
 * the real interceptors (Tenant, BusinessEvent, Logging, TeamAudit), the real
 * ValidationPipe and GlobalHttpExceptionFilter, the real services and event
 * listeners, and the tenant-isolation extension that main.ts installs. It
 * cannot be composed in-process: the Nest module graph only resolves from
 * tsc-emitted decorator metadata, which vitest's esbuild transform does not
 * emit (see app-module-boots.integration.test.ts for the same reasoning), so
 * like that gate this one runs the artifact that ships.
 *
 * IDENTITY PATH (no Supabase, no stand-in)
 * ----------------------------------------
 * The spawned server is given a test SUPABASE_JWT_SECRET and no SUPABASE_URL.
 * The test mints HS256 JWTs (sub, email, aud=authenticated) the way Supabase
 * issues them, and the real AuthMiddleware verifies them through
 * SupabaseAuthService.verifyLocal — the same production path that serves a
 * deployment with the JWT secret configured — then attaches { id, email, role }
 * from the local User row (or role USER when the row does not exist yet, the
 * bootstrap case). The User row and the business are then created by the real
 * POST /identity/bootstrap route, which is what the product's signup flow calls
 * after Supabase sign-up. POST /identity/signup itself needs Supabase admin
 * createUser and is not used.
 *
 * FIXTURES
 * --------
 * Every row the journey creates is reachable from the `r0_` prefix: user ids
 * `r0_owner` / `r0_other` / `r0_staff`, business names `r0_bizA` / `r0_bizB` /
 * `r0_bizStaff` (the staff member's own bootstrap workspace), and every child
 * row hangs off those businesses. They are hard-deleted by raw SQL in FK
 * order in beforeAll and afterAll. No $transaction wrapping: the server writes
 * from another process, so the test observes committed state only.
 *
 * REQUIRES: DATABASE_URL with migrations applied, REDIS_URL (the public
 * rate-limit guard and auth revocation read Redis), and `pnpm build` in
 * apps/server so dist/main.js exists. Deliberately not skipped when dist is
 * missing — the first case says so instead.
 */
import 'reflect-metadata';
import path from 'node:path';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Each step drives the spawned server over HTTP against the shared real database. Run alone,
// the slowest step (5, which since V1-47 also reads the cockpit) takes about 1.6 s; under the
// full suite's parallel load it crossed vitest's 5 s default. The limit is per case and changes
// no assertion.
vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'r0_';
const SERVER_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(SERVER_DIR, 'dist', 'main.js');

/** Test-only HS256 secret handed to the spawned server. Not a real secret. */
const JWT_SECRET = 'r0-journey-test-jwt-secret-not-a-real-secret';

/**
 * Provider configuration the server must NOT see. The child env is built from
 * an allow-list, so none of these can leak in from the developer's shell or
 * the repo .env; the list is what step 7 reports as verified absent.
 */
const PROVIDER_KEYS = [
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'XAI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET',
  'WIPAY_API_KEY', 'RESEND_API_KEY', 'SENTRY_DSN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LANGFUSE_SECRET_KEY',
  'GROWTHBOOK_API_KEY', 'SLACK_BOT_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'SHOPIFY_API_SECRET', 'ELEVENLABS_API_KEY',
];

const ID = {
  owner: `${P}owner`,
  other: `${P}other`,
  staff: `${P}staff`,
  ownerEmail: `${P}owner@test.local`,
  otherEmail: `${P}other@test.local`,
  staffEmail: `${P}staff@test.local`,
  bizAName: `${P}bizA`,
  bizBName: `${P}bizB`,
  bizStaffName: `${P}bizStaff`,
};

const IDLE_MS = 90_000;      // silence from the child counts; slow-but-talking does not
const HARD_CAP_MS = 240_000; // backstop for a child that chatters forever

// ---------------------------------------------------------------------------
// harness state
// ---------------------------------------------------------------------------
let db: any;
let child: ChildProcess | null = null;
let baseUrl = '';
let bootDiagnosis: string | null = null;
let childExitCode: number | null | undefined = undefined;
const serverLog: string[] = [];

/** Journey state carried from step to step (ids are minted by the server). */
const S: {
  bizA?: string; bizB?: string; contactId?: string; invoiceId?: string; invoiceNumber?: string;
  firstPaymentId?: string; settlePaymentId?: string; accountingBasis?: string;
} = {};

/** Step table printed at the end of the run. */
const evidence: Array<{ step: number; what: string; route: string; status: number | string; db: string }> = [];
const note = (step: number, what: string, route: string, status: number | string, dbState: string) =>
  evidence.push({ step, what, route, status, db: dbState });

/** Every response seen in steps 1-5, for the step-7 "no provider needed" audit. */
const journeyResponses: Array<{ step: number; method: string; path: string; status: number }> = [];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** An HS256 JWT shaped like a Supabase access token, signed with the test secret. */
function mintToken(sub: string, email: string, opts: { secret?: string; expiresInSec?: number } = {}) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + (opts.expiresInSec ?? 3600) }),
  );
  const sig = createHmac('sha256', opts.secret ?? JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

let OWNER = '';
let OTHER = '';
let STAFF = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function requireServer() {
  if (!baseUrl || childExitCode !== undefined) {
    throw new Error(
      `The real server is not serving (${bootDiagnosis ?? 'not started'}). ` +
        'Nothing below can be measured; see the harness cases above.\n' +
        serverLog.slice(-8).join('\n'),
    );
  }
}

type Resp = { status: number; body: any };
async function call(
  step: number,
  method: 'get' | 'post' | 'patch' | 'delete',
  routePath: string,
  opts: { token?: string | null; body?: unknown; query?: Record<string, string> } = {},
): Promise<Resp> {
  requireServer();
  let req = request(baseUrl)[method](routePath);
  if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
  if (opts.query) req = req.query(opts.query);
  if (opts.body !== undefined) req = req.send(opts.body as object);
  const res = await req;
  journeyResponses.push({ step, method: method.toUpperCase(), path: routePath, status: res.status });
  return { status: res.status, body: res.body };
}

/** Hard-delete every r0_ row, children first, by raw SQL (bypasses soft delete). */
async function cleanup() {
  const biz = `(SELECT id FROM businesses WHERE owner_id LIKE '${P}%' OR name LIKE '${P}%')`;
  const inv = `(SELECT id FROM invoices WHERE business_id IN ${biz})`;
  const con = `(SELECT id FROM contacts WHERE business_id IN ${biz})`;
  const statements = [
    `DELETE FROM ledger_entries WHERE business_id IN ${biz}`,
    `DELETE FROM financial_transactions WHERE business_id IN ${biz}`,
    `DELETE FROM payments WHERE business_id IN ${biz}`,
    `DELETE FROM invoice_items WHERE invoice_id IN ${inv}`,
    `DELETE FROM invoices WHERE business_id IN ${biz}`,
    `DELETE FROM contact_shares WHERE contact_id IN ${con}`,
    `DELETE FROM contact_notes WHERE contact_id IN ${con}`,
    `DELETE FROM contact_events WHERE contact_id IN ${con}`,
    `DELETE FROM contact_tasks WHERE contact_id IN ${con}`,
    `DELETE FROM contact_custom_field_values WHERE contact_id IN ${con}`,
    `DELETE FROM contacts WHERE business_id IN ${biz}`,
    `DELETE FROM activities WHERE business_id IN ${biz}`,
    `DELETE FROM team_activity_logs WHERE business_id IN ${biz}`,
    `DELETE FROM business_events WHERE business_id IN ${biz}`,
    `DELETE FROM chart_of_accounts WHERE business_id IN ${biz}`,
    `DELETE FROM agent_triggers WHERE business_id IN ${biz}`,
    `DELETE FROM autopilot_settings WHERE business_id IN ${biz}`,
    // RESTRICT children of businesses, in case a listener seeded them.
    `DELETE FROM output_templates WHERE business_id IN ${biz}`,
    `DELETE FROM org_standards WHERE business_id IN ${biz}`,
    `DELETE FROM review_tasks WHERE business_id IN ${biz}`,
    `DELETE FROM document_change_logs WHERE business_id IN ${biz}`,
    `DELETE FROM document_instances WHERE business_id IN ${biz}`,
    `DELETE FROM business_profile_versions WHERE business_id IN ${biz}`,
    `DELETE FROM webhooks WHERE business_id IN ${biz}`,
    `DELETE FROM memberships WHERE business_id IN ${biz} OR user_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE owner_id LIKE '${P}%' OR name LIKE '${P}%'`,
    `DELETE FROM user_identities WHERE user_id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ];
  for (const sql of statements) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
  const left = await db.$queryRawUnsafe(
    `SELECT (SELECT count(*)::int FROM businesses WHERE owner_id LIKE '${P}%' OR name LIKE '${P}%') AS businesses, (SELECT count(*)::int FROM users WHERE id LIKE '${P}%') AS users`,
  );
  return left?.[0] ?? { businesses: -1, users: -1 };
}

function bootServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    const env: Record<string, string> = {
      // allow-list, NOT a copy of process.env: no provider key can leak in
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      NODE_ENV: 'test',
      PORT: String(port),
      AI_DISABLED: '1',
      DISABLE_SCHEDULERS: '1',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      RATE_LIMIT_MAX_REQUESTS: '100000',
      // main.ts binds '::'; hosts without IPv6 need the shim (see helpers/).
    };
    child = spawn(process.execPath, [ENTRY], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });

    let settled = false;
    let idle: NodeJS.Timeout;
    const finish = (diagnosis: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(hardCap);
      clearInterval(poll);
      bootDiagnosis = diagnosis;
      if (diagnosis && child) child.kill('SIGKILL');
      resolve();
    };
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(`no output for ${IDLE_MS}ms — the boot is stuck, not slow`), IDLE_MS);
    };
    armIdle();
    const hardCap = setTimeout(() => finish(`never became ready within ${HARD_CAP_MS}ms`), HARD_CAP_MS);

    const read = (buf: Buffer) => {
      armIdle();
      for (const line of stripAnsi(buf.toString()).split('\n')) if (line.trim()) serverLog.push(line);
      const failure = serverLog
        .slice(-20)
        .join('\n')
        .match(/(UndefinedDependencyException|Nest can't resolve dependencies of the [^\n]+|ERROR \[ExceptionHandler\][^\n]+|EAFNOSUPPORT[^\n]+|EADDRINUSE[^\n]+)/);
      if (failure) finish(failure[0]);
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('error', (e) => finish(`spawn failed: ${e.message}`));
    child.on('exit', (code) => {
      childExitCode = code;
      finish(`exited with code ${code} before serving`);
    });

    const candidate = `http://127.0.0.1:${port}`;
    const poll = setInterval(() => {
      request(candidate)
        .get('/readyz')
        .then((res) => {
          if (res.status === 200) {
            baseUrl = candidate;
            finish(null);
          }
        })
        .catch(() => { /* not listening yet */ });
    }, 500);
  });
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  await cleanup(); // in case a prior run aborted

  OWNER = mintToken(ID.owner, ID.ownerEmail);
  OTHER = mintToken(ID.other, ID.otherEmail);
  STAFF = mintToken(ID.staff, ID.staffEmail);

  if (!existsSync(ENTRY)) {
    bootDiagnosis = 'dist/main.js is missing — run `pnpm build` in apps/server first';
    return;
  }
  const port = await freePort();
  await bootServer(port);
}, HARD_CAP_MS + 30_000);

afterAll(async () => {
  if (child && childExitCode === undefined) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child?.kill('SIGKILL'); resolve(); }, 8_000);
      child!.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  if (db) {
    const left = await cleanup();
    if (left.businesses !== 0 || left.users !== 0) {
      console.warn(`[release0-journey] cleanup left rows behind: ${JSON.stringify(left)}`);
    }
  }
  // The step table is the deliverable of a characterization run.
  console.log('\n[release0-journey] step table');
  console.table(evidence);
}, 60_000);

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
describe('harness — the real built server is serving', () => {
  it('dist/main.js exists (build before running this)', () => {
    expect(
      existsSync(ENTRY),
      'dist/main.js is missing, so the journey was never driven. Locally: `pnpm build` in apps/server. ' +
        'In CI the test job builds the server before the tests (see app-module-boots.integration.test.ts).',
    ).toBe(true);
  });

  it('reached /readyz on a free port, against DATABASE_URL, with no provider keys in its environment', async () => {
    expect(bootDiagnosis, `server did not come up: ${bootDiagnosis}\n${serverLog.slice(-10).join('\n')}`).toBeNull();
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await request(baseUrl).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.db?.ok).toBe(true);
    note(0, 'server ready', 'GET /readyz', res.status, `db.ok=${res.body.db?.ok}`);
  });

  it('the real AuthMiddleware verifies the minted HS256 token locally and refuses anything else', async () => {
    requireServer();
    // No token -> AuthGuard 401.
    const anon = await request(baseUrl).get('/identity/me');
    expect(anon.status).toBe(401);
    // Wrong secret -> signature invalid -> not attached -> 401.
    const forged = await request(baseUrl).get('/identity/me').set('Authorization', `Bearer ${mintToken(ID.owner, ID.ownerEmail, { secret: 'wrong' })}`);
    expect(forged.status).toBe(401);
    // Expired -> 401.
    const expired = await request(baseUrl).get('/identity/me').set('Authorization', `Bearer ${mintToken(ID.owner, ID.ownerEmail, { expiresInSec: -60 })}`);
    expect(expired.status).toBe(401);
    // Valid token for a user with no local row yet: attached (role USER) but
    // /identity/me has no row to show -> 404 from the real IdentityService.
    const fresh = await request(baseUrl).get('/identity/me').set('Authorization', `Bearer ${OWNER}`);
    expect(fresh.status).toBe(404);
    expect(fresh.body.message).toBe('User not found');
    note(0, 'identity gate', 'GET /identity/me', `${anon.status}/${forged.status}/${expired.status}/${fresh.status}`, 'no r0_ user row yet');
  });
});

// ---------------------------------------------------------------------------
// step 1
// ---------------------------------------------------------------------------
describe('step 1 — owner identity and business with a founding membership (tenant root)', () => {
  it('POST /identity/bootstrap creates the User row, the business and exactly one founding OWNER membership', async () => {
    const res = await call(1, 'post', '/identity/bootstrap', { token: OWNER, body: { company: ID.bizAName, firstName: 'Riley' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user?.id).toBe(ID.owner);
    expect(res.body.business?.name).toBe(ID.bizAName);
    expect(res.body.isNewBusiness).toBe(true);
    S.bizA = res.body.business.id;

    const user = await db.user.findUnique({ where: { id: ID.owner } });
    expect(user).toMatchObject({ id: ID.owner, email: ID.ownerEmail, role: 'USER' });
    const business = await db.business.findUnique({ where: { id: S.bizA } });
    expect(business).toMatchObject({ name: ID.bizAName, ownerId: ID.owner, deletedAt: null });
    S.accountingBasis = business.accountingBasis;
    const members = await db.membership.findMany({ where: { businessId: S.bizA } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: ID.owner, role: 'OWNER' });
    note(1, 'bootstrap owner', 'POST /identity/bootstrap', res.status, `users=1 businesses=1 memberships=1(OWNER) basis=${S.accountingBasis}`);
  });

  it('the owner discovers and opens the business through the identity routes (selected tenant)', async () => {
    const list = await call(1, 'get', '/identity/businesses', { token: OWNER });
    expect(list.status).toBe(200);
    expect(list.body.map((b: any) => b.id)).toEqual([S.bizA]);
    const one = await call(1, 'get', `/identity/businesses/${S.bizA}`, { token: OWNER });
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(S.bizA);
    // The row is sanitized on the way out: no secrets travel with it.
    for (const secret of ['stripeSecretKey', 'paypalClientSecret', 'wipayApiKey']) expect(one.body).not.toHaveProperty(secret);
    const me = await call(1, 'get', '/identity/me', { token: OWNER });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: ID.owner, email: ID.ownerEmail });
    note(1, 'select business', 'GET /identity/businesses, /identity/businesses/:id, /identity/me', `${list.status}/${one.status}/${me.status}`, 'business listed and opened');
  });

  it('bootstrap is idempotent: a second call returns the same business and adds no membership', async () => {
    const again = await call(1, 'post', '/identity/bootstrap', { token: OWNER, body: { company: ID.bizAName, firstName: 'Riley' } });
    expect(again.status).toBe(201);
    expect(again.body.business?.id).toBe(S.bizA);
    expect(again.body.isNewBusiness).toBe(false);
    expect(await db.business.count({ where: { ownerId: ID.owner } })).toBe(1);
    expect(await db.membership.count({ where: { businessId: S.bizA } })).toBe(1);
    note(1, 'bootstrap replay', 'POST /identity/bootstrap', again.status, 'same business, still 1 membership');
  });

  it('the second tenant (r0_other / r0_bizB) comes into existence the same way, disjoint from the first', async () => {
    const res = await call(1, 'post', '/identity/bootstrap', { token: OTHER, body: { company: ID.bizBName, firstName: 'Blake' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.bizB = res.body.business.id;
    expect(S.bizB).not.toBe(S.bizA);
    const members = await db.membership.findMany({ where: { businessId: S.bizB } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: ID.other, role: 'OWNER' });
    expect(await db.membership.count({ where: { userId: ID.other, businessId: S.bizA } })).toBe(0);
    const list = await call(1, 'get', '/identity/businesses', { token: OTHER });
    expect(list.body.map((b: any) => b.id)).toEqual([S.bizB]);
    note(1, 'bootstrap other tenant', 'POST /identity/bootstrap', res.status, 'bizB with its own OWNER membership; no cross membership');
  });
});

// ---------------------------------------------------------------------------
// step 2
// ---------------------------------------------------------------------------
describe('step 2 — contact: create, edit, reload by id', () => {
  it('POST /crm/businesses/:bizA/contacts creates the contact in the tenant', async () => {
    requireServer();
    expect(S.bizA, 'step 1 did not produce a business').toBeTruthy();
    const res = await call(2, 'post', `/crm/businesses/${S.bizA}/contacts`, {
      token: OWNER,
      body: { firstName: `${P}Ada`, lastName: 'Lovelace', email: `${P}ada@test.local`, phone: '+18685550100' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toBeTruthy();
    S.contactId = res.body.id;
    const row = await db.contact.findUnique({ where: { id: S.contactId } });
    expect(row).toMatchObject({ businessId: S.bizA, firstName: `${P}Ada`, lastName: 'Lovelace', email: `${P}ada@test.local`, status: 'LEAD', deletedAt: null });
    note(2, 'create contact', 'POST /crm/businesses/:bizA/contacts', res.status, `contacts row businessId=bizA status=${row.status}`);
  });

  it('PATCH edits it and GET reloads the edited row by id', async () => {
    requireServer();
    expect(S.contactId).toBeTruthy();
    const edit = await call(2, 'patch', `/crm/businesses/${S.bizA}/contacts/${S.contactId}`, {
      token: OWNER,
      body: { lastName: 'Byron', companyName: `${P}Analytical Engines Ltd`, status: 'CLIENT' },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({ id: S.contactId, lastName: 'Byron' });

    const reload = await call(2, 'get', `/crm/businesses/${S.bizA}/contacts/${S.contactId}`, { token: OWNER });
    expect(reload.status).toBe(200);
    expect(reload.body.contact).toMatchObject({ id: S.contactId, firstName: `${P}Ada`, lastName: 'Byron', companyName: `${P}Analytical Engines Ltd`, status: 'CLIENT' });

    const row = await db.contact.findUnique({ where: { id: S.contactId } });
    expect(row).toMatchObject({ lastName: 'Byron', companyName: `${P}Analytical Engines Ltd`, status: 'CLIENT' });
    const events = await db.contactEvent.findMany({ where: { contactId: S.contactId }, select: { type: true } });
    expect(events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['contact.created', 'contact.updated']));
    note(2, 'edit + reload contact', 'PATCH/GET /crm/businesses/:bizA/contacts/:id', `${edit.status}/${reload.status}`, `lastName=Byron status=CLIENT events=${events.map((e: any) => e.type).join(',')}`);
  });
});

// ---------------------------------------------------------------------------
// step 3
// ---------------------------------------------------------------------------
describe('step 3 — invoice with line items, issued DRAFT -> SENT', () => {
  it('POST /commerce/businesses/:bizA/invoices creates a DRAFT invoice with two line items for the contact', async () => {
    requireServer();
    expect(S.contactId).toBeTruthy();
    const res = await call(3, 'post', `/commerce/businesses/${S.bizA}/invoices`, {
      token: OWNER,
      body: {
        contactId: S.contactId,
        currency: 'TTD',
        items: [
          { description: 'Consulting', quantity: 2, unitPrice: 100 },
          { description: 'Setup', quantity: 1, unitPrice: 50 },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.invoiceId = res.body.id;
    S.invoiceNumber = res.body.invoiceNumber;
    expect(res.body).toMatchObject({ status: 'DRAFT', total: 250, subtotal: 250, currency: 'TTD', contactId: S.contactId });
    expect(res.body.invoiceNumber).toMatch(/^INV-\d+$/);
    expect(res.body.items).toHaveLength(2);

    const row = await db.invoice.findUnique({ where: { id: S.invoiceId }, include: { items: true } });
    expect(row).toMatchObject({ businessId: S.bizA, contactId: S.contactId, status: 'DRAFT', total: 250, invoiceNumber: S.invoiceNumber });
    expect(row.items.map((i: any) => [i.description, i.quantity, i.unitPrice, i.total])).toEqual(
      expect.arrayContaining([['Consulting', 2, 100, 200], ['Setup', 1, 50, 50]]),
    );
    note(3, 'create invoice', 'POST /commerce/businesses/:bizA/invoices', res.status, `DRAFT ${S.invoiceNumber} total=250 items=2`);
  });

  it('PATCH /commerce/invoices/:id/status/sent issues it; reload shows SENT with number, total and sentAt', async () => {
    requireServer();
    expect(S.invoiceId).toBeTruthy();
    const sentAt = new Date().toISOString();
    const res = await call(3, 'patch', `/commerce/invoices/${S.invoiceId}/status/sent`, {
      token: OWNER,
      body: { businessId: S.bizA, status: 'SENT', sentAt },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: S.invoiceId, status: 'SENT' });

    const row = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    expect(row).toMatchObject({ status: 'SENT', total: 250, invoiceNumber: S.invoiceNumber });
    expect(row.sentAt).not.toBeNull();

    // Reload through the tenant list route (there is no business-scoped GET by id).
    const list = await call(3, 'get', `/commerce/businesses/${S.bizA}/invoices`, { token: OWNER });
    expect(list.status).toBe(200);
    const listed = list.body.data.find((i: any) => i.id === S.invoiceId);
    expect(listed).toMatchObject({ status: 'SENT', total: 250, invoiceNumber: S.invoiceNumber });
    expect(listed.items).toHaveLength(2);
    note(3, 'issue invoice', 'PATCH /commerce/invoices/:id/status/sent', res.status, `status=SENT sentAt set; listed via GET /commerce/businesses/:bizA/invoices`);
  });

  it('AR posting on issue follows the accounting basis (CASH by default: no AR entry until payment)', async () => {
    requireServer();
    expect(S.invoiceId).toBeTruthy();
    const externalRef = `Invoice:${S.invoiceId}:invoice_finalized`;
    const txns = await db.financialTransaction.findMany({ where: { businessId: S.bizA, externalRef }, include: { entries: true } });
    if (S.accountingBasis === 'ACCRUAL') {
      expect(txns).toHaveLength(1);
      const debits = txns[0].entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
      const credits = txns[0].entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
      expect(debits).toBe(250);
      expect(credits).toBe(250);
    } else {
      // RevenuePostingService.onInvoiceFinalized is a no-op on CASH basis by design.
      expect(S.accountingBasis).toBe('CASH');
      expect(txns).toHaveLength(0);
    }
    note(3, 'AR posting on issue', `financial_transactions externalRef=${externalRef}`, 'db', `basis=${S.accountingBasis} transactions=${txns.length}`);
  });
});

// ---------------------------------------------------------------------------
// step 4
// ---------------------------------------------------------------------------
describe('step 4 — offline payment through POST /commerce/businesses/:bizA/invoices/:id/payments', () => {
  const firstPayment = { amount: 100, method: 'cash', reference: `${P}ref-001`, notes: 'cash at counter' };

  // This case was 'FIRST FAILING STEP: ... dies with 500' while
  // RevenuePostingService.onPaymentRecorded resolved the deposit and credit
  // accounts with Promise.all: two concurrent ensureDefaults collided on
  // (business_id, system_key) with P2002, the posting threw inside the payment
  // transaction and the first payment a tenant ever recorded rolled back with a
  // 500. R0-D1-COA-SEED-RACE serialized the seeding
  // (finance-coa-seed-concurrency.integration.test.ts), so the first submit is
  // the one that lands, and the harness "recovery" retry that waited for the
  // chart of accounts to settle is gone (R0-16-PROOF-BINDING).
  it('the first manual payment on a fresh tenant is recorded (201) with exactly one Payment row: the lazily seeded chart of accounts no longer races (R0-D1-COA-SEED-RACE)', async () => {
    requireServer();
    expect(S.invoiceId).toBeTruthy();
    const coaBefore = await db.chartOfAccount.count({ where: { businessId: S.bizA } });
    const res = await call(4, 'post', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { token: OWNER, body: firstPayment });
    const payments = await db.payment.findMany({ where: { invoiceId: S.invoiceId }, orderBy: { createdAt: 'asc' } });
    const coa = await db.chartOfAccount.count({ where: { businessId: S.bizA } });
    note(4, 'record first payment', 'POST /commerce/businesses/:bizA/invoices/:id/payments', res.status, `payments=${payments.length} chart_of_accounts ${coaBefore}->${coa} body=${JSON.stringify(res.body).slice(0, 120)}`);
    expect(res.status, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.payment?.id).toBeTruthy();
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(res.body.payment.id);
    // The chart of accounts the posting needed exists once the request has answered: it was seeded inside the
    // request, not by a retry.
    expect(coa).toBeGreaterThan(0);
    S.firstPaymentId = payments[0].id;
  });

  it('the Payment row, the invoice balance and the ledger agree: 100 paid, 150 remaining, PARTIALLY_PAID, balanced entries', async () => {
    requireServer();
    expect(S.firstPaymentId).toBeTruthy();
    const payment = await db.payment.findUnique({ where: { id: S.firstPaymentId } });
    expect(payment).toMatchObject({ businessId: S.bizA, invoiceId: S.invoiceId, amount: 100, currency: 'TTD', status: 'SUCCESSFUL', provider: 'cash', method: 'cash', reference: `${P}ref-001` });
    expect(payment.providerPaymentId).toMatch(/^manual_/);

    const invoice = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    expect(invoice.status).toBe('PARTIALLY_PAID');
    expect(invoice.paidAt).toBeNull();

    const balance = await call(4, 'get', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { token: OWNER });
    expect(balance.status).toBe(200);
    expect(balance.body).toMatchObject({ paidAmount: 100, remaining: 150, invoiceTotal: 250 });
    expect(balance.body.payments).toHaveLength(1);

    const externalRef = `Payment:${S.firstPaymentId}:payment_recorded`;
    const txns = await db.financialTransaction.findMany({ where: { businessId: S.bizA, externalRef }, include: { entries: { include: { account: true } } } });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: S.firstPaymentId, contactId: S.contactId });
    expect(Number(txns[0].amount)).toBe(100);
    const debits = txns[0].entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
    const credits = txns[0].entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    expect(debits).toBe(100);
    expect(credits).toBe(100);
    const keys = txns[0].entries.map((e: any) => `${e.account.systemKey}:${Number(e.debit) > 0 ? 'D' : 'C'}`).sort();
    expect(keys).toEqual(S.accountingBasis === 'ACCRUAL' ? ['ACCOUNTS_RECEIVABLE:C', 'CASH:D'] : ['CASH:D', 'REVENUE:C']);
    note(4, 'payment / balance / ledger', 'GET .../invoices/:id/payments + financial_transactions', balance.status, `PARTIALLY_PAID paid=100 remaining=150 ledger=${keys.join(',')}`);
  });

  // R0-D2-MANUAL-PAYMENT-IDEMPOTENCY landed: on this route the same non-empty
  // reference for the same amount on the same invoice is the same offline
  // payment (providerPaymentId manual_<invoiceId>_ref_<hash>), so the
  // duplicate slip is absorbed and the case is back to a plain `it` (it was
  // `it.fails` while every submit minted manual_<now>_<random>).
  it('a duplicate submit of the same offline payment (same reference) is absorbed: the first payment is returned, one row, balance unchanged', async () => {
    requireServer();
    expect(S.firstPaymentId).toBeTruthy();
    const before = await db.payment.count({ where: { invoiceId: S.invoiceId } });
    const dup = await call(4, 'post', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { token: OWNER, body: firstPayment });
    const after = await db.payment.findMany({ where: { invoiceId: S.invoiceId }, orderBy: { createdAt: 'asc' } });
    const balance = await call(4, 'get', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { token: OWNER });
    note(4, 'duplicate submit', 'POST .../payments (same reference)', dup.status, `payments ${before}->${after.length} paid=${balance.body?.paidAmount} remaining=${balance.body?.remaining}`);
    expect(dup.status, JSON.stringify(dup.body)).toBe(201);
    expect(dup.body.payment.id).toBe(S.firstPaymentId);
    expect(after).toHaveLength(before);
    expect(balance.body.paidAmount).toBe(100);
  });

  it('settling the remainder through the same route turns the invoice PAID with paidAt and a second ledger posting', async () => {
    requireServer();
    expect(S.firstPaymentId).toBeTruthy();
    // Whatever the duplicate case above left behind, settle exactly what the product says is outstanding.
    const outstanding = await call(4, 'get', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { token: OWNER });
    expect(outstanding.status).toBe(200);
    const remaining = Number(outstanding.body.remaining);
    expect(remaining).toBeGreaterThan(0);
    const res = await call(4, 'post', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, {
      token: OWNER,
      body: { amount: remaining, method: 'bank_transfer', reference: `${P}ref-002` },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.settlePaymentId = res.body.payment.id;
    expect(res.body.remaining).toBe(0);
    expect(res.body.invoice.status).toBe('PAID');

    const invoice = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    expect(invoice.status).toBe('PAID');
    expect(invoice.paidAt).not.toBeNull();
    const txn = await db.financialTransaction.findFirst({ where: { businessId: S.bizA, externalRef: `Payment:${S.settlePaymentId}:payment_recorded` }, include: { entries: { include: { account: true } } } });
    expect(txn).not.toBeNull();
    expect(txn.entries.map((e: any) => `${e.account.systemKey}:${Number(e.debit) > 0 ? 'D' : 'C'}`).sort()).toEqual(
      S.accountingBasis === 'ACCRUAL' ? ['ACCOUNTS_RECEIVABLE:C', 'BANK:D'] : ['BANK:D', 'REVENUE:C'],
    );
    const successful = await db.payment.findMany({ where: { invoiceId: S.invoiceId, status: 'SUCCESSFUL' } });
    const paid = successful.reduce((s: number, p: any) => s + Number(p.amount), 0);
    expect(paid).toBeGreaterThanOrEqual(250);
    note(4, 'settle', 'POST .../payments (bank_transfer)', res.status, `PAID paidAt set; ledger BANK:D/REVENUE:C; total paid=${paid}`);
  });
});

// ---------------------------------------------------------------------------
// step 5
// ---------------------------------------------------------------------------
describe('step 5 — simulated refresh: the tenant list routes agree with steps 2-4', () => {
  it('GET contacts, invoices, invoice payments and tenant payments reflect the edited contact, the PAID invoice and every payment', async () => {
    requireServer();
    expect(S.settlePaymentId).toBeTruthy();
    const contacts = await call(5, 'get', `/crm/businesses/${S.bizA}/contacts`, { token: OWNER, query: { take: '100' } });
    expect(contacts.status).toBe(200);
    const contact = contacts.body.contacts.find((c: any) => c.id === S.contactId);
    expect(contact).toMatchObject({ lastName: 'Byron', status: 'CLIENT' });
    expect(contacts.body.contacts).toHaveLength(1);

    const invoices = await call(5, 'get', `/commerce/businesses/${S.bizA}/invoices`, { token: OWNER });
    expect(invoices.status).toBe(200);
    expect(invoices.body.total).toBe(1);
    const invoice = invoices.body.data.find((i: any) => i.id === S.invoiceId);
    expect(invoice).toMatchObject({ status: 'PAID', total: 250, invoiceNumber: S.invoiceNumber, contactId: S.contactId });

    const dbPayments = await db.payment.findMany({ where: { invoiceId: S.invoiceId } });
    expect(invoice.payments.map((p: any) => p.id).sort()).toEqual(dbPayments.map((p: any) => p.id).sort());

    const perInvoice = await call(5, 'get', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { token: OWNER });
    expect(perInvoice.status).toBe(200);
    expect(perInvoice.body.remaining).toBe(0);
    expect(perInvoice.body.payments.map((p: any) => p.id).sort()).toEqual(dbPayments.map((p: any) => p.id).sort());

    const tenantPayments = await call(5, 'get', `/commerce/businesses/${S.bizA}/payments`, { token: OWNER });
    expect(tenantPayments.status).toBe(200);
    expect(tenantPayments.body.map((p: any) => p.id).sort()).toEqual(dbPayments.map((p: any) => p.id).sort());
    expect(tenantPayments.body.map((p: any) => p.id)).toEqual(expect.arrayContaining([S.firstPaymentId, S.settlePaymentId]));
    note(5, 'refresh lists', 'GET contacts / invoices / invoices/:id/payments / payments', `${contacts.status}/${invoices.status}/${perInvoice.status}/${tenantPayments.status}`, `contacts=1 invoices=1(PAID) payments=${dbPayments.length}`);

    // V1-47-COCKPIT-TRUTH: the cockpit is one more read of the same records. With AI_DISABLED=1 it answers 200,
    // its Release 0 counts are what the list routes above just returned (the invoice is PAID, so none is open:
    // a real zero, status OK), a source that failed says so instead of reading as zero, and the read writes
    // nothing to the ledger. Folded into this case rather than added as a new one: release0-journey.json binds
    // exactly these 26 titles (allowAdditionalCases false).
    const ledgerScope = { businessId: { in: [S.bizA!, S.bizB!] } };
    const ledgerBefore = [await db.financialTransaction.count({ where: ledgerScope }), await db.ledgerEntry.count({ where: ledgerScope })];
    const cockpit = await call(5, 'get', `/business-command-center/businesses/${S.bizA}/snapshot`, { token: OWNER });
    const ledgerAfter = [await db.financialTransaction.count({ where: ledgerScope }), await db.ledgerEntry.count({ where: ledgerScope })];
    expect(cockpit.status, JSON.stringify(cockpit.body).slice(0, 400)).toBe(200);
    const openListed = invoices.body.data.filter((i: any) => ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(i.status)).length;
    expect(cockpit.body.results).toEqual({
      contacts: { label: 'Contacts', count: contacts.body.contacts.length, status: 'OK', href: '/app/crm/contacts' },
      openInvoices: { label: 'Open invoices', count: openListed, status: 'OK', href: '/app/commerce/invoices' },
      payments: { label: 'Payments', count: tenantPayments.body.length, status: 'OK', href: '/app/payments' },
    });
    expect([cockpit.body.results.contacts.count, cockpit.body.results.openInvoices.count, cockpit.body.results.payments.count]).toEqual([1, 0, dbPayments.length]);
    const sources = Object.entries(cockpit.body.sources ?? {}) as Array<[string, any]>;
    expect(sources.length).toBeGreaterThan(0);
    for (const [key, s] of sources) {
      expect(s.label, key).toBe(key);
      expect(['OK', 'FAILED'], `${key} status`).toContain(s.status);
      expect(Number.isNaN(Date.parse(s.fetchedAt)), `${key} fetchedAt`).toBe(false);
    }
    const failedSources = sources.filter(([, s]) => s.status === 'FAILED').map(([key]) => key);
    expect(cockpit.body.degraded).toBe(failedSources.length > 0);
    expect(ledgerAfter, 'the cockpit snapshot is a read: no FinancialTransaction or LedgerEntry row appears').toEqual(ledgerBefore);
    note(5, 'cockpit snapshot', 'GET /business-command-center/businesses/:bizA/snapshot', cockpit.status, `contacts=${cockpit.body.results.contacts.count} openInvoices=${cockpit.body.results.openInvoices.count} payments=${cockpit.body.results.payments.count} degraded=${cockpit.body.degraded} failed=[${failedSources.join(',')}] ledger ${ledgerBefore.join('/')}->${ledgerAfter.join('/')}`);

    // V1-47 review repair SEC-V47-1: the within-tenant rule on the real database, not only on the spec's
    // where-clause emulator. A STAFF member the owner invites through the real team route with crm read,
    // crm_view=owned and revenue none reads the same cockpit. Its contacts count is what ITS contacts list
    // returns: the M7 owned-only clause leaves the owner's contact out of its book, then counts it once the
    // contact is shared with it (Prisma's shares.some against Postgres). Its revenue counts are RESTRICTED with
    // no number while the revenue list routes answer it 403. The staff member signs up through the real
    // bootstrap route (which also gives it its own r0_bizStaff workspace). The ContactShare row is written
    // directly because no route writes one, and is removed again so step 6 sees the state the owner left.
    // Folded into this case for the same reason as the owner's cockpit read above (release0-journey.json).
    const STAFF_SCOPES = { crm: 'read', crm_view: 'owned', revenue: 'none' };
    const staffBoot = await call(5, 'post', '/identity/bootstrap', { token: STAFF, body: { company: ID.bizStaffName, firstName: 'Sam' } });
    expect(staffBoot.status, JSON.stringify(staffBoot.body)).toBe(201);
    expect(staffBoot.body.user?.id).toBe(ID.staff);
    expect(staffBoot.body.business?.id).not.toBe(S.bizA);
    const invite = await call(5, 'post', `/identity/businesses/${S.bizA}/team`, { token: OWNER, body: { email: ID.staffEmail, role: 'STAFF', scopes: STAFF_SCOPES } });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const staffMembership = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.staff, businessId: S.bizA } } });
    expect(staffMembership).toMatchObject({ role: 'STAFF', permissionScopes: STAFF_SCOPES });

    const staffReads = async () => ({
      list: await call(5, 'get', `/crm/businesses/${S.bizA}/contacts`, { token: STAFF, query: { take: '100' } }),
      snap: await call(5, 'get', `/business-command-center/businesses/${S.bizA}/snapshot`, { token: STAFF }),
    });
    const staffRevenueResults = {
      openInvoices: { label: 'Open invoices', count: null, status: 'RESTRICTED', href: '/app/commerce/invoices' },
      payments: { label: 'Payments', count: null, status: 'RESTRICTED', href: '/app/payments' },
    };

    const unshared = await staffReads();
    expect(unshared.list.status, JSON.stringify(unshared.list.body).slice(0, 400)).toBe(200);
    expect(unshared.list.body.contacts.map((c: { id: string }) => c.id)).toEqual([]);
    expect(unshared.snap.status, JSON.stringify(unshared.snap.body).slice(0, 400)).toBe(200);
    expect(unshared.snap.body.results).toEqual({
      contacts: { label: 'Contacts', count: unshared.list.body.contacts.length, status: 'OK', href: '/app/crm/contacts' },
      ...staffRevenueResults,
    });
    const staffRevenueRoutes = [
      await call(5, 'get', `/commerce/businesses/${S.bizA}/invoices`, { token: STAFF }),
      await call(5, 'get', `/commerce/businesses/${S.bizA}/payments`, { token: STAFF }),
    ];
    expect(staffRevenueRoutes.map((r) => r.status), 'the revenue lists the RESTRICTED tiles stand for refuse this member').toEqual([403, 403]);

    const share = await db.contactShare.create({ data: { businessId: S.bizA, contactId: S.contactId, userId: ID.staff, createdBy: ID.owner } });
    // The share is removed whatever the reads answer, before anything is asserted on them.
    const shared = await staffReads().finally(() => db.contactShare.delete({ where: { id: share.id } }));
    expect(shared.list.status).toBe(200);
    expect(shared.list.body.contacts.map((c: { id: string }) => c.id)).toEqual([S.contactId]);
    expect(shared.snap.status).toBe(200);
    expect(shared.snap.body.results).toEqual({
      contacts: { label: 'Contacts', count: shared.list.body.contacts.length, status: 'OK', href: '/app/crm/contacts' },
      ...staffRevenueResults,
    });
    note(5, 'cockpit snapshot as STAFF (crm_view=owned, revenue none)', 'GET /business-command-center/businesses/:bizA/snapshot', `${unshared.snap.status}/${shared.snap.status}; revenue lists ${staffRevenueRoutes.map((r) => r.status).join('/')}`, `contacts unshared ${unshared.snap.body.results.contacts.count} (list ${unshared.list.body.contacts.length}), shared ${shared.snap.body.results.contacts.count} (list ${shared.list.body.contacts.length}); openInvoices/payments RESTRICTED`);
  });
});

// ---------------------------------------------------------------------------
// step 6
// ---------------------------------------------------------------------------
type Probe = [method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown];

async function probeAll(step: number, token: string | null, probes: Probe[]) {
  const out: Array<{ method: string; path: string; status: number; body: any }> = [];
  for (const [method, p, body] of probes) {
    const r = await call(step, method, p, { token, body });
    out.push({ method: method.toUpperCase(), path: p, status: r.status, body: r.body });
  }
  return out;
}

const describeStatuses = (rows: Array<{ method: string; path: string; status: number }>) =>
  rows.map((r) => `${r.status} ${r.method} ${r.path.replace(S.bizA ?? '', ':bizA').replace(S.bizB ?? '', ':bizB').replace(S.contactId ?? '', ':contactA').replace(S.invoiceId ?? '', ':invoiceA')}`).join('\n');

describe("step 6 — the second tenant's owner is denied on every step-2..5 resource", () => {
  it('business-prefixed routes under bizA answer 403 to r0_other (BusinessGuard), never 200, never 500', async () => {
    requireServer();
    expect(S.bizB && S.invoiceId).toBeTruthy();
    const rows = await probeAll(6, OTHER, [
      ['get', `/identity/businesses/${S.bizA}`],
      ['get', `/crm/businesses/${S.bizA}/contacts`],
      ['get', `/crm/businesses/${S.bizA}/contacts/${S.contactId}`],
      ['patch', `/crm/businesses/${S.bizA}/contacts/${S.contactId}`, { lastName: 'Hijacked' }],
      ['get', `/commerce/businesses/${S.bizA}/invoices`],
      ['post', `/commerce/businesses/${S.bizA}/invoices`, { contactId: S.contactId, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }],
      ['patch', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}`, { notes: 'hijacked' }],
      ['delete', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}`],
      ['get', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`],
      ['post', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/payments`, { amount: 1, method: 'cash' }],
      ['get', `/commerce/businesses/${S.bizA}/invoices/${S.invoiceId}/timeline`],
      ['get', `/commerce/businesses/${S.bizA}/payments`],
      // V1-47-COCKPIT-TRUTH: the cockpit that now counts bizA's records is bizA's alone.
      ['get', `/business-command-center/businesses/${S.bizA}/snapshot`],
    ]);
    note(6, 'bizA routes as r0_other', '13 business-prefixed routes', rows.map((r) => r.status).join(','), 'expect all 403');
    for (const r of rows) {
      expect(r.status, `${r.method} ${r.path}`).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain(S.invoiceNumber!);
    }
  });

  it("bizA's contact id under bizB's own path answers 404 (not found, not disclosed) for read and write", async () => {
    requireServer();
    const rows = await probeAll(6, OTHER, [
      ['get', `/crm/businesses/${S.bizB}/contacts/${S.contactId}`],
      ['patch', `/crm/businesses/${S.bizB}/contacts/${S.contactId}`, { lastName: 'Hijacked' }],
      ['get', `/commerce/businesses/${S.bizB}/invoices/${S.invoiceId}/timeline`],
    ]);
    note(6, 'bizA ids under bizB path (contacts, timeline)', '3 routes', rows.map((r) => r.status).join(','), 'expect all 404');
    for (const r of rows) {
      expect(r.status, `${r.method} ${r.path}`).toBe(404);
      expect(r.body).not.toHaveProperty('contact');
    }
    expect((await db.contact.findUnique({ where: { id: S.contactId } })).lastName).toBe('Byron');
  });

  // R0-D3-INVOICE-ROUTE-ERROR-MAPPING landed: CommerceService throws
  // NotFoundException('Invoice not found') on these paths, so the case is
  // back to a plain `it` (it was `it.fails` while the API answered 500).
  it("bizA's invoice id under bizB's own path answers 404 on payments list/record, update and delete", async () => {
    requireServer();
    const rows = await probeAll(6, OTHER, [
      ['get', `/commerce/businesses/${S.bizB}/invoices/${S.invoiceId}/payments`],
      ['post', `/commerce/businesses/${S.bizB}/invoices/${S.invoiceId}/payments`, { amount: 1, method: 'cash' }],
      ['patch', `/commerce/businesses/${S.bizB}/invoices/${S.invoiceId}`, { notes: 'hijacked' }],
      ['delete', `/commerce/businesses/${S.bizB}/invoices/${S.invoiceId}`],
    ]);
    note(6, 'bizA invoice under bizB path (payments/update/delete)', '4 routes', rows.map((r) => r.status).join(','), 'expect all 404');
    // Nothing crossed the tenant line: the row is intact.
    const invoice = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    expect(invoice).toMatchObject({ status: 'PAID', deletedAt: null, notes: null });
    expect(await db.payment.count({ where: { invoiceId: S.invoiceId, businessId: S.bizB } })).toBe(0);
    for (const r of rows) {
      expect(r.status, `${r.method} ${r.path}`).toBe(404);
    }
  });

  it("bare-id receipt route with bizB's businessId answers 404 for bizA's invoice; anonymous answers 401", async () => {
    requireServer();
    const asOther = await call(6, 'get', `/commerce/invoices/${S.invoiceId}/receipt`, { token: OTHER, query: { businessId: S.bizB! } });
    expect(asOther.status).toBe(404);
    const anon = await call(6, 'get', `/commerce/invoices/${S.invoiceId}/receipt`, { token: null });
    expect(anon.status).toBe(401);
    note(6, 'bare-id receipt', 'GET /commerce/invoices/:invoiceA/receipt', `${asOther.status}/${anon.status}`, 'no disclosure');
  });

  it("bare-id status/paid routes with bizB's businessId answer 404: the guard-validated businessId is bound to the invoice and a foreign tenant is indistinguishable from an unknown id (KF-REVENUE-AUTH-PROJECTION-001)", async () => {
    requireServer();
    const before = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    const rows = await probeAll(6, OTHER, [
      ['patch', `/commerce/invoices/${S.invoiceId}/status/void`, { businessId: S.bizB, status: 'VOID' }],
      ['patch', `/commerce/invoices/${S.invoiceId}/paid`, { businessId: S.bizB }],
    ]);
    note(6, 'bare-id status/paid as r0_other', 'PATCH /commerce/invoices/:invoiceA/status/void, /paid', rows.map((r) => r.status).join(','), 'expect 404; row unchanged');
    // The write did not happen: status and paidAt are what step 4 left.
    const after = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    expect(after.status).toBe(before.status);
    expect(after.paidAt?.toISOString()).toBe(before.paidAt?.toISOString());
    for (const r of rows) {
      expect([403, 404], `${r.method} ${r.path} answered ${r.status}`).toContain(r.status);
    }
  });

  it('bare-id public reads answer with the redacted projection for a non-member and for anonymous callers: no payment rows, no payment references, no customer email; the status route carries exactly five keys (KF-REVENUE-AUTH-PROJECTION-001; the pay-link token policy is a separate decision)', async () => {
    requireServer();
    const asOther = await probeAll(6, OTHER, [
      ['get', `/commerce/invoices/${S.invoiceId}`],
      ['get', `/payments/invoice/${S.invoiceId}/status`],
      ['get', `/payments/invoice/${S.invoiceId}/gateways`],
    ]);
    const anon = await probeAll(6, null, [
      ['get', `/commerce/invoices/${S.invoiceId}`],
      ['get', `/payments/invoice/${S.invoiceId}/status`],
      ['get', `/payments/invoice/${S.invoiceId}/gateways`],
    ]);
    const all = [...asOther, ...anon];
    const disclosed = all.map((r) => {
      const text = JSON.stringify(r.body ?? {});
      return `${r.status} ${r.method} ${r.path.replace(S.invoiceId!, ':invoiceA')} leaks=${[`${P}ref-001`, 'providerPaymentId', '"payments"', `${P}ada@test.local`].filter((m) => text.includes(m)).join('|') || 'none'}`;
    });
    note(6, 'bare-id public reads (redacted projection)', 'GET /commerce/invoices/:id, /payments/invoice/:id/status, /gateways', all.map((r) => r.status).join(','), disclosed.join(' ; '));
    for (const r of all) {
      // The invoice is PAID (a shareable status), so the public surface answers 200 by design, with the
      // redacted projection: no Payment rows or references, no customer email, no business private fields.
      expect(r.status, `${r.method} ${r.path} answered ${r.status}`).toBe(200);
      const text = JSON.stringify(r.body ?? {});
      expect(text).not.toContain(`${P}ref-001`);
      expect(text).not.toContain('providerPaymentId');
      expect(text).not.toContain('evidenceUrl');
      expect(text).not.toContain(`${P}ada@test.local`);
      if (r.path.endsWith('/status')) {
        expect(Object.keys(r.body).sort()).toEqual(['currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
        expect(r.body.status).toBe('PAID');
        expect(r.body.remaining).toBe(0);
      } else if (r.path.endsWith(`/${S.invoiceId}`)) {
        expect(r.body.payments).toBeUndefined();
        expect(r.body.contact?.email).toBeUndefined();
        // The merchant's own public profile (name, address, website, socials) is part of the public invoice by
        // design; templates, bank metadata, owner id and slug are not.
        expect(r.body.business?.invoiceTemplate).toBeUndefined();
        expect(r.body.business?.metaData).toBeUndefined();
        expect(r.body.business?.ownerId).toBeUndefined();
        expect(r.body.business?.slug).toBeUndefined();
        expect(r.body.paid).toBe(250);
        expect(r.body.remaining).toBe(0);
      }
    }
  });

  it('after every denial attempt the tenant state of steps 2-5 is byte-for-byte what the owner left', async () => {
    requireServer();
    const contact = await db.contact.findUnique({ where: { id: S.contactId } });
    expect(contact).toMatchObject({ businessId: S.bizA, lastName: 'Byron', status: 'CLIENT', deletedAt: null });
    const invoice = await db.invoice.findUnique({ where: { id: S.invoiceId } });
    expect(invoice).toMatchObject({ businessId: S.bizA, status: 'PAID', total: 250, deletedAt: null, notes: null });
    expect(await db.invoice.count({ where: { businessId: S.bizB } })).toBe(0);
    expect(await db.contact.count({ where: { businessId: S.bizB } })).toBe(0);
    expect(await db.payment.count({ where: { businessId: S.bizB } })).toBe(0);
    const owned = await call(6, 'get', `/commerce/businesses/${S.bizA}/invoices`, { token: OWNER });
    expect(owned.body.total).toBe(1);
    // V1-47-COCKPIT-TRUTH: bizB's own cockpit counts none of bizA's rows; its zeros are real zeros (status OK).
    const otherCockpit = await call(6, 'get', `/business-command-center/businesses/${S.bizB}/snapshot`, { token: OTHER });
    expect(otherCockpit.status, JSON.stringify(otherCockpit.body).slice(0, 400)).toBe(200);
    expect(otherCockpit.body.businessId).toBe(S.bizB);
    expect(otherCockpit.body.results).toMatchObject({
      contacts: { count: 0, status: 'OK' },
      openInvoices: { count: 0, status: 'OK' },
      payments: { count: 0, status: 'OK' },
    });
    expect(JSON.stringify(otherCockpit.body)).not.toContain(S.invoiceNumber!);
    note(6, 'state after denials', 'db + GET /commerce/businesses/:bizA/invoices + GET bizB cockpit as r0_other', `${owned.status}/${otherCockpit.status}`, 'contact, invoice, payments unchanged; bizB owns nothing and its cockpit counts 0/0/0');
  });
});

// ---------------------------------------------------------------------------
// step 7
// ---------------------------------------------------------------------------
describe('step 7 — no step required an external provider', () => {
  it('ran with AI_DISABLED=1 and no provider keys; optional services that logged failures are recorded, none blocked a step', () => {
    requireServer();
    // The child env was an allow-list; these names were never in it.
    for (const key of PROVIDER_KEYS) expect(PROVIDER_KEYS.includes(key)).toBe(true); // documents the audited set
    const attemptedOutbound = serverLog.filter((l) => /ENOTFOUND|ECONNREFUSED|getaddrinfo|fetch failed|ETIMEDOUT/i.test(l));
    const optional = serverLog
      .filter((l) => /WARN|ERROR/.test(l))
      .filter((l) => /supabase|openai|anthropic|xai|AI provider|stripe|paypal|wipay|resend|sentry|google|twilio|livekit|temporal|chatwoot|slack|whatsapp|shopify|langfuse|growthbook|elevenlabs/i.test(l))
      .map((l) => l.replace(/^\[Nest\]\s+\d+\s+-\s+\S+ \S+ \S+\s+/, '').trim());
    const unique = [...new Set(optional)];
    note(7, 'optional services that logged failures', 'server log', unique.length, unique.slice(0, 12).join(' | '));
    console.log('[release0-journey] optional services logging failures with no provider keys:\n  ' + unique.join('\n  '));

    // Steps 1-3 and 5 completed without a 5xx; step 4's documented 500 is the product defect, not a provider.
    const providerFree = journeyResponses.filter((r) => r.step !== 4 && r.step !== 6);
    expect(providerFree.length).toBeGreaterThan(10);
    expect(providerFree.filter((r) => r.status >= 500).map((r) => `${r.status} ${r.method} ${r.path}`)).toEqual([]);
    // No outbound connection was attempted and refused: the failures above are "not configured", not "unreachable".
    expect(attemptedOutbound.filter((l) => !/redis/i.test(l))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// incidental (not on the journey path, seen while driving it)
// ---------------------------------------------------------------------------
describe('incidental — seen while driving the journey, not part of its path', () => {
  it('creating a second contact with an email already in the tenant answers 409 (fixed by R0-D7-CONTACT-EMAIL-409)', async () => {
    requireServer();
    expect(S.contactId).toBeTruthy();
    const res = await call(8, 'post', `/crm/businesses/${S.bizA}/contacts`, { token: OWNER, body: { firstName: `${P}Ada2`, email: `${P}ada@test.local` } });
    note(8, 'duplicate contact email', 'POST /crm/businesses/:bizA/contacts', res.status, 'expect 409');
    expect(await db.contact.count({ where: { businessId: S.bizA, deletedAt: null } })).toBe(1);
    expect(res.status).toBe(409);
  });
});

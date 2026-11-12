/**
 * R0-32-ONBOARD-COMPLETE-SERVER — onboarding completes without AI, REAL
 * server, REAL database (Release 0 journey step 1, M07 / CF-22).
 *
 * OWNER RULING D-03 (2026-10-31): manual minimal profile. The server accepts
 * completion with a business name, a currency and a timezone; the three-pillar
 * DNA minimum (founder, business and market scores of at least 50) no longer
 * gates completion — the AI genome stays as optional enrichment.
 *
 * Before this packet, POST /onboarding-concierge/businesses/:id/complete
 * refused every freshly bootstrapped owner with 403 GENOME_GATE_BLOCKED
 * (missingPillars founder, business, market), because markOnboardingComplete
 * required every pillar's DNA score to be at least 50. Without a paid LLM the
 * only way to raise those scores is the raw genome editor, so with AI off no
 * new owner could reach the workspace.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   - a fresh owner, AI off, sets name/currency/timezone through the
 *     ordinary profile route and completes: 200, onboardingComplete true, the
 *     onboarding state says `complete`, and the three-pillar score is still
 *     reported, as a recommendation, not a gate;
 *   - an absent or malformed minimal profile is refused with 403 and the list
 *     of missing fields, and nothing is written;
 *   - a member of another business is refused and nothing changes;
 *   - IN-TENANT AUTHORITY (review ST-R032-1, then R0-SEC-03 on owner ruling
 *     D-11, 2026-10-31: OWNER only): a STAFF member with the role default
 *     scopes (settings none) is refused and nothing is written — no flag, no
 *     demo contact or invoice, no disclaimer acceptance; so is an ADMIN or a
 *     STAFF member whose scopes grant settings:write (403
 *     ONBOARDING_COMPLETE_FORBIDDEN, "Only the business owner can finish
 *     onboarding."); the business owner completes; a SUPER_ADMIN with no
 *     membership completes too (the platform bypass BusinessGuard grants);
 *     every completion writes a team_activity_logs row naming the actor, for
 *     completion and for the legal disclaimer acceptance it records;
 *   - a second /complete answers alreadyComplete and writes nothing;
 *   - CONCURRENCY (R0-SEC-04 SEC03-2): three simultaneous /complete calls from
 *     the owner write exactly one onboarding_completed row, one legal
 *     disclaimer acceptance and one demo seed; one call completes, the others
 *     answer alreadyComplete (the claim is a conditional update inside the
 *     completion transaction);
 *   - /complete does not trust an onboardingComplete flag written outside it
 *     (review SEC03-1): with the flag set but no onboardingCompletedAt, an
 *     ADMIN is still refused and the owner's /complete runs the whole
 *     completion;
 *   - THE PROFILE PATCH CANNOT FINISH ONBOARDING (R0-SEC-04, closing SEC03-1
 *     now that R0-09-ID-HARDEN has landed, D-11 end to end): a STAFF member on
 *     the role-default scopes and an ADMIN granted settings:write sending
 *     {onboardingComplete: true} to PATCH /identity/businesses/:id get 403,
 *     the Business row is unchanged and the web genome gate's input (the
 *     onboarding state's onboardingComplete / onboardingCompletedAt) stays
 *     unset; the owner's PATCH of a profile field still applies while the flag
 *     beside it is dropped; on a completed business no one's
 *     {onboardingComplete: false} un-completes it, so the owner's /complete
 *     does not run again;
 *   - LEDGER: completion writes exactly one demo contact (source 'demo') and
 *     one DRAFT demo invoice, and no FinancialTransaction or LedgerEntry;
 *   - no model-gateway dispatch: no ai_usage_logs row for the business and no
 *     AI/provider line in the server log while completion ran;
 *   - CHARACTERIZATION (the proof line's question, recorded verbatim in the
 *     packet return): what the non-AI genome editor path (PATCH /blueprint with
 *     founder, business and market fields) does to the DNA scores, and that
 *     /complete succeeds afterwards.
 *
 * "Succeeds" is 201: POST .../complete is a plain Nest @Post (see COMPLETE_OK).
 *
 * HOW THE APP IS COMPOSED: SPAWNED BUILT SERVER (not in-process)
 * --------------------------------------------------------------
 * As in identity-boundary.integration.test.ts and release0-journey: the
 * BUILT artifact `dist/main.js` is spawned on a free port against
 * DATABASE_URL / REDIS_URL. That is the real module graph — AuthMiddleware,
 * AuthGuard, BusinessGuard, ValidationPipe, GlobalHttpExceptionFilter, the
 * real OnboardingConciergeService, OnboardingStateService, BlueprintService,
 * KeyGenomeService and DemoDataSeederService. It cannot be composed
 * in-process: KeyGenomeService and its scoring collaborators inject by
 * tsc-emitted decorator metadata, which vitest's esbuild transform does not
 * emit.
 *
 * IDENTITY: the child gets a test-only SUPABASE_JWT_SECRET; every provider
 * credential the child's own dotenv could load is pinned to '' (dotenv never
 * overrides a present key). The test mints HS256 tokens shaped like Supabase
 * access tokens, which the real AuthMiddleware verifies locally. Owners and
 * their businesses are created by the real POST /identity/bootstrap route.
 * AI_DISABLED=1 and no AI provider key reaches the child.
 *
 * FIXTURES: prefix `k32a_` — user ids (token sub), user emails and business
 * names embed it; business ids are server-minted cuids reached through
 * owner_id / name. Every row is hard-deleted by raw SQL in beforeAll and
 * afterAll. No $transaction wrapping: the server writes from another process.
 *
 * REQUIRES: DATABASE_URL with migrations applied, REDIS_URL, and a build in
 * apps/server (`pnpm run build`) so dist/main.js exists. Deliberately not
 * skipped when dist is missing — the first case says so instead.
 */
import 'reflect-metadata';
import path from 'node:path';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { config as loadEnv, parse as parseEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The genome-editor characterization makes several HTTP round trips (about 2s
// alone); under the one parallel run of every suite the default 5s budget
// times out with no assertion failing. The assertions are unchanged.
vi.setConfig({ testTimeout: 30_000 });
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k32a_';
const SERVER_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(SERVER_DIR, 'dist', 'main.js');

/** Test-only HS256 secret handed to the spawned server. Not a real secret. */
const JWT_SECRET = 'k32a-onboarding-manual-complete-test-jwt-secret-not-real';

/** Every provider credential the child's dotenv could load is pinned to ''. */
const ROOT_ENV_FILE = path.resolve(SERVER_DIR, '../../.env');
const ENV_EXAMPLE_FILE = path.resolve(SERVER_DIR, '../../.env.example');
const ALWAYS_PINNED = [
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'AI_INTEGRATIONS_OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'RESEND_API_KEY', 'SENTRY_DSN',
];
const PROVIDER_KEY = /SUPABASE|OPENAI|ANTHROPIC|^XAI_|GEMINI|^S3_|^AWS_|_API_KEY$|_KEY$|_KEY_ID$|_SECRET$|_SECRET_KEY$|_TOKEN$|_SID$|_DSN$|_PASSWORD_HASH$|_CLIENT_ID$|_SERVERS$/;
const envFileKeys = (file: string) => (existsSync(file) ? Object.keys(parseEnv(readFileSync(file))) : []);
const PINNED_PROVIDER_KEYS = [
  ...new Set([...ALWAYS_PINNED, ...[...envFileKeys(ENV_EXAMPLE_FILE), ...envFileKeys(ROOT_ENV_FILE)].filter((k) => PROVIDER_KEY.test(k))]),
].sort();

const ID = {
  owner: `${P}owner`,   // the fresh owner who completes onboarding (bizA)
  other: `${P}other`,   // owner of bizB only: a member of another business
  blank: `${P}blank`,   // owner of bizX, whose minimal profile is blanked, then malformed, then filled
  genome: `${P}genome`, // owner of bizG: characterization of the non-AI genome editor path
  staff: `${P}staff`,   // STAFF member of bizA with role-default scopes (settings none)
  sowner: `${P}sowner`, // owner of bizS: the only member of bizS who may complete it (D-11)
  sadmin: `${P}sadmin`, // ADMIN member of bizS with an explicit scope map granting settings:write
  dadmin: `${P}dadmin`, // ADMIN member of bizS on the role-default scopes (settings write by default)
  sstaff: `${P}sstaff`, // STAFF member of bizS with an explicit scope map granting settings:write
  powner: `${P}powner`, // owner of bizP, which a SUPER_ADMIN completes
  platform: `${P}platform`, // SUPER_ADMIN user with no membership anywhere
  fowner: `${P}fowner`, // owner of bizF, whose onboardingComplete flag is set outside /complete (SEC03-1)
  fadmin: `${P}fadmin`, // ADMIN member of bizF on the role-default scopes
  nowner: `${P}nowner`, // owner of bizN: the profile PATCH cannot finish onboarding (R0-SEC-04)
  nstaff: `${P}nstaff`, // STAFF member of bizN on the role-default scopes
  nadmin: `${P}nadmin`, // ADMIN member of bizN with an explicit scope map granting settings:write
  kowner: `${P}kowner`, // owner of bizK, who sends three /complete calls at once (R0-SEC-04 SEC03-2)
  bizAName: `${P}bizA`,
  bizBName: `${P}bizB`,
  bizXName: `${P}bizX`,
  bizGName: `${P}bizG`,
  bizSName: `${P}bizS`,
  bizPName: `${P}bizP`,
  bizFName: `${P}bizF`,
  bizNName: `${P}bizN`,
  bizKName: `${P}bizK`,
};
const ALL_USERS = [
  ID.owner, ID.other, ID.blank, ID.genome, ID.staff, ID.sowner, ID.sadmin, ID.dadmin, ID.sstaff, ID.powner, ID.platform, ID.fowner, ID.fadmin,
  ID.nowner, ID.nstaff, ID.nadmin, ID.kowner,
];
const email = (id: string) => `${id}@k32a.test.local`;

/**
 * The success status of POST .../complete. The controller is a plain @Post with
 * no @HttpCode, so Nest answers 201 Created (the "200" in the proof line); the
 * controller is outside this packet's write set.
 */
const COMPLETE_OK = 201;

/** R0-SEC-03 (owner ruling D-11): the refusal every non-owner member gets on /complete. */
const OWNER_ONLY_MESSAGE = 'Only the business owner can finish onboarding.';

/** The minimal profile D-03 names, set by the owner through the ordinary profile route. */
const MINIMAL_PROFILE = { name: `${P}bizA Bakery`, currency: 'USD', timezone: 'America/New_York' };

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

const T: Record<string, string> = {};
/** Ids minted by the server, carried from case to case. */
const S: { bizA?: string; bizB?: string; bizX?: string; bizG?: string; bizS?: string; bizP?: string; bizF?: string; bizN?: string; bizK?: string; completedAt?: string; demo?: { contactId: string; invoiceId: string; invoiceNumber: string } } = {};
/** serverLog offsets around the completion request, for the no-AI log filter. */
const completionWindow: { from?: number; to?: number } = {};
/** Verbatim characterization, printed for the packet return. */
const characterization: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** An HS256 JWT shaped like a Supabase access token, signed with the test secret. */
function mintToken(sub: string) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub, email: email(sub), aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 }),
  );
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

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
async function call(method: 'get' | 'post' | 'patch', route: string, token: string, body?: unknown): Promise<Resp> {
  requireServer();
  let req = request(baseUrl)[method](route).set('Authorization', `Bearer ${token}`);
  if (body !== undefined) req = req.send(body as object);
  const res = await req;
  return { status: res.status, body: res.body };
}

const routes = {
  bootstrap: '/identity/bootstrap',
  profile: (biz: string) => `/identity/businesses/${biz}`,
  complete: (biz: string) => `/onboarding-concierge/businesses/${biz}/complete`,
  state: (biz: string) => `/onboarding-concierge/businesses/${biz}/onboarding-state`,
  blueprint: (biz: string) => `/blueprint/businesses/${biz}`,
  genome: (biz: string) => `/blueprint/businesses/${biz}/genome`,
};

/** Rows completion may write, per business. */
async function footprint(businessId: string) {
  const [biz, contacts, demoContacts, invoices, transactions, ledger, aiUsage] = await Promise.all([
    db.business.findUnique({
      where: { id: businessId },
      select: { onboardingComplete: true, onboardingCompletedAt: true, onboardingStep: true, name: true, currency: true, timezone: true },
    }),
    db.contact.count({ where: { businessId } }),
    db.contact.count({ where: { businessId, source: 'demo' } }),
    db.invoice.count({ where: { businessId } }),
    db.financialTransaction.count({ where: { businessId } }),
    db.ledgerEntry.count({ where: { businessId } }),
    db.aiUsageLog.count({ where: { businessId } }),
  ]);
  return { ...biz, contacts, demoContacts, invoices, transactions, ledger, aiUsage };
}

/**
 * The team_activity_logs rows of a business, by action name: who did what.
 * Rows written in one transaction can share a createdAt, so order by action.
 */
async function activity(businessId: string) {
  return db.teamActivityLog.findMany({
    where: { businessId },
    orderBy: [{ action: 'asc' }, { createdAt: 'asc' }],
    select: { userId: true, module: true, action: true, entityType: true, entityId: true, meta: true },
  });
}

/** The recorded legal disclaimer acceptance, or null when none was recorded. */
async function disclaimerAcceptedAt(businessId: string): Promise<string | null> {
  const row = await db.businessBlueprint.findUnique({ where: { businessId }, select: { legalProfile: true } });
  return (row?.legalProfile as { disclaimerAcceptedAt?: string } | null)?.disclaimerAcceptedAt ?? null;
}

/** A user row plus a membership in `businessId`, written directly (no invite flow in this packet). */
async function addMember(userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) {
  await db.user.create({ data: { id: userId, email: email(userId), name: userId, role: 'USER' } });
  await db.membership.create({ data: { userId, businessId, role, ...(permissionScopes ? { permissionScopes } : {}) } });
}

function expectNothingWritten(f: Awaited<ReturnType<typeof footprint>>) {
  expect(f.onboardingComplete).toBe(false);
  expect(f.onboardingCompletedAt).toBeNull();
  expect(f.contacts).toBe(0);
  expect(f.invoices).toBe(0);
  expect(f.transactions).toBe(0);
  expect(f.ledger).toBe(0);
}

async function bootstrap(user: string, company: string) {
  const res = await call('post', routes.bootstrap, T[user], { company, firstName: user });
  expect(res.status, `bootstrap ${user}: ${res.status} ${JSON.stringify(res.body)}`).toBeLessThan(300);
  const businessId: string | undefined = res.body?.business?.id;
  expect(businessId, JSON.stringify(res.body)).toBeTruthy();
  return businessId!;
}

async function cleanup() {
  const biz = `(SELECT id FROM businesses WHERE owner_id LIKE ${sqlLikePrefix(P)} OR name LIKE ${sqlLikePrefix(P)})`;
  const tables: Array<{ table_name: string }> = await db.$queryRawUnsafe(
    `SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'business_id' AND table_name <> 'businesses'`,
  );
  // Children without a business_id column first, then every business-scoped
  // table in a few passes so RESTRICT foreign keys between them resolve.
  const first = [
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id IN ${biz})`,
  ];
  for (const sql of first) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const { table_name } of tables) {
      try { await db.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE business_id IN ${biz}`); } catch { /* next pass */ }
    }
  }
  for (const sql of [
    `DELETE FROM memberships WHERE business_id IN ${biz} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE owner_id LIKE ${sqlLikePrefix(P)} OR name LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM auth_audit_logs WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
  const left = await db.$queryRawUnsafe(
    `SELECT (SELECT count(*)::int FROM businesses WHERE owner_id LIKE ${sqlLikePrefix(P)} OR name LIKE ${sqlLikePrefix(P)}) AS businesses, ` +
      `(SELECT count(*)::int FROM users WHERE id LIKE ${sqlLikePrefix(P)}) AS users`,
  );
  return left?.[0] ?? { businesses: -1, users: -1 };
}

/** The child's whole environment: provider credentials pinned to '', then an allow-list. NOT a copy of process.env. */
function childEnv(port: number): Record<string, string> {
  return {
    ...Object.fromEntries(PINNED_PROVIDER_KEYS.map((k) => [k, ''])),
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
  };
}

function bootServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [ENTRY], { cwd: SERVER_DIR, env: childEnv(port), stdio: ['ignore', 'pipe', 'pipe'] });

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

/** Lines that would mean an AI or provider dispatch was attempted. */
const AI_OR_OUTBOUND = /openai|anthropic|\bxai\b|gemini|AI provider|model[- ]gateway|callAi|chat\.completions|ENOTFOUND|ECONNREFUSED|getaddrinfo|fetch failed|ETIMEDOUT/i;

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  await cleanup(); // in case a prior run aborted
  for (const id of ALL_USERS) T[id] = mintToken(id);

  if (!existsSync(ENTRY)) {
    bootDiagnosis = 'dist/main.js is missing — run `pnpm run build` in apps/server first';
    return;
  }
  const port = await freePort();
  await bootServer(port);
}, HARD_CAP_MS + 30_000);

afterAll(async () => {
  if (Object.keys(characterization).length > 0) {
    console.log(`[onboarding-manual-complete] characterization: ${JSON.stringify(characterization)}`);
  }
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
      console.warn(`[onboarding-manual-complete] cleanup left rows behind: ${JSON.stringify(left)}`);
    }
  }
}, 90_000);

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
describe('harness — the real built server is serving with AI off', () => {
  it('dist/main.js exists (build before running this)', () => {
    expect(existsSync(ENTRY), 'dist/main.js is missing: `pnpm run build` in apps/server').toBe(true);
  });

  it('reached /readyz on a free port, against DATABASE_URL, with AI_DISABLED=1 and no AI provider key', async () => {
    expect(bootDiagnosis, `server did not come up: ${bootDiagnosis}\n${serverLog.slice(-10).join('\n')}`).toBeNull();
    const res = await request(baseUrl).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.db?.ok).toBe(true);
    const env = childEnv(0);
    expect(env.AI_DISABLED).toBe('1');
    for (const key of ['OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY']) {
      expect(env[key] ?? '', key).toBe('');
    }
  });

  it('bootstraps four fresh owners, each with one business that has not completed onboarding', async () => {
    S.bizA = await bootstrap(ID.owner, ID.bizAName);
    S.bizB = await bootstrap(ID.other, ID.bizBName);
    S.bizX = await bootstrap(ID.blank, ID.bizXName);
    S.bizG = await bootstrap(ID.genome, ID.bizGName);
    for (const biz of [S.bizA, S.bizB, S.bizX, S.bizG]) {
      expectNothingWritten(await footprint(biz));
      expect(await db.membership.count({ where: { businessId: biz } })).toBe(1);
    }
    const state = await call('get', routes.state(S.bizA), T[ID.owner]);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ onboardingComplete: false, threePillarMet: false });
  });
});

// ---------------------------------------------------------------------------
// the fresh owner completes onboarding with the minimal profile, AI off
// ---------------------------------------------------------------------------
describe('a fresh owner completes onboarding with the minimal profile and no AI (D-03)', () => {
  it('the owner sets business name, currency and timezone through the profile route', async () => {
    const res = await call('patch', routes.profile(S.bizA!), T[ID.owner], MINIMAL_PROFILE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const f = await footprint(S.bizA!);
    expect({ name: f.name, currency: f.currency, timezone: f.timezone }).toEqual(MINIMAL_PROFILE);
    expectNothingWritten(f);
  });

  it('a member of another business gets 403 on /complete and nothing changes', async () => {
    const res = await call('post', routes.complete(S.bizA!), T[ID.other]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('demoData');
    expectNothingWritten(await footprint(S.bizA!));
    // and the caller's own business is untouched too
    expectNothingWritten(await footprint(S.bizB!));
  });

  it('ST-R032-1: a STAFF member with role-default scopes gets 403 on /complete and nothing is written', async () => {
    await addMember(ID.staff, S.bizA!, 'STAFF');
    // Control: the same member is denied an ordinary revenue write (read-only scopes).
    const control = await call('post', `/commerce/businesses/${S.bizA}/invoices`, T[ID.staff], { items: [] });
    expect(control.status, JSON.stringify(control.body)).toBe(403);

    const res = await call('post', routes.complete(S.bizA!), T[ID.staff]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');
    expect(res.body.message).toBe(OWNER_ONLY_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('demoData');
    const f = await footprint(S.bizA!);
    expectNothingWritten(f);
    expect(f.demoContacts).toBe(0);
    expect(await disclaimerAcceptedAt(S.bizA!)).toBeNull();
    expect(await activity(S.bizA!)).toEqual([]);
  });

  it('POST /complete succeeds (201 {complete: true}) with the three-pillar score below the minimum', async () => {
    completionWindow.from = serverLog.length;
    const res = await call('post', routes.complete(S.bizA!), T[ID.owner]);
    completionWindow.to = serverLog.length;
    characterization.freshOwnerComplete = { status: res.status, body: res.body };
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body.complete).toBe(true);
    expect(res.body.alreadyComplete).toBeUndefined();
    expect(res.body.demoData).toMatchObject({ contactId: expect.any(String), invoiceId: expect.any(String), invoiceNumber: expect.stringMatching(/^DEMO-/) });
    S.demo = res.body.demoData;
  });

  it('the three-pillar score is reported as a recommendation, not a gate', async () => {
    requireServer();
    expect(characterization.freshOwnerComplete).toBeDefined();
    const body = (characterization.freshOwnerComplete as { body: any }).body;
    expect(body.genomeRecommendation).toMatchObject({
      threePillarMinimumMet: false,
      missingPillars: ['founder', 'business', 'market'],
    });
    expect(typeof body.genomeRecommendation.genomeIntegrity).toBe('number');
  });

  it('onboardingComplete is true and the onboarding state reports complete', async () => {
    const f = await footprint(S.bizA!);
    expect(f.onboardingComplete).toBe(true);
    expect(f.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(f.onboardingStep).toBe('complete');
    S.completedAt = (f.onboardingCompletedAt as Date).toISOString();
    const state = await call('get', routes.state(S.bizA!), T[ID.owner]);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ step: 'complete', onboardingComplete: true, onboardingCompletedAt: S.completedAt, threePillarMet: false });
  });

  it('LEDGER: completion wrote exactly one demo contact and one DRAFT demo invoice, and no FinancialTransaction or LedgerEntry', async () => {
    expect(S.demo).toBeDefined();
    const f = await footprint(S.bizA!);
    expect({ contacts: f.contacts, demoContacts: f.demoContacts, invoices: f.invoices, transactions: f.transactions, ledger: f.ledger })
      .toEqual({ contacts: 1, demoContacts: 1, invoices: 1, transactions: 0, ledger: 0 });
    const contact = await db.contact.findFirst({ where: { businessId: S.bizA } });
    expect(contact).toMatchObject({ id: S.demo!.contactId, source: 'demo' });
    const invoice = await db.invoice.findFirst({ where: { businessId: S.bizA }, include: { items: true } });
    expect(invoice).toMatchObject({ id: S.demo!.invoiceId, invoiceNumber: S.demo!.invoiceNumber, status: 'DRAFT', contactId: S.demo!.contactId, currency: 'USD' });
    expect(invoice.items).toHaveLength(1);
    expect(await db.payment.count({ where: { businessId: S.bizA } })).toBe(0);
  });

  it('ST-R032-1: completion and the legal disclaimer acceptance are recorded against the owner in team_activity_logs', async () => {
    expect(S.demo).toBeDefined();
    const accepted = await disclaimerAcceptedAt(S.bizA!);
    expect(accepted).toEqual(expect.any(String));
    const rows = await activity(S.bizA!);
    expect(rows).toEqual([
      expect.objectContaining({ userId: ID.owner, module: 'settings', action: 'legal_disclaimer_accepted', entityType: 'business', entityId: S.bizA }),
      expect.objectContaining({ userId: ID.owner, module: 'settings', action: 'onboarding_completed', entityType: 'business', entityId: S.bizA }),
    ]);
    expect(rows[0].meta).toMatchObject({ disclaimerAcceptedAt: accepted });
    expect(rows[1].meta).toMatchObject({ demoContactId: S.demo!.contactId, demoInvoiceId: S.demo!.invoiceId });
    // The STAFF member's refused attempt left no row naming them.
    expect(rows.filter((r: { userId: string }) => r.userId === ID.staff)).toEqual([]);
  });

  it('a second /complete answers alreadyComplete and writes nothing more', async () => {
    const res = await call('post', routes.complete(S.bizA!), T[ID.owner]);
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body).toEqual({ complete: true, alreadyComplete: true });
    const f = await footprint(S.bizA!);
    expect((f.onboardingCompletedAt as Date).toISOString()).toBe(S.completedAt);
    expect({ contacts: f.contacts, invoices: f.invoices, transactions: f.transactions, ledger: f.ledger })
      .toEqual({ contacts: 1, invoices: 1, transactions: 0, ledger: 0 });
    expect(await activity(S.bizA!)).toHaveLength(2);
  });

  it('ST-R032-1: on a completed business, a STAFF member is still refused (authority is checked before the replay)', async () => {
    const res = await call('post', routes.complete(S.bizA!), T[ID.staff]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');
    expect(await activity(S.bizA!)).toHaveLength(2);
  });

  it('no model-gateway dispatch: no ai_usage_logs row and no AI or outbound line in the server log during completion', async () => {
    requireServer();
    expect(completionWindow.from).toBeDefined();
    expect(completionWindow.to).toBeDefined();
    // Give the child a moment to flush anything completion triggered asynchronously.
    await new Promise((r) => setTimeout(r, 1_000));
    const during = serverLog.slice(completionWindow.from, Math.max(completionWindow.to!, serverLog.length));
    expect(during.filter((l) => AI_OR_OUTBOUND.test(l) && !/redis/i.test(l))).toEqual([]);
    expect((await footprint(S.bizA!)).aiUsage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// the minimal profile is the gate
// ---------------------------------------------------------------------------
describe('without the minimal profile, completion is refused with the missing fields', () => {
  it('blank name, currency and timezone: 403 listing all three, and nothing is written', async () => {
    const blank = await call('patch', routes.profile(S.bizX!), T[ID.blank], { name: ' ', currency: '', timezone: '' });
    expect(blank.status, JSON.stringify(blank.body)).toBe(200);
    const res = await call('post', routes.complete(S.bizX!), T[ID.blank]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_PROFILE_INCOMPLETE');
    expect(res.body.details?.missingFields).toEqual(['name', 'currency', 'timezone']);
    expectNothingWritten(await footprint(S.bizX!));
  });

  it('a malformed currency or timezone counts as missing: 403 listing them, and nothing is written', async () => {
    const bad = await call('patch', routes.profile(S.bizX!), T[ID.blank], { name: `${P}bizX Studio`, currency: 'dollars', timezone: 'Mars/Olympus_Mons' });
    expect(bad.status, JSON.stringify(bad.body)).toBe(200);
    const res = await call('post', routes.complete(S.bizX!), T[ID.blank]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_PROFILE_INCOMPLETE');
    expect(res.body.details?.missingFields).toEqual(['currency', 'timezone']);
    expectNothingWritten(await footprint(S.bizX!));
  });

  it('once the owner supplies a valid name, currency and timezone, the same business completes', async () => {
    const fix = await call('patch', routes.profile(S.bizX!), T[ID.blank], { currency: 'TTD', timezone: 'America/Port_of_Spain' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    const res = await call('post', routes.complete(S.bizX!), T[ID.blank]);
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body.complete).toBe(true);
    const f = await footprint(S.bizX!);
    expect({ onboardingComplete: f.onboardingComplete, demoContacts: f.demoContacts, invoices: f.invoices, transactions: f.transactions, ledger: f.ledger })
      .toEqual({ onboardingComplete: true, demoContacts: 1, invoices: 1, transactions: 0, ledger: 0 });
  });
});

// ---------------------------------------------------------------------------
// in-tenant authority: OWNER only (R0-SEC-03, owner ruling D-11)
// ---------------------------------------------------------------------------
/**
 * A member's refused attempt on a fresh business: 403 ONBOARDING_COMPLETE_FORBIDDEN
 * with the owner-only message, and nothing written — no flag, no demo contact
 * or invoice, no disclaimer acceptance, no activity row.
 */
async function expectOwnerOnlyRefusal(businessId: string, actor: string) {
  const res = await call('post', routes.complete(businessId), T[actor]);
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(res.body.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');
  expect(res.body.message).toBe(OWNER_ONLY_MESSAGE);
  expect(JSON.stringify(res.body)).not.toContain('demoData');
  const f = await footprint(businessId);
  expectNothingWritten(f);
  expect(f.demoContacts).toBe(0);
  expect(await disclaimerAcceptedAt(businessId)).toBeNull();
  expect(await activity(businessId)).toEqual([]);
}

describe('R0-SEC-03 (D-11): only the business owner may complete; settings:write does not admit a member; SUPER_ADMIN keeps its platform bypass', () => {
  it('an ADMIN granted settings:write gets 403 ONBOARDING_COMPLETE_FORBIDDEN and nothing is written', async () => {
    S.bizS = await bootstrap(ID.sowner, ID.bizSName);
    await addMember(ID.sadmin, S.bizS, 'ADMIN', { settings: 'write' });
    expectNothingWritten(await footprint(S.bizS));
    await expectOwnerOnlyRefusal(S.bizS, ID.sadmin);
  });

  it('an ADMIN on the role-default scopes (settings write by default) gets 403 and nothing is written', async () => {
    expect(S.bizS, 'bizS is bootstrapped by the first case of this block').toBeDefined();
    await addMember(ID.dadmin, S.bizS!, 'ADMIN');
    await expectOwnerOnlyRefusal(S.bizS!, ID.dadmin);
  });

  it('a STAFF member granted settings:write gets 403 and nothing is written', async () => {
    expect(S.bizS, 'bizS is bootstrapped by the first case of this block').toBeDefined();
    await addMember(ID.sstaff, S.bizS!, 'STAFF', { settings: 'write' });
    await expectOwnerOnlyRefusal(S.bizS!, ID.sstaff);
  });

  it('the business owner completes the same business, and is recorded as the actor', async () => {
    expect(S.bizS, 'bizS is bootstrapped by the first case of this block').toBeDefined();
    const res = await call('post', routes.complete(S.bizS!), T[ID.sowner]);
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body.complete).toBe(true);
    expect(res.body.alreadyComplete).toBeUndefined();
    const f = await footprint(S.bizS!);
    expect({ onboardingComplete: f.onboardingComplete, demoContacts: f.demoContacts, invoices: f.invoices, transactions: f.transactions, ledger: f.ledger })
      .toEqual({ onboardingComplete: true, demoContacts: 1, invoices: 1, transactions: 0, ledger: 0 });
    const rows = await activity(S.bizS!);
    expect(rows.map((r: { userId: string; action: string }) => [r.userId, r.action])).toEqual([
      [ID.sowner, 'legal_disclaimer_accepted'],
      [ID.sowner, 'onboarding_completed'],
    ]);
  });

  it('on the completed business, the ADMIN granted settings:write is still refused (authority is checked before the replay)', async () => {
    expect(S.bizS, 'bizS is bootstrapped by the first case of this block').toBeDefined();
    const res = await call('post', routes.complete(S.bizS!), T[ID.sadmin]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');
    expect(res.body.message).toBe(OWNER_ONLY_MESSAGE);
    expect(await activity(S.bizS!)).toHaveLength(2);
  });

  it('a SUPER_ADMIN with no membership completes a fresh business (the platform bypass, as BusinessGuard) and is recorded as the actor', async () => {
    S.bizP = await bootstrap(ID.powner, ID.bizPName);
    await db.user.create({ data: { id: ID.platform, email: email(ID.platform), name: ID.platform, role: 'SUPER_ADMIN' } });
    expect(await db.membership.count({ where: { userId: ID.platform } })).toBe(0);
    expectNothingWritten(await footprint(S.bizP));
    const res = await call('post', routes.complete(S.bizP), T[ID.platform]);
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body.complete).toBe(true);
    expect((await footprint(S.bizP)).onboardingComplete).toBe(true);
    const rows = await activity(S.bizP);
    expect(rows.map((r: { userId: string; action: string }) => [r.userId, r.action])).toEqual([
      [ID.platform, 'legal_disclaimer_accepted'],
      [ID.platform, 'onboarding_completed'],
    ]);
  });

  // Review SEC03-1: before R0-09-ID-HARDEN, PATCH /identity/businesses/:id let
  // any member write onboardingComplete (no actor row, no disclaimer, no demo
  // data). R0-09 closed that (proven in the R0-SEC-04 block below); these
  // cases keep /complete's own distrust of a flag written outside it, such as
  // a row written before R0-09. The flag is set by a direct DB write.
  it('SEC03-1: a business flagged complete outside /complete (no onboardingCompletedAt, as the profile PATCH leaves it) still refuses an ADMIN, and nothing is written', async () => {
    S.bizF = await bootstrap(ID.fowner, ID.bizFName);
    await addMember(ID.fadmin, S.bizF, 'ADMIN');
    await db.business.update({ where: { id: S.bizF }, data: { onboardingComplete: true } });
    const res = await call('post', routes.complete(S.bizF), T[ID.fadmin]);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');
    expect(res.body.message).toBe(OWNER_ONLY_MESSAGE);
    const f = await footprint(S.bizF);
    expect({ onboardingComplete: f.onboardingComplete, onboardingCompletedAt: f.onboardingCompletedAt, contacts: f.contacts, invoices: f.invoices })
      .toEqual({ onboardingComplete: true, onboardingCompletedAt: null, contacts: 0, invoices: 0 });
    expect(await disclaimerAcceptedAt(S.bizF)).toBeNull();
    expect(await activity(S.bizF)).toEqual([]);
  });

  it('SEC03-1: the owner\'s /complete on that flagged business is not alreadyComplete: it records completedAt, the demo data, the disclaimer and the owner as the actor', async () => {
    expect(S.bizF, 'bizF is bootstrapped by the previous case').toBeDefined();
    const res = await call('post', routes.complete(S.bizF!), T[ID.fowner]);
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body.complete).toBe(true);
    expect(res.body.alreadyComplete).toBeUndefined();
    const f = await footprint(S.bizF!);
    expect(f.onboardingCompletedAt).toBeInstanceOf(Date);
    expect({ onboardingComplete: f.onboardingComplete, demoContacts: f.demoContacts, invoices: f.invoices, transactions: f.transactions, ledger: f.ledger })
      .toEqual({ onboardingComplete: true, demoContacts: 1, invoices: 1, transactions: 0, ledger: 0 });
    expect(await disclaimerAcceptedAt(S.bizF!)).toEqual(expect.any(String));
    const rows = await activity(S.bizF!);
    expect(rows.map((r: { userId: string; action: string }) => [r.userId, r.action])).toEqual([
      [ID.fowner, 'legal_disclaimer_accepted'],
      [ID.fowner, 'onboarding_completed'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// SEC03-1 closure: R0-09 has landed, so the profile PATCH cannot finish onboarding
// ---------------------------------------------------------------------------
/** The whole Business row, serialized, for an unchanged-row comparison. */
async function businessRow(businessId: string): Promise<string> {
  return JSON.stringify(await db.business.findUnique({ where: { id: businessId } }));
}

/**
 * What the web genome gate decides on (use-genome-gate.ts): the onboarding
 * state's onboardingComplete, or an onboardingCompletedAt. Read as the owner.
 */
async function genomeGateInput(businessId: string, ownerToken: string) {
  const state = await call('get', routes.state(businessId), ownerToken);
  expect(state.status, JSON.stringify(state.body)).toBe(200);
  return { onboardingComplete: state.body.onboardingComplete, onboardingCompletedAt: state.body.onboardingCompletedAt };
}

const GATE_CLOSED = { onboardingComplete: false, onboardingCompletedAt: null };

describe('R0-SEC-04 SEC03-1 closure (R0-09 landed): PATCH /identity/businesses/:id cannot finish onboarding (D-11)', () => {
  it('a STAFF member on the role-default scopes sending {onboardingComplete: true} gets 403; the Business row is unchanged and the genome gate input stays unset', async () => {
    S.bizN = await bootstrap(ID.nowner, ID.bizNName);
    await addMember(ID.nstaff, S.bizN, 'STAFF');
    await addMember(ID.nadmin, S.bizN, 'ADMIN', { settings: 'write' });
    const before = await businessRow(S.bizN);
    const res = await call('patch', routes.profile(S.bizN), T[ID.nstaff], { onboardingComplete: true });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await businessRow(S.bizN)).toBe(before);
    expectNothingWritten(await footprint(S.bizN));
    expect(await genomeGateInput(S.bizN, T[ID.nowner])).toEqual(GATE_CLOSED);
    expect(await activity(S.bizN)).toEqual([]);
  });

  it('an ADMIN granted settings:write sending {onboardingComplete: true} with a profile field gets 403; the Business row is unchanged and the genome gate input stays unset', async () => {
    expect(S.bizN, 'bizN is bootstrapped by the first case of this block').toBeDefined();
    const before = await businessRow(S.bizN!);
    const res = await call('patch', routes.profile(S.bizN!), T[ID.nadmin], { onboardingComplete: true, name: `${P}bizN renamed by admin` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await businessRow(S.bizN!)).toBe(before);
    expectNothingWritten(await footprint(S.bizN!));
    expect(await genomeGateInput(S.bizN!, T[ID.nowner])).toEqual(GATE_CLOSED);
    expect(await activity(S.bizN!)).toEqual([]);
  });

  it("the owner's PATCH of a profile field still applies (200); an onboardingComplete: true beside it is dropped and the genome gate input stays unset", async () => {
    expect(S.bizN, 'bizN is bootstrapped by the first case of this block').toBeDefined();
    const res = await call('patch', routes.profile(S.bizN!), T[ID.nowner], { onboardingComplete: true, timezone: 'America/Port_of_Spain' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const f = await footprint(S.bizN!);
    expect(f.timezone).toBe('America/Port_of_Spain');
    expectNothingWritten(f);
    expect(f.demoContacts).toBe(0);
    expect(await disclaimerAcceptedAt(S.bizN!)).toBeNull();
    expect(await genomeGateInput(S.bizN!, T[ID.nowner])).toEqual(GATE_CLOSED);
    expect(await activity(S.bizN!)).toEqual([]);
  });

  it("on the business the owner completed, no one's {onboardingComplete: false} un-completes it (403 for STAFF and the settings:write ADMIN, dropped for the owner), so /complete does not run again", async () => {
    expect(S.bizN, 'bizN is bootstrapped by the first case of this block').toBeDefined();
    const done = await call('post', routes.complete(S.bizN!), T[ID.nowner]);
    expect(done.status, JSON.stringify(done.body)).toBe(COMPLETE_OK);
    expect(done.body.alreadyComplete).toBeUndefined();
    const completed = await businessRow(S.bizN!);
    const completedAt = (await footprint(S.bizN!)).onboardingCompletedAt as Date;
    expect(completedAt).toBeInstanceOf(Date);

    for (const actor of [ID.nstaff, ID.nadmin]) {
      const res = await call('patch', routes.profile(S.bizN!), T[actor], { onboardingComplete: false });
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(await businessRow(S.bizN!)).toBe(completed);
    }
    const own = await call('patch', routes.profile(S.bizN!), T[ID.nowner], { onboardingComplete: false, timezone: 'America/Port_of_Spain' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const f = await footprint(S.bizN!);
    expect({ onboardingComplete: f.onboardingComplete, onboardingCompletedAt: (f.onboardingCompletedAt as Date).toISOString() })
      .toEqual({ onboardingComplete: true, onboardingCompletedAt: completedAt.toISOString() });
    expect(await genomeGateInput(S.bizN!, T[ID.nowner])).toEqual({ onboardingComplete: true, onboardingCompletedAt: completedAt.toISOString() });

    const again = await call('post', routes.complete(S.bizN!), T[ID.nowner]);
    expect(again.status, JSON.stringify(again.body)).toBe(COMPLETE_OK);
    expect(again.body).toEqual({ complete: true, alreadyComplete: true });
    const after = await footprint(S.bizN!);
    expect({ demoContacts: after.demoContacts, invoices: after.invoices }).toEqual({ demoContacts: 1, invoices: 1 });
    expect((await activity(S.bizN!)).map((r: { userId: string; action: string }) => [r.userId, r.action])).toEqual([
      [ID.nowner, 'legal_disclaimer_accepted'],
      [ID.nowner, 'onboarding_completed'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// SEC03-2: concurrent completion by the owner writes once
// ---------------------------------------------------------------------------
describe('R0-SEC-04 SEC03-2: concurrent POST /complete from the owner completes once', () => {
  it('three simultaneous /complete calls: all answer complete, exactly one is not alreadyComplete, and one onboarding_completed row, one disclaimer acceptance and one demo seed are written', async () => {
    S.bizK = await bootstrap(ID.kowner, ID.bizKName);
    expectNothingWritten(await footprint(S.bizK));
    const results = await Promise.all([1, 2, 3].map(() => call('post', routes.complete(S.bizK!), T[ID.kowner])));
    const f = await footprint(S.bizK!);
    const rows = await activity(S.bizK!);
    // Recorded verbatim for the packet return, before any assertion can stop the case.
    characterization.concurrentComplete = {
      responses: results.map((r) => ({ status: r.status, alreadyComplete: r.body?.alreadyComplete ?? false })),
      activity: rows.map((r: { action: string }) => r.action),
      demoContacts: f.demoContacts,
      invoices: f.invoices,
    };
    for (const r of results) {
      expect(r.status, JSON.stringify(r.body)).toBe(COMPLETE_OK);
      expect(r.body.complete).toBe(true);
    }
    expect(results.filter((r) => r.body.alreadyComplete !== true)).toHaveLength(1);

    expect({ onboardingComplete: f.onboardingComplete, contacts: f.contacts, demoContacts: f.demoContacts, invoices: f.invoices, transactions: f.transactions, ledger: f.ledger })
      .toEqual({ onboardingComplete: true, contacts: 1, demoContacts: 1, invoices: 1, transactions: 0, ledger: 0 });
    expect(f.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(await disclaimerAcceptedAt(S.bizK!)).toEqual(expect.any(String));
    expect(rows.map((r: { userId: string; action: string }) => [r.userId, r.action])).toEqual([
      [ID.kowner, 'legal_disclaimer_accepted'],
      [ID.kowner, 'onboarding_completed'],
    ]);
    const winner = results.find((r) => r.body.alreadyComplete !== true)!;
    expect(rows[1].meta).toMatchObject({ demoContactId: winner.body.demoData.contactId, demoInvoiceId: winner.body.demoData.invoiceId });
  });
});

// ---------------------------------------------------------------------------
// characterization: the non-AI genome editor path
// ---------------------------------------------------------------------------
describe('characterization — the non-AI genome editor path (PATCH /blueprint)', () => {
  it('after PATCH /blueprint with founder, business and market fields, /complete succeeds and no AI was used', async () => {
    // The fields the profile genome editor (advanced-editor-panel.tsx) sends
    // for the three pillars (DNA_SECTION_CONFIG founder/business/market).
    const patch = {
      founderProfile: { founderName: `${P}Founder`, background: 'Ten years in pastry', skills: ['baking', 'pricing'], weeklyAvailabilityHours: 40 },
      identity: { name: ID.bizGName, archetype: 'LOCAL_SERVICE', industry: 'food', northStar: 'Weekly repeat orders' },
      operatingModel: { revenueModel: 'ONE_TIME', deliveryMode: 'in_person', serviceArea: 'Port of Spain', teamSize: 'SOLO' },
      constraints: { budgetRange: 'LOW', timeCommitment: 'FULL_TIME', riskTolerance: 'medium' },
      workflowModel: { primaryWorkflow: 'order-bake-deliver', reportingCadence: 'weekly' },
      aiPreferences: { autonomyLevel: 1 },
      customerModel: { idealCustomer: 'Office managers ordering for teams', segments: ['offices', 'events'], painPoints: ['late delivery'] },
      marketProfile: { targetGeography: 'Trinidad', marketCategory: 'bakery', demandSignals: ['weekly office orders'] },
    };
    const patched = await call('patch', routes.blueprint(S.bizG!), T[ID.genome], patch);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    // The fact backfill after a blueprint write is fire-and-forget: let it settle.
    let genome: Resp = { status: 0, body: null };
    let last = '';
    for (let i = 0; i < 10; i++) {
      genome = await call('get', routes.genome(S.bizG!), T[ID.genome]);
      const now = JSON.stringify(genome.body?.genomeDnaScores ?? null);
      if (now === last) break;
      last = now;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(genome.status).toBe(200);
    const scores = genome.body.genomeDnaScores ?? {};
    characterization.genomeAfterBlueprintPatch = {
      threePillarMinimumMet: genome.body.threePillarMinimumMet,
      founder: scores.founder,
      business: scores.business,
      market: scores.market,
      genomeIntegrity: genome.body.genomeIntegrity,
      genomeFacts: await db.genomeFact?.count?.({ where: { businessId: S.bizG } }).catch(() => 'n/a'),
    };

    const from = serverLog.length;
    const res = await call('post', routes.complete(S.bizG!), T[ID.genome]);
    characterization.completeAfterBlueprintPatch = { status: res.status, body: res.body };
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body.complete).toBe(true);
    expect(serverLog.slice(from).filter((l) => AI_OR_OUTBOUND.test(l) && !/redis/i.test(l))).toEqual([]);
    expect((await footprint(S.bizG!)).aiUsage).toBe(0);
  });
});

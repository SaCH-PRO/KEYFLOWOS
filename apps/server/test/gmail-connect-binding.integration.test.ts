/**
 * R0-07 / R0-CMF5-GMAIL-CONNECT-BINDING — the business mailbox is connected,
 * replaced and disconnected by the business owner only, and a Gmail OAuth
 * callback links nothing until the user who started it confirms it. REAL
 * database, REAL guards, REAL GmailService; Google's token exchange and userinfo
 * are stubbed in process (no network).
 *
 * The mailbox is the one invoices, reminders, receipts and quotes are sent from
 * (commerce/gmail.service.ts sendEmail), so it is business configuration: owner
 * ruling D-11 makes business configuration OWNER only.
 *
 * RED-BEFORE (COST-LEDGER-001 section 7 items 4 and 5; R0-07 review ST-2 and
 * ST-3), on pkt/R0-CMF4-SEND-EMAIL-ORDER-repair (acfda3e6):
 *   - GET /commerce/businesses/:b/gmail/auth-url was guarded by revenue:read, so
 *     a STAFF member with role defaults got 200 and a Google consent URL that
 *     connects (or replaces) the business mailbox; DELETE .../gmail was
 *     revenue:write, so STAFF granted revenue:write disconnected it;
 *   - the signed OAuth state named only the business, and GET
 *     /commerce/gmail/callback needs no login, so whoever completed Google
 *     consent on a forwarded auth URL linked THEIR mailbox to the business in
 *     that one unauthenticated request.
 *
 * THE RULE (GREEN-AFTER): auth-url, the new POST .../gmail/confirm and DELETE
 * .../gmail are allowed for the business owner (an OWNER membership or
 * Business.ownerId, the rule IdentityService.assertBusinessOwner applies) and
 * SUPER_ADMIN (the platform bypass BusinessGuard grants); everyone else gets 403
 * {code:'GMAIL_OWNER_ONLY'}. The state carries the initiating user id, the
 * business id, a nonce and an expiry, HMAC-signed with GOOGLE_STATE_SECRET and
 * single-use per process (R0-07). The callback still needs no login (Google
 * redirects the browser, and the web proxy at /api/commerce/gmail/callback
 * forwards no session), so it does not link: it exchanges the code and stores
 * the tokens as a PENDING connection (an existing connector_accounts row:
 * provider GOOGLE, service GMAIL, status PENDING, tokens encrypted, bound in
 * settings to the state's user, business and nonce, with a 15-minute window),
 * then redirects with gmail=pending&pending=<id>. The connection becomes active
 * only when the same user, still the owner, POSTs the pending id to
 * .../gmail/confirm from an authenticated request. An expired, replayed,
 * forged or user-less state links nothing and redirects with gmail=error; a
 * pending id confirmed by anyone else, on another business, after its window
 * or a second time answers 404 {code:'GMAIL_PENDING_NOT_FOUND'} and links
 * nothing.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CommerceController and GmailService, with the production
 * GlobalHttpExceptionFilter and ValidationPipe. Identity attachment is the one
 * stand-in (a test middleware reads `x-k07d-user` and attaches the seeded user
 * row, as the Supabase AuthMiddleware would). The controller's other
 * collaborators are empty stand-ins no case reaches. globalThis.fetch answers
 * oauth2.googleapis.com/token and www.googleapis.com/oauth2/v2/userinfo from
 * this file's table of Google accounts and refuses (and records) anything else.
 *
 * Fixtures: prefix `k07d_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomBytes } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k07d_';
const HEADER = 'x-k07d-user';

const ID = {
  owner: `${P}owner`,           // Business.ownerId + OWNER membership of biz and bizTwo
  coOwner: `${P}coOwner`,       // a second OWNER membership of biz (demoted in B10)
  staff: `${P}staff`,           // STAFF of biz, role-default scopes (revenue: read)
  staffAdmin: `${P}staffAdmin`, // STAFF of biz granted revenue: admin
  staffWrite: `${P}staffWrite`, // STAFF of biz granted revenue: write
  admin: `${P}admin`,           // ADMIN of biz, role-default scopes (revenue: admin)
  distOwner: `${P}distOwner`,   // Business.ownerId of bizDist, no membership row
  superAdmin: `${P}superAdmin`, // User.role SUPER_ADMIN, no membership
  stranger: `${P}stranger`,     // no membership anywhere (the person a URL was forwarded to)
  biz: `${P}biz`,
  bizTwo: `${P}bizTwo`,
  bizDist: `${P}bizDist`,
};
const USERS = [ID.owner, ID.coOwner, ID.staff, ID.staffAdmin, ID.staffWrite, ID.admin, ID.distOwner, ID.superAdmin, ID.stranger];
const emailOf = (id: string) => `${id}@k07d.test.local`;
const OWNER_ONLY = 'GMAIL_OWNER_ONLY';
const PENDING_NOT_FOUND = 'GMAIL_PENDING_NOT_FOUND';

const OAUTH_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: `${P}client-id`,
  GOOGLE_CLIENT_SECRET: `${P}client-secret`,
  GMAIL_REDIRECT_URI: 'http://localhost:3001/api/commerce/gmail/callback',
  GOOGLE_STATE_SECRET: `${P}state-secret`,
};
const OAUTH_KEYS = [...Object.keys(OAUTH_ENV), 'GOOGLE_REDIRECT_URI'];
const savedEnv: Record<string, string | undefined> = {};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

let db: any;
let app: any;
let realFetch: typeof fetch;

/** A Google account the stubbed consent screen can sign in as: one code, one mailbox, one token pair. */
interface GoogleAccount { code: string; email: string; access: string; refresh: string }
const accountsByCode = new Map<string, GoogleAccount>();
const accountsByAccess = new Map<string, GoogleAccount>();
let accountSeq = 0;
function googleAccount(label: string): GoogleAccount {
  accountSeq += 1;
  const tag = `${label}_${accountSeq}`;
  const account = {
    code: `${P}code_${tag}`,
    email: `${P}${tag}@gmail.test`,
    access: `${P}access_${tag}`,
    refresh: `${P}refresh_${tag}`,
  };
  accountsByCode.set(account.code, account);
  accountsByAccess.set(account.access, account);
  return account;
}
/** A code Google refuses to exchange (B12). */
const REFUSED_CODE = `${P}code_refused`;

/** Every authorization code the stubbed token endpoint was asked to exchange. */
const exchanges: string[] = [];
/** Every other outbound fetch attempted during the suite (refused). */
const outbound: string[] = [];

async function stubFetch(input: any, init?: any): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input?.url ?? input);
  if (url === TOKEN_URL && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
    const body = new URLSearchParams(String(init?.body ?? ''));
    const code = body.get('code') ?? '';
    exchanges.push(code);
    const account = accountsByCode.get(code);
    if (body.get('grant_type') !== 'authorization_code' || !account || code === REFUSED_CODE) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response(
      JSON.stringify({ access_token: account.access, refresh_token: account.refresh, expires_in: 3600, token_type: 'Bearer' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (url === USERINFO_URL) {
    const auth = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? '');
    const account = accountsByAccess.get(auth.replace(/^Bearer /, ''));
    if (!account) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ email: account.email, name: 'K07D Mailbox' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  outbound.push(url);
  throw new Error(`k07d: outbound fetch refused: ${url}`);
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM connector_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function as<T extends { set: (k: string, v: string) => T }>(req: T, actor?: string): T {
  return actor ? req.set(HEADER, actor) : req;
}

function authUrl(businessId: string, actor?: string) {
  return as(agent().get(`/commerce/businesses/${businessId}/gmail/auth-url`), actor);
}

function confirm(businessId: string, pendingId: unknown, actor?: string) {
  return as(agent().post(`/commerce/businesses/${businessId}/gmail/confirm`), actor).send({ pendingId });
}

function disconnect(businessId: string, actor?: string) {
  return as(agent().delete(`/commerce/businesses/${businessId}/gmail`), actor);
}

function status(businessId: string, actor = ID.owner) {
  return as(agent().get(`/commerce/businesses/${businessId}/gmail/status`), actor);
}

/** The Google redirect: the browser that completed consent, with whatever session it has (none by default). */
function callback(state: string, code: string, actor?: string) {
  return as(agent().get('/commerce/gmail/callback').query({ state, code }), actor);
}

function stateOf(url: string): string {
  const state = new URL(url).searchParams.get('state');
  expect(state, url).toBeTruthy();
  return state as string;
}

function decodeState(state: string): { payload: string; signature: string; claims: any } {
  const decoded = Buffer.from(state, 'base64').toString('utf8');
  const at = decoded.lastIndexOf('.');
  const payload = decoded.slice(0, at);
  return { payload, signature: decoded.slice(at + 1), claims: JSON.parse(payload) };
}

/** A state signed with the deployment's secret, as GmailService signs one. */
function signState(claims: Record<string, unknown>, secret = OAUTH_ENV.GOOGLE_STATE_SECRET): string {
  const payload = JSON.stringify(claims);
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64');
}

/** Where a callback sent the browser: the gmail=, reason= and pending= query parameters. */
function redirectOf(res: { status: number; headers: Record<string, any> }) {
  expect([301, 302, 303, 307, 308], JSON.stringify(res.headers)).toContain(res.status);
  const location = new URL(String(res.headers.location));
  return {
    path: location.pathname,
    gmail: location.searchParams.get('gmail'),
    reason: location.searchParams.get('reason'),
    pending: location.searchParams.get('pending'),
  };
}

/** The business's mailbox columns as stored (raw SQL: what a database dump holds). */
async function mailboxOf(businessId: string): Promise<{ email: string | null; access: string | null; refresh: string | null; expiry: Date | null }> {
  const rows = await db.$queryRawUnsafe(
    'SELECT gmail_email AS email, gmail_access_token AS access, gmail_refresh_token AS refresh, gmail_token_expiry AS expiry FROM businesses WHERE id = $1',
    businessId,
  );
  return rows[0];
}

/** The pending Gmail connections of a business (raw SQL). */
async function pendingOf(businessId: string): Promise<any[]> {
  return db.$queryRawUnsafe(
    `SELECT id, business_id, provider, service, status, account_email, access_token_encrypted, refresh_token_encrypted, token_expires_at, settings
       FROM connector_accounts WHERE business_id = $1 AND service = 'GMAIL' ORDER BY created_at ASC`,
    businessId,
  );
}

async function clearMailbox(businessId: string) {
  await db.$executeRawUnsafe(
    'UPDATE businesses SET gmail_email = NULL, gmail_access_token = NULL, gmail_refresh_token = NULL, gmail_token_expiry = NULL WHERE id = $1',
    businessId,
  );
}

async function clearPending(businessId: string) {
  await db.$executeRawUnsafe('DELETE FROM connector_accounts WHERE business_id = $1', businessId);
}

/** A mailbox already active on a business (written through the Prisma extension, so its tokens are ciphertext). */
async function seedMailbox(businessId: string, account: GoogleAccount) {
  await db.business.update({
    where: { id: businessId },
    data: {
      gmailEmail: account.email,
      gmailAccessToken: account.access,
      gmailRefreshToken: account.refresh,
      gmailTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

/** Owner starts, the browser that completes consent comes back: the pending id the callback redirected with. */
async function startAndComplete(businessId: string, actor: string, account: GoogleAccount, callbackActor?: string) {
  const start = await authUrl(businessId, actor);
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = stateOf(start.body.url);
  const back = redirectOf(await callback(state, account.code, callbackActor));
  return { state, ...back };
}

function expectOwnerOnly(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(res.body.code).toBe(OWNER_ONLY);
  expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
}

function expectPendingNotFound(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(404);
  expect(res.body.code).toBe(PENDING_NOT_FOUND);
}

beforeAll(async () => {
  for (const key of OAUTH_KEYS) savedEnv[key] = process.env[key];
  delete process.env.GOOGLE_REDIRECT_URI;
  Object.assign(process.env, OAUTH_ENV);

  realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch as any;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // Present only because the controller's other routes declare them; no case here reaches them.
      PublicRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: {} },
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      // The service under test, real, built with a Google OAuth client and state secret. No GmailConnector (it is @Optional).
      GmailService,
      { provide: CommerceService, useValue: {} },
      { provide: InvoiceReceiptBuilderService, useValue: {} },
      { provide: TimeEntryService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'K07D Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizTwo, name: 'K07D Biz Two', slug: `${P}biztwo`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizDist, name: 'K07D Dist Biz', slug: `${P}bizdist`, ownerId: ID.distOwner, currency: 'TTD' } });
  const memberships: Array<[string, string, string, Record<string, string> | null]> = [
    [ID.owner, ID.biz, 'OWNER', null],
    [ID.owner, ID.bizTwo, 'OWNER', null],
    [ID.coOwner, ID.biz, 'OWNER', null],
    [ID.staff, ID.biz, 'STAFF', null],
    [ID.staffAdmin, ID.biz, 'STAFF', { revenue: 'admin' }],
    [ID.staffWrite, ID.biz, 'STAFF', { revenue: 'write' }],
    [ID.admin, ID.biz, 'ADMIN', null],
  ];
  let n = 0;
  for (const [userId, businessId, role, permissionScopes] of memberships) {
    n += 1;
    await db.membership.create({
      data: { id: `${P}m${n}`, userId, businessId, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
});

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  if (realFetch) globalThis.fetch = realFetch;
  for (const key of OAUTH_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('R0-CMF5 fixture sanity (real rows)', () => {
  it('[R0-CMF5-X01] seeded three businesses, nine users and seven memberships; no business has a mailbox or a pending Gmail connection', async () => {
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(9);
    expect(await db.membership.count({ where: { businessId: { startsWith: P } } })).toBe(7);
    for (const businessId of [ID.biz, ID.bizTwo, ID.bizDist]) {
      expect((await mailboxOf(businessId)).email).toBeNull();
      expect(await pendingOf(businessId)).toEqual([]);
    }
  });
});

describe('R0-CMF5 starting a Gmail connection is OWNER only (ST-3, D-11)', () => {
  it('[R0-CMF5-A01] RED-BEFORE: a STAFF member with role-default scopes (revenue: read) asks for the auth URL: 403 GMAIL_OWNER_ONLY, no Google URL', async () => {
    expectOwnerOnly(await authUrl(ID.biz, ID.staff));
  });

  it('[R0-CMF5-A02] RED-BEFORE: an ADMIN (role defaults, revenue: admin) and a STAFF member granted revenue: admin are refused the auth URL the same way', async () => {
    expectOwnerOnly(await authUrl(ID.biz, ID.admin));
    expectOwnerOnly(await authUrl(ID.biz, ID.staffAdmin));
  });

  it('[R0-CMF5-A03] RED-BEFORE: the OWNER gets the Google URL; its state is HMAC-SHA256-signed with GOOGLE_STATE_SECRET and carries the owner\'s user id, the business id, a nonce, a 10-minute expiry and purpose gmail', async () => {
    const before = Date.now();
    const res = await authUrl(ID.biz, ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/auth');
    expect(url.searchParams.get('client_id')).toBe(OAUTH_ENV.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(OAUTH_ENV.GMAIL_REDIRECT_URI);

    const { payload, signature, claims } = decodeState(stateOf(res.body.url));
    expect(signature).toBe(createHmac('sha256', OAUTH_ENV.GOOGLE_STATE_SECRET).update(payload).digest('hex'));
    expect(claims).toMatchObject({ userId: ID.owner, businessId: ID.biz, purpose: 'gmail' });
    expect(claims.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(claims.exp).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 1000);
    expect(claims.exp).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);
  });

  it('[R0-CMF5-A04] RED-BEFORE: the distinguished owner (Business.ownerId) with no membership row gets the auth URL, and the state names them', async () => {
    const res = await authUrl(ID.bizDist, ID.distOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(decodeState(stateOf(res.body.url)).claims).toMatchObject({ userId: ID.distOwner, businessId: ID.bizDist });
  });

  it('[R0-CMF5-A05] RED-BEFORE: a SUPER_ADMIN with no membership keeps the platform bypass, and the state names the super admin', async () => {
    const res = await authUrl(ID.biz, ID.superAdmin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(decodeState(stateOf(res.body.url)).claims).toMatchObject({ userId: ID.superAdmin, businessId: ID.biz });
  });

  it('[R0-CMF5-A06] control: a user with no membership is refused by BusinessGuard (403) and an unauthenticated request by AuthGuard (401); neither gets a URL', async () => {
    const stranger = await authUrl(ID.biz, ID.stranger);
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(403);
    expect(JSON.stringify(stranger.body)).not.toContain('accounts.google.com');
    const anonymous = await authUrl(ID.biz);
    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401);
    expect(JSON.stringify(anonymous.body)).not.toContain('accounts.google.com');
  });
});

describe('R0-CMF5 a Gmail callback links nothing; the owner who started it confirms it (ST-2)', () => {
  /** B01's pending connection: the owner's state, completed with someone else's Google account. */
  const forwarded: { pendingId?: string; attacker?: GoogleAccount } = {};

  it('[R0-CMF5-B01] RED-BEFORE: the review reproduction: the owner\'s auth URL completed with a stranger\'s Google account (callback in the stranger\'s request, then in one with no session) links no mailbox; it redirects gmail=pending and stores the exchanged tokens, encrypted, as one PENDING connection bound to the owner and the business', async () => {
    const attacker = googleAccount('attacker');
    forwarded.attacker = attacker;
    const start = await authUrl(ID.biz, ID.owner);
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const state = stateOf(start.body.url);
    const { claims } = decodeState(state);

    const back = redirectOf(await callback(state, attacker.code, ID.stranger));
    expect(back.path).toBe('/app/commerce');
    expect(back.gmail).toBe('pending');
    expect(back.pending).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    forwarded.pendingId = back.pending as string;
    expect(exchanges).toContain(attacker.code);

    // Nothing is linked: the business still has no mailbox, and invoices cannot be sent from the stranger's.
    expect(await mailboxOf(ID.biz)).toMatchObject({ email: null, access: null, refresh: null });
    const st = await status(ID.biz);
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body).toEqual({ connected: false, email: null });

    const rows = await pendingOf(ID.biz);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ id: forwarded.pendingId, business_id: ID.biz, provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING', account_email: attacker.email });
    expect(row.access_token_encrypted).toMatch(/^enc:v1:/);
    expect(row.refresh_token_encrypted).toMatch(/^enc:v1:/);
    expect(String(row.access_token_encrypted)).not.toContain(attacker.access);
    expect(String(row.refresh_token_encrypted)).not.toContain(attacker.refresh);
    expect(row.settings).toMatchObject({ userId: ID.owner, nonce: claims.nonce });
    const window = Date.parse(row.settings.pendingExpiresAt) - Date.now();
    expect(window).toBeGreaterThan(10 * 60 * 1000);
    expect(window).toBeLessThanOrEqual(15 * 60 * 1000);

    // The same flow with no session at all (Google's redirect through the web proxy carries none): still nothing linked.
    const other = googleAccount('anonymous');
    const second = await startAndComplete(ID.bizTwo, ID.owner, other);
    expect(second.gmail).toBe('pending');
    expect((await mailboxOf(ID.bizTwo)).email).toBeNull();
    await clearPending(ID.bizTwo);
  });

  it('[R0-CMF5-B02] RED-BEFORE: nobody but the user the state names can confirm it: the stranger (403, BusinessGuard), a STAFF member and an ADMIN (403 GMAIL_OWNER_ONLY), a co-owner and a SUPER_ADMIN (404 GMAIL_PENDING_NOT_FOUND); nothing is linked and the pending connection stays', async () => {
    const pendingId = forwarded.pendingId;
    expect(pendingId, 'B01 did not stage a pending connection').toBeTruthy();

    const stranger = await confirm(ID.biz, pendingId, ID.stranger);
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(403);
    expectOwnerOnly(await confirm(ID.biz, pendingId, ID.staff));
    expectOwnerOnly(await confirm(ID.biz, pendingId, ID.admin));
    expectOwnerOnly(await confirm(ID.biz, pendingId, ID.staffAdmin));
    expectPendingNotFound(await confirm(ID.biz, pendingId, ID.coOwner));
    expectPendingNotFound(await confirm(ID.biz, pendingId, ID.superAdmin));
    const anonymous = await confirm(ID.biz, pendingId);
    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401);

    expect((await mailboxOf(ID.biz)).email).toBeNull();
    expect((await pendingOf(ID.biz)).map((r) => r.id)).toEqual([pendingId]);
  });

  it('[R0-CMF5-B03] RED-BEFORE: positive: the owner starts, completes consent with their own mailbox, and confirms from their own signed-in request: 200 {connected, email}; the business mailbox holds the exchanged tokens (ciphertext at rest), status reports it, and no pending connection is left (the forwarded one was replaced by the owner\'s newer consent)', async () => {
    const mine = googleAccount('owner');
    const back = await startAndComplete(ID.biz, ID.owner, mine);
    expect(back.gmail).toBe('pending');
    expect(back.pending).toBeTruthy();
    expect(back.pending).not.toBe(forwarded.pendingId);
    expect((await pendingOf(ID.biz)).map((r) => r.id)).toEqual([back.pending]);
    expect((await mailboxOf(ID.biz)).email).toBeNull();

    const res = await confirm(ID.biz, back.pending, ID.owner);
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toEqual({ connected: true, email: mine.email });

    const stored = await mailboxOf(ID.biz);
    expect(stored.email).toBe(mine.email);
    expect(stored.access).toMatch(/^enc:v1:/);
    expect(stored.refresh).toMatch(/^enc:v1:/);
    const decrypted = await db.business.findUnique({ where: { id: ID.biz }, select: { gmailAccessToken: true, gmailRefreshToken: true, gmailTokenExpiry: true } });
    expect(decrypted).toMatchObject({ gmailAccessToken: mine.access, gmailRefreshToken: mine.refresh });
    expect(decrypted.gmailTokenExpiry.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);

    const st = await status(ID.biz);
    expect(st.body).toEqual({ connected: true, email: mine.email });
    expect(await pendingOf(ID.biz)).toEqual([]);

    // The forwarded (stranger's) pending connection can no longer be confirmed by anyone.
    expectPendingNotFound(await confirm(ID.biz, forwarded.pendingId, ID.owner));
    expect((await mailboxOf(ID.biz)).email).toBe(mine.email);
  });

  it('[R0-CMF5-B04] RED-BEFORE: a confirmation is single-use: the same pending id confirmed again answers 404 GMAIL_PENDING_NOT_FOUND and changes nothing', async () => {
    await clearMailbox(ID.biz);
    const mine = googleAccount('owner_once');
    const back = await startAndComplete(ID.biz, ID.owner, mine);
    const first = await confirm(ID.biz, back.pending, ID.owner);
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    expect((await mailboxOf(ID.biz)).email).toBe(mine.email);

    await clearMailbox(ID.biz);
    expectPendingNotFound(await confirm(ID.biz, back.pending, ID.owner));
    expect((await mailboxOf(ID.biz)).email).toBeNull();
  });

  it('[R0-CMF5-B05] control (R0-07, kept): a replayed callback (the same state a second time) redirects gmail=error reason=invalid_state; no code is exchanged and nothing is staged', async () => {
    await clearPending(ID.biz);
    const once = googleAccount('replay_first');
    const start = await authUrl(ID.biz, ID.owner);
    const state = stateOf(start.body.url);
    expect(redirectOf(await callback(state, once.code)).gmail).toBe('pending');
    await clearPending(ID.biz);

    const again = googleAccount('replay_second');
    const back = redirectOf(await callback(state, again.code, ID.owner));
    expect(back).toMatchObject({ gmail: 'error', reason: 'invalid_state', pending: null });
    expect(exchanges).not.toContain(again.code);
    expect(await pendingOf(ID.biz)).toEqual([]);
    expect((await mailboxOf(ID.biz)).email).toBeNull();
  });

  it('[R0-CMF5-B06] control: an expired state (signed, naming the owner) redirects gmail=error reason=invalid_state; no code is exchanged and nothing is staged', async () => {
    const account = googleAccount('expired');
    const state = signState({ businessId: ID.biz, userId: ID.owner, nonce: randomBytes(16).toString('hex'), exp: Date.now() - 1000, purpose: 'gmail' });
    expect(redirectOf(await callback(state, account.code, ID.owner))).toMatchObject({ gmail: 'error', reason: 'invalid_state' });
    expect(exchanges).not.toContain(account.code);
    expect(await pendingOf(ID.biz)).toEqual([]);
  });

  it('[R0-CMF5-B07] control: a state signed with another secret, or edited to name another business, redirects gmail=error reason=invalid_state; no code is exchanged and nothing is staged', async () => {
    const forged = googleAccount('forged');
    const claims = { businessId: ID.biz, userId: ID.owner, nonce: randomBytes(16).toString('hex'), exp: Date.now() + 60_000, purpose: 'gmail' };
    expect(redirectOf(await callback(signState(claims, `${P}wrong-secret`), forged.code))).toMatchObject({ gmail: 'error', reason: 'invalid_state' });

    const start = await authUrl(ID.bizTwo, ID.owner);
    const { payload, signature } = decodeState(stateOf(start.body.url));
    const edited = Buffer.from(`${payload.replace(ID.bizTwo, ID.biz)}.${signature}`).toString('base64');
    expect(redirectOf(await callback(edited, forged.code))).toMatchObject({ gmail: 'error', reason: 'invalid_state' });

    expect(exchanges).not.toContain(forged.code);
    expect(await pendingOf(ID.biz)).toEqual([]);
    expect(await pendingOf(ID.bizTwo)).toEqual([]);
  });

  it('[R0-CMF5-B08] RED-BEFORE: a correctly signed state that names no user (the pre-CMF5 shape) redirects gmail=error reason=invalid_state; no code is exchanged and no mailbox is linked', async () => {
    const account = googleAccount('userless');
    const state = signState({ businessId: ID.biz, nonce: randomBytes(16).toString('hex'), exp: Date.now() + 60_000, purpose: 'gmail' });
    expect(redirectOf(await callback(state, account.code))).toMatchObject({ gmail: 'error', reason: 'invalid_state' });
    expect(exchanges).not.toContain(account.code);
    expect(await pendingOf(ID.biz)).toEqual([]);
    expect((await mailboxOf(ID.biz)).email).toBeNull();
  });

  it('[R0-CMF5-B09] RED-BEFORE: a pending connection past its confirmation window cannot be confirmed (404 GMAIL_PENDING_NOT_FOUND) and links nothing', async () => {
    const account = googleAccount('late');
    const back = await startAndComplete(ID.biz, ID.owner, account);
    expect(back.gmail).toBe('pending');
    await db.$executeRawUnsafe(
      `UPDATE connector_accounts SET settings = jsonb_set(settings::jsonb, '{pendingExpiresAt}', to_jsonb($2::text)) WHERE id = $1`,
      back.pending,
      new Date(Date.now() - 1000).toISOString(),
    );
    expectPendingNotFound(await confirm(ID.biz, back.pending, ID.owner));
    expect((await mailboxOf(ID.biz)).email).toBeNull();
  });

  it('[R0-CMF5-B10] RED-BEFORE: owner authority is checked again at confirmation: an OWNER-membership user demoted to STAFF after starting is refused (403 GMAIL_OWNER_ONLY) and nothing is linked', async () => {
    await clearPending(ID.biz);
    const account = googleAccount('demoted');
    const back = await startAndComplete(ID.biz, ID.coOwner, account);
    expect(back.gmail).toBe('pending');
    await db.membership.update({ where: { userId_businessId: { userId: ID.coOwner, businessId: ID.biz } }, data: { role: 'STAFF' } });
    try {
      expectOwnerOnly(await confirm(ID.biz, back.pending, ID.coOwner));
      expect((await mailboxOf(ID.biz)).email).toBeNull();
    } finally {
      await db.membership.update({ where: { userId_businessId: { userId: ID.coOwner, businessId: ID.biz } }, data: { role: 'OWNER' } });
    }
  });

  it('[R0-CMF5-B11] RED-BEFORE: a pending connection belongs to the business its state named: the owner of both businesses confirming it on the other business\'s path gets 404 GMAIL_PENDING_NOT_FOUND, and neither business is linked', async () => {
    await clearPending(ID.biz);
    const account = googleAccount('cross');
    const back = await startAndComplete(ID.biz, ID.owner, account);
    expectPendingNotFound(await confirm(ID.bizTwo, back.pending, ID.owner));
    expect((await mailboxOf(ID.bizTwo)).email).toBeNull();
    expect((await mailboxOf(ID.biz)).email).toBeNull();
    expect((await pendingOf(ID.biz)).map((r) => r.id)).toEqual([back.pending]);
    await clearPending(ID.biz);
  });

  it('[R0-CMF5-B12] control: when Google refuses the code exchange the callback redirects gmail=error and stages nothing; a missing code is refused the same way', async () => {
    const start = await authUrl(ID.biz, ID.owner);
    expect(redirectOf(await callback(stateOf(start.body.url), REFUSED_CODE))).toMatchObject({ gmail: 'error', pending: null });
    const again = await authUrl(ID.biz, ID.owner);
    const missing = redirectOf(await as(agent().get('/commerce/gmail/callback').query({ state: stateOf(again.body.url) })));
    expect(missing).toMatchObject({ gmail: 'error', pending: null });
    expect(await pendingOf(ID.biz)).toEqual([]);
    expect((await mailboxOf(ID.biz)).email).toBeNull();
  });

  it('[R0-CMF5-B13] RED-BEFORE: replacing the mailbox: with one mailbox active, a new consent leaves it active (sends still go from it) until the owner confirms; then the new mailbox replaces it', async () => {
    const current = googleAccount('current');
    await seedMailbox(ID.biz, current);
    const next = googleAccount('next');
    const back = await startAndComplete(ID.biz, ID.owner, next, ID.stranger);
    expect(back.gmail).toBe('pending');
    expect((await status(ID.biz)).body).toEqual({ connected: true, email: current.email });
    const kept = await db.business.findUnique({ where: { id: ID.biz }, select: { gmailAccessToken: true, gmailRefreshToken: true } });
    expect(kept).toEqual({ gmailAccessToken: current.access, gmailRefreshToken: current.refresh });

    const res = await confirm(ID.biz, back.pending, ID.owner);
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect((await status(ID.biz)).body).toEqual({ connected: true, email: next.email });
    const replaced = await db.business.findUnique({ where: { id: ID.biz }, select: { gmailAccessToken: true, gmailRefreshToken: true } });
    expect(replaced).toEqual({ gmailAccessToken: next.access, gmailRefreshToken: next.refresh });
  });

  it('[R0-CMF5-B14] positive: the distinguished owner (no membership row) and a SUPER_ADMIN each start, complete and confirm their own connection', async () => {
    const dist = googleAccount('dist');
    const distBack = await startAndComplete(ID.bizDist, ID.distOwner, dist);
    const distRes = await confirm(ID.bizDist, distBack.pending, ID.distOwner);
    expect([200, 201], JSON.stringify(distRes.body)).toContain(distRes.status);
    expect(distRes.body).toEqual({ connected: true, email: dist.email });
    expect((await mailboxOf(ID.bizDist)).email).toBe(dist.email);

    await clearMailbox(ID.bizTwo);
    const platform = googleAccount('platform');
    const saBack = await startAndComplete(ID.bizTwo, ID.superAdmin, platform);
    const saRes = await confirm(ID.bizTwo, saBack.pending, ID.superAdmin);
    expect([200, 201], JSON.stringify(saRes.body)).toContain(saRes.status);
    expect(saRes.body).toEqual({ connected: true, email: platform.email });
    expect((await mailboxOf(ID.bizTwo)).email).toBe(platform.email);
  });

  it('[R0-CMF5-B15] the confirm route refuses (400) a confirmation with no pending id, or with a pending id that is not a string, and links nothing', async () => {
    await clearMailbox(ID.bizTwo);
    for (const bad of [undefined, '', 42, { not: 'x' }, ['x']]) {
      const res = await confirm(ID.bizTwo, bad, ID.owner);
      expect(res.status, JSON.stringify({ bad, body: res.body })).toBe(400);
    }
    expect((await mailboxOf(ID.bizTwo)).email).toBeNull();
  });

  it.todo(
    'R0-CMF5 follow-up (outside the write set): the web app does not yet confirm a pending connection. /app/commerce receives gmail=pending&pending=<id> ' +
      'and needs a "Confirm this mailbox" step that POSTs the id to /commerce/businesses/:b/gmail/confirm (apps/web/src/lib/client.ts and the commerce page)',
  );
  it.todo(
    'R0-CMF5 follow-up (outside the write set): POST /connect/google-suite/businesses/:b/auth-url with services [gmail] (core/connectors/google-suite.controller.ts, AuthGuard + BusinessGuard only) ' +
      'still lets any member connect a mailbox to Business.gmail* with a state that names no user, and DELETE through core/connectors/connector.controller.ts disconnect clears it; both need the same OWNER rule and binding',
  );
});

describe('R0-CMF5 disconnecting the mailbox is OWNER only (D-11)', () => {
  it('[R0-CMF5-C01] RED-BEFORE: a STAFF member granted revenue: write, an ADMIN and a STAFF member granted revenue: admin are refused DELETE .../gmail (403 GMAIL_OWNER_ONLY); the mailbox stays connected', async () => {
    const current = googleAccount('kept');
    await seedMailbox(ID.biz, current);
    for (const actor of [ID.staffWrite, ID.admin, ID.staffAdmin]) {
      expectOwnerOnly(await disconnect(ID.biz, actor));
    }
    const stranger = await disconnect(ID.biz, ID.stranger);
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(403);
    expect((await status(ID.biz)).body).toEqual({ connected: true, email: current.email });
  });

  it('[R0-CMF5-C02] positive: the owner disconnects (200); the mailbox columns are cleared and status reports connected: false', async () => {
    const res = await disconnect(ID.biz, ID.owner);
    expect([200, 204], JSON.stringify(res.body)).toContain(res.status);
    expect(await mailboxOf(ID.biz)).toMatchObject({ email: null, access: null, refresh: null, expiry: null });
    expect((await status(ID.biz)).body).toEqual({ connected: false, email: null });
  });
});

describe('R0-CMF5 harness invariant', () => {
  it('[R0-CMF5-X02] nothing left the process: every fetch was the stubbed Google token exchange or userinfo call', () => {
    expect(outbound).toEqual([]);
    expect(exchanges.length).toBeGreaterThan(0);
  });
});

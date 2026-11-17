/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1; W10-DISPATCH-STATUS review CR-W10DS-1)
 * — a Google outage answers 503 provider_unavailable over HTTP, a refusal
 * stays 400 (REAL database, REAL GmailService, GoogleDriveService and
 * StatementSourceService, REAL FinanceController and GoogleDriveController
 * behind the real guards and the production exception filter).
 *
 * The defect: GmailService and GoogleDriveService answered every non-OK
 * Google response with BadRequestException, an outage included. Over HTTP,
 *
 *   POST /finance/businesses/:b/accounts/:a/statement-sources/gmail/sweep  (Gmail search 503)
 *     -> 400 'Gmail search failed (503)'
 *   POST /finance/businesses/:b/accounts/:a/statement-sources/drive/sweep  (Drive list 429)
 *     -> 400 'Failed to list Google Drive files'
 *   GET  /drive/businesses/:b/files, POST /drive/businesses/:b/folders     (Drive 5xx, rate limits, ABORTED)
 *     -> 400
 *   a connection whose token expired, with Google's token endpoint down
 *     -> 400 'Failed to refresh access token' / 'Failed to refresh Google Drive connection. Please reconnect.'
 *
 * so a client (the web's providerUnavailableOf, KEY's plan queue behind
 * reconcile_sweep_statements and drive_create_folder) could not tell "Google
 * did not answer" from "Google refused this". Now each is 503
 * { statusCode: 503, code: 'provider_unavailable', message: <the existing
 * message>, details: { service, upstreamStatus } }; a refusal (400, 404, a 403
 * insufficientPermissions, a 409 ALREADY_EXISTS, a 400 invalid_grant) keeps
 * its existing 400 and message. Nothing is written on either answer: the
 * statement account is not stamped and no token is stored.
 *
 * RED-BEFORE (recorded in the tests-first commit): on int/v1-base at 15ca8599
 * every outage case answers 400 BAD_REQUEST with the same message; the
 * refusal controls and the success control pass.
 *
 * FU-PROVIDER-ERROR-HYGIENE (D-221): POST /drive/businesses/:b/files/:f/share
 * answered 'Drive share failed: <status> <Drive's body>' (since this packet in
 * a 503 as well as a 400); it answers 'Drive share failed: <status>', the body
 * nowhere in the answer. RED-BEFORE (chain head b00e5f78): V63Z-11.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * FinanceController (ensureAccess, assertGoogleConnectOwner),
 * StatementSourceService, GmailService, GoogleDriveController,
 * GoogleDriveService, GlobalHttpExceptionFilter and ValidationPipe. The
 * stand-ins: identity attachment (a test middleware reads `x-v63z-user` and
 * attaches the seeded user row, as the Supabase AuthMiddleware would), the
 * bank import (a recorder no case reaches), FinanceController's and
 * GoogleDriveController's other collaborators (empty objects; no case here
 * reaches them), and Google itself: globalThis.fetch answers the Gmail, Drive
 * and token endpoints in process with what each case sets, and records and
 * refuses anything else, so no provider is called. The Google OAuth client the
 * services read is an obviously fake id built at runtime.
 *
 * Fixtures: prefix `v63z_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63z_';
const HEADER = 'x-v63z-user';

const ID = {
  owner: `${P}owner`,
  /** Gmail and Drive connected, both access tokens live. */
  bizLive: `${P}bizLive`,
  /** Gmail and Drive connected, both access tokens expired (a refresh comes first). */
  bizExpired: `${P}bizExp`,
};
const ACCOUNT: Record<string, string> = { [ID.bizLive]: `${P}fa_live`, [ID.bizExpired]: `${P}fa_exp` };
const SOURCES = { driveFolderId: `${P}statement-folder`, gmailQuery: `from:${P}bank@test.local` };
const LIVE_EXPIRY = () => new Date(Date.now() + 2 * 60 * 60 * 1000);
const PAST_EXPIRY = new Date(Date.now() - 2 * 60 * 60 * 1000);

/** The Google OAuth client the services read: an obviously fake one, built at runtime. */
const OAUTH_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: [P, 'fake', 'oauth', 'client'].join(''),
  GOOGLE_CLIENT_SECRET: [P, 'fake', 'oauth', 'value'].join(''),
  GOOGLE_STATE_SECRET: [P, 'fake', 'state', 'value'].join(''),
};
const savedEnv: Record<string, string | undefined> = {};

let db: any;
let app: any;
const realFetch = globalThis.fetch;

/** What Google answers this case: a request `when` matches gets `status` and `body`; everything else is refused. */
let google: Array<{ when: (url: string, method: string) => boolean; status: number; body: string }> = [];
/** Every Google request this suite's fetch answered, in order. */
const answered: Array<{ url: string; method: string; status: number }> = [];
/** Every outbound request no rule answered (refused). */
const outbound: string[] = [];
/** BankImportService.ingest calls (a recorder: no outage case may import anything). */
const ingests: unknown[] = [];

const isGmailSearch = (u: string, m: string) => m === 'GET' && u.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?');
const isDriveList = (u: string, m: string) => m === 'GET' && u.startsWith('https://www.googleapis.com/drive/v3/files?');
const isDriveCreate = (u: string, m: string) => m === 'POST' && u === 'https://www.googleapis.com/drive/v3/files';
const isTokenEndpoint = (u: string, m: string) => m === 'POST' && u === 'https://oauth2.googleapis.com/token';
const isDriveShare = (u: string, m: string) => m === 'POST' && u.startsWith(`https://www.googleapis.com/drive/v3/files/${P}f1/permissions?`);

function googleError(code: number, status: string, reasons: string[] = []) {
  return JSON.stringify({ error: { code, message: `upstream ${status}`, status, errors: reasons.map((reason) => ({ reason })) } });
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_cortex_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function as<T extends { set: (k: string, v: string) => T }>(req: T, actor = ID.owner): T {
  return req.set(HEADER, actor);
}

const sweep = (businessId: string, source: 'gmail' | 'drive') =>
  as(agent().post(`/finance/businesses/${businessId}/accounts/${ACCOUNT[businessId]}/statement-sources/${source}/sweep`)).send({});
const listDrive = (businessId: string) => as(agent().get(`/drive/businesses/${businessId}/files`));
const createFolder = (businessId: string) => as(agent().post(`/drive/businesses/${businessId}/folders`)).send({ name: `${P}Statements` });
const shareFile = (businessId: string) => as(agent().post(`/drive/businesses/${businessId}/files/${P}f1/share`)).send({ type: 'anyone', role: 'reader' });

/** The structured 503 of an upstream outage, through the production filter. */
function expectUnavailable(res: { status: number; body: any }, service: 'gmail' | 'drive', message: string, upstreamStatus: number) {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.body).toMatchObject({
    statusCode: 503,
    code: 'provider_unavailable',
    message,
    details: { service, upstreamStatus },
  });
}

/** The existing refusal: 400 with its message, not provider_unavailable. */
function expectRefused(res: { status: number; body: any }, message: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.code).toBe('BAD_REQUEST');
  expect(res.body.message).toBe(message);
  expect(res.body.details?.service).toBeUndefined();
}

/** A statement account's stored sources (fresh read). */
async function sourcesOf(businessId: string) {
  const row = await db.financialAccount.findUnique({ where: { id: ACCOUNT[businessId] }, select: { metadata: true } });
  return (row?.metadata as any)?.statementSources;
}

/** A business's stored Google tokens (fresh read, decrypted by the client). */
async function tokensOf(businessId: string) {
  return db.business.findUnique({
    where: { id: businessId },
    select: { gmailAccessToken: true, gmailTokenExpiry: true, driveAccessToken: true, driveTokenExpiry: true },
  });
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(OAUTH_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { StatementSourceService } = await import('../src/modules/finance/statement-source.service');
  const { BankImportService } = await import('../src/modules/finance/bank-import.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { GoogleDriveController } = await import('../src/modules/google-drive/google-drive.controller');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { GeneratedDocumentService } = await import('../src/modules/google-drive/generated-document.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');

  // FinanceController's collaborators, read from its @Inject declarations, so
  // a collaborator added later is supplied without editing this suite: empty
  // objects for every one but the real PrismaService, the real
  // StatementSourceService and the recording bank import.
  const real = new Set<unknown>([PrismaService, StatementSourceService, BankImportService]);
  const declared: Array<{ index: number; param: unknown }> = Reflect.getMetadata('self:paramtypes', FinanceController) ?? [];
  const financeStandIns = [...new Set(declared.map((d) => d.param))]
    .filter((token) => !real.has(token))
    .map((token) => ({ provide: token as any, useValue: {} }));

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController, GoogleDriveController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // The Google clients under test, real (no connector: both are @Optional).
      GmailService,
      GoogleDriveService,
      StatementSourceService,
      { provide: BankImportService, useValue: { ingest: async (...args: unknown[]) => { ingests.push(args); throw new Error('v63z: no case imports'); } } },
      { provide: GeneratedDocumentService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      ...financeStandIns,
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

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  for (const [businessId, expiry] of [[ID.bizLive, LIVE_EXPIRY()], [ID.bizExpired, PAST_EXPIRY]] as const) {
    await db.business.create({
      data: {
        id: businessId,
        name: `V63Z ${businessId.slice(P.length)}`,
        ownerId: ID.owner,
        currency: 'TTD',
        gmailEmail: `${businessId}@test.local`,
        gmailAccessToken: `${businessId}-gmail-access`,
        gmailRefreshToken: `${businessId}-gmail-refresh`,
        gmailTokenExpiry: expiry,
        driveAccessToken: `${businessId}-drive-access`,
        driveRefreshToken: `${businessId}-drive-refresh`,
        driveTokenExpiry: expiry,
      },
    });
    // Owner ruling D-104: a Membership is the one access rule; D-132: a sweep is the owner's.
    await db.membership.create({ data: { id: `${P}m_${businessId}`, userId: ID.owner, businessId, role: 'OWNER' } });
    await db.chartOfAccount.create({ data: { id: `${P}coa_${businessId}`, businessId, name: 'V63Z Bank', type: 'ASSET', subtype: 'bank' } });
    await db.financialAccount.create({
      data: {
        id: ACCOUNT[businessId],
        businessId,
        chartOfAccountId: `${P}coa_${businessId}`,
        name: 'V63Z Statement Account',
        type: 'BANK',
        metadata: { statementSources: SOURCES },
      },
    });
  }

  // Google, in process: each case sets `google`; anything no rule answers is
  // recorded and refused, so a case that reached anything else fails rather
  // than calling out.
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    const rule = google.find((r) => r.when(url, method));
    if (rule) {
      answered.push({ url, method, status: rule.status });
      return new Response(rule.body, { status: rule.status, headers: { 'content-type': 'application/json' } });
    }
    outbound.push(`${method} ${url}`);
    throw new Error(`v63z: outbound traffic is refused in this suite (${method} ${url})`);
  }) as typeof fetch;
}, 180_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (app) await app.close();
  if (db) await cleanup();
  for (const key of Object.keys(OAUTH_ENV)) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

beforeEach(() => {
  google = [];
  answered.length = 0;
});

describe('W11-PROVIDER-OUTAGE-503: a Google outage answers 503 provider_unavailable over HTTP; a refusal stays 400', () => {
  it('[V63Z-00] fixture sanity: the owner holds OWNER on both businesses, both statement accounts carry both sources, and bizExpired\'s tokens are expired', async () => {
    expect(await db.membership.count({ where: { userId: ID.owner, role: 'OWNER', businessId: { in: [ID.bizLive, ID.bizExpired] } } })).toBe(2);
    expect(await sourcesOf(ID.bizLive)).toEqual(SOURCES);
    expect(await sourcesOf(ID.bizExpired)).toEqual(SOURCES);
    const expired = await tokensOf(ID.bizExpired);
    expect(expired.gmailTokenExpiry.getTime()).toBeLessThan(Date.now());
    expect(expired.driveTokenExpiry.getTime()).toBeLessThan(Date.now());
    expect(expired.gmailAccessToken).toBe(`${ID.bizExpired}-gmail-access`);
  });

  it('[V63Z-01] RED-BEFORE: a statement sweep whose Gmail search answers 503 answers 503 {code: provider_unavailable, message: "Gmail search failed (503)", details: {service: gmail, upstreamStatus: 503}}; the account is not stamped and nothing is imported', async () => {
    google = [{ when: isGmailSearch, status: 503, body: googleError(503, 'UNAVAILABLE', ['backendError']) }];

    const res = await sweep(ID.bizLive, 'gmail');

    expectUnavailable(res, 'gmail', 'Gmail search failed (503)', 503);
    expect(await sourcesOf(ID.bizLive)).toEqual(SOURCES);
    expect(ingests).toEqual([]);
    expect(answered.map((a) => [a.method, new URL(a.url).pathname])).toEqual([['GET', '/gmail/v1/users/me/messages']]);
  });

  it('[V63Z-02] control: a statement sweep whose Gmail search answers 400 keeps the existing 400 "Gmail search failed (400)"', async () => {
    google = [{ when: isGmailSearch, status: 400, body: googleError(400, 'INVALID_ARGUMENT', ['invalidArgument']) }];

    expectRefused(await sweep(ID.bizLive, 'gmail'), 'Gmail search failed (400)');
    expect(await sourcesOf(ID.bizLive)).toEqual(SOURCES);
  });

  it('[V63Z-03] RED-BEFORE: a statement sweep whose Drive list answers 429 answers 503 provider_unavailable {service: drive} with the existing message; a 404 keeps the existing 400', async () => {
    google = [{ when: isDriveList, status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded']) }];
    expectUnavailable(await sweep(ID.bizLive, 'drive'), 'drive', 'Failed to list Google Drive files', 429);

    google = [{ when: isDriveList, status: 404, body: googleError(404, 'NOT_FOUND', ['notFound']) }];
    expectRefused(await sweep(ID.bizLive, 'drive'), 'Failed to list Google Drive files');

    expect(await sourcesOf(ID.bizLive)).toEqual(SOURCES);
    expect(ingests).toEqual([]);
  });

  it('[V63Z-04] RED-BEFORE: GET /drive/businesses/:b/files: a 503 and a rate-limited 403 answer 503 provider_unavailable; a 403 insufficientPermissions keeps the existing 400', async () => {
    google = [{ when: isDriveList, status: 503, body: 'Service Unavailable' }];
    expectUnavailable(await listDrive(ID.bizLive), 'drive', 'Failed to list Google Drive files', 503);

    google = [{ when: isDriveList, status: 403, body: googleError(403, 'PERMISSION_DENIED', ['userRateLimitExceeded']) }];
    expectUnavailable(await listDrive(ID.bizLive), 'drive', 'Failed to list Google Drive files', 403);

    google = [{ when: isDriveList, status: 403, body: googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions']) }];
    expectRefused(await listDrive(ID.bizLive), 'Failed to list Google Drive files');
  });

  it('[V63Z-05] control: GET /drive/businesses/:b/files with Drive answering 200 still lists the files', async () => {
    google = [{ when: isDriveList, status: 200, body: JSON.stringify({ files: [{ id: `${P}f1`, name: 'july.ofx' }], nextPageToken: 'n2' }) }];
    const res = await listDrive(ID.bizLive);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ files: [{ id: `${P}f1`, name: 'july.ofx' }], nextPageToken: 'n2' });
  });

  it('[V63Z-06] RED-BEFORE: POST /drive/businesses/:b/folders: a 500 and a 409 ABORTED answer 503 provider_unavailable; a 409 ALREADY_EXISTS keeps the existing 400', async () => {
    google = [{ when: isDriveCreate, status: 500, body: googleError(500, 'INTERNAL', ['backendError']) }];
    expectUnavailable(await createFolder(ID.bizLive), 'drive', 'Drive createFolder failed: 500', 500);

    google = [{ when: isDriveCreate, status: 409, body: googleError(409, 'ABORTED') }];
    expectUnavailable(await createFolder(ID.bizLive), 'drive', 'Drive createFolder failed: 409', 409);

    google = [{ when: isDriveCreate, status: 409, body: googleError(409, 'ALREADY_EXISTS', ['duplicate']) }];
    expectRefused(await createFolder(ID.bizLive), 'Drive createFolder failed: 409');
  });

  it('[V63Z-07] RED-BEFORE: an expired Gmail token whose refresh meets a token-endpoint 503 answers the sweep 503 provider_unavailable "Failed to refresh access token" before Gmail is searched; a 400 invalid_grant keeps the existing 400; the stored token is unchanged either way', async () => {
    const before = await tokensOf(ID.bizExpired);

    google = [{ when: isTokenEndpoint, status: 503, body: '' }];
    expectUnavailable(await sweep(ID.bizExpired, 'gmail'), 'gmail', 'Failed to refresh access token', 503);
    expect(answered.map((a) => a.url)).toEqual(['https://oauth2.googleapis.com/token']);

    google = [{ when: isTokenEndpoint, status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) }];
    expectRefused(await sweep(ID.bizExpired, 'gmail'), 'Failed to refresh access token');

    expect(await tokensOf(ID.bizExpired)).toEqual(before);
    expect(await sourcesOf(ID.bizExpired)).toEqual(SOURCES);
  });

  it('[V63Z-08] RED-BEFORE: an expired Drive token whose refresh meets a token-endpoint 502 answers GET /drive/.../files 503 provider_unavailable "Failed to refresh Google Drive connection. Please reconnect."; a 400 invalid_grant keeps the existing 400; the stored token is unchanged', async () => {
    const before = await tokensOf(ID.bizExpired);
    const MESSAGE = 'Failed to refresh Google Drive connection. Please reconnect.';

    google = [{ when: isTokenEndpoint, status: 502, body: '' }];
    expectUnavailable(await listDrive(ID.bizExpired), 'drive', MESSAGE, 502);

    google = [{ when: isTokenEndpoint, status: 400, body: JSON.stringify({ error: 'invalid_grant' }) }];
    expectRefused(await listDrive(ID.bizExpired), MESSAGE);

    expect(answered.every((a) => a.url === 'https://oauth2.googleapis.com/token')).toBe(true);
    expect(await tokensOf(ID.bizExpired)).toEqual(before);
  });

  it('[V63Z-09] the upstream body is never in the answer', async () => {
    const CANARY = `${P}canary-upstream-body`;
    google = [{ when: isGmailSearch, status: 503, body: googleError(503, CANARY, [CANARY]) }];
    const outage = await sweep(ID.bizLive, 'gmail');
    google = [{ when: isGmailSearch, status: 400, body: googleError(400, CANARY, [CANARY]) }];
    const refusal = await sweep(ID.bizLive, 'gmail');
    expect(outage.status).toBe(503);
    expect(refusal.status).toBe(400);
    expect(JSON.stringify(outage.body)).not.toContain(CANARY);
    expect(JSON.stringify(refusal.body)).not.toContain(CANARY);
  });

  it('[V63Z-11] RED-BEFORE: FU-PROVIDER-ERROR-HYGIENE (D-221): POST /drive/.../files/:f/share whose Drive permissions answer 503 answers 503 {service: drive, message: "Drive share failed: 503"}; a 403 insufficientPermissions keeps a 400 "Drive share failed: 403"; Drive\'s body is in neither answer', async () => {
    const CANARY = `${P}canary-share-body`;
    google = [{ when: isDriveShare, status: 503, body: googleError(503, CANARY, ['backendError']) }];
    const outage = await shareFile(ID.bizLive);
    expectUnavailable(outage, 'drive', 'Drive share failed: 503', 503);

    google = [{ when: isDriveShare, status: 403, body: googleError(403, CANARY, ['insufficientPermissions']) }];
    const refusal = await shareFile(ID.bizLive);
    expectRefused(refusal, 'Drive share failed: 403');

    expect(JSON.stringify(outage.body)).not.toContain(CANARY);
    expect(JSON.stringify(refusal.body)).not.toContain(CANARY);
    expect(answered.map((a) => a.method)).toEqual(['POST', 'POST']);
    for (const a of answered) expect(isDriveShare(a.url, a.method), a.url).toBe(true);
  });

  it('[V63Z-10] no case made an outbound call: every Google request was answered in process', () => {
    expect(outbound).toEqual([]);
  });
});

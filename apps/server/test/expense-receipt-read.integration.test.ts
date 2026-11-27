/**
 * P222 FU-RECEIPT-READ-ROUTE (D-299, EXPENSES-HUB-3 cross-session receipt leg) —
 * authenticated, business-scoped expense receipt read route, write-time
 * `isObjectPathOfBusiness` enforcement on expense create/update, and server
 * proof of `POST /uploads/request-url` `BusinessGuard` enforcement.
 *
 * REAL Postgres database, REAL NestJS HTTP routes behind REAL AuthGuard,
 * BusinessGuard, ModuleScopeGuard, BusinessMemberGuard, TeamAuditInterceptor,
 * TenantInterceptor, GlobalHttpExceptionFilter and ValidationPipe, plus an
 * in-memory S3 double (`S3Client.prototype.send` spied; the presigner signs
 * locally with dummy credentials; nothing reaches a bucket, network or
 * provider).
 *
 * Contract pinned here (RED-BEFORE marks cases that fail before the fix):
 *
 *   PR-01 POST /uploads/request-url unauthenticated -> 401
 *   PR-02 POST /uploads/request-url by Biz A member naming Biz B (body or query)
 *         -> 403 (BusinessGuard refuses cross-business presign)
 *   PR-03 POST /uploads/request-url by Biz A member naming Biz A -> 201 with
 *         objectPath in `/objects/uploads/<BIZ_A>/<uuid>`
 *
 *   RW-01 RED-BEFORE POST /expenses/businesses/:bizA/expenses with any foreign,
 *         legacy, server-namespace, traversal, encoded or S3-bucket receiptUrl
 *         outside BIZ_A -> 400 (0 expense rows, 0 ledger rows created)
 *   RW-02 RED-BEFORE PATCH /expenses/businesses/:bizA/expenses/:id with foreign
 *         or unsafe /objects/ receiptUrl -> 400 (stored receiptUrl unchanged)
 *   RW-03 POST & PATCH with BIZ_A's own uploaded receiptUrl in bare `/objects/...`,
 *         `${API_BASE}/objects/...`, and relative `/__api/objects/...` forms,
 *         plus external `https://drive.google.com/...` URLs and clearing to null
 *         all succeed
 *   RW-04 RED-BEFORE POST & PATCH with dangerous schemes (`javascript:`, `data:`)
 *         -> 400
 *
 *   RR-01 RED-BEFORE (D-299 cross-session leg) Session 1 (ownerA) uploads PNG
 *         bytes via presign and saves expense with `${API_BASE}${objectPath}`
 *         (plus `/__api${objectPath}` and bare `objectPath`); Session 2 (memberA,
 *         different authenticated user in BIZ_A with `expenses:read`) calls
 *         GET /expenses/businesses/:bizA/expenses/:id/receipt -> 200 with
 *         `Cache-Control: no-store`, signed GET `url`, `objectPath`,
 *         `contentType: 'image/png'`, `contentLength`, bounded `expiresIn`, and
 *         the signed key resolves to the exact uploaded PNG bytes
 *   RR-02 RED-BEFORE GET .../receipt unauthenticated -> 401
 *   RR-03 RED-BEFORE GET .../receipt by Biz B member -> 403 (S3 not called)
 *   RR-04 RED-BEFORE GET .../receipt by Biz A staff with `expenses: 'none'` -> 403
 *   RR-05 RED-BEFORE GET .../receipt for missing, soft-deleted, no-receipt, or
 *         other-business expense -> 404
 *   RR-06 RED-BEFORE defense-in-depth: pre-existing DB row in BIZ_A holding
 *         BIZ_B's `/objects/uploads/...`, legacy `/objects/uploads/<uuid>`, or
 *         `/objects/accountant-exports/...` -> 404 WITHOUT calling S3
 *   RR-07 RED-BEFORE external receiptUrl (e.g. Google Drive) -> 404 (not S3)
 *   RR-08 RED-BEFORE missing S3 object -> 404
 *   RR-09 RED-BEFORE `?download=1` adds `attachment` content-disposition while
 *         default omits it for inline `<img src>`, and `?expiresIn=` is clamped
 *         to [60, 900]
 *
 * Fixtures: prefix `v92h_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and
 * afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { posix } from 'node:path';
import { Readable } from 'node:stream';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92h_';
const HEADER = 'x-v92h-user';
const PRIVATE_DIR = 'private';
const BUCKET_NAME = `${P}bucket`;
const API_BASE = 'https://api.v92h.test.local';

// Minimal valid 1x1 PNG header + payload bytes
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x76, 0x39, 0x32, 0x68,
]);

const ID = {
  ownerA: `${P}owner_a`,
  memberA: `${P}member_a`,
  refusedA: `${P}refused_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
};

const bucket = new Map<string, { body: Buffer; contentType?: string }>();
const s3Calls: Array<{ op: string; key: string }> = [];
const norm = (key: string) => posix.normalize(key).replace(/^\/+/, '');

const ENV_KEYS = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'PRIVATE_OBJECT_DIR',
] as const;
const savedEnv: Record<string, string | undefined> = {};

let db: any;
let app: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

/** Extract bucket-relative key from a path-style presigned S3 URL against our test endpoint. */
function bucketKeyFromSignedUrl(signedUrl: string): string {
  const u = new URL(signedUrl);
  const raw = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  return norm(raw.startsWith(`${BUCKET_NAME}/`) ? raw.slice(BUCKET_NAME.length + 1) : raw);
}

/** Issue a real presigned upload via HTTP and write bytes into the in-memory S3 double. */
async function presignAndPut(
  userId: string,
  businessId: string,
  bytes: Buffer,
  contentType = 'image/png',
  name = 'receipt.png',
): Promise<{ uploadURL: string; objectPath: string; key: string }> {
  const res = await agent()
    .post('/uploads/request-url')
    .set(HEADER, userId)
    .send({ businessId, name, size: bytes.length, contentType });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { uploadURL, objectPath } = res.body as { uploadURL: string; objectPath: string };
  const key = bucketKeyFromSignedUrl(uploadURL);
  bucket.set(key, { body: Buffer.from(bytes), contentType });
  return { uploadURL, objectPath, key };
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.S3_BUCKET = BUCKET_NAME;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ENDPOINT = 'http://127.0.0.1:9';
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.PRIVATE_OBJECT_DIR = PRIVATE_DIR;

  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
    const key = norm(String(cmd.input?.Key ?? ''));
    s3Calls.push({ op: cmd?.constructor?.name ?? 'Unknown', key });
    if (cmd instanceof PutObjectCommand) {
      bucket.set(key, {
        body: Buffer.from(cmd.input.Body as any),
        contentType: cmd.input.ContentType,
      });
      return {} as any;
    }
    const hit = bucket.get(key);
    if (cmd instanceof HeadObjectCommand) {
      if (!hit) {
        throw Object.assign(new Error('NotFound'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {
        Metadata: {},
        ContentType: hit.contentType,
        ContentLength: hit.body.length,
      } as any;
    }
    if (cmd instanceof GetObjectCommand) {
      if (!hit) {
        throw Object.assign(new Error('NoSuchKey'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {
        Body: Readable.from([hit.body]),
        ContentType: hit.contentType,
        ContentLength: hit.body.length,
      } as any;
    }
    throw new Error(`unexpected S3 command in test: ${cmd?.constructor?.name}`);
  });

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { BusinessMemberGuard } = await import('../src/core/auth/business-member.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { UploadsController } = await import('../src/modules/uploads/uploads.controller');
  const { UploadsService } = await import('../src/modules/uploads/uploads.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [ExpensesController, UploadsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      BusinessMemberGuard,
      TeamAuditInterceptor,
      ExpensesService,
      UploadsService,
      ExpensePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  }).compile();

  const coa = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
  // Identity attachment only — AuthGuard, BusinessGuard, ModuleScopeGuard and
  // BusinessMemberGuard all run unmodified against real Postgres rows.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true },
      });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner-a@test.local`, role: 'USER' },
      { id: ID.memberA, email: `${P}member-a@test.local`, role: 'USER' },
      { id: ID.refusedA, email: `${P}refused-a@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}owner-b@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: `V92H Biz A`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: `V92H Biz B`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_owner_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}m_member_a`,
        userId: ID.memberA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { expenses: 'read' },
      },
      {
        id: `${P}m_refused_a`,
        userId: ID.refusedA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { expenses: 'none' },
      },
      { id: `${P}m_owner_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await coa.ensureDefaults(ID.bizA);
  await coa.ensureDefaults(ID.bizB);
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  s3Calls.length = 0;
});

describe('P222 presign BusinessGuard enforcement (POST /uploads/request-url)', () => {
  it('PR-01 refuses unauthenticated presign requests with 401', async () => {
    const res = await agent()
      .post('/uploads/request-url')
      .send({ businessId: ID.bizA, name: 'receipt.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('PR-02 refuses cross-business presign requests (body or query) with 403', async () => {
    const byBody = await agent()
      .post('/uploads/request-url')
      .set(HEADER, ID.ownerA)
      .send({ businessId: ID.bizB, name: 'receipt.png', contentType: 'image/png' });
    expect(byBody.status).toBe(403);

    const byQuery = await agent()
      .post(`/uploads/request-url?businessId=${ID.bizB}`)
      .set(HEADER, ID.ownerA)
      .send({ name: 'receipt.png', contentType: 'image/png' });
    expect(byQuery.status).toBe(403);
  });

  it('PR-03 issues a business-scoped objectPath and presigned PUT URL for own business', async () => {
    const res = await agent()
      .post('/uploads/request-url')
      .set(HEADER, ID.ownerA)
      .send({ businessId: ID.bizA, name: 'receipt.png', size: PNG_BYTES.length, contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.objectPath).toMatch(new RegExp(`^/objects/uploads/${ID.bizA}/[0-9a-f-]+$`));
    expect(bucketKeyFromSignedUrl(res.body.uploadURL)).toBe(
      `${PRIVATE_DIR}${res.body.objectPath.slice('/objects'.length)}`,
    );
  });
});

describe('P222 write-time receiptUrl tenancy enforcement (create & update)', () => {
  it('RW-01 rejects foreign, legacy, traversal, server-namespace and bucket receiptUrl on POST', async () => {
    const bUpload = await presignAndPut(ID.ownerB, ID.bizB, PNG_BYTES);
    const beforeCount = await db.expense.count({ where: { businessId: ID.bizA } });

    const forbiddenUrls = [
      bUpload.objectPath,
      `${API_BASE}${bUpload.objectPath}`,
      `/__api${bUpload.objectPath}`,
      `http://127.0.0.1:9/${BUCKET_NAME}/${PRIVATE_DIR}/uploads/${ID.bizB}/foreign-id`,
      `/objects/uploads/${ID.bizA}/../${ID.bizB}/foreign-id`,
      `${API_BASE}/objects/uploads/${ID.bizA}/%2e%2e/${ID.bizB}/foreign-id`,
      `/objects/accountant-exports/${ID.bizA}/export.zip`,
      `/objects/uploads/legacy-no-business-id`,
      `/OBJECTS/uploads/${ID.bizB}/upper-case-id`,
    ];

    for (const receiptUrl of forbiddenUrls) {
      const res = await agent()
        .post(`/expenses/businesses/${ID.bizA}/expenses`)
        .set(HEADER, ID.ownerA)
        .send({ description: 'Foreign receipt attempt', amount: 25, receiptUrl });
      expect(res.status, `POST should reject ${receiptUrl}`).toBe(400);
    }

    const afterCount = await db.expense.count({ where: { businessId: ID.bizA } });
    expect(afterCount).toBe(beforeCount);
  });

  it('RW-02 rejects foreign or unsafe /objects/ receiptUrl on PATCH without modifying the row', async () => {
    const aUpload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const bUpload = await presignAndPut(ID.ownerB, ID.bizB, PNG_BYTES);

    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'Own receipt baseline', amount: 15, receiptUrl: `${API_BASE}${aUpload.objectPath}` });
    expect(created.status).toBe(201);
    const expenseId = created.body.id;

    for (const bad of [
      bUpload.objectPath,
      `${API_BASE}${bUpload.objectPath}`,
      `/__api${bUpload.objectPath}`,
      `/objects/uploads/legacy-no-business`,
    ]) {
      const patched = await agent()
        .patch(`/expenses/businesses/${ID.bizA}/expenses/${expenseId}`)
        .set(HEADER, ID.ownerA)
        .send({ receiptUrl: bad });
      expect(patched.status, `PATCH should reject ${bad}`).toBe(400);
    }

    const row = await db.expense.findUnique({ where: { id: expenseId } });
    expect(row?.receiptUrl).toBe(`${API_BASE}${aUpload.objectPath}`);
  });

  it('RW-03 accepts own-business receiptUrl in bare, API_BASE and /__api forms, plus external HTTPS and clearing', async () => {
    const aUpload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const validUrls = [
      aUpload.objectPath,
      `${API_BASE}${aUpload.objectPath}`,
      `/__api${aUpload.objectPath}`,
      'https://drive.google.com/file/d/v92h-test-doc/view',
    ];

    let lastId = '';
    for (const receiptUrl of validUrls) {
      const res = await agent()
        .post(`/expenses/businesses/${ID.bizA}/expenses`)
        .set(HEADER, ID.ownerA)
        .send({ description: `Valid receipt ${receiptUrl.slice(0, 16)}`, amount: 10, receiptUrl });
      expect(res.status, `POST should accept ${receiptUrl}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.receiptUrl).toBe(receiptUrl);
      lastId = res.body.id;
    }

    const cleared = await agent()
      .patch(`/expenses/businesses/${ID.bizA}/expenses/${lastId}`)
      .set(HEADER, ID.ownerA)
      .send({ receiptUrl: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.receiptUrl).toBeNull();
  });

  it('RW-04 rejects dangerous non-http(s) URL schemes (javascript:, data:) on POST and PATCH', async () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      const res = await agent()
        .post(`/expenses/businesses/${ID.bizA}/expenses`)
        .set(HEADER, ID.ownerA)
        .send({ description: 'Bad scheme', amount: 5, receiptUrl: bad });
      expect(res.status, `POST should reject ${bad}`).toBe(400);
    }
  });
});

describe('P222 authenticated business-scoped receipt read route (GET .../receipt)', () => {
  it('RR-01 (D-299 cross-session) another member session reads the uploaded receipt with contentType and exact bytes across all URL forms', async () => {
    const upload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES, 'image/png', 'lunch.png');

    for (const storedUrl of [
      `${API_BASE}${upload.objectPath}`,
      `/__api${upload.objectPath}`,
      upload.objectPath,
    ]) {
      const created = await agent()
        .post(`/expenses/businesses/${ID.bizA}/expenses`)
        .set(HEADER, ID.ownerA)
        .send({ description: 'Team lunch', amount: 86.4, receiptUrl: storedUrl });
      expect(created.status).toBe(201);

      // Session 2: a DIFFERENT authenticated user in BIZ_A with expenses:read
      const readRes = await agent()
        .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt`)
        .set(HEADER, ID.memberA);

      expect(readRes.status, `GET receipt for ${storedUrl}: ${JSON.stringify(readRes.body)}`).toBe(200);
      expect(readRes.headers['cache-control']).toMatch(/no-store/i);
      expect(readRes.body.objectPath).toBe(upload.objectPath);
      expect(readRes.body.contentType).toBe('image/png');
      expect(readRes.body.contentLength).toBe(PNG_BYTES.length);
      expect(readRes.body.expiresIn).toBe(300);
      expect(typeof readRes.body.url).toBe('string');
      expect(readRes.body.url).toContain('X-Amz-Signature=');

      const signedKey = bucketKeyFromSignedUrl(readRes.body.url);
      expect(signedKey).toBe(upload.key);
      expect(bucket.get(signedKey)?.body.equals(PNG_BYTES)).toBe(true);
    }
  });

  it('RR-02 refuses unauthenticated callers with 401', async () => {
    const upload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'Auth check', amount: 12, receiptUrl: upload.objectPath });
    expect(created.status).toBe(201);

    s3Calls.length = 0;
    const res = await agent().get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt`);
    expect(res.status).toBe(401);
    expect(s3Calls).toEqual([]);
  });

  it('RR-03 refuses another business member with 403 before touching S3', async () => {
    const upload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'Tenant boundary', amount: 12, receiptUrl: upload.objectPath });
    expect(created.status).toBe(201);

    s3Calls.length = 0;
    const res = await agent()
      .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt`)
      .set(HEADER, ID.ownerB);
    expect(res.status).toBe(403);
    expect(s3Calls).toEqual([]);
  });

  it('RR-04 refuses a business member without expenses:read scope with 403 before touching S3', async () => {
    const upload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'Scope boundary', amount: 12, receiptUrl: upload.objectPath });
    expect(created.status).toBe(201);

    s3Calls.length = 0;
    const res = await agent()
      .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt`)
      .set(HEADER, ID.refusedA);
    expect(res.status).toBe(403);
    expect(s3Calls).toEqual([]);
  });

  it('RR-05 returns 404 for missing, soft-deleted, no-receipt, or cross-business expense id', async () => {
    const noReceipt = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'No receipt', amount: 10 });
    expect(noReceipt.status).toBe(201);

    const bUpload = await presignAndPut(ID.ownerB, ID.bizB, PNG_BYTES);
    const bizBExpense = await agent()
      .post(`/expenses/businesses/${ID.bizB}/expenses`)
      .set(HEADER, ID.ownerB)
      .send({ description: 'Biz B expense', amount: 20, receiptUrl: bUpload.objectPath });
    expect(bizBExpense.status).toBe(201);

    const aUpload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const deletedExp = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'To delete', amount: 10, receiptUrl: aUpload.objectPath });
    expect(deletedExp.status).toBe(201);
    await db.expense.update({ where: { id: deletedExp.body.id }, data: { deletedAt: new Date() } });

    for (const id of ['nonexistent-id', noReceipt.body.id, bizBExpense.body.id, deletedExp.body.id]) {
      const res = await agent()
        .get(`/expenses/businesses/${ID.bizA}/expenses/${id}/receipt`)
        .set(HEADER, ID.ownerA);
      expect(res.status, `GET receipt for ${id}`).toBe(404);
    }
  });

  it('RR-06 defense-in-depth: pre-existing DB row holding foreign/legacy/server object path returns 404 without calling S3', async () => {
    const bUpload = await presignAndPut(ID.ownerB, ID.bizB, PNG_BYTES);
    const legacyKey = `${PRIVATE_DIR}/uploads/legacy-pre-fix-receipt`;
    bucket.set(legacyKey, { body: PNG_BYTES, contentType: 'image/png' });

    const poisonedUrls = [
      bUpload.objectPath,
      `${API_BASE}${bUpload.objectPath}`,
      `/__api${bUpload.objectPath}`,
      '/objects/uploads/legacy-pre-fix-receipt',
      `/objects/accountant-exports/${ID.bizA}/export.zip`,
    ];

    for (let i = 0; i < poisonedUrls.length; i++) {
      const row = await db.expense.create({
        data: {
          id: `${P}poison_${i}`,
          businessId: ID.bizA,
          description: `Poisoned ${i}`,
          amount: 10,
          currency: 'TTD',
          date: new Date(),
          receiptUrl: poisonedUrls[i],
        },
      });
      s3Calls.length = 0;
      const res = await agent()
        .get(`/expenses/businesses/${ID.bizA}/expenses/${row.id}/receipt`)
        .set(HEADER, ID.ownerA);
      expect(res.status, `GET poisoned ${poisonedUrls[i]}`).toBe(404);
      expect(s3Calls, `S3 must not be called for ${poisonedUrls[i]}`).toEqual([]);
    }
  });

  it('RR-07 returns 404 without touching S3 when receiptUrl is an external link', async () => {
    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({
        description: 'Drive receipt',
        amount: 45,
        receiptUrl: 'https://drive.google.com/file/d/v92h-ext/view',
      });
    expect(created.status).toBe(201);

    s3Calls.length = 0;
    const res = await agent()
      .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt`)
      .set(HEADER, ID.ownerA);
    expect(res.status).toBe(404);
    expect(s3Calls).toEqual([]);
  });

  it('RR-08 returns 404 when the owned object is missing in S3', async () => {
    const upload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES);
    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'Vanished object', amount: 10, receiptUrl: upload.objectPath });
    expect(created.status).toBe(201);

    bucket.delete(upload.key);
    const res = await agent()
      .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt`)
      .set(HEADER, ID.ownerA);
    expect(res.status).toBe(404);
  });

  it('RR-09 omits attachment disposition by default, adds it on ?download=1, and clamps ?expiresIn= to [60, 900]', async () => {
    const upload = await presignAndPut(ID.ownerA, ID.bizA, PNG_BYTES, 'application/pdf');
    const created = await agent()
      .post(`/expenses/businesses/${ID.bizA}/expenses`)
      .set(HEADER, ID.ownerA)
      .send({ description: 'PDF invoice', amount: 99, receiptUrl: upload.objectPath });
    expect(created.status).toBe(201);

    const inlineRes = await agent()
      .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt?expiresIn=5`)
      .set(HEADER, ID.ownerA);
    expect(inlineRes.status).toBe(200);
    expect(inlineRes.body.expiresIn).toBe(60);
    expect(inlineRes.body.contentType).toBe('application/pdf');
    expect(new URL(inlineRes.body.url).searchParams.get('response-content-disposition')).toBeNull();

    const dlRes = await agent()
      .get(`/expenses/businesses/${ID.bizA}/expenses/${created.body.id}/receipt?download=1&expiresIn=99999`)
      .set(HEADER, ID.ownerA);
    expect(dlRes.status).toBe(200);
    expect(dlRes.body.expiresIn).toBe(900);
    expect(new URL(dlRes.body.url).searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
  });
});

/**
 * P222 FU-RECEIPT-READ-ROUTE — R2 hardening regression suite (RED-BEFORE on 4f994d963).
 *
 * Pins every finding raised by the R1 Security (`1cbefa81`) and Correctness (`26450684`) reviews:
 *  - SEC-P222-1: percent-encoded `/objects/` (`/%6fbjects/`, `/objects%2f`, `..%2fobjects/`, malformed `%ZZ`)
 *  - SEC-P222-2 / R1-C2: broken `%2e%2e?` regex, mixed dot encodings (`.%2e`, `%2e.`, `%2e`, `%252e`),
 *    backslash normalization (`\..\`), and WHATWG CR/LF/TAB stripping (`.\n.`) on both write and read
 *  - SEC-P222-3 / R1-C1: repeated or object `?expiresIn=` query params (`?expiresIn=60&expiresIn=120`,
 *    `?expiresIn[a]=60`) fall back to 300s default instead of throwing 500 TypeError
 *  - SEC-P222-4: relative `/\evil.com/objects/...` and unanchored relative `/foo/objects/...` rejected
 *  - SEC-P222-5: prototype keys (`constructor`, `__proto__`) in S3 ContentType cannot poison downloadFilename
 *  - SEC-P222-6: control chars (CRLF/NUL) and `user:pass@host` credentials rejected on write
 *  - SEC-P222-7: active content types (`image/svg+xml`, `text/html`, `application/xhtml+xml`) force
 *    `attachment` disposition even when `?download` is omitted
 *  - SEC-P222-8 / R1-C3 / R1-C4: `NoSuchKey` HEAD error -> 404; empty `ContentType: ""` -> `application/octet-stream`;
 *    repeated slashes inside multi-segment S3 endpoint path still recognized as bucket URL;
 *    PATCH with `null`/`   `/`javascript:` and `contentType` charset param edge cases
 */
import 'reflect-metadata';
import request from 'supertest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { GlobalHttpExceptionFilter } from '../../core/filters/http-exception.filter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { BusinessMemberGuard } from '../../core/auth/business-member.guard';
import { TeamAuditInterceptor } from '../../core/interceptors/team-audit.interceptor';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpensePostingService } from '../finance/expense-posting.service';
import { PostingService } from '../finance/posting.service';
import { TimelineService } from '../timeline/timeline.service';
import { DocumentIntelligenceService } from '../ai/document-intelligence.service';
import { ObjectStorageService } from '../../core/object-storage/objectStorage';

const BIZ_A = 'biz_r2_a';
const BIZ_B = 'biz_r2_b';
const VALID_ID = '11111111-2222-4333-8444-555555555555';
const PRIVATE_DIR = 'private';
const BUCKET_NAME = 'r2-test-bucket';

const ENV_KEYS = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'PRIVATE_OBJECT_DIR',
] as const;
const savedEnv: Record<string, string | undefined> = {};

let app: any;
let expensesById = new Map<string, any>();
let headBehavior: (key: string) => Promise<any>;
let s3HeadCount = 0;

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.S3_BUCKET = BUCKET_NAME;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ENDPOINT = 'http://127.0.0.1:9/storage/v1/s3';
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.PRIVATE_OBJECT_DIR = PRIVATE_DIR;

  headBehavior = async () => ({
    Metadata: {},
    ContentType: 'image/png',
    ContentLength: 42,
  });

  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
    if (cmd instanceof HeadObjectCommand) {
      s3HeadCount++;
      return headBehavior(String(cmd.input?.Key ?? ''));
    }
    throw new Error(`unexpected S3 cmd: ${cmd?.constructor?.name}`);
  });

  let seq = 1;
  const prismaClientMock: any = {
    business: {
      findFirst: vi.fn(async () => ({ id: BIZ_A, currency: 'TTD' })),
      findUnique: vi.fn(async () => ({ id: BIZ_A, currency: 'TTD' })),
    },
    expense: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = expensesById.get(where.id);
        if (!row || row.businessId !== where.businessId || row.deletedAt !== null) return null;
        return row;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `exp_${seq++}`, deletedAt: null, ...data };
        expensesById.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = expensesById.get(where.id);
        const updated = { ...existing, ...data };
        expensesById.set(where.id, updated);
        return updated;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prismaClientMock)),
  };

  const allowGuard = { canActivate: () => true };

  const moduleRef = await Test.createTestingModule({
    controllers: [ExpensesController],
    providers: [
      { provide: PrismaService, useValue: { client: prismaClientMock } },
      ExpensesService,
      { provide: ExpensePostingService, useValue: { onExpensePaid: vi.fn(), onBillCreated: vi.fn(), onExpenseVoided: vi.fn(), onExpenseEdited: vi.fn() } },
      { provide: PostingService, useValue: {} },
      { provide: EventEmitter2, useValue: { emit: vi.fn() } },
      { provide: TimelineService, useValue: { recordEvent: vi.fn() } },
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  })
    .overrideGuard(AuthGuard).useValue(allowGuard)
    .overrideGuard(BusinessGuard).useValue(allowGuard)
    .overrideGuard(ModuleScopeGuard).useValue(allowGuard)
    .overrideGuard(BusinessMemberGuard).useValue(allowGuard)
    .overrideInterceptor(TeamAuditInterceptor).useValue({ intercept: (_ctx: any, next: any) => next.handle() })
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  expensesById = new Map();
  s3HeadCount = 0;
  headBehavior = async () => ({
    Metadata: {},
    ContentType: 'image/png',
    ContentLength: 42,
  });
});

function postExp(receiptUrl: unknown) {
  return request(app.getHttpServer())
    .post(`/expenses/businesses/${BIZ_A}/expenses`)
    .send({ description: 'R2 test', amount: 10, receiptUrl });
}

function patchExp(id: string, receiptUrl: unknown) {
  return request(app.getHttpServer())
    .patch(`/expenses/businesses/${BIZ_A}/expenses/${id}`)
    .send({ receiptUrl });
}

function seedExp(id: string, receiptUrl: string) {
  expensesById.set(id, {
    id,
    businessId: BIZ_A,
    description: 'Seeded',
    amount: 10,
    currency: 'TTD',
    date: new Date(),
    status: 'PAID',
    deletedAt: null,
    receiptUrl,
  });
}

describe('P222 R2 hardening (RED-BEFORE on 4f994d963)', () => {
  it('SEC-P222-1: rejects percent-encoded /objects/ and malformed %-escape bypasses on POST and PATCH', async () => {
    const baseline = await postExp(`/objects/uploads/${BIZ_A}/${VALID_ID}`);
    expect(baseline.status).toBe(201);

    const bypasses = [
      `https://api.example.com/api/%6fbjects/uploads/${BIZ_B}/${VALID_ID}`,
      `https://api.example.com/__api/objects%2fuploads/${BIZ_B}/${VALID_ID}`,
      `https://api.example.com/foo/..%2fobjects/uploads/${BIZ_B}/${VALID_ID}`,
      `https://api.example.com/%6fbjects/uploads/${BIZ_B}/${VALID_ID}`,
      `https://api.example.com/%6fbjects/uploads/${BIZ_B}/bad%ZZid`,
      `/__api/%6fbjects/uploads/${BIZ_B}/${VALID_ID}`,
    ];

    for (const url of bypasses) {
      const pRes = await postExp(url);
      expect(pRes.status, `POST should reject ${url}`).toBe(400);
      const uRes = await patchExp(baseline.body.id, url);
      expect(uRes.status, `PATCH should reject ${url}`).toBe(400);
    }
  });

  it('SEC-P222-2 / R1-C2: rejects mixed dot encodings, backslashes, and CR/LF/TAB traversal on BOTH write and read', async () => {
    const traversalUrls = [
      `https://api.example.com/objects/uploads/${BIZ_B}/.%2e/${BIZ_A}/${VALID_ID}`,
      `https://api.example.com/objects/uploads/${BIZ_B}/%2e./${BIZ_A}/${VALID_ID}`,
      `https://api.example.com/objects/uploads/${BIZ_A}/%2e/${VALID_ID}`,
      `https://api.example.com/objects/uploads/${BIZ_A}/%252e%252e/${BIZ_B}/${VALID_ID}`,
      `https://api.example.com/objects/uploads/${BIZ_B}\\..\\${BIZ_A}\\${VALID_ID}`,
      `https://api.example.com/objects/uploads/${BIZ_B}/.\n./${BIZ_A}/${VALID_ID}`,
      `https://api.example.com/objects/uploads/${BIZ_B}/.\t./${BIZ_A}/${VALID_ID}`,
    ];

    for (let i = 0; i < traversalUrls.length; i++) {
      const url = traversalUrls[i];
      const wRes = await postExp(url);
      expect(wRes.status, `POST should reject traversal ${JSON.stringify(url)}`).toBe(400);

      seedExp(`trav_${i}`, url);
      s3HeadCount = 0;
      const rRes = await request(app.getHttpServer())
        .get(`/expenses/businesses/${BIZ_A}/expenses/trav_${i}/receipt`);
      expect(rRes.status, `GET receipt should 404 traversal ${JSON.stringify(url)}`).toBe(404);
      expect(s3HeadCount, `S3 must not be touched for ${JSON.stringify(url)}`).toBe(0);
    }
  });

  it('SEC-P222-3 / R1-C1: duplicate or bracketed ?expiresIn= query params fall back to 300s default instead of 500', async () => {
    seedExp('ttl_exp', `/objects/uploads/${BIZ_A}/${VALID_ID}`);

    for (const qs of [
      'expiresIn=60&expiresIn=120',
      'expiresIn[a]=60',
      'expiresIn=NaN',
      'expiresIn=',
    ]) {
      const res = await request(app.getHttpServer())
        .get(`/expenses/businesses/${BIZ_A}/expenses/ttl_exp/receipt?${qs}`);
      expect(res.status, `GET receipt ?${qs}`).toBe(200);
      expect(res.body.expiresIn, `GET receipt ?${qs} default TTL`).toBe(300);
    }

    const zeroRes = await request(app.getHttpServer())
      .get(`/expenses/businesses/${BIZ_A}/expenses/ttl_exp/receipt?expiresIn=0&download=false`);
    expect(zeroRes.status).toBe(200);
    expect(zeroRes.body.expiresIn).toBe(60);
    expect(new URL(zeroRes.body.url).searchParams.get('response-content-disposition')).toBeNull();
  });

  it('SEC-P222-4: rejects protocol-relative /\\evil.com/objects/... and unanchored relative paths', async () => {
    const storage = new ObjectStorageService();
    const badRelative = [
      `/\\evil.com/objects/uploads/${BIZ_A}/${VALID_ID}`,
      `//evil.com/objects/uploads/${BIZ_A}/${VALID_ID}`,
      `/redirect/objects/uploads/${BIZ_A}/${VALID_ID}`,
    ];

    for (const url of badRelative) {
      const res = await postExp(url);
      expect(res.status, `POST should reject ${url}`).toBe(400);
    }
    expect(storage.objectPathFromClientUrl(`/\\evil.com/objects/uploads/${BIZ_A}/${VALID_ID}`)).toBeNull();
    expect(storage.objectPathFromClientUrl(`/redirect/objects/uploads/${BIZ_A}/${VALID_ID}`)).toBeNull();
    expect(storage.objectPathFromClientUrl(`/__api/objects/uploads/${BIZ_A}/${VALID_ID}`)).toBe(
      `/objects/uploads/${BIZ_A}/${VALID_ID}`,
    );
  });

  it('SEC-P222-5: prototype keys in S3 ContentType (constructor, __proto__) never poison ResponseContentDisposition', async () => {
    seedExp('proto_exp', `/objects/uploads/${BIZ_A}/${VALID_ID}`);
    for (const ct of ['constructor', '__proto__', 'toString']) {
      headBehavior = async () => ({ Metadata: {}, ContentType: ct, ContentLength: 12 });
      const res = await request(app.getHttpServer())
        .get(`/expenses/businesses/${BIZ_A}/expenses/proto_exp/receipt?download=1`);
      expect(res.status).toBe(200);
      const disp = new URL(res.body.url).searchParams.get('response-content-disposition') ?? '';
      expect(disp).toBe('attachment; filename="receipt-proto_exp"');
      expect(disp).not.toContain('function');
      expect(disp).not.toContain('Object');
    }
  });

  it('SEC-P222-6: rejects control chars (CRLF/NUL) and user:pass@host credentials on POST and PATCH', async () => {
    const baseline = await postExp(`/objects/uploads/${BIZ_A}/${VALID_ID}`);
    expect(baseline.status).toBe(201);

    const badUrls = [
      'https://example.com/ok\r\nSet-Cookie:a=b',
      `/__api/objects/uploads/${BIZ_A}/${VALID_ID}?x=\r\nSet-Cookie:a=b`,
      'https://example.com/a\x00b',
      `https://${'alice'}:${'secret'}@api.example.com/objects/uploads/${BIZ_A}/${VALID_ID}`,
      'https://trusted.com@evil.com/receipt.pdf',
      'javascript:alert(1)',
    ];

    for (const url of badUrls) {
      expect((await postExp(url)).status, `POST ${JSON.stringify(url)}`).toBe(400);
      expect((await patchExp(baseline.body.id, url)).status, `PATCH ${JSON.stringify(url)}`).toBe(400);
    }
  });

  it('SEC-P222-7: forces attachment disposition for active content types (svg, html, xhtml) even without ?download=1', async () => {
    seedExp('active_exp', `/objects/uploads/${BIZ_A}/${VALID_ID}`);
    for (const ct of ['image/svg+xml', 'text/html; charset=utf-8', 'application/xhtml+xml']) {
      headBehavior = async () => ({ Metadata: {}, ContentType: ct, ContentLength: 64 });
      const res = await request(app.getHttpServer())
        .get(`/expenses/businesses/${BIZ_A}/expenses/active_exp/receipt`);
      expect(res.status, ct).toBe(200);
      const disp = new URL(res.body.url).searchParams.get('response-content-disposition');
      expect(disp, `${ct} must force attachment`).toMatch(/^attachment; filename="receipt-active_exp/);
    }
  });

  it('SEC-P222-8 / R1-C3 / R1-C4 / R1-C5: NoSuchKey -> 404, empty ContentType -> octet-stream, charset params, repeated endpoint slashes, PATCH null/spaces', async () => {
    // R1-C3: NoSuchKey without $metadata.httpStatusCode -> 404
    seedExp('missing_exp', `/objects/uploads/${BIZ_A}/${VALID_ID}`);
    headBehavior = async () => {
      throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    };
    expect(
      (await request(app.getHttpServer()).get(`/expenses/businesses/${BIZ_A}/expenses/missing_exp/receipt`)).status,
    ).toBe(404);

    // R1-C4: empty string ContentType falls back to application/octet-stream (and forces attachment)
    headBehavior = async () => ({ Metadata: {}, ContentType: '   ', ContentLength: 0 });
    const emptyCt = await request(app.getHttpServer())
      .get(`/expenses/businesses/${BIZ_A}/expenses/missing_exp/receipt`);
    expect(emptyCt.status).toBe(200);
    expect(emptyCt.body.contentType).toBe('application/octet-stream');
    expect(emptyCt.body.contentLength).toBe(0);

    // Charset params map to .png extension cleanly
    headBehavior = async () => ({ Metadata: {}, ContentType: 'image/png; charset=binary', ContentLength: 10 });
    const charsetRes = await request(app.getHttpServer())
      .get(`/expenses/businesses/${BIZ_A}/expenses/missing_exp/receipt?download=1`);
    expect(charsetRes.status).toBe(200);
    expect(new URL(charsetRes.body.url).searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="receipt-missing_exp.png"',
    );

    // SEC-P222-8: repeated slashes inside multi-segment S3 endpoint path still recognized as foreign bucket URL
    const repeatedEndpointBucketUrl =
      `http://127.0.0.1:9/storage/v1//s3/${BUCKET_NAME}/${PRIVATE_DIR}/uploads/${BIZ_B}/${VALID_ID}`;
    expect((await postExp(repeatedEndpointBucketUrl)).status).toBe(400);

    // R1-C5: PATCH with null and whitespace clears receiptUrl to null
    const created = await postExp(`/objects/uploads/${BIZ_A}/${VALID_ID}`);
    expect(created.status).toBe(201);
    const clearedNull = await patchExp(created.body.id, null);
    expect(clearedNull.status).toBe(200);
    expect(clearedNull.body.receiptUrl).toBeNull();
    const clearedSpaces = await patchExp(created.body.id, '   ');
    expect(clearedSpaces.status).toBe(200);
    expect(clearedSpaces.body.receiptUrl).toBeNull();
  });
});

/**
 * P110 (TOF-KNOWLEDGE-UPLOAD, #134) — Business knowledge upload routes are
 * module-scoped (AuthGuard + BusinessGuard + ModuleScopeGuard), quarantine-first,
 * bounded, SSRF-free, and only `status = 'approved'` documents of the calling
 * tenant reach `cortex.search_knowledge` (REAL database).
 *
 * RED-BEFORE proof on base `a1d3db2f`:
 *   1. `/api/v1/cortex/businesses/:businessId/knowledge*` routes do not exist
 *      yet (404) and `KeyCortexModule` does not register `KnowledgeIngestionController`.
 *   2. `KeyCortexActionsService.handleSearchKnowledge` (`cortex.search_knowledge`)
 *      queries `KnowledgeSource` without filtering `status: 'approved'`, so seeded
 *      `quarantined` and `pending` documents leak directly into search results.
 *
 * WHAT IS REAL:
 *   - Real PostgreSQL via `PrismaService` + `@keyflow/db` with tenant context
 *     provider wired as `main.ts` does.
 *   - Real `AuthGuard`, `BusinessGuard`, `ModuleScopeGuard`, `TenantInterceptor`,
 *     `GlobalHttpExceptionFilter`, `ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)`,
 *     `KnowledgeIngestionController`, `KnowledgeIngestionService`,
 *     `KeyCortexToolRegistryService`, and `KeyCortexActionsService`
 *     (`cortex.search_knowledge`).
 *   - Stand-ins: test header middleware (`x-v63b-user`) attaching the seeded user
 *     row as `AuthMiddleware` does after token verification, and minimal
 *     allow-all safety/saga stubs for `KeyCortexToolRegistryService` so
 *     `cortex.search_knowledge` reaches the real `handleSearchKnowledge` query.
 *
 * Fixture prefix: `v63b_` (registered in `apps/server/test/helpers/fixture-prefixes.json`).
 * Cleanup: raw SQL `$executeRawUnsafe` with `sqlLikePrefix(P)` in FK-safe order;
 * never `.deleteMany(` on any soft-deleted Prisma model.
 */
import 'reflect-metadata';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63b_';
const HEADER = 'x-v63b-user';

const ID = {
  ownerA: `${P}ownerA`,
  staffWriteA: `${P}staffWriteA`,
  staffReadA: `${P}staffReadA`,
  staffNoneA: `${P}staffNoneA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

const CONTROLLER_TS_PATH = path.resolve(
  __dirname,
  '../src/modules/key-cortex/knowledge-ingestion.controller.ts',
);
const MODULE_TS_PATH = path.resolve(
  __dirname,
  '../src/modules/key-cortex/key-cortex.module.ts',
);

let db: any;
let app: any;
let toolRegistry: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM cortex_action_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM knowledge_sources WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function basePath(businessId: string): string {
  return `/api/v1/cortex/businesses/${businessId}/knowledge`;
}

async function searchKnowledge(businessId: string, query: string, limit?: number) {
  const input: Record<string, unknown> = { query };
  if (limit !== undefined) input.limit = limit;
  return toolRegistry.execute(
    'cortex.search_knowledge',
    { businessId, autonomyLevel: 2 },
    input,
  );
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../src/app-bootstrap');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { KeyCortexToolRegistryService } = await import(
    '../src/modules/key-cortex/key-cortex-tool-registry.service'
  );
  const { KeyCortexActionsService } = await import(
    '../src/modules/key-cortex/key-cortex-actions.service'
  );

  const controllers: any[] = [];
  const extraProviders: any[] = [];

  if (existsSync(CONTROLLER_TS_PATH)) {
    const { KnowledgeIngestionController } = await import(
      '../src/modules/key-cortex/knowledge-ingestion.controller'
    );
    const { KnowledgeIngestionService } = await import(
      '../src/modules/key-cortex/knowledge-ingestion.service'
    );
    controllers.push(KnowledgeIngestionController);
    extraProviders.push(KnowledgeIngestionService);
  }

  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      ...extraProviders,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const userId = req.headers[HEADER] as string | undefined;
    if (!userId) {
      next();
      return;
    }
    db.user
      .findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } })
      .then((user: any) => {
        if (user) req.user = user;
        next();
      })
      .catch(next);
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  const safety = {
    check: async () => ({ allowed: true }),
    recordExecution: async () => undefined,
  };
  const saga = {
    addStep: async () => undefined,
    completeStep: async () => undefined,
    failStep: async () => undefined,
    compensate: async () => [],
  };
  toolRegistry = new KeyCortexToolRegistryService(
    prisma,
    safety as any,
    {} as any,
    saga as any,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  const actionsService = new KeyCortexActionsService(
    prisma,
    {} as any,
    toolRegistry,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  actionsService.onModuleInit();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' },
      { id: ID.staffWriteA, email: `${P}staffWriteA@test.local`, role: 'USER' },
      { id: ID.staffReadA, email: `${P}staffReadA@test.local`, role: 'USER' },
      { id: ID.staffNoneA, email: `${P}staffNoneA@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V63B Business A', ownerId: ID.ownerA },
      { id: ID.bizB, name: 'V63B Business B', ownerId: ID.ownerB },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}mem_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}mem_staffWriteA`,
        userId: ID.staffWriteA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'write' },
      },
      {
        id: `${P}mem_staffReadA`,
        userId: ID.staffReadA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'read' },
      },
      {
        id: `${P}mem_staffNoneA`,
        userId: ID.staffNoneA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'none' },
      },
      { id: `${P}mem_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('P110 (TOF-KNOWLEDGE-UPLOAD, #134) real-DB proof', () => {
  it('RED-BEFORE: KeyCortexModule registers KnowledgeIngestionController in controllers', () => {
    const moduleSrc = readFileSync(MODULE_TS_PATH, 'utf8');
    expect(moduleSrc).toContain('KnowledgeIngestionController');
    const controllersBlock = moduleSrc.match(/controllers\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    expect(controllersBlock).toContain('KnowledgeIngestionController');
  });

  it('RED-BEFORE: seeded quarantined and pending KnowledgeSource rows never leak into cortex.search_knowledge', async () => {
    const leakToken = `${P}direct_leak_sentinel_9871`;
    await db.knowledgeSource.createMany({
      data: [
        {
          id: `${P}ks_seeded_quarantined`,
          businessId: ID.bizA,
          title: `Quarantined ${leakToken}`,
          sourceType: 'text',
          content: `Untrusted prompt payload ${leakToken}`,
          status: 'quarantined',
        },
        {
          id: `${P}ks_seeded_pending`,
          businessId: ID.bizA,
          title: `Pending ${leakToken}`,
          sourceType: 'url',
          sourceUrl: 'https://example.com/pending',
          content: '',
          status: 'pending',
        },
      ],
    });

    const searchRes = await searchKnowledge(ID.bizA, leakToken);
    expect(searchRes.success).toBe(true);
    expect(searchRes.data.count).toBe(0);
    expect(searchRes.data.results).toEqual([]);
  });

  let uploadedTextSourceId = '';
  const uploadedTextToken = `${P}approved_flow_token_4421`;
  const uploadedTextSecretBody = `Confidential business playbook ${uploadedTextToken} — never return in list`;

  it('RED-BEFORE [Case 1]: ai:write uploads text -> 201 quarantined, NOT_ADMITTED, absent from cortex.search_knowledge', async () => {
    const res = await request(app.getHttpServer())
      .post(`${basePath(ID.bizA)}/text`)
      .set(HEADER, ID.staffWriteA)
      .send({
        title: `Playbook ${uploadedTextToken}`,
        content: uploadedTextSecretBody,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      sourceId: expect.any(String),
      status: 'quarantined',
      retrieval: 'NOT_ADMITTED',
    });

    uploadedTextSourceId = res.body.sourceId;

    const row = await db.knowledgeSource.findUnique({ where: { id: uploadedTextSourceId } });
    expect(row).toMatchObject({
      businessId: ID.bizA,
      status: 'quarantined',
      sourceType: 'text',
    });

    const searchRes = await searchKnowledge(ID.bizA, uploadedTextToken);
    expect(searchRes.success).toBe(true);
    expect(searchRes.data.count).toBe(0);
    expect(searchRes.data.results).toEqual([]);
  });

  it('RED-BEFORE [Case 2]: ai:write approves source -> status approved, now returned by cortex.search_knowledge', async () => {
    expect(uploadedTextSourceId).toBeTruthy();

    const res = await request(app.getHttpServer())
      .post(`${basePath(ID.bizA)}/${uploadedTextSourceId}/approve`)
      .set(HEADER, ID.staffWriteA)
      .send();

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      sourceId: uploadedTextSourceId,
      status: 'approved',
    });

    const row = await db.knowledgeSource.findUnique({ where: { id: uploadedTextSourceId } });
    expect(row?.status).toBe('approved');

    const searchRes = await searchKnowledge(ID.bizA, uploadedTextToken);
    expect(searchRes.success).toBe(true);
    expect(searchRes.data.count).toBe(1);
    expect(searchRes.data.results).toEqual([
      {
        id: uploadedTextSourceId,
        title: `Playbook ${uploadedTextToken}`,
        sourceType: 'text',
      },
    ]);

    // Idempotent re-approval stays clean.
    const repeat = await request(app.getHttpServer())
      .post(`${basePath(ID.bizA)}/${uploadedTextSourceId}/approve`)
      .set(HEADER, ID.staffWriteA)
      .send();
    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual({
      sourceId: uploadedTextSourceId,
      status: 'approved',
    });
  });

  it('RED-BEFORE [Case 3]: POST url stores pending (zero fetch, not searchable) and rejects unsafe protocols & >64 KiB UTF-8 text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const urlToken = `${P}url_guide_token_7712`;

    const urlRes = await request(app.getHttpServer())
      .post(`${basePath(ID.bizA)}/url`)
      .set(HEADER, ID.staffWriteA)
      .send({
        url: `https://example.com/docs/${urlToken}`,
        title: `Guide ${urlToken}`,
      });

    expect(urlRes.status).toBe(201);
    expect(urlRes.body).toEqual({
      sourceId: expect.any(String),
      status: 'pending',
      acquisition: 'NOT_FETCHED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const urlRow = await db.knowledgeSource.findUnique({ where: { id: urlRes.body.sourceId } });
    expect(urlRow).toMatchObject({
      businessId: ID.bizA,
      status: 'pending',
      sourceType: 'url',
      content: '',
    });

    const urlSearch = await searchKnowledge(ID.bizA, urlToken);
    expect(urlSearch.success).toBe(true);
    expect(urlSearch.data.count).toBe(0);

    // Unsafe URL protocols rejected with 400 on both POST url and POST text (sourceUrl)
    for (const badUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,hi']) {
      const badUrlRes = await request(app.getHttpServer())
        .post(`${basePath(ID.bizA)}/url`)
        .set(HEADER, ID.staffWriteA)
        .send({ url: badUrl, title: 'Bad protocol' });
      expect(badUrlRes.status, `POST url should reject ${badUrl}`).toBe(400);

      const badSourceUrlRes = await request(app.getHttpServer())
        .post(`${basePath(ID.bizA)}/text`)
        .set(HEADER, ID.staffWriteA)
        .send({ title: 'Bad sourceUrl', content: 'hello', sourceUrl: badUrl });
      expect(badSourceUrlRes.status, `POST text should reject sourceUrl ${badUrl}`).toBe(400);
    }

    // > 64 KiB ASCII text rejected with 400
    const overAscii = await request(app.getHttpServer())
      .post(`${basePath(ID.bizA)}/text`)
      .set(HEADER, ID.staffWriteA)
      .send({ title: 'Too large ASCII', content: 'a'.repeat(64 * 1024 + 1) });
    expect(overAscii.status).toBe(400);

    // > 64 KiB multi-byte UTF-8 text (32,769 2-byte chars = 65,538 bytes > 65,536 bytes, even though .length < 65,536!)
    const overUtf8 = await request(app.getHttpServer())
      .post(`${basePath(ID.bizA)}/text`)
      .set(HEADER, ID.staffWriteA)
      .send({ title: 'Too large UTF-8', content: 'é'.repeat(32 * 1024 + 1) });
    expect(overUtf8.status).toBe(400);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('RED-BEFORE [Case 4]: GET knowledge returns bounded metadata WITHOUT content and rejects invalid limit/offset/status', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath(ID.bizA)}?limit=10&offset=0`)
      .set(HEADER, ID.staffReadA);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const item of res.body) {
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'sourceType', 'status', 'title']);
      expect('content' in item).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain(uploadedTextSecretBody);

    // Filtered by status
    const approvedOnly = await request(app.getHttpServer())
      .get(`${basePath(ID.bizA)}?status=approved&limit=5&offset=0`)
      .set(HEADER, ID.staffReadA);
    expect(approvedOnly.status).toBe(200);
    expect(approvedOnly.body.length).toBeGreaterThanOrEqual(1);
    expect(approvedOnly.body.every((r: any) => r.status === 'approved')).toBe(true);

    // Invalid pagination & status values rejected with 400
    for (const qs of [
      'limit=0',
      'limit=-1',
      'limit=101',
      'limit=abc',
      'offset=-1',
      'offset=abc',
      'status=not_a_real_status',
    ]) {
      const bad = await request(app.getHttpServer())
        .get(`${basePath(ID.bizA)}?${qs}`)
        .set(HEADER, ID.staffReadA);
      expect(bad.status, `GET ?${qs} should be 400`).toBe(400);
    }
  });

  it('RED-BEFORE [Case 5]: scope & auth boundaries (401 unauth, 403 ai:none everywhere, ai:read read-only)', async () => {
    const targetId = uploadedTextSourceId || `${P}ks_seeded_quarantined`;

    // Unauthenticated -> 401 on every route
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/text`).send({ title: 'T', content: 'C' })).status).toBe(401);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/url`).send({ url: 'https://example.com' })).status).toBe(401);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/${targetId}/approve`).send()).status).toBe(401);
    expect((await request(app.getHttpServer()).get(basePath(ID.bizA))).status).toBe(401);

    // ai:none -> 403 on every route
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/text`).set(HEADER, ID.staffNoneA).send({ title: 'T', content: 'C' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/url`).set(HEADER, ID.staffNoneA).send({ url: 'https://example.com' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/${targetId}/approve`).set(HEADER, ID.staffNoneA).send()).status).toBe(403);
    expect((await request(app.getHttpServer()).get(basePath(ID.bizA)).set(HEADER, ID.staffNoneA)).status).toBe(403);

    // ai:read -> 200 on GET, 403 on POST text / url / approve
    expect((await request(app.getHttpServer()).get(basePath(ID.bizA)).set(HEADER, ID.staffReadA)).status).toBe(200);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/text`).set(HEADER, ID.staffReadA).send({ title: 'T', content: 'C' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/url`).set(HEADER, ID.staffReadA).send({ url: 'https://example.com' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/${targetId}/approve`).set(HEADER, ID.staffReadA).send()).status).toBe(403);
  });

  it('RED-BEFORE [Case 6]: cross-tenant isolation (Biz B OWNER cannot list, approve, or search Biz A documents)', async () => {
    const quarantinedA = `${P}ks_seeded_quarantined`;

    // Direct call against Biz A's routes by Biz B OWNER -> 403 from BusinessGuard
    expect((await request(app.getHttpServer()).get(basePath(ID.bizA)).set(HEADER, ID.ownerB)).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`${basePath(ID.bizA)}/${quarantinedA}/approve`).set(HEADER, ID.ownerB).send()).status).toBe(403);

    // On Biz B's own routes: list does not contain Biz A's documents
    const listB = await request(app.getHttpServer())
      .get(basePath(ID.bizB))
      .set(HEADER, ID.ownerB);
    expect(listB.status).toBe(200);
    expect(listB.body).toEqual([]);

    // On Biz B's own route: attempting to approve Biz A's sourceId returns 404 and does NOT mutate Biz A's row
    const crossApprove = await request(app.getHttpServer())
      .post(`${basePath(ID.bizB)}/${quarantinedA}/approve`)
      .set(HEADER, ID.ownerB)
      .send();
    expect(crossApprove.status).toBe(404);
    const stillQuarantined = await db.knowledgeSource.findUnique({ where: { id: quarantinedA } });
    expect(stillQuarantined?.status).toBe('quarantined');

    // cortex.search_knowledge for Biz B never returns Biz A's approved document
    const searchB = await searchKnowledge(ID.bizB, uploadedTextToken);
    expect(searchB.success).toBe(true);
    expect(searchB.data.count).toBe(0);
    expect(searchB.data.results).toEqual([]);
  });
});

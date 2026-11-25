/**
 * P64 — V1-66 (W11-CALLS-LIST-PAGING, F-30 & F-31):
 * `GET /businesses/:businessId/calls?limit=<n>&offset=<m>`
 *
 * Mounts the real production `configureNestApp(app)` pipe (`ValidationPipe({
 * whitelist: true, transform: true })`, no `enableImplicitConversion`) against
 * a real Postgres database so query-string coercion (`@Type(() => Number)`) and
 * total ordering (`[{ scheduledAt: 'asc' }, { id: 'asc' }]`, NULLs last) are
 * proven end-to-end.
 *
 * Fixtures use prefix `v66i_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import IORedis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66i_';

const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`,
  tMinus1h: `${P}cl_0_earlier`,
  tSameC: `${P}cl_1_same_c`,
  tSameA: `${P}cl_1_same_a`,
  tSameB: `${P}cl_1_same_b`,
  nullC: `${P}cl_2_null_c`,
  nullA: `${P}cl_2_null_a`,
  nullB: `${P}cl_2_null_b`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: any;
let redis: IORedis;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM call_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function clearRateLimits() {
  if (!redis) return;
  try {
    const keys = await redis.keys(`rl:*${ID.owner}*`);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}

function getCalls(query = '') {
  return request(app.getHttpServer())
    .get(`/businesses/${ID.bizA}/calls${query}`)
    .set('x-test-user', ID.owner);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { CallTaskController } = await import('../src/modules/call-tasks/call-task.controller');
  const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
  const { CallScriptService } = await import('../src/modules/call-tasks/call-script.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  const emitter = { emit: () => true };
  const scripts = { generateScript: async () => ({}) };

  const moduleRef = await Test.createTestingModule({
    controllers: [CallTaskController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      RateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      CallLogService,
      { provide: EventEmitter2, useValue: emitter },
      { provide: CallScriptService, useValue: scripts },
    ],
  }).compile();

  const callLogs = moduleRef.get(CallLogService);
  const controller = moduleRef.get(CallTaskController) as any;
  controller.callLogs = callLogs;
  controller.callScripts = scripts;

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  configureNestApp(app);
  await app.init();

  await cleanup();
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V66I Calls Paging', slug: `${P}biz-a`, ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });

  const T = new Date('2026-07-01T14:00:00.000Z');
  const TMinus1h = new Date('2026-07-01T13:00:00.000Z');

  // Intentionally insert tied rows in reverse id order (c, b, a) so insertion order != id asc.
  const rows: Array<{ id: string; scheduledAt: Date | null }> = [
    { id: ID.nullC, scheduledAt: null },
    { id: ID.tSameC, scheduledAt: T },
    { id: ID.nullB, scheduledAt: null },
    { id: ID.tSameB, scheduledAt: T },
    { id: ID.tMinus1h, scheduledAt: TMinus1h },
    { id: ID.tSameA, scheduledAt: T },
    { id: ID.nullA, scheduledAt: null },
  ];
  for (const row of rows) {
    await db.callLog.create({
      data: {
        id: row.id,
        businessId: ID.bizA,
        callerId: ID.owner,
        scheduledAt: row.scheduledAt,
      },
    });
  }
});

afterAll(async () => {
  await cleanup();
  await clearRateLimits();
  if (app) await app.close();
  if (redis) await redis.quit();
});

describe('P64 — V1-66 (W11-CALLS-LIST-PAGING, F-30 & F-31)', () => {
  it('CLP-01 RED-BEFORE: ?limit=2&offset=2 passes the production ValidationPipe with numeric limit/offset and total 7', async () => {
    const res = await getCalls('?limit=2&offset=2');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(2);
    expect(res.body.total).toBe(7);
    expect(res.body.items).toHaveLength(2);
  });

  it('CLP-02: invalid limit/offset values are still refused with 400', async () => {
    for (const bad of ['?limit=0', '?limit=abc', '?offset=-1', '?limit=1.5', '?offset=abc']) {
      const res = await getCalls(bad);
      expect(res.status, `expected 400 for ${bad}`).toBe(400);
    }
  });

  it('CLP-03 RED-BEFORE: paginating ?limit=2&offset=0,2,4,6 yields all 7 ids once in deterministic scheduledAt asc (NULLs last), id asc order', async () => {
    const expectedOrder = [
      ID.tMinus1h,
      ID.tSameA,
      ID.tSameB,
      ID.tSameC,
      ID.nullA,
      ID.nullB,
      ID.nullC,
    ];

    const collected: string[] = [];
    for (const offset of [0, 2, 4, 6]) {
      const res = await getCalls(`?limit=2&offset=${offset}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(offset);
      for (const item of res.body.items) {
        collected.push(item.id);
      }
    }

    expect(collected).toHaveLength(7);
    expect(new Set(collected).size).toBe(7);
    expect(collected).toEqual(expectedOrder);
  });
});

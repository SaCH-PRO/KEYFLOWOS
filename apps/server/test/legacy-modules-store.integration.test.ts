/**
 * WEDGE-HIDE-STORE (P225; D-263 'wedge'; orchestrator decision option (A) part 1, #273 7207944212): the per-business
 * legacy answer (NAV-B-LEGACY-SERVER, GET /identity/businesses/:businessId/legacy-modules) names `store` for a business
 * that has taken a store order or a quick sale, and for no other business. REAL Postgres (DATABASE_URL), REAL
 * IdentityController, AuthGuard, BusinessGuard, LegacyModulesService and packages/shared/src/v1-modules.ts.
 *
 *   WHS-I01  a business with a store order (marketplace_orders) answers ['store']
 *   WHS-I02  a business with only a quick sale (a QS- marketplace order) answers ['store']
 *   WHS-I03  a business with no order answers [] (it is not offered selling online at launch)
 *   WHS-I04  another tenant's order never counts; a cancelled order still does (the business has sold online)
 *
 * FIXTURES: prefix `v67s_` (test/helpers/fixture-prefixes.json), cleaned by raw SQL in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v67s_';
const HEADER = 'x-v67s-user';

const ID = {
  owner: `${P}owner`,
  ownerOther: `${P}ownerOther`,
  bizStore: `${P}bizStore`,
  bizQuick: `${P}bizQuick`,
  bizNone: `${P}bizNone`,
  bizCancelled: `${P}bizCancelled`,
  bizOther: `${P}bizOther`,
};

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM marketplace_order_items WHERE order_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function legacyModules(businessId: string, actor: string) {
  return request(app.getHttpServer()).get(`/identity/businesses/${businessId}/legacy-modules`).set(HEADER, actor);
}

async function order(id: string, businessId: string, orderNumber: string, status = 'placed') {
  await db.marketplaceOrder.create({
    data: { id, businessId, orderNumber, status, customerName: `${P}Customer`, total: 120, subtotal: 120, currency: 'TTD' },
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? '', 'DATABASE_URL must name the test database').not.toBe('');
  db = (await import('@keyflow/db')).db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { LegacyModulesService } = await import('../src/modules/identity/legacy-modules.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      { provide: PrismaService, useValue: { client: db } },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      LegacyModulesService,
      { provide: IdentityService, useValue: {} },
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    if (typeof header === 'string' && header.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id: header }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.ownerOther]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@v67s.test.local`, name: `${id} Name`, role: 'USER' } });
  }
  for (const [id, owner] of [
    [ID.bizStore, ID.owner],
    [ID.bizQuick, ID.owner],
    [ID.bizNone, ID.owner],
    [ID.bizCancelled, ID.owner],
    [ID.bizOther, ID.ownerOther],
  ] as const) {
    await db.business.create({ data: { id, name: `${id} Business`, ownerId: owner, slug: `${P}${id.slice(P.length).toLowerCase()}` } });
    // BusinessGuard admits a member: each owner holds an OWNER membership of their business.
    await db.membership.create({ data: { id: `${P}m_${id.slice(P.length)}`, userId: owner, businessId: id, role: 'OWNER' } });
  }
  await order(`${P}o_store`, ID.bizStore, `${P}ORD-1001`);
  await order(`${P}o_quick`, ID.bizQuick, `QS-${P.toUpperCase()}A1-ABC123`, 'completed');
  await order(`${P}o_cancel`, ID.bizCancelled, `${P}ORD-1002`, 'cancelled');
  await order(`${P}o_other`, ID.bizOther, `${P}ORD-1003`);
});

afterAll(async () => {
  await app?.close();
  await cleanup();
});

describe('WEDGE-HIDE-STORE: the legacy answer names the store for a business that sells online, and only for it', () => {
  it('[WHS-I01] RED-BEFORE: a business with a store order answers ["store"]', async () => {
    const res = await legacyModules(ID.bizStore, ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual(['store']);
  });

  it('[WHS-I02] RED-BEFORE: a business with only a quick sale answers ["store"]', async () => {
    const res = await legacyModules(ID.bizQuick, ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual(['store']);
  });

  it('[WHS-I03] a business with no order answers [] (not offered selling online at launch)', async () => {
    const res = await legacyModules(ID.bizNone, ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('[WHS-I04] RED-BEFORE: another tenant\'s order never counts; a cancelled order still does', async () => {
    const other = await legacyModules(ID.bizOther, ID.ownerOther);
    expect(other.status, other.text).toBe(200);
    expect(other.body).toEqual(['store']);
    const cancelled = await legacyModules(ID.bizCancelled, ID.owner);
    expect(cancelled.body).toEqual(['store']);
    const none = await legacyModules(ID.bizNone, ID.owner);
    expect(none.body).toEqual([]);
  });
});

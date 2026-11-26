/**
 * P88 — V1-66 (SWP-CENSUS-MARKETPLACE, P1 launch-track, Journey J):
 *
 * Real Postgres + real NestJS HTTP app (`AuthGuard`, `BusinessGuard`,
 * `CrmRateLimitGuard`, `ModuleScopeGuard`, `GlobalHttpExceptionFilter`) on
 * `MarketplaceController` covering all 3 remaining open write rows in
 * `docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md`:
 *
 *   1. `MarketplaceController.createOrder`              POST /marketplace/businesses/:businessId/orders                       -> storefront:write
 *   2. `MarketplaceController.processPostPurchaseJobs`  POST /marketplace/businesses/:businessId/post-purchase/process        -> storefront:write
 *   3. `MarketplaceController.promoteProductToContent`  POST /marketplace/businesses/:businessId/products/:productId/promote  -> content:write
 *
 * Proves:
 *   - [CM-01] RED-BEFORE: STAFF member with `none` on `storefront` & `content` is
 *             refused 403 (`Insufficient permissions: <module> requires write
 *             access (you have none)`) on all 3 routes, with ZERO service calls.
 *   - [CM-02] RED-BEFORE: STAFF member with `read` on `storefront` & `content`
 *             is refused 403 (`... (you have read)`) on all 3 routes, with ZERO
 *             service calls.
 *   - [CM-03] RED-BEFORE: Cross-module scope isolation — STAFF with
 *             `storefront:write` + `content:read` succeeds on `createOrder` and
 *             `processPostPurchaseJobs` (201) and is refused 403 on
 *             `promoteProductToContent`; STAFF with `content:write` +
 *             `storefront:read` succeeds on `promoteProductToContent` (201) and
 *             is refused 403 on `createOrder` and `processPostPurchaseJobs`.
 *   - [CM-04] Control: OWNER succeeds (201) on all 3 routes, reaching each
 *             service once.
 *   - [CM-05] Control: cross-tenant OWNER is refused 403 with ZERO service calls;
 *             unauthenticated request is refused 401.
 *   - [CM-06] RED-BEFORE metadata check: all 3 rows run AuthGuard -> BusinessGuard
 *             -> ModuleScopeGuard and declare their exact `@RequireModuleScope`;
 *             D-112 exempt fulfillment routes remain without a module scope, and
 *             existing scoped routes (`createQuickSale` revenue:write,
 *             `createProjectForBundleOrder` projects:write,
 *             `updatePurchaseOrder`/`advancePurchaseOrderStatus` expenses:write)
 *             are unchanged.
 *
 * Fixtures use pre-allocated prefix `v66m_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66m_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffStorefrontOnly: `${P}staffStorefront`,
  staffContentOnly: `${P}staffContent`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
let MarketplaceControllerClass: any;
let MODULE_SCOPE_KEY_VAL: string;
const serviceCalls: Array<{ service: string; op: string }> = [];
/* eslint-enable @typescript-eslint/no-explicit-any */

function makeRecorder(service: string) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return async () => {
          serviceCalls.push({ service, op: prop });
          return { ok: true, service, op: prop };
        };
      },
    },
  );
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

interface MarketplaceDoor {
  handler: string;
  module: 'storefront' | 'content';
  service: string;
  op: string;
  url: (bizId: string) => string;
  body: Record<string, unknown>;
}

const OPEN_DOORS: MarketplaceDoor[] = [
  {
    handler: 'createOrder',
    module: 'storefront',
    service: 'MarketplaceService',
    op: 'createOrder',
    url: (b) => `/marketplace/businesses/${b}/orders`,
    body: { customerName: 'Walk-in', items: [] },
  },
  {
    handler: 'processPostPurchaseJobs',
    module: 'storefront',
    service: 'CommerceIntegrationService',
    op: 'processPostPurchaseJobs',
    url: (b) => `/marketplace/businesses/${b}/post-purchase/process`,
    body: {},
  },
  {
    handler: 'promoteProductToContent',
    module: 'content',
    service: 'CommerceIntegrationService',
    op: 'promoteProductToContent',
    url: (b) => `/marketplace/businesses/${b}/products/${P}prod_1/promote`,
    body: {},
  },
];

const EXEMPT_FULFILLMENT_HANDLERS = [
  'updateOrderStatus',
  'fulfillOrder',
  'createShipment',
  'updateShipment',
  'routeOrder',
  'updateFulfillmentRoute',
  'activatePreorderRoute',
  'createPreOrder',
  'updatePreOrder',
  'createCustomsDeclaration',
  'updateCustomsDeclaration',
];

function agent() {
  return request(app.getHttpServer());
}

function sendDoor(door: MarketplaceDoor, actor: string | null, bizId = ID.bizA) {
  const req = agent().post(door.url(bizId));
  if (actor !== null) req.set(HEADER, actor);
  return req.send(door.body);
}

beforeAll(async () => {
  Logger.overrideLogger(false);

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');

  MarketplaceControllerClass = MarketplaceController;
  MODULE_SCOPE_KEY_VAL = MODULE_SCOPE_KEY;

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  db = prismaService.client;
  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' },
      { id: ID.staffNone, email: `${P}staffNone@test.local`, role: 'USER' },
      { id: ID.staffRead, email: `${P}staffRead@test.local`, role: 'USER' },
      { id: ID.staffStorefrontOnly, email: `${P}staffStorefront@test.local`, role: 'USER' },
      { id: ID.staffContentOnly, email: `${P}staffContent@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: `${P}Biz A`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: `${P}Biz B`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}m_staffNone`,
        userId: ID.staffNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { storefront: 'none', content: 'none' },
      },
      {
        id: `${P}m_staffRead`,
        userId: ID.staffRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { storefront: 'read', content: 'read' },
      },
      {
        id: `${P}m_staffStorefront`,
        userId: ID.staffStorefrontOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { storefront: 'write', content: 'read' },
      },
      {
        id: `${P}m_staffContent`,
        userId: ID.staffContentOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { storefront: 'read', content: 'write' },
      },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController],
    providers: [
      { provide: PrismaService, useValue: prismaService },
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      ModuleScopeGuard,
      { provide: MarketplaceService, useValue: makeRecorder('MarketplaceService') },
      { provide: CommerceIntegrationService, useValue: makeRecorder('CommerceIntegrationService') },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.length > 0) {
      req.user = { id: uid, role: 'USER', email: `${P}req_${uid}@test.local` };
    }
    next();
  });
  await app.init();
});

beforeEach(() => {
  serviceCalls.length = 0;
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
});

describe('P88 — SWP-CENSUS-MARKETPLACE (MarketplaceController 3 open write rows)', () => {
  it('[CM-01] RED-BEFORE: STAFF with none on storefront & content is refused 403 on all 3 routes with zero service calls', async () => {
    for (const door of OPEN_DOORS) {
      const res = await sendDoor(door, ID.staffNone);
      expect(res.status, `${door.handler} (${JSON.stringify(res.body)})`).toBe(403);
      expect(String(res.body?.message ?? '')).toMatch(
        new RegExp(`Insufficient permissions: ${door.module} requires write access \\(you have none\\)`),
      );
    }
    expect(serviceCalls).toEqual([]);
  });

  it('[CM-02] RED-BEFORE: STAFF with read on storefront & content is refused 403 on all 3 routes with zero service calls', async () => {
    for (const door of OPEN_DOORS) {
      const res = await sendDoor(door, ID.staffRead);
      expect(res.status, `${door.handler} (${JSON.stringify(res.body)})`).toBe(403);
      expect(String(res.body?.message ?? '')).toMatch(
        new RegExp(`Insufficient permissions: ${door.module} requires write access \\(you have read\\)`),
      );
    }
    expect(serviceCalls).toEqual([]);
  });

  it('[CM-03] RED-BEFORE: cross-module scope isolation — storefront:write vs content:write', async () => {
    // storefront:write + content:read
    const sfOrder = await sendDoor(OPEN_DOORS[0], ID.staffStorefrontOnly);
    expect(sfOrder.status, JSON.stringify(sfOrder.body)).toBe(201);
    const sfJobs = await sendDoor(OPEN_DOORS[1], ID.staffStorefrontOnly);
    expect(sfJobs.status, JSON.stringify(sfJobs.body)).toBe(201);
    const sfPromote = await sendDoor(OPEN_DOORS[2], ID.staffStorefrontOnly);
    expect(sfPromote.status, JSON.stringify(sfPromote.body)).toBe(403);
    expect(String(sfPromote.body?.message ?? '')).toMatch(/content requires write access \(you have read\)/);

    serviceCalls.length = 0;

    // content:write + storefront:read
    const ctPromote = await sendDoor(OPEN_DOORS[2], ID.staffContentOnly);
    expect(ctPromote.status, JSON.stringify(ctPromote.body)).toBe(201);
    const ctOrder = await sendDoor(OPEN_DOORS[0], ID.staffContentOnly);
    expect(ctOrder.status, JSON.stringify(ctOrder.body)).toBe(403);
    expect(String(ctOrder.body?.message ?? '')).toMatch(/storefront requires write access \(you have read\)/);
    const ctJobs = await sendDoor(OPEN_DOORS[1], ID.staffContentOnly);
    expect(ctJobs.status, JSON.stringify(ctJobs.body)).toBe(403);
    expect(String(ctJobs.body?.message ?? '')).toMatch(/storefront requires write access \(you have read\)/);
  });

  it('[CM-04] Control: OWNER succeeds (201) on all 3 routes, reaching each service once', async () => {
    for (const door of OPEN_DOORS) {
      const res = await sendDoor(door, ID.ownerA);
      expect(res.status, `${door.handler} (${JSON.stringify(res.body)})`).toBe(201);
    }
    expect(serviceCalls).toEqual(OPEN_DOORS.map((d) => ({ service: d.service, op: d.op })));
  });

  it('[CM-05] Control: cross-tenant OWNER is refused 403 and unauthenticated is refused 401 with zero service calls', async () => {
    for (const door of OPEN_DOORS) {
      const other = await sendDoor(door, ID.ownerB, ID.bizA);
      expect(other.status, `cross-tenant ${door.handler}`).toBe(403);
      const unauth = await sendDoor(door, null, ID.bizA);
      expect(unauth.status, `unauth ${door.handler}`).toBe(401);
    }
    expect(serviceCalls).toEqual([]);
  });

  it('[CM-06] RED-BEFORE metadata check: exact scopes on all 3 rows, D-112 fulfillment routes stay unscoped, existing gates preserved', () => {
    const classGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, MarketplaceControllerClass) ?? [];
    const classGuardNames = classGuards.map((g) => g?.name ?? String(g));
    expect(classGuardNames).toContain('AuthGuard');
    expect(classGuardNames).toContain('BusinessGuard');
    expect(classGuardNames).toContain('ModuleScopeGuard');
    expect(classGuardNames.indexOf('BusinessGuard')).toBeLessThan(classGuardNames.indexOf('ModuleScopeGuard'));

    for (const door of OPEN_DOORS) {
      const handlerFn = MarketplaceControllerClass.prototype[door.handler];
      expect(handlerFn, `missing ${door.handler}`).toBeTypeOf('function');
      const scope = Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, handlerFn);
      expect(scope, `${door.handler} scope`).toEqual({ module: door.module, minLevel: 'write' });
    }

    for (const h of EXEMPT_FULFILLMENT_HANDLERS) {
      const handlerFn = MarketplaceControllerClass.prototype[h];
      expect(handlerFn, `missing ${h}`).toBeTypeOf('function');
      const scope = Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, handlerFn);
      expect(scope, `D-112 exempt ${h} must remain unscoped`).toBeUndefined();
    }

    expect(Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, MarketplaceControllerClass.prototype.createQuickSale)).toEqual({
      module: 'revenue',
      minLevel: 'write',
    });
    expect(
      Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, MarketplaceControllerClass.prototype.createProjectForBundleOrder),
    ).toEqual({
      module: 'projects',
      minLevel: 'write',
    });
    expect(Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, MarketplaceControllerClass.prototype.updatePurchaseOrder)).toEqual({
      module: 'expenses',
      minLevel: 'write',
    });
    expect(
      Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, MarketplaceControllerClass.prototype.advancePurchaseOrderStatus),
    ).toEqual({
      module: 'expenses',
      minLevel: 'write',
    });
  });
});

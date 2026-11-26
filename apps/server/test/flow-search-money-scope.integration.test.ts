/**
 * P91 — FU-SEARCH-MONEY-SCOPE (server, P1 launch-track, S, D-100):
 *
 * Real Postgres + real NestJS HTTP app (`FlowController`, `AuthGuard`,
 * `BusinessGuard`, `GlobalHttpExceptionFilter`) proving `GET /api/flows/businesses/:b/search`
 * (Cmd/K universal search) never exposes invoice monetary totals or invoice rows
 * to a member without `revenue:read`:
 *
 *   - [FSM-01] RED-BEFORE: STAFF with `revenue: 'none'` receives `invoices: []`
 *              (shape preserved, zero invoice totals/numbers in body) while still
 *              receiving matching contacts/products/projects.
 *   - [FSM-02] RED-BEFORE: ADMIN with explicit `{ revenue: 'none' }` (D-114) and
 *              ADMIN with empty array `permissionScopes: []` (SV-4) receive
 *              `invoices: []` (zero invoice totals/numbers in body).
 *   - [FSM-03] Control: OWNER, STAFF with `revenue: 'read'`, and SUPER_ADMIN
 *              receive matching invoices (including `invoiceNumber`, `total`,
 *              `currency`, `status`) unchanged, both by invoiceNumber and by
 *              contact name query.
 *   - [FSM-04] Control: cross-tenant OWNER is refused 403; unauthenticated is
 *              refused 401; short query (<2 chars) returns empty 5-bucket shape.
 *
 * Fixtures use prefix `v91s_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91s_';
const HEADER = 'x-test-user-id';
const ROLE_HEADER = 'x-test-user-role';

const ID = {
  ownerA: `${P}ownerA`,
  staffRevNone: `${P}staffRevNone`,
  staffRevRead: `${P}staffRevRead`,
  adminRevNone: `${P}adminRevNone`,
  adminEmptyArr: `${P}adminEmptyArr`,
  superAdmin: `${P}superAdmin`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  invoiceA: `${P}invoiceA`,
  productA: `${P}productA`,
  projectA: `${P}projectA`,
};

const SECRET_TOTAL = 87654;
const SEARCH_TOKEN = 'Zirconia';
const INVOICE_NUM = 'INV-ZIRCONIA-991';

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
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

function search(actor: string | null, q: string, bizId = ID.bizA, role = 'USER') {
  const req = request(app.getHttpServer()).get(`/api/flows/businesses/${bizId}/search`).query({ q });
  if (actor !== null) {
    req.set(HEADER, actor);
    req.set(ROLE_HEADER, role);
  }
  return req;
}

beforeAll(async () => {
  Logger.overrideLogger(false);

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { FlowController } = await import('../src/modules/flow/flow.controller');
  const { FlowService } = await import('../src/modules/flow/flow.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { CrossModuleAgentService } = await import('../src/modules/flow/cross-module-agent.service');
  const { FlowEngineService } = await import('../src/modules/flow/flow-engine.service');
  const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
  const { FlowTemplateService } = await import('../src/modules/flow/flow-template.service');

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  db = prismaService.client;
  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' },
      { id: ID.staffRevNone, email: `${P}staffRevNone@test.local`, role: 'USER' },
      { id: ID.staffRevRead, email: `${P}staffRevRead@test.local`, role: 'USER' },
      { id: ID.adminRevNone, email: `${P}adminRevNone@test.local`, role: 'USER' },
      { id: ID.adminEmptyArr, email: `${P}adminEmptyArr@test.local`, role: 'USER' },
      { id: ID.superAdmin, email: `${P}superAdmin@test.local`, role: 'SUPER_ADMIN' },
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
        id: `${P}m_staffRevNone`,
        userId: ID.staffRevNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { crm: 'read', revenue: 'none', projects: 'read', storefront: 'read' },
      },
      {
        id: `${P}m_staffRevRead`,
        userId: ID.staffRevRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { crm: 'read', revenue: 'read' },
      },
      {
        id: `${P}m_adminRevNone`,
        userId: ID.adminRevNone,
        businessId: ID.bizA,
        role: 'ADMIN',
        permissionScopes: { crm: 'admin', revenue: 'none', projects: 'admin', storefront: 'admin' },
      },
      {
        id: `${P}m_adminEmptyArr`,
        userId: ID.adminEmptyArr,
        businessId: ID.bizA,
        role: 'ADMIN',
        permissionScopes: [],
      },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.contact.create({
    data: {
      id: ID.contactA,
      businessId: ID.bizA,
      firstName: SEARCH_TOKEN,
      lastName: 'Client',
      email: `${P}client@test.local`,
      status: 'CLIENT',
    },
  });

  await db.invoice.create({
    data: {
      id: ID.invoiceA,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: INVOICE_NUM,
      status: 'PAID',
      subtotal: SECRET_TOTAL,
      total: SECRET_TOTAL,
      currency: 'TTD',
    },
  });

  await db.product.create({
    data: {
      id: ID.productA,
      businessId: ID.bizA,
      name: `${SEARCH_TOKEN} Widget`,
      price: 150,
      currency: 'TTD',
      category: 'PRODUCT',
    },
  });

  await db.project.create({
    data: {
      id: ID.projectA,
      businessId: ID.bizA,
      name: `${SEARCH_TOKEN} Project`,
      status: 'ACTIVE',
    },
  });

  const noop = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [FlowController],
    providers: [
      { provide: PrismaService, useValue: prismaService },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: FlowService, useValue: noop },
      { provide: ActivityService, useValue: noop },
      { provide: CrossModuleAgentService, useValue: noop },
      { provide: FlowEngineService, useValue: noop },
      { provide: FlowRunnerService, useValue: noop },
      { provide: FlowTemplateService, useValue: noop },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.length > 0) {
      const role = typeof req.headers[ROLE_HEADER] === 'string' ? req.headers[ROLE_HEADER] : 'USER';
      req.user = { id: uid, role, email: `${P}req_${uid}@test.local` };
    }
    next();
  });
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
});

describe('P91 — FU-SEARCH-MONEY-SCOPE (GET /api/flows/businesses/:businessId/search)', () => {
  it('[FSM-01] RED-BEFORE: STAFF with revenue:none receives invoices: [] and zero invoice totals while keeping non-invoice results and shape', async () => {
    for (const q of [SEARCH_TOKEN, INVOICE_NUM]) {
      const res = await search(ID.staffRevNone, q);
      expect(res.status, `q=${q} (${JSON.stringify(res.body)})`).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['bookings', 'contacts', 'invoices', 'products', 'projects']);
      expect(res.body.invoices).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(String(SECRET_TOTAL));
      expect(JSON.stringify(res.body)).not.toContain(INVOICE_NUM);
    }

    const byName = await search(ID.staffRevNone, SEARCH_TOKEN);
    expect(byName.body.contacts.some((c: any) => c.id === ID.contactA)).toBe(true);
    expect(byName.body.products.some((p: any) => p.id === ID.productA)).toBe(true);
    expect(byName.body.projects.some((p: any) => p.id === ID.projectA)).toBe(true);
  });

  it('[FSM-02] RED-BEFORE: ADMIN with explicit revenue:none (D-114) and ADMIN with array scopes (SV-4) receive invoices: []', async () => {
    for (const actor of [ID.adminRevNone, ID.adminEmptyArr]) {
      const res = await search(actor, SEARCH_TOKEN);
      expect(res.status, `${actor} (${JSON.stringify(res.body)})`).toBe(200);
      expect(res.body.invoices).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(String(SECRET_TOTAL));
      expect(JSON.stringify(res.body)).not.toContain(INVOICE_NUM);
    }
  });

  it('[FSM-03] Control: OWNER, STAFF with revenue:read, and SUPER_ADMIN receive matching invoices unchanged', async () => {
    for (const [actor, role] of [
      [ID.ownerA, 'USER'],
      [ID.staffRevRead, 'USER'],
      [ID.superAdmin, 'SUPER_ADMIN'],
    ] as const) {
      const res = await search(actor, SEARCH_TOKEN, ID.bizA, role);
      expect(res.status, `${actor} (${JSON.stringify(res.body)})`).toBe(200);
      expect(res.body.invoices).toHaveLength(1);
      expect(res.body.invoices[0]).toMatchObject({
        id: ID.invoiceA,
        invoiceNumber: INVOICE_NUM,
        total: SECRET_TOTAL,
        currency: 'TTD',
        status: 'PAID',
      });
    }
  });

  it('[FSM-04] Control: cross-tenant OWNER refused 403, unauthenticated refused 401, short query returns empty shape', async () => {
    const other = await search(ID.ownerB, SEARCH_TOKEN, ID.bizA);
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.body)).not.toContain(String(SECRET_TOTAL));

    const unauth = await search(null, SEARCH_TOKEN, ID.bizA);
    expect(unauth.status).toBe(401);

    const short = await search(ID.ownerA, 'a', ID.bizA);
    expect(short.status).toBe(200);
    expect(short.body).toEqual({ contacts: [], invoices: [], bookings: [], products: [], projects: [] });
  });
});

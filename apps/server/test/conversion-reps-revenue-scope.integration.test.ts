/**
 * P93 — FU-CONVERSION-REPS-REVENUE (server, P1 launch-track, S, D-100):
 *
 * Real Postgres + real NestJS HTTP app (`ConversionController`, `SalesTeamService`,
 * `AuthGuard`, `BusinessGuard`, `ModuleScopeGuard`, `GlobalHttpExceptionFilter`)
 * proving `GET /conversion/businesses/:businessId/sales-reps` withholds revenue
 * figures (`revenueAttributed`) and PAID-invoice counts (`dealsClosed`) when the
 * caller lacks `revenue:read`:
 *
 *   - [CRR-01] RED-BEFORE: STAFF with `revenue: 'none'` receives non-money rep
 *              fields (`id`, `name`, `commissionRate`) with `revenueAttributed: null`
 *              and `dealsClosed: null`, and zero paid-revenue amount in body.
 *   - [CRR-02] RED-BEFORE: ADMIN with explicit `{ revenue: 'none' }` (D-114) and
 *              ADMIN with array scopes `[]` (SV-4) receive `revenueAttributed: null`
 *              and `dealsClosed: null`.
 *   - [CRR-03] Control: OWNER, STAFF with `revenue: 'read'`, and SUPER_ADMIN
 *              receive exact `revenueAttributed` and `dealsClosed` unchanged.
 *   - [CRR-04] Control: cross-tenant OWNER refused 403; unauthenticated refused 401;
 *              tenant B reps & invoices never appear in tenant A's answer.
 *
 * Fixtures use prefix `v93c_` and are hard-deleted with `sqlLikePrefix(P)`.
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

const P = 'v93c_';
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
  repA: `${P}repA`,
  repB: `${P}repB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  invA1: `${P}invA1`,
  invA2: `${P}invA2`,
  invB1: `${P}invB1`,
};

const REV_A_1 = 42500;
const REV_A_2 = 17500;
const TOTAL_REV_A = REV_A_1 + REV_A_2;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
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

function getReps(actor: string | null, bizId = ID.bizA, role = 'USER') {
  const req = request(app.getHttpServer()).get(`/conversion/businesses/${bizId}/sales-reps`);
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
  const { ConversionController } = await import('../src/modules/conversion/conversion.controller');
  const { SalesTeamService } = await import('../src/modules/conversion/sales-team.service');
  const { UpsellService } = await import('../src/modules/conversion/upsell.service');
  const { ReferralRewardService } = await import('../src/modules/conversion/referral-reward.service');
  const { LeadMagnetService } = await import('../src/modules/conversion/lead-magnet.service');
  const { MerchantSubscriptionService } = await import('../src/modules/conversion/merchant-subscription.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');

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
      {
        id: ID.bizA,
        name: `${P}Biz A`,
        ownerId: ID.ownerA,
        currency: 'TTD',
        metaData: { salesConfig: { commissionRates: { [ID.repA]: 12.5 } } },
      },
      {
        id: ID.bizB,
        name: `${P}Biz B`,
        ownerId: ID.ownerB,
        currency: 'TTD',
        metaData: { salesConfig: { commissionRates: { [ID.repB]: 15 } } },
      },
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
        permissionScopes: { crm: 'read', revenue: 'none' },
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
        permissionScopes: { crm: 'admin', revenue: 'none' },
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

  await db.staffMember.createMany({
    data: [
      { id: ID.repA, businessId: ID.bizA, name: 'Maya Closer' },
      { id: ID.repB, businessId: ID.bizB, name: 'Tenant B Closer' },
    ],
  });

  await db.contact.createMany({
    data: [
      {
        id: ID.contactA,
        businessId: ID.bizA,
        firstName: 'Client',
        lastName: 'Alpha',
        email: `${P}alpha@test.local`,
        status: 'CLIENT',
        custom: { salesRepId: ID.repA },
      },
      {
        id: ID.contactB,
        businessId: ID.bizB,
        firstName: 'Client',
        lastName: 'Beta',
        email: `${P}beta@test.local`,
        status: 'CLIENT',
        custom: { salesRepId: ID.repB },
      },
    ],
  });

  await db.invoice.createMany({
    data: [
      {
        id: ID.invA1,
        businessId: ID.bizA,
        contactId: ID.contactA,
        invoiceNumber: `${P}INV-A1`,
        status: 'PAID',
        subtotal: REV_A_1,
        total: REV_A_1,
        currency: 'TTD',
      },
      {
        id: ID.invA2,
        businessId: ID.bizA,
        contactId: ID.contactA,
        invoiceNumber: `${P}INV-A2`,
        status: 'PAID',
        subtotal: REV_A_2,
        total: REV_A_2,
        currency: 'TTD',
      },
      {
        id: ID.invB1,
        businessId: ID.bizB,
        contactId: ID.contactB,
        invoiceNumber: `${P}INV-B1`,
        status: 'PAID',
        subtotal: 99999,
        total: 99999,
        currency: 'TTD',
      },
    ],
  });

  const noop = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [ConversionController],
    providers: [
      { provide: PrismaService, useValue: prismaService },
      SalesTeamService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: UpsellService, useValue: noop },
      { provide: ReferralRewardService, useValue: noop },
      { provide: LeadMagnetService, useValue: noop },
      { provide: MerchantSubscriptionService, useValue: noop },
      { provide: REDIS_CLIENT, useValue: null },
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

describe('P93 — FU-CONVERSION-REPS-REVENUE (GET /conversion/businesses/:businessId/sales-reps)', () => {
  it('[CRR-01] RED-BEFORE: STAFF with revenue:none receives non-money rep fields with revenueAttributed and dealsClosed withheld (null)', async () => {
    const res = await getReps(ID.staffRevNone);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual([
      {
        id: ID.repA,
        name: 'Maya Closer',
        commissionRate: 12.5,
        dealsClosed: null,
        revenueAttributed: null,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(String(TOTAL_REV_A));
  });

  it('[CRR-02] RED-BEFORE: ADMIN with explicit revenue:none (D-114) and ADMIN with array scopes (SV-4) receive null revenueAttributed and dealsClosed', async () => {
    for (const actor of [ID.adminRevNone, ID.adminEmptyArr]) {
      const res = await getReps(actor);
      expect(res.status, `${actor} (${JSON.stringify(res.body)})`).toBe(200);
      expect(res.body).toEqual([
        {
          id: ID.repA,
          name: 'Maya Closer',
          commissionRate: 12.5,
          dealsClosed: null,
          revenueAttributed: null,
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(String(TOTAL_REV_A));
    }
  });

  it('[CRR-03] Control: OWNER, STAFF with revenue:read, and SUPER_ADMIN receive full revenueAttributed and dealsClosed unchanged', async () => {
    for (const [actor, role] of [
      [ID.ownerA, 'USER'],
      [ID.staffRevRead, 'USER'],
      [ID.superAdmin, 'SUPER_ADMIN'],
    ] as const) {
      const res = await getReps(actor, ID.bizA, role);
      expect(res.status, `${actor} (${JSON.stringify(res.body)})`).toBe(200);
      expect(res.body).toEqual([
        {
          id: ID.repA,
          name: 'Maya Closer',
          commissionRate: 12.5,
          dealsClosed: 2,
          revenueAttributed: TOTAL_REV_A,
        },
      ]);
    }
  });

  it('[CRR-04] Control: cross-tenant OWNER refused 403, unauthenticated refused 401, tenant B data isolated', async () => {
    const other = await getReps(ID.ownerB, ID.bizA);
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.body)).not.toContain(String(TOTAL_REV_A));

    const unauth = await getReps(null, ID.bizA);
    expect(unauth.status).toBe(401);

    const ownA = await getReps(ID.ownerA, ID.bizA);
    expect(JSON.stringify(ownA.body)).not.toContain('Tenant B Closer');
    expect(JSON.stringify(ownA.body)).not.toContain('99999');
  });
});

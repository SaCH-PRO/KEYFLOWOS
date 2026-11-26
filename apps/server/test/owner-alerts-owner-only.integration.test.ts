/**
 * OWNER-ALERTS-WEB repair round 1, SEC-OAW-1 (orchestrator ruling: fail closed until the owner rules): the owner's
 * alerts (OwnerAlertsListener: a new booking, a payment, an "I've paid" claim, the owner's fraud check) are changed
 * only by an OWNER of the business, under the one owner rule (core/auth/business-owner.ts, owner rulings D-104, D-116,
 * D-125: an OWNER membership; a co-owner is an owner; SUPER_ADMIN keeps the bypass BusinessGuard grants).
 *
 * PATCH /notifications/businesses/:id/customer-preferences: a body carrying any owner_alert_bookings / _payments /
 * _claims key from a member who is not an owner is refused whole (403, code OWNER_ALERTS_OWNER_ONLY, nothing written,
 * the customer-email keys in the same body included); without those keys the route is as it was (settings write).
 * GET /notifications/businesses/:id/owner-alerts (settings read) answers the three values and whether the caller may
 * change them, so the web shows them read-only to everyone else.
 *
 * Real AuthGuard, BusinessGuard, ModuleScopeGuard, NotificationsController and TransactionalEmailService on Postgres.
 *
 *   OOO-01  control     the OWNER turns an owner alert off and on (200, stored)
 *   OOO-02  RED-BEFORE  an ADMIN (settings admin) is refused 403 OWNER_ALERTS_OWNER_ONLY for an owner alert key, with
 *                       nothing written, also when the body mixes in a customer-email key; the ADMIN still changes a
 *                       customer-email key alone (control)
 *   OOO-03  control     a co-owner (an OWNER membership, not Business.ownerId) changes them (200)
 *   OOO-04  RED-BEFORE  a STAFF member with settings write is refused for owner alert keys, allowed for customer keys
 *   OOO-05  RED-BEFORE  GET owner-alerts: the values (absent = on) and canChange true for owners and SUPER_ADMIN,
 *                       false for ADMIN; 403 for settings none and for another tenant's owner; 401 signed out
 *   OOO-06  control     a platform SUPER_ADMIN (BusinessGuard's bypass) changes them, as the owner rule's callers allow
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like';

const P = 'v65h_';
const HEADER = 'x-test-user-id';

const ID = {
  biz: `${P}biz`,
  bizB: `${P}bizB`,
  owner: `${P}owner`,
  coOwner: `${P}coOwner`,
  admin: `${P}admin`,
  staffWrite: `${P}staffWrite`,
  staffNone: `${P}staffNone`,
  ownerB: `${P}ownerB`,
  superAdmin: `${P}superAdmin`,
};

const BASE_PREFS = { invoice_sent: true, booking_confirmed: true };

let db: any;
let app: INestApplication;

async function cleanup() {
  for (const sql of [
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

const PREFS = `/notifications/businesses/${ID.biz}/customer-preferences`;
const ALERTS = `/notifications/businesses/${ID.biz}/owner-alerts`;

function asUser(userId?: string) {
  const srv = app.getHttpServer();
  const as = (r: request.Test) => (userId ? r.set(HEADER, userId) : r);
  return {
    get: (path: string) => as(request(srv).get(path)),
    patch: (path: string, body: Record<string, unknown>) => as(request(srv).patch(path)).send(body),
  };
}

async function stored(): Promise<Record<string, unknown>> {
  const row = await db.business.findUnique({ where: { id: ID.biz }, select: { notificationPreferences: true } });
  return (row?.notificationPreferences ?? {}) as Record<string, unknown>;
}

beforeAll(async () => {
  const { PrismaClient } = await import('@prisma/client');
  db = new PrismaClient();
  await cleanup();

  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { NotificationsController } = await import('../src/modules/notifications/notifications.controller');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');

  const mod = await Test.createTestingModule({
    controllers: [NotificationsController],
    providers: [
      { provide: PrismaService, useValue: { client: db } },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      NotificationsService,
      TransactionalEmailService,
      { provide: GmailService, useValue: { getGmailStatus: async () => ({ connected: false }) } },
    ],
  }).compile();

  app = mod.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  // Real guards run untouched; this middleware only attaches req.user as AuthMiddleware would.
  app.use(async (req: any, _res: any, next: any) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id: uid }, select: { id: true, email: true, role: true } });
      if (user) req.user = user;
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  for (const id of [ID.owner, ID.coOwner, ID.admin, ID.staffWrite, ID.staffNone, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.user.create({ data: { id: ID.superAdmin, email: `${P}superAdmin@test.local`, role: 'SUPER_ADMIN' } });

  await db.business.create({
    data: { id: ID.biz, name: 'V65H Biz', slug: `${P}biz`, ownerId: ID.owner, notificationPreferences: BASE_PREFS },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V65H Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB } });
  await db.membership.createMany({
    data: [
      { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
      { id: `${P}m_coOwner`, userId: ID.coOwner, businessId: ID.biz, role: 'OWNER' },
      { id: `${P}m_admin`, userId: ID.admin, businessId: ID.biz, role: 'ADMIN' },
      { id: `${P}m_staffWrite`, userId: ID.staffWrite, businessId: ID.biz, role: 'STAFF', permissionScopes: { settings: 'write' } },
      { id: `${P}m_staffNone`, userId: ID.staffNone, businessId: ID.biz, role: 'STAFF' },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });
}, 30_000);

beforeEach(async () => {
  await db.business.update({ where: { id: ID.biz }, data: { notificationPreferences: BASE_PREFS } });
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
}, 30_000);

function expectOwnerOnlyRefusal(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  const body = JSON.stringify(res.body);
  expect(body).toContain('OWNER_ALERTS_OWNER_ONLY');
  expect(body).toMatch(/only the business owner/i);
}

describe("SEC-OAW-1: only an owner changes the owner's alerts", () => {
  it('OOO-01 control: the OWNER turns an owner alert off and on', async () => {
    const off = await asUser(ID.owner).patch(PREFS, { owner_alert_claims: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.owner_alert_claims).toBe(false);
    expect((await stored()).owner_alert_claims).toBe(false);
    const on = await asUser(ID.owner).patch(PREFS, { owner_alert_claims: true });
    expect(on.status).toBe(200);
    expect((await stored()).owner_alert_claims).toBe(true);
  });

  it('OOO-02 RED-BEFORE: an ADMIN is refused for owner alert keys, with nothing written; customer keys alone still save', async () => {
    expectOwnerOnlyRefusal(await asUser(ID.admin).patch(PREFS, { owner_alert_claims: false }));
    expect(await stored()).toEqual(BASE_PREFS);

    // A mixed body is refused whole: the customer-email key in it is not written either.
    expectOwnerOnlyRefusal(await asUser(ID.admin).patch(PREFS, { owner_alert_payments: false, invoice_sent: false }));
    expect(await stored()).toEqual(BASE_PREFS);

    // A non-boolean value is refused too (the refusal is by key, before any sanitising).
    expectOwnerOnlyRefusal(await asUser(ID.admin).patch(PREFS, { owner_alert_bookings: 'off' }));

    const customer = await asUser(ID.admin).patch(PREFS, { invoice_sent: false });
    expect(customer.status, JSON.stringify(customer.body)).toBe(200);
    expect((await stored()).invoice_sent).toBe(false);
  });

  it('OOO-03 control: a co-owner (OWNER membership, not Business.ownerId) changes them', async () => {
    const res = await asUser(ID.coOwner).patch(PREFS, { owner_alert_bookings: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).owner_alert_bookings).toBe(false);
  });

  it('OOO-04 RED-BEFORE: STAFF with settings write is refused for owner alert keys, allowed for customer keys', async () => {
    expectOwnerOnlyRefusal(await asUser(ID.staffWrite).patch(PREFS, { owner_alert_bookings: false }));
    expect(await stored()).toEqual(BASE_PREFS);
    const res = await asUser(ID.staffWrite).patch(PREFS, { booking_confirmed: false });
    expect(res.status).toBe(200);
    expect((await stored()).booking_confirmed).toBe(false);
  });

  it('OOO-05 RED-BEFORE: GET owner-alerts answers the values and who may change them', async () => {
    await db.business.update({ where: { id: ID.biz }, data: { notificationPreferences: { ...BASE_PREFS, owner_alert_payments: false } } });
    const values = { bookings: true, payments: false, claims: true };
    for (const [who, canChange] of [[ID.owner, true], [ID.coOwner, true], [ID.superAdmin, true], [ID.admin, false], [ID.staffWrite, false]] as const) {
      const res = await asUser(who).get(ALERTS);
      expect(res.status, `${who}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body, who).toEqual({ ...values, canChange });
    }
    expect((await asUser(ID.staffNone).get(ALERTS)).status).toBe(403);
    expect((await asUser(ID.ownerB).get(ALERTS)).status).toBe(403);
    expect((await asUser().get(ALERTS)).status).toBe(401);
    // The read writes nothing.
    expect(await stored()).toEqual({ ...BASE_PREFS, owner_alert_payments: false });
  });

  it('OOO-06 control: a platform SUPER_ADMIN changes them (BusinessGuard bypass, kept by the owner rule)', async () => {
    const res = await asUser(ID.superAdmin).patch(PREFS, { owner_alert_payments: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).owner_alert_payments).toBe(false);
  });
});

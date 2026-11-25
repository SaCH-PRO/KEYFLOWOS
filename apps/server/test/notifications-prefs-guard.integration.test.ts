/**
 * FU-NOTIFICATIONS-PREFS-GUARD (P30, server, P1):
 * GET/PATCH /notifications/businesses/:businessId/customer-preferences and
 * GET /notifications/businesses/:businessId/customer-log live under Settings ->
 * Notifications and previously ran only AuthGuard + BusinessGuard with no
 * ModuleScopeGuard, so any STAFF member (settings: none) could read the
 * customer email log and disable business-wide customer email notifications.
 *
 * This integration suite mounts the real AuthGuard, BusinessGuard,
 * ModuleScopeGuard, NotificationsController, NotificationsService,
 * TransactionalEmailService, and GlobalHttpExceptionFilter against real
 * Postgres and proves:
 *   - NPG-01 RED: STAFF on role defaults (settings: none) gets 403 on all 3
 *     customer-email settings routes; zero DB writes, zero log disclosure.
 *   - NPG-02 RED: explicit scope maps bind ADMIN and STAFF alike (ADMIN with
 *     { settings: 'none' } or [] -> 403 on all 3; STAFF with { settings: 'read' }
 *     -> 200 on GETs, 403 on PATCH; STAFF with { settings: 'write' } -> 200 on
 *     all 3).
 *   - NPG-03 RED: PATCH customer-preferences ignores unknown/non-boolean keys
 *     (no mass-assignment into business.notificationPreferences) and GET
 *     customer-log clamps invalid/non-numeric/oversized limit without 500.
 *   - NPG-04 CONTROL: unauthenticated -> 401; another tenant's owner -> 403.
 *   - NPG-05 CONTROL: OWNER and ADMIN on role defaults (settings: admin) keep
 *     200 on all 3 routes.
 *   - NPG-06 CONTROL: member inbox routes (list, unread-count, :id/read,
 *     read-all) stay 200 for STAFF on role defaults (settings: none).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like';

const P = 'v90n_';
const HEADER = 'x-test-user-id';

const ID = {
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  ownerA: `${P}ownerA`,
  adminA: `${P}adminA`,
  adminNoneA: `${P}adminNoneA`,
  adminArrA: `${P}adminArrA`,
  staffDefaultA: `${P}staffDefaultA`,
  staffReadA: `${P}staffReadA`,
  staffWriteA: `${P}staffWriteA`,
  ownerB: `${P}ownerB`,
  notifA: `${P}notifA`,
  logA: `${P}logA`,
};

const CANARY_EMAIL = 'v90n-secret-customer@canary.local';
const CANARY_SUBJECT = 'V90N_CANARY_INVOICE_SUBJECT';

let db: any;
let app: INestApplication;

async function cleanup() {
  for (const sql of [
    `DELETE FROM customer_notification_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function asUser(userId?: string) {
  const srv = app.getHttpServer();
  return {
    get: (path: string) => (userId ? request(srv).get(path).set(HEADER, userId) : request(srv).get(path)),
    patch: (path: string, body?: Record<string, unknown>) => {
      const r = userId ? request(srv).patch(path).set(HEADER, userId) : request(srv).patch(path);
      return body !== undefined ? r.send(body) : r;
    },
  };
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
  // Real AuthGuard + BusinessGuard + ModuleScopeGuard run untouched; test middleware only attaches req.user.
  app.use(async (req: any, _res: any, next: any) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.startsWith(P)) {
      const user = await db.user.findUnique({
        where: { id: uid },
        select: { id: true, email: true, role: true },
      });
      if (user) req.user = user;
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  for (const [id, email] of [
    [ID.ownerA, `${P}ownerA@test.local`],
    [ID.adminA, `${P}adminA@test.local`],
    [ID.adminNoneA, `${P}adminNoneA@test.local`],
    [ID.adminArrA, `${P}adminArrA@test.local`],
    [ID.staffDefaultA, `${P}staffDefaultA@test.local`],
    [ID.staffReadA, `${P}staffReadA@test.local`],
    [ID.staffWriteA, `${P}staffWriteA@test.local`],
    [ID.ownerB, `${P}ownerB@test.local`],
  ]) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }

  await db.business.create({
    data: {
      id: ID.bizA,
      name: 'V90N Biz A',
      slug: `${P}biz-a`,
      ownerId: ID.ownerA,
      notificationPreferences: { invoice_sent: true, booking_confirmed: true },
    },
  });
  await db.business.create({
    data: {
      id: ID.bizB,
      name: 'V90N Biz B',
      slug: `${P}biz-b`,
      ownerId: ID.ownerB,
    },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}m_adminA`, userId: ID.adminA, businessId: ID.bizA, role: 'ADMIN' },
      { id: `${P}m_adminNoneA`, userId: ID.adminNoneA, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { settings: 'none' } },
      { id: `${P}m_adminArrA`, userId: ID.adminArrA, businessId: ID.bizA, role: 'ADMIN', permissionScopes: [] },
      { id: `${P}m_staffDefA`, userId: ID.staffDefaultA, businessId: ID.bizA, role: 'STAFF' },
      { id: `${P}m_staffReadA`, userId: ID.staffReadA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'read' } },
      { id: `${P}m_staffWriteA`, userId: ID.staffWriteA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'write' } },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.notification.create({
    data: {
      id: ID.notifA,
      businessId: ID.bizA,
      type: 'booking.created',
      title: 'New booking',
      body: 'A booking was scheduled.',
      read: false,
    },
  });

  await db.customerNotificationLog.create({
    data: {
      id: ID.logA,
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: CANARY_EMAIL,
      recipientName: 'Canary Customer',
      subject: CANARY_SUBJECT,
      status: 'SENT',
    },
  });
}, 30_000);

beforeEach(async () => {
  await db.business.update({
    where: { id: ID.bizA },
    data: { notificationPreferences: { invoice_sent: true, booking_confirmed: true } },
  });
  await db.notification.update({
    where: { id: ID.notifA },
    data: { read: false },
  });
});

afterAll(async () => {
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
}, 30_000);

describe('FU-NOTIFICATIONS-PREFS-GUARD (P30): settings module scope enforcement on customer-preferences and customer-log', () => {
  const PREFS_URL = `/notifications/businesses/${ID.bizA}/customer-preferences`;
  const LOG_URL = `/notifications/businesses/${ID.bizA}/customer-log`;

  it('NPG-01 RED-BEFORE: STAFF on role defaults (settings: none) is refused 403 on GET/PATCH customer-preferences and GET customer-log; zero writes, zero disclosure', async () => {
    const before = await db.business.findUnique({ where: { id: ID.bizA }, select: { notificationPreferences: true } });

    const getPrefs = await asUser(ID.staffDefaultA).get(PREFS_URL);
    expect(getPrefs.status).toBe(403);

    const patchPrefs = await asUser(ID.staffDefaultA).patch(PREFS_URL, { invoice_sent: false });
    expect(patchPrefs.status).toBe(403);

    const getLog = await asUser(ID.staffDefaultA).get(LOG_URL);
    expect(getLog.status).toBe(403);
    expect(JSON.stringify(getLog.body)).not.toContain(CANARY_EMAIL);
    expect(JSON.stringify(getLog.body)).not.toContain(CANARY_SUBJECT);

    const after = await db.business.findUnique({ where: { id: ID.bizA }, select: { notificationPreferences: true } });
    expect(after.notificationPreferences).toEqual(before.notificationPreferences);
  });

  it('NPG-02 RED-BEFORE: explicit scope maps bind ADMIN and STAFF alike (none/[] -> 403; settings:read -> GET 200 / PATCH 403; settings:write -> all 200)', async () => {
    for (const deniedAdmin of [ID.adminNoneA, ID.adminArrA]) {
      expect((await asUser(deniedAdmin).get(PREFS_URL)).status).toBe(403);
      expect((await asUser(deniedAdmin).patch(PREFS_URL, { invoice_sent: false })).status).toBe(403);
      expect((await asUser(deniedAdmin).get(LOG_URL)).status).toBe(403);
    }

    const readGetPrefs = await asUser(ID.staffReadA).get(PREFS_URL);
    expect(readGetPrefs.status).toBe(200);
    expect(readGetPrefs.body.invoice_sent).toBe(true);

    const readGetLog = await asUser(ID.staffReadA).get(LOG_URL);
    expect(readGetLog.status).toBe(200);
    expect(Array.isArray(readGetLog.body)).toBe(true);
    expect(readGetLog.body.some((e: any) => e.id === ID.logA)).toBe(true);

    const readPatch = await asUser(ID.staffReadA).patch(PREFS_URL, { invoice_sent: false });
    expect(readPatch.status).toBe(403);
    const afterReadPatch = await db.business.findUnique({ where: { id: ID.bizA }, select: { notificationPreferences: true } });
    expect((afterReadPatch.notificationPreferences as any).invoice_sent).toBe(true);

    const writePatch = await asUser(ID.staffWriteA).patch(PREFS_URL, { invoice_sent: false });
    expect(writePatch.status).toBe(200);
    expect(writePatch.body.invoice_sent).toBe(false);
    const afterWritePatch = await db.business.findUnique({ where: { id: ID.bizA }, select: { notificationPreferences: true } });
    expect((afterWritePatch.notificationPreferences as any).invoice_sent).toBe(false);
  });

  it('NPG-03 RED-BEFORE: PATCH customer-preferences persists only whitelisted boolean keys and GET customer-log clamps invalid/oversized limit without 500', async () => {
    const patchRes = await asUser(ID.ownerA).patch(PREFS_URL, {
      invoice_sent: false,
      booking_confirmed: 'not-a-boolean' as unknown as boolean,
      injectedKey: true,
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.invoice_sent).toBe(false);
    expect(patchRes.body.booking_confirmed).toBe(true);
    expect(patchRes.body).not.toHaveProperty('injectedKey');

    const stored = (await db.business.findUnique({ where: { id: ID.bizA }, select: { notificationPreferences: true } }))
      .notificationPreferences as Record<string, unknown>;
    expect(stored.invoice_sent).toBe(false);
    expect(stored.booking_confirmed).toBe(true);
    expect(stored).not.toHaveProperty('injectedKey');

    for (const badLimit of ['abc', '-5', '0', '999999']) {
      const logRes = await asUser(ID.ownerA).get(`${LOG_URL}?limit=${badLimit}`);
      expect(logRes.status).toBe(200);
      expect(Array.isArray(logRes.body)).toBe(true);
    }
  });

  it('NPG-04 CONTROL: unauthenticated gets 401 and another tenant owner gets 403 on all 3 routes with zero writes', async () => {
    expect((await asUser().get(PREFS_URL)).status).toBe(401);
    expect((await asUser().patch(PREFS_URL, { invoice_sent: false })).status).toBe(401);
    expect((await asUser().get(LOG_URL)).status).toBe(401);

    expect((await asUser(ID.ownerB).get(PREFS_URL)).status).toBe(403);
    expect((await asUser(ID.ownerB).patch(PREFS_URL, { invoice_sent: false })).status).toBe(403);
    expect((await asUser(ID.ownerB).get(LOG_URL)).status).toBe(403);

    const stored = (await db.business.findUnique({ where: { id: ID.bizA }, select: { notificationPreferences: true } }))
      .notificationPreferences as Record<string, unknown>;
    expect(stored.invoice_sent).toBe(true);
  });

  it('NPG-05 CONTROL: OWNER and ADMIN on role defaults keep 200 on all 3 customer-email settings routes', async () => {
    for (const allowed of [ID.ownerA, ID.adminA]) {
      expect((await asUser(allowed).get(PREFS_URL)).status).toBe(200);
      expect((await asUser(allowed).patch(PREFS_URL, { booking_reminder: false })).status).toBe(200);
      expect((await asUser(allowed).get(LOG_URL)).status).toBe(200);
    }
  });

  it('NPG-06 CONTROL: member inbox routes stay 200 for STAFF on role defaults (settings: none)', async () => {
    expect((await asUser(ID.staffDefaultA).get(`/notifications/businesses/${ID.bizA}`)).status).toBe(200);
    expect((await asUser(ID.staffDefaultA).get(`/notifications/businesses/${ID.bizA}/unread-count`)).status).toBe(200);
    expect((await asUser(ID.staffDefaultA).patch(`/notifications/businesses/${ID.bizA}/${ID.notifA}/read`)).status).toBe(200);
    expect((await asUser(ID.staffDefaultA).patch(`/notifications/businesses/${ID.bizA}/read-all`)).status).toBe(200);
  });
});

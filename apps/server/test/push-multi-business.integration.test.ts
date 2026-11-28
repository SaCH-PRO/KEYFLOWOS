/**
 * P242 FU-PUSH-MULTI-BUSINESS (D-319 / Q45):
 * Real-Postgres + real-Redis + real-HTTP integration proof verifying that one
 * device endpoint receives owner push notifications for EVERY business the
 * member subscribes on (not only the last business subscribed), while
 * preserving cross-member non-takeover and tenant isolation:
 *
 *   PMB-01: Subscribing the same browser endpoint on bizA and then bizB keeps
 *           BOTH subscriptions; sendToBusinessUsers and POST /push/test deliver
 *           to the device for both bizA and bizB (and 0 for unsubscribed bizC).
 *   PMB-02: Re-subscribing the same device on bizB with rotated keys (p256dh,
 *           auth) refreshes keys across all of that member's business rows for
 *           that endpoint without overwriting or dropping bizA.
 *   PMB-03: sendToUser deduplicates by endpoint (delivers once, not once per
 *           business) and prunes all businesses' rows on 410/404 expiry.
 *   PMB-04: Cross-member takeover guard holds across businesses: another member
 *           (even OWNER of bizOther) gets 403 when attempting to subscribe
 *           owner's endpoint in bizA or bizOther, and unsubscribe by another
 *           member removes 0 of owner's rows.
 *   PMB-05: Owner's POST /push/unsubscribe removes all of owner's rows for that
 *           endpoint across both bizA and bizB while leaving other devices intact.
 *
 * Fixture prefix: `v92q_` (registered in `fixture-prefixes.json`, cleaned up
 * with `sqlLikePrefix(P)`).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as webpush from 'web-push';
import IORedis from 'ioredis';
import { db } from '@keyflow/db';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { RateLimitGuard } from '../src/core/guards/rate-limit.guard';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { configureNestApp } from '../src/app-bootstrap';
import { PushNotificationController } from '../src/modules/push-notifications/push-notification.controller';
import { PushNotificationService } from '../src/modules/push-notifications/push-notification.service';
import { sqlLikePrefix } from './helpers/sql-like.js';

const P = 'v92q_';
const HEADER = 'x-v92q-user';

const ID = {
  owner: `${P}owner`,
  other: `${P}other`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  bizC: `${P}biz_c`,
  bizOther: `${P}biz_other`,
};

async function cleanup(redis?: IORedis | null) {
  await db.$executeRawUnsafe(
    `DELETE FROM push_subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
  );
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
  if (redis) {
    const keys = await redis.keys(`rate_limit:*:${P}*`).catch(() => []);
    if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
  }
}

describe('P242 FU-PUSH-MULTI-BUSINESS (D-319 / Q45)', () => {
  let app: INestApplication;
  let pushService: PushNotificationService;
  let redis: IORedis;
  let prevVapidPub: string | undefined;
  let prevVapidPriv: string | undefined;
  let prevVapidSub: string | undefined;

  beforeAll(async () => {
    prevVapidPub = process.env.VAPID_PUBLIC_KEY;
    prevVapidPriv = process.env.VAPID_PRIVATE_KEY;
    prevVapidSub = process.env.VAPID_SUBJECT;
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:security@keyflowos.com';

    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    await cleanup(redis);

    await db.user.createMany({
      data: [
        { id: ID.owner, email: `${P}owner@test.local`, name: 'v92q Owner', role: 'USER' },
        { id: ID.other, email: `${P}other@test.local`, name: 'v92q Other', role: 'USER' },
      ],
    });
    await db.business.createMany({
      data: [
        { id: ID.bizA, name: 'v92q Biz A', slug: `${P}biza`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizB, name: 'v92q Biz B', slug: `${P}bizb`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizC, name: 'v92q Biz C', slug: `${P}bizc`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizOther, name: 'v92q Biz Other', slug: `${P}bizother`, ownerId: ID.other, currency: 'TTD' },
      ],
    });
    await db.membership.createMany({
      data: [
        { id: `${P}m_owner_a`, businessId: ID.bizA, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_owner_b`, businessId: ID.bizB, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_owner_c`, businessId: ID.bizC, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_other_a`, businessId: ID.bizA, userId: ID.other, role: 'STAFF' },
        { id: `${P}m_other_own`, businessId: ID.bizOther, userId: ID.other, role: 'OWNER' },
      ],
    });

    const prismaStub = { client: db } as unknown as PrismaService;
    const ref = await Test.createTestingModule({
      controllers: [PushNotificationController],
      providers: [
        { provide: PrismaService, useValue: prismaStub },
        { provide: REDIS_CLIENT, useValue: redis },
        BusinessGuard,
        RateLimitGuard,
        PushNotificationService,
      ],
    }).compile();

    pushService = ref.get(PushNotificationService);
    app = ref.createNestApplication();
    app.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const found = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (found) req.user = { id: found.id, email: found.email, role: found.role };
      }
      next();
    });
    configureNestApp(app);
    await app.init();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
    await cleanup(redis);
    if (redis) await redis.quit().catch(() => undefined);
    if (prevVapidPub === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = prevVapidPub;
    if (prevVapidPriv === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = prevVapidPriv;
    if (prevVapidSub === undefined) delete process.env.VAPID_SUBJECT;
    else process.env.VAPID_SUBJECT = prevVapidSub;
  });

  const subscribe = (
    bizId: string,
    userId: string,
    endpoint: string,
    keys = { p256dh: `${P}p256dh_v1`, auth: `${P}auth_v1` },
  ) =>
    request(app.getHttpServer())
      .post(`/api/businesses/${bizId}/push/subscribe`)
      .set(HEADER, userId)
      .send({ subscription: { endpoint, keys } });

  const unsubscribe = (bizId: string, userId: string, endpoint: string) =>
    request(app.getHttpServer())
      .post(`/api/businesses/${bizId}/push/unsubscribe`)
      .set(HEADER, userId)
      .send({ endpoint });

  it('[PMB-01] RED-BEFORE: subscribing one device across bizA and bizB retains both rows and delivers owner push for both businesses (not only the last)', async () => {
    await db.pushSubscription.deleteMany({ where: { userId: ID.owner } });
    const device = `https://fcm.googleapis.com/fcm/send/${P}shared_owner_device`;

    const resA = await subscribe(ID.bizA, ID.owner, device);
    expect(resA.status, JSON.stringify(resA.body)).toBe(201);

    const resB = await subscribe(ID.bizB, ID.owner, device);
    expect(resB.status, JSON.stringify(resB.body)).toBe(201);

    const rows = await db.pushSubscription.findMany({
      where: { userId: ID.owner, endpoint: device },
      select: { businessId: true, userId: true, endpoint: true },
      orderBy: { businessId: 'asc' },
    });
    expect(rows.map((r) => r.businessId)).toEqual([ID.bizA, ID.bizB]);

    const deliveries: Array<{ endpoint: string; title: string }> = [];
    const sendSpy = vi.spyOn(pushService as any, 'sendPushNotification').mockImplementation(
      async (sub: any, payload: string) => {
        deliveries.push({ endpoint: sub.endpoint, title: JSON.parse(payload).title });
        return { statusCode: 201, headers: {}, body: '' } as any;
      },
    );

    try {
      const bizARes = await pushService.sendToBusinessUsers(ID.bizA, [ID.owner], {
        title: 'Biz A Sale',
        body: 'Paid in Biz A',
      });
      const bizBRes = await pushService.sendToBusinessUsers(ID.bizB, [ID.owner], {
        title: 'Biz B Booking',
        body: 'Booked in Biz B',
      });
      const bizCRes = await pushService.sendToBusinessUsers(ID.bizC, [ID.owner], {
        title: 'Biz C Unsubscribed',
        body: 'Should not deliver',
      });

      expect(bizARes).toEqual({ attempted: 1, sent: 1, failed: 0 });
      expect(bizBRes).toEqual({ attempted: 1, sent: 1, failed: 0 });
      expect(bizCRes).toEqual({ attempted: 0, sent: 0, failed: 0 });
      expect(deliveries).toEqual([
        { endpoint: device, title: 'Biz A Sale' },
        { endpoint: device, title: 'Biz B Booking' },
      ]);

      // HTTP /push/test works for both subscribed businesses and sends 0 for bizC.
      const testA = await request(app.getHttpServer())
        .post(`/api/businesses/${ID.bizA}/push/test`)
        .set(HEADER, ID.owner)
        .send({ title: 'Ping A' });
      const testB = await request(app.getHttpServer())
        .post(`/api/businesses/${ID.bizB}/push/test`)
        .set(HEADER, ID.owner)
        .send({ title: 'Ping B' });
      const testC = await request(app.getHttpServer())
        .post(`/api/businesses/${ID.bizC}/push/test`)
        .set(HEADER, ID.owner)
        .send({ title: 'Ping C' });

      expect(testA.status).toBe(201);
      expect(testA.body.sent).toBe(1);
      expect(testB.status).toBe(201);
      expect(testB.body.sent).toBe(1);
      expect(testC.status).toBe(201);
      expect(testC.body.sent).toBe(0);
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('[PMB-02] RED-BEFORE: re-subscribing the same device on bizB with rotated keys refreshes keys across all of that member\'s rows for the endpoint', async () => {
    await db.pushSubscription.deleteMany({ where: { userId: ID.owner } });
    const device = `https://updates.push.services.mozilla.com/wpush/v2/${P}rotated_device`;

    expect((await subscribe(ID.bizA, ID.owner, device, { p256dh: `${P}k1`, auth: `${P}a1` })).status).toBe(201);
    expect((await subscribe(ID.bizB, ID.owner, device, { p256dh: `${P}k2`, auth: `${P}a2` })).status).toBe(201);

    const rows = await db.pushSubscription.findMany({
      where: { userId: ID.owner, endpoint: device },
      select: { businessId: true, p256dh: true, auth: true },
      orderBy: { businessId: 'asc' },
    });
    expect(rows).toEqual([
      { businessId: ID.bizA, p256dh: `${P}k2`, auth: `${P}a2` },
      { businessId: ID.bizB, p256dh: `${P}k2`, auth: `${P}a2` },
    ]);
  });

  it('[PMB-03] RED-BEFORE: sendToUser deduplicates by endpoint (delivers once, not once per business) and prunes all rows on 410 expiry', async () => {
    await db.pushSubscription.deleteMany({ where: { userId: ID.owner } });
    const device = `https://web.push.apple.com/${P}dedup_device`;

    expect((await subscribe(ID.bizA, ID.owner, device)).status).toBe(201);
    expect((await subscribe(ID.bizB, ID.owner, device)).status).toBe(201);

    const sentEndpoints: string[] = [];
    const sendSpy = vi.spyOn(pushService as any, 'sendPushNotification').mockImplementation(async (sub: any) => {
      sentEndpoints.push(sub.endpoint);
      return { statusCode: 201, headers: {}, body: '' } as any;
    });

    try {
      const res = await pushService.sendToUser(ID.owner, { title: 'Account Alert', body: 'Once only' });
      expect(res).toEqual({ sent: 1, failed: 0 });
      expect(sentEndpoints).toEqual([device]);
    } finally {
      sendSpy.mockRestore();
    }

    // 410 Gone prunes both business rows for this user+endpoint.
    const goneSpy = vi.spyOn(pushService as any, 'sendPushNotification').mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );
    try {
      const res = await pushService.sendToUser(ID.owner, { title: 'Expired', body: 'Prune' });
      expect(res).toEqual({ sent: 0, failed: 1 });
      const remaining = await db.pushSubscription.count({ where: { userId: ID.owner, endpoint: device } });
      expect(remaining).toBe(0);
    } finally {
      goneSpy.mockRestore();
    }
  });

  it('[PMB-04] cross-member takeover guard holds across businesses (403 on subscribe, no-op on unsubscribe)', async () => {
    await db.pushSubscription.deleteMany({ where: { userId: { in: [ID.owner, ID.other] } } });
    const ownerDevice = `https://fcm.googleapis.com/fcm/send/${P}owner_protected_device`;

    expect((await subscribe(ID.bizA, ID.owner, ownerDevice)).status).toBe(201);
    expect((await subscribe(ID.bizB, ID.owner, ownerDevice)).status).toBe(201);

    // Same business takeover attempt -> 403
    const sameBizTakeover = await subscribe(ID.bizA, ID.other, ownerDevice);
    expect(sameBizTakeover.status, JSON.stringify(sameBizTakeover.body)).toBe(403);

    // Different business takeover attempt (other is OWNER of bizOther) -> 403
    const crossBizTakeover = await subscribe(ID.bizOther, ID.other, ownerDevice);
    expect(crossBizTakeover.status, JSON.stringify(crossBizTakeover.body)).toBe(403);

    // Unsubscribe by another member removes 0 rows
    const crossDrop = await unsubscribe(ID.bizOther, ID.other, ownerDevice);
    expect([200, 201]).toContain(crossDrop.status);
    expect(crossDrop.body?.count).toBe(0);

    const rows = await db.pushSubscription.findMany({
      where: { endpoint: ownerDevice },
      select: { userId: true, businessId: true },
      orderBy: { businessId: 'asc' },
    });
    expect(rows).toEqual([
      { userId: ID.owner, businessId: ID.bizA },
      { userId: ID.owner, businessId: ID.bizB },
    ]);
  });

  it('[PMB-05] owner unsubscribe removes all of owner\'s business rows for the device while leaving other devices intact', async () => {
    await db.pushSubscription.deleteMany({ where: { userId: { in: [ID.owner, ID.other] } } });
    const ownerDevice = `https://fcm.googleapis.com/fcm/send/${P}owner_optout_device`;
    const otherDevice = `https://fcm.googleapis.com/fcm/send/${P}other_separate_device`;

    expect((await subscribe(ID.bizA, ID.owner, ownerDevice)).status).toBe(201);
    expect((await subscribe(ID.bizB, ID.owner, ownerDevice)).status).toBe(201);
    expect((await subscribe(ID.bizOther, ID.other, otherDevice)).status).toBe(201);

    const drop = await unsubscribe(ID.bizA, ID.owner, ownerDevice);
    expect([200, 201]).toContain(drop.status);
    expect(drop.body?.count).toBe(2);

    expect(await db.pushSubscription.count({ where: { endpoint: ownerDevice } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { endpoint: otherDevice, userId: ID.other } })).toBe(1);
  });
});

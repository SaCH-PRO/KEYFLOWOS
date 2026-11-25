/**
 * V1-95 (FU-PUSH-ENDPOINT-ALLOWLIST, P71 / Claude P62 security review MIN-4):
 * Real-Postgres + real-Redis + real-HTTP integration proof closing blind SSRF
 * via PushSubscription.endpoint and unbounded POST /push/test bursts:
 *
 *   PEA-01: POST /api/businesses/:b/push/subscribe rejects non-HTTPS, IP
 *           literals, cloud-metadata/internal hosts, userinfo, non-443 ports,
 *           suffix/prefix lookalikes, trailing-dot hosts, control chars, and
 *           empty-path endpoints with 400 and persists zero rows.
 *   PEA-02: POST /api/businesses/:b/push/subscribe accepts HTTPS default-port
 *           endpoints on supported Web Push services (FCM, Mozilla autopush,
 *           Apple web push, Windows WNS, legacy Android GCM).
 *   PEA-03: Defense-in-depth on outbound send: a pre-existing DB row with a
 *           disallowed endpoint is refused before webpush.sendNotification is
 *           ever invoked across sendToBusinessUsers, sendToUser, and
 *           sendToBusiness, while valid allowlisted endpoints still dispatch.
 *   PEA-04: POST /api/businesses/:b/push/test dispatches only the caller's
 *           subscriptions in `:businessId` (never another business) and is
 *           rate-limited via RateLimitGuard (429 past threshold).
 *
 * Fixture prefix: `v95f_` (registered in `fixture-prefixes.json`, cleaned up
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

const P = 'v95f_';
const HEADER = 'x-v95f-user';

const ID = {
  owner: `${P}owner`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
};

async function cleanup(redis?: IORedis | null) {
  await db.$executeRawUnsafe(`DELETE FROM push_subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
  if (redis) {
    const keys = await redis.keys(`rate_limit:*:${P}*`).catch(() => []);
    if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
  }
}

describe('V1-95 (FU-PUSH-ENDPOINT-ALLOWLIST, P71 / MIN-4)', () => {
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

    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
    await cleanup(redis);

    await db.user.create({
      data: { id: ID.owner, email: `${P}owner@test.local`, name: 'v95f Owner', role: 'USER' },
    });
    await db.business.createMany({
      data: [
        { id: ID.bizA, name: 'v95f Biz A', slug: `${P}biza`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizB, name: 'v95f Biz B', slug: `${P}bizb`, ownerId: ID.owner, currency: 'TTD' },
      ],
    });
    await db.membership.createMany({
      data: [
        { id: `${P}m_a`, businessId: ID.bizA, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_b`, businessId: ID.bizB, userId: ID.owner, role: 'OWNER' },
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

  const subscribe = (endpoint: string, biz = ID.bizA) =>
    request(app.getHttpServer())
      .post(`/api/businesses/${biz}/push/subscribe`)
      .set(HEADER, ID.owner)
      .send({
        subscription: {
          endpoint,
          keys: { p256dh: `${P}p256dh`, auth: `${P}auth` },
        },
      });

  it('[PEA-01] RED-BEFORE: rejects non-HTTPS, IP/internal/IMDS hosts, userinfo, non-443 ports, lookalikes, trailing dot, control chars, and bare paths with 400 and persists nothing', async () => {
    const blocked: Array<[string, string]> = [
      ['http scheme', `http://fcm.googleapis.com/fcm/send/${P}http`],
      ['loopback IPv4', `https://127.0.0.1/${P}loopback`],
      ['cloud IMDS', `https://169.254.169.254/latest/meta-data/${P}imds`],
      ['loopback IPv6', `https://[::1]/${P}ipv6`],
      ['public IP literal', `https://203.0.113.50/push/${P}ip`],
      ['arbitrary internal host', `https://internal-redis.local/${P}internal`],
      ['suffix spoof', `https://fcm.googleapis.com.evil.com/fcm/send/${P}suffix`],
      ['prefix spoof', `https://evil-fcm.googleapis.com/fcm/send/${P}prefix`],
      ['unallowed googleapis subdomain', `https://storage.googleapis.com/${P}bucket`],
      ['userinfo credentials', `https://user:pass@fcm.googleapis.com/fcm/send/${P}auth`],
      ['non-default port', `https://fcm.googleapis.com:8443/fcm/send/${P}port`],
      ['empty root path', 'https://fcm.googleapis.com/'],
      ['trailing dot host', `https://fcm.googleapis.com./fcm/send/${P}dot`],
      ['control char', `https://fcm.googleapis.com/fcm/send/${P}crlf\r\n`],
      ['bare windows apex', `https://notify.windows.com/${P}bare_wns`],
      ['bare apple apex', `https://push.apple.com/${P}bare_apple`],
      ['bare mozilla apex', `https://push.services.mozilla.com/${P}bare_moz`],
      ['not a url', 'not-even-a-url'],
      // R1 security review (d2ecf7e9): WHATWG URL vs web-push legacy url.parse() differentials
      ['single-slash authority', `https:/fcm.googleapis.com/fcm/send/${P}single_slash`],
      ['no-slash authority', `https:fcm.googleapis.com/fcm/send/${P}no_slash`],
      ['triple-slash authority', `https:///fcm.googleapis.com/fcm/send/${P}triple_slash`],
      ['backslash authority', `https://\\fcm.googleapis.com/fcm/send/${P}backslash`],
      ['empty userinfo', `https://@fcm.googleapis.com/fcm/send/${P}empty_userinfo`],
      ['colon userinfo', `https://:@fcm.googleapis.com/fcm/send/${P}colon_userinfo`],
      ['leading-zero 443 port', `https://fcm.googleapis.com:0443/fcm/send/${P}zero_port`],
      ['subdomain of fcm', `https://evil.fcm.googleapis.com/fcm/send/${P}sub_fcm`],
    ];

    for (const [label, endpoint] of blocked) {
      const res = await subscribe(endpoint);
      expect(res.status, `${label} (${endpoint}) must be rejected with 400, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(400);
    }

    const persisted = await db.pushSubscription.count({ where: { businessId: ID.bizA } });
    expect(persisted).toBe(0);
  });

  it('[PEA-02] accepts HTTPS default-port endpoints on supported browser push services', async () => {
    await db.pushSubscription.deleteMany({ where: { businessId: ID.bizA } });
    const allowed = [
      `https://fcm.googleapis.com/fcm/send/${P}chrome`,
      `https://updates.push.services.mozilla.com/wpush/v2/${P}firefox`,
      `https://web.push.apple.com/${P}safari`,
      `https://wns2-bl2p.notify.windows.com/w/?token=${P}edge`,
      `https://android.googleapis.com/gcm/send/${P}android`,
    ];

    for (const endpoint of allowed) {
      const res = await subscribe(endpoint);
      expect(res.status, `${endpoint} should be accepted (201), got ${res.status}: ${JSON.stringify(res.body)}`).toBe(201);
    }

    const persisted = await db.pushSubscription.count({ where: { businessId: ID.bizA } });
    expect(persisted).toBe(allowed.length);
  });

  it('[PEA-03] RED-BEFORE: defense-in-depth blocks pre-existing disallowed DB endpoints before sendPushNotification is called', async () => {
    await db.pushSubscription.deleteMany({ where: { businessId: ID.bizA } });

    const poisonedEndpoint = `https://169.254.169.254/latest/meta-data/${P}poisoned`;
    const validEndpoint = `https://fcm.googleapis.com/fcm/send/${P}valid_send`;
    await db.pushSubscription.createMany({
      data: [
        { endpoint: poisonedEndpoint, p256dh: `${P}p1`, auth: `${P}a1`, userId: ID.owner, businessId: ID.bizA },
        { endpoint: validEndpoint, p256dh: `${P}p2`, auth: `${P}a2`, userId: ID.owner, businessId: ID.bizA },
      ],
    });

    const sentEndpoints: string[] = [];
    const sendSpy = vi.spyOn(pushService as any, 'sendPushNotification').mockImplementation(async (sub: any) => {
      sentEndpoints.push(sub.endpoint);
      return { statusCode: 201, headers: {}, body: '' } as any;
    });

    try {
      const resBizUsers = await pushService.sendToBusinessUsers(ID.bizA, [ID.owner], { title: 'T', body: 'B' });
      expect(resBizUsers).toEqual({ attempted: 2, sent: 1, failed: 1 });

      const resUser = await pushService.sendToUser(ID.owner, { title: 'T', body: 'B' });
      expect(resUser).toEqual({ sent: 1, failed: 1 });

      const resBiz = await pushService.sendToBusiness(ID.bizA, { title: 'T', body: 'B' });
      expect(resBiz).toEqual({ sent: 1, failed: 1 });

      expect(sentEndpoints).toEqual([validEndpoint, validEndpoint, validEndpoint]);
      expect(sentEndpoints.some((e) => e.includes('169.254.169.254'))).toBe(false);
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('[PEA-04] RED-BEFORE: POST /api/businesses/:b/push/test only delivers to subscriptions in :businessId and enforces RateLimitGuard (429)', async () => {
    await db.pushSubscription.deleteMany({ where: { userId: ID.owner } });
    const endpointA = `https://fcm.googleapis.com/fcm/send/${P}test_biz_a`;
    const endpointB = `https://fcm.googleapis.com/fcm/send/${P}test_biz_b`;
    await db.pushSubscription.createMany({
      data: [
        { endpoint: endpointA, p256dh: `${P}pa`, auth: `${P}aa`, userId: ID.owner, businessId: ID.bizA },
        { endpoint: endpointB, p256dh: `${P}pb`, auth: `${P}ab`, userId: ID.owner, businessId: ID.bizB },
      ],
    });

    const delivered: string[] = [];
    const sendSpy = vi.spyOn(pushService as any, 'sendPushNotification').mockImplementation(async (sub: any) => {
      delivered.push(sub.endpoint);
      return { statusCode: 201, headers: {}, body: '' } as any;
    });

    try {
      const first = await request(app.getHttpServer())
        .post(`/api/businesses/${ID.bizA}/push/test`)
        .set(HEADER, ID.owner)
        .send({ title: 'Ping', body: 'Check' });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body.sent).toBe(1);
      expect(delivered).toEqual([endpointA]);

      // Burst past the per-minute limit -> must hit 429 Too Many Requests.
      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await request(app.getHttpServer())
          .post(`/api/businesses/${ID.bizA}/push/test`)
          .set(HEADER, ID.owner)
          .send({ title: `Ping ${i}` });
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
    } finally {
      sendSpy.mockRestore();
    }
  });
});

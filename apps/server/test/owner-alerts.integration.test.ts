/**
 * OWNER-ALERTS-SERVER (V1-65, P0 launch-track, Journeys E / F / G)
 *
 * A new booking (`booking.created`), a paid invoice or storefront order
 * (`invoice.paid`), or a bank-transfer / offline payment claim
 * (`invoice.payment_claimed`) pushes to the owner's subscribed devices and,
 * when the owner has no live subscription or every push fails, falls back to
 * one email to the owner only via SystemEmailService (platform-to-owner;
 * D-82 covers business-to-customer mail).
 *
 * On a REAL Postgres database (`push_subscriptions`, `idempotency_keys`,
 * `businesses`, `memberships`, `users`, `invoices`), through the REAL
 * EventEmitter2 bus, OwnerAlertsListener, and PushNotificationService.
 * No real provider traffic: only web-push delivery and SystemEmailService
 * transport are stubbed.
 *
 * Fixtures: prefix `v65f_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v65f_';

const ID = {
  owner: `${P}owner`,
  coOwner: `${P}co_owner`,
  staff: `${P}staff`,
  bizPush: `${P}biz_push`,
  bizNoPush: `${P}biz_nopush`,
  bizPushFail: `${P}biz_fail`,
  bizPrefs: `${P}biz_prefs`,
  bizOther: `${P}biz_other`,
  bizDemoted: `${P}biz_demoted`,
};

const EMAIL = {
  owner: `${P}owner@example.test`,
  coOwner: `${P}coowner@example.test`,
  staff: `${P}staff@example.test`,
  customer: `${P}customer@example.test`,
};

const ENDPOINT = {
  ownerPush: `https://push.v65f.test/sub/owner-biz-push`,
  staffPush: `https://push.v65f.test/sub/staff-biz-push`,
  ownerOther: `https://push.v65f.test/sub/owner-biz-other`,
  ownerFail: `https://push.v65f.test/sub/owner-biz-fail`,
  coOwnerDemoted: `https://push.v65f.test/sub/coowner-biz-demoted`,
  demotedFormerOwner: `https://push.v65f.test/sub/demoted-owner-biz-demoted`,
};

let db: any;
let app: any;
let events: any;
let pushService: any;
let ownerAlerts: any;

const pushCalls: Array<{ endpoint: string; payload: any }> = [];
const emailCalls: Array<{ to: string; subject: string; html: string; text?: string; idempotencyKey?: string }> = [];
const inflight: Promise<unknown>[] = [];
let failPushEndpoints = new Set<string>();
let nowMs = Date.UTC(2026, 10, 25, 12, 0, 0);

async function settle() {
  for (let round = 0; round < 4; ) {
    const hadWork = inflight.length > 0;
    while (inflight.length > 0) {
      await inflight.shift()!.catch(() => undefined);
    }
    await new Promise((r) => setImmediate(r));
    round = hadWork || inflight.length > 0 ? 0 : round + 1;
  }
}

async function emitAndSettle(eventName: string, payload: unknown) {
  events.emit(eventName, payload);
  await settle();
}

const PREVIOUS_VAPID = {
  pub: process.env.VAPID_PUBLIC_KEY,
  priv: process.env.VAPID_PRIVATE_KEY,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM push_subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const webpush = await import('web-push');
  const vapidKeys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { PushNotificationService } = await import('../src/modules/push-notifications/push-notification.service');
  const { SystemEmailService } = await import('../src/modules/notifications/system-email.service');
  const { OwnerAlertsListener } = await import('../src/modules/notifications/owner-alerts.listener');

  Logger.overrideLogger(false);

  const systemEmailStub = {
    isConfigured: () => true,
    sendTransactional: vi.fn(async (args: any) => {
      emailCalls.push({
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        idempotencyKey: args.idempotencyKey,
      });
      return { id: `${P}email_${emailCalls.length}` };
    }),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    providers: [
      PrismaService,
      PushNotificationService,
      { provide: SystemEmailService, useValue: systemEmailStub },
      OwnerAlertsListener,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  events = app.get(EventEmitter2);
  pushService = app.get(PushNotificationService);
  ownerAlerts = app.get(OwnerAlertsListener);
  ownerAlerts.setClock(() => new Date(nowMs));

  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(ownerAlerts))) {
    if (!name.startsWith('on') || typeof ownerAlerts[name] !== 'function') continue;
    const original = ownerAlerts[name].bind(ownerAlerts);
    ownerAlerts[name] = (...args: unknown[]) => {
      const work = original(...args);
      inflight.push(Promise.resolve(work));
      return work;
    };
  }

  // Stub ONLY the outbound web-push network call (never hit external push servers in tests).
  vi.spyOn(pushService as any, 'sendPushNotification').mockImplementation(
    async (sub: { endpoint: string }, rawPayload: string) => {
      pushCalls.push({ endpoint: sub.endpoint, payload: JSON.parse(rawPayload) });
      if (failPushEndpoints.has(sub.endpoint)) {
        const err = Object.assign(new Error('Gone'), { statusCode: 410 });
        throw err;
      }
      return { statusCode: 201 };
    },
  );

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.owner, email: EMAIL.owner, role: 'USER' },
      { id: ID.coOwner, email: EMAIL.coOwner, role: 'USER' },
      { id: ID.staff, email: EMAIL.staff, role: 'USER' },
    ],
  });

  for (const [id, slug, name, ownerId] of [
    [ID.bizPush, 'push', 'V65F Push Salon', ID.owner],
    [ID.bizNoPush, 'nopush', 'V65F Email Fallback Studio', ID.owner],
    [ID.bizPushFail, 'fail', 'V65F Stale Push Shop', ID.owner],
    [ID.bizPrefs, 'prefs', 'V65F Prefs Bakery', ID.owner],
    [ID.bizOther, 'other', 'V65F Other Biz', ID.owner],
    [ID.bizDemoted, 'demoted', 'V65F Co-Owner Biz', ID.owner],
  ] as const) {
    await db.business.create({
      data: { id, name, slug: `${P}${slug}`, ownerId, currency: 'TTD' },
    });
  }

  await db.membership.createMany({
    data: [
      { id: `${P}m_owner_push`, userId: ID.owner, businessId: ID.bizPush, role: 'OWNER' },
      { id: `${P}m_staff_push`, userId: ID.staff, businessId: ID.bizPush, role: 'STAFF' },
      { id: `${P}m_owner_nopush`, userId: ID.owner, businessId: ID.bizNoPush, role: 'OWNER' },
      { id: `${P}m_owner_fail`, userId: ID.owner, businessId: ID.bizPushFail, role: 'OWNER' },
      { id: `${P}m_owner_prefs`, userId: ID.owner, businessId: ID.bizPrefs, role: 'OWNER' },
      { id: `${P}m_owner_other`, userId: ID.owner, businessId: ID.bizOther, role: 'OWNER' },
      // D-116 / D-125: bizDemoted.ownerId is ID.owner, but ID.owner only holds STAFF while ID.coOwner holds OWNER.
      { id: `${P}m_demoted_staff`, userId: ID.owner, businessId: ID.bizDemoted, role: 'STAFF' },
      { id: `${P}m_demoted_owner`, userId: ID.coOwner, businessId: ID.bizDemoted, role: 'OWNER' },
    ],
  });

  await db.pushSubscription.createMany({
    data: [
      { id: `${P}sub_owner_push`, endpoint: ENDPOINT.ownerPush, p256dh: 'k1', auth: 'a1', userId: ID.owner, businessId: ID.bizPush },
      { id: `${P}sub_staff_push`, endpoint: ENDPOINT.staffPush, p256dh: 'k2', auth: 'a2', userId: ID.staff, businessId: ID.bizPush },
      { id: `${P}sub_owner_other`, endpoint: ENDPOINT.ownerOther, p256dh: 'k3', auth: 'a3', userId: ID.owner, businessId: ID.bizOther },
      { id: `${P}sub_coowner`, endpoint: ENDPOINT.coOwnerDemoted, p256dh: 'k5', auth: 'a5', userId: ID.coOwner, businessId: ID.bizDemoted },
      { id: `${P}sub_demoted`, endpoint: ENDPOINT.demotedFormerOwner, p256dh: 'k6', auth: 'a6', userId: ID.owner, businessId: ID.bizDemoted },
    ],
  });
}, 60_000);

beforeEach(async () => {
  pushCalls.length = 0;
  emailCalls.length = 0;
  failPushEndpoints = new Set<string>();
  nowMs = Date.UTC(2026, 10, 25, 12, 0, 0);
  await db.business.update({
    where: { id: ID.bizPrefs },
    data: { notificationPreferences: null },
  });
});

afterAll(async () => {
  await cleanup();
  if (app) await app.close();
  if (PREVIOUS_VAPID.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = PREVIOUS_VAPID.pub;
  if (PREVIOUS_VAPID.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = PREVIOUS_VAPID.priv;
}, 30_000);

describe('OWNER-ALERTS-SERVER (V1-65, P0, Journeys E / F / G)', () => {
  it('[OA-01] RED-BEFORE: booking.created sends one web-push to the owner subscription only (not staff, not other business), 0 emails, and dedupes repeat emits', async () => {
    const payload = {
      businessId: ID.bizPush,
      booking: {
        id: `${P}bk_01`,
        businessId: ID.bizPush,
        startTime: new Date('2026-12-01T14:00:00Z'),
        service: { name: 'Haircut & Trim' },
      },
      contact: { firstName: 'Maya', lastName: 'Singh', email: EMAIL.customer },
    };

    await emitAndSettle('booking.created', payload);

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].endpoint).toBe(ENDPOINT.ownerPush);
    expect(pushCalls[0].payload.title).toMatch(/booking/i);
    expect(pushCalls[0].payload.body).toContain('Maya Singh');
    expect(emailCalls).toHaveLength(0);

    // Duplicate emit (including concurrent replay) yields zero extra pushes or emails.
    await Promise.all([
      emitAndSettle('booking.created', payload),
      emitAndSettle('booking.created', payload),
    ]);
    expect(pushCalls).toHaveLength(1);
    expect(emailCalls).toHaveLength(0);
  });

  it('[OA-02] invoice.paid (online & storefront) pushes once to the owner, dedupes replays, and never mails a customer', async () => {
    const payload = {
      businessId: ID.bizPush,
      invoice: {
        id: `${P}inv_paid_01`,
        businessId: ID.bizPush,
        invoiceNumber: 'INV-V65F-100',
        total: 250,
        currency: 'TTD',
        contact: { firstName: 'Devon', lastName: 'Ali', email: EMAIL.customer },
      },
    };

    await emitAndSettle('invoice.paid', payload);
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].endpoint).toBe(ENDPOINT.ownerPush);
    expect(pushCalls[0].payload.body).toContain('INV-V65F-100');
    expect(emailCalls).toHaveLength(0);

    await emitAndSettle('invoice.paid', payload);
    expect(pushCalls).toHaveLength(1);
    expect(emailCalls).toHaveLength(0);
  });

  it('[OA-03] email fallback when owner has no live PushSubscription: sends one SystemEmailService alert to owner only (never customer) with HTML escaping', async () => {
    await emitAndSettle('booking.created', {
      businessId: ID.bizNoPush,
      booking: { id: `${P}bk_email_01`, businessId: ID.bizNoPush, startTime: new Date('2026-12-02T10:00:00Z') },
      contact: { firstName: '<script>x</script>', lastName: 'Buyer', email: EMAIL.customer },
    });
    await emitAndSettle('invoice.paid', {
      businessId: ID.bizNoPush,
      invoice: {
        id: `${P}inv_email_01`,
        businessId: ID.bizNoPush,
        invoiceNumber: 'INV-V65F-200',
        total: 120,
        currency: 'TTD',
        contact: { firstName: 'Andre', lastName: 'Charles', email: EMAIL.customer },
      },
    });
    await emitAndSettle('invoice.payment_claimed', {
      businessId: ID.bizNoPush,
      invoiceId: `${P}inv_claim_email_01`,
      invoice: { id: `${P}inv_claim_email_01`, businessId: ID.bizNoPush, invoiceNumber: 'INV-V65F-201', total: 300, currency: 'TTD' },
      method: 'bank_transfer',
      amount: 300,
      currency: 'TTD',
      customerName: 'Tanya Joseph',
    });

    expect(pushCalls).toHaveLength(0);
    expect(emailCalls).toHaveLength(3);
    for (const mail of emailCalls) {
      expect(mail.to).toBe(EMAIL.owner);
      expect(mail.to).not.toBe(EMAIL.customer);
    }
    expect(emailCalls[0].html).not.toContain('<script>x</script>');
    expect(emailCalls[0].html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(emailCalls[1].subject).toContain('INV-V65F-200');
    expect(emailCalls[2].subject).toMatch(/claim|transfer|payment/i);

    // SEC-P58-1 / SEC-P58-3 / COR-P58-2: malicious primaryColor/secondaryColor, CRLF in Business.name, and null amount.
    emailCalls.length = 0;
    await db.business.update({
      where: { id: ID.bizNoPush },
      data: {
        name: 'V65F Studio\r\nBcc: evil@example.test',
        primaryColor: '"><img src=x>',
        secondaryColor: 'javascript:alert(1)',
      },
    });
    await emitAndSettle('invoice.payment_claimed', {
      businessId: ID.bizNoPush,
      invoiceId: `${P}inv_claim_sanitize_01`,
      invoice: { id: `${P}inv_claim_sanitize_01`, businessId: ID.bizNoPush, invoiceNumber: 'INV-SAN-1\r\nX-Hdr: 1', total: null, currency: 'TTD' },
      method: 'bank_transfer',
      amount: null,
      currency: 'TTD',
    });
    await db.business.update({
      where: { id: ID.bizNoPush },
      data: { name: 'V65F Email Fallback Studio', primaryColor: null, secondaryColor: null },
    });
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0].subject).not.toMatch(/[\r\n]/);
    expect(emailCalls[0].html).not.toContain('<img src=x>');
    expect(emailCalls[0].html).not.toContain('javascript:alert(1)');
    expect(emailCalls[0].html).toContain('#F97316');
    expect(emailCalls[0].html).not.toContain('TTD 0.00');
  });

  it('[OA-04] push failure (410 Gone) prunes expired subscription and falls back to one owner-only email', async () => {
    await db.pushSubscription.create({
      data: {
        id: `${P}sub_owner_fail`,
        endpoint: ENDPOINT.ownerFail,
        p256dh: 'kf',
        auth: 'af',
        userId: ID.owner,
        businessId: ID.bizPushFail,
      },
    });
    failPushEndpoints.add(ENDPOINT.ownerFail);

    await emitAndSettle('invoice.paid', {
      businessId: ID.bizPushFail,
      invoice: {
        id: `${P}inv_fail_01`,
        businessId: ID.bizPushFail,
        invoiceNumber: 'INV-V65F-300',
        total: 95,
        currency: 'USD',
        contact: { firstName: 'Nadia', lastName: 'Persad', email: EMAIL.customer },
      },
    });

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].endpoint).toBe(ENDPOINT.ownerFail);
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0].to).toBe(EMAIL.owner);

    const remaining = await db.pushSubscription.findMany({ where: { businessId: ID.bizPushFail, endpoint: ENDPOINT.ownerFail } });
    expect(remaining).toHaveLength(0);
  });

  it('[OA-05] Business.notificationPreferences honours owner alert toggles without silencing alerts when customer receipt emails are off', async () => {
    await db.business.update({
      where: { id: ID.bizPrefs },
      data: { notificationPreferences: { owner_alerts: { bookings: false }, owner_alert_payments: false, payment_receipt: false } },
    });

    await emitAndSettle('booking.created', {
      businessId: ID.bizPrefs,
      booking: { id: `${P}bk_pref_01`, businessId: ID.bizPrefs, startTime: new Date('2026-12-03T09:00:00Z') },
      contact: { firstName: 'Ria', lastName: 'Gomes', email: EMAIL.customer },
    });
    await emitAndSettle('invoice.paid', {
      businessId: ID.bizPrefs,
      invoice: { id: `${P}inv_pref_01`, businessId: ID.bizPrefs, invoiceNumber: 'INV-PREF-1', total: 50, currency: 'TTD' },
    });
    expect(pushCalls).toHaveLength(0);
    expect(emailCalls).toHaveLength(0);

    // Re-enabling owner alerts (even with customer payment_receipt still false) allows delivery cleanly.
    await db.business.update({
      where: { id: ID.bizPrefs },
      data: { notificationPreferences: { owner_alerts: { bookings: true, payments: true, claims: false }, payment_receipt: false } },
    });

    await emitAndSettle('booking.created', {
      businessId: ID.bizPrefs,
      booking: { id: `${P}bk_pref_01`, businessId: ID.bizPrefs, startTime: new Date('2026-12-03T09:00:00Z') },
      contact: { firstName: 'Ria', lastName: 'Gomes', email: EMAIL.customer },
    });
    await emitAndSettle('invoice.paid', {
      businessId: ID.bizPrefs,
      invoice: { id: `${P}inv_pref_01`, businessId: ID.bizPrefs, invoiceNumber: 'INV-PREF-1', total: 50, currency: 'TTD' },
    });
    await emitAndSettle('invoice.payment_claimed', {
      businessId: ID.bizPrefs,
      invoiceId: `${P}inv_pref_claim`,
      invoice: { id: `${P}inv_pref_claim`, businessId: ID.bizPrefs, invoiceNumber: 'INV-PREF-2', total: 50, currency: 'TTD' },
      method: 'bank_transfer',
    });

    expect(emailCalls).toHaveLength(2);
    expect(emailCalls.every((m) => m.to === EMAIL.owner)).toBe(true);
  });

  it('[OA-06] flood & 6h coalescing: 20 invoice.payment_claimed intents on one invoice yield 1 push (or 1 email) inside 6h, and the next window shows the coalesced count', async () => {
    const invPushId = `${P}inv_flood_push`;
    const makePushClaim = (n: number) => ({
      businessId: ID.bizPush,
      invoiceId: invPushId,
      claimId: `${P}clm_p_${n}`,
      invoice: { id: invPushId, businessId: ID.bizPush, invoiceNumber: 'INV-FLOOD-1', total: 500, currency: 'TTD' },
      method: 'bank_transfer',
      amount: 500,
      currency: 'TTD',
    });

    // 20 concurrent/burst intents inside the 6-hour window -> exactly 1 push attempt, 0 emails.
    await Promise.all(Array.from({ length: 20 }, (_, i) => emitAndSettle('invoice.payment_claimed', makePushClaim(i + 1))));
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].endpoint).toBe(ENDPOINT.ownerPush);
    expect(emailCalls).toHaveLength(0);

    // 5h59m later: still inside the 6-hour window -> 0 additional alerts.
    nowMs += 6 * 60 * 60 * 1000 - 60_000;
    await emitAndSettle('invoice.payment_claimed', makePushClaim(21));
    expect(pushCalls).toHaveLength(1);

    // Past 6 hours (6h01m from window start): new window sends 1 alert showing total coalesced count (21: 20 prior coalesced + 1 new).
    nowMs += 2 * 60_000;
    await emitAndSettle('invoice.payment_claimed', makePushClaim(22));
    expect(pushCalls).toHaveLength(2);
    expect(`${pushCalls[1].payload.title} ${pushCalls[1].payload.body}`).toContain('21');

    // Mirror flood test on email-fallback business (0 push subs): 20 intents -> exactly 1 owner email inside 6h.
    pushCalls.length = 0;
    emailCalls.length = 0;
    const invEmailId = `${P}inv_flood_email`;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        emitAndSettle('invoice.payment_claimed', {
          businessId: ID.bizNoPush,
          invoiceId: invEmailId,
          claimId: `${P}clm_e_${i + 1}`,
          invoice: { id: invEmailId, businessId: ID.bizNoPush, invoiceNumber: 'INV-FLOOD-2', total: 400, currency: 'TTD' },
          method: 'bank_transfer',
        }),
      ),
    );
    expect(pushCalls).toHaveLength(0);
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0].to).toBe(EMAIL.owner);

    // Next 6h window on email fallback shows the coalesced count (20: 19 suppressed + 1 new).
    nowMs += 6 * 60 * 60 * 1000 + 1_000;
    await emitAndSettle('invoice.payment_claimed', {
      businessId: ID.bizNoPush,
      invoiceId: invEmailId,
      claimId: `${P}clm_e_21`,
      invoice: { id: invEmailId, businessId: ID.bizNoPush, invoiceNumber: 'INV-FLOOD-2', total: 400, currency: 'TTD' },
      method: 'bank_transfer',
    });
    expect(emailCalls).toHaveLength(2);
    expect(`${emailCalls[1].subject} ${emailCalls[1].html}`).toContain('20');
  });

  it('[OA-07] D-104/D-116/D-125 owner resolution & tenant mismatch guard: demoted or removed ownerId gets zero alerts; only OWNER membership does; mismatched businessId ignored', async () => {
    await emitAndSettle('booking.created', {
      businessId: ID.bizDemoted,
      booking: { id: `${P}bk_demoted_01`, businessId: ID.bizDemoted, startTime: new Date('2026-12-04T11:00:00Z') },
      contact: { firstName: 'Sasha', lastName: 'Lee', email: EMAIL.customer },
    });

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].endpoint).toBe(ENDPOINT.coOwnerDemoted);
    expect(emailCalls).toHaveLength(0);

    // SEC-P58-2 / COR-P58-1: a business whose Business.ownerId has NO Membership row (removed former owner)
    // and zero OWNER memberships gets 0 pushes and 0 emails even when business.email is set.
    pushCalls.length = 0;
    emailCalls.length = 0;
    const removedBizId = `${P}biz_removed_owner`;
    await db.business.create({
      data: {
        id: removedBizId,
        name: 'V65F Removed Owner Biz',
        slug: `${P}removed-owner`,
        ownerId: ID.owner,
        email: `${P}biz-fallback@example.test`,
        currency: 'TTD',
      },
    });
    await db.pushSubscription.create({
      data: {
        id: `${P}sub_removed_owner`,
        endpoint: `https://push.v65f.test/sub/removed-owner`,
        p256dh: 'kr',
        auth: 'ar',
        userId: ID.owner,
        businessId: removedBizId,
      },
    });
    await emitAndSettle('invoice.paid', {
      businessId: removedBizId,
      invoice: { id: `${P}inv_removed_01`, businessId: removedBizId, invoiceNumber: 'INV-REM-1', total: 75, currency: 'TTD' },
    });
    expect(pushCalls).toHaveLength(0);
    expect(emailCalls).toHaveLength(0);

    // Mismatched entity businessId -> refused silently, 0 pushes, 0 emails.
    pushCalls.length = 0;
    await emitAndSettle('invoice.paid', {
      businessId: ID.bizPush,
      invoice: { id: `${P}inv_cross`, businessId: ID.bizOther, invoiceNumber: 'INV-CROSS', total: 100, currency: 'TTD' },
    });
    expect(pushCalls).toHaveLength(0);
    expect(emailCalls).toHaveLength(0);
  });

  it('[OA-08] NotificationsModule wires PushNotificationModule and OwnerAlertsListener', async () => {
    const { NotificationsModule } = await import('../src/modules/notifications/notifications.module');
    const { OwnerAlertsListener } = await import('../src/modules/notifications/owner-alerts.listener');
    const { PushNotificationModule } = await import('../src/modules/push-notifications/push-notification.module');
    const providers = Reflect.getMetadata('providers', NotificationsModule) ?? [];
    const imports = Reflect.getMetadata('imports', NotificationsModule) ?? [];
    expect(providers).toContain(OwnerAlertsListener);
    expect(imports).toContain(PushNotificationModule);
  });
});

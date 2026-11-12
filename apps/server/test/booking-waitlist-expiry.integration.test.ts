/**
 * V1-88 PR196-WAITLIST-EXPIRY: a waitlist offer expires after a fixed
 * 120-minute hold and the slot moves to the next waiting customer; staff are
 * notified (D-86). Against a REAL database.
 *
 * PR #196 feature F1, rebuilt on our contracts. Before this packet nothing
 * expired an OFFERED entry: its UNCONFIRMED placeholder held the staff member's
 * time for ever, and nobody was told an offer had been made. PR #196's port
 * overwrote CONVERTED with EXPIRED and cancelled a just-confirmed booking from
 * a stale read (F1-D1), cascaded a slot whose hold was still held into a double
 * booking (F1-D2), ran ungated (F1-D3), emailed the customer a "booking
 * received" message with no deadline (F1-D4), logged a non-canonical timeline
 * type that always threw (F1-D5) and aborted the batch on one failure (F1-D6).
 *
 * Cases:
 *   RED-BEFORE (fail on the unmodified code, by absence or by the defect):
 *     - a stale offer expires: entry EXPIRED, hold CANCELLED, the next WAITING
 *       entry is offered the same staff and time with a fresh 120-minute hold;
 *     - convert racing expire, both orders, forced at the stale read and run
 *       concurrently: never CONVERTED with a cancelled booking, never EXPIRED
 *       with a confirmed one, never two live bookings on the slot;
 *     - a hold confirmed by staff while still OFFERED is not cascaded;
 *     - one failing entry (refused cascade, database error) does not abort the
 *       batch; a rolled-back entry stays OFFERED for the next pass;
 *     - two expiry passes at once (two replicas) expire and cascade once;
 *     - staff get an in-app notification with the deadline and no link; the
 *       ContactEvent is the canonical booking.waitlist_offered with its actor;
 *       the customer is not emailed.
 *   CONTROL (green before and after):
 *     - an offer 119 minutes old is left alone (asserted through the same call).
 *
 * Nothing on the boundary is mocked: PrismaService, BookingWaitlistService
 * (expiry, offer, convert, the V1-27 slot lock), BookingWaitlistListener,
 * NotificationsService (the staff notification path) and CrmTimelineService
 * (the canonical-type check and the contact_events write) read and write real
 * rows. CrmService is a pass-through to that real CrmTimelineService. Stubs:
 * the event bus (records emits; the cases hand payloads to the listener), the
 * Activity ledger (TimelineService), and the email senders, which are spies
 * that must stay uncalled. No provider traffic.
 *
 * Fixtures: prefix `v88b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll, and
 * the per-case rows (entries, bookings, notifications, contact events) before
 * each case; no $transaction wrapping. Literals in globally unique columns
 * embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v88b_';
const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  svc: `${P}svc`,
  staff: `${P}staff`,
  contacts: [1, 2, 3, 4, 5, 6].map((n) => `${P}contact${n}`),
};
const HOLD_MS = 120 * 60_000;

/** A distinct one-hour slot per case, well in the future. */
const slotAt = (day: number) => ({
  startTime: new Date(Date.UTC(2031, 3, day, 14, 0, 0, 0)),
  endTime: new Date(Date.UTC(2031, 3, day, 15, 0, 0, 0)),
});

let db: any;
let moduleRef: any;
let waitlist: any;
let listener: any;
let WaitlistCtor: any;
let runWithTenant: any;

const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload: unknown) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  listenerCount: () => 0,
};
const emailSpy = { send: vi.fn(async () => undefined), sendSystemEmail: vi.fn(async () => undefined) };

let seq = 0;
const nextId = (tag: string) => `${P}${tag}${++seq}`;

async function cleanupCaseRows() {
  for (const sql of [
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM booking_waitlist_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function cleanup() {
  await cleanupCaseRows();
  for (const sql of [
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM staff_members WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

/** A WAITING entry, created now (FIFO order is createdAt). */
async function waiting(contactId: string) {
  return db.bookingWaitlistEntry.create({
    data: { id: nextId('e'), businessId: ID.biz, contactId, serviceId: ID.svc, status: 'WAITING' },
  });
}

/** An entry offered through the real offerSlot, then aged `minutesAgo`. */
async function offered(contactId: string, slot: { startTime: Date; endTime: Date }, minutesAgo = 121) {
  const entry = await waiting(contactId);
  const { booking } = await waitlist.offerSlot(entry.id, { ...slot, serviceId: ID.svc, staffId: ID.staff });
  await db.bookingWaitlistEntry.update({
    where: { id: entry.id },
    data: { offeredAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
  return { entryId: entry.id as string, holdId: booking.id as string };
}

async function entry(id: string) {
  return db.bookingWaitlistEntry.findUnique({ where: { id } });
}

async function booking(id: string) {
  return db.booking.findUnique({ where: { id } });
}

/** Bookings that hold the slot (anything but CANCELLED and NO_SHOW). */
async function liveOnSlot(slot: { startTime: Date }) {
  return db.booking.findMany({
    where: { businessId: ID.biz, staffId: ID.staff, startTime: slot.startTime, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, deletedAt: null },
  });
}

/**
 * A BookingWaitlistService whose bookingWaitlistEntry reads run a hook after
 * the real read returns and before the caller sees it: the stale-read window
 * of F1-D1, forced. Transactions are the real client's.
 */
function serviceWithHooks(hooks: { afterScan?: () => Promise<unknown>; afterEntryRead?: () => Promise<unknown> }) {
  const delegate = db.bookingWaitlistEntry;
  const wrapped = new Proxy(delegate, {
    get(target, prop) {
      if (prop === 'findMany' && hooks.afterScan) {
        return async (args: unknown) => {
          const rows = await target.findMany(args);
          const hook = hooks.afterScan!;
          hooks.afterScan = undefined;
          await hook();
          return rows;
        };
      }
      if (prop === 'findFirst' && hooks.afterEntryRead) {
        return async (args: unknown) => {
          const row = await target.findFirst(args);
          const hook = hooks.afterEntryRead!;
          hooks.afterEntryRead = undefined;
          await hook();
          return row;
        };
      }
      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const client = new Proxy(db, {
    get(target, prop) {
      if (prop === 'bookingWaitlistEntry') return wrapped;
      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new WaitlistCtor({ client }, eventStub);
}

beforeAll(async () => {
  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  db = (await import('@keyflow/db')).db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { BookingWaitlistListener } = await import('../src/modules/bookings/booking-waitlist.listener');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { SystemEmailService } = await import('../src/modules/notifications/system-email.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  runWithTenant = (await import('../src/core/tenant/tenant-context')).runWithTenant;
  WaitlistCtor = BookingWaitlistService;

  Logger.overrideLogger(false);

  moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      BookingWaitlistService,
      BookingWaitlistListener,
      // The staff notification path, real.
      NotificationsService,
      // The ContactEvent writer and its canonical-type check, real.
      CrmTimelineService,
      {
        provide: CrmService,
        useFactory: (timeline: InstanceType<typeof CrmTimelineService>) => ({
          logContactEvent: (input: any) => timeline.logContactEvent(input),
        }),
        inject: [CrmTimelineService],
      },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      // Present so a customer email would be observable; must stay uncalled.
      { provide: TransactionalEmailService, useValue: emailSpy },
      { provide: SystemEmailService, useValue: emailSpy },
    ],
  }).compile();

  waitlist = moduleRef.get(BookingWaitlistService);
  listener = moduleRef.get(BookingWaitlistListener);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.biz, name: 'V88B Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', timezone: 'America/Port_of_Spain' },
  });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.service.create({ data: { id: ID.svc, businessId: ID.biz, name: 'V88B Cut', duration: 60, price: 0 } });
  await db.staffMember.create({ data: { id: ID.staff, businessId: ID.biz, name: 'Staff One' } });
  for (const [i, id] of ID.contacts.entries()) {
    await db.contact.create({ data: { id, businessId: ID.biz, firstName: `Wait${i + 1}`, lastName: 'Lister' } });
  }
}, 60_000);

beforeEach(async () => {
  await cleanupCaseRows();
  emitted.length = 0;
  emailSpy.send.mockClear();
  emailSpy.sendSystemEmail.mockClear();
});

afterAll(async () => {
  try {
    if (db) await cleanup();
  } finally {
    await moduleRef?.close();
  }
});

describe('a stale offer expires and the slot moves on (PR196-WAITLIST-EXPIRY, D-86)', () => {
  it('RED-BEFORE: entry EXPIRED, hold CANCELLED, the next WAITING entry is offered the same staff and time with a fresh 120-minute hold', async () => {
    const slot = slotAt(1);
    const stale = await offered(ID.contacts[0], slot, 121);
    const young = await offered(ID.contacts[1], slotAt(2), 119);
    const next = await waiting(ID.contacts[2]);

    const before = Date.now();
    const result = await waitlist.expireStaleOffers({ businessId: ID.biz });
    const after = Date.now();

    expect(result).toEqual({ expired: 1, cascaded: 1, failed: 0 });
    expect((await entry(stale.entryId)).status).toBe('EXPIRED');
    expect((await booking(stale.holdId)).status).toBe('CANCELLED');

    const moved = await entry(next.id);
    expect(moved.status).toBe('OFFERED');
    const hold = await booking(moved.offeredBookingId);
    expect(hold).toMatchObject({ status: 'UNCONFIRMED', staffId: ID.staff, serviceId: ID.svc, contactId: ID.contacts[2] });
    expect(hold.startTime.toISOString()).toBe(slot.startTime.toISOString());
    expect(hold.endTime.toISOString()).toBe(slot.endTime.toISOString());
    // The fresh hold runs 120 minutes from now.
    expect(moved.offeredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(moved.offeredAt.getTime()).toBeLessThanOrEqual(after + 1000);
    const offeredEvent = emitted.find((e) => e.name === 'booking.waitlist.slot_offered' && e.payload.entry.id === next.id);
    expect(new Date(offeredEvent!.payload.offerExpiresAt).getTime()).toBe(moved.offeredAt.getTime() + HOLD_MS);

    // CONTROL: the 119-minute offer is untouched.
    expect((await entry(young.entryId)).status).toBe('OFFERED');
    expect((await booking(young.holdId)).status).toBe('UNCONFIRMED');

    expect(await liveOnSlot(slot)).toHaveLength(1);
  });
});

describe('convert racing expire (F1-D1), on a real database', () => {
  it('RED-BEFORE: convert commits after the expiry read its snapshot: the conversion stands and nothing cascades', async () => {
    const slot = slotAt(3);
    const stale = await offered(ID.contacts[0], slot);
    const next = await waiting(ID.contacts[1]);

    const racing = serviceWithHooks({
      afterScan: () => waitlist.convertWaitlistEntry(ID.biz, stale.entryId),
    });
    const result = await racing.expireStaleOffers({ businessId: ID.biz });

    expect(result).toEqual({ expired: 0, cascaded: 0, failed: 0 });
    expect((await entry(stale.entryId)).status).toBe('CONVERTED');
    expect((await booking(stale.holdId)).status).toBe('CONFIRMED');
    expect((await entry(next.id)).status).toBe('WAITING');
    expect(await liveOnSlot(slot)).toHaveLength(1);
  });

  it('RED-BEFORE: expiry commits after the convert read the entry: the convert is refused and the expired hold is not revived', async () => {
    const slot = slotAt(4);
    const stale = await offered(ID.contacts[0], slot);
    const next = await waiting(ID.contacts[1]);

    const racing = serviceWithHooks({
      afterEntryRead: () => waitlist.expireStaleOffers({ businessId: ID.biz }),
    });
    await expect(racing.convertWaitlistEntry(ID.biz, stale.entryId)).rejects.toThrow('no offered slot');

    expect((await entry(stale.entryId)).status).toBe('EXPIRED');
    expect((await booking(stale.holdId)).status).toBe('CANCELLED');
    const moved = await entry(next.id);
    expect(moved.status).toBe('OFFERED');
    const live = await liveOnSlot(slot);
    expect(live.map((b: any) => b.id)).toEqual([moved.offeredBookingId]);
  });

  it('RED-BEFORE: expiry commits after the convert read the entry, nobody waiting: the convert is refused, EXPIRED is not overwritten', async () => {
    const slot = slotAt(5);
    const stale = await offered(ID.contacts[0], slot);

    const racing = serviceWithHooks({
      afterEntryRead: () => waitlist.expireStaleOffers({ businessId: ID.biz }),
    });
    await expect(racing.convertWaitlistEntry(ID.biz, stale.entryId)).rejects.toThrow('no offered slot');

    expect((await entry(stale.entryId)).status).toBe('EXPIRED');
    expect((await booking(stale.holdId)).status).toBe('CANCELLED');
    expect(await liveOnSlot(slot)).toHaveLength(0);
  });

  it('RED-BEFORE: run concurrently, five rounds: exactly one side wins and the slot has one live booking', async () => {
    for (let round = 0; round < 5; round++) {
      await cleanupCaseRows();
      const slot = slotAt(6 + round);
      const stale = await offered(ID.contacts[0], slot);
      const next = await waiting(ID.contacts[1]);

      const [converted] = await Promise.allSettled([
        waitlist.convertWaitlistEntry(ID.biz, stale.entryId),
        waitlist.expireStaleOffers({ businessId: ID.biz }),
      ]);

      const e = await entry(stale.entryId);
      const b = await booking(stale.holdId);
      if (converted.status === 'fulfilled') {
        expect(e.status).toBe('CONVERTED');
        expect(b.status).toBe('CONFIRMED');
        expect((await entry(next.id)).status).toBe('WAITING');
      } else {
        expect(String((converted as PromiseRejectedResult).reason?.message)).toContain('no offered slot');
        expect(e.status).toBe('EXPIRED');
        expect(b.status).toBe('CANCELLED');
        expect((await entry(next.id)).status).toBe('OFFERED');
      }
      expect(await liveOnSlot(slot)).toHaveLength(1);
    }
  });
});

describe('a hold that is still held is never cascaded (F1-D2)', () => {
  it('RED-BEFORE: a placeholder confirmed by staff while OFFERED: the offer lapses, the booking stands, nobody else is offered the slot', async () => {
    const slot = slotAt(12);
    const stale = await offered(ID.contacts[0], slot);
    const next = await waiting(ID.contacts[1]);
    // The status API and KEY confirm a booking by id, leaving the entry OFFERED.
    await db.booking.update({ where: { id: stale.holdId }, data: { status: 'CONFIRMED' } });

    const result = await waitlist.expireStaleOffers({ businessId: ID.biz });

    expect(result).toEqual({ expired: 1, cascaded: 0, failed: 0 });
    expect((await entry(stale.entryId)).status).toBe('EXPIRED');
    expect((await booking(stale.holdId)).status).toBe('CONFIRMED');
    expect((await entry(next.id)).status).toBe('WAITING');
    expect(await liveOnSlot(slot)).toHaveLength(1);
    const expired = emitted.find((e) => e.name === 'booking.waitlist.offer_expired');
    expect(expired!.payload).toMatchObject({ released: false, cascadedToEntryId: null, actorType: 'SYSTEM' });
  });
});

describe('each entry is isolated (F1-D6)', () => {
  it('RED-BEFORE: a refused cascade (the slot is still occupied) does not stop the next entry from expiring and cascading', async () => {
    const blocked = slotAt(13);
    const open = slotAt(14);
    const first = await offered(ID.contacts[0], blocked, 125);
    const second = await offered(ID.contacts[1], open, 122);
    // A legacy overlapping booking on the first slot (written before the V1-16
    // guard): releasing the hold does not free that time.
    await db.booking.create({
      data: { id: nextId('legacy'), businessId: ID.biz, contactId: ID.contacts[5], serviceId: ID.svc, staffId: ID.staff, ...blocked, status: 'CONFIRMED' },
    });
    const next = await waiting(ID.contacts[2]);

    const result = await waitlist.expireStaleOffers({ businessId: ID.biz });

    expect(result).toEqual({ expired: 2, cascaded: 1, failed: 0 });
    expect((await entry(first.entryId)).status).toBe('EXPIRED');
    expect((await entry(second.entryId)).status).toBe('EXPIRED');
    const moved = await entry(next.id);
    expect(moved.status).toBe('OFFERED');
    const hold = await booking(moved.offeredBookingId);
    expect(hold.startTime.toISOString()).toBe(open.startTime.toISOString());
    expect(await liveOnSlot(blocked)).toHaveLength(1); // the legacy booking only
  });

  it('RED-BEFORE: a database error on one entry rolls that entry back (still OFFERED, hold kept) and the batch goes on', async () => {
    const first = await offered(ID.contacts[0], slotAt(15), 125);
    const second = await offered(ID.contacts[1], slotAt(16), 122);

    // The first entry's compare-and-set fails inside its transaction.
    const realTransaction = db.$transaction.bind(db);
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === '$transaction') {
          return (fn: any, opts: any) =>
            realTransaction(async (tx: any) => {
              const txProxy = new Proxy(tx, {
                get(t, p) {
                  if (p === 'bookingWaitlistEntry') {
                    return new Proxy(t.bookingWaitlistEntry, {
                      get(d, q) {
                        if (q === 'updateMany') {
                          return async (args: any) => {
                            if (args?.where?.id === first.entryId) throw new Error('simulated connection reset');
                            return d.updateMany(args);
                          };
                        }
                        const v = (d as any)[q];
                        return typeof v === 'function' ? v.bind(d) : v;
                      },
                    });
                  }
                  const v = (t as any)[p];
                  return typeof v === 'function' ? v.bind(t) : v;
                },
              });
              return fn(txProxy);
            }, opts);
        }
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const service = new WaitlistCtor({ client: flaky }, eventStub);

    const result = await service.expireStaleOffers({ businessId: ID.biz });

    expect(result).toEqual({ expired: 1, cascaded: 0, failed: 1 });
    expect((await entry(first.entryId)).status).toBe('OFFERED');
    expect((await booking(first.holdId)).status).toBe('UNCONFIRMED');
    expect((await entry(second.entryId)).status).toBe('EXPIRED');
    expect((await booking(second.holdId)).status).toBe('CANCELLED');

    // The next pass, without the fault, expires the rolled-back entry.
    const retry = await waitlist.expireStaleOffers({ businessId: ID.biz });
    expect(retry).toEqual({ expired: 1, cascaded: 0, failed: 0 });
    expect((await entry(first.entryId)).status).toBe('EXPIRED');
  });
});

describe('two expiry passes at once (two replicas)', () => {
  it('RED-BEFORE: the entry is expired once and the slot is offered once', async () => {
    const slot = slotAt(17);
    const stale = await offered(ID.contacts[0], slot);
    const nextA = await waiting(ID.contacts[1]);
    const nextB = await waiting(ID.contacts[2]);

    const results = await Promise.all([
      waitlist.expireStaleOffers({ businessId: ID.biz }),
      waitlist.expireStaleOffers({ businessId: ID.biz }),
    ]);

    expect(results.reduce((n: number, r: any) => n + r.expired, 0)).toBe(1);
    expect(results.reduce((n: number, r: any) => n + r.cascaded, 0)).toBe(1);
    expect((await entry(stale.entryId)).status).toBe('EXPIRED');
    expect((await entry(nextA.id)).status).toBe('OFFERED');
    expect((await entry(nextB.id)).status).toBe('WAITING');
    expect(await liveOnSlot(slot)).toHaveLength(1);
  });
});

describe('staff are notified, the customer is not (D-86, F1-D4, F1-D5)', () => {
  it('RED-BEFORE: the cascaded offer writes a staff notification with the deadline and no link, and a canonical ContactEvent', async () => {
    const slot = slotAt(18);
    const stale = await offered(ID.contacts[0], slot);
    const next = await waiting(ID.contacts[1]);
    emitted.length = 0;

    await waitlist.expireStaleOffers({ businessId: ID.biz });
    const offeredEvent = emitted.find((e) => e.name === 'booking.waitlist.slot_offered');
    const expiredEvent = emitted.find((e) => e.name === 'booking.waitlist.offer_expired');
    await listener.onSlotOffered(offeredEvent!.payload);
    await listener.onOfferExpired(expiredEvent!.payload);

    const moved = await entry(next.id);
    const deadline = new Date(moved.offeredAt.getTime() + HOLD_MS);

    const notes = await db.notification.findMany({ where: { businessId: ID.biz }, orderBy: { createdAt: 'asc' } });
    const offerNote = notes.find((n: any) => n.type === 'booking.waitlist_offered');
    expect(offerNote).toBeDefined();
    expect(offerNote.data).toMatchObject({
      waitlistEntryId: next.id,
      bookingId: moved.offeredBookingId,
      contactId: ID.contacts[1],
      offerExpiresAt: deadline.toISOString(),
      actorType: 'SYSTEM',
    });
    expect(offerNote.body).toContain('Wait2 Lister');
    const expiredNote = notes.find((n: any) => n.type === 'booking.waitlist_offer_expired');
    expect(expiredNote.data).toMatchObject({ waitlistEntryId: stale.entryId, bookingId: stale.holdId, cascadedToEntryId: next.id });
    // D-86: no public accept link anywhere.
    for (const n of notes) expect(JSON.stringify(n)).not.toMatch(/https?:|:\/\/|token|\/accept/i);

    const events = await db.contactEvent.findMany({ where: { businessId: ID.biz } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      contactId: ID.contacts[1],
      type: 'booking.waitlist_offered',
      actorType: 'SYSTEM',
      source: 'bookings',
    });
    expect(events[0].data).toMatchObject({ waitlistEntryId: next.id, bookingId: moved.offeredBookingId, offerExpiresAt: deadline.toISOString() });

    // Nobody emailed the customer.
    expect(emailSpy.send).not.toHaveBeenCalled();
    expect(emailSpy.sendSystemEmail).not.toHaveBeenCalled();
  });

  it('RED-BEFORE: a member offering a slot from the staff route is named on the ContactEvent', async () => {
    const e = await waiting(ID.contacts[3]);
    await runWithTenant(ID.biz, ID.owner, () =>
      waitlist.offerSlot(e.id, { ...slotAt(19), serviceId: ID.svc, staffId: ID.staff }, 'USER'),
    );
    const offeredEvent = emitted.find((x) => x.name === 'booking.waitlist.slot_offered');
    await listener.onSlotOffered(offeredEvent!.payload);

    const events = await db.contactEvent.findMany({ where: { businessId: ID.biz, contactId: ID.contacts[3] } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'booking.waitlist_offered', actorType: 'USER', actorId: ID.owner });
    const notes = await db.notification.findMany({ where: { businessId: ID.biz, type: 'booking.waitlist_offered' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].data).toMatchObject({ actorType: 'USER', actorId: ID.owner });
  });
});

/**
 * Review SEC-WX-1: KEY's bookings_offer_waitlist_slot calls offerSlot with no
 * actor (flow-orchestrator.service.ts, outside this packet's write set). The
 * offer a member made through KEY was recorded as SYSTEM's, with no actorId, on
 * the canonical ContactEvent and the staff notification. offerSlot's default
 * now follows BookingsService.requestActor's rule (the member TenantInterceptor
 * bound for this business, else SYSTEM); the system's own offers (the expiry
 * cascade, the booking.cancelled listener) say SYSTEM.
 *
 * The dispatcher is the real FlowOrchestratorService.executeToolAction (the
 * prototype with the real PrismaService and this suite's real waitlist service,
 * as test/key-dispatcher-tenant.integration.test.ts composes it).
 */
describe('a KEY offer names the member it was made for (review SEC-WX-1)', () => {
  let dispatcher: any;

  beforeAll(async () => {
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
    const prisma = moduleRef.get(PrismaService);
    dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma,
      moduleRef: {
        get: (token: unknown) => {
          if (token === BookingWaitlistService) return waitlist;
          throw new Error(`unexpected service ${String((token as { name?: string })?.name ?? token)}`);
        },
      },
    });
  });

  const keyOffer = (entryId: string, day: number) => {
    const slot = slotAt(day);
    return dispatcher.executeToolAction(ID.biz, 'bookings_offer_waitlist_slot', {
      entryId,
      serviceId: ID.svc,
      staffId: ID.staff,
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
    });
  };

  it('RED-BEFORE: a member offering through KEY (member chat, tenant bound) is named on the event, the ContactEvent and the staff notification', async () => {
    const e = await waiting(ID.contacts[4]);
    const out = await runWithTenant(ID.biz, ID.owner, () => keyOffer(e.id, 20));
    expect(out.entryId).toBe(e.id);

    const offeredEvent = emitted.find((x) => x.name === 'booking.waitlist.slot_offered');
    expect(offeredEvent!.payload).toMatchObject({ businessId: ID.biz, actorType: 'USER', actorId: ID.owner });
    await listener.onSlotOffered(offeredEvent!.payload);

    const events = await db.contactEvent.findMany({ where: { businessId: ID.biz, contactId: ID.contacts[4] } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'booking.waitlist_offered', actorType: 'USER', actorId: ID.owner, source: 'bookings' });
    const notes = await db.notification.findMany({ where: { businessId: ID.biz, type: 'booking.waitlist_offered' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].data).toMatchObject({ actorType: 'USER', actorId: ID.owner });
  });

  it('CONTROL: KEY with no member bound (the staff bridge, a monitor) records SYSTEM, never a nameless USER', async () => {
    const e = await waiting(ID.contacts[4]);
    await keyOffer(e.id, 21);

    const offeredEvent = emitted.find((x) => x.name === 'booking.waitlist.slot_offered');
    expect(offeredEvent!.payload.actorType).toBe('SYSTEM');
    expect(offeredEvent!.payload).not.toHaveProperty('actorId');
    await listener.onSlotOffered(offeredEvent!.payload);
    const events = await db.contactEvent.findMany({ where: { businessId: ID.biz, contactId: ID.contacts[4] } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null });
  });

  it('CONTROL: KEY in a request bound to another business records SYSTEM, not that member', async () => {
    const e = await waiting(ID.contacts[4]);
    await runWithTenant(`${P}other_biz`, ID.owner, () => keyOffer(e.id, 22));

    const offeredEvent = emitted.find((x) => x.name === 'booking.waitlist.slot_offered');
    expect(offeredEvent!.payload.actorType).toBe('SYSTEM');
    expect(offeredEvent!.payload).not.toHaveProperty('actorId');
  });

  it("CONTROL: the booking.cancelled listener's offer, run inside the cancelling member's request, is the system's", async () => {
    const e = await waiting(ID.contacts[5]);
    const slot = slotAt(23);
    await runWithTenant(ID.biz, ID.owner, () =>
      listener.onCancelled({
        businessId: ID.biz,
        booking: { id: `${P}freed`, startTime: slot.startTime, endTime: slot.endTime, serviceId: ID.svc, staffId: ID.staff },
      }),
    );

    expect((await entry(e.id)).status).toBe('OFFERED');
    const offeredEvent = emitted.find((x) => x.name === 'booking.waitlist.slot_offered');
    expect(offeredEvent!.payload.actorType).toBe('SYSTEM');
    expect(offeredEvent!.payload).not.toHaveProperty('actorId');
  });

  it('CONTROL: the expiry cascade, run inside a member request, offers as SYSTEM', async () => {
    const slot = slotAt(24);
    await offered(ID.contacts[0], slot);
    const next = await waiting(ID.contacts[1]);
    emitted.length = 0;

    await runWithTenant(ID.biz, ID.owner, () => waitlist.expireStaleOffers({ businessId: ID.biz }));

    expect((await entry(next.id)).status).toBe('OFFERED');
    const offeredEvent = emitted.find((x) => x.name === 'booking.waitlist.slot_offered');
    expect(offeredEvent!.payload.actorType).toBe('SYSTEM');
    expect(offeredEvent!.payload).not.toHaveProperty('actorId');
  });
});

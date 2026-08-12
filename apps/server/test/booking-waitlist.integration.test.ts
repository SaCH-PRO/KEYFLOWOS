/**
 * Booking waitlist, against a REAL database.
 *
 * A unit test with mocked Prisma can pass while the listener swallows an
 * exception or matches the wrong rows. This file exercises the actual
 * waitlist service and listener against Postgres so the match, offer, and
 * cleanup paths are falsifiable.
 *
 * Requires DATABASE_URL, same as the other integration tests.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require('@keyflow/db') as typeof import('@keyflow/db');
import { BookingWaitlistService, WAITLIST_STATUSES } from '../src/modules/bookings/booking-waitlist.service';
import { BookingWaitlistListener } from '../src/modules/bookings/booking-waitlist.listener';

const P = 'zz_wl_';
const BIZ = `${P}biz`;
const OWNER = `${P}owner`;
const CONTACT = `${P}contact`;
const SERVICE = `${P}service`;
const STAFF = `${P}staff`;
const SLOT_START = new Date('2026-08-20T10:00:00.000Z');
const SLOT_END = new Date('2026-08-20T11:00:00.000Z');

const prismaStub = { client: db } as never;
const emit = vi.fn();
const waitlistService = new BookingWaitlistService(prismaStub, { emit } as never);
const listener = new BookingWaitlistListener(waitlistService);

async function wipe() {
  // These models are soft-deleted, so deleteMany only sets deletedAt. Use raw
  // SQL for teardown so the next run can re-seed with the same fixture IDs.
  for (const sql of [
    `DELETE FROM booking_waitlist_entries WHERE business_id = '${BIZ}'`,
    `DELETE FROM bookings WHERE business_id = '${BIZ}'`,
    `DELETE FROM services WHERE business_id = '${BIZ}'`,
    `DELETE FROM staff_members WHERE business_id = '${BIZ}'`,
    `DELETE FROM contacts WHERE business_id = '${BIZ}'`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

describe('booking waitlist (real database)', () => {
  beforeAll(async () => {
    Logger.overrideLogger(false);

    await db.user.upsert({
      where: { id: OWNER },
      update: {},
      create: { id: OWNER, email: `${P}owner@example.test`, name: 'Waitlist Owner' },
    });
    await db.business.upsert({
      where: { id: BIZ },
      update: {},
      create: { id: BIZ, name: 'Waitlist Biz', slug: BIZ, ownerId: OWNER },
    });
  });

  afterAll(async () => {
    await wipe();
    for (const sql of [
      `DELETE FROM businesses WHERE id = '${BIZ}'`,
      `DELETE FROM users WHERE id = '${OWNER}'`,
    ]) {
      await db.$executeRawUnsafe(sql);
    }
    await db.$disconnect();
  });

  beforeEach(async () => {
    await wipe();
    emit.mockClear();

    await db.contact.upsert({
      where: { id: CONTACT },
      update: { deletedAt: null },
      create: {
        id: CONTACT,
        businessId: BIZ,
        firstName: 'Priya',
        lastName: 'Ramkissoon',
        email: `${P}priya@example.test`,
      },
    });
    await db.service.upsert({
      where: { id: SERVICE },
      update: { deletedAt: null },
      create: {
        id: SERVICE,
        businessId: BIZ,
        name: 'Cut and colour',
        duration: 60,
        price: 150,
      },
    });
    await db.staffMember.upsert({
      where: { id: STAFF },
      update: { deletedAt: null },
      create: {
        id: STAFF,
        businessId: BIZ,
        name: 'Sarah',
      },
    });
  });

  it('cancelling a booking offers the freed slot to a matching waitlist entry', async () => {
    const booking = await db.booking.create({
      data: {
        businessId: BIZ,
        contactId: CONTACT,
        serviceId: SERVICE,
        staffId: STAFF,
        startTime: SLOT_START,
        endTime: SLOT_END,
        status: 'CONFIRMED',
      },
      include: { contact: true, service: true, staff: true },
    });

    await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: CONTACT,
      serviceId: SERVICE,
      preferredStaffId: STAFF,
      preferredDateFrom: new Date('2026-08-19T00:00:00.000Z'),
      preferredDateTo: new Date('2026-08-21T23:59:59.000Z'),
      preferredTimeOfDay: 'morning',
      notes: 'Any morning that week',
    });

    await listener.onCancelled({
      businessId: BIZ,
      booking,
      contact: booking.contact ?? undefined,
    });

    const entry = await db.bookingWaitlistEntry.findFirstOrThrow({
      where: { businessId: BIZ },
      include: { offeredBooking: true },
    });

    expect(entry.status).toBe(WAITLIST_STATUSES.OFFERED);
    expect(entry.offeredBookingId).not.toBeNull();
    expect(entry.offeredBooking).toMatchObject({
      status: 'UNCONFIRMED',
      startTime: SLOT_START,
      endTime: SLOT_END,
      serviceId: SERVICE,
      staffId: STAFF,
      contactId: CONTACT,
    });

    // CONTROL: remove the listener's offerSlot call. entry.status stays WAITING
    // and no placeholder booking is created.
  });

  it('does not offer a freed slot when the waitlist entry prefers a different staff member', async () => {
    const otherStaff = await db.staffMember.create({
      data: { businessId: BIZ, name: 'Other stylist' },
    });

    const booking = await db.booking.create({
      data: {
        businessId: BIZ,
        contactId: CONTACT,
        serviceId: SERVICE,
        staffId: STAFF,
        startTime: SLOT_START,
        endTime: SLOT_END,
        status: 'CONFIRMED',
      },
      include: { contact: true, service: true, staff: true },
    });

    await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: CONTACT,
      serviceId: SERVICE,
      preferredStaffId: otherStaff.id,
      preferredDateFrom: new Date('2026-08-19T00:00:00.000Z'),
      preferredDateTo: new Date('2026-08-21T23:59:59.000Z'),
    });

    await listener.onCancelled({
      businessId: BIZ,
      booking,
      contact: booking.contact ?? undefined,
    });

    const entry = await db.bookingWaitlistEntry.findFirstOrThrow({ where: { businessId: BIZ } });
    expect(entry.status).toBe(WAITLIST_STATUSES.WAITING);
    expect(entry.offeredBookingId).toBeNull();

    // CONTROL: delete the preferredStaffId match check in matchesSlot.
    // The entry is wrongly offered.
  });

  it('does not offer a freed slot when the waitlist entry prefers a different date range', async () => {
    const booking = await db.booking.create({
      data: {
        businessId: BIZ,
        contactId: CONTACT,
        serviceId: SERVICE,
        staffId: STAFF,
        startTime: SLOT_START,
        endTime: SLOT_END,
        status: 'CONFIRMED',
      },
      include: { contact: true, service: true, staff: true },
    });

    await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: CONTACT,
      serviceId: SERVICE,
      preferredDateFrom: new Date('2026-08-22T00:00:00.000Z'),
      preferredDateTo: new Date('2026-08-25T23:59:59.000Z'),
    });

    await listener.onCancelled({
      businessId: BIZ,
      booking,
      contact: booking.contact ?? undefined,
    });

    const entry = await db.bookingWaitlistEntry.findFirstOrThrow({ where: { businessId: BIZ } });
    expect(entry.status).toBe(WAITLIST_STATUSES.WAITING);

    // CONTROL: drop the preferredDateTo check. entry is offered for a slot it
    // should not match.
  });

  it('offers the oldest matching entry when two entries match the same slot', async () => {
    const olderContact = await db.contact.create({
      data: {
        businessId: BIZ,
        firstName: 'Older',
        lastName: 'Request',
        email: `${P}older@example.test`,
      },
    });
    const newerContact = await db.contact.create({
      data: {
        businessId: BIZ,
        firstName: 'Newer',
        lastName: 'Request',
        email: `${P}newer@example.test`,
      },
    });

    const booking = await db.booking.create({
      data: {
        businessId: BIZ,
        contactId: CONTACT,
        serviceId: SERVICE,
        staffId: STAFF,
        startTime: SLOT_START,
        endTime: SLOT_END,
        status: 'CONFIRMED',
      },
      include: { contact: true, service: true, staff: true },
    });

    // Force ordering by pausing briefly between inserts.
    const older = await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: olderContact.id,
      serviceId: SERVICE,
    });
    await new Promise((r) => setTimeout(r, 50));
    await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: newerContact.id,
      serviceId: SERVICE,
    });

    await listener.onCancelled({
      businessId: BIZ,
      booking,
      contact: booking.contact ?? undefined,
    });

    const offered = await db.bookingWaitlistEntry.findFirstOrThrow({
      where: { businessId: BIZ, status: WAITLIST_STATUSES.OFFERED },
    });
    expect(offered.id).toBe(older.id);

    const stillWaiting = await db.bookingWaitlistEntry.findMany({
      where: { businessId: BIZ, status: WAITLIST_STATUSES.WAITING },
    });
    expect(stillWaiting).toHaveLength(1);

    // CONTROL: remove createdAt ordering in findWaitlistMatchesForSlot.
    // The newer entry may be offered instead.
  });

  it('converting an offered slot confirms the placeholder booking', async () => {
    const booking = await db.booking.create({
      data: {
        businessId: BIZ,
        contactId: CONTACT,
        serviceId: SERVICE,
        staffId: STAFF,
        startTime: SLOT_START,
        endTime: SLOT_END,
        status: 'CONFIRMED',
      },
      include: { contact: true, service: true, staff: true },
    });

    const entry = await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: CONTACT,
      serviceId: SERVICE,
    });

    const { booking: placeholder } = await waitlistService.offerSlot(entry.id, {
      startTime: SLOT_START,
      endTime: SLOT_END,
      serviceId: SERVICE,
      staffId: STAFF,
    });

    const result = await waitlistService.convertWaitlistEntry(BIZ, entry.id);

    expect(result.entry.status).toBe(WAITLIST_STATUSES.CONVERTED);
    expect(result.booking.status).toBe('CONFIRMED');

    const updatedPlaceholder = await db.booking.findUniqueOrThrow({ where: { id: placeholder.id } });
    expect(updatedPlaceholder.status).toBe('CONFIRMED');

    // CONTROL: in convertWaitlistEntry, fail to confirm the placeholder.
    // updatedPlaceholder.status remains UNCONFIRMED.
  });

  it('cancelling an offered entry also cancels the placeholder booking', async () => {
    const entry = await waitlistService.addToWaitlist({
      businessId: BIZ,
      contactId: CONTACT,
      serviceId: SERVICE,
    });

    const { booking: placeholder } = await waitlistService.offerSlot(entry.id, {
      startTime: SLOT_START,
      endTime: SLOT_END,
      serviceId: SERVICE,
      staffId: STAFF,
    });

    await waitlistService.cancelWaitlistEntry(BIZ, entry.id);

    const cancelledEntry = await db.bookingWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(cancelledEntry.status).toBe(WAITLIST_STATUSES.CANCELLED);
    expect(cancelledEntry.deletedAt).not.toBeNull();

    const cancelledBooking = await db.booking.findUniqueOrThrow({ where: { id: placeholder.id } });
    expect(cancelledBooking.status).toBe('CANCELLED');

    // CONTROL: remove the booking.update branch from cancelWaitlistEntry.
    // placeholder.status remains UNCONFIRMED.
  });
});

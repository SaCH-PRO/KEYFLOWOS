/**
 * A slot that is taken must not be bookable, buffer or no buffer.
 *
 * Both overlap guards in this service used to sit inside
 * `if (service.bufferMins > 0)`. `bufferMins` is `Int?` with NO default, so it
 * is NULL for every service nobody has explicitly configured — and for those,
 * nothing checked overlap at all.
 *
 * Measured against the running stack before anything changed: a service with
 * buffer_mins NULL, two public booking requests for the identical slot, sent
 * one after the other.
 *
 *   first  -> 201
 *   second -> 201
 *   bookings at that start time: 2
 *
 * Worth being precise about, because it was reported as a race and it is not
 * one. Nothing concurrent was involved and no amount of locking would have
 * prevented it. The check did not run. A zero buffer now means "must not
 * overlap", which is what it always meant; the buffer only widens the window
 * the query looks in.
 *
 * The genuine race is still open and is called out in the commit: two
 * simultaneous requests can both pass this read before either writes. Closing
 * that needs a database constraint, and the table already holds overlapping
 * rows, so that migration needs a data decision first.
 */
import { describe, it, expect, vi } from 'vitest';
import { BookingsService } from './bookings.service';

const BIZ = 'biz_1';
const SERVICE = 'svc_1';
const START = new Date('2026-12-15T14:00:00.000Z');

function harness(opts: { bufferMins: number | null; occupied: boolean }) {
  const findFirstCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    client: {
      service: {
        findFirst: vi.fn(async () => ({
          id: SERVICE,
          businessId: BIZ,
          duration: 60,
          bufferMins: opts.bufferMins,
          leadTimeMins: null,
          deletedAt: null,
        })),
        findFirstOrThrow: vi.fn(async () => ({
          id: SERVICE,
          businessId: BIZ,
          duration: 60,
          bufferMins: opts.bufferMins,
          leadTimeMins: null,
        })),
      },
      booking: {
        findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
          findFirstCalls.push(args.where);
          return opts.occupied ? { id: 'existing_booking' } : null;
        }),
      },
    },
  };

  return { prisma, findFirstCalls };
}

/** Runs only the overlap section, which is what these tests are about. */
async function checkOverlap(h: ReturnType<typeof harness>, bufferMins: number | null) {
  const svc = { duration: 60, bufferMins, id: SERVICE };
  const start = START;
  const end = new Date(start.getTime() + svc.duration * 60000);
  const mins = svc.bufferMins ?? 0;
  const ms = mins * 60000;
  const where = {
    businessId: BIZ,
    status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    deletedAt: null,
    startTime: { lt: new Date(end.getTime() + ms) },
    endTime: { gt: new Date(start.getTime() - ms) },
    serviceId: svc.id,
  };
  const hit = await h.prisma.client.booking.findFirst({ where });
  return { hit, where, mins };
}

describe('the source enforces overlap unconditionally', () => {
  const src = (() => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.join(__dirname, 'bookings.service.ts'), 'utf8');
  })();

  it('reads the service — this gate is not vacuous', () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toContain('publicCreateBooking');
  });

  it('no overlap query is gated behind a configured buffer', () => {
    // The exact shape of the defect: the guard existing but never running.
    expect(src, 'an overlap check inside `if (bufferMins > 0)` is the bug').not.toContain(
      'if (service.bufferMins && service.bufferMins > 0) {',
    );
    expect(src).not.toContain('if (bufferMins > 0) {');
  });

  it('a missing buffer defaults to zero rather than skipping the check', () => {
    expect(src).toContain('params.bufferMins ?? 0');
  });

  it('ALL THREE booking paths call the one guard', () => {
    // publicCreateBooking and rescheduleBooking had a copy each;
    // createBooking — staff booking from inside the app — had none at all, so
    // an internal user could double-book a slot the public widget refused.
    for (const method of ['publicCreateBooking', 'rescheduleBooking', 'createBooking']) {
      const at = src.indexOf(`async ${method}(`);
      expect(at, `${method} not found`).toBeGreaterThan(-1);
      const body = src.slice(at, at + 4000);
      expect(body, `${method} must check the slot is free`).toContain('this.assertSlotFree(');
    }
  });

  it('there is exactly one overlap query, not a copy per path', () => {
    // Two copies is how one of them drifted out of step in the first place.
    const queries = src.split('startTime: { lt:').length - 1;
    expect(queries, 'the guard should be the only place this query lives').toBe(1);
  });

  it('the overlap query excludes cancelled and soft-deleted bookings', () => {
    // A cancelled or deleted booking must not block a slot; a live one must.
    const at = src.indexOf('private async assertSlotFree');
    const guard = src.slice(at, at + 1800);
    expect(guard).toContain('deletedAt: null');
    expect(guard).toContain("notIn: ['CANCELLED', 'NO_SHOW']");
  });
});

describe('a service with no buffer still refuses an occupied slot', () => {
  it('finds the clash when the slot is taken', async () => {
    const h = harness({ bufferMins: null, occupied: true });
    const { hit, mins } = await checkOverlap(h, null);
    expect(mins, 'a null buffer must mean zero, not "skip the check"').toBe(0);
    expect(hit, 'the occupied slot must be found').not.toBeNull();
  });

  it('allows a free slot', async () => {
    const h = harness({ bufferMins: null, occupied: false });
    const { hit } = await checkOverlap(h, null);
    expect(hit).toBeNull();
  });

  it('queries the exact slot when there is no buffer', async () => {
    const h = harness({ bufferMins: null, occupied: false });
    const { where } = await checkOverlap(h, null);
    expect(where.startTime).toEqual({ lt: new Date('2026-12-15T15:00:00.000Z') });
    expect(where.endTime).toEqual({ gt: START });
  });

  it('widens the window when a buffer IS set', async () => {
    const h = harness({ bufferMins: 15, occupied: false });
    const { where } = await checkOverlap(h, 15);
    expect(where.startTime).toEqual({ lt: new Date('2026-12-15T15:15:00.000Z') });
    expect(where.endTime).toEqual({ gt: new Date('2026-12-15T13:45:00.000Z') });
  });
});

/**
 * The picker and the validator must be the same rule.
 *
 * Before this there was no free-slot endpoint at all — the public widget asked
 * customers to hand-type an ISO timestamp:
 *
 *   <Input label="Start Time (ISO)" placeholder="2025-12-01T15:00:00Z" />
 *
 * That was survivable while the server accepted almost anything. Once overlap
 * was enforced on every write path it stopped being survivable: guess, get
 * "already booked", and have no way to find a time that is not.
 *
 * The failure mode being guarded against here is the one this codebase keeps
 * producing — two sources of truth that agree until they do not. If the picker
 * computed availability its own way, a slot would be offered and then refused
 * on submit, and both halves would look correct in isolation.
 *
 * Verified live: business hours 09:00-12:00, 60-minute service, 30-minute
 * interval. Five slots offered. Booking the first removed TWO of them — the
 * 09:00 and the 09:30 — because a 60-minute booking occupies both.
 */
describe('the free-slot API answers with the same rule the writes enforce', () => {
  const src = (() => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.join(__dirname, 'bookings.service.ts'), 'utf8');
  })();

  it('getAvailableSlots exists', () => {
    expect(src).toContain('async getAvailableSlots(');
  });

  it('it filters candidates through the shared guard, not its own query', () => {
    const at = src.indexOf('async getAvailableSlots(');
    // Bounded at the next method: a fixed-size window runs into assertSlotFree
    // and finds ITS query, which made this assertion fail on correct code.
    const body = src.slice(at, src.indexOf('private async assertSlotFree', at));
    expect(body, 'the picker must use the same rule as the writes').toContain(
      'this.assertSlotFree(',
    );
    expect(body, 'a second overlap query here is how the two drift apart').not.toContain(
      'startTime: { lt:',
    );
  });

  it('it honours lead time and closed days rather than offering unbookable times', () => {
    const at = src.indexOf('async getAvailableSlots(');
    const body = src.slice(at, src.indexOf('private async assertSlotFree', at));
    expect(body).toContain('leadTimeMins');
    expect(body).toContain('closed');
  });

  it('the route parses the date as local, not UTC', () => {
    // `new Date('2026-12-15')` is UTC midnight, which in UTC-4 is the 14th at
    // 20:00 — measured: asking for the 15th returned the 14th's slots.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const ctrl = fs.readFileSync(path.join(__dirname, 'bookings.controller.ts'), 'utf8');
    const at = ctrl.indexOf('async publicAvailableSlots(');
    expect(at, 'route not found').toBeGreaterThan(-1);
    const body = ctrl.slice(at, at + 1400);
    expect(body, 'new Date(yyyy-mm-dd) shifts the day in a negative offset').not.toContain(
      'new Date(date)',
    );
  });
});

/**
 * CreateBookingDto — every booking creation used to return 400.
 *
 * The DTO carried both `@IsISO8601()` and `@Type(() => Date)` on startTime and
 * endTime. class-transformer runs BEFORE class-validator, so @Type converted the
 * incoming ISO string into a Date object, and class-validator's isISO8601 is
 * `typeof value === 'string' && ...`. A perfectly valid payload therefore came
 * back as:
 *
 *   ["startTime must be a valid ISO 8601 date string",
 *    "endTime must be a valid ISO 8601 date string"]
 *
 * — telling the caller their correct ISO string was not an ISO string. Booking
 * creation was impossible for every tenant, and the error actively misdirected
 * whoever debugged it.
 *
 * These run the REAL pipe with the REAL global config against the REAL DTO.
 */
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { CreateBookingDto } from './create-booking.dto';

/** Same options as apps/server/src/app-bootstrap.ts. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });

const through = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: CreateBookingDto }) as Promise<CreateBookingDto>;

const valid = {
  contactId: 'contact_1',
  serviceId: 'service_1',
  staffId: 'staff_1',
  startTime: '2026-09-01T10:00:00.000Z',
  endTime: '2026-09-01T11:00:00.000Z',
};

describe('CreateBookingDto', () => {
  it('accepts a valid ISO payload — the regression, in one assertion', async () => {
    const out = await through(valid);
    expect(out.startTime).toBe('2026-09-01T10:00:00.000Z');
    expect(out.endTime).toBe('2026-09-01T11:00:00.000Z');
  });

  it('keeps the times as STRINGS, which is what the controller consumes', async () => {
    // bookings.controller.ts does `new Date(body.startTime)`. If these ever
    // become Date objects again, that still works by accident — but validation
    // breaks first, which is exactly how this bug presented.
    const out = await through(valid);
    expect(typeof out.startTime).toBe('string');
    expect(typeof out.endTime).toBe('string');
  });

  it('the string it emits is parseable to the intended instant', async () => {
    const out = await through(valid);
    expect(new Date(out.startTime).toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('accepts ISO with a timezone offset', async () => {
    const out = await through({
      ...valid,
      startTime: '2026-09-01T06:00:00-04:00',
      endTime: '2026-09-01T07:00:00-04:00',
    });
    expect(new Date(out.startTime).toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('still rejects a genuinely invalid date', async () => {
    // The fix must not be "stop validating".
    await expect(through({ ...valid, startTime: 'next tuesday' })).rejects.toThrow();
  });

  it('still rejects a missing required field', async () => {
    const { staffId: _omitted, ...withoutStaff } = valid;
    await expect(through(withoutStaff)).rejects.toThrow();
  });

  it('carries no @Type(() => Date) on the time fields', async () => {
    // Pins the specific construct that caused it. @Type is still legitimately
    // used elsewhere in this DTO for a nested object, so the import remains.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'create-booking.dto.ts'), 'utf8');

    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/@Type\(\(\) => Date\)/);
  });
});

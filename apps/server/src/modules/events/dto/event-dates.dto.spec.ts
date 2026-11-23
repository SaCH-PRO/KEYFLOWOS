/**
 * Event and ticket-type dates through the real global ValidationPipe
 * (FU-VITEST-DECORATOR-METADATA, triage class (b)).
 *
 * CreateEventDto.startsAt/endsAt and CreateTicketTypeDto.salesStartAt/salesEndAt
 * carried both `@IsISO8601()` and `@Type(() => Date)`. class-transformer runs
 * BEFORE class-validator, so @Type turned the ISO string into a Date and
 * isISO8601 (`typeof value === 'string' && ...`) refused it: in production
 * every POST .../events with a valid startsAt was 400 "startsAt must be a valid
 * ISO 8601 date string". The same defect CreateBookingDto had
 * (create-booking.dto.spec.ts). No HTTP suite saw it, because under esbuild the
 * pipe never validated (census-hidden CH-RW EventsController is the suite that
 * did once it did).
 *
 * The services compare and store these fields as Dates, so the DTOs keep
 * handing them Dates; what must hold is that only an ISO 8601 string becomes
 * one, as before, and anything else is still refused.
 */
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { CreateEventDto } from './create-event.dto';
import { UpdateEventDto } from './update-event.dto';
import { CreateTicketTypeDto } from './create-ticket-type.dto';
import { UpdateTicketTypeDto } from './update-ticket-type.dto';

/** Same options as apps/server/src/app-bootstrap.ts. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const through = (metatype: any, body: unknown) => pipe.transform(body, { type: 'body', metatype });
const refusal = async (metatype: any, body: unknown) => {
  try {
    await through(metatype, body);
  } catch (err: any) {
    return { status: err.getStatus?.(), messages: (err.getResponse?.()?.message ?? []) as string[] };
  }
  return null;
};

const START = '2026-12-01T10:00:00.000Z';
const END = '2026-12-01T12:00:00.000Z';
const NOT_ISO = ['next tuesday', '12/01/2026', '2026-13-45T10:00:00Z', '', 1764583200000, true, { at: START }];

describe('CreateEventDto dates', () => {
  it('accepts a valid ISO startsAt and endsAt and hands the service Dates for those instants', async () => {
    const out: any = await through(CreateEventDto, { name: 'Launch', startsAt: START, endsAt: END });
    expect(out.startsAt).toBeInstanceOf(Date);
    expect(out.startsAt.toISOString()).toBe(START);
    expect(out.endsAt).toBeInstanceOf(Date);
    expect(out.endsAt.toISOString()).toBe(END);
  });

  it('accepts an ISO startsAt with a timezone offset', async () => {
    const out: any = await through(CreateEventDto, { name: 'Launch', startsAt: '2026-12-01T06:00:00-04:00' });
    expect(out.startsAt.toISOString()).toBe(START);
  });

  it.each(NOT_ISO)('refuses startsAt %j with 400 naming startsAt', async (value) => {
    const r = await refusal(CreateEventDto, { name: 'Launch', startsAt: value });
    expect(r?.status).toBe(400);
    expect(r?.messages.join(' ')).toContain('startsAt');
  });

  it('still requires startsAt', async () => {
    const r = await refusal(CreateEventDto, { name: 'Launch' });
    expect(r?.status).toBe(400);
    expect(r?.messages.join(' ')).toContain('startsAt');
  });

  it.each(NOT_ISO)('refuses endsAt %j with 400 naming endsAt', async (value) => {
    const r = await refusal(CreateEventDto, { name: 'Launch', startsAt: START, endsAt: value });
    expect(r?.status).toBe(400);
    expect(r?.messages.join(' ')).toContain('endsAt');
  });
});

describe('UpdateEventDto dates', () => {
  it('accepts a valid ISO startsAt alone', async () => {
    const out: any = await through(UpdateEventDto, { startsAt: START });
    expect(out.startsAt).toBeInstanceOf(Date);
    expect(out.startsAt.toISOString()).toBe(START);
  });

  it('refuses a non-ISO startsAt with 400', async () => {
    expect((await refusal(UpdateEventDto, { startsAt: 'next tuesday' }))?.status).toBe(400);
  });
});

describe('CreateTicketTypeDto / UpdateTicketTypeDto sale window', () => {
  it('accepts valid ISO salesStartAt and salesEndAt as Dates', async () => {
    const out: any = await through(CreateTicketTypeDto, { name: 'GA', price: 10, salesStartAt: START, salesEndAt: END });
    expect(out.salesStartAt).toBeInstanceOf(Date);
    expect(out.salesStartAt.toISOString()).toBe(START);
    expect(out.salesEndAt.toISOString()).toBe(END);
  });

  it('accepts an update naming only salesEndAt', async () => {
    const out: any = await through(UpdateTicketTypeDto, { salesEndAt: END });
    expect(out.salesEndAt.toISOString()).toBe(END);
  });

  it.each(NOT_ISO)('refuses salesStartAt %j with 400 naming salesStartAt', async (value) => {
    const r = await refusal(CreateTicketTypeDto, { name: 'GA', price: 10, salesStartAt: value });
    expect(r?.status).toBe(400);
    expect(r?.messages.join(' ')).toContain('salesStartAt');
  });

  it.each(NOT_ISO)('refuses salesEndAt %j on update with 400', async (value) => {
    expect((await refusal(UpdateTicketTypeDto, { salesEndAt: value }))?.status).toBe(400);
  });
});

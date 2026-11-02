/**
 * V1-50-QUOTE-STATE-MACHINE — the quote transition table (pure).
 *
 * M21 / CF-15 (state-machine half). At its base any quote status could be set
 * from any other: PATCH /commerce/quotes/:id/status/draft on an ACCEPTED quote
 * answered 200, a REJECTED quote could be accepted, a quote already converted
 * to an invoice could be moved anywhere, and an enum value no caller may ask
 * for (`/status/converted`) was written as given. quote-workflow.ts is the one
 * table every quote status writer in CommerceService consults (the status
 * route, the send-email move, the public accept/reject and bulkUpdateQuotes).
 *
 * The table pinned here, cell by cell:
 *
 *   DRAFT    -> SENT, ACCEPTED, REJECTED   (ACCEPTED/REJECTED: the operator records a decision made outside the link)
 *   SENT     -> ACCEPTED, REJECTED
 *   VIEWED   -> ACCEPTED, REJECTED         (legacy spelling of a viewed SENT quote; no writer sets it today)
 *   ACCEPTED, REJECTED, EXPIRED            -> nothing (a decision is final; a new quote is a new row)
 *   INVOICED, PAID, CONVERTED, or any row with invoiceId -> nothing, even its own status (converted)
 *   same status (not converted)            -> a no-op: nothing is written, re-minted or emitted
 */
import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  QUOTE_STATUS_TARGETS,
  assertQuoteStatusAgreement,
  assertQuoteTransition,
  canTransitionQuote,
  decideQuoteTransition,
  isConvertedQuote,
  mintQuoteViewToken,
  parseQuoteStatusTarget,
  requireQuoteStatusTarget,
  type QuoteStatus,
  type QuoteStatusTarget,
} from './quote-workflow';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';

/** Every value of the QuoteStatus enum in packages/db/prisma/schema.prisma. */
const ALL_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'VIEWED', 'EXPIRED', 'INVOICED', 'PAID', 'CONVERTED'];
const TARGETS: QuoteStatusTarget[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'];

/** The expected table, written out independently of the implementation. */
const EXPECTED_MOVES: Record<QuoteStatus, QuoteStatusTarget[]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
  SENT: ['ACCEPTED', 'REJECTED'],
  VIEWED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  INVOICED: [],
  PAID: [],
  CONVERTED: [],
};
const CONVERTED_STATUSES: QuoteStatus[] = ['INVOICED', 'PAID', 'CONVERTED'];

function conflictBody(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    return (err as ConflictException).getResponse() as Record<string, unknown>;
  }
  throw new Error('expected a ConflictException');
}

function badRequestBody(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
    return (err as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error('expected a BadRequestException');
}

describe('quote transition table (V1-50)', () => {
  it('QW-01: the targets a caller may ask for are DRAFT, SENT, ACCEPTED and REJECTED, nothing else', () => {
    expect([...QUOTE_STATUS_TARGETS]).toEqual(TARGETS);
  });

  it('QW-02: every (status, target) cell matches the written table: a move only where listed, a no-op on the same status, a refusal everywhere else', () => {
    for (const from of ALL_STATUSES) {
      for (const to of TARGETS) {
        const decision = decideQuoteTransition({ status: from, invoiceId: null }, to);
        const converted = CONVERTED_STATUSES.includes(from);
        let expected: string;
        if (converted) expected = 'refuse:converted';
        else if (from === to) expected = 'noop';
        else if (EXPECTED_MOVES[from].includes(to)) expected = 'move';
        else expected = 'refuse:not_allowed';
        const got = decision.kind === 'refuse' ? `refuse:${decision.reason}` : decision.kind;
        expect(got, `${from} -> ${to}`).toBe(expected);
        expect(canTransitionQuote(from, to), `canTransitionQuote(${from}, ${to})`).toBe(EXPECTED_MOVES[from].includes(to));
      }
    }
  });

  it('QW-03: the packet\'s named illegal moves are refused: ACCEPTED->DRAFT, REJECTED->ACCEPTED, and a decided quote cannot be re-opened or re-sent', () => {
    for (const [from, to] of [
      ['ACCEPTED', 'DRAFT'],
      ['REJECTED', 'ACCEPTED'],
      ['ACCEPTED', 'REJECTED'],
      ['ACCEPTED', 'SENT'],
      ['REJECTED', 'DRAFT'],
      ['REJECTED', 'SENT'],
      ['SENT', 'DRAFT'],
    ] as Array<[QuoteStatus, QuoteStatusTarget]>) {
      expect(decideQuoteTransition({ status: from }, to), `${from} -> ${to}`).toEqual({ kind: 'refuse', reason: 'not_allowed' });
    }
  });

  it('QW-04: a converted quote (invoiceId set, whatever its status) refuses every target, its own status included', () => {
    for (const status of ALL_STATUSES) {
      expect(isConvertedQuote({ status, invoiceId: 'inv_1' }), status).toBe(true);
      for (const to of TARGETS) {
        expect(decideQuoteTransition({ status, invoiceId: 'inv_1' }, to), `${status}+invoice -> ${to}`).toEqual({ kind: 'refuse', reason: 'converted' });
      }
    }
    expect(isConvertedQuote({ status: 'ACCEPTED', invoiceId: null })).toBe(false);
    expect(isConvertedQuote({ status: 'ACCEPTED' })).toBe(false);
    for (const status of CONVERTED_STATUSES) expect(isConvertedQuote({ status }), status).toBe(true);
  });

  it('QW-05: an unknown stored status (not in the enum) moves nowhere', () => {
    for (const to of TARGETS) {
      expect(decideQuoteTransition({ status: 'SOMETHING_ELSE' }, to), to).toEqual({ kind: 'refuse', reason: 'not_allowed' });
      expect(canTransitionQuote('SOMETHING_ELSE', to)).toBe(false);
    }
  });
});

describe('assertQuoteTransition: the 409 the status route and the public routes answer (V1-50)', () => {
  it('QW-06: a legal move returns "move" and a same-status request returns "noop", without throwing', () => {
    expect(assertQuoteTransition({ status: 'DRAFT', invoiceId: null }, 'SENT')).toBe('move');
    expect(assertQuoteTransition({ status: 'SENT', invoiceId: null }, 'ACCEPTED')).toBe('move');
    expect(assertQuoteTransition({ status: 'SENT', invoiceId: null }, 'SENT')).toBe('noop');
    expect(assertQuoteTransition({ status: 'ACCEPTED', invoiceId: null }, 'ACCEPTED')).toBe('noop');
  });

  it('QW-07: an illegal move is a 409 quote_transition_not_allowed that names both statuses', () => {
    const body = conflictBody(() => assertQuoteTransition({ status: 'ACCEPTED', invoiceId: null }, 'DRAFT'));
    expect(body).toMatchObject({ code: 'quote_transition_not_allowed', quoteStatus: 'ACCEPTED', requestedStatus: 'DRAFT' });
    expect(String(body.message)).toMatch(/ACCEPTED/);
    expect(String(body.message)).toMatch(/DRAFT/);
  });

  it('QW-08: any move on a converted quote is a 409 quote_converted', () => {
    for (const to of TARGETS) {
      const body = conflictBody(() => assertQuoteTransition({ status: 'ACCEPTED', invoiceId: 'inv_1' }, to));
      expect(body, to).toMatchObject({ code: 'quote_converted', quoteStatus: 'ACCEPTED', requestedStatus: to });
    }
  });
});

describe('requested status parsing: the path segment and the body field (V1-50)', () => {
  it('QW-09: the four targets parse in any case; every other value (other enum values included) is not a target', () => {
    expect(parseQuoteStatusTarget('sent')).toBe('SENT');
    expect(parseQuoteStatusTarget('Accepted')).toBe('ACCEPTED');
    expect(parseQuoteStatusTarget('REJECTED')).toBe('REJECTED');
    expect(parseQuoteStatusTarget('draft')).toBe('DRAFT');
    for (const raw of ['converted', 'CONVERTED', 'paid', 'invoiced', 'expired', 'viewed', 'bogus', '', ' sent', null, undefined, 42, {}, ['sent']]) {
      expect(parseQuoteStatusTarget(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('QW-10: requireQuoteStatusTarget answers 400 quote_status_unknown for a non-target, so /status/converted can no longer write CONVERTED', () => {
    expect(requireQuoteStatusTarget('sent')).toBe('SENT');
    for (const raw of ['converted', 'paid', 'bogus', '']) {
      const body = badRequestBody(() => requireQuoteStatusTarget(raw));
      expect(body, raw).toMatchObject({ code: 'quote_status_unknown' });
      expect(String(body.message)).toMatch(/DRAFT, SENT, ACCEPTED, REJECTED/);
    }
  });

  it('QW-11: a body status that agrees with the path (any case) or is absent passes; one that disagrees or is not a target is a 400 quote_status_mismatch', () => {
    expect(() => assertQuoteStatusAgreement('sent', undefined)).not.toThrow();
    expect(() => assertQuoteStatusAgreement('sent', null)).not.toThrow();
    expect(() => assertQuoteStatusAgreement('sent', 'SENT')).not.toThrow();
    expect(() => assertQuoteStatusAgreement('ACCEPTED', 'accepted')).not.toThrow();
    for (const body of ['DRAFT', 'accepted', 'converted', 42, '']) {
      const res = badRequestBody(() => assertQuoteStatusAgreement('sent', body));
      expect(res, JSON.stringify(body)).toMatchObject({ code: 'quote_status_mismatch', pathStatus: 'SENT' });
    }
  });

  it('QW-12: UpdateQuoteStatusDto accepts exactly the targets the table knows', () => {
    for (const status of TARGETS) {
      expect(validateSync(plainToInstance(UpdateQuoteStatusDto, { status })), status).toHaveLength(0);
    }
    for (const status of ['CONVERTED', 'PAID', 'INVOICED', 'EXPIRED', 'VIEWED', 'sent']) {
      expect(validateSync(plainToInstance(UpdateQuoteStatusDto, { status })).length, status).toBeGreaterThan(0);
    }
  });
});

describe('the one view-token mint (V1-50)', () => {
  it('QW-13: mintQuoteViewToken returns 24 random bytes as base64url (32 characters), different on every call', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const token = mintQuoteViewToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(50);
  });
});

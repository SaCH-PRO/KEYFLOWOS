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
  QUOTE_BULK_ACTIONS,
  QUOTE_STATUS_TARGETS,
  assertQuoteStatusAgreement,
  assertQuoteTransition,
  canTransitionQuote,
  decideQuoteBulkMove,
  decideQuoteTransition,
  isConvertedQuote,
  mintQuoteViewToken,
  needsViewTokenRepair,
  parseQuoteStatusTarget,
  quoteBulkRefusalCode,
  quoteBulkTarget,
  requireQuoteBulkRequest,
  requireQuoteStatusTarget,
  type QuoteStatus,
  type QuoteStatusTarget,
} from './quote-workflow';
import * as workflow from './quote-workflow';
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

describe('the bulk route body and its sources (V1-50 review SEC-V50-1, SEC-V50-2, CR-V150-1, CR-V150-3)', () => {
  it('QW-14: requireQuoteBulkRequest answers 400 quote_bulk_action_unknown for any action that is not send, reject or delete (a missing one included), so nothing falls through to reject', () => {
    expect([...QUOTE_BULK_ACTIONS]).toEqual(['send', 'reject', 'delete']);
    for (const action of [undefined, null, '', 'accept', 'Reject', 'REJECT', 'sent', 'void', 1, ['reject'], { reject: true }]) {
      const body = badRequestBody(() => requireQuoteBulkRequest(['q1'], action));
      expect(body.code, JSON.stringify(action)).toBe('quote_bulk_action_unknown');
    }
    // An unknown action is refused even when ids are missing too: nothing about the request is acted on.
    expect(badRequestBody(() => requireQuoteBulkRequest(undefined, 'accept')).code).toBe('quote_bulk_action_unknown');
  });

  it('QW-15: requireQuoteBulkRequest answers 400 quote_bulk_ids_required unless ids is a non-empty array of non-empty strings (Prisma drops `in: undefined`, which reached the whole tenant)', () => {
    for (const ids of [undefined, null, [], 'q1', { in: ['q1'] }, [''], ['q1', 2], [null], [{ not: 'x' }]]) {
      for (const action of QUOTE_BULK_ACTIONS) {
        const body = badRequestBody(() => requireQuoteBulkRequest(ids, action));
        expect(body.code, `${JSON.stringify(ids)} / ${action}`).toBe('quote_bulk_ids_required');
      }
    }
    expect(requireQuoteBulkRequest(['q1', 'q2'], 'reject')).toEqual({ ids: ['q1', 'q2'], action: 'reject' });
    expect(requireQuoteBulkRequest(['q1'], 'send')).toEqual({ ids: ['q1'], action: 'send' });
    expect(requireQuoteBulkRequest(['q1'], 'delete')).toEqual({ ids: ['q1'], action: 'delete' });
  });

  it("QW-16: bulk send moves only a DRAFT; bulk reject moves only a quote whose link is out (SENT, VIEWED) and lists a DRAFT as quote_bulk_not_eligible; every other cell is the table's decision", () => {
    expect(quoteBulkTarget('send')).toBe('SENT');
    expect(quoteBulkTarget('reject')).toBe('REJECTED');
    const expected: Record<'send' | 'reject', Record<QuoteStatus, string>> = {
      send: {
        DRAFT: 'move',
        SENT: 'noop',
        VIEWED: 'refuse:not_allowed',
        ACCEPTED: 'refuse:not_allowed',
        REJECTED: 'refuse:not_allowed',
        EXPIRED: 'refuse:not_allowed',
        INVOICED: 'refuse:converted',
        PAID: 'refuse:converted',
        CONVERTED: 'refuse:converted',
      },
      reject: {
        DRAFT: 'refuse:bulk_not_eligible',
        SENT: 'move',
        VIEWED: 'move',
        ACCEPTED: 'refuse:not_allowed',
        REJECTED: 'noop',
        EXPIRED: 'refuse:not_allowed',
        INVOICED: 'refuse:converted',
        PAID: 'refuse:converted',
        CONVERTED: 'refuse:converted',
      },
    };
    for (const action of ['send', 'reject'] as const) {
      for (const status of ALL_STATUSES) {
        const d = decideQuoteBulkMove({ status, invoiceId: null }, action);
        expect(d.kind === 'refuse' ? `refuse:${d.reason}` : d.kind, `${action} on ${status}`).toBe(expected[action][status]);
        // A converted row refuses whatever its status.
        expect(decideQuoteBulkMove({ status, invoiceId: 'inv_1' }, action), `${action} on converted ${status}`).toEqual({ kind: 'refuse', reason: 'converted' });
        // Every bulk move is one the table allows.
        if (d.kind === 'move') expect(canTransitionQuote(status, quoteBulkTarget(action)), `${action} on ${status}`).toBe(true);
      }
    }
    expect(quoteBulkRefusalCode('converted')).toBe('quote_converted');
    expect(quoteBulkRefusalCode('not_allowed')).toBe('quote_transition_not_allowed');
    expect(quoteBulkRefusalCode('bulk_not_eligible')).toBe('quote_bulk_not_eligible');
  });
});

describe('the view-token repair of a SENT quote without one (V1-50 review CR-V150-2)', () => {
  it('QW-17: needsViewTokenRepair is true only for an unconverted SENT quote with no token', () => {
    expect(needsViewTokenRepair({ status: 'SENT', viewToken: null, invoiceId: null })).toBe(true);
    expect(needsViewTokenRepair({ status: 'SENT', viewToken: undefined })).toBe(true);
    expect(needsViewTokenRepair({ status: 'SENT', viewToken: 'tok' })).toBe(false);
    expect(needsViewTokenRepair({ status: 'SENT', viewToken: null, invoiceId: 'inv_1' })).toBe(false);
    for (const status of ALL_STATUSES.filter((s) => s !== 'SENT')) {
      expect(needsViewTokenRepair({ status, viewToken: null }), status).toBe(false);
    }
  });
});

describe('the terms version a public accept carries (V1-QUOTE-CHAIN-finish, review SEC-5)', () => {
  // Read through the module namespace so a missing export fails these cases, not the file.
  const termsVersion = (quote: Record<string, unknown>): string =>
    (workflow as unknown as { quoteTermsVersion: (q: Record<string, unknown>) => string }).quoteTermsVersion(quote);
  const base = {
    subtotal: 100,
    taxRate: 12.5,
    taxAmount: 12.5,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    total: 112.5,
    currency: 'TTD',
    notes: 'Net 30',
    expiryDate: new Date('2026-12-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    items: [
      { id: 'i1', description: 'Labour', quantity: 1, unitPrice: 60, total: 60, productId: null },
      { id: 'i2', description: 'Parts', quantity: 2, unitPrice: 20, total: 40, productId: 'p1' },
    ],
  };

  it('QW-18: the version is a stable url-safe string; the line order, line ids, expiry and updatedAt do not change it', () => {
    const v = termsVersion(base);
    expect(v).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(termsVersion({ ...base })).toBe(v);
    expect(termsVersion({ ...base, items: [...base.items].reverse() })).toBe(v);
    expect(termsVersion({ ...base, items: base.items.map((i) => ({ ...i, id: `x_${i.id}` })) })).toBe(v);
    expect(termsVersion({ ...base, expiryDate: null, updatedAt: new Date() })).toBe(v);
  });

  it('QW-19: any change to what the customer agrees to changes it: a price, a quantity, a line text, a product, a line added or removed, tax, discount, total, currency or notes', () => {
    const v = termsVersion(base);
    const variants: Array<[string, Record<string, unknown>]> = [
      ['unit price', { ...base, items: [{ ...base.items[0], unitPrice: 61 }, base.items[1]] }],
      ['quantity', { ...base, items: [base.items[0], { ...base.items[1], quantity: 3 }] }],
      ['line text', { ...base, items: [{ ...base.items[0], description: 'Labour (rush)' }, base.items[1]] }],
      ['product', { ...base, items: [base.items[0], { ...base.items[1], productId: 'p2' }] }],
      ['line removed', { ...base, items: [base.items[0]] }],
      ['line added', { ...base, items: [...base.items, { id: 'i3', description: 'Extra', quantity: 1, unitPrice: 0, total: 0, productId: null }] }],
      ['tax rate', { ...base, taxRate: 15 }],
      ['discount', { ...base, discountType: 'FIXED', discountValue: 5, discountAmount: 5 }],
      ['total', { ...base, total: 1350 }],
      ['currency', { ...base, currency: 'USD' }],
      ['notes', { ...base, notes: 'Net 60' }],
    ];
    for (const [label, variant] of variants) expect(termsVersion(variant), label).not.toBe(v);
  });

  it('QW-20: a row without lines or optional amounts (a legacy row, a mocked read) still has one version, and null and undefined read alike', () => {
    const bare = { total: 100, currency: 'TTD' };
    expect(termsVersion(bare)).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(termsVersion({ ...bare, items: [], notes: null, taxRate: undefined })).toBe(termsVersion(bare));
  });
});

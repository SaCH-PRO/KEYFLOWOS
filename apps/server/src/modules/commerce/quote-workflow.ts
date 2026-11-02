import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * V1-50-QUOTE-STATE-MACHINE (M21, CF-15 state-machine half): the one quote
 * transition table. Before it, CommerceService wrote whatever status a caller
 * named: PATCH /commerce/quotes/:id/status/draft re-opened an ACCEPTED quote,
 * a REJECTED quote could be accepted, a quote already converted to an invoice
 * moved anywhere, and `/status/converted` wrote that enum value as given.
 * bulkUpdateQuotes kept a second, different set of rules.
 *
 * Every quote status writer in CommerceService now asks this module first:
 * the status route and the send-email move (updateQuoteStatus), the public
 * accept/reject (which then calls updateQuoteStatus) and bulkUpdateQuotes.
 * Writers outside CommerceService that still set Quote.status directly are not
 * covered here (commerce-ai.service.ts convert_quote/send_quote).
 */

/** Every value of the QuoteStatus enum (packages/db/prisma/schema.prisma). */
export type QuoteStatus =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'VIEWED'
  | 'EXPIRED'
  | 'INVOICED'
  | 'PAID'
  | 'CONVERTED';

/**
 * The statuses a caller may ask for. The other enum values are never a
 * request: VIEWED is a viewedAt stamp, EXPIRED is computed from expiryDate,
 * and conversion is its own route (convertQuoteToInvoice).
 */
export const QUOTE_STATUS_TARGETS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'] as const;
export type QuoteStatusTarget = (typeof QUOTE_STATUS_TARGETS)[number];

/**
 * Allowed moves, from the stored status to the requested one.
 *
 * - DRAFT can be sent, or carry a decision the operator records from outside
 *   the signed link (an acceptance or a refusal given in person). R0-CMF4's
 *   "operator rejects while the email is with Gmail" relies on DRAFT->REJECTED.
 * - SENT (and VIEWED, a legacy spelling of a viewed SENT quote that no writer
 *   sets today) can be accepted or rejected. It cannot go back to DRAFT: its
 *   link is already out, and the quote stays editable while SENT.
 * - A decision is final (ACCEPTED, REJECTED), and so is EXPIRED: a changed
 *   offer is a new quote.
 * - INVOICED, PAID and CONVERTED, like any row with an invoiceId, are
 *   converted (see isConvertedQuote) and refuse every request.
 */
const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, ReadonlySet<QuoteStatusTarget>>> = {
  DRAFT: new Set<QuoteStatusTarget>(['SENT', 'ACCEPTED', 'REJECTED']),
  SENT: new Set<QuoteStatusTarget>(['ACCEPTED', 'REJECTED']),
  VIEWED: new Set<QuoteStatusTarget>(['ACCEPTED', 'REJECTED']),
  ACCEPTED: new Set<QuoteStatusTarget>([]),
  REJECTED: new Set<QuoteStatusTarget>([]),
  EXPIRED: new Set<QuoteStatusTarget>([]),
  INVOICED: new Set<QuoteStatusTarget>([]),
  PAID: new Set<QuoteStatusTarget>([]),
  CONVERTED: new Set<QuoteStatusTarget>([]),
};

const CONVERTED_STATUSES: ReadonlySet<string> = new Set(['INVOICED', 'PAID', 'CONVERTED']);

/** The fields of a stored quote the table reads. */
export interface QuoteTransitionSubject {
  status: string;
  invoiceId?: string | null;
}

/**
 * A quote converted to an invoice: convertQuoteToInvoice links the invoice and
 * leaves the status ACCEPTED, so the link is what marks it. Its status can no
 * longer change, its own status included.
 */
export function isConvertedQuote(quote: QuoteTransitionSubject): boolean {
  return !!quote.invoiceId || CONVERTED_STATUSES.has(quote.status);
}

/** True when the table lists `to` as a move from `from` (a same-status request is not a move). */
export function canTransitionQuote(from: string, to: QuoteStatusTarget): boolean {
  const allowed = (QUOTE_TRANSITIONS as Record<string, ReadonlySet<QuoteStatusTarget> | undefined>)[from];
  return !!allowed && allowed.has(to);
}

export type QuoteTransitionDecision =
  | { kind: 'move' }
  | { kind: 'noop' }
  | { kind: 'refuse'; reason: 'converted' | 'not_allowed' };

/**
 * What a request for `target` does to `quote`: a move the table allows, a
 * no-op when the quote already has that status (nothing is written, no token
 * is minted, nothing is emitted), or a refusal.
 */
export function decideQuoteTransition(quote: QuoteTransitionSubject, target: QuoteStatusTarget): QuoteTransitionDecision {
  if (isConvertedQuote(quote)) return { kind: 'refuse', reason: 'converted' };
  if (quote.status === target) return { kind: 'noop' };
  return canTransitionQuote(quote.status, target) ? { kind: 'move' } : { kind: 'refuse', reason: 'not_allowed' };
}

/** The 409 a refused request answers. `quoteStatus` and `requestedStatus` reach the client under `details`. */
export function quoteTransitionRefusal(
  quote: QuoteTransitionSubject,
  target: QuoteStatusTarget,
  reason: 'converted' | 'not_allowed',
): ConflictException {
  if (reason === 'converted') {
    return new ConflictException({
      code: 'quote_converted',
      message: `This quote has been converted to an invoice; it can no longer be moved to ${target}.`,
      quoteStatus: quote.status,
      requestedStatus: target,
    });
  }
  return new ConflictException({
    code: 'quote_transition_not_allowed',
    message: `A quote cannot move from ${quote.status} to ${target}.`,
    quoteStatus: quote.status,
    requestedStatus: target,
  });
}

/** decideQuoteTransition, throwing its 409 on a refusal. */
export function assertQuoteTransition(quote: QuoteTransitionSubject, target: QuoteStatusTarget): 'move' | 'noop' {
  const decision = decideQuoteTransition(quote, target);
  if (decision.kind === 'refuse') throw quoteTransitionRefusal(quote, target, decision.reason);
  return decision.kind;
}

/** The target a path segment or body field names (any case), or null when it names none. */
export function parseQuoteStatusTarget(raw: unknown): QuoteStatusTarget | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.toUpperCase();
  return (QUOTE_STATUS_TARGETS as readonly string[]).includes(upper) ? (upper as QuoteStatusTarget) : null;
}

/** parseQuoteStatusTarget, answering 400 when the request names no target (it used to reach Prisma: a 500, or a write of CONVERTED). */
export function requireQuoteStatusTarget(raw: unknown): QuoteStatusTarget {
  const target = parseQuoteStatusTarget(raw);
  if (!target) {
    throw new BadRequestException({
      code: 'quote_status_unknown',
      message: `Unknown quote status. Expected one of ${QUOTE_STATUS_TARGETS.join(', ')}.`,
    });
  }
  return target;
}

/**
 * The status route names its target twice when a client also puts `status` in
 * the body: the two must agree (400 otherwise), so a request never does
 * something other than what its body says. An absent body status passes (the
 * web client sends only `{ businessId }`).
 */
export function assertQuoteStatusAgreement(pathStatus: unknown, bodyStatus: unknown): void {
  const path = requireQuoteStatusTarget(pathStatus);
  if (bodyStatus === undefined || bodyStatus === null) return;
  if (parseQuoteStatusTarget(bodyStatus) !== path) {
    throw new BadRequestException({
      code: 'quote_status_mismatch',
      message: `The body status does not match the status in the path (${path}).`,
      pathStatus: path,
    });
  }
}

/**
 * The one quote view-token mint: 24 random bytes, base64url. Called only where
 * a DRAFT holds no token yet (the DRAFT -> SENT move, and the send-email
 * reservation), so a quote's token is minted once and then kept.
 */
export function mintQuoteViewToken(): string {
  return randomBytes(24).toString('base64url');
}

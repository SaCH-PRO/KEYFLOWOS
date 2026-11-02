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
 * covered here, so CF-15/M21 stays open for them: POST
 * /commerce/businesses/:businessId/ai-execute (commerce-ai.service.ts
 * send_quote and convert_quote, outside the V1-50 write set) can still re-open
 * a REJECTED quote to SENT, or mark a REJECTED or converted quote ACCEPTED,
 * with revenue:read and no event (review SEC-V50-4, a follow-up packet).
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
 * a quote holds no token yet (the DRAFT -> SENT move, the send-email
 * reservation, and the repair of a SENT quote written without one, see
 * needsViewTokenRepair), so a quote's token is minted once and then kept.
 */
export function mintQuoteViewToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * V1-50 review CR-V150-2: a SENT quote with no view token has no public link,
 * so its customer can never accept it. Such rows are still written outside
 * this table (the ai-execute send_quote action sets SENT with no token).
 * Asking the status route for `sent` on one is otherwise a no-op; it mints the
 * quote's one token instead (the repair the route made before V1-50). A
 * converted quote is never repaired: the table refuses it first.
 */
export function needsViewTokenRepair(quote: QuoteTransitionSubject & { viewToken?: string | null }): boolean {
  return !isConvertedQuote(quote) && quote.status === 'SENT' && (quote.viewToken === null || quote.viewToken === undefined);
}

/** The actions PATCH /commerce/businesses/:businessId/quotes/bulk takes. */
export const QUOTE_BULK_ACTIONS = ['send', 'reject', 'delete'] as const;
export type QuoteBulkAction = (typeof QUOTE_BULK_ACTIONS)[number];

/**
 * V1-50 review SEC-V50-1, SEC-V50-2, CR-V150-1: the bulk route's body has no
 * DTO (commerce.controller.ts, outside the V1-50 write set), so the service
 * checks it before any read or write. An action that is not send, reject or
 * delete (a misspelling, `accept`, a missing one) is a 400: it used to fall
 * through to `reject`, which is final. `ids` must be a non-empty array of
 * non-empty strings: without it Prisma drops `id: { in: undefined }` and the
 * request reaches every quote of the tenant.
 */
export function requireQuoteBulkRequest(ids: unknown, action: unknown): { ids: string[]; action: QuoteBulkAction } {
  if (typeof action !== 'string' || !(QUOTE_BULK_ACTIONS as readonly string[]).includes(action)) {
    throw new BadRequestException({
      code: 'quote_bulk_action_unknown',
      message: `Unknown bulk action. Expected one of ${QUOTE_BULK_ACTIONS.join(', ')}.`,
    });
  }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new BadRequestException({
      code: 'quote_bulk_ids_required',
      message: 'ids must be a non-empty array of quote ids.',
    });
  }
  return { ids: ids as string[], action: action as QuoteBulkAction };
}

/**
 * The statuses a bulk status action moves from, inside what the table allows.
 * Bulk send moves a DRAFT (the only status the table sends from). Bulk reject
 * moves a quote whose link is out (SENT, or the legacy VIEWED), as it did
 * before V1-50: the table's DRAFT -> REJECTED is an operator decision made one
 * quote at a time on the status route, and the web bulk consumers
 * (quotes-panel.tsx, use-pipeline-actions.ts) treat only SENT quotes as
 * rejected by a bulk reject (review CR-V150-3). REJECTED is final, so a bulk
 * request never widens what one click can close for good.
 */
const QUOTE_BULK_SOURCES: Readonly<Record<'send' | 'reject', ReadonlySet<string>>> = {
  send: new Set(['DRAFT']),
  reject: new Set(['SENT', 'VIEWED']),
};

/** The status a bulk status action asks for. */
export function quoteBulkTarget(action: 'send' | 'reject'): QuoteStatusTarget {
  return action === 'send' ? 'SENT' : 'REJECTED';
}

/**
 * What a bulk `send` or `reject` does to one quote: the table's decision, and
 * a move the table allows from a status the bulk action does not move from is
 * a refusal (`bulk_not_eligible`).
 */
export function decideQuoteBulkMove(quote: QuoteTransitionSubject, action: 'send' | 'reject'): QuoteTransitionDecision | { kind: 'refuse'; reason: 'bulk_not_eligible' } {
  const decision = decideQuoteTransition(quote, quoteBulkTarget(action));
  if (decision.kind === 'move' && !QUOTE_BULK_SOURCES[action].has(quote.status)) {
    return { kind: 'refuse', reason: 'bulk_not_eligible' };
  }
  return decision;
}

/** The code a bulk refusal lists in `skipped`. */
export function quoteBulkRefusalCode(reason: 'converted' | 'not_allowed' | 'bulk_not_eligible'): string {
  if (reason === 'converted') return 'quote_converted';
  if (reason === 'bulk_not_eligible') return 'quote_bulk_not_eligible';
  return 'quote_transition_not_allowed';
}

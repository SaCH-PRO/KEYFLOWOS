import { ForbiddenException, Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  QuoteCreatedPayload,
  QuoteSentPayload,
  QuoteViewedPayload,
  QuoteAcceptedPayload,
  QuoteRejectedPayload,
  QuoteStalePayload,
  QuoteConvertedPayload,
  InvoiceCreatedPayload,
} from '../../core/event-bus/events.types';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Service, Prisma, Payment, QuoteStatus as StoredQuoteStatus } from '@keyflow/db';
import { CrmService } from '../crm/crm.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CommerceStatsService } from './commerce-stats.service';
import { InvoiceWorkflowService, InvoiceStatus, balanceOfStoredRows, computeBalance, isLegalTransition, isShareableInvoiceStatus, ownTenantPayments, roundMoney } from './invoice-workflow.service';
import { computeDocumentAmounts, lineAmount, moneyEquals, overpaidMoney, percentOf, remainingMoney, subtractMoney, sumMoney, toCents } from './money';
import { CatalogService } from '../catalog/catalog.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';
import { D13_CURRENCIES, normalizeCurrency } from '../finance/posting.service';
import { MAX_DOCUMENT_AMOUNT } from './dto/document-line-item.dto';
import { allocateDocumentNumber, isDocumentNumberConflict, isSequenceNumber, retryDocumentNumber } from './document-number';
import { PATCHABLE_INVOICE_STATUSES, type PatchableInvoiceStatus } from './dto/update-invoice.dto';
import {
  decideQuoteBulkMove,
  decideQuoteTransition,
  isConvertedQuote,
  mintQuoteViewToken,
  needsViewTokenRepair,
  quoteBulkRefusalCode,
  quoteBulkTarget,
  quoteTermsChanged,
  quoteTermsVersion,
  quoteTermsVersionRequired,
  quoteTransitionRefusal,
  requireQuoteBulkRequest,
  requireQuoteStatusTarget,
  type QuoteStatus,
  type QuoteStatusTarget,
  type QuoteTermsSubject,
} from './quote-workflow';
import { getTenantContext } from '../../core/tenant/tenant-context';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { isSystemActor, KEY_SYSTEM_ACTOR_ID } from '../../core/auth/system-actor';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { appUrl } from '../../core/config/runtime-urls';

/**
 * The customer fields an operator invoice read discloses: the customer's name
 * and email, nothing of the Contact row's CRM fields (internal notes, phone,
 * owner, visibility). Exported so the invoice write routes project their HTTP
 * responses to the same fields (R0-CMF1 review SEC-CMF1-2, the R28-ST-01 class)
 * instead of keeping their own list.
 */
export const OPERATOR_INVOICE_CONTACT_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
} as const;

/**
 * The full operator shape of an invoice: every payment row (reference, notes,
 * evidence, who recorded it), the customer's email and the business profile
 * with its document templates. Shared by `getInvoiceWithBusiness` (the
 * server-side callers: the email paths, the receipt listener, the token
 * route, the KEY adapter) and the tenant-bound `getInvoiceForBusiness`
 * (R0-QI-01) so the two reads cannot drift apart.
 */
const OPERATOR_INVOICE_INCLUDE = Prisma.validator<Prisma.InvoiceInclude>()({
  contact: {
    select: OPERATOR_INVOICE_CONTACT_SELECT,
  },
  items: true,
  // Required by buildInvoiceEmailContext so amountPaid/remaining
  // render correctly on invoice/reminder/receipt emails — without
  // payments the customer-facing template falls back to 0 paid.
  // DEP-R3-OWN-ROW-READS (D-75): every reader of this include serves the
  // invoice's own-tenant rows only (readOperatorInvoice), never this raw list.
  payments: true,
  business: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      address: true,
      city: true,
      country: true,
      phone: true,
      email: true,
      website: true,
      primaryColor: true,
      secondaryColor: true,
      invoiceTemplate: true,
      quoteTemplate: true,
      facebook: true,
      instagram: true,
      twitter: true,
      whatsapp: true,
    },
  },
});

/**
 * The customer fields an operator quote read discloses: the customer's name
 * and email, nothing of the Contact row's CRM fields (internal notes, phone,
 * owner, visibility). Exported so the quote status route projects its HTTP
 * response to the same fields (R28-ST-01) instead of keeping its own list.
 */
export const OPERATOR_QUOTE_CONTACT_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
} as const;

/**
 * The operator shape of a quote: the customer's name and email, every line
 * item, the invoice it was converted into and the business profile. Shared by
 * `getQuote` (the tenant-unbound server-side read) and the tenant-bound
 * `getQuoteForBusiness` (R0-PC-01) so the two reads cannot drift apart.
 *
 * R0-04 review (ST-R004-1): a nested include carries no tenant condition and
 * neither Prisma extension filters one, so the contact is joined with its
 * businessId and both readers pass the row through `toOperatorQuote`, which
 * serves the contact only when it belongs to the quote's tenant.
 */
const OPERATOR_QUOTE_CONTACT_JOIN = { ...OPERATOR_QUOTE_CONTACT_SELECT, businessId: true } as const;
type OperatorQuoteContactRow = Prisma.ContactGetPayload<{ select: typeof OPERATOR_QUOTE_CONTACT_JOIN }>;

const OPERATOR_QUOTE_INCLUDE = Prisma.validator<Prisma.QuoteInclude>()({
  contact: {
    select: OPERATOR_QUOTE_CONTACT_JOIN,
  },
  items: true,
  invoice: true,
  business: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      address: true,
      phone: true,
      email: true,
      website: true,
      primaryColor: true,
    },
  },
});

/*
 * R0-04 review (ST-R004-1) and R0-CMF3 review (ST-CMF3-1/2/3, CR-CMF3-1): a
 * quote serves, and acts on, only a contact of its own tenant. createQuote and
 * updateQuote resolve contactId inside the path tenant and
 * convertQuoteToInvoice refuses a foreign contact (R0-27 review ST-27-2), but
 * a row written before those checks can still point at another tenant's
 * contact, and a nested include has no tenant condition (neither Prisma
 * extension filters one). Every reader in THIS service that joins a quote's
 * contact passes the row through the helpers below: the operator detail reads,
 * updateQuote, updateQuoteStatus (the status route, send-email and the public
 * accept/reject), listQuotes, getStaleQuotes, markQuoteFollowedUp and the
 * signed-token view. Readers in other modules are not covered; the manifest
 * scripts/proof-admission/manifests/quote-contact-tenant.json lists them.
 */

/** True when the quote's joined contact belongs to another tenant (a legacy row). */
function hasForeignContact(quote: { businessId: string; contact?: { businessId: string } | null }): boolean {
  return !!quote.contact && quote.contact.businessId !== quote.businessId;
}

/**
 * The quote as served: a foreign contact reads as null, so this service never
 * serves its name, email or phone to the quote's tenant. contactId keeps the
 * stored value.
 */
function withTenantContact<Q extends { businessId: string; contact: { businessId: string } | null }>(
  quote: Q,
): Omit<Q, 'contact'> & { contact: Q['contact'] | null } {
  return hasForeignContact(quote) ? { ...quote, contact: null } : quote;
}

/**
 * The quote an event or a timeline write carries: a foreign contact is
 * dropped together with its id, so no listener emails that customer
 * (flow.listener on quote.sent), names them in this tenant's activity feed, or
 * logs a ContactEvent under this tenant against them (the CRM listeners log
 * quote.contactId), and this service logs nothing against them either.
 * `row` is the quote as read (with its contact's businessId), `served` the
 * shape the event carries.
 */
function forQuoteEvent<S extends { contactId: string | null; contact: unknown }>(
  row: { businessId: string; contact: { businessId: string } | null },
  served: S,
): Omit<S, 'contactId' | 'contact'> & { contactId: S['contactId'] | null; contact: S['contact'] | null } {
  return hasForeignContact(row) ? { ...served, contact: null, contactId: null } : served;
}

type OperatorQuoteContact = Prisma.ContactGetPayload<{ select: typeof OPERATOR_QUOTE_CONTACT_SELECT }>;

/** A quote row as the status writers read and return it (V1-50 moveQuoteStatus). */
type QuoteWithContactRow = Prisma.QuoteGetPayload<{ include: { contact: true } }>;

/**
 * What moveQuoteStatus compares and sets on: the status, token and link the
 * caller decided from, and (a terms-bound public accept) the updatedAt of the
 * read whose terms the customer's version matched.
 */
type QuoteMoveSubject = { id: string; status: string; viewToken: string | null; invoiceId?: string | null; updatedAt?: Date };

/**
 * The served contact of a quote read: only OPERATOR_QUOTE_CONTACT_SELECT (name
 * and email), and null when the contact belongs to another tenant. Neither the
 * businessId it was joined with for the check nor any other field of a whole
 * Contact row is served. Used by the operator detail reads, the signed-token
 * view and the signed-token accept/reject response.
 */
function toOperatorQuote<Q extends { businessId: string; contact: OperatorQuoteContactRow | null }>(
  quote: Q,
): Omit<Q, 'contact'> & { contact: OperatorQuoteContact | null } {
  const { contact, ...rest } = quote;
  if (!contact || hasForeignContact(quote)) return { ...rest, contact: null };
  return { ...rest, contact: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email } };
}

/**
 * V1-52 review (SEC-V52-1): the quote as the operator READ routes serve it,
 * without its viewToken. The token is the customer's bearer credential: whoever
 * holds it can view, accept or reject the quote on the public routes. The
 * revenue:read reads (GET .../quotes, .../quotes/stale, .../quotes/:quoteId and
 * the KEY adapter's getQuoteStatus) used to serve it, so a member refused the
 * status route and the public-link route (both revenue:write) could still read
 * the link, share it or accept the quote themselves, and the list served a token
 * send-email reserved on a DRAFT. The link reaches an operator only through
 * POST .../quotes/:quoteId/public-link (revenue:write, never for a DRAFT).
 * Events and the signed-token routes keep the token (their readers build the
 * customer's link from it, or already hold it).
 */
function withoutViewToken<Q extends { viewToken?: string | null }>(quote: Q): Omit<Q, 'viewToken'> {
  const served: Partial<Q> = { ...quote };
  delete served.viewToken;
  return served as Omit<Q, 'viewToken'>;
}

/** Older invoices stored subtotal 0 with priced items; derive it so totals render. */
function withLegacySubtotal<
  T extends { subtotal: number; taxRate: number | null; taxAmount: number | null; items: Array<{ total: number }> },
>(invoice: T): T {
  if ((!invoice.subtotal || invoice.subtotal === 0) && invoice.items?.length > 0) {
    const computedSubtotal = invoice.items.reduce((sum, item) => sum + (item.total || 0), 0);
    const computedTaxAmount = invoice.taxRate ? computedSubtotal * (invoice.taxRate / 100) : 0;
    return {
      ...invoice,
      subtotal: computedSubtotal,
      taxAmount: invoice.taxAmount ?? computedTaxAmount,
    };
  }
  return invoice;
}

/**
 * V1-51: the 409 a convert answers for a quote already converted to an
 * invoice (a repeat, or the loser of two concurrent converts). It used to be a
 * plain Error (500). `quote_converted` is the code the V1-50 status route
 * answers for the same stored state.
 */
function quoteAlreadyConverted(): ConflictException {
  return new ConflictException({
    code: 'quote_converted',
    message: 'This quote has already been converted to an invoice.',
  });
}

/**
 * V1-51 review (SEC-V51-2): the 409 an edit of an ACCEPTED quote answers. The
 * customer accepted its terms; convert {} invoices the quote's stored tax and
 * discount, so an edit after acceptance would invoice terms nobody accepted.
 * V1-50: a decision is final, a changed offer is a new quote.
 */
function quoteAlreadyAccepted(): ConflictException {
  return new ConflictException({
    code: 'quote_accepted',
    message: 'This quote has been accepted and can no longer be edited. A changed offer is a new quote.',
  });
}

/**
 * V1-53: the 404 an edit, delete or convert answers for an unknown quote, a
 * quote of another tenant (looked up under the path tenant, so the two read
 * the same) or a deleted one. It was a plain Error, which
 * GlobalHttpExceptionFilter maps to 500.
 */
function quoteNotFound(): NotFoundException {
  return new NotFoundException('Quote not found');
}

/**
 * V1-53: the 409 a convert answers for a quote the customer has not accepted
 * (DRAFT, SENT, REJECTED, EXPIRED). The message is the one the plain Error
 * (500) carried; `quoteStatus` reaches the client under `details`.
 */
function quoteNotAccepted(status: string): ConflictException {
  return new ConflictException({
    code: 'quote_not_accepted',
    message: 'Only accepted quotes can be converted to invoices',
    quoteStatus: status,
  });
}

/**
 * V1-53: the 409 a delete answers for a converted quote, with the message the
 * plain Error (500) carried. `quote_converted` is the code the status route
 * (V1-50) and convert (V1-51) answer for the same stored state.
 */
function quoteConvertedNotDeletable(): ConflictException {
  return new ConflictException({
    code: 'quote_converted',
    message: 'Cannot delete a quote that has been converted to an invoice',
  });
}

/**
 * V1-53: the 409 a create answers when its quoteNumber is already used in the
 * business (the unique index quotes_business_id_quote_number_key). The
 * index's P2002 answered 500, from the HTTP route and from KEY's
 * commerce_create_quote, whose count-based number can repeat.
 */
function quoteNumberTaken(): ConflictException {
  return new ConflictException({
    code: 'quote_number_taken',
    message: 'A quote with this number already exists in this business.',
  });
}

/**
 * V1-45-DM-CREATE-IDEMPOTENCY (M22, owner ruling D-15): a retried invoice or
 * quote create carries the client's Idempotency-Key. The key is claimed on the
 * existing idempotency_keys table (unique on business and key; no migration)
 * under a namespaced slot, 'commerce.invoice.create:<key>' or
 * 'commerce.quote.create:<key>', so a key is scoped to its business and to the
 * kind of document. The slot remembers the request's hash and the document it
 * created: the same key with the same request answers that document, with a
 * different request a 409.
 */
type CreateKind = 'invoice' | 'quote';
/** The transaction client of PrismaService's (extended) client, as bookings.service and gmail.service type it. */
type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];
interface CreateClaim {
  slot: string;
  requestHash: string;
}

/** Longest client key a create accepts, as the storefront checkout (site.controller). */
const CREATE_IDEMPOTENCY_KEY_MAX = 255;

/**
 * FOLLOW3-A1-D46-COMMERCE-WRITES (owner ruling D-55): the provider ids the
 * gateway doors match on, spelled exactly as they match (Prisma equality is
 * case-sensitive; payments.service.ts processStripeRefund matches provider
 * 'stripe'). A payment recordPayment writes by hand (the manual route, KEY's
 * processPayment) with one of these as its method is stored with provider
 * 'manual', so no gateway door can take it for a gateway payment: a hand row
 * naming another tenant's PaymentIntent made that tenant's platform-signed
 * refund ambiguous, and its books never showed it. The method is kept, so the
 * receipt still posts to the payment-processor account
 * (RevenuePostingService.depositSystemKey reads the method too). Exact
 * comparison, never case-folded: 'PayPal' (the web form) and 'PAYPAL' (an
 * evidence confirm) are stored as before.
 */
const GATEWAY_PROVIDER_IDS: ReadonlySet<string> = new Set(['stripe', 'paypal', 'wipay']);

/**
 * The create's claim, or null when it carries no key (absent or blank, as the
 * base: every call creates). `material` is every field the caller sent, in a
 * fixed shape (absent is null), so its JSON is the same for the same request.
 */
function createClaim(kind: CreateKind, key: unknown, material: Record<string, unknown>): CreateClaim | null {
  if (key == null) return null;
  if (typeof key !== 'string') throw new BadRequestException('Idempotency-Key must be a string');
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.length > CREATE_IDEMPOTENCY_KEY_MAX) {
    throw new BadRequestException(`Idempotency-Key must be at most ${CREATE_IDEMPOTENCY_KEY_MAX} characters`);
  }
  return {
    slot: `commerce.${kind}.create:${trimmed}`,
    requestHash: createHash('sha256').update(JSON.stringify(material), 'utf8').digest('hex'),
  };
}

/**
 * V1-45b (V1-45 review SEC-V45-3): the acting member is part of the request,
 * as in the KEY tool registry's fingerprint (fingerprintToolRequest): another
 * member presenting the same key and body is a 409, never the first member's
 * replay. A create with no acting member (the internal callers) hashes as the
 * document fields alone, as before.
 */
function createActorMaterial(actorUserId: string | undefined): Record<string, unknown> {
  return actorUserId ? { actor: actorUserId } : {};
}

/** A create's document lines in the fixed shape its request hash reads. */
function createLinesMaterial(items: ReadonlyArray<{ description?: unknown; quantity?: unknown; unitPrice?: unknown; productId?: unknown; total?: unknown }> | undefined) {
  return Array.isArray(items)
    ? items.map((item) => ({
        description: item?.description ?? null,
        quantity: item?.quantity ?? null,
        unitPrice: item?.unitPrice ?? null,
        productId: item?.productId ?? null,
        total: item?.total ?? null,
      }))
    : null;
}

function createDateMaterial(value: Date | string | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

/**
 * Thrown inside a create's transaction when its slot is already taken: the
 * create rolls back, and the caller answers with the document that took it.
 */
class CreateSlotTaken extends Error {}

/**
 * W3-V1-45c-EVENT-REPLAY (V1-45b review SEC-V45b-1 / CR-V45b-1; review
 * CR-V45c-1; D-15): the business event claim of each document a keyed create
 * answered, whichever door answered it: the create that wrote it, a keyed
 * replay, or a concurrent create that lost the slot. A WeakMap, not a field:
 * the document the caller gets is unchanged, and the claim goes with that
 * object only.
 */
const createEventClaims = new WeakMap<object, () => Promise<boolean>>();

/**
 * The claim on the one invoice.create / quote.create business event of the
 * document a keyed create answered; undefined for a create without a key
 * (always a new document, audited as before). The HTTP create routes hand it
 * to the business event audit (auditOnClaim): of every request answered with
 * the document, the first to reach the audit writes the event and the others
 * write none, so a replay is not a second event and a create that failed
 * after its commit does not leave the document with none (CR-V45c-1).
 */
export function createEventClaim(document: unknown): (() => Promise<boolean>) | undefined {
  return typeof document === 'object' && document !== null ? createEventClaims.get(document) : undefined;
}

function idempotencyKeyReused(kind: CreateKind): ConflictException {
  return new ConflictException({
    code: 'idempotency_key_reused',
    message: `This Idempotency-Key was already used for a different ${kind}; use a new key for a new ${kind}.`,
  });
}

function idempotencyKeySpent(kind: CreateKind): ConflictException {
  return new ConflictException({
    code: 'idempotency_key_spent',
    message: `This Idempotency-Key was already used and its ${kind} no longer exists; use a new key.`,
  });
}

/**
 * V1-53 review (SEC-V53-2): the stored statuses isConvertedQuote reads as
 * converted (INVOICED, PAID, CONVERTED), derived from the enum so the delete's
 * conditional write and the V1-50 table cannot drift apart.
 */
const CONVERTED_QUOTE_STATUSES = Object.values(StoredQuoteStatus).filter((status) => isConvertedQuote({ status }));

/**
 * V1-QUOTE-CHAIN-finish (review SEC-1): thrown inside the edit transaction
 * when the quote row's compare-and-set matches no row (an accept, a convert,
 * a delete or another edit committed after the quote was read). No line is
 * written; the catch answers from the quote as it now stands.
 */
class QuoteEditRaceLost extends Error {
  constructor() {
    super('The quote changed while it was being edited');
  }
}

/**
 * V1-53 review (SEC-V53-2): thrown inside the convert transaction when the
 * quote's backlink write matches no row (a delete, or another convert,
 * committed after the quote was read). It rolls the invoice back; the catch
 * answers from the quote as it now stands.
 */
class QuoteConvertRaceLost extends Error {
  constructor() {
    super('The quote changed while it was being converted');
  }
}

/** The distinct, non-empty productIds of a set of quote lines ('' and null are "no product"). */
function lineProductIds(items: ReadonlyArray<{ productId?: string | null } | null | undefined>): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => item?.productId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
}

/**
 * V1-51 review (SEC-V51-1 / CR51-1): the discount type a quote is priced with.
 * createQuote and updateQuote price any discount that is not FIXED as a
 * percentage, a stored discount with no type included, so that is the type its
 * value is checked (and carried by convert) as.
 */
function quotePricedDiscountType(discountType: string | null | undefined): 'PERCENT' | 'FIXED' {
  return discountType === 'FIXED' ? 'FIXED' : 'PERCENT';
}

/**
 * The recordPayment transaction re-reads the invoice under its lock, writes the
 * payment, reconciles the status and posts to the ledger, and the first payment
 * of a fresh tenant also seeds its chart of accounts inside it (R0-D1). That can
 * pass Prisma's 5 s interactive-transaction default under load or against a
 * remote database, which aborts a genuine payment ("Transaction already closed").
 * The same bounded budget the profile patch uses, a little wider.
 */
const RECORD_PAYMENT_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

@Injectable()
export class CommerceService {
  private readonly logger = new Logger(CommerceService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CommerceStatsService) private readonly statsCache: CommerceStatsService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
    @Inject(RevenuePostingService) private readonly revenuePosting: RevenuePostingService,
  ) {}

  /**
   * @deprecated Use CatalogService.listProducts directly. This pass-through
   * remains so the existing /commerce/businesses/:id/products endpoint keeps
   * working; it will be removed once Commerce callers migrate (see S2).
   */
  async listProducts(businessId: string, page = 1, pageSize = 50) {
    return this.catalog.listProducts(businessId, page, pageSize);
  }

  /** @deprecated Use CatalogService.listPublicProducts. */
  async listPublicProducts(businessId: string) {
    return this.catalog.listPublicProducts(businessId);
  }

  /** @deprecated Use CatalogService.createProduct. */
  async createProduct(input: {
    businessId: string;
    name: string;
    price: number;
    currency?: string;
    description?: string | null;
    category?: string;
    duration?: number | null;
    imageUrl?: string | null;
    sku?: string | null;
    isActive?: boolean;
  }) {
    const result = await this.catalog.createProduct(input);
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  /** @deprecated Use CatalogService.updateProduct. */
  async updateProduct(input: {
    businessId: string;
    productId: string;
    name?: string;
    price?: number;
    currency?: string;
    description?: string | null;
    category?: string;
    duration?: number | null;
    imageUrl?: string | null;
    sku?: string | null;
    isActive?: boolean;
  }) {
    const result = await this.catalog.updateProduct(input);
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  /** @deprecated Use CatalogService.deleteProduct. */
  async deleteProduct(businessId: string, productId: string) {
    const result = await this.catalog.deleteProduct(businessId, productId);
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  /** @deprecated Use CatalogService.bulkUpdateProducts. */
  async bulkUpdateProducts(businessId: string, ids: string[], action: 'activate' | 'deactivate' | 'delete') {
    const result = await this.catalog.bulkUpdateProducts(businessId, ids, action);
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async createInvoiceForService(
    businessId: string,
    contactId: string,
    service: Service,
    options?: { kind?: 'FULL' | 'DEPOSIT'; amountOverride?: number; descriptionSuffix?: string },
  ) {
    const kind = options?.kind ?? 'FULL';
    // V1-22 (D-13): the one amount this invoice stores, in cents.
    const total = roundMoney(options?.amountOverride ?? service.price);
    const description =
      kind === 'DEPOSIT'
        ? `Deposit — ${service.name}${options?.descriptionSuffix ?? ''}`
        : `${service.name}${options?.descriptionSuffix ?? ''}`;
    // V1-37 (CF-38, D-13): the business currency, not the literal 'TTD'.
    const currency = await this.documentCurrency(businessId);
    // V1-43 (D-15): the business's next number, in this create's own
    // transaction; a collision is retried with the following number. Booking
    // invoices (deposit, booking-time, completion) are all drawn up here.
    return retryDocumentNumber('invoice', () => this.prisma.client.$transaction(async (tx) => tx.invoice.create({
      data: {
        businessId,
        contactId,
        invoiceNumber: await allocateDocumentNumber(tx, businessId, 'invoice'),
        status: 'DRAFT',
        issueDate: new Date(),
        subtotal: total,
        total,
        currency,
        notes: kind === 'DEPOSIT' ? `Deposit for service "${service.name}"` : null,
        items: {
          create: [
            {
              description,
              quantity: 1,
              unitPrice: total,
              total,
            },
          ],
        },
      },
      include: { items: true, contact: true },
    })));
  }

  /**
   * Compute the deposit amount for a service using its deposit config.
   * Returns 0 when deposit is not required or value is invalid.
   */
  computeServiceDeposit(service: Pick<Service, 'price'> & { depositRequired?: boolean | null; depositType?: string | null; depositValue?: number | null }): number {
    if (!service.depositRequired) return 0;
    const value = service.depositValue ?? 0;
    if (value <= 0) return 0;
    if (service.depositType === 'PERCENT') {
      const pct = Math.min(Math.max(value, 0), 100);
      // V1-22: exact, rounded to cents (the float form read 10.05 x 10% as 1.00).
      return percentOf(service.price, pct);
    }
    if (service.depositType === 'FIXED') {
      return Math.min(value, service.price);
    }
    return 0;
  }

  // R0-D3: invalid input is a 400, not a 500. A plain Error here reached the
  // global filter as INTERNAL_SERVER_ERROR on every invoice/quote create and
  // update route.
  private validateTaxAndDiscount(taxRate?: number, discountValue?: number, discountType?: string) {
    if (taxRate !== undefined && taxRate !== null) {
      if (taxRate < 0 || taxRate > 100) {
        throw new BadRequestException('Tax rate must be between 0 and 100');
      }
    }
    if (discountValue !== undefined && discountValue !== null) {
      if (discountValue < 0) {
        throw new BadRequestException('Discount value must be non-negative');
      }
      if (discountType === 'PERCENT' && discountValue > 100) {
        throw new BadRequestException('Percentage discount cannot exceed 100%');
      }
    }
  }

  /**
   * R0-27 review (ST-27-3, ST-27-4 / R27-CR-1): the server-computed amounts of
   * an invoice must be storable and postable, checked before anything is
   * written.
   *  - A FIXED discount larger than the subtotal made the total negative, and
   *    RevenuePostingService posts no AR for a total that is not positive, so
   *    the invoice could be issued (SENT) with no ledger entry. A discount up
   *    to the subtotal is allowed (the total is then the tax, never negative).
   *    A PERCENT discount is already capped at 100% by validateTaxAndDiscount.
   *  - A subtotal or total that is not finite, or above MAX_DOCUMENT_AMOUNT
   *    (the numeric(18,4) ledger bound), answered 500 from Prisma on create or
   *    could not be posted on issue.
   * The computed amounts are checked, so the total/subtotal overrides of the
   * internal callers (document intelligence) are not affected.
   */
  private assertInvoiceAmounts(amounts: {
    subtotal: number;
    total: number;
    discountType?: string | null;
    discountValue?: number | null;
  }) {
    for (const amount of [amounts.subtotal, amounts.total]) {
      if (!Number.isFinite(amount) || amount > MAX_DOCUMENT_AMOUNT) {
        throw new BadRequestException(`Invoice amount cannot exceed ${MAX_DOCUMENT_AMOUNT}`);
      }
    }
    if (amounts.discountType === 'FIXED' && amounts.discountValue != null && amounts.discountValue > amounts.subtotal) {
      throw new BadRequestException('Fixed discount cannot exceed the subtotal');
    }
  }

  /**
   * V1-37-DM-CURRENCY (CF-38, P0-7; owner ruling D-13: one currency per
   * business, documents default to it; TTD and USD supported): the currency a
   * new or edited invoice or quote is written in.
   *
   *   - none named: the business currency (createInvoice, createQuote and
   *     createInvoiceForService wrote the literal 'TTD', so a USD business's
   *     invoices were TTD);
   *   - named: it wins, upper-cased ('ttd' was stored as given), when it is a
   *     D-13 currency or the business's own;
   *   - anything else (EUR on a TTD business) is refused with 400 before
   *     anything is written: the ledger door would refuse to post it
   *     (PostingService, resolvePostingCurrency), so it could never be issued
   *     on accrual or paid (IV-P04).
   */
  private async documentCurrency(businessId: string, requested?: string | null): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const home = normalizeCurrency(business?.currency) || 'TTD';
    const currency = normalizeCurrency(requested);
    if (!currency) return home;
    if (currency !== home && !D13_CURRENCIES.includes(currency)) {
      throw new BadRequestException(
        `Unsupported currency ${currency}: use the business currency ${home} or one of ${D13_CURRENCIES.join(', ')}`,
      );
    }
    return currency;
  }

  /**
   * Resolve a contact id inside the caller's tenant before it is bound to an
   * invoice or a quote. The row is returned with `include: { contact: true }`,
   * so a foreign id would both bind another tenant's contact and disclose its
   * row. A foreign, soft-deleted or unknown id answers the same 404, and the
   * caller writes nothing. R0-D3 review (ST-D3-1) for invoice update; R0-27 for
   * invoice create; R0-27 review (ST-27-2) for quote create, quote update and
   * quote convert, the second path by which a contact reaches an Invoice.
   *
   * FOLLOW3-D6 (D-64): `memberClause` (memberContactClause) narrows the lookup
   * to the contacts the acting member may open; a hidden contact then answers
   * exactly the 404 of an unknown one. Without it the check is the tenant's.
   */
  private async assertContactInBusiness(
    contactId: unknown,
    businessId: string,
    memberClause?: Prisma.ContactWhereInput,
  ): Promise<string> {
    if (typeof contactId !== 'string' || contactId.length === 0) {
      throw new BadRequestException('contactId must be a non-empty string');
    }
    const where: Prisma.ContactWhereInput = { id: contactId, businessId };
    if (memberClause) where.AND = [memberClause];
    const contact = await this.prisma.client.contact.findFirst({
      where,
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contactId;
  }

  /**
   * FOLLOW3-D6 (owner ruling D-64; R0-27 review ST-27-5): the contacts the
   * acting member may open, by the rule GET contacts/:id applies
   * (resolveCrmAccess + visibilityClause), as bookings create does since V1-06.
   * Undefined when there is no member actor (KEY's system actor included) or
   * the member sees every contact (OWNER, SUPER_ADMIN). resolveCrmAccess refuses a
   * non-member 403 first.
   *
   * Applied today by updateQuote only. Every other bind (createInvoice,
   * createQuote, the convert re-check, updateInvoice) is also reached by a
   * granted KEY tool whose dispatcher passes no actor (commerce_create_invoice,
   * commerce_create_quote, commerce_convert_quote, commerce_update_invoice), so
   * applying the clause there makes KEY bind what HTTP refuses: the K2
   * derivation in job-role-tool-families.spec.ts (CRM_ROW_VISIBILITY_TOOLS)
   * fails. Those binds wait for an owner decision (withhold the tools from KEY
   * positions, or a holder-aware dispatcher), and existing suites pin their
   * pre-D-64 answers (commerce-contact-bind-visibility.integration.test.ts).
   */
  private async memberContactClause(businessId: string, actorUserId?: string): Promise<Prisma.ContactWhereInput | undefined> {
    if (!actorUserId || isSystemActor(actorUserId)) return undefined;
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    return (visibilityClause(access, actorUserId) as Prisma.ContactWhereInput | null) ?? undefined;
  }

  /**
   * V1-53: the lines a quote create or edit is about to write, checked before
   * anything is written. CreateQuoteDto and UpdateQuoteDto hold the HTTP
   * routes to the line rules; this holds every caller (KEY's create_quote
   * passes the model's items) to the two the database cannot express:
   *  - at least one line (an empty list wrote a quote of 0, and an edit with
   *    one wiped the quote's lines);
   *  - a line's productId resolves inside the tenant. QuoteItem.productId is an
   *    FK to Product with no tenant condition, so a foreign id bound another
   *    tenant's product (and convert copies it onto the invoice lines), and an
   *    unknown id failed the FK (500). Both answer the same 404 as invoice edit
   *    (R0-D3 review ST-D3-2). An empty productId is "no product".
   */
  private async assertQuoteLines(
    items: ReadonlyArray<{ productId?: string | null }> | undefined,
    businessId: string,
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items must contain at least 1 elements');
    }
    const productIds = lineProductIds(items);
    if (productIds.length > 0) {
      const products = await this.prisma.client.product.findMany({
        where: { id: { in: productIds }, businessId },
        select: { id: true },
      });
      if (products.length !== productIds.length) {
        throw new NotFoundException('Product not found');
      }
    }
  }

  /**
   * V1-53 review (SEC-V53-3): the productIds a stored quote's lines carry,
   * checked inside the tenant before convert copies them onto the invoice
   * lines. assertQuoteLines holds new lines (create, edit) to this; a quote
   * written before it, or edited without `items`, can still hold a line bound
   * to another tenant's product, which convert turned into this tenant's
   * invoice line bound to that product (as the stored contactId is refused
   * here, assertContactInBusiness). Only the tenant is checked: the row is read
   * raw because the soft-delete extension hides an archived product, and a
   * product of this tenant archived after it was quoted is still its own.
   * Same 404 as quote and invoice create.
   */
  private async assertStoredLineProductsInBusiness(
    items: ReadonlyArray<{ productId: string | null }>,
    businessId: string,
  ): Promise<void> {
    const productIds = lineProductIds(items);
    if (productIds.length === 0) return;
    const owned = await this.prisma.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM products WHERE business_id = ${businessId} AND id IN (${Prisma.join(productIds)})`;
    if (owned.length !== productIds.length) {
      throw new NotFoundException('Product not found');
    }
  }

  /**
   * V1-53: a quote's computed subtotal and total obey the bound an invoice's
   * do (assertInvoiceAmounts): finite and no larger than MAX_DOCUMENT_AMOUNT.
   * A bounded quantity times a bounded price can still exceed it (2.1e23), and
   * a NaN price from an internal caller made the total NaN; such a quote could
   * be sent and accepted but never converted.
   */
  private assertQuoteAmounts(subtotal: number, total: number): void {
    for (const amount of [subtotal, total]) {
      if (!Number.isFinite(amount) || amount > MAX_DOCUMENT_AMOUNT) {
        throw new BadRequestException(`Quote amount cannot exceed ${MAX_DOCUMENT_AMOUNT}`);
      }
    }
  }

  /**
   * V1-45: take the create's slot, first thing inside its transaction. The
   * insert skips a duplicate (ON CONFLICT DO NOTHING) instead of failing: a
   * slot another create committed answers 0 rows at once, and one another
   * create holds uncommitted makes this insert wait on the unique index until
   * that create commits (0 rows) or rolls back (this create takes the slot).
   * 0 rows throws CreateSlotTaken, which rolls this create back.
   */
  private async claimCreateSlot(tx: PrismaTx, businessId: string, claim: CreateClaim): Promise<void> {
    const { count } = await tx.idempotencyKey.createMany({
      data: [{ businessId, idempotencyKey: claim.slot, status: 'pending', requestHash: claim.requestHash }],
      skipDuplicates: true,
    });
    if (count !== 1) throw new CreateSlotTaken();
  }

  /** V1-45: record the created document on the slot, in the same transaction (no 'pending' row is ever committed). */
  private async settleCreateSlot(
    tx: PrismaTx,
    businessId: string,
    claim: CreateClaim,
    response: { invoiceId: string } | { quoteId: string },
  ): Promise<void> {
    await tx.idempotencyKey.updateMany({
      where: { businessId, idempotencyKey: claim.slot, status: 'pending' },
      data: { status: 'completed', response },
    });
  }

  /**
   * V1-45: the document a used slot answers with, or null when the slot is
   * free. A different request under the key is a 409 (idempotency_key_reused);
   * a slot whose document was deleted since answers 409 too
   * (idempotency_key_spent), never a second document.
   *
   * W3-V1-45c-EVENT-REPLAY: the document it answers carries its slot's
   * business event claim (createEventClaim), on both doors that reach here: a
   * retry that finds the slot used, and a concurrent create that lost it
   * (takenCreateSlot).
   */
  private async usedCreateSlot<D extends object>(
    businessId: string,
    kind: CreateKind,
    claim: CreateClaim,
    load: (id: string) => Promise<D | null>,
  ): Promise<D | null> {
    const row = await this.prisma.client.idempotencyKey.findUnique({
      where: { businessId_idempotencyKey: { businessId, idempotencyKey: claim.slot } },
    });
    if (!row) return null;
    if (row.requestHash !== claim.requestHash) throw idempotencyKeyReused(kind);
    const id = (row.response as Record<string, unknown> | null)?.[kind === 'invoice' ? 'invoiceId' : 'quoteId'];
    const document = typeof id === 'string' ? await load(id) : null;
    if (!document) throw idempotencyKeySpent(kind);
    return this.withCreateEventClaim(document, businessId, claim);
  }

  /**
   * W3-V1-45c-EVENT-REPLAY review CR-V45c-1 (D-15): bind the document a keyed
   * create answers to its slot's business event claim (createEventClaim). The
   * claim marks the slot's idempotency_keys row (`response.businessEvent`) in
   * one conditional UPDATE, so of every request answered with the document,
   * concurrent or later, exactly one wins it: a concurrent UPDATE waits on the
   * row lock and then finds the mark. A request that never reaches the audit
   * (it failed after the document committed) never claims, so its retry, or a
   * loser of its burst, still writes the event. The slot's invoiceId / quoteId
   * are kept; nothing else reads the mark.
   */
  private withCreateEventClaim<D extends object>(document: D, businessId: string, claim: CreateClaim): D {
    createEventClaims.set(document, async () => {
      const won = await this.prisma.client.$executeRaw`
        UPDATE idempotency_keys
           SET response = COALESCE(response, '{}'::jsonb) || jsonb_build_object('businessEvent', true),
               updated_at = now()
         WHERE business_id = ${businessId}
           AND idempotency_key = ${claim.slot}
           AND status = 'completed'
           AND (response -> 'businessEvent') IS NULL`;
      return won === 1;
    });
    return document;
  }

  /** V1-45: a create that lost its slot to a concurrent one answers with the winner's document. */
  private async takenCreateSlot<D extends object>(
    businessId: string,
    kind: CreateKind,
    claim: CreateClaim,
    load: (id: string) => Promise<D | null>,
  ): Promise<D> {
    const winner = await this.usedCreateSlot(businessId, kind, claim, load);
    if (!winner) throw idempotencyKeySpent(kind);
    return winner;
  }

  async createInvoice(input: {
    businessId: string;
    contactId?: string;
    items: { description: string; quantity: number; unitPrice: number; productId?: string; total?: number }[];
    currency?: string;
    dueDate?: Date | string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
    invoiceNumber?: string;
    subtotal?: number;
    taxAmount?: number;
    total?: number;
    /** V1-45 (D-15): the client's Idempotency-Key. The same key and request answer the invoice it created. */
    idempotencyKey?: string;
    /** V1-45b (SEC-V45-3): the member who sent the request; part of the key's request hash. */
    actorUserId?: string;
  }) {
    // V1-45 (M22): a retry with a used key is answered before anything else runs.
    const claim = createClaim('invoice', input.idempotencyKey, {
      contactId: input.contactId ?? null,
      items: createLinesMaterial(input.items),
      currency: input.currency ?? null,
      dueDate: createDateMaterial(input.dueDate),
      taxRate: input.taxRate ?? null,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? null,
      notes: input.notes ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      subtotal: input.subtotal ?? null,
      taxAmount: input.taxAmount ?? null,
      total: input.total ?? null,
      ...createActorMaterial(input.actorUserId),
    });
    const loadCreated = (id: string) =>
      this.prisma.client.invoice.findFirst({ where: { id, businessId: input.businessId }, include: { items: true, contact: true } });
    const prior = claim ? await this.usedCreateSlot(input.businessId, 'invoice', claim, loadCreated) : null;
    if (prior) return prior;

    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const taxRate = input.taxRate ?? 0;
    // V1-22-DM-MONEY-CENTS (M23, D-13): every amount is computed and stored in
    // integer cents. The float form stored items 0.1 + 0.2 at 12.5% tax as
    // subtotal 0.30000000000000004 and total 0.3375, and posted 0.3375.
    const calculated = computeDocumentAmounts({
      lines: input.items.map((item) => lineAmount(item.quantity, item.unitPrice)),
      taxRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
    });
    const discountAmount = calculated.discountAmount;
    this.assertInvoiceAmounts({
      subtotal: calculated.subtotal,
      total: calculated.total,
      discountType: input.discountType,
      discountValue: input.discountValue,
    });
    // V1-37 (D-13): the business currency unless one is named; checked before any write.
    const currency = await this.documentCurrency(input.businessId, input.currency);
    // The internal callers' overrides (document intelligence) are stored in cents too.
    const subtotal = input.subtotal != null ? roundMoney(input.subtotal) : calculated.subtotal;
    const taxAmount = input.taxAmount != null ? roundMoney(input.taxAmount) : calculated.taxAmount;
    const total = input.total != null ? roundMoney(input.total) : calculated.total;
    const data: any = {
      businessId: input.businessId,
      status: 'DRAFT',
      issueDate: new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      subtotal,
      taxRate,
      taxAmount,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? null,
      discountAmount,
      total,
      currency,
      notes: input.notes ?? null,
      items: {
        create: input.items.map((item, i) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total != null ? roundMoney(item.total) : calculated.lineTotals[i],
        })),
      },
    };
    // R0-27 (M19 / CF-37): the contact was bound with no tenant check, so bizA's
    // contactId under bizB's path created bizB's invoice linked to (and
    // echoing) bizA's contact. Every caller passes through here: the HTTP
    // route, invoice-from-time, KEY and the intake flows.
    if (input.contactId !== undefined) {
      data.contactId = await this.assertContactInBusiness(input.contactId, input.businessId);
    }
    // V1-43 (D-15): a number the caller names (document intake) is kept as
    // given; otherwise the business's next number is drawn in this create's
    // own transaction, and a collision is retried with the following number.
    // Review CR43-1: a named number in the sequence's own form (a scanned
    // INV-0002) that the business already holds meets its own numbering, which
    // the base's INV-<timestamp> never did; that create takes the business's
    // next number instead of failing. A taken number of any other form still
    // fails as it did at the base.
    // V1-45: with a key, its slot is taken first in the same transaction, so
    // the invoice and its idempotency_keys row commit together; a create that
    // finds the slot taken writes nothing and answers the invoice that took it.
    const create = (invoiceNumber?: string) => this.prisma.client.$transaction(async (tx) => {
      if (claim) await this.claimCreateSlot(tx, input.businessId, claim);
      const created = await tx.invoice.create({
        data: { ...data, invoiceNumber: invoiceNumber ?? (await allocateDocumentNumber(tx, input.businessId, 'invoice')) },
        include: { items: true, contact: true },
      });
      if (claim) await this.settleCreateSlot(tx, input.businessId, claim, { invoiceId: created.id });
      return created;
    });
    const allocated = () => retryDocumentNumber('invoice', () => create());
    const named = input.invoiceNumber;
    let invoice: Awaited<ReturnType<typeof create>>;
    try {
      invoice = named == null
        ? await allocated()
        : await create(named).catch((err: unknown) => {
            if (isSequenceNumber(named, 'invoice') && isDocumentNumberConflict(err, 'invoice')) return allocated();
            throw err;
          });
    } catch (err) {
      if (claim && err instanceof CreateSlotTaken) return this.takenCreateSlot(input.businessId, 'invoice', claim, loadCreated);
      throw err;
    }
    // W3-V1-45c-EVENT-REPLAY review CR-V45c-1: the create that wrote it claims its one event too.
    if (claim) this.withCreateEventClaim(invoice, input.businessId, claim);
    this.events.emit('invoice.created', {
      invoice,
      businessId: input.businessId,
      source: 'manual',
      quoteId: null,
    } as InvoiceCreatedPayload);
    this.statsCache.invalidateCache(input.businessId);
    return invoice;
  }

  async listInvoices(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        // DEP-R3-OWN-ROW-READS (D-75): the list row's payments are the invoice's
        // own tenant's (the web reads its paid share from them, M31).
        include: { contact: true, quote: true, payments: { where: { businessId } }, items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.invoice.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async bulkUpdateInvoices(businessId: string, rawIds: unknown, action: 'send' | 'void' | 'delete') {
    // FOLLOW3-B6 review SEC-B6-2: checked before any read (requireInvoiceBulkIds).
    const ids = CommerceService.requireInvoiceBulkIds(rawIds);
    if (action === 'delete') {
      // Delete is not a state transition (FOLLOW3-B6, D-66: bulkDeleteInvoices).
      return this.bulkDeleteInvoices(businessId, ids);
    }
    // 'send' / 'void' route through the workflow so the state machine is
    // enforced per-row; illegal transitions silently no-op (the bulk caller
    // does not want a single bad row to fail the whole batch).
    const target: InvoiceStatus = action === 'send' ? 'SENT' : 'VOID';
    const candidates = await this.prisma.client.invoice.findMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      select: { id: true, status: true },
    });
    let updated = 0;
    // Failures are COLLECTED, not swallowed. `updated` was always honest, but a
    // run where every row failed returned { updated: 0 } with no reason
    // attached — so KEY could only report "nothing happened" and the owner had
    // no way to learn that all ten invoices were already paid, or already void.
    const failed: Array<{ id: string; reason: string }> = [];
    for (const row of candidates) {
      try {
        await this.invoiceWorkflow.transition(
          row.id,
          target,
          target === 'SENT' ? { sentAt: new Date() } : {},
        );
        updated++;
      } catch (err: any) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`bulk ${action}: skipping ${row.id}: ${reason}`);
        failed.push({ id: row.id, reason });
      }
    }
    this.statsCache.invalidateCache(businessId);
    return { updated, action, failed, failedCount: failed.length };
  }

  /**
   * V1-50: `send` and `reject` go through the quote transition table
   * (quote-workflow.ts), row by row, with the same compare-and-set move as the
   * status route (moveQuoteStatus), so a bulk send mints a DRAFT's view token
   * only when it has none and a bulk reject stamps rejectedAt (it used to
   * leave rejectedAt empty). A row already in the target status is left as it
   * is; a row the table refuses (decided, converted), or that the bulk action
   * does not move from (bulk reject moves only a quote whose link is out, as
   * before V1-50: see decideQuoteBulkMove), is left as it is and listed in
   * `skipped`. `delete` is not a status move and keeps its rule.
   *
   * V1-50 review:
   * - SEC-V50-1, SEC-V50-2, CR-V150-1: the body is checked before any read or
   *   write (requireQuoteBulkRequest). An unknown or missing action is a 400
   *   (it fell through to `reject`, which is final), and so are missing or
   *   empty ids (Prisma drops `id: { in: undefined }`, which reached every
   *   quote of the tenant).
   * - SEC-V50-3: each bulk move is recorded as the status route records it. A
   *   bulk reject emits quote.rejected (source internal, so no customer or
   *   owner email) with the tenant-checked contact; a bulk send keeps its
   *   minimal quote.sent ({ id, status, sentAt, viewToken }, no contact, so
   *   flow.listener emails no customer, as before). Both write the contact
   *   timeline entry naming the actor: `actorId`, else the authenticated user
   *   the request runs as (TenantInterceptor's context, for this tenant only;
   *   the controller, outside the V1-50 write set, forwards none), else SYSTEM.
   */
  async bulkUpdateQuotes(businessId: string, ids: unknown, action: unknown, actorId?: string | null) {
    const request = requireQuoteBulkRequest(ids, action);
    const where = { id: { in: request.ids }, businessId, deletedAt: null };
    if (request.action === 'delete') {
      // V1-QUOTE-CHAIN-finish (review SEC-4 / CR-W10-1): bulk delete refuses
      // what the single DELETE refuses (V1-53, 409 quote_converted): a quote
      // converted to an invoice, whatever its stored status. It filtered on
      // the status only, so a converted quote stored SENT (a legacy row, or one
      // the old ai-execute send_quote re-opened) was soft-deleted with its
      // invoice still linked. Each refused row is listed in `skipped`, as the
      // status actions list theirs; the write carries the same conditions, so
      // a quote converted after this read is not deleted either.
      const deletable = new Set(['DRAFT', 'SENT', 'REJECTED', 'EXPIRED']);
      const rows = await this.prisma.client.quote.findMany({ where, select: { id: true, status: true, invoiceId: true } });
      const skipped: Array<{ id: string; quoteStatus: string; code: string }> = [];
      const eligible: string[] = [];
      for (const row of rows) {
        if (isConvertedQuote(row)) skipped.push({ id: row.id, quoteStatus: row.status, code: 'quote_converted' });
        else if (!deletable.has(row.status)) skipped.push({ id: row.id, quoteStatus: row.status, code: 'quote_bulk_not_eligible' });
        else eligible.push(row.id);
      }
      const result = eligible.length
        ? await this.prisma.client.quote.updateMany({
            where: {
              id: { in: eligible },
              businessId,
              deletedAt: null,
              invoiceId: null,
              status: { in: [...deletable] as QuoteStatus[] },
            },
            data: { deletedAt: new Date() },
          })
        : { count: 0 };
      this.statsCache.invalidateCache(businessId);
      return { updated: result.count, action: request.action, skipped, skippedCount: skipped.length };
    }
    const bulkAction = request.action;
    const target = quoteBulkTarget(bulkAction);
    const ambient = getTenantContext();
    const actor = actorId ?? (ambient?.businessId === businessId ? ambient.userId : undefined);
    const rows = await this.prisma.client.quote.findMany({
      where,
      select: { id: true, status: true, viewToken: true, invoiceId: true },
    });
    let updated = 0;
    const skipped: Array<{ id: string; quoteStatus: string; code: string }> = [];
    for (const row of rows) {
      const decision = decideQuoteBulkMove(row, bulkAction);
      if (decision.kind === 'noop') continue;
      if (decision.kind === 'refuse') {
        skipped.push({ id: row.id, quoteStatus: row.status, code: quoteBulkRefusalCode(decision.reason) });
        continue;
      }
      const now = new Date();
      let moved: Awaited<ReturnType<CommerceService['moveQuoteStatus']>>;
      try {
        moved = await this.moveQuoteStatus(row, target, now);
      } catch (err) {
        if (err instanceof NotFoundException) continue; // deleted meanwhile
        if (!(err instanceof ConflictException)) throw err;
        const body = err.getResponse() as { code?: string; quoteStatus?: string };
        skipped.push({ id: row.id, quoteStatus: body.quoteStatus ?? row.status, code: body.code ?? 'quote_status_changed' });
        continue;
      }
      if (!moved.moved) continue;
      updated++;
      const eventQuote = forQuoteEvent(moved.row, withTenantContact(moved.row));
      if (target === 'SENT') {
        const { id, status, sentAt, viewToken } = moved.row;
        this.events.emit('quote.sent', { quote: { id, status, sentAt, viewToken }, businessId } as QuoteSentPayload);
      } else {
        this.events.emit('quote.rejected', {
          quote: eventQuote,
          businessId,
          rejectedAt: now,
          source: 'internal',
          reason: null,
        } as QuoteRejectedPayload);
      }
      await this.logQuoteMoveOnTimeline(eventQuote, target, { actorId: actor, source: 'internal' });
    }
    this.statsCache.invalidateCache(businessId);
    return { updated, action: bulkAction, skipped, skippedCount: skipped.length };
  }

  /**
   * FOLLOW3-B6 (owner ruling D-66): only a DRAFT or a VOID invoice may be
   * deleted; an issued invoice is voided first (the void reverses its
   * recognition). The guard was PAID / PARTIALLY_PAID alone, and a delete
   * reverses nothing, while every reader (listInvoices, receivables, aging)
   * drops a deleted invoice: an ACCRUAL invoice of 100 sent and deleted left
   * AR 100 in the trial balance for an invoice nothing listed, and an OVERDUE
   * or FAILED invoice with 40 received left that cash (and AR 60, or CASH
   * income 40) against a deleted document. The refusal (409, nothing written,
   * no invoice.deleted) names the status and the remedy (invoiceDeleteRefusal).
   */
  async deleteInvoice(invoiceId: string, businessId: string) {
    const outcome = await this.softDeleteInvoiceRow(invoiceId, businessId, { liveOnly: false });
    if (outcome.kind === 'missing') {
      throw new NotFoundException('Invoice not found');
    }
    if (outcome.kind === 'refused') {
      // R0-D3: a state guard is a 409, not a 500.
      throw new ConflictException(outcome.reason);
    }
    this.events.emit('invoice.deleted', { businessId, invoiceId });
    this.statsCache.invalidateCache(businessId);
    return outcome.row;
  }

  /**
   * FOLLOW3-B6 (owner ruling D-66): the bulk and KEY delete deletes only what
   * the single DELETE deletes, row by row through the same locked check
   * (softDeleteInvoiceRow): a DRAFT or VOID invoice that holds no money
   * received and no issued recognition. It was one updateMany over
   * `status notIn [PAID, PARTIALLY_PAID]`, so a SENT invoice with its
   * receivable posted, or an OVERDUE one with money received, was soft-deleted
   * with both left in the books. Each refused row is listed in `skipped` with
   * its status and the single route's reason, as bulk quote delete lists its
   * own; ids of another business, unknown or already deleted are left out, as
   * before, and no invoice.deleted is emitted, as before.
   */
  private async bulkDeleteInvoices(businessId: string, ids: string[]) {
    const candidates = await this.prisma.client.invoice.findMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      select: { id: true },
    });
    let updated = 0;
    const skipped: Array<{ id: string; invoiceStatus: string; reason: string }> = [];
    for (const row of candidates) {
      const outcome = await this.softDeleteInvoiceRow(row.id, businessId, { liveOnly: true });
      if (outcome.kind === 'deleted') updated++;
      else if (outcome.kind === 'refused') skipped.push({ id: row.id, invoiceStatus: outcome.status, reason: outcome.reason });
    }
    this.statsCache.invalidateCache(businessId);
    return { updated, action: 'delete' as const, skipped, skippedCount: skipped.length };
  }

  /**
   * FOLLOW3-B6 review SEC-B6-2: the ids of a bulk invoice request, or a 400
   * (invoice_bulk_ids_required) unless they are a non-empty array of non-empty
   * strings, as quotes check theirs (requireQuoteBulkRequest). The route's
   * body is a plain type, so the ValidationPipe checks nothing, and Prisma
   * drops `id: { in: undefined }`: a request naming no invoice reached every
   * invoice of the business (a delete deleted every clean DRAFT and VOID one,
   * a void voided every voidable one), and null or [123] answered 500.
   */
  private static requireInvoiceBulkIds(ids: unknown): string[] {
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
      throw new BadRequestException({
        code: 'invoice_bulk_ids_required',
        message: 'ids must be a non-empty array of invoice ids.',
      });
    }
    return ids as string[];
  }

  /**
   * FOLLOW3-B6 (D-66): the soft delete of one invoice, shared by the single
   * DELETE (deleteInvoice), the bulk / KEY delete (bulkUpdateInvoices) and the
   * AI undo of a DRAFT (undoInvoice, review SEC-B6-1). One
   * transaction that first takes the invoice row lock every money door takes
   * (lockInvoiceForPayment) and decides on the row and its payments as they
   * stand under it, so a payment, a Send or a void that commits meanwhile is
   * either seen or waits for the delete. `liveOnly` (bulk) leaves an invoice
   * already deleted alone; the single route re-stamps one, as before. Emits
   * nothing: the caller does, after the commit.
   */
  private async softDeleteInvoiceRow(invoiceId: string, businessId: string, opts: { liveOnly: boolean }) {
    return this.prisma.client.$transaction(async (tx) => {
      const txClient = tx as unknown as Prisma.TransactionClient;
      const locked = await CommerceService.lockInvoiceForPayment(txClient, invoiceId);
      if (!locked || locked.businessId !== businessId) return { kind: 'missing' as const };
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, businessId, ...(opts.liveOnly ? { deletedAt: null } : {}) },
      });
      if (!invoice) return { kind: 'missing' as const };
      const reason = await CommerceService.invoiceDeleteRefusal(txClient, invoice);
      if (reason) return { kind: 'refused' as const, status: invoice.status, reason };
      const row = await tx.invoice.update({ where: { id: invoiceId }, data: { deletedAt: new Date() } });
      return { kind: 'deleted' as const, row };
    });
  }

  /**
   * FOLLOW3-B6 (owner ruling D-66): why this invoice may not be deleted, or
   * null when it may. Read on the delete's transaction, under the invoice row
   * lock. Deletable: a DRAFT or VOID invoice that holds no money received net
   * of refunds (balanceOfStoredRows over its own-tenant Payment rows) and, for
   * a DRAFT, no issued recognition or credit note (holdsIssuedMoney: the AI
   * undo returns an issued invoice to DRAFT with its recognition kept, as
   * D-60 reads it, FOLLOW3-B2). Refused:
   *  - PAID and PARTIALLY_PAID, with the message they always had;
   *  - money received on it: refund it first (then void it, when it may be
   *    voided); a VOID invoice still holding money (voided before FOLLOW3-B1
   *    closed that door) is refused too;
   *  - any other issued invoice: void it first (DRAFT, SENT, PENDING, OVERDUE
   *    and FAILED may be voided, and the void reverses the recognition); a
   *    credited invoice cannot be voided and stays on the books.
   */
  private static async invoiceDeleteRefusal(
    tx: Prisma.TransactionClient,
    invoice: { id: string; businessId: string; status: string; total: number; currency: string | null },
  ): Promise<string | null> {
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      return 'Cannot delete a paid or partially paid invoice';
    }
    const payments = await tx.payment.findMany({
      where: { invoiceId: invoice.id, businessId: invoice.businessId },
      select: { amount: true, status: true },
    });
    const { net } = balanceOfStoredRows(Number(invoice.total), payments, invoice.currency);
    const holdsMoney = net > 0;
    const returnedToDraft = invoice.status === 'DRAFT' && (await CommerceService.holdsIssuedMoney(tx, invoice));
    const deletableStatus = invoice.status === 'DRAFT' || invoice.status === 'VOID';
    if (deletableStatus && !holdsMoney && !returnedToDraft) return null;

    const article = /^[AEIOU]/.test(invoice.status) ? 'an' : 'a';
    const what = returnedToDraft ? 'an issued invoice returned to DRAFT' : `${article} ${invoice.status} invoice`;
    const mayVoid = invoice.status !== 'VOID' && isLegalTransition(invoice.status as InvoiceStatus, 'VOID');
    if (holdsMoney) {
      const received = `${normalizeCurrency(invoice.currency)} ${net.toFixed(2)}`;
      return `Cannot delete ${what}: it holds ${received} received; refund the money received first${mayVoid ? ', then void it' : ''}`;
    }
    if (returnedToDraft) {
      return `Cannot delete ${what}: its issued total is still on the books; void it first`;
    }
    return `Cannot delete ${what}: only DRAFT and VOID invoices can be deleted${mayVoid ? '; void it first' : ''}`;
  }

  /**
   * Undo an AI-created invoice. If it is still a draft, soft-delete it;
   * otherwise revert it to DRAFT so a human can review.
   *
   * V1-42-DM-LIFECYCLE-OWNER-CAS (CF-39): the status move goes through the
   * workflow, compare-and-set (InvoiceWorkflowService.returnToDraftOnUndo),
   * not a raw write. VOID is terminal: undoing it is a 409.
   *
   * V1-42 review (SEC-V42-1, CR-V42-3): the undo stays non-terminal. It does
   * not void an issued invoice: VOID cannot be undone, and the routes that
   * reach this (agent undo, plan-step undo) check no revenue scope and do not
   * bind the undo's tenant to the route's, and a status alone does not say
   * whether money is on the invoice (an OVERDUE or FAILED invoice may carry a
   * payment). The invoice's payments and its accrual recognition are left as
   * they are; re-issuing it posts nothing twice.
   *
   * FOLLOW3-B6 review SEC-B6-1 (D-66): the undo of a DRAFT is a delete, so it
   * takes the delete's locked check (softDeleteInvoiceRow). A DRAFT an earlier
   * undo returned from an issued status still holds its recognition or the
   * money received on it, and is refused 409 as the DELETE route refuses it;
   * it soft-deleted any DRAFT, leaving that AR, income and cash in the books.
   */
  async undoInvoice(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { id: true, status: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === 'DRAFT') {
      const outcome = await this.softDeleteInvoiceRow(invoiceId, businessId, { liveOnly: false });
      if (outcome.kind === 'missing') throw new NotFoundException('Invoice not found');
      if (outcome.kind === 'refused') throw new ConflictException(outcome.reason);
      return { id: invoiceId, status: 'deleted' };
    }
    const reverted = await this.invoiceWorkflow.returnToDraftOnUndo(invoiceId);
    this.statsCache.invalidateCache(businessId);
    return { id: invoiceId, status: 'reverted_to_draft', invoice: reverted };
  }

  /**
   * DEP-R3-OWN-ROW-READS (D-75): the one read of OPERATOR_INVOICE_INCLUDE,
   * shared by `getInvoiceWithBusiness` and `getInvoiceForBusiness`. Its
   * payment rows are the invoice's own tenant's (ownTenantPayments, the
   * contract the reconcile and getBalance read by): Payment sits outside the
   * tenant extension and has no FK to Business (M31), so a row carrying
   * another businessId is not this invoice's money. Served, it showed a SENT
   * invoice nothing was received on as paid to the operator (paidAmount,
   * the Payment Summary the pages draw from the rows) and in every email
   * built from this read.
   *
   * Review SEC-OR-1 / CR-1: fails closed on an absent id. This is a findFirst,
   * and Prisma drops an `id: undefined` key, so a missing id would read the
   * first invoice in scope (any tenant's outside a request: the KEY
   * get_invoice command passes `parameters.invoiceId` unchecked) where the
   * findUnique it replaced threw. A non-string id (a filter object) is refused
   * the same way.
   */
  private async readOperatorInvoice(invoiceId: string, scope: Prisma.InvoiceWhereInput = {}) {
    if (typeof invoiceId !== 'string' || invoiceId.length === 0) return null;
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { ...scope, id: invoiceId },
      include: OPERATOR_INVOICE_INCLUDE,
    });
    if (!invoice) return null;
    return { ...invoice, payments: ownTenantPayments(invoice) };
  }

  async getInvoiceWithBusiness(invoiceId: string, requireShareable = false) {
    const invoice = await this.readOperatorInvoice(invoiceId);

    if (!invoice) return null;

    if (requireShareable) {
      const shareableStatuses = ['SENT', 'PAID', 'OVERDUE', 'PARTIALLY_PAID'];
      if (!shareableStatuses.includes(invoice.status)) {
        return null;
      }
    }

    return withLegacySubtotal(invoice);
  }

  /**
   * R0-QI-01 — the operator app's invoice detail and edit pages read this
   * instead of the public bare-id route (`getInvoiceForViewer`). Same operator
   * shape as `getInvoiceWithBusiness`, bound to the tenant the guards
   * admitted: a cross-tenant id, an unknown id and a soft-deleted row all read
   * as absent, which the controller turns into one 404. No shareable gate —
   * the operator opens DRAFT and VOID. `paidAmount`/`remaining` are the same
   * payments-derived figures `listPayments` serves, so the pages' Payment
   * Summary needs no second call.
   */
  async getInvoiceForBusiness(invoiceId: string, businessId: string) {
    const invoice = await this.readOperatorInvoice(invoiceId, { businessId, deletedAt: null });
    if (!invoice) return null;
    // V1-22: summed and subtracted in cents (the float sum read 0.01 + 33.33 x 3 as 99.99999999999999).
    // CR-V22-1: remaining is 0 once the paid sum settles the stored total.
    // V1-29 (CF-17): computeBalance's net and remaining, so a refund row counts;
    // a row flipped before V1-29 is read as its payment plus its refund (CR-V29-4).
    const balance = balanceOfStoredRows(Number(invoice.total), invoice.payments, invoice.currency);
    return {
      ...withLegacySubtotal(invoice),
      paidAmount: balance.net,
      remaining: balance.remaining,
    };
  }

  /**
   * KF-REVENUE-AUTH-PROJECTION-001 review (RCR-01) — `GET /commerce/invoices/:id`
   * has two readers, not one. The customer pay page is anonymous and gets the
   * public projection below. The operator app's invoice detail and edit pages
   * load the same route with the operator's bearer token (client.ts
   * `getInvoice`), and they read what the projection withholds: the payment
   * rows behind the Payment Summary, the customer's email for the reminder
   * composer, and `contactId` for the edit form. Serving them the projection
   * showed "Paid 0.00" on every part-paid invoice.
   *
   * The viewer gets the full operator shape only when they could pass the
   * tenant routes for this invoice's business: SUPER_ADMIN, or a member whose
   * revenue scope is at least `read` — the answer ModuleScopeGuard gives,
   * evaluated here because this route is public by design and carries neither
   * guard. Everyone else gets the projection, which is what an anonymous
   * caller gets; a membership carrying `revenue: none` is anonymous for
   * revenue purposes (RA-G7-04), and so is a member of another tenant.
   *
   * The shareable gate is the same for both readers: on main the route
   * answered null for DRAFT/VOID to everyone, and this packet does not widen
   * what the route serves.
   *
   * V1-46b-TOKEN-PAY-COMPLETE (M34, D-07: token links only): the projection
   * branch also passes the bare-id link gate (`isBareIdPublicAccessOpen`), so
   * once every link of the invoice is revoked or expired the id no longer
   * opens it: the same null, so the same 404 as an unknown id. The operator
   * branch is unchanged.
   */
  async getInvoiceForViewer(invoiceId: string, viewer?: { id?: string; role?: string } | null) {
    if (viewer?.id && (await this.viewerMayReadInvoiceAsOperator(invoiceId, viewer.id, viewer.role))) {
      return this.getInvoiceWithBusiness(invoiceId, true);
    }
    const view = await this.getInvoicePublicView(invoiceId);
    if (!view || !(await this.isBareIdPublicAccessOpen(invoiceId))) return null;
    return view;
  }

  /**
   * V1-46b-TOKEN-PAY-COMPLETE (M34, review ST-1; D-07: token links only) —
   * the gate every anonymous bare-id invoice route passes: the public read
   * (GET /commerce/invoices/:id, non-operator branch), the status poll and
   * gateway list of payments.controller.ts, and the generic checkout's
   * invoice payables. The customer pays through the token routes; the id
   * alone must not outlive the link the business revoked.
   *
   * Closed (false) for an unknown invoice and for one whose own-tenant links
   * are ALL inactive or past their expiry: revoking or letting the link lapse
   * then stops the bare-id routes too, not only the token routes. Open while
   * the invoice has a live link, and for an invoice that never had a link,
   * which keeps the KF-REVENUE-AUTH-PROJECTION-001 answer pinned by
   * release0-journey step 6 (a separate decision; no link was revoked there).
   * A link row of another tenant (M31: no FK ties the two) is not one of this
   * invoice's links in either direction.
   */
  async isBareIdPublicAccessOpen(invoiceId: string): Promise<boolean> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!invoice) return false;
    const links = await this.prisma.client.paymentLink.findMany({
      where: { invoiceId, businessId: invoice.businessId },
      select: { active: true, expiresAt: true },
    });
    if (links.length === 0) return true;
    const now = new Date();
    return links.some((l) => l.active && (!l.expiresAt || l.expiresAt > now));
  }

  /**
   * Mirrors ModuleScopeGuard's legacy answer for `revenue >= read` — an
   * explicit scope map, else the role defaults, SUPER_ADMIN unconditionally —
   * for the one route that cannot carry the guard. It is not a new authority
   * model: it is the guard's rule, restated once, for the operator reader.
   */
  private async viewerMayReadInvoiceAsOperator(invoiceId: string, userId: string, role?: string): Promise<boolean> {
    if (role === 'SUPER_ADMIN') return true;
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!invoice) return false;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId: invoice.businessId } },
    });
    if (!membership) return false;
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    return rankOf(scopes.revenue || 'none') >= LEVEL_RANK.read;
  }

  /**
   * FOLLOW3-A1-D46-COMMERCE-WRITES review (SEC-A1-1): the authority check of a
   * human actor on the bare-id writes (markInvoicePaid,
   * markInvoicePaymentFailed, updateInvoiceStatus, updateQuoteStatus). Their
   * routes carry no :businessId and ModuleScopeGuard admits SUPER_ADMIN without
   * a scope, so this is that role's only barrier there and on ai-execute. It
   * used to require only that a Membership exist, so a SUPER_ADMIN member whose
   * revenue level was read or none marked invoices paid, voided them and moved
   * quote status, where every guarded twin refused it (FOLLOW3-A2: a membership
   * alone is not enough). It is now ModuleScopeGuard's legacy rule, restated as
   * payment-evidence.service.ts and CommerceController do: the Membership in
   * `businessId` (the document's own) whose scope map, or without one the role
   * defaults, holds revenue:write. No membership keeps its answer ('Not
   * authorized to update this invoice' / '... quote'); one below write gets the
   * guard's message. Every other human caller already passed the guard's
   * revenue:write check on the same business, so its outcome is unchanged.
   * The lookup stays findFirst on (businessId, userId), as before.
   */
  private async assertActorMayWriteRevenue(businessId: string, actorId: string, subject: 'invoice' | 'quote'): Promise<void> {
    const membership = await this.prisma.client.membership.findFirst({
      where: { businessId, userId: actorId },
    });
    if (!membership) {
      throw new ForbiddenException(`Not authorized to update this ${subject}`);
    }
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }

  /**
   * KF-REVENUE-AUTH-PROJECTION-001 (G5) — the public, unauthenticated view of
   * an invoice for the id-based pay page (`GET /commerce/invoices/:id`).
   *
   * `getInvoiceWithBusiness` above is the full operator shape: every payment
   * row (reference, notes, evidence URL, who recorded it), the customer's
   * email and the business's document templates. Five server-side callers
   * depend on that shape (the email paths, the receipt listener, the token
   * route, the KEY adapter) and it is unchanged. The public route used to
   * return it to anyone holding an invoice id; it now returns this projection,
   * which is the shape the token route already hand-builds as its public-safe
   * contract, plus the fields the pay page (pay/[invoiceId]/page.tsx) reads
   * beyond that shape: the invoice's own arithmetic (subtotal, tax, discount —
   * printed on the invoice), the tenant key for its presence tracker,
   * `paid`/`remaining` from the canonical balance so the page can show
   * progress without seeing a single row, and the business's public profile.
   *
   * The business block is the profile the storefront and presence routes
   * already serve to anyone (site.service.ts, presence.service.ts): name,
   * logo, colours, contact details, address and social handles — the pay page
   * renders all of them (header gradient, address under the name, the cash
   * block, the footer links). Withholding them bought no confidentiality and
   * blanked those sections for every customer (review RCR-02). What stays
   * private is what no public route serves: the document template choices,
   * `metaData` (bank details), the customer's email and the payment rows.
   *
   * Same shareable-status gate as the token route; null otherwise, which the
   * controller turns into the same 404 as an unknown id.
   *
   * V1-46: the bare-id pay page is retired (D-07); the customer pay page at
   * /pay/link/[token] reads this same projection, less the invoice id,
   * through `getPayPageByToken`. V1-46b: the bare-id route serves it only
   * while `isBareIdPublicAccessOpen` holds (getInvoiceForViewer), and
   * widgets/pay/[invoiceId] no longer reads it (retired).
   */
  async getInvoicePublicView(invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        businessId: true,
        invoiceNumber: true,
        status: true,
        subtotal: true,
        taxRate: true,
        taxAmount: true,
        discountType: true,
        discountValue: true,
        discountAmount: true,
        total: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        notes: true,
        items: { select: { id: true, description: true, quantity: true, unitPrice: true, total: true } },
        payments: { select: { amount: true, status: true, businessId: true } },
        contact: { select: { firstName: true, lastName: true } },
        business: {
          select: {
            name: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            country: true,
            website: true,
            facebook: true,
            instagram: true,
            twitter: true,
            whatsapp: true,
          },
        },
      },
    });
    if (!invoice) return null;

    if (!isShareableInvoiceStatus(invoice.status)) return null;

    // DEP-R3-OWN-ROW-READS (D-75): paid/remaining from the invoice's own-tenant
    // rows, as the intent this page posts decides from them (trial-N round 2
    // F1): a row of another business (M31) showed the customer nothing due on
    // an invoice the business has received nothing on (RC2-DEP-1).
    const balance = balanceOfStoredRows(Number(invoice.total), ownTenantPayments(invoice), invoice.currency);
    // Same legacy-row fallback as getInvoiceWithBusiness: older invoices stored
    // subtotal 0 with priced items.
    const subtotal =
      (!invoice.subtotal || invoice.subtotal === 0) && invoice.items.length > 0
        ? invoice.items.reduce((sum, item) => sum + (item.total || 0), 0)
        : invoice.subtotal;
    const taxAmount =
      (!invoice.subtotal || invoice.subtotal === 0) && invoice.items.length > 0
        ? invoice.taxAmount ?? (invoice.taxRate ? subtotal * (invoice.taxRate / 100) : 0)
        : invoice.taxAmount;

    return {
      id: invoice.id,
      // The tenant key is already public-facing (public product and gateway
      // routes are keyed by it); the pay page's presence tracker reads it.
      businessId: invoice.businessId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      total: invoice.total,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      subtotal,
      taxRate: invoice.taxRate,
      taxAmount,
      discountType: invoice.discountType,
      discountValue: invoice.discountValue,
      discountAmount: invoice.discountAmount,
      items: invoice.items,
      contact: invoice.contact ? { firstName: invoice.contact.firstName, lastName: invoice.contact.lastName } : null,
      business: invoice.business
        ? {
            name: invoice.business.name,
            logoUrl: invoice.business.logoUrl,
            primaryColor: invoice.business.primaryColor,
            secondaryColor: invoice.business.secondaryColor,
            email: invoice.business.email,
            phone: invoice.business.phone,
            address: invoice.business.address,
            city: invoice.business.city,
            country: invoice.business.country,
            website: invoice.business.website,
            facebook: invoice.business.facebook,
            instagram: invoice.business.instagram,
            twitter: invoice.business.twitter,
            whatsapp: invoice.business.whatsapp,
          }
        : null,
      // FOLLOW3-A4-PUBLIC-PAID-NET (CR-29b-1): the net received, max(0, net),
      // the figure the public receipt states. It was the gross `paid`, so a
      // refunded payment still read as paid on the customer's pay page.
      paid: Math.max(0, balance.net),
      remaining: balance.remaining,
    };
  }

  /**
   * @param businessId Tenant the caller believes this invoice belongs to.
   *   Optional for existing callers that reach this behind a BusinessGuard, and
   *   ENFORCED whenever supplied — the lookup below is by primary key alone, so
   *   a guard establishes who is asking without constraining what is touched.
   *   REQUIRED when the actor is KEY: a system actor's authority comes from the
   *   tenant scope its caller established, and there is nothing else to check.
   */
  async markInvoicePaid(invoiceId: string, actorId?: string | null, businessId?: string) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true, status: true, total: true, currency: true },
    });
    // KF-REVENUE-AUTH-PROJECTION-001: these were plain `Error` throws, which the
    // global filter reports as 500 "Internal server error" — so a cross-tenant
    // attempt and a crash were indistinguishable to the caller and to the
    // error registry. They are HTTP errors now; the not-found/not-yours
    // collapse below is unchanged.
    if (!existingInvoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (businessId && existingInvoice.businessId !== businessId) {
      // Indistinguishable from "no such invoice" on purpose: a different error
      // for "exists but is not yours" confirms the id belongs to someone.
      throw new NotFoundException('Invoice not found');
    }
    if (isSystemActor(actorId)) {
      // KEY has no Membership by design — see core/auth/system-actor.ts. Its
      // authority is the tenant scope the caller proved, so demand that proof
      // rather than accepting the actor on its own word. Without this the
      // membership check below was the ONLY barrier on this path, and skipping
      // it for KEY would turn a tool that always failed into one that could
      // mark any invoice in any business paid.
      if (!businessId) {
        throw new ForbiddenException('Not authorized to update this invoice');
      }
    } else if (actorId) {
      // SEC-A1-1: a Membership holding revenue:write, not a Membership alone.
      await this.assertActorMayWriteRevenue(existingInvoice.businessId, actorId, 'invoice');
    }
    const reload = () =>
      this.prisma.client.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true, contact: true, booking: true },
      });
    // Idempotent: an invoice that is already PAID is returned as it is, and
    // nothing is written (no payment, posting, event or timeline entry).
    if (existingInvoice.status === 'PAID') {
      const paid = await reload();
      if (!paid) throw new NotFoundException('Invoice not found');
      return paid;
    }

    // R0-PL-04 (G2, PL-F05): the remaining balance is recorded as a payment
    // through recordPayment, so the payment row, its ledger posting, the
    // reconcile to PAID (paidAt, COGS) and invoice.paid commit together or not
    // at all (R0-PL-03), instead of a status flip plus a synthetic, unposted
    // payment row. A partially paid invoice gets one balancing payment, so a
    // later reconcile from the rows keeps it PAID. recordPayment owns the state
    // guard (DRAFT / VOID -> 409) and records the actor (R0-PL-07). The tenant
    // is the invoice's own, exactly as the synthetic row used; the authority
    // checks above are unchanged.
    // Trial-N round 2 (RC-DEP-2): the invoice's own-tenant rows (M31), as the
    // reconcile reads them (ownTenantPayments): a row of another business is
    // not money received, so it neither shrinks the payment recorded here nor
    // lets the status move to PAID with nothing recorded.
    const rows = await this.prisma.client.payment.findMany({
      where: { invoiceId, businessId: existingInvoice.businessId },
      select: { amount: true, status: true },
    });
    const balance = computeBalance(Number(existingInvoice.total), rows, existingInvoice.currency);
    if (balance.remaining > 0) {
      // R0-PL-04 review (CR-PL04-1): a balance mark-paid can not settle
      // truthfully (a manual refund on the invoice) is refused here, before
      // anything is written (see markPaidRemaining).
      const amount = CommerceService.markPaidRemaining(Number(existingInvoice.total), rows, existingInvoice.currency);
      try {
        await this.recordPayment(
          invoiceId,
          existingInvoice.businessId,
          { amount, method: 'MANUAL' },
          {
            actorId: actorId ?? null,
            provider: 'manual',
            expectRemaining: amount,
            // R0-PL-04 review (ST-PL04-1 / ST-PL04-2): a slot of mark-paid's
            // own, random and built here. No client idempotency key or
            // reference maps to it (those slots are manual_<inv>_key_ /
            // manual_<inv>_ref_), and nobody can predict it, so no client row
            // and no row the public WiPay callback writes can occupy it ahead
            // of this call. It keys no replay: two concurrent mark-paids are
            // serialized by the invoice lock, and the second finds the invoice
            // PAID (the 409 handled below) or its remaining changed.
            providerPaymentId: `manual_${invoiceId}_markpaid_${randomBytes(16).toString('hex')}`,
          },
        );
      } catch (err) {
        // A payment that settled the invoice committed while this one waited
        // for the invoice lock: the invoice is PAID, which is what was asked,
        // and this call wrote nothing. Any other refusal is the answer.
        if (err instanceof ConflictException) {
          const now = await reload();
          if (now?.status === 'PAID') return now;
        }
        throw err;
      }
    } else {
      // Nothing left to collect (a zero-total invoice, or payment rows that
      // already cover the total): no payment is invented; only the status moves.
      try {
        await this.invoiceWorkflow.transition(invoiceId, 'PAID');
      } catch (err) {
        // V1-42 review (CR-V42-2): as the recordPayment branch above. Another
        // mark-paid won the compare-and-set while this one was in flight: the
        // invoice is PAID, which is what was asked, and this call wrote
        // nothing. Any other refusal is the answer.
        if (err instanceof ConflictException) {
          const now = await reload();
          if (now?.status === 'PAID') return now;
        }
        throw err;
      }
    }
    const invoice = await reload();
    if (!invoice) throw new NotFoundException('Invoice not found');
    // R0-PL-04 review (ST-PL04-1 / CR-PL04-2): mark-paid answers 200 and logs
    // invoice.paid only for an invoice that is PAID now. Anything else (the
    // write left a balance, or a refund reopened the invoice before this read)
    // is a 409, never a success with a false invoice.paid timeline entry.
    if (invoice.status !== 'PAID') {
      throw new ConflictException(`Invoice is ${invoice.status}, not PAID; reload it and try again`);
    }

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.paid',
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          paidAt: invoice.paidAt,
          bookingId: invoice.booking?.id,
        },
        // R0-CMF1 review SEC-CMF1-4: KEY is a SYSTEM actor here as on
        // invoice.payment_recorded; it was labelled USER, so an audit that
        // filters actorType USER counted KEY's mark-paid as a person's.
        actorType: actorId && !isSystemActor(actorId) ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }
    
    return invoice;
  }

  /**
   * @param businessId Tenant the caller believes this invoice belongs to —
   *   same contract as markInvoicePaid: optional for existing callers,
   *   ENFORCED whenever supplied. The controller forwards the guard's tenant.
   */
  async markInvoicePaymentFailed(invoiceId: string, actorId?: string | null, reason?: string, businessId?: string) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true, status: true },
    });
    if (!existingInvoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (businessId && existingInvoice.businessId !== businessId) {
      // Indistinguishable from "no such invoice" on purpose — see markInvoicePaid.
      throw new NotFoundException('Invoice not found');
    }
    if (actorId) {
      // SEC-A1-1: a Membership holding revenue:write, not a Membership alone.
      await this.assertActorMayWriteRevenue(existingInvoice.businessId, actorId, 'invoice');
    }
    // V1-42 review (CR-V42-1): a failed attempt on an invoice that is already
    // FAILED (a second attempt failed, or a concurrent report of a failure won
    // the compare-and-set first) is answered with the invoice as it is: no
    // status write and no second invoice.payment_failed, since the workflow
    // refuses a same-status move 409 so that one mover emits. The attempt
    // itself is still logged on the timeline with its reason, as it was before
    // V1-42. Any other refusal is the answer.
    const reload = () =>
      this.prisma.client.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true, contact: true, booking: true },
      });
    const invoice =
      existingInvoice.status === 'FAILED'
        ? await reload()
        : await this.invoiceWorkflow.transition(invoiceId, 'FAILED').catch(async (err: unknown) => {
            if (err instanceof ConflictException) {
              const now = await reload();
              if (now?.status === 'FAILED') return now;
            }
            throw err;
          });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_failed',
        data: { invoiceId: invoice.id, reason },
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }
    return invoice;
  }

  async updateQuoteStatus(params: {
    quoteId: string;
    status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    actorId?: string | null;
    source?: 'public' | 'internal';
    reason?: string | null;
    /**
     * R0-28: the tenant the caller was admitted to. Optional for the callers
     * that resolve the quote themselves (the public token response, the
     * tenant-checked send-email route), but ENFORCED whenever supplied: the
     * lookup below is by primary key alone, and a guard proves which tenant is
     * asking, not which quote it may touch.
     */
    businessId?: string;
    /**
     * R0-CMF4 review (SEC-CMF4-1): a compare-and-set. The move is written only
     * while the quote is still in this status (and, with `viewToken`, has no
     * view token or that one). Otherwise nothing is written: a quote another
     * request already moved to the same status with the same token is
     * returned as it is, with no event, and any other state is a 409
     * `quote_status_changed`. Without it the move overwrites whatever the
     * quote became meanwhile.
     */
    ifStatus?: 'DRAFT';
    /**
     * R0-CMF4: with `ifStatus`, the view token the send-email route put in
     * the message Gmail accepted (sendQuoteWithViewToken). The move stores it.
     */
    viewToken?: string;
    /**
     * V1-QUOTE-CHAIN-finish (review SEC-5): the quoteTermsVersion of the terms
     * the customer saw (the public accept). The quote is read with its lines
     * and a different version is a 409 quote_terms_changed; the move is then a
     * compare-and-set on that read's updatedAt, so terms edited after the read
     * are re-checked rather than accepted (moveQuoteStatus).
     */
    termsVersion?: string;
  }) {
    // V1-50: the route forwards its path segment upper-cased but unchecked. A
    // value that is not one of the four targets used to reach Prisma: a 500,
    // or (`/status/converted`) a write of that enum value. It is a 400 now.
    const target = requireQuoteStatusTarget(params.status);
    const termsBound = params.termsVersion !== undefined;
    const existingQuote: (QuoteMoveSubject & QuoteTermsSubject & { businessId: string }) | null = termsBound
      ? await this.prisma.client.quote.findUnique({ where: { id: params.quoteId }, include: { items: true } })
      : await this.prisma.client.quote.findUnique({
          where: { id: params.quoteId },
          select: { id: true, businessId: true, status: true, viewToken: true, invoiceId: true },
        });
    // R0-28: unknown, soft-deleted and foreign ids answer the same 404 (they
    // were plain Errors, so 500s): a different answer for "exists but is not
    // yours" would confirm the id belongs to someone. V1-50: this stays ahead
    // of the transition table, so a 409 never describes a foreign quote.
    if (!existingQuote) {
      throw new NotFoundException('Quote not found');
    }
    if (params.businessId && existingQuote.businessId !== params.businessId) {
      throw new NotFoundException('Quote not found');
    }
    if (params.actorId) {
      // SEC-A1-1: a Membership holding revenue:write, not a Membership alone.
      await this.assertActorMayWriteRevenue(existingQuote.businessId, params.actorId, 'quote');
    }
    const now = new Date();
    // R0-CMF3 review (ST-CMF3-1, CR-CMF3-1): the status route, send-email and
    // the public accept/reject all land here. A legacy quote can still point
    // at another tenant's contact: the returned quote reads contact null, and
    // the events and the timeline write carry neither that contact nor its id.
    let row: QuoteWithContactRow;
    // The status the move was made from: the compare-and-set proved it.
    let priorStatus: string;
    if (params.ifStatus) {
      // R0-CMF4: with ifStatus the move is a compare-and-set on that status
      // (and, with `viewToken`, on no token or that one). V1-50: it must be a
      // move the table allows from ifStatus, on an unconverted quote.
      const decision = decideQuoteTransition({ status: params.ifStatus, invoiceId: existingQuote.invoiceId }, target);
      if (decision.kind !== 'move') {
        throw quoteTransitionRefusal(existingQuote, target, decision.kind === 'refuse' ? decision.reason : 'not_allowed');
      }
      const data: Prisma.QuoteUpdateManyMutationInput = { status: target };
      if (target === 'SENT') {
        data.sentAt = now;
        // The token the email carried; without one (no caller today), the quote's one mint.
        if (params.viewToken) data.viewToken = params.viewToken;
        else if (!existingQuote.viewToken) data.viewToken = mintQuoteViewToken();
      } else if (target === 'ACCEPTED') {
        data.acceptedAt = now;
      } else if (target === 'REJECTED') {
        data.rejectedAt = now;
      }
      const moved = await this.prisma.client.quote.updateMany({
        where: {
          id: params.quoteId,
          status: params.ifStatus,
          invoiceId: null,
          ...(params.viewToken ? { OR: [{ viewToken: null }, { viewToken: params.viewToken }] } : {}),
        },
        data,
      });
      if (moved.count === 0) {
        const current = await this.prisma.client.quote.findUnique({
          where: { id: params.quoteId },
          include: { contact: true },
        });
        if (!current) throw new NotFoundException('Quote not found');
        if (current.status === target && (!params.viewToken || current.viewToken === params.viewToken)) {
          return withTenantContact(current);
        }
        throw new ConflictException({
          code: 'quote_status_changed',
          message: `The quote is ${current.status}, not ${params.ifStatus}: it was not moved to ${target}.`,
          quoteStatus: current.status,
        });
      }
      row = await this.prisma.client.quote.findUniqueOrThrow({ where: { id: params.quoteId }, include: { contact: true } });
      priorStatus = params.ifStatus;
    } else {
      // V1-50: the transition table decides. An illegal move, or any move on a
      // converted quote, is a 409 and nothing is written. Asking for the status
      // the quote already has answers the quote as it is: no write, no second
      // token, no sentAt bump, no event, no timeline entry.
      const decision = decideQuoteTransition(existingQuote, target);
      if (decision.kind === 'refuse') throw quoteTransitionRefusal(existingQuote, target, decision.reason);
      // V1-QUOTE-CHAIN-finish (SEC-5): the terms the customer saw, checked
      // before a move and before a no-op answer alike.
      if (termsBound && quoteTermsVersion(existingQuote) !== params.termsVersion) throw quoteTermsChanged();
      if (decision.kind === 'noop') {
        // V1-50 review CR-V150-2: the one exception. A SENT quote written
        // without a view token (a legacy row: the ai-execute send_quote action
        // wrote one until V1-QUOTE-CHAIN-finish routed it through here)
        // has no public link; `sent` on it mints the quote's one token,
        // compare-and-set on no token, so overlapping requests store one.
        // The status does not change, so nothing is emitted or logged.
        if (target === 'SENT' && needsViewTokenRepair(existingQuote)) {
          await this.repairSentQuoteViewToken(params.quoteId);
        }
        const current = await this.prisma.client.quote.findUnique({ where: { id: params.quoteId }, include: { contact: true } });
        if (!current) throw new NotFoundException('Quote not found');
        return withTenantContact(current);
      }
      const moved = await this.moveQuoteStatus(
        existingQuote,
        target,
        now,
        termsBound ? { termsVersion: params.termsVersion as string } : undefined,
      );
      if (!moved.moved) return withTenantContact(moved.row);
      row = moved.row;
      priorStatus = existingQuote.status;
    }
    const quote = withTenantContact(row);
    const eventQuote = forQuoteEvent(row, quote);
    const source = params.source ?? 'internal';
    if (target === 'SENT' && priorStatus !== 'SENT') {
      this.events.emit('quote.sent', { quote: eventQuote, businessId: quote.businessId } as QuoteSentPayload);
    }
    if (target === 'ACCEPTED' && priorStatus !== 'ACCEPTED') {
      this.events.emit('quote.accepted', {
        quote: eventQuote,
        businessId: quote.businessId,
        acceptedAt: now,
        source,
      } as QuoteAcceptedPayload);
    }
    if (target === 'REJECTED' && priorStatus !== 'REJECTED') {
      this.events.emit('quote.rejected', {
        quote: eventQuote,
        businessId: quote.businessId,
        rejectedAt: now,
        source,
        reason: params.reason ?? null,
      } as QuoteRejectedPayload);
    }
    await this.logQuoteMoveOnTimeline(eventQuote, target, { actorId: params.actorId, source, reason: params.reason });
    this.statsCache.invalidateCache(existingQuote.businessId);
    return quote;
  }

  /**
   * V1-50 review CR-V150-2: mint the one view token of a SENT quote written
   * without one (needsViewTokenRepair), as a compare-and-set on "SENT, no
   * token, not converted, not deleted", so overlapping callers store a single
   * token. Used by the status route's `sent` no-op and by the public-link
   * route (V1-52). Writes nothing else: no status, sentAt, event or timeline.
   */
  private async repairSentQuoteViewToken(quoteId: string): Promise<void> {
    await this.prisma.client.quote.updateMany({
      where: { id: quoteId, status: 'SENT', viewToken: null, invoiceId: null, deletedAt: null },
      data: { viewToken: mintQuoteViewToken() },
    });
  }

  /**
   * V1-52-QUOTE-PUBLIC-LINK (CF-16): the customer link of a quote, for the
   * operator to copy or share by any channel, with no mail provider. The quote's
   * viewToken used to reach a customer only inside the Gmail send-email
   * message, so a business with no mailbox connected had no handoff at all.
   *
   * Bound to the path tenant the guards admitted: an unknown, soft-deleted or
   * foreign id is one 404. The link is the quote's existing token (the single
   * mint of V1-50) and `${appUrl()}/quote/<token>`, the page that reads
   * GET /commerce/public/quotes/:token and the URL quote-notifications.listener
   * builds. It is idempotent: an existing token is returned as stored and the
   * row is not written. The one write is the CR-V150-2 repair of a SENT quote
   * that has no token (repairSentQuoteViewToken). Nothing is emitted, logged or
   * posted: creating a link is not a send (no sentAt, no quote.sent) and no
   * ledger row is involved. The route opts out of the global business-event
   * audit (V1-52 review CR-V152-1), which would store the url in plain text.
   * The revenue:read list, stale and detail reads serve no token
   * (withoutViewToken, SEC-V52-1), so a member without revenue:write cannot
   * obtain the link from them either.
   *
   * Refusals, before any write:
   * - converted (invoiceId set, or INVOICED/PAID/CONVERTED): 400 quote_converted,
   *   as the public accept/reject answers it; the customer's document is the invoice;
   * - expired (stored EXPIRED, or an open SENT/VIEWED offer past its expiryDate,
   *   the rule respondToQuoteByToken applies): 400 quote_expired;
   * - DRAFT: 409 quote_not_sent. The public routes refuse a DRAFT, and a token
   *   send-email reserved on one belongs to the message Gmail has (R0-CMF4), so
   *   it is never disclosed here;
   * - a decided quote that was never sent (ACCEPTED or REJECTED with no token,
   *   an operator-recorded decision): 409 quote_link_unavailable.
   */
  async getQuotePublicLink(quoteId: string, businessId: string): Promise<{ token: string; url: string }> {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId, deletedAt: null },
      select: { id: true, status: true, viewToken: true, invoiceId: true, expiryDate: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (isConvertedQuote(quote)) {
      throw new BadRequestException({
        code: 'quote_converted',
        message: 'This quote has been converted to an invoice; share the invoice instead.',
      });
    }
    const openOffer = quote.status === 'SENT' || quote.status === 'VIEWED';
    if (quote.status === 'EXPIRED' || (openOffer && !!quote.expiryDate && new Date(quote.expiryDate).getTime() < Date.now())) {
      throw new BadRequestException({
        code: 'quote_expired',
        message: 'This quote has expired; extend its expiry date before sharing it.',
      });
    }
    if (quote.status === 'DRAFT') {
      throw new ConflictException({
        code: 'quote_not_sent',
        message: 'This quote is a draft: send it first, then share its link.',
      });
    }
    let token = quote.viewToken;
    if (!token && needsViewTokenRepair(quote)) {
      await this.repairSentQuoteViewToken(quote.id);
      token = (await this.prisma.client.quote.findFirst({ where: { id: quote.id, businessId }, select: { viewToken: true } }))?.viewToken ?? null;
    }
    if (!token) {
      throw new ConflictException({
        code: 'quote_link_unavailable',
        message: 'This quote was never sent, so it has no customer link.',
      });
    }
    return { token, url: `${appUrl()}/quote/${encodeURIComponent(token)}` };
  }

  /**
   * The contact timeline entry of a quote status move, naming who made it:
   * the status route, send-email and the public accept/reject
   * (updateQuoteStatus), and bulkUpdateQuotes (V1-50 review SEC-V50-3).
   * `eventQuote` is the forQuoteEvent shape, so a foreign contact (a legacy
   * row) is never logged against.
   */
  private async logQuoteMoveOnTimeline(
    eventQuote: { id: string; businessId: string; contactId: string | null; total: unknown; currency: string | null },
    target: QuoteStatusTarget,
    opts: { actorId?: string | null; source: 'public' | 'internal'; reason?: string | null },
  ): Promise<void> {
    if (!eventQuote.contactId) return;
    await this.crm.logContactEvent({
      businessId: eventQuote.businessId,
      contactId: eventQuote.contactId,
      type: `quote.${target.toLowerCase()}`,
      data: {
        quoteId: eventQuote.id,
        total: eventQuote.total,
        currency: eventQuote.currency,
        source: opts.source,
        reason: opts.reason ?? undefined,
      },
      actorType: opts.actorId ? 'USER' : 'SYSTEM',
      actorId: opts.actorId ?? undefined,
      source: 'commerce',
    });
  }

  /**
   * V1-50: the one write of a quote status move (the status route, the public
   * accept/reject and bulkUpdateQuotes), made after decideQuoteTransition said
   * "move". It is a compare-and-set on what the caller decided from: the
   * status, an unconverted and undeleted row, and for SENT the view token. A
   * DRAFT -> SENT move keeps a stored token (one send-email reserved) and
   * otherwise mints the quote's one token here, so two overlapping moves cannot
   * each mint one. When the row changed after it was read:
   * - it now has the requested status: nothing is written (`moved: false`);
   * - only its token changed (send-email reserved one meanwhile): the move is
   *   made once more on the fresh row, keeping that token;
   * - the table now refuses the move: that 409;
   * - otherwise 409 quote_status_changed (the caller decided from a status the
   *   quote no longer has).
   *
   * V1-QUOTE-CHAIN-finish (review SEC-5): with `terms` (the public accept) the
   * compare-and-set also holds the updatedAt of the row whose terms matched
   * the customer's version, so an edit committed after that read (every edit
   * writes the quote row, updateQuote) makes the write miss; the fresh row's
   * terms are then checked again (409 quote_terms_changed when they moved),
   * and a write that only touched something else is retried on the fresh row.
   */
  private async moveQuoteStatus(
    seen: QuoteMoveSubject,
    target: QuoteStatusTarget,
    now: Date,
    terms?: { termsVersion: string },
  ): Promise<{ moved: boolean; row: QuoteWithContactRow }> {
    let current = seen;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const data: Prisma.QuoteUpdateInput = { status: target };
      if (target === 'SENT') {
        data.sentAt = now;
        data.viewToken = current.viewToken ?? mintQuoteViewToken();
      } else if (target === 'ACCEPTED') {
        data.acceptedAt = now;
      } else if (target === 'REJECTED') {
        data.rejectedAt = now;
      }
      try {
        const row = await this.prisma.client.quote.update({
          where: {
            id: current.id,
            status: current.status as QuoteStatus,
            deletedAt: null,
            ...(terms ? { updatedAt: current.updatedAt } : {}),
            AND: [{ invoiceId: null }, ...(target === 'SENT' ? [{ viewToken: current.viewToken }] : [])],
          },
          data,
          include: { contact: true },
        });
        return { moved: true, row };
      } catch (err) {
        // P2025: no row matched the compare-and-set.
        if ((err as { code?: unknown } | null)?.code !== 'P2025') throw err;
      }
      const fresh = terms
        ? await this.prisma.client.quote.findUnique({ where: { id: current.id }, include: { contact: true, items: true } })
        : await this.prisma.client.quote.findUnique({ where: { id: current.id }, include: { contact: true } });
      if (!fresh) throw new NotFoundException('Quote not found');
      if (terms && quoteTermsVersion(fresh) !== terms.termsVersion) throw quoteTermsChanged();
      const decision = decideQuoteTransition(fresh, target);
      if (decision.kind === 'noop') return { moved: false, row: fresh };
      if (decision.kind === 'refuse') throw quoteTransitionRefusal(fresh, target, decision.reason);
      if (fresh.status !== current.status) {
        throw new ConflictException({
          code: 'quote_status_changed',
          message: `The quote is ${fresh.status}, not ${current.status}: it was not moved to ${target}.`,
          quoteStatus: fresh.status,
        });
      }
      current = fresh;
    }
    throw new ConflictException({
      code: 'quote_status_changed',
      message: `The quote changed while it was being moved to ${target}; it was not moved.`,
      quoteStatus: current.status,
    });
  }

  // R2: how many days a SENT quote can sit without a view/accept before
  // we surface it as a stale-quote candidate for the Action Queue.
  static readonly QUOTE_STALE_DAYS = 7;

  /**
   * R0-CMF4-SEND-EMAIL-ORDER (COST-LEDGER-001 section 7 item 2) and its
   * review (SEC-CMF4-1, SEC-CMF4-2, CR-CMF4-1): the operator's quote
   * send-email. `send` gets the view token to put in the accept/reject link
   * and resolves once Gmail accepted the message.
   *
   * - A quote with a view token sends that one. A non-DRAFT quote with none
   *   cannot be sent ('Quote view token missing').
   * - A DRAFT with none reserves one first: a compare-and-set on
   *   (DRAFT, no token), so of two overlapping sends one writes it and the
   *   other mails the same token, and a "mark sent" made meanwhile keeps it
   *   (updateQuoteStatus keeps a stored token). The public accept/reject
   *   routes refuse a DRAFT, and only the message being sent carries it.
   * - A send Gmail did not accept (503, transport error, Gmail's refusal)
   *   clears the token it reserved while the quote is still that DRAFT, so
   *   the DRAFT is left with no token (R2), no sentAt and no event.
   * - An accepted send moves the DRAFT to SENT with that token as a
   *   compare-and-set (updateQuoteStatus ifStatus). A quote another request
   *   moved to SENT with the same token is left as it is (one quote.sent);
   *   a quote rejected, accepted or given another token meanwhile is not
   *   overwritten, and the route answers 409 quote_changed_during_send,
   *   saying the email went out.
   */
  async sendQuoteWithViewToken<T>(quoteId: string, send: (viewToken: string) => Promise<T>): Promise<T> {
    const quote = await this.prisma.client.quote.findUnique({
      where: { id: quoteId },
      select: { status: true, viewToken: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    let viewToken = quote.viewToken;
    let reserved = false;
    if (!viewToken && quote.status === 'DRAFT') {
      const token = mintQuoteViewToken();
      const won = await this.prisma.client.quote.updateMany({
        where: { id: quoteId, status: 'DRAFT', viewToken: null },
        data: { viewToken: token },
      });
      reserved = won.count === 1;
      viewToken = reserved
        ? token
        : ((await this.prisma.client.quote.findUnique({ where: { id: quoteId }, select: { viewToken: true } }))?.viewToken ?? null);
    }
    if (!viewToken) {
      throw new Error('Quote view token missing — cannot send email.');
    }

    let result: T;
    try {
      result = await send(viewToken);
    } catch (err) {
      if (reserved) {
        await this.prisma.client.quote.updateMany({
          where: { id: quoteId, status: 'DRAFT', viewToken },
          data: { viewToken: null },
        });
      }
      throw err;
    }
    if (quote.status !== 'DRAFT') return result;
    try {
      await this.updateQuoteStatus({ quoteId, status: 'SENT', actorId: undefined, ifStatus: 'DRAFT', viewToken });
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      const quoteStatus = (err.getResponse() as { quoteStatus?: string }).quoteStatus ?? null;
      throw new ConflictException({
        code: 'quote_changed_during_send',
        message: `The email was sent, but the quote changed while it was with Gmail (it is ${quoteStatus ?? 'gone'} now), so this send left it as it is.`,
        emailSent: true,
        quoteStatus,
      });
    }
    return result;
  }

  private isStaleQuote(quote: {
    status: string;
    sentAt?: Date | null;
    viewedAt?: Date | null;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    lastFollowUpAt?: Date | null;
  }, now: Date = new Date()): boolean {
    if (quote.status !== 'SENT') return false;
    if (quote.viewedAt || quote.acceptedAt || quote.rejectedAt) return false;
    if (!quote.sentAt) return false;
    // R3: a recent follow-up reminder clears the stale state until the
    // quote ages another QUOTE_STALE_DAYS without progress.
    const reference = quote.lastFollowUpAt && new Date(quote.lastFollowUpAt) > new Date(quote.sentAt)
      ? new Date(quote.lastFollowUpAt)
      : new Date(quote.sentAt);
    const daysSinceReference = (now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceReference >= CommerceService.QUOTE_STALE_DAYS;
  }

  private decorateQuote<T extends {
    status: string;
    expiryDate?: Date | null;
    sentAt?: Date | null;
    viewedAt?: Date | null;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    invoiceId?: string | null;
    invoice?: { status?: string | null } | null;
  }>(quote: T, now: Date = new Date()): T & { isStale: boolean; isExpired: boolean; lifecycleStep: string } {
    const isExpired =
      !!quote.expiryDate &&
      new Date(quote.expiryDate).getTime() < now.getTime() &&
      quote.status !== 'ACCEPTED' &&
      !quote.invoiceId;
    let lifecycleStep: string = 'DRAFT';
    if (quote.invoice?.status === 'PAID') lifecycleStep = 'PAID';
    else if (quote.invoiceId) lifecycleStep = 'INVOICED';
    else if (quote.status === 'ACCEPTED') lifecycleStep = 'ACCEPTED';
    else if (quote.status === 'REJECTED') lifecycleStep = 'REJECTED';
    else if (quote.viewedAt && quote.status === 'SENT') lifecycleStep = 'VIEWED';
    else if (quote.status === 'SENT') lifecycleStep = 'SENT';
    return {
      ...quote,
      isStale: this.isStaleQuote(quote, now),
      isExpired,
      lifecycleStep,
    };
  }

  async updateInvoiceStatus(params: {
    invoiceId: string;
    status: 'SENT' | 'OVERDUE' | 'VOID';
    actorId?: string | null;
    sentAt?: Date | string;
    dueDate?: Date | string | null;
    /**
     * Tenant the caller believes this invoice belongs to.
     *
     * Optional for compatibility with existing callers that reach this behind a
     * BusinessGuard, but ENFORCED whenever supplied. A guard establishes which
     * tenant is asking; it does not constrain what a query touches, and the
     * lookup below is by primary key alone.
     *
     * This exists because the compensation handlers call this with an invoice id
     * lifted out of a saga payload and no tenant at all — so any id reaching
     * that path would void that invoice regardless of who owns it. Callers that
     * know the tenant should always pass it.
     */
    businessId?: string;
  }) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: params.invoiceId },
      select: { businessId: true, status: true },
    });
    if (!existingInvoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (params.businessId && existingInvoice.businessId !== params.businessId) {
      // Indistinguishable from "no such invoice" on purpose: a different error
      // for "exists but is not yours" confirms the id belongs to someone.
      throw new NotFoundException('Invoice not found');
    }
    if (isSystemActor(params.actorId)) {
      // See markInvoicePaid: KEY's authority is the proven tenant scope, so the
      // scope must actually have been supplied and checked above.
      if (!params.businessId) {
        throw new ForbiddenException('Not authorized to update this invoice');
      }
    } else if (params.actorId) {
      // SEC-A1-1: a Membership holding revenue:write, not a Membership alone.
      await this.assertActorMayWriteRevenue(existingInvoice.businessId, params.actorId, 'invoice');
    }
    // V1-42-DM-LIFECYCLE-OWNER-CAS: asking for the status the invoice already
    // holds is answered idempotently (the send-email of a DRAFT that another
    // send issued meanwhile, a KEY compensation voiding a VOID invoice): no
    // status write, no posting, no invoice.* event, no timeline entry. The
    // workflow refuses a same-status transition 409 so that of two racing
    // moves exactly one wins and emits; this route only answers the request.
    // A sentAt / dueDate it carries is still applied, as the transition
    // applied it before.
    // V1-42c (VR-01): this is therefore not a reminder. A caller that wants
    // the customer reminded of a SENT or OVERDUE invoice uses
    // sendInvoiceReminder (POST .../invoices/:id/send-reminder), which emails
    // and logs invoice.payment_reminder_sent; the Collections panel does.
    const answerHeldStatus = async () => {
      const fields: { sentAt?: Date; dueDate?: Date } = {};
      if (params.sentAt) fields.sentAt = new Date(params.sentAt);
      if (params.dueDate) fields.dueDate = new Date(params.dueDate);
      if (Object.keys(fields).length > 0) {
        await this.prisma.client.invoice.update({ where: { id: params.invoiceId }, data: fields });
      }
      const current = await this.prisma.client.invoice.findUnique({
        where: { id: params.invoiceId },
        include: { items: true, contact: true, booking: true },
      });
      if (!current) throw new NotFoundException('Invoice not found');
      return current;
    };
    if (existingInvoice.status === params.status) {
      return answerHeldStatus();
    }
    // Route through the workflow so transitions like PAID -> SENT throw
    // 409 instead of silently corrupting the row.
    let invoice: Awaited<ReturnType<InvoiceWorkflowService['transition']>>;
    try {
      invoice = await this.invoiceWorkflow.transition(params.invoiceId, params.status, {
        sentAt: params.sentAt ? new Date(params.sentAt) : undefined,
        dueDate: params.dueDate ? new Date(params.dueDate) : undefined,
      });
    } catch (err) {
      // V1-42 review (CR-V42-2): the check above reads the status outside the
      // transition, so of two overlapping requests for the same status both
      // pass it and the loser is refused 409 by the compare-and-set (two
      // send-emails of one DRAFT, each answered only after Gmail accepted its
      // message). A request that lost to a move to the very status it asked
      // for gets the same idempotent answer as above; any other refusal is
      // the answer.
      if (err instanceof ConflictException) {
        const now = await this.prisma.client.invoice.findUnique({ where: { id: params.invoiceId }, select: { status: true } });
        if (now?.status === params.status) return answerHeldStatus();
      }
      throw err;
    }

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: `invoice.${params.status.toLowerCase()}`,
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          bookingId: invoice.booking?.id,
        },
        // R0-CMF1 review SEC-CMF1-4: KEY's invoice.sent / .overdue / .void are
        // SYSTEM entries (see markInvoicePaid), never a person's.
        actorType: params.actorId && !isSystemActor(params.actorId) ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      });
    }
    // (Event emission is handled inside InvoiceWorkflowService.transition.)

    this.statsCache.invalidateCache(existingInvoice.businessId);
    return invoice;
  }

  // ========== QUOTES ==========

  async listQuotes(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.quote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { contact: true, items: true, invoice: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.quote.count({ where }),
    ]);
    const now = new Date();
    return {
      // R0-CMF3 review (ST-CMF3-3): a legacy row's foreign contact reads null.
      // V1-52 review (SEC-V52-1): no row carries its viewToken (withoutViewToken).
      data: data.map((q) => withoutViewToken(this.decorateQuote(withTenantContact(q), now))),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * R2: returns SENT quotes that have been sitting `daysThreshold` days
   * without a view/accept/reject. R3 consumes this for the Action Queue.
   */
  async getStaleQuotes(businessId: string, daysThreshold = CommerceService.QUOTE_STALE_DAYS) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.client.quote.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'SENT',
        viewedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        sentAt: { lte: cutoff },
      },
      include: { contact: true, items: true, invoice: true },
      orderBy: { sentAt: 'asc' },
    });
    // R3: filter out quotes that were nudged within the last
    // QUOTE_STALE_DAYS so we don't keep re-surfacing the same row in
    // the Action Queue every day.
    const stale = candidates.filter((q) => {
      if (!q.lastFollowUpAt) return true;
      const lastFollowUp = new Date(q.lastFollowUpAt);
      return lastFollowUp.getTime() <= cutoff.getTime();
    });
    // R0-CMF3 review (ST-CMF3-3): a legacy row's foreign contact reads null,
    // and its quote.stale event carries neither that contact nor its id.
    const decoratedRows = stale.map((q) => {
      const decorated = this.decorateQuote(withTenantContact(q), now);
      const reference = q.lastFollowUpAt && new Date(q.lastFollowUpAt) > new Date(q.sentAt!)
        ? new Date(q.lastFollowUpAt)
        : new Date(q.sentAt!);
      const daysSinceSent = Math.floor((now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24));
      const served = { ...decorated, daysSinceSent };
      return { served, event: forQuoteEvent(q, served) };
    });
    // Emit one canonical quote.stale event per stale row so the Action
    // Queue / notification consumers can pick them up. Idempotency is
    // delegated to the caller (typically a once-per-day scheduled scan)
    // so we never silently swallow events here.
    for (const { event } of decoratedRows) {
      this.events.emit('quote.stale', {
        quote: event,
        businessId,
        sentAt: event.sentAt ?? now,
        daysSinceSent: event.daysSinceSent,
      } as QuoteStalePayload);
    }
    // V1-52 review (SEC-V52-1): the revenue:read stale list serves no viewToken;
    // the quote.stale events above keep the quote as before.
    return decoratedRows.map(({ served }) => withoutViewToken(served));
  }

  /**
   * R3: stamp a follow-up timestamp on a quote so it's no longer
   * considered stale until it ages another QUOTE_STALE_DAYS without
   * progress. Returns the updated quote.
   */
  async markQuoteFollowedUp(params: {
    quoteId: string;
    businessId: string;
    actorId?: string | null;
  }) {
    const existing = await this.prisma.client.quote.findFirst({
      where: { id: params.quoteId, businessId: params.businessId, deletedAt: null },
      select: { id: true, status: true, contactId: true },
    });
    if (!existing) throw new NotFoundException('Quote not found');
    if (existing.status !== 'SENT') {
      throw new BadRequestException(`Quote is ${existing.status} — only SENT quotes can be followed up`);
    }
    const now = new Date();
    const updated = await this.prisma.client.quote.update({
      where: { id: params.quoteId },
      data: { lastFollowUpAt: now },
      include: { contact: true, items: true, invoice: true },
    });
    // R0-CMF3 review (ST-CMF3-3): a legacy row's foreign contact reads null,
    // and nothing is logged against it under this tenant.
    const contactId = hasForeignContact(updated) ? null : existing.contactId;
    if (contactId) {
      await this.crm.logContactEvent({
        businessId: params.businessId,
        contactId,
        type: 'quote.follow_up_sent',
        data: { quoteId: params.quoteId, followUpAt: now.toISOString() },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      }).catch(() => undefined);
    }
    return this.decorateQuote(withTenantContact(updated), now);
  }

  /**
   * Server-side read by id alone. NOT tenant-bound: it returns any tenant's
   * quote in the full operator shape, DRAFT included, so a caller holding a
   * tenant must read `getQuoteForBusiness` below instead. No HTTP route serves it as
   * a read any more: the bare-id GET /commerce/quotes/:quoteId answers 404 for
   * every id (R0-PC-01). Remaining callers: the controller's sendQuoteEmail
   * (compares businessId after the read) and the KEY commerce adapter's
   * getQuoteStatus, which does not bind input.businessId yet (ST-PC01-1,
   * follow-up packet: that file is outside the R0-PC-01 write set).
   */
  async getQuote(quoteId: string) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { id: quoteId },
      include: OPERATOR_QUOTE_INCLUDE,
    });
    if (!quote) return null;
    return this.decorateQuote(toOperatorQuote(quote));
  }

  /**
   * R0-PC-01 — the operator quote detail read behind
   * GET /commerce/businesses/:businessId/quotes/:quoteId. Same operator shape
   * as `getQuote`, bound to the tenant the guards admitted: a cross-tenant id,
   * an unknown id and a soft-deleted row all read as absent, which the
   * controller turns into one 404. No status gate — the operator opens DRAFT.
   * A read stamps nothing (no viewedAt, no event): only the signed-token
   * route records a customer view. It serves no viewToken (V1-52 review
   * SEC-V52-1, withoutViewToken): the route is revenue:read, and the KEY
   * adapter's getQuoteStatus hands this shape to the assistant.
   */
  async getQuoteForBusiness(quoteId: string, businessId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId, deletedAt: null },
      include: OPERATOR_QUOTE_INCLUDE,
    });
    if (!quote) return null;
    return withoutViewToken(this.decorateQuote(toOperatorQuote(quote)));
  }

  // ----- R2: public quote-view + accept/reject by signed token -----

  // R0-CMF3 review (ST-CMF3-2): the token holder reads the same customer fields
  // as before, joined with the contact's businessId so that a legacy quote
  // pointing at another tenant's contact reads contact null.
  async getQuoteByToken(token: string) {
    if (!token) return null;
    const quote = await this.prisma.client.quote.findUnique({
      where: { viewToken: token },
      include: {
        contact: { select: OPERATOR_QUOTE_CONTACT_JOIN },
        items: true,
        invoice: { select: { id: true, invoiceNumber: true, status: true, total: true } },
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            phone: true,
            email: true,
            website: true,
            primaryColor: true,
          },
        },
      },
    });
    if (!quote || quote.deletedAt) return null;
    // V1-QUOTE-CHAIN-finish (review SEC-5): the version of the terms this view
    // shows; the customer's accept sends it back (respondToQuoteByToken).
    return { ...this.decorateQuote(toOperatorQuote(quote)), termsVersion: quoteTermsVersion(quote) };
  }

  async markQuoteViewedByToken(token: string, visitorId?: string | null) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { viewToken: token },
      select: {
        id: true,
        businessId: true,
        status: true,
        viewedAt: true,
        deletedAt: true,
        contactId: true,
      },
    });
    if (!quote || quote.deletedAt) return null;
    // Only flip the first time someone views it; later visits are no-ops
    // so we never spam quote.viewed events.
    if (quote.viewedAt || quote.status !== 'SENT') {
      return this.getQuoteByToken(token);
    }
    const now = new Date();
    const updated = await this.prisma.client.quote.update({
      where: { id: quote.id },
      data: { viewedAt: now },
      include: { contact: true },
    });
    // R0-CMF3 review (CR-CMF3-1): a legacy quote pointing at another tenant's
    // contact emits quote.viewed without that contact or its id, and nothing
    // is logged or attached to it under this tenant.
    const eventQuote = forQuoteEvent(updated, withTenantContact(updated));
    this.events.emit('quote.viewed', {
      quote: eventQuote,
      businessId: quote.businessId,
      viewedAt: now,
      source: 'public',
    } as QuoteViewedPayload);
    if (eventQuote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: eventQuote.contactId,
        type: 'quote.viewed',
        data: { quoteId: quote.id, source: 'public' },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
      if (visitorId) {
        await this.publicEvents
          .attachVisitorToContact({
            businessId: quote.businessId,
            contactId: eventQuote.contactId,
            visitorId,
            sourceDetail: `quote:${quote.id}`,
          })
          .catch(() => undefined);
      }
    }
    this.statsCache.invalidateCache(quote.businessId);
    return this.getQuoteByToken(token);
  }

  /**
   * The customer's decision through the signed link. V1-QUOTE-CHAIN-finish
   * (review SEC-5): an accept must carry `termsVersion`, the quoteTermsVersion
   * the signed-token view served (400 quote_terms_version_required without
   * one), and is recorded only while the quote's terms are still those (409
   * quote_terms_changed otherwise, nothing written): acceptance means agreement
   * to the stored terms, which convert {} then invoices (V1-51). A reject
   * needs no version: refusing an offer binds the customer to nothing.
   */
  async respondToQuoteByToken(
    token: string,
    decision: 'accept' | 'reject',
    reason?: string,
    visitorId?: string | null,
    termsVersion?: unknown,
  ) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { viewToken: token },
      select: {
        id: true,
        businessId: true,
        status: true,
        invoiceId: true,
        deletedAt: true,
        expiryDate: true,
        contactId: true,
      },
    });
    if (!quote || quote.deletedAt) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.invoiceId) {
      throw new BadRequestException('This quote has already been converted to an invoice.');
    }
    // Only quotes the business has explicitly sent can be acted on via
    // the public link — a draft (or already-decided) quote must not be
    // accepted/rejected by a token holder.
    if (quote.status !== 'SENT') {
      if (quote.status === 'ACCEPTED' || quote.status === 'REJECTED') {
        throw new BadRequestException(`This quote has already been ${quote.status.toLowerCase()}.`);
      }
      throw new BadRequestException('This quote is not available for a response yet.');
    }
    if (quote.expiryDate && new Date(quote.expiryDate).getTime() < Date.now()) {
      throw new BadRequestException('This quote has expired and can no longer be responded to.');
    }
    if (decision === 'accept' && (typeof termsVersion !== 'string' || termsVersion.length === 0)) {
      throw quoteTermsVersionRequired();
    }
    const target: 'ACCEPTED' | 'REJECTED' = decision === 'accept' ? 'ACCEPTED' : 'REJECTED';
    const result = await this.updateQuoteStatus({
      quoteId: quote.id,
      status: target,
      source: 'public',
      reason: reason ?? null,
      ...(decision === 'accept' ? { termsVersion: termsVersion as string } : {}),
    });
    // Stitch the public visitor cookie onto the quote's contact so first-touch
    // attribution (firstSource / utmMedium / utmCampaign / firstReferrer /
    // firstLandingPath) lands on the Contact even though it was originally
    // created internally without a visitorId. R0-CMF3 review (ST-CMF3-2):
    // updateQuoteStatus reads a foreign contact (a legacy row) as null, and no
    // visitor is attached to it under this tenant.
    if (visitorId && quote.contactId && result.contact) {
      await this.publicEvents
        .attachVisitorToContact({
          businessId: quote.businessId,
          contactId: quote.contactId,
          visitorId,
          sourceDetail: `quote:${quote.id}`,
        })
        .catch(() => undefined);
    }
    // R0-CMF3 review (ST-CMF3-2): the anonymous token holder received the
    // whole Contact row (phone, internal notes, owner, visibility). The answer
    // now carries the customer fields the signed-token view serves (name and
    // email), and null for a foreign contact.
    return toOperatorQuote(result);
  }

  async createQuote(input: {
    businessId: string;
    contactId: string;
    items: { description: string; quantity: number; unitPrice: number; productId?: string; total?: number }[];
    currency?: string;
    expiryDate?: Date | string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
    quoteNumber?: string;
    /** V1-45 (D-15): the client's Idempotency-Key. The same key and request answer the quote it created. */
    idempotencyKey?: string;
    /** V1-45b (SEC-V45-3): the member who sent the request; part of the key's request hash. */
    actorUserId?: string;
  }) {
    // V1-45 (M22): a retry with a used key is answered before anything else runs.
    const claim = createClaim('quote', input.idempotencyKey, {
      contactId: input.contactId ?? null,
      items: createLinesMaterial(input.items),
      currency: input.currency ?? null,
      expiryDate: createDateMaterial(input.expiryDate),
      taxRate: input.taxRate ?? null,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? null,
      notes: input.notes ?? null,
      quoteNumber: input.quoteNumber ?? null,
      ...createActorMaterial(input.actorUserId),
    });
    const loadCreated = (id: string) =>
      this.prisma.client.quote.findFirst({ where: { id, businessId: input.businessId }, include: { items: true, contact: true } });
    const prior = claim ? await this.usedCreateSlot(input.businessId, 'quote', claim, loadCreated) : null;
    if (prior) return prior;

    // V1-51 review (SEC-V51-1): the discount is checked as it is priced below
    // (no type = a percentage). A typeless discountValue 150 passed the check,
    // which caps only an explicit PERCENT, and stored a quote of -50.
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, quotePricedDiscountType(input.discountType));
    // R0-27 review (ST-27-2): the contact was bound with no tenant check, so
    // bizA's contactId under bizB's path created bizB's quote linked to (and
    // echoing) bizA's contact, and converting it created an Invoice bound to
    // that contact. Resolve it inside the tenant before anything is written.
    const contactId = await this.assertContactInBusiness(input.contactId, input.businessId);
    // V1-53: at least one line, each product inside the tenant (404).
    await this.assertQuoteLines(input.items, input.businessId);
    const taxRate = input.taxRate ?? 0;
    const discountValue = input.discountValue ?? 0;
    // V1-22 (D-13): in integer cents. A discount type other than FIXED is a
    // percentage here, as it was.
    const amounts = computeDocumentAmounts({
      lines: input.items.map((item) => lineAmount(item.quantity, item.unitPrice)),
      taxRate,
      discountType: input.discountType === 'FIXED' ? 'FIXED' : 'PERCENT',
      discountValue,
    });
    const { subtotal, taxAmount, discountAmount, total } = amounts;
    this.assertQuoteAmounts(subtotal, total);
    // V1-37 (D-13): the business currency unless one is named; checked before any write.
    const currency = await this.documentCurrency(input.businessId, input.currency);

    // R2: viewToken is intentionally NOT generated at draft time. The
    // public accept/reject URL is minted only when the quote is sent so
    // pre-send drafts can never be acted on via a leaked link.
    // V1-53: the only unique index a new quote can hit is
    // (businessId, quoteNumber): its P2002 is a 409, not a 500.
    // V1-43 (D-15): a number the caller names is kept as given (and a taken
    // one is that 409); otherwise the business's next number is drawn in this
    // create's own transaction, and a collision is retried with the following.
    // V1-45: with a key, its slot is taken first in the same transaction (see createInvoice).
    const create = () => this.prisma.client.$transaction(async (tx) => {
      if (claim) await this.claimCreateSlot(tx, input.businessId, claim);
      const created = await tx.quote.create({
        data: {
          businessId: input.businessId,
          contactId,
          quoteNumber: input.quoteNumber ?? (await allocateDocumentNumber(tx, input.businessId, 'quote')),
          status: 'DRAFT',
          issueDate: new Date(),
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          subtotal,
          taxRate,
          taxAmount,
          discountType: input.discountType ?? null,
          discountValue,
          discountAmount,
          total,
          currency,
          notes: input.notes ?? null,
          items: {
            create: input.items.map((item, i) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total != null ? roundMoney(item.total) : amounts.lineTotals[i],
              productId: item.productId || null,
            })),
          },
        },
        include: { items: true, contact: true },
      });
      if (claim) await this.settleCreateSlot(tx, input.businessId, claim, { quoteId: created.id });
      return created;
    });
    let quote: Awaited<ReturnType<typeof create>>;
    try {
      quote = await (input.quoteNumber != null ? create() : retryDocumentNumber('quote', create)).catch((err: unknown) => {
        if ((err as { code?: string } | null)?.code === 'P2002') throw quoteNumberTaken();
        throw err;
      });
    } catch (err) {
      if (claim && err instanceof CreateSlotTaken) return this.takenCreateSlot(input.businessId, 'quote', claim, loadCreated);
      throw err;
    }
    // W3-V1-45c-EVENT-REPLAY review CR-V45c-1: the create that wrote it claims its one event too.
    if (claim) this.withCreateEventClaim(quote, input.businessId, claim);
    this.events.emit('quote.created', { quote, businessId: input.businessId } as QuoteCreatedPayload);
    if (input.contactId) {
      await this.crm.logContactEvent({
        businessId: input.businessId,
        contactId: input.contactId,
        type: 'quote.created',
        data: { quoteId: quote.id, total: quote.total, currency: quote.currency },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }
    this.statsCache.invalidateCache(input.businessId);
    return quote;
  }

  async updateQuote(input: {
    quoteId: string;
    businessId: string;
    contactId?: string;
    items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    expiryDate?: Date | string | null;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
    /**
     * FOLLOW3-D6 (D-64): the member who edits; a contactId other than the
     * stored one must be one they may open (memberContactClause). None, or
     * KEY's system actor: the tenant check alone.
     */
    actorUserId?: string;
  }) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId },
    });
    if (!quote) {
      throw quoteNotFound();
    }
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    // V1-51 review (SEC-V51-2): a converted quote, and an accepted one, are
    // final (409, nothing written). Only ACCEPTED with an invoice was refused
    // (as a plain Error, 500), so an operator could change an accepted quote's
    // tax or discount and convert {} invoiced terms the customer never saw.
    if (isConvertedQuote(quote)) {
      throw quoteAlreadyConverted();
    }
    if (quote.status === 'ACCEPTED') {
      throw quoteAlreadyAccepted();
    }

    const updateData: any = {};
    // R0-27 review (ST-27-2): same tenant check as quote create, before any write.
    if (input.contactId) {
      // FOLLOW3-D6 (D-64): a new contact must be one the editing member may
      // open. The stored one is not re-judged (review CR-D6-2): every web edit
      // (Extend expiry, the composer) sends it back, and refusing it would
      // block a notes or dates edit of a quote already bound to a contact the
      // member cannot open, which the same PATCH without contactId allows.
      const memberClause =
        input.contactId === quote.contactId ? undefined : await this.memberContactClause(input.businessId, input.actorUserId);
      updateData.contactId = await this.assertContactInBusiness(input.contactId, input.businessId, memberClause);
    }
    // V1-37 (D-13): a named currency is held to the create rule, upper-cased.
    if (input.currency) updateData.currency = await this.documentCurrency(input.businessId, input.currency);
    if (input.expiryDate !== undefined) {
      updateData.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
    }
    if (input.notes !== undefined) updateData.notes = input.notes;
    // V1-53: replacement lines obey the create rules (at least one, each
    // product inside the tenant), checked before anything is written.
    if (input.items !== undefined) await this.assertQuoteLines(input.items, input.businessId);
    
    // Get items for recalculating totals
    const currentItems = input.items ?? (await this.prisma.client.quoteItem.findMany({ where: { quoteId: input.quoteId } }));
    // V1-22 (D-13): each line is quantity x unitPrice in cents, as stored below.
    const lineTotals = currentItems.map((item) => lineAmount(item.quantity, item.unitPrice));

    // Handle tax/discount updates
    const taxRate = input.taxRate ?? quote.taxRate ?? 0;
    const discountType = input.discountType ?? quote.discountType;
    const discountValue = input.discountValue ?? quote.discountValue ?? 0;
    // V1-51 review (CR51-1): the resolved values are checked as they are priced,
    // before anything is written. A PATCH of { discountType: 'PERCENT' } alone
    // turned a stored FIXED 150 into an uncapped PERCENT 150 (a negative quote).
    this.validateTaxAndDiscount(taxRate, discountValue, quotePricedDiscountType(discountType));

    const { subtotal, taxAmount, discountAmount, total } = computeDocumentAmounts({
      lines: lineTotals,
      taxRate,
      discountType: discountType === 'FIXED' ? 'FIXED' : 'PERCENT',
      discountValue,
    });
    this.assertQuoteAmounts(subtotal, total);

    updateData.subtotal = subtotal;
    updateData.taxRate = taxRate;
    updateData.taxAmount = taxAmount;
    updateData.discountType = discountType;
    updateData.discountValue = discountValue;
    updateData.discountAmount = discountAmount;
    updateData.total = total;
    // Every edit writes the quote row, so its updatedAt moves with any change
    // to its terms, lines included (the public accept compares it, SEC-5).
    updateData.updatedAt = new Date();

    // V1-QUOTE-CHAIN-finish (review SEC-1): the write is a compare-and-set on
    // the quote as read above. It was by id alone, so an edit that read a SENT
    // quote overwrote the price, tax and lines of a quote the customer accepted
    // (or the operator converted) in between, and convert {} then invoiced
    // terms nobody accepted. The quote row is written first, conditional on
    // the status, no invoice, not deleted and the updatedAt it was read with:
    // an UPDATE that waits on a concurrent accept, convert or delete re-reads
    // the row once that commits and matches nothing, and the transaction
    // writes no line. The lines are replaced in the same transaction, while
    // the row lock is held (V1-53: never a quote left with no lines), and the
    // answer for a miss is read from the quote as it now stands.
    // R0-04 review (ST-R004-1): a legacy quote can still point at another
    // tenant's contact; the response never carries that row, and the events
    // carry neither the row nor its id (R0-CMF3 review).
    const row = await this.prisma.client
      .$transaction(async (tx) => {
        const won = await tx.quote.updateMany({
          where: {
            id: input.quoteId,
            businessId: input.businessId,
            status: quote.status,
            invoiceId: null,
            deletedAt: null,
            updatedAt: quote.updatedAt,
          },
          data: updateData as Prisma.QuoteUncheckedUpdateManyInput,
        });
        if (won.count !== 1) throw new QuoteEditRaceLost();
        if (input.items) {
          await tx.quoteItem.deleteMany({ where: { quoteId: input.quoteId } });
          await tx.quoteItem.createMany({
            data: input.items.map((item, i) => ({
              quoteId: input.quoteId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              // V1-22 (D-13): the line in cents, as priced above.
              total: lineTotals[i],
              productId: item.productId || null,
            })),
          });
        }
        return tx.quote.findUniqueOrThrow({ where: { id: input.quoteId }, include: { items: true, contact: true } });
      })
      .catch(async (err: unknown) => {
        if (!(err instanceof QuoteEditRaceLost)) throw err;
        const now = await this.prisma.client.quote.findFirst({ where: { id: input.quoteId, businessId: input.businessId } });
        if (!now) throw quoteNotFound();
        if (isConvertedQuote(now)) throw quoteAlreadyConverted();
        if (now.status === 'ACCEPTED') throw quoteAlreadyAccepted();
        throw new ConflictException({
          code: 'quote_changed',
          message: 'The quote changed while it was being edited. Reload it and edit it again.',
          quoteStatus: now.status,
        });
      });
    const updated = withTenantContact(row);
    const eventQuote = forQuoteEvent(row, updated);
    const prevExp = quote.expiryDate ? new Date(quote.expiryDate).getTime() : null;
    const newExp = updated.expiryDate ? new Date(updated.expiryDate).getTime() : null;
    if (input.expiryDate !== undefined && prevExp !== newExp) {
      this.events.emit('quote.expiry_changed', {
        quote: eventQuote,
        businessId: input.businessId,
        previousExpiryDate: quote.expiryDate ?? null,
      });
    }
    this.events.emit('quote.updated', { quote: eventQuote, businessId: input.businessId });
    this.statsCache.invalidateCache(input.businessId);
    return updated;
  }

  async deleteQuote(quoteId: string, businessId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId },
    });
    if (!quote) {
      throw quoteNotFound();
    }
    // V1-53: a converted quote is a 409 (it was a plain Error, 500). Converted
    // as V1-50 reads it: an invoice linked, or a converted status.
    if (isConvertedQuote(quote)) {
      throw quoteConvertedNotDeletable();
    }
    // V1-53 review (SEC-V53-2): the write carries the checks above as its own
    // condition. It was by id alone, so a delete that read the quote before a
    // concurrent convert linked its invoice soft-deleted a converted quote
    // (both answered success, and quote.deleted was emitted for it). The
    // UPDATE re-reads the row once a concurrent writer commits: a row that
    // no longer matches (linked, given a converted status, or deleted) is not
    // written, and the answer is read from the row as it now stands.
    const result = await this.prisma.client.quote
      .update({
        // (invoiceId is a unique field, so its null condition goes in AND.)
        where: {
          id: quoteId,
          AND: [{ businessId, deletedAt: null, invoiceId: null, status: { notIn: CONVERTED_QUOTE_STATUSES } }],
        },
        data: { deletedAt: new Date() },
      })
      .catch(async (err: unknown) => {
        if ((err as { code?: string } | null)?.code !== 'P2025') throw err;
        const now = await this.prisma.client.quote.findFirst({ where: { id: quoteId, businessId } });
        if (now && isConvertedQuote(now)) throw quoteConvertedNotDeletable();
        throw quoteNotFound();
      });
    this.events.emit('quote.deleted', { businessId, quoteId });
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async convertQuoteToInvoice(input: {
    quoteId: string;
    businessId: string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
    dueDate?: Date | string;
  }) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId, deletedAt: null },
      include: { items: true },
    });
    if (!quote) {
      throw quoteNotFound();
    }
    if (isConvertedQuote(quote)) {
      // V1-51: a repeated convert is a conflict with the stored state (409),
      // not a server error; same code as the status route's refusal (V1-50).
      // V1-53: checked first, so a converted quote stored with a converted
      // status (INVOICED, PAID, CONVERTED) answers this, not quote_not_accepted.
      throw quoteAlreadyConverted();
    }
    if (quote.status !== 'ACCEPTED') {
      // V1-53: a state conflict (409), not a server error (500).
      throw quoteNotAccepted(quote.status);
    }

    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    // V1-51 (M20, IV-P08): by default the invoice carries the tax and the
    // discount of the quote the customer accepted. The rate used to be
    // `input.taxRate ?? 0` and the discount came from the body only, so an
    // empty body (KEY's commerce_convert_quote, any API caller) invoiced an
    // accepted 112.50 (100 + 12.5%) at 100.00. A body value still overrides:
    // taxRate on its own (an explicit 0 is honoured), the discount as a pair
    // (a body that names either discountType or discountValue replaces the
    // quote's discount; discountValue 0 clears it). The quote's discount is
    // read as createQuote/updateQuote priced it: FIXED, else a percentage.
    // V1-53 review (CR-V53-4): a body discountValue with no type (null, which
    // the DTO's IsOptional lets through, or omitted) is priced as a percentage,
    // like the quote's own (quotePricedDiscountType), and so checked with the
    // 100% cap below. It was written as a typeless discount, uncapped and not
    // applied (discountAmount 0), which an invoice edit that later named a type
    // turned into a negative total.
    const taxRate = input.taxRate ?? quote.taxRate ?? 0;
    const bodyDiscount = input.discountType !== undefined || input.discountValue !== undefined;
    const discountValue = bodyDiscount ? input.discountValue ?? null : quote.discountValue ?? null;
    const discountType: 'PERCENT' | 'FIXED' | null = bodyDiscount
      ? discountValue
        ? quotePricedDiscountType(input.discountType)
        : input.discountType ?? null
      : discountValue
        ? quotePricedDiscountType(quote.discountType)
        : null;
    // V1-51 review (SEC-V51-1 / CR51-1): the values carried from the quote are
    // checked like the body's. A stored discount with no type (priced as an
    // uncapped percentage before the repair) reached the invoice as PERCENT 150,
    // a negative total that issues with no AR (RR27-DISC, ST-27-3).
    this.validateTaxAndDiscount(taxRate, discountValue ?? undefined, discountType ?? undefined);
    // D-13 / V1-22, merged with V1-51 (CR51-2): the invoice is priced with the
    // formula every quote and invoice is priced with (computeDocumentAmounts:
    // lines in cents, tax and discount each rounded to cents, total their sum),
    // from the carried tax and discount above. A quote priced by createQuote or
    // updateQuote therefore converts to its accepted total to the cent, and
    // subtotal + tax - discount = total exactly. The quote's stored line totals
    // (legacy rows may hold the raw float product) are read in cents.
    const amounts = computeDocumentAmounts({
      lines: quote.items.map((item) => item.total),
      taxRate,
      discountType,
      discountValue,
    });
    const { subtotal, taxAmount, discountAmount, total } = amounts;
    // R0-27 review (ST-27-3): the converted invoice obeys the same amount rules
    // as a created one (no FIXED discount above the subtotal, no amount the
    // ledger cannot hold).
    this.assertInvoiceAmounts({ subtotal, total, discountType, discountValue });
    // V1-51 review (SEC-V51-1): no invoice total is negative. RevenuePostingService
    // posts no AR for a total that is not positive, so a negative invoice could
    // be issued with no ledger entry. A stored quote can still sum below zero
    // (quote lines carry no price floor).
    if (total < 0) {
      throw new BadRequestException('Invoice total cannot be negative');
    }
    // R0-27 review (ST-27-2): the invoice inherits the quote's contact. A quote
    // written before quote create/update checked the tenant can still hold a
    // foreign (or since deleted) contact; it must not become an Invoice bound
    // to it. Same 404 as invoice create, and nothing is written.
    await this.assertContactInBusiness(quote.contactId, input.businessId);
    // V1-53 review (SEC-V53-3): so is a stored line's product (404, nothing written).
    await this.assertStoredLineProductsInBusiness(quote.items, input.businessId);

    // R2: do the invoice insert + the quote.invoiceId backlink in a single
    // transaction so we never end up with a quote that thinks it was
    // converted but no invoice (or an invoice that has no parent quote).
    // V1-51: two concurrent converts both pass the invoiceId check above; the
    // loser's insert hits the unique Invoice.quoteId once the winner commits,
    // and answers the same 409 as a sequential repeat.
    // V1-43 (D-15): the invoice takes the business's next number inside this
    // transaction; a number collision reruns the whole transaction.
    const invoice = await retryDocumentNumber('invoice', () => this.prisma.client.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          businessId: quote.businessId,
          contactId: quote.contactId,
          invoiceNumber: await allocateDocumentNumber(tx, quote.businessId, 'invoice'),
          status: 'DRAFT',
          issueDate: new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          subtotal,
          taxRate,
          taxAmount,
          discountType,
          discountValue,
          discountAmount,
          total,
          currency: quote.currency,
          notes: input.notes ?? null,
          quoteId: quote.id,
          items: {
            create: quote.items.map((item, i) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: amounts.lineTotals[i],
              productId: item.productId ?? null,
            })),
          },
        },
        include: { items: true, contact: true },
      });
      // V1-53 review (SEC-V53-2): the backlink is written only to a quote that
      // is still live and unlinked. It was by id alone, so a convert that read
      // the quote before a concurrent delete committed linked an invoice to a
      // soft-deleted quote (both answered success). This UPDATE waits for that
      // delete and then matches no row; the invoice is rolled back.
      const linked = await tx.quote.updateMany({
        where: { id: quote.id, businessId: input.businessId, deletedAt: null, invoiceId: null },
        data: { invoiceId: created.id },
      });
      if (linked.count !== 1) throw new QuoteConvertRaceLost();
      return created;
    })).catch(async (err: unknown) => {
      if (err instanceof QuoteConvertRaceLost || (err as { code?: string } | null)?.code === 'P2002') {
        // The quote as it now stands (the read hides a deleted one).
        const now = await this.prisma.client.quote.findFirst({
          where: { id: quote.id, businessId: input.businessId },
          select: { invoiceId: true },
        });
        if (now?.invoiceId) throw quoteAlreadyConverted();
        if (!now) throw quoteNotFound();
      }
      throw err;
    });

    this.events.emit('quote.converted', { quote, invoice, businessId: quote.businessId } as QuoteConvertedPayload);
    this.events.emit('invoice.created', {
      invoice,
      businessId: quote.businessId,
      source: 'quote',
      quoteId: quote.id,
    } as InvoiceCreatedPayload);

    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: 'invoice.created',
        data: { invoiceId: invoice.id, quoteId: quote.id, total: invoice.total },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }

    this.statsCache.invalidateCache(input.businessId);
    return invoice;
  }

  // ========== PARTIAL PAYMENTS ==========

  async recordPayment(invoiceId: string, businessId: string, input: {
    amount: number;
    method: string;
    reference?: string;
    notes?: string;
    evidenceUrl?: string;
    evidenceMimeType?: string;
    /** R0-D2: client idempotency key, scoped to the invoice (see RecordPaymentDto). */
    idempotencyKey?: string;
  }, options: {
    /**
     * R0-D2 review (CR-1): without a key, treat the same non-empty
     * `reference` for the same amount on this invoice as the same payment.
     * Only the HTTP route sets this, where `reference` is the operator's
     * payment reference (the journey's duplicate slip). Internal callers
     * (PaymentEvidenceService, DriveIntakeOrchestrator, the Key cortex
     * adapter) pass a document-derived reference such as the invoice number,
     * which is not a payment identity: for them a reference never keys the
     * row and every call records its own payment, as before this packet.
     * They may pass `idempotencyKey` derived from their own identity
     * (evidence URL, drive file id, tool-call id) to opt in;
     * DriveIntakeOrchestrator passes `drive:<intakeFileId>:<actionIndex>`
     * (R0-CMF2 review SEC-CMF2-2).
     */
    dedupeByReference?: boolean;
    /**
     * R0-PL-07: who records this payment. The HTTP route passes the
     * authenticated user (req.user.id); the Key cortex adapter and
     * PaymentEvidenceService pass KEY_SYSTEM_ACTOR_ID. It is written to
     * Payment.recordedBy, the posting's FinancialTransaction.createdById and
     * the contact timeline event. It is an option, never part of `input`, so a
     * client body can not name the recorder. Drive intake passes the approving
     * user (R0-CMF2). Absent (a caller with no human, e.g. an auto-executed
     * intake plan) records null. A replay returns the original row and never
     * rewrites its recorder.
     */
    actorId?: string | null;
    /**
     * R0-PL-07 review (PL07-ST-3): the person on whose behalf a SYSTEM
     * recorder (KEY) acted, e.g. the member who uploaded the receipt on the
     * from-evidence route or the user KEY's tool call ran for. The recorder
     * stays the system actor; this only keeps the human on the audit trail
     * (contact event data.initiatedBy). Audit data, never authority. Ignored
     * unless the recorder is the system actor, and never the system actor
     * itself. Like actorId it is an option, never part of `input`.
     */
    initiatedBy?: string | null;
    /**
     * R0-PL-04: Payment.provider when it is not the method. markInvoicePaid
     * keeps its historical row shape (provider 'manual', method 'MANUAL').
     * Internal: an option, never part of `input`. Default: the method, except
     * that a gateway id ('stripe', 'paypal', 'wipay' exactly) is stored as
     * 'manual' (D-55, GATEWAY_PROVIDER_IDS).
     */
    provider?: string;
    /**
     * R0-PL-04 (G2): internal, markInvoicePaid only. `amount` is the remaining
     * balance the caller read before this transaction. Under the invoice lock
     * the remaining balance is read again from the payment rows; if a payment
     * or refund committed in between it no longer matches, and the stale
     * amount is refused (409) rather than recorded as an over- or
     * under-payment. Nothing is written.
     */
    expectRemaining?: number;
    /**
     * R0-PL-04 review (ST-PL04-1 / ST-PL04-2): internal, markInvoicePaid
     * only. A providerPaymentId the server built (random, never derived from
     * a client key or reference). It replaces the manualProviderPaymentId
     * slot and keys no replay: no idempotency lookup runs for it, so no row
     * another caller wrote can be answered in its place. An option, never part
     * of `input`.
     */
    providerPaymentId?: string;
  } = {}) {
    const actorId = options.actorId ?? null;
    const initiatedBy =
      isSystemActor(actorId) && options.initiatedBy && !isSystemActor(options.initiatedBy)
        ? options.initiatedBy
        : null;
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    // R0-D3 review (ST-D3-3): RecordPaymentDto only whitelists these fields
    // (it does not validate them), so a missing, string or object amount or a
    // missing method would still reach tx.payment.create and surface as a
    // PrismaClientValidationError 500 on the exact route this packet pins.
    // R0-D2 runs these before the state guard: the replay lookup below needs
    // a well-formed amount and must itself come before that guard.
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
      throw new BadRequestException('Payment amount must be a number');
    }
    // V1-22 (D-13): the amount is stored in cents, so it must be at least one
    // cent once rounded; a sub-cent amount (0.004) would be stored as 0.
    if (toCents(input.amount) <= 0) {
      throw new BadRequestException('Payment amount must be positive');
    }
    if (typeof input.method !== 'string' || input.method.trim().length === 0) {
      throw new BadRequestException('Payment method is required');
    }
    // R0-D2: RecordPaymentDto declares @IsString() on the key, which the
    // ValidationPipe enforces on the built app; this keeps the same 400 where
    // decorator metadata is absent (vitest/esbuild), as ST-D3-3 did above.
    if (input.idempotencyKey != null && typeof input.idempotencyKey !== 'string') {
      throw new BadRequestException('Idempotency key must be a string');
    }

    // R0-D2: a duplicate submit must return the payment the first submit
    // recorded, never double-credit. providerPaymentId is derived from the
    // client key (or, without one, from reference + amount) so the row itself
    // is the idempotency record and Payment.providerPaymentId @unique makes
    // the create-or-return race-safe. This runs before the state guard: the
    // first submit may have settled the invoice to PAID, and the client that
    // lost that response still deserves the same answer.
    const providerPaymentId: { value: string; keyedOn: 'key' | 'reference' | null } = options.providerPaymentId
      ? { value: options.providerPaymentId, keyedOn: null }
      : CommerceService.manualProviderPaymentId(invoiceId, input, options.dedupeByReference === true);
    if (providerPaymentId.keyedOn) {
      const existing = await this.findRecordedPayment(providerPaymentId.value, businessId, invoiceId);
      if (existing) {
        return this.replayRecordedPayment(existing, invoiceId, input.amount, providerPaymentId.keyedOn);
      }
    }

    // R0-PL-03 (G3): a DRAFT invoice has not been issued, and DRAFT ->
    // PARTIALLY_PAID / PAID is not a legal transition. Refuse it here, before
    // anything is written, rather than commit the payment and then fail the
    // reconcile. This is the fast path; the same guard runs again under the
    // invoice lock inside the transaction below (ST-PL03-1).
    CommerceService.assertInvoiceAcceptsPayment(invoice.status);

    // Allow over-payment: store the actual amount the operator received so the
    // ledger stays truthful. The UI presents an explicit confirm + warning
    // toast when amount > remaining and prompts the operator to issue a refund
    // from the Payments tab to settle the over-paid balance.
    // V1-22 (D-13): stored, posted and compared in cents.
    const paymentAmount = roundMoney(input.amount);

    // FIN2 — record the payment row and post the deposit-side ledger
    // entries in a single transaction so a posting failure rolls back the
    // payment row (preserves invariant: every SUCCESSFUL payment has a
    // matching ledger transaction unless basis is CASH and posting silently
    // skipped — also fine, idempotent on replay).
    //
    // R0-PL-03 (G3, PL-P10): the invoice reconcile runs inside the same
    // transaction, so the payment row, its posting, the status change and the
    // COGS posting commit or roll back together. invoice.paid /
    // invoice.payment_recorded are buffered and emitted only after commit; a
    // rolled-back attempt (including the R0-D2 P2002 race below) emits nothing.
    const pendingEvents: Array<{ name: string; payload: unknown }> = [];
    const keyedOn = providerPaymentId.keyedOn;
    type Outcome =
      | { kind: 'replay'; existing: Payment; keyedOn: 'key' | 'reference' }
      | {
          kind: 'recorded';
          payment: Payment;
          reconciled: Awaited<ReturnType<InvoiceWorkflowService['reconcileFromPayments']>>;
        };
    let outcome: Outcome;
    try {
      outcome = await this.prisma.client.$transaction(async (tx): Promise<Outcome> => {
        const txClient = tx as unknown as Prisma.TransactionClient;
        // R0-PL-03 review (ST-PL03-1): the guards above ran on a read taken
        // before this transaction. Re-run them on the row as it stands under
        // the lock, in the same order (not found, replay, state guard), so a
        // concurrent void / undo / soft-delete, or a concurrent payment that
        // settled the invoice, refuses this one instead of being bypassed.
        const locked = await CommerceService.lockInvoiceForPayment(txClient, invoiceId);
        if (!locked || locked.businessId !== businessId || locked.deletedAt) {
          throw new NotFoundException('Invoice not found');
        }
        if (keyedOn) {
          // R0-D2: a concurrent duplicate submit that committed while we
          // waited for the lock (and may have settled the invoice) is a
          // replay, not a refusal.
          const winner = await tx.payment.findFirst({
            where: { providerPaymentId: providerPaymentId.value, businessId, invoiceId },
          });
          if (winner) return { kind: 'replay', existing: winner, keyedOn };
        }
        CommerceService.assertInvoiceAcceptsPayment(locked.status);
        if (options.expectRemaining != null) {
          const current = await tx.invoice.findUnique({
            where: { id: invoiceId },
            // Trial-N round 2 (RC-DEP-2): own-tenant rows, as markInvoicePaid read them.
            select: { total: true, currency: true, payments: { where: { businessId }, select: { amount: true, status: true } } },
          });
          // R0-PL-04 review (CR-PL04-1): the refund guard runs again on the
          // rows under the lock, so a manual refund that committed in the gap
          // refuses this call rather than being counted twice.
          const remaining = CommerceService.markPaidRemaining(Number(current?.total ?? 0), current?.payments ?? [], current?.currency);
          if (!moneyEquals(remaining, options.expectRemaining)) {
            throw new ConflictException('The invoice balance changed while it was being marked paid; reload it and try again');
          }
        }
        const created = await tx.payment.create({
          data: {
            amount: paymentAmount,
            currency: invoice.currency,
            status: 'SUCCESSFUL',
            // D-55: a hand-recorded gateway method is never a gateway row.
            provider: options.provider ?? (GATEWAY_PROVIDER_IDS.has(input.method) ? 'manual' : input.method),
            method: input.method,
            providerPaymentId: providerPaymentId.value,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            evidenceUrl: input.evidenceUrl ?? null,
            evidenceMimeType: input.evidenceMimeType ?? null,
            recordedBy: actorId,
            businessId,
            invoiceId,
          },
        });
        await this.revenuePosting.onPaymentRecorded(created.id, {
          tx: txClient,
          createdById: actorId,
          // W3-V1-55c review (SEC-V55C-4, D-90): the payment's FINANCE feed
          // row keeps the human KEY acted for, as this payment's contact event does.
          initiatedBy,
        });
        // Single source of truth: workflow recomputes status from payment rows
        // and queues the appropriate event (invoice.paid / invoice.payment_recorded).
        const r = await this.invoiceWorkflow.reconcileFromPayments(invoiceId, {
          tx: txClient,
          eventBuffer: pendingEvents,
        });
        return { kind: 'recorded', payment: created, reconciled: r };
      }, RECORD_PAYMENT_TX_OPTIONS);
    } catch (err: unknown) {
      // R0-D2 race: a concurrent duplicate submit won the insert between our
      // lookup and our create. Prisma raises P2002 on the unique index, the
      // transaction (payment row + posting) has rolled back, and the winner's
      // row is the answer. A P2002 on any other index is rethrown.
      if (providerPaymentId.keyedOn && CommerceService.isProviderPaymentIdConflict(err)) {
        const existing = await this.findRecordedPayment(providerPaymentId.value, businessId, invoiceId);
        if (existing) {
          return this.replayRecordedPayment(existing, invoiceId, input.amount, providerPaymentId.keyedOn);
        }
        // R0-D2 review (ST-D2-1): the slot is held by a row outside this
        // tenant/invoice (providerPaymentId is client-chosen on other
        // surfaces). It is never this caller's replay: say so, write nothing.
        throw new ConflictException('Payment identifier already in use; use a new idempotency key or reference');
      }
      throw err;
    }

    if (outcome.kind === 'replay') {
      return this.replayRecordedPayment(outcome.existing, invoiceId, input.amount, outcome.keyedOn);
    }
    const { payment, reconciled } = outcome;

    // Committed: now listeners may see the payment and the new status.
    for (const evt of pendingEvents) {
      this.events.emit(evt.name, evt.payload);
    }
    // R0-PL-03 review (ST-PL03-2): the totals in the audit event and the
    // response come from the payment rows the in-transaction reconcile read
    // under the invoice lock (this payment included), the same read that
    // derived newStatus. A total computed from the pre-transaction read would
    // miss a payment committed while this one waited for the lock: the audit
    // would contradict newStatus and never flag an overpayment. V1-29 (CF-17):
    // the total paid is computeBalance's net (SUCCESSFUL rows less refund
    // rows), the figure the status was derived from and the one the replay,
    // listPayments and the operator invoice read serve; the gross SUCCESSFUL
    // sum would ignore a refund row and understate `remaining`.
    const newPaidTotal = reconciled.balance.net;
    // V1-22: in cents (the remaining after 33.33 x 3 on 100.00 read 0.010000000000005116).
    // CR-V22-1: against the stored total (the one the audit reports), so a
    // legacy sub-cent total is settled and overpaid by the same rule as the
    // reconcile (readTotalCents); a payment never changes the total.
    const invoiceTotal = Number(invoice.total);
    const overPaid = overpaidMoney(invoiceTotal, newPaidTotal);
    const newStatus = reconciled.status;
    // DEP-R3-OWN-ROW-READS (D-75): the invoice answered carries its own-tenant
    // rows, the ones paidAmount above was reconciled from (M31).
    const updatedInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: { where: { businessId } }, contact: true, items: true },
    });

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_recorded',
        data: {
          invoiceId,
          amount: paymentAmount,
          method: input.method,
          reference: input.reference,
          totalPaid: newPaidTotal,
          invoiceTotal: invoice.total,
          newStatus,
          overPaid,
          recordedBy: actorId,
          ...(initiatedBy ? { initiatedBy } : {}),
        },
        // R0-PL-07: KEY (adapter, evidence extraction) is a SYSTEM actor; a
        // person is USER. Without an actor the type stays USER, as before.
        actorType: isSystemActor(actorId) ? 'SYSTEM' : 'USER',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }

    this.statsCache.invalidateCache(businessId);

    return {
      payment,
      invoice: updatedInvoice,
      paidAmount: newPaidTotal,
      remaining: remainingMoney(invoiceTotal, newPaidTotal),
    };
  }

  /**
   * The recordPayment state guard (R0-D3: a 409, not a 500). A PAID or VOID
   * invoice takes no further payment; a DRAFT one has not been issued
   * (R0-PL-03, G3). Run on the pre-transaction read and again under the
   * invoice lock (ST-PL03-1).
   */
  private static assertInvoiceAcceptsPayment(status: string): void {
    if (status === 'PAID' || status === 'VOID' || status === 'DRAFT') {
      throw new ConflictException(`Cannot record payment on a ${status} invoice`);
    }
  }

  /**
   * R0-PL-04 review (CR-PL04-1): the amount mark-paid records, or a 409 when
   * no amount would be true. The amount is computeBalance's remaining, the
   * figure the reconcile settles against.
   *
   * V1-29 (D-14): every refund is now a separate negative REFUNDED row beside
   * its SUCCESSFUL original, counted once, so after a refund mark-paid records
   * the true remaining (60 + 40 paid, 40 refunded: 40). What still blocks is a
   * row the manual refund flipped to REFUNDED before V1-29 (a positive
   * REFUNDED row with no SUCCESSFUL twin): computeBalance both drops it from
   * `paid` and subtracts it as `refunded` (60 paid and refunded on a 100
   * invoice reads remaining 160), so recording 160 would post an invented 60
   * over-payment and recording the true 100 would leave the reconcile
   * PARTIALLY_PAID; mark-paid refuses such an invoice and writes nothing. A
   * remaining above the total (refunds exceeding payments) is refused the same
   * way. Run on the pre-transaction read and again under the invoice lock.
   * (The balance reads and the reconcile read such a row as its payment plus
   * its refund since the V1-29 review, CR-V29-4: balanceOfStoredRows. Mark-paid
   * keeps refusing it: settling legacy refunded invoices waits for the owner's
   * backfill decision.)
   */
  private static markPaidRemaining(
    total: number,
    rows: Array<{ amount: number; status: string }>,
    currency?: string | null,
  ): number {
    const flippedRefund = rows.some((r) => r.status === 'REFUNDED' && Number(r.amount) > 0);
    const balance = computeBalance(total, rows, currency ?? undefined);
    if (flippedRefund || toCents(balance.remaining) > toCents(balance.total)) {
      throw new ConflictException(
        'Cannot mark an invoice paid after one of its payments was refunded; record the payment received instead',
      );
    }
    return balance.remaining;
  }

  /**
   * R0-D2: providerPaymentId for a manual record.
   *
   *   idempotencyKey (trimmed, non-empty)  -> manual_<invoiceId>_key_<sha256(key)>
   *   else reference (trimmed, non-empty),
   *        when dedupeByReference          -> manual_<invoiceId>_ref_<sha256(reference + amount)>
   *   else                                 -> manual_<now>_<random>   (keyedOn: null)
   *
   * The key is scoped to the invoice. Without a key, on the HTTP route only
   * (CR-1), the same non-empty reference for the same amount on the same
   * invoice is the same offline payment (the journey's duplicate slip); the
   * same reference for a different amount is a different payment. The hash
   * keeps the unique column bounded whatever the client sends. The `manual_`
   * prefix is part of the existing contract for manually recorded payments.
   */
  private static manualProviderPaymentId(
    invoiceId: string,
    input: { amount: number; reference?: string; idempotencyKey?: string },
    dedupeByReference: boolean,
  ): { value: string; keyedOn: 'key' | 'reference' | null } {
    const digest = (material: string) => createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
    const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (key.length > 0) {
      return { value: `manual_${invoiceId}_key_${digest(key)}`, keyedOn: 'key' };
    }
    const reference = dedupeByReference && typeof input.reference === 'string' ? input.reference.trim() : '';
    if (reference.length > 0) {
      // V1-22: the amount as stored (cents); for a cent amount this is the same text as before.
      return { value: `manual_${invoiceId}_ref_${digest(`${reference}\n${roundMoney(input.amount).toFixed(2)}`)}`, keyedOn: 'reference' };
    }
    return { value: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, keyedOn: null };
  }

  /**
   * R0-PL-03: serialize payment writes per invoice. Taken first inside the
   * payment and refund transactions, so a concurrent payment or refund on the
   * same invoice waits for this one to commit, and its in-transaction
   * reconcile then reads every committed row: two partial payments that
   * together settle the invoice end PAID with one invoice.paid, instead of
   * each reconciling against a snapshot without the other. FOR NO KEY UPDATE
   * is the lock a plain UPDATE of the row takes; it does not block the
   * foreign-key checks of rows that reference the invoice.
   *
   * R0-PL-03 review (ST-PL03-1): returns the row as it stands once the lock
   * is held (under READ COMMITTED a locking read returns the latest committed
   * version, after waiting for any writer), so recordPayment re-runs its
   * guards on it. Null when the invoice no longer exists.
   */
  private static async lockInvoiceForPayment(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<{ status: string; businessId: string; deletedAt: Date | null } | null> {
    const rows = await tx.$queryRaw<Array<{ status: string; businessId: string; deletedAt: Date | null }>>`
      SELECT status::text AS "status", business_id AS "businessId", deleted_at AS "deletedAt"
      FROM invoices WHERE id = ${invoiceId} FOR NO KEY UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * R0-D2 review (ST-D2-1): the idempotency record is looked up inside the
   * caller's tenant AND invoice. Payment.providerPaymentId is unique
   * table-wide but client-chosen on other surfaces (the public WiPay
   * callback), so a row from another tenant or invoice occupying this slot
   * is never handed back as this caller's replay.
   */
  private findRecordedPayment(providerPaymentId: string, businessId: string, invoiceId: string) {
    return this.prisma.client.payment.findFirst({ where: { providerPaymentId, businessId, invoiceId } });
  }

  /** Prisma P2002 raised by the Payment.providerPaymentId unique index (not by another index inside the same transaction). */
  private static isProviderPaymentIdConflict(err: unknown): boolean {
    const e = err as { code?: string; meta?: { target?: unknown } } | null;
    if (e?.code !== 'P2002') return false;
    const target = e.meta?.target;
    if (target == null) return true;
    const fields = Array.isArray(target) ? target.map(String) : [String(target)];
    return fields.some((f) => /provider_?payment_?id/i.test(f));
  }

  /**
   * R0-D2: answer a duplicate submit with the payment it already recorded, in
   * the same envelope as a fresh record and with the current balance. Nothing
   * is written, reconciled, posted or logged. A key reused for a different
   * amount is a conflict, not a replay; so is a slot whose payment is no
   * longer SUCCESSFUL.
   */
  private async replayRecordedPayment(existing: Payment, invoiceId: string, amount: number, keyedOn: 'key' | 'reference') {
    if (!moneyEquals(Number(existing.amount), amount)) {
      throw new ConflictException('Idempotency key already used on this invoice with a different amount');
    }
    // R0-D2 review (ST-D2-2): once the operator refunded the payment in this
    // slot, a later genuine receipt under the same key or reference + amount
    // is not a replay of a successful record. A silent 201 no-op would leave
    // that key/reference permanently dead on this invoice while the API
    // reports success and writes nothing; answer 409 so the operator records
    // the new receipt under a new key/reference.
    //
    // V1-29: a refund no longer flips the payment; it stays SUCCESSFUL beside
    // a linked refund row, so a refund against it is looked up as well.
    const slot = keyedOn === 'key' ? 'idempotency key' : 'reference and amount';
    const fresh = keyedOn === 'key' ? 'idempotency key' : 'reference';
    if (existing.status !== 'SUCCESSFUL') {
      throw new ConflictException(
        `A payment with this ${slot} was already recorded on this invoice and is now ${existing.status}` +
          (existing.status === 'REFUNDED' ? ' (refunded)' : '') +
          `; use a new ${fresh} to record another payment`,
      );
    }
    const refunded = await CommerceService.refundedAgainst(this.prisma.client as unknown as Prisma.TransactionClient, existing);
    if (toCents(refunded) > 0) {
      throw new ConflictException(
        `A payment with this ${slot} was already recorded on this invoice and was refunded; use a new ${fresh} to record another payment`,
      );
    }
    // DEP-R3-OWN-ROW-READS (D-75): the invoice's own-tenant rows (M31), so a
    // row of another business neither appears in the replay nor counts in its
    // paidAmount/remaining. `existing` was found under the caller's tenant and
    // this invoice (findRecordedPayment), so its businessId is the invoice's.
    const updatedInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: { where: { businessId: existing.businessId } }, contact: true, items: true },
    });
    // V1-29 (CF-17): the figures every balance reader serves (computeBalance):
    // paidAmount is what is received net of refunds, remaining is total - net.
    const balance = balanceOfStoredRows(Number(updatedInvoice?.total ?? 0), updatedInvoice?.payments ?? [], updatedInvoice?.currency);
    return {
      payment: existing,
      invoice: updatedInvoice,
      paidAmount: balance.net,
      remaining: balance.remaining,
    };
  }

  /**
   * List every payment row for a business, with rich filtering.
   *
   * V1-41c-MONEY-ROW-COUNTERS (V1-41b residual): a confirmed extracted row
   * (status CONFIRMED, PaymentEvidenceService.CONFIRMED_EXTRACTED_PAYMENT_STATUS)
   * is not listed, as listPayments leaves it out since V1-41b: it keeps its
   * full amount beside the SUCCESSFUL payment the member recorded from it, so
   * the payments page showed the same money twice. A status filter cannot
   * bring it back. PENDING, FAILED and refund rows stay listed under their own
   * status.
   *
   * Payment sits outside the tenant extension with no FK to Business (M31), so
   * a row carrying this businessId can name another business's invoice. That
   * row is this business's own and is listed, but without the invoice: never
   * that invoice's number, total or customer (review SEC-OR-2, D-75, below).
   * No invoice balance or counter of this business counts it (ownTenantPayments).
   */
  async listAllPayments(businessId: string, filters: {
    status?: string;
    method?: string;
    provider?: string;
    contactId?: string;
    minAmount?: number;
    maxAmount?: number;
    from?: string | Date;
    to?: string | Date;
  } = {}) {
    const where: Prisma.PaymentWhereInput = {
      businessId,
      // The literal avoids importing payment-evidence.service (see listPayments).
      NOT: { status: 'CONFIRMED' },
    };
    if (filters.status) where.status = filters.status;
    if (filters.method) where.method = filters.method;
    if (filters.provider) where.provider = filters.provider;
    if (filters.minAmount != null || filters.maxAmount != null) {
      const amount: Prisma.FloatFilter = {};
      if (filters.minAmount != null) amount.gte = filters.minAmount;
      if (filters.maxAmount != null) amount.lte = filters.maxAmount;
      where.amount = amount;
    }
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = new Date(filters.from);
      if (filters.to) createdAt.lte = new Date(filters.to);
      where.createdAt = createdAt;
    }
    if (filters.contactId) {
      // Review SEC-OR-2 (M31): the contact filter matches this business's own
      // invoices only, so another tenant's customer id finds nothing here.
      where.invoice = { is: { contactId: filters.contactId, businessId } };
    }

    const payments = await this.prisma.client.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        invoice: {
          select: {
            id: true,
            businessId: true,
            invoiceNumber: true,
            status: true,
            currency: true,
            total: true,
            dueDate: true,
            issueDate: true,
            receiptSentAt: true,
            contactId: true,
            contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    // Review SEC-OR-2 (M31, the payment side of D-75): Payment sits outside the
    // tenant extension and has no FK to Business, so this business's row can
    // name another business's invoice. The row is this business's and is
    // listed; the invoice is not, so its number, total and customer (name,
    // email) are not served with it. The relation include is not narrowed by
    // the tenant extension, hence the check here.
    return payments.map((payment) =>
      payment.invoice && payment.invoice.businessId !== businessId ? { ...payment, invoice: null } : payment,
    );
  }

  /**
   * V1-29 (D-14): how much has been refunded against a payment, in currency
   * units: the sum of its linked refund rows. A refund row is linked by the
   * provider convention: a negative REFUNDED row on the same invoice and
   * tenant whose `reference` is the original's providerPaymentId (the manual
   * refund since V1-29, refundCharge, the PayPal refund webhook when it names
   * the capture, and the Stripe refund webhook for a payment stored under its
   * charge id). The Stripe webhook links by the charge id only, so the refund
   * of a Checkout Session or PaymentIntent payment (stored as cs_ / pi_) does
   * not link here; the manual refund accounts for such refunds through
   * refundableOf (V1-29 review SEC-V29-1 / CR-V29-5). Used by the replay guard
   * of a manually recorded payment, whose refunds are always linked. Payment
   * sits outside the tenant extension (M31), so the tenant is in the filter.
   */
  private static async refundedAgainst(
    db: Prisma.TransactionClient,
    payment: { businessId: string; invoiceId: string; providerPaymentId: string },
  ): Promise<number> {
    const rows = await db.payment.findMany({
      where: {
        businessId: payment.businessId,
        invoiceId: payment.invoiceId,
        status: 'REFUNDED',
        amount: { lt: 0 },
        reference: payment.providerPaymentId,
      },
      select: { amount: true },
    });
    return sumMoney(rows.map((r) => Math.abs(Number(r.amount))));
  }

  /**
   * V1-29 review (SEC-V29-1 / CR-V29-5): what is left to refund of `payment`,
   * from the Payment rows of its invoice and tenant (`rows`, the payment
   * included), or a 0 with the reason nothing is left.
   *
   * 1. Its linked refunds are subtracted: a negative REFUNDED row whose
   *    `reference` is the payment's providerPaymentId, or, from the same
   *    provider, the payment's own `reference` (a PaymentIntent payment keeps
   *    its charge id there, the id the Stripe refund webhook links by).
   * 2. A refund row that links to no payment on the invoice is subtracted too
   *    when it comes from the same provider. The Stripe refund webhook writes
   *    reference = the charge id while a Checkout Session payment is stored as
   *    cs_ with its pi_ in reference, and the PayPal webhook without a capture
   *    id writes no reference: such a refund cannot be told apart from a
   *    refund of this payment, so it is counted against each payment of that
   *    provider on the invoice. A payment the provider already refunded is
   *    then not refunded a second time; a refund that cannot be matched errs
   *    towards refusing, never towards paying out twice.
   * 3. Never more than the invoice's net received (balanceOfStoredRows): a
   *    refund cannot take the invoice below nothing received, whatever refund
   *    rows the providers wrote.
   */
  private static refundableOf(
    payment: { amount: number; provider: string; providerPaymentId: string; reference: string | null },
    rows: ReadonlyArray<{ amount: number; status: string; provider: string; providerPaymentId: string; reference: string | null }>,
  ): { amount: number; refusal: string | null } {
    const isRefundRow = (r: { status: string; amount: number }) => r.status === 'REFUNDED' && Number(r.amount) < 0;
    const linksTo = (
      refund: { provider: string; reference: string | null },
      original: { provider: string; providerPaymentId: string; reference: string | null },
    ) =>
      !!refund.reference &&
      (refund.reference === original.providerPaymentId ||
        (refund.provider === original.provider && refund.reference === original.reference));
    const refunds = rows.filter(isRefundRow);
    const originals = rows.filter((r) => !isRefundRow(r));
    const linked = sumMoney(refunds.filter((r) => linksTo(r, payment)).map((r) => Math.abs(Number(r.amount))));
    const leftLinked = subtractMoney(Number(payment.amount), linked);
    if (!(toCents(leftLinked) > 0)) return { amount: 0, refusal: 'Payment is already refunded' };
    const unmatched = sumMoney(
      refunds
        .filter((r) => r.provider === payment.provider && !originals.some((o) => linksTo(r, o)))
        .map((r) => Math.abs(Number(r.amount))),
    );
    const leftUnmatched = subtractMoney(leftLinked, unmatched);
    if (!(toCents(leftUnmatched) > 0)) {
      return {
        amount: 0,
        refusal: `Payment is already refunded: a ${payment.provider} refund on this invoice that cannot be matched to one payment covers it`,
      };
    }
    const net = balanceOfStoredRows(0, rows).net;
    if (!(toCents(net) > 0)) {
      return { amount: 0, refusal: 'Payment is already refunded: nothing received on this invoice is left to refund' };
    }
    return { amount: Math.min(leftUnmatched, net), refusal: null };
  }

  /**
   * Refund a payment (no provider call — local bookkeeping only).
   *
   * V1-29-DM-REFUND-CONVENTION (M28, CF-11, D-14): the refund is a separate
   * negative REFUNDED Payment row, the convention the provider refunds already
   * use: the SUCCESSFUL original is kept as it was, and the refund row carries
   * `-amount`, the original's currency, provider and method, `reference` =
   * the original's providerPaymentId (the link), the reason in its notes and
   * the refunder in `recordedBy`. computeBalance then counts the money once
   * in `paid` and once in `refunded`. The base flipped the original to
   * REFUNDED instead, which computeBalance subtracted twice (a full refund of
   * 100 read net -100, remaining 200, status still PAID). What is refunded is
   * what is left of the payment after its earlier refunds (a provider partial
   * refund included, also one that does not link to it, and never more than
   * the invoice's net received: refundableOf); a payment with nothing left
   * answers 409 "already refunded" and writes nothing, which makes a replay
   * of the same refund a no-op. The original's payment_recorded posting is reversed once
   * (RevenuePostingService.onPaymentRefunded, idempotent), and the reconcile
   * reopens the invoice: PARTIALLY_PAID while something net is still
   * received, SENT with paidAt cleared once nothing is (D-14). The response
   * is the refund row, plus `refundOfPaymentId`, the reconciled
   * `invoiceStatus` and its `balance`, so a status the reconcile kept (see
   * onIllegalTransition below) is visible to the caller.
   *
   * R0-PL-07: `actorId` (the refunding user) is written to the reversal
   * FinancialTransaction.createdById and, since V1-29, to the refund row's
   * recordedBy. The original's recordedBy keeps the original recorder.
   *
   * R0-PL-07 review (PL07-ST-1): only a SUCCESSFUL payment can be refunded.
   * A PENDING / FAILED payment, a refund row, or a row flipped to REFUNDED
   * before V1-29 answers 409 and changes nothing. The checks run again under
   * the invoice lock, so two concurrent refunds of the same payment produce
   * one refund and one 409.
   *
   * R0-CMF2-PAYMENT-ACTOR-GAPS (ST-R011-2): every refund, posted or not,
   * writes one FINANCE payment_refunded activity row naming the refunder
   * (actorId; KEY is SYSTEM). A payment with no payment_recorded posting (a
   * mark-paid row written before R0-PL-04) used to name its refunder nowhere.
   * The row is written inside the refund transaction (R0-CMF2 review
   * SEC-CMF2-1 / CR-CMF2-1): a committed refund always has it, a refund that
   * rolls back leaves none, and a failed insert fails the refund rather than
   * committing a refund that names nobody.
   */
  async markPaymentRefunded(paymentId: string, businessId: string, reason?: string, actorId?: string | null) {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, businessId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const refusal = (row: { status: string; amount: number }) =>
      new ConflictException(
        row.status !== 'REFUNDED'
          ? `Only a successful payment can be refunded (this payment is ${row.status})`
          : Number(row.amount) < 0
            ? 'A refund cannot itself be refunded'
            : 'Payment is already refunded',
      );
    if (payment.status !== 'SUCCESSFUL') throw refusal(payment);
    // FIN2 — write the refund row + reverse the original posting in one tx so
    // the refund and the offsetting ledger entries commit together.
    //
    // R0-PL-03 (G12): the invoice reconcile runs in the same transaction. A
    // reconcile error is not swallowed: it rolls the refund back and is the
    // caller's response, so the payment rows, the ledger and the invoice
    // status never disagree. Invoice events are emitted after commit.
    const pendingEvents: Array<{ name: string; payload: unknown }> = [];
    const { refund, reconciled } = await this.prisma.client.$transaction(async (tx) => {
      const txClient = tx as unknown as Prisma.TransactionClient;
      // Serialized with payments and other refunds of this invoice
      // (R0-PL-03): the reads below see every refund committed before ours.
      await CommerceService.lockInvoiceForPayment(txClient, payment.invoiceId);
      const current = await tx.payment.findFirst({ where: { id: paymentId, businessId } });
      if (!current) throw new NotFoundException('Payment not found');
      if (current.status !== 'SUCCESSFUL') throw refusal(current);
      // What is left of the payment after its earlier refunds, linked or not,
      // capped at the invoice's net received (V1-29 review SEC-V29-1 / CR-V29-5).
      const invoiceRows = await tx.payment.findMany({
        where: { businessId, invoiceId: current.invoiceId },
        select: { amount: true, status: true, provider: true, providerPaymentId: true, reference: true },
      });
      const left = CommerceService.refundableOf(current, invoiceRows);
      if (left.refusal) throw new ConflictException(left.refusal);
      const refundable = left.amount;
      const created = await tx.payment.create({
        data: {
          amount: subtractMoney(0, refundable),
          currency: current.currency,
          status: 'REFUNDED',
          provider: current.provider,
          method: current.method,
          // Unique and server-built; the link to the original is `reference`.
          providerPaymentId: `manual_refund_${current.id}_${randomBytes(8).toString('hex')}`,
          reference: current.providerPaymentId,
          notes: reason ? `Refunded: ${reason}` : null,
          recordedBy: actorId ?? null,
          businessId,
          invoiceId: current.invoiceId,
        },
      });
      await this.revenuePosting.onPaymentRefunded(current.id, {
        tx: txClient,
        createdById: actorId ?? null,
        // The refund's audit row (posted or not) names the refunder and
        // commits or rolls back with the refund.
        auditInTransaction: true,
      });
      const r = await this.invoiceWorkflow.reconcileFromPayments(current.invoiceId, {
        tx: txClient,
        eventBuffer: pendingEvents,
        // R0-PL-03 review (ST-PL03-3 / CR-1): reversing money must not be
        // blocked by invoice status bookkeeping. When the status the rows
        // now imply is not reachable from the current one (a DRAFT invoice
        // holding payments, e.g. after undoInvoice or from pre-G3 data, or
        // a credit-note status outside the transition map), the status is
        // left as it is and the refund commits; the response says so.
        // Any other reconcile failure still rolls the refund back (G12).
        onIllegalTransition: 'keep',
      });
      return { refund: created, reconciled: r };
    });
    for (const evt of pendingEvents) {
      this.events.emit(evt.name, evt.payload);
    }
    this.statsCache.invalidateCache(businessId);
    return {
      ...refund,
      refundOfPaymentId: payment.id,
      invoiceStatus: reconciled.status,
      balance: reconciled.balance,
    };
  }

  /** Retry a failed payment by flipping it to PENDING and emitting an event. */
  async retryPayment(paymentId: string, businessId: string) {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, businessId },
      include: { invoice: { select: { contactId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'FAILED') {
      throw new BadRequestException('Only failed payments can be retried');
    }
    const updated = await this.prisma.client.payment.update({
      where: { id: paymentId },
      data: { status: 'PENDING' },
    });
    if (payment.invoice?.contactId && payment.invoiceId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: payment.invoice.contactId,
        type: 'invoice.payment_retry_initiated',
        data: { paymentId, invoiceId: payment.invoiceId, amount: payment.amount },
        actorType: 'USER',
        source: 'commerce',
      });
    }
    return updated;
  }

  /** Mark that a receipt was (re)sent for an invoice. */
  async markReceiptSent(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const updated = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { receiptSentAt: new Date() },
      select: { id: true, receiptSentAt: true },
    });
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: invoice.contactId,
        type: 'invoice.receipt_resent',
        data: { invoiceId },
        actorType: 'USER',
        source: 'commerce',
      });
    }
    return updated;
  }

  /**
   * Returns a unified, time-ordered invoice activity timeline assembled from
   * payments, the invoice's own status timestamps, and matching ContactEvent
   * rows. Used by the invoice detail drawer to show created/sent/viewed/
   * partial-payment/paid/reminder/receipt entries.
   */
  async getInvoiceTimeline(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      // DEP-R3-OWN-ROW-READS (D-75): the invoice's own-tenant payment rows (M31).
      include: { payments: { where: { businessId }, orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const entries: Array<{
      id: string;
      type: string;
      label: string;
      at: Date;
      data?: Record<string, unknown>;
    }> = [];

    entries.push({
      id: `created-${invoice.id}`,
      type: 'invoice.created',
      label: 'Invoice created',
      at: invoice.createdAt,
      data: { total: invoice.total, currency: invoice.currency },
    });
    if (invoice.sentAt) {
      entries.push({
        id: `sent-${invoice.id}`,
        type: 'invoice.sent',
        label: 'Invoice sent',
        at: invoice.sentAt,
      });
    }
    for (const p of invoice.payments) {
      if (p.status === 'SUCCESSFUL') {
        entries.push({
          id: `pay-${p.id}`,
          type: 'invoice.payment_recorded',
          label: `Payment of ${p.amount} ${p.currency} via ${p.method ?? p.provider ?? 'manual'}`,
          at: p.createdAt,
          data: { amount: p.amount, method: p.method, reference: p.reference },
        });
      } else if (p.status === 'REFUNDED') {
        entries.push({
          id: `refund-${p.id}`,
          type: 'invoice.refund',
          label: `Refund of ${Math.abs(p.amount)} ${p.currency}`,
          at: p.createdAt,
        });
      } else if (p.status === 'FAILED') {
        entries.push({
          id: `fail-${p.id}`,
          type: 'invoice.payment_failed',
          label: 'Payment attempt failed',
          at: p.createdAt,
        });
      }
    }
    if (invoice.paidAt) {
      entries.push({
        id: `paid-${invoice.id}`,
        type: 'invoice.paid',
        label: 'Invoice fully paid',
        at: invoice.paidAt,
      });
    }
    if (invoice.contactId) {
      const events = await this.prisma.client.contactEvent.findMany({
        where: {
          businessId,
          contactId: invoice.contactId,
          type: {
            in: [
              'invoice.viewed',
              'invoice.payment_reminder_sent',
              'invoice.receipt_sent',
              'invoice.overdue',
              'invoice.void',
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      for (const e of events) {
        const data = (e.data as Record<string, unknown>) ?? {};
        if (data.invoiceId !== invoice.id) continue;
        const labels: Record<string, string> = {
          'invoice.viewed': 'Invoice viewed by client',
          'invoice.payment_reminder_sent': `Reminder sent${data.channel ? ` (${String(data.channel)})` : ''}`,
          'invoice.receipt_sent': `Receipt sent${data.channel ? ` (${String(data.channel)})` : ''}`,
          'invoice.overdue': 'Invoice marked overdue',
          'invoice.void': 'Invoice voided',
        };
        entries.push({
          id: `evt-${e.id}`,
          type: e.type,
          label: labels[e.type] ?? e.type,
          at: e.createdAt,
          data,
        });
      }
    }

    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { invoiceId, entries };
  }

  /**
   * Sends a payment reminder for the given invoice via Gmail (if connected)
   * and persists the canonical `invoice.payment_reminder_sent` ContactEvent
   * (the PAYMENT_REMINDER_SENT spec event from R2). Returns success metadata
   * even when Gmail isn't connected so the UI can fall back to a local copy.
   */
  async sendInvoiceReminder(input: {
    invoiceId: string;
    businessId: string;
    actorId?: string;
    customMessage?: string;
    channel?: 'email' | 'whatsapp' | 'manual';
    deliver: (params: {
      invoice: import('@prisma/client').Invoice & {
        contact: import('@prisma/client').Contact | null;
        items: import('@prisma/client').InvoiceItem[];
        payments: import('@prisma/client').Payment[];
        business: import('@prisma/client').Business | null;
      };
      recipientEmail: string | null;
      paymentUrl: string | null;
    }) => Promise<{ delivered: boolean; messageId?: string }>;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId, deletedAt: null },
      include: { contact: true, items: true, payments: true, business: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new BadRequestException(`Cannot send reminder for ${invoice.status} invoice`);
    }

    // Always provide a pay CTA in the reminder. Reuse the active link if one
    // already exists, otherwise create one — `createPaymentLink` itself
    // returns the existing active row when present, so this is idempotent.
    let paymentUrl: string | null = null;
    let link = await this.prisma.client.paymentLink.findFirst({
      // V1-48: an active link past its expiry is not reused (it would put a dead link in the reminder).
      where: { invoiceId: invoice.id, businessId: input.businessId, ...CommerceService.liveLinkWhere() },
    });
    // ST-V48-1: a live pre-V1-48 cuid token is rotated before it goes into the reminder.
    if (link) link = await this.reissueLink(link);
    if (!link) {
      try {
        link = await this.createPaymentLink(invoice.id, input.businessId);
      } catch (err: any) {
        // Reminders are only sent for non-PAID/non-VOID invoices, so the
        // "paid or voided" refusal shouldn't normally fire — but if a
        // payment landed between the status check above and link creation
        // we degrade to a CTA-less reminder rather than 500. Anything else
        // is a real failure and should surface.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/paid or voided/i.test(msg)) throw err;
        link = null;
      }
    }
    if (link) {
      const { appUrl } = await import('../../core/config/runtime-urls');
      paymentUrl = `${appUrl()}/public/invoice/${link.token}`;
    }

    const recipientEmail = invoice.contact?.email ?? null;
    const channel = input.channel ?? (recipientEmail ? 'email' : 'manual');

    let delivered: boolean;
    let messageId: string | undefined;
    try {
      const result = await input.deliver({ invoice, recipientEmail, paymentUrl });
      delivered = result.delivered;
      messageId = result.messageId;
    } catch (err: any) {
      // Persist the event regardless so the timeline shows the operator's
      // intent even when delivery fails — but surface the error to the UI.
      this.events.emit('invoice.reminder_failed', {
        invoice,
        businessId: invoice.businessId,
        reason: (err as Error).message,
      });
      throw err;
    }

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_reminder_sent',
        data: {
          invoiceId: invoice.id,
          channel,
          messageId: messageId ?? null,
          recipientEmail,
          status: invoice.status,
        },
        actorType: input.actorId ? 'USER' : 'SYSTEM',
        actorId: input.actorId,
        source: 'commerce',
      });
    }

    this.events.emit('invoice.payment_reminder_sent', {
      invoice,
      businessId: invoice.businessId,
      channel,
      eventName: 'invoice.payment_reminder_sent',
    });

    return { delivered, channel, messageId, paymentUrl };
  }

  /**
   * Logs a `invoice.receipt_sent` event (called by the controller after
   * rendering & emailing the receipt). Centralised so both the auto-on-paid
   * listener and the manual "Resend receipt" path use the same log shape.
   */
  async recordReceiptSent(input: {
    invoiceId: string;
    businessId: string;
    channel: 'email' | 'manual';
    recipientEmail?: string | null;
    messageId?: string | null;
    actorId?: string | null;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
      select: { id: true, contactId: true, businessId: true },
    });
    if (!invoice || !invoice.contactId) return;
    await this.crm.logContactEvent({
      businessId: invoice.businessId,
      contactId: invoice.contactId,
      type: 'invoice.receipt_sent',
      data: {
        invoiceId: invoice.id,
        channel: input.channel,
        recipientEmail: input.recipientEmail ?? null,
        messageId: input.messageId ?? null,
      },
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      actorId: input.actorId ?? undefined,
      source: 'commerce',
    });
  }

  /**
   * Records a one-shot `invoice.viewed` ContactEvent the first time a
   * client opens the public payment-link page. Subsequent views within the
   * same calendar day are coalesced so we don't spam the timeline.
   */
  async recordInvoiceView(invoiceId: string, businessId: string, contactId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.client.contactEvent.findFirst({
      where: {
        businessId,
        contactId,
        type: 'invoice.viewed',
        createdAt: { gte: since },
      },
    });
    if (recent) {
      const data = (recent.data as Record<string, unknown>) ?? {};
      if (data.invoiceId === invoiceId) return;
    }
    await this.crm.logContactEvent({
      businessId,
      contactId,
      type: 'invoice.viewed',
      data: { invoiceId, channel: 'public_link' },
      actorType: 'SYSTEM',
      source: 'commerce',
    });
  }

  async listPayments(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) {
      // A cross-tenant read answered 500 here (plain Error); it is a 404.
      throw new NotFoundException('Invoice not found');
    }
    // DEP-R3-OWN-ROW-READS (D-75): the invoice's own-tenant rows (M31): a row
    // of another business was listed as this invoice's money and counted in
    // paidAmount (trial-N round 2, F2).
    const payments = await this.prisma.client.payment.findMany({
      where: { invoiceId, businessId },
      orderBy: { createdAt: 'desc' },
    });
    // V1-22: summed and subtracted in cents (the float sum read 0.01 + 33.33 x 3 as 99.99999999999999).
    // CR-V22-1: remaining is 0 once the paid sum settles the stored total.
    // V1-29 (CF-17): computeBalance's net and remaining, the figures the
    // reconcile derives the status from, so a refund row counts here too
    // (summing SUCCESSFUL rows alone read a refunded invoice as still paid).
    const balance = balanceOfStoredRows(Number(invoice.total), payments, invoice.currency);
    return {
      // V1-41b (V1-41 review CR-V41-4): a confirmed extracted row (status
      // CONFIRMED, PaymentEvidenceService.CONFIRMED_EXTRACTED_PAYMENT_STATUS)
      // keeps its full amount beside the SUCCESSFUL payment the member
      // recorded from it, so listing it showed the same money twice. It is
      // not money (the balance above ignores it, and it is read over every
      // row as before) and is not listed; the row itself is kept. The literal
      // avoids importing payment-evidence.service, which imports this one.
      payments: payments.filter((p) => p.status !== 'CONFIRMED'),
      paidAmount: balance.net,
      remaining: balance.remaining,
      invoiceTotal: invoice.total,
    };
  }

  // ========== UPDATE INVOICE ==========

  /**
   * @param actorId Who makes a status change (R0-CMF1-INVOICE-PATCH-ACTOR, R0-11
   *   review ST-R011-1). It is recorded as Payment.recordedBy, the posting's
   *   createdById and the timeline actor, and checked by markInvoicePaid /
   *   updateInvoiceStatus exactly as on their own routes (a human needs a
   *   Membership; KEY needs the tenant, which `input.businessId` is). The HTTP
   *   PATCH passes the authenticated user. Omitted means KEY: the one caller
   *   that omits it is KEY's flow tool executor (`commerce_update_invoice` in
   *   ai/flow-orchestrator.service.ts), and a human caller must always pass it.
   *   It used to be hard-coded to KEY_SYSTEM_ACTOR_ID for every caller, so a
   *   person's PATCH {status:'PAID'} was recorded as KEY's payment.
   */
  async updateInvoice(input: {
    invoiceId: string;
    businessId: string;
    contactId?: string | null;
    items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    dueDate?: Date | string | null;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED' | null;
    discountValue?: number | null;
    notes?: string | null;
    status?: PatchableInvoiceStatus;
  }, actorId?: string) {
    // R0-CMF1 review SEC-CMF1-1: the DTO's @IsIn does not protect this path.
    // KEY's commerce_update_invoice calls this with the model's raw
    // args.status, so a SENT invoice was moved to PARTIALLY_PAID, PENDING or
    // FAILED with no payment behind it (the transition committed, then the
    // timeline refused the event type and the tool reported a failure). Every
    // caller is held to the HTTP contract, with its message, before anything
    // is read or written.
    if (
      input.status !== undefined &&
      input.status !== null &&
      !(PATCHABLE_INVOICE_STATUSES as readonly unknown[]).includes(input.status)
    ) {
      throw new BadRequestException(`status must be one of the following values: ${PATCHABLE_INVOICE_STATUSES.join(', ')}`);
    }
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    this.validateTaxAndDiscount(input.taxRate, input.discountValue ?? undefined, input.discountType ?? undefined);
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      // R0-D3: a state guard is a 409, not a 500.
      throw new ConflictException('Cannot edit a paid or partially paid invoice');
    }

    if (input.status && input.status !== invoice.status) {
      // input.businessId was in scope the whole time and was never passed.
      //
      // Both callees validate the actor, and 'key_ai' resolves to no Membership
      // — so every status change through updateInvoice threw "Not authorized",
      // which means commerce_update_invoice failed on 100% of status changes
      // from the day it shipped. It is also the tenant proof the system actor
      // now requires: KEY's authority is the scope its caller established, and
      // this caller had established it and thrown it away.
      //
      // R0-CMF1: the actor is the caller's, never assumed (see @param actorId).
      // An empty actor is refused rather than written as no one.
      const actor = actorId === undefined ? KEY_SYSTEM_ACTOR_ID : actorId;
      if (!actor) {
        throw new ForbiddenException('Not authorized to update this invoice');
      }
      if (input.status === 'PAID') {
        return this.markInvoicePaid(input.invoiceId, actor, input.businessId);
      }
      return this.updateInvoiceStatus({
        invoiceId: input.invoiceId,
        status: input.status as 'SENT' | 'OVERDUE' | 'VOID',
        actorId: actor,
        businessId: input.businessId,
        dueDate: input.dueDate,
      });
    }

    // R0-D3 review (ST-D3-1): the id is bound to the row and the row is
    // returned with `include: { contact: true }`, so an id from another
    // tenant both bound a foreign reference and disclosed that tenant's
    // contact (email, phone, notes, every field). Resolve it inside the
    // caller's tenant first; a foreign, deleted or unknown id answers like
    // a missing one, and nothing is written.
    const contactId =
      input.contactId !== undefined ? await this.assertContactInBusiness(input.contactId, input.businessId) : undefined;
    // V1-37 (D-13): a named currency is held to the create rule, upper-cased.
    const currency = input.currency !== undefined ? await this.documentCurrency(input.businessId, input.currency) : undefined;

    // FOLLOW3-B2 review (SEC-B2-2, B2-CR-2): the edit is one transaction that
    // first takes the invoice row lock every money door takes (SELECT ... FOR
    // NO KEY UPDATE, lockInvoiceForPayment) and re-reads the invoice under it,
    // and every guard below decides on that row, not on the read above. The
    // edit used to decide "DRAFT" on that earlier read, then delete the lines
    // and write the new lines and total by id alone, so a Send that committed
    // in between (a double submit, a second member, KEY sending while a person
    // edits) left a SENT invoice whose total was not the receivable the Send
    // had posted. Now a Send's status write (InvoiceWorkflowService.transition)
    // waits for the edit to commit and posts the edited total, and an edit
    // that waited for a Send reads SENT and is held to D-60 below.
    const { result, previousDueDate } = await this.prisma.client.$transaction(async (tx) => {
      const txClient = tx as unknown as Prisma.TransactionClient;
      const locked = await CommerceService.lockInvoiceForPayment(txClient, input.invoiceId);
      if (!locked || locked.businessId !== input.businessId) {
        throw new NotFoundException('Invoice not found');
      }
      const current = await tx.invoice.findFirst({ where: { id: input.invoiceId, businessId: input.businessId } });
      if (!current) {
        throw new NotFoundException('Invoice not found');
      }
      if (current.status === 'PAID' || current.status === 'PARTIALLY_PAID') {
        throw new ConflictException('Cannot edit a paid or partially paid invoice');
      }
      // FOLLOW3-B2 review (SEC-B2-1, B2-CR-1): an invoice is issued when it
      // has left DRAFT, or when it is a DRAFT whose issued total the ledger or
      // a credit note still holds (holdsIssuedMoney): the AI undo returns an
      // issued invoice to DRAFT and leaves its recognition in place. That is
      // read only when the edit names the currency or the amounts.
      const touchesMoney =
        currency !== undefined ||
        input.items !== undefined ||
        input.taxRate !== undefined ||
        input.discountType !== undefined ||
        input.discountValue !== undefined;
      const issued =
        current.status !== 'DRAFT' || (touchesMoney && (await CommerceService.holdsIssuedMoney(txClient, current)));
      const issuedAs = current.status === 'DRAFT' ? 'an issued invoice returned to DRAFT' : `a ${current.status} invoice`;

      const updateData: any = {};
      if (contactId !== undefined) updateData.contactId = contactId;
      if (currency !== undefined) {
        // V1-37 review (ST-V37-1): the currency is fixed once the invoice is
        // issued. Issuing posts accounts receivable in the invoice's currency
        // (accrual), and that posting is idempotent on its key, so a SENT USD
        // invoice switched to TTD took its payment in TTD while the USD
        // receivable stayed open for ever. Restating the stored currency is
        // not a change (an edit form sends the whole document) and stays
        // allowed.
        if (currency !== normalizeCurrency(current.currency) && issued) {
          throw new ConflictException(`Cannot change the currency of ${issuedAs}: the currency is fixed once the invoice is issued`);
        }
        updateData.currency = currency;
      }
      if (input.dueDate !== undefined) {
        updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      }
      if (input.notes !== undefined) updateData.notes = input.notes;

      // FOLLOW3-B2 (owner ruling D-60): once the invoice is issued its lines,
      // tax and discount are fixed, as its currency is (ST-V37-1 above).
      // Issuing posted its receivable (accrual) at the stored total,
      // idempotently, and the payment reconcile settles against that total: an
      // edit rewrote the lines and total of a SENT, OVERDUE, FAILED, PENDING or
      // VOID invoice and neither re-posted nor reconciled, so an ACCRUAL
      // receivable of 100 edited to 80 and paid stayed at 20, and a CASH
      // invoice paid 60 and edited to 50 stayed OVERDUE. A change is refused
      // (409) before anything is written; a correction is a void-and-reissue
      // or a credit note (D-28). Restating the stored lines and terms (an edit
      // form sends the whole document) is not a change: it passes, and neither
      // branch below runs, so the stored lines (their productIds included,
      // which the web form omits) and every amount are left exactly as they
      // are.
      if (issued) await this.assertIssuedInvoiceAmountsRestated(txClient, current, issuedAs, input);

      if (input.items && !issued) {
        // R0-D3 review (ST-D3-2): InvoiceItem.productId is an FK to Product with
        // no tenant check, so a line could bind another tenant's product and
        // downstream catalog/inventory consumers of invoice_items.product_id
        // would act on it. Every referenced product must resolve inside the
        // caller's tenant before the existing items are deleted below, so a
        // denied path writes nothing. The validated set is exactly the set
        // written: an empty productId is "no product", never an FK value.
        const productIds = Array.from(
          new Set(
            input.items
              .map((item) => item.productId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          ),
        );
        if (productIds.length > 0) {
          const products = await tx.product.findMany({
            where: { id: { in: productIds }, businessId: input.businessId },
            select: { id: true },
          });
          if (products.length !== productIds.length) {
            throw new NotFoundException('Product not found');
          }
        }
        const taxRate = input.taxRate ?? current.taxRate ?? 0;
        const discountType = input.discountType !== undefined ? input.discountType : current.discountType;
        const discountValue = input.discountValue !== undefined ? input.discountValue : current.discountValue;
        // V1-22 (D-13): in integer cents, the same rules as create.
        const amounts = computeDocumentAmounts({
          lines: input.items.map((item) => lineAmount(item.quantity, item.unitPrice)),
          taxRate,
          discountType,
          discountValue,
        });
        const { subtotal, taxAmount, discountAmount, total } = amounts;
        // R0-27 review (ST-27-3): the same amount rules as create, checked before
        // the existing items are deleted, so a refused edit writes nothing.
        this.assertInvoiceAmounts({ subtotal, total, discountType, discountValue });
        await tx.invoiceItem.deleteMany({ where: { invoiceId: input.invoiceId } });

        updateData.subtotal = subtotal;
        updateData.taxRate = taxRate;
        updateData.taxAmount = taxAmount;
        updateData.discountType = discountType;
        updateData.discountValue = discountValue;
        updateData.discountAmount = discountAmount;
        updateData.total = total;
        updateData.items = {
          create: input.items.map((item, i) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: amounts.lineTotals[i],
            productId: item.productId || null,
          })),
        };
      } else if (!issued && (input.taxRate !== undefined || input.discountType !== undefined || input.discountValue !== undefined)) {
        const taxRate = input.taxRate ?? current.taxRate ?? 0;
        const discountType = input.discountType !== undefined ? input.discountType : current.discountType;
        const discountValue = input.discountValue !== undefined ? input.discountValue : current.discountValue;
        // V1-22 (D-13): recomputed in cents from the stored subtotal (a legacy
        // row may hold the raw float sum; it is rewritten in cents with the rest).
        const { subtotal, taxAmount, discountAmount, total } = computeDocumentAmounts({
          lines: [current.subtotal],
          taxRate,
          discountType,
          discountValue,
        });
        // R0-27 review (ST-27-3): a FIXED discount above the stored subtotal is refused.
        this.assertInvoiceAmounts({ subtotal, total, discountType, discountValue });
        updateData.subtotal = subtotal;
        updateData.taxRate = taxRate;
        updateData.taxAmount = taxAmount;
        updateData.discountType = discountType;
        updateData.discountValue = discountValue;
        updateData.discountAmount = discountAmount;
        updateData.total = total;
      }

      const updated = await tx.invoice.update({
        where: { id: input.invoiceId },
        data: updateData,
        include: { items: true, contact: true },
      });
      return { result: updated, previousDueDate: current.dueDate };
    });
    // Events and the cache follow the commit, so no listener reads a refused
    // or rolled-back edit.
    const prevDue = previousDueDate ? new Date(previousDueDate).getTime() : null;
    const newDue = result.dueDate ? new Date(result.dueDate).getTime() : null;
    if (input.dueDate !== undefined && prevDue !== newDue) {
      this.events.emit('invoice.due_date_changed', {
        invoice: result,
        businessId: input.businessId,
        previousDueDate: previousDueDate ?? null,
      });
    }
    this.events.emit('invoice.updated', { invoice: result, businessId: input.businessId });
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  /**
   * FOLLOW3-B2 review (SEC-B2-1, B2-CR-1): whether the ledger or a credit note
   * holds the invoice's issued total: a posting sourced on the invoice (its
   * accrual recognition, Invoice:<id>:invoice_finalized, or any other), or a
   * credit note issued against it (D-28). A DRAFT holding either was issued
   * and then returned to DRAFT by the AI undo (CommerceService.undoInvoice ->
   * InvoiceWorkflowService.returnToDraftOnUndo), which writes the status alone
   * and leaves them in place. Re-pricing it left the posted receivable at the
   * old total, and sending it again posts nothing (onInvoiceFinalized is
   * idempotent per invoice): ACCRUAL 100 undone, edited to 80, re-sent and
   * paid left 20.00 of receivable open, and an undone PAID ACCRUAL invoice
   * escaped the paid-invoice guard the same way. Such an invoice keeps its
   * amounts and currency as an issued one does (D-60).
   *
   * A payment alone is not such a record. On the CASH basis a payment posts
   * the money it received (sourced on the payment, not the invoice), nothing
   * stands at the old total, and the next payment door reconciles against the
   * edited one: paid, undone, edited, re-issued and marked paid again is a
   * pinned flow (payments-mark-paid MP-16, R0-PL-04 review CR-PL04-2). A DRAFT
   * never issued, or a CASH one undone (with or without payments), stays
   * editable. Read on the edit's transaction under the invoice row lock, which
   * the credit-note writers take and the status writers wait for.
   */
  private static async holdsIssuedMoney(
    tx: Prisma.TransactionClient,
    invoice: { id: string; businessId: string },
  ): Promise<boolean> {
    const businessId = invoice.businessId;
    const posting = await tx.financialTransaction.findFirst({
      where: { businessId, sourceType: 'Invoice', sourceId: invoice.id },
      select: { id: true },
    });
    if (posting) return true;
    const creditNote = await tx.creditNote.findFirst({ where: { businessId, invoiceId: invoice.id }, select: { id: true } });
    return Boolean(creditNote);
  }

  /**
   * FOLLOW3-B2 (owner ruling D-60): an edit of an issued invoice (one that
   * left DRAFT, or a DRAFT whose issued total is still held: holdsIssuedMoney)
   * may restate its lines, tax and discount but not change them. `issuedAs`
   * names it in the refusal ("a SENT invoice", "an issued invoice returned to
   * DRAFT"). Throws 409 unless:
   *  - the effective tax rate (a sent one, else the stored one, as the edit
   *    applies it) equals the stored one;
   *  - the effective discount equals the stored one, where "no discount" is
   *    any type other than PERCENT / FIXED or a zero/absent value, as
   *    computeDocumentAmounts prices it (the web form sends {null, null} for
   *    "none" whatever type is stored);
   *  - when lines are sent, they are the stored lines: as many, each matching
   *    one stored line on description, quantity and unitPrice, and on
   *    productId when it names one (an omitted or empty productId keeps the
   *    stored one). Lines are matched in any order: invoice reads return them
   *    unordered, and an edit form sends them back in the order it read.
   * Read-only: it runs before any write, on the edit's transaction (the stored
   * lines are read under the invoice row lock).
   */
  private async assertIssuedInvoiceAmountsRestated(
    tx: Prisma.TransactionClient,
    invoice: { id: string; taxRate: number | null; discountType: string | null; discountValue: number | null },
    issuedAs: string,
    input: {
      items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED' | null;
      discountValue?: number | null;
    },
  ): Promise<void> {
    const changed = () =>
      new ConflictException(
        `Cannot change the amounts of ${issuedAs}: its lines, tax and discount are fixed once it is issued; ` +
          'correct it by voiding it and issuing a new invoice, or with a credit note',
      );
    if (Number(input.taxRate ?? invoice.taxRate ?? 0) !== Number(invoice.taxRate ?? 0)) throw changed();
    const discount = (type: string | null | undefined, value: number | null | undefined) =>
      (type === 'PERCENT' || type === 'FIXED') && value ? `${type}:${Number(value)}` : 'none';
    const discountType = input.discountType !== undefined ? input.discountType : invoice.discountType;
    const discountValue = input.discountValue !== undefined ? input.discountValue : invoice.discountValue;
    if (discount(discountType, discountValue) !== discount(invoice.discountType, invoice.discountValue)) throw changed();

    if (!input.items) return;
    const stored = await tx.invoiceItem.findMany({
      where: { invoiceId: invoice.id },
      select: { description: true, quantity: true, unitPrice: true, productId: true },
    });
    if (input.items.length !== stored.length) throw changed();
    // Lines naming a product are matched first, so an unnamed line (which
    // matches any product) never takes the stored line a named one needs.
    const names = (item: { productId?: string }) => typeof item.productId === 'string' && item.productId.length > 0;
    const unmatched = [...stored];
    for (const item of [...input.items.filter(names), ...input.items.filter((i) => !names(i))]) {
      const at = unmatched.findIndex(
        (line) =>
          line.description === item.description &&
          Number(line.quantity) === Number(item.quantity) &&
          Number(line.unitPrice) === Number(item.unitPrice) &&
          (!names(item) || line.productId === item.productId),
      );
      if (at < 0) throw changed();
      unmatched.splice(at, 1);
    }
  }

  /**
   * V1-37 (CF-38): campaign revenue per currency. It added every invoice's
   * total whatever its currency and labelled the sum with the first row's
   * currency. `byCurrency` holds each currency's figures; the top-level
   * figures are the business currency's, named by `currency`; invoiceCount
   * stays the campaign's whole count. Cents-safe (sumMoney).
   */
  async getCampaignRevenue(businessId: string, campaignId: string) {
    const [invoices, business] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          campaignId,
          deletedAt: null,
          status: { in: ['PAID', 'PARTIALLY_PAID', 'SENT', 'OVERDUE'] },
        },
        select: { id: true, total: true, status: true, currency: true },
      }),
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
    ]);
    const currency = normalizeCurrency(business?.currency) || 'TTD';
    const byCurrency: Record<string, { totalRevenue: number; pipelineRevenue: number; invoiceCount: number }> = {};
    const codes = new Set<string>([...D13_CURRENCIES, currency, ...invoices.map((i) => normalizeCurrency(i.currency))]);
    codes.delete('');
    for (const code of [...codes].sort()) {
      const rows = invoices.filter((i) => normalizeCurrency(i.currency) === code);
      byCurrency[code] = {
        totalRevenue: sumMoney(rows.filter((i) => i.status === 'PAID').map((i) => Number(i.total ?? 0))),
        pipelineRevenue: sumMoney(rows.filter((i) => i.status !== 'PAID').map((i) => Number(i.total ?? 0))),
        invoiceCount: rows.length,
      };
    }
    return {
      totalRevenue: byCurrency[currency].totalRevenue,
      pipelineRevenue: byCurrency[currency].pipelineRevenue,
      invoiceCount: invoices.length,
      currency,
      byCurrency,
    };
  }

  /**
   * Returns any payment link (active or not) for an invoice — used by flows
   * that need to surface a previously-issued public URL even when the invoice
   * is no longer eligible for new link creation (PAID / VOID). Most recent
   * link first.
   */
  async findAnyPaymentLink(invoiceId: string, businessId: string) {
    const link = await this.prisma.client.paymentLink.findFirst({
      where: { invoiceId, businessId },
      orderBy: { createdAt: 'desc' },
    });
    // Every caller hands this token out again (resend, receipt email), so a
    // live legacy token is rotated first (ST-V48-1). A dead link is returned as is.
    return link ? this.reissueLink(link) : null;
  }

  /**
   * The customer's public invoice URL, `<app>/public/invoice/<token>`: the
   * invoice's live pay link, minted when it has none (createPaymentLink). A
   * PAID or VOID invoice cannot get a new link, so the most recent one it was
   * given is handed out again (findAnyPaymentLink), or null when it never had
   * one. Any other refusal (unknown invoice, another tenant's) is thrown.
   *
   * V1-46b-TOKEN-PAY-COMPLETE (CR-01; D-07: token links only): the single
   * place a customer-facing invoice URL is built. The operator's invoice
   * emails (send-email, reminder, resend-receipt in commerce.controller.ts)
   * use it directly (send-email through sendWithPublicInvoiceUrl, which
   * hands out the same link and removes one it wrote when the send did not
   * go out, R0-CMF4); the automated producers (overdue, due-soon and
   * payment-failed emails, KEY's invoice_sent, autopilot payment recovery)
   * go through automatedInvoiceUrl, which never mints a link for an invoice
   * whose links were all revoked or expired (V1-46b review SEC-V46B-1/2).
   * None of them emits a bare /pay/<invoiceId> URL any more.
   */
  async publicInvoiceUrl(invoiceId: string, businessId: string): Promise<string | null> {
    try {
      const link = await this.createPaymentLink(invoiceId, businessId);
      return `${appUrl()}/public/invoice/${link.token}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only the known "paid or voided" refusal is swallowed; the three callers
      // that match on this text are unchanged (R0-D3).
      if (!/paid or voided/i.test(msg)) throw err;
      const existing = await this.findAnyPaymentLink(invoiceId, businessId);
      return existing ? `${appUrl()}/public/invoice/${existing.token}` : null;
    }
  }

  /**
   * V1-46b review (SEC-V46B-1, SEC-V46B-2, CR-V46B-01): the customer invoice
   * URL for a message no operator asked for at that moment: the overdue,
   * due-soon and payment-failed emails (flow.listener), KEY's invoice_sent
   * (flow-orchestrator) and autopilot payment recovery (delegation-loop).
   *
   * It reuses the invoice's live link, and mints one only for an invoice that
   * has never had a link of its own tenant (publicInvoiceUrl). When every link
   * the invoice has is revoked or past its expiry it answers null: the
   * message goes without a pay button. Minting there would undo the
   * operator's revocation or expiry with a link that never expires, reopen
   * the bare-id routes (isBareIdPublicAccessOpen) and mail the new token,
   * and an anonymous WiPay failure callback (payment.failed) could trigger
   * it. Only the operator's own send-email, reminder and payment-link routes
   * issue a new link for such an invoice (publicInvoiceUrl).
   */
  async automatedInvoiceUrl(invoiceId: string, businessId: string): Promise<string | null> {
    const links = await this.prisma.client.paymentLink.findMany({
      where: { invoiceId, businessId },
      select: { active: true, expiresAt: true },
    });
    const now = new Date();
    if (links.length > 0 && !links.some((l) => l.active && (!l.expiresAt || l.expiresAt > now))) return null;
    return this.publicInvoiceUrl(invoiceId, businessId);
  }

  /**
   * R0-CMF4-SEND-EMAIL-ORDER (COST-LEDGER-001 section 7 item 3): the
   * operator's invoice send-email, with the pay link publicInvoiceUrl would
   * hand out (D-07), where a send the provider did not accept leaves no new
   * PaymentLink row. `send` gets the URL to put in the message and resolves
   * once the provider accepted it.
   *
   * - The invoice has a live link (or is PAID or VOID, or unknown):
   *   publicInvoiceUrl, unchanged. It reuses that link (a live pre-V1-48
   *   token is still rotated before it goes out, ST-V48-1), surfaces the
   *   latest one, or throws its 404. No row is created, so a failed send
   *   leaves no new one.
   * - It has none: the row is written before the send, with the pending
   *   expiry PENDING_SEND_EXPIRY (R0-CMF4 review SEC-CMF4-3). It is live, so
   *   any request made while the message is with the provider (a second
   *   send-email, a reminder, POST payment-link, an automated email) hands
   *   out this one link instead of writing another, and reissueLink clears
   *   the pending expiry when it does. An accepted send clears it too
   *   (expiresAt null: exactly one live link, the one the message carries;
   *   a resend reuses it). A refused (503) or failed send deletes the row
   *   only while it is still pending and active, so it leaves no new
   *   PaymentLink unless another request handed the link out meanwhile
   *   (then it is that request's link too) or the operator revoked it.
   */
  async sendWithPublicInvoiceUrl<T>(
    invoiceId: string,
    businessId: string,
    send: (paymentUrl: string | null) => Promise<T>,
  ): Promise<T> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      select: { status: true },
    });
    const mintable = !!invoice && invoice.status !== 'PAID' && invoice.status !== 'VOID';
    const live = mintable
      ? await this.prisma.client.paymentLink.findFirst({
          where: { invoiceId, businessId, ...CommerceService.liveLinkWhere() },
          select: { id: true },
        })
      : null;
    if (!mintable || live) return send(await this.publicInvoiceUrl(invoiceId, businessId));

    const link = await this.prisma.client.paymentLink.create({
      data: { invoiceId, businessId, token: CommerceService.newPaymentLinkToken(), expiresAt: CommerceService.PENDING_SEND_EXPIRY },
    });
    const pending = { id: link.id, expiresAt: CommerceService.PENDING_SEND_EXPIRY };
    let result: T;
    try {
      result = await send(`${appUrl()}/public/invoice/${link.token}`);
    } catch (err) {
      await this.prisma.client.paymentLink.deleteMany({ where: { ...pending, active: true } });
      throw err;
    }
    await this.prisma.client.paymentLink.updateMany({ where: pending, data: { expiresAt: null } });
    return result;
  }

  /**
   * R0-CMF4 review (SEC-CMF4-3): the expiry of a pay link sendWithPublicInvoiceUrl
   * wrote for a send that is still with the provider. It is in the future, so
   * the link is live and every other caller hands out this one; a value no
   * expiresInDays produces, so reissueLink knows the row is still only that
   * send's to remove. The send, or the first other caller to hand the link
   * out, sets it back to null (no expiry).
   */
  private static readonly PENDING_SEND_EXPIRY = new Date('9999-12-31T23:59:59.999Z');

  /**
   * V1-48-PUBLIC-TOKEN-VIEW (M34): the pay-link token is the customer's whole
   * credential, so it is 24 crypto-random bytes (32 base64url characters),
   * the same as a quote's view token. It is passed explicitly on create; the
   * column default (cuid()) is left alone, so no migration is needed and
   * links issued before this keep working until they are handed out again
   * (see reissueLink).
   */
  private static newPaymentLinkToken(): string {
    return randomBytes(24).toString('base64url');
  }

  /** The shape the cuid() column default gave every token before V1-48: 'c' and 24 lowercase base36. */
  private static readonly LEGACY_LINK_TOKEN = /^c[a-z0-9]{24}$/;

  /**
   * An existing link about to be handed out again (POST .../payment-link,
   * send, reminder, resend, receipt), with `expiresAt` applied when given.
   *
   * ST-V48-1: a live link (active, not past its expiry) whose token is still a
   * pre-V1-48 cuid gets a crypto-random token in place, so no path keeps
   * re-issuing the guessable credential. The row (id, createdAt, expiry) is
   * kept and only the token changes: the cuid URL in an earlier email then
   * answers as unknown, and the message being sent carries the new one. The
   * swap is a compare-and-set on the old token, so of two concurrent callers
   * one rotates and the other reads that row back: both hand out one token.
   * A dead link and a token of any other shape are left as they are; the
   * customer view never rotates (it would break the URL being opened).
   *
   * R0-CMF4 review (SEC-CMF4-3): a live link whose send-email is still with
   * the provider (PENDING_SEND_EXPIRY) is claimed first: its pending expiry
   * is cleared, so a send that fails afterwards no longer removes the link
   * this caller hands out. It is read back; if that send already removed it,
   * the 409 asks the caller to try again rather than hand out a dead link.
   */
  private async reissueLink<T extends { id: string; token: string; active: boolean; expiresAt: Date | null }>(
    link: T,
    expiresAt?: Date,
  ) {
    if (link.active && link.expiresAt?.getTime() === CommerceService.PENDING_SEND_EXPIRY.getTime()) {
      await this.prisma.client.paymentLink.updateMany({
        where: { id: link.id, expiresAt: CommerceService.PENDING_SEND_EXPIRY },
        data: { expiresAt: null },
      });
      const claimed = await this.prisma.client.paymentLink.findUnique({ where: { id: link.id } });
      if (!claimed) throw new ConflictException('The pay link was withdrawn while it was being handed out; try again.');
      link = { ...link, ...claimed };
    }
    const live = link.active && (!link.expiresAt || link.expiresAt > new Date());
    if (!live || !CommerceService.LEGACY_LINK_TOKEN.test(link.token)) {
      if (!expiresAt) return link;
      return this.prisma.client.paymentLink.update({ where: { id: link.id }, data: { expiresAt } });
    }
    const swapped = await this.prisma.client.paymentLink.updateMany({
      where: { id: link.id, token: link.token },
      data: { token: CommerceService.newPaymentLinkToken(), ...(expiresAt ? { expiresAt } : {}) },
    });
    if (swapped.count === 0 && expiresAt) {
      // A concurrent caller rotated it first; this caller's expiry still applies.
      return this.prisma.client.paymentLink.update({ where: { id: link.id }, data: { expiresAt } });
    }
    return this.prisma.client.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
  }

  /**
   * `expiresInDays` as an expiry date: undefined/null means "not given";
   * anything else must be a positive number of days that yields a real date,
   * otherwise 400 (at the base a negative value stored a link already
   * expired, and a string or huge value reached Prisma as an invalid date).
   */
  private static paymentLinkExpiry(expiresInDays: unknown): Date | undefined {
    if (expiresInDays === undefined || expiresInDays === null) return undefined;
    const days = expiresInDays as number;
    const at = typeof days === 'number' && Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86400000) : null;
    if (!at || !Number.isFinite(at.getTime())) {
      throw new BadRequestException('expiresInDays must be a positive number of days');
    }
    return at;
  }

  /**
   * One active link per invoice, reused. V1-48 (M34): a reusable link is
   * active and not past its expiry; an active link that has expired is never
   * handed out again (the customer would get a dead link), and a fresh one is
   * minted. A new `expiresInDays` is applied to the reused link, keeping its
   * token so links already sent keep working until the new expiry, unless
   * that token is a pre-V1-48 cuid, which is rotated (reissueLink, ST-V48-1).
   */
  async createPaymentLink(invoiceId: string, businessId: string, expiresInDays?: number) {
    const expiresAt = CommerceService.paymentLinkExpiry(expiresInDays);
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      // R0-D3: a state guard is a 409, not a 500. The three callers that
      // swallow this refusal match on the message text, which is unchanged.
      throw new ConflictException('Cannot create payment link for a paid or voided invoice');
    }

    const existing = await this.prisma.client.paymentLink.findFirst({
      where: { invoiceId, businessId, ...CommerceService.liveLinkWhere() },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.reissueLink(existing, expiresAt);

    return this.prisma.client.paymentLink.create({
      data: { invoiceId, businessId, token: CommerceService.newPaymentLinkToken(), expiresAt: expiresAt ?? null },
    });
  }

  /** A link that may still be handed to a customer: active and not past its expiry. */
  private static liveLinkWhere(): Prisma.PaymentLinkWhereInput {
    return { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
  }

  /**
   * V1-48-PUBLIC-TOKEN-VIEW (CF-18): paid and remaining for the public token
   * view, so the customer's link shows what has arrived and what is still
   * owed. The figures are computeBalance's `paid` and `remaining`, the same
   * the bare-id projection and the status route serve, over this invoice's
   * Payment rows of its own tenant: Payment sits outside the tenant
   * extension and has no FK to Business (M31), so a row carrying another
   * tenant's businessId is not this invoice's money. No row, reference or
   * amount per payment leaves here. `paidAt` only when the invoice is PAID.
   *
   * V1-29: a refund is a separate negative row (D-14), so `amountDue` is
   * total - net. FOLLOW3-A4-PUBLIC-PAID-NET (CR-29b-1): `amountPaid` is the
   * net received, max(0, balanceOfStoredRows(...).net), the figure the public
   * receipt states beside it on /public/invoice/[token] and the pay page and
   * the status poll serve. It was computeBalance's gross `paid`: 60 + 40 paid
   * with the 40 refunded showed "Paid 100" beside the receipt's "Received 60".
   */
  async getPaymentLinkBalance(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: {
        status: true,
        total: true,
        currency: true,
        paidAt: true,
        payments: { where: { businessId }, select: { amount: true, status: true } },
      },
    });
    if (!invoice) return null;
    const balance = balanceOfStoredRows(Number(invoice.total), invoice.payments, invoice.currency);
    return {
      amountPaid: Math.max(0, balance.net),
      amountDue: balance.remaining,
      paidAt: invoice.status === 'PAID' ? invoice.paidAt ?? null : null,
    };
  }

  async getPaymentLinkByToken(token: string) {
    const link = await this.prisma.client.paymentLink.findUnique({
      where: { token },
      select: {
        id: true,
        token: true,
        active: true,
        expiresAt: true,
        invoiceId: true,
        businessId: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            currency: true,
            status: true,
            businessId: true,
          },
        },
      },
    });
    if (!link || !link.active) return null;
    if (link.expiresAt && link.expiresAt < new Date()) return null;
    // V1-48 (M31): nothing ties a link's businessId to its invoice's, so a
    // link row of another tenant would open this invoice. It reads as unknown.
    const { businessId: invoiceBusinessId, ...invoice } = link.invoice;
    if (invoiceBusinessId !== link.businessId) return null;
    return { ...link, invoice };
  }

  /**
   * V1-46-PUB-PAY-LINK-TOKEN-GATE (M34, D-07: token links only, the bare-id
   * pay page is retired): the customer pay page's read, keyed by the pay-link
   * token. The projection is `getInvoicePublicView`, the one the bare-id
   * public read serves an anonymous caller (KF-REVENUE-AUTH-PROJECTION-001),
   * so the token page renders what the retired /pay/:invoiceId page rendered
   * and discloses nothing more. A link that is unknown, inactive, expired or
   * of another tenant, and an invoice the projection does not share (DRAFT,
   * VOID, FAILED, PENDING, deleted), read as absent.
   *
   * V1-46b-TOKEN-PAY-COMPLETE (review ST-1, TG-16): the read no longer
   * carries the invoice `id`. The page needed it only for the provider
   * checkouts, the gateway list and the PayPal capture, which are now keyed
   * by the token too (payments.controller.ts, public/invoice-link/:token/...),
   * so no JSON answer of the pay page or its token routes carries the id; the
   * bare-id routes close behind a revoked link as well
   * (isBareIdPublicAccessOpen). `businessId` stays: the tenant key is public
   * and the page's presence tracker reads it.
   *
   * Review SEC-V46B-4: this is not "the customer never learns the id". A
   * WiPay checkout hands it to WiPay as `order_id` (WiPay's hosted page and
   * callback are keyed by it), so it is in the WiPay redirect and comes back
   * on the return URL. Holding it gives nothing after the link is revoked or
   * expires: the bare-id routes answer 404 and no automated producer mints a
   * new link (automatedInvoiceUrl). The unsigned WiPay callback keyed by it is
   * TG-22 (M35, V1-05).
   */
  async getPayPageByToken(token: string) {
    const link = await this.getPaymentLinkByToken(token);
    if (!link) return null;
    const view = await this.getInvoicePublicView(link.invoiceId);
    if (!view || view.businessId !== link.businessId) return null;
    const projection: Omit<NonNullable<typeof view>, 'id'> & { id?: string } = { ...view };
    delete projection.id;
    return projection;
  }

  /**
   * V1-46 (M34): the customer's payment intent, keyed by the pay-link token.
   * The link is resolved before anything else, so a deactivated or expired
   * link answers 404 whatever the body says; behind a live link the intent is
   * exactly the R0-22 contract of `recordPublicPaymentIntent` (one PENDING
   * row on the invoice's own tenant, no status change, no posting). The 404
   * is the same body that method gives a non-payable invoice.
   */
  async recordPaymentIntentByToken(token: string, method: string, amount?: unknown) {
    const link = await this.getPaymentLinkByToken(token);
    if (!link) throw new NotFoundException('Invoice not found');
    return this.recordPublicPaymentIntent(link.invoiceId, method, amount);
  }

  async listPaymentLinks(businessId: string) {
    return this.prisma.client.paymentLink.findMany({
      where: { businessId, active: true },
      include: { invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, contact: { select: { firstName: true, lastName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivatePaymentLink(id: string, businessId: string) {
    return this.prisma.client.paymentLink.updateMany({
      where: { id, businessId },
      data: { active: false },
    });
  }

  /**
   * The statuses a customer may record a payment intent against: shareable
   * and not settled. PAID answers 409; every other status (DRAFT, VOID,
   * FAILED, PENDING), a soft-deleted invoice and an unknown id answer the same
   * 404, because the public pay page cannot show them either.
   */
  private static readonly INTENT_PAYABLE_STATUSES: ReadonlySet<string> = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID']);

  /**
   * A customer's anonymous "I will pay by <method>" from the public pay page.
   * V1-46: reached only through `recordPaymentIntentByToken` (POST
   * /commerce/public/invoice-link/:token/payment-intent); the bare-id route
   * POST /commerce/invoices/:invoiceId/payment-intent is retired (D-07).
   *
   * R0-22-PUBLIC-INTENT-HARDEN (CF-12): the caller holds only a bare invoice
   * id, so this writes nothing but one PENDING Payment row on the invoice's
   * own tenant. It no longer moves the invoice to PENDING: PENDING is not a
   * shareable status, so the customer's own pay link answered 404 after they
   * confirmed an offline payment, and anyone holding an id could hide another
   * tenant's SENT invoice. PENDING rows are ignored by computeBalance and post
   * nothing to the ledger; the operator records the money via recordPayment().
   *
   * - One PENDING intent per invoice and method. A repeat answers the same
   *   success; it writes nothing when it states the same amount, and otherwise
   *   updates that one row to what the latest intent states (capped at the
   *   balance as it is now), so neither an earlier anonymous writer nor a stale
   *   amount from before an operator part payment sticks. The lookup runs
   *   under the invoice row lock, so concurrent repeats serialize instead of
   *   racing, and the row id is random, so two intents in one millisecond no
   *   longer collide on the providerPaymentId unique index (the old
   *   manual_<id>_<Date.now()> key answered 500).
   * - Payable-state gate: see INTENT_PAYABLE_STATUSES; PAID, or nothing left to
   *   pay, answers 409.
   * - The amount, when given, must be a finite number of at least 0.01 once
   *   rounded to cents (400 otherwise); it is stored rounded and capped at the
   *   remaining balance. When absent (the pay page never sends one) it is
   *   stored as 0, as at the base: the customer declared no amount, and
   *   several readers (open payables, the overdue-invoice scan, the money
   *   health score) sum Payment.amount whatever its status, so a defaulted
   *   balance would read as money paid.
   */
  async recordPublicPaymentIntent(invoiceId: string, method: string, amount?: unknown) {
    const validMethods = ['bank_transfer', 'cash', 'check', 'other', 'google_pay'];
    if (!validMethods.includes(method)) {
      throw new BadRequestException('Invalid offline payment method');
    }
    // Validated before the invoice is read, so a 400 says nothing about the id.
    let declared: number | undefined;
    if (amount !== undefined) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        throw new BadRequestException('Payment amount must be a number');
      }
      if (amount <= 0) {
        throw new BadRequestException('Payment amount must be positive');
      }
      // Stored in cents, like every other money value; a sub-cent amount
      // (1e-9) would otherwise be stored as given and claim the method's slot.
      declared = roundMoney(amount);
      if (declared < 0.01) {
        throw new BadRequestException('Payment amount must be at least 0.01');
      }
    }

    const notFound = () => new NotFoundException('Invoice not found');
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true, invoiceNumber: true, currency: true },
    });
    if (!invoice) throw notFound();

    await this.prisma.client.$transaction(async (tx) => {
      const locked = await CommerceService.lockInvoiceForPayment(tx as unknown as Prisma.TransactionClient, invoiceId);
      if (!locked || locked.deletedAt || locked.businessId !== invoice.businessId) throw notFound();
      if (locked.status === 'PAID') throw new ConflictException('Invoice is already paid');
      if (!CommerceService.INTENT_PAYABLE_STATUSES.has(locked.status)) throw notFound();

      // Trial-N round 2 (recheck F1): what is still owed is read from the
      // invoice's own-tenant rows (M31, as reconcileIn and recordPayment read
      // them, RC-DEP-2): a row of another business is not money received or
      // returned, so it neither answers 'already paid' nor moves the cap.
      const current = await tx.invoice.findFirst({
        where: { id: invoiceId },
        select: { total: true, currency: true, payments: { where: { businessId: invoice.businessId }, select: { amount: true, status: true } } },
      });
      // A row the manual refund flipped to REFUNDED before V1-29 is read as
      // its payment plus its refund (balanceOfStoredRows, V1-29 review
      // CR-V29-4), so `remaining` no longer exceeds the total for it; an
      // intent still never asks for more than either.
      const balance = balanceOfStoredRows(Number(current?.total ?? 0), current?.payments ?? [], current?.currency);
      const remaining = Math.min(balance.remaining, balance.total);
      if (remaining <= 0) throw new ConflictException('Invoice is already paid');

      // What this intent states: the declared amount capped at what is still
      // owed now, or 0 when none was declared (see the method comment).
      const intentAmount = declared === undefined ? 0 : Math.min(declared, remaining);

      const existing = await tx.payment.findFirst({
        where: { invoiceId, businessId: invoice.businessId, status: 'PENDING', method, provider: method },
        select: { id: true, amount: true },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        // The latest intent for a method is the one that stands: refresh the
        // row when it states a different amount; an identical repeat writes nothing.
        if (Number(existing.amount) !== intentAmount) {
          await tx.payment.update({ where: { id: existing.id }, data: { amount: intentAmount } });
        }
        return;
      }

      // PENDING — customer-asserted intent, no money yet, so no FIN2 posting
      // until the operator records the actual receipt via recordPayment().
      await tx.payment.create({
        data: {
          invoiceId,
          businessId: invoice.businessId,
          amount: intentAmount,
          currency: invoice.currency || 'TTD',
          status: 'PENDING',
          provider: method,
          providerPaymentId: `manual_${invoiceId}_intent_${randomBytes(16).toString('hex')}`,
          method,
          reference: `Intent: ${invoice.invoiceNumber}`,
          notes: `Customer indicated ${method} payment via public payment page`,
        },
      });
    });

    return { success: true, method, invoiceNumber: invoice.invoiceNumber };
  }
}

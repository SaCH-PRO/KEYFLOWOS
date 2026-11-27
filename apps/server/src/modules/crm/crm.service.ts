import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Contact, Prisma } from '@prisma/client';
import {
  ContactCreatedPayload,
  ContactDeletedPayload,
  ContactMergedPayload,
  ContactUpdatedPayload,
} from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { sanitize } from '../../core/utils/sanitize';
import { BULK_LIMIT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, TASK_PRIORITY, TASK_STATUS, type ContactStatus } from './crm.constants';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CrmTimelineService } from './crm-timeline.service';
import { ContactCustomFieldValueService } from './contact-custom-field-value.service';
import { CrmStatsService, type ContactMeta, type ContactWithStats } from './crm-stats.service';
import { CrmListsService } from './crm-lists.service';
import { CrmFlowService } from './crm-flow.service';
import { ContactAuditService, ContactAuditActor, type ContactAuditClient, type ContactAuditWriteOptions } from './privacy/contact-audit.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { buildContactWhere, findSearchTags } from './contact-filters.helper';
import { assertContactVisible, contactVisibilityFilter, resolveCrmAccess, visibilityClause, type CrmAccess } from './crm-permissions.helper';
import { resolveTimelineViewer } from '../timeline/timeline-visibility';
import { contactPhoneKey, normalizeEmail, normalizePhone, findExistingBulk, findPhoneKeyMatch, livePhoneHolderIds } from './crm-duplicate.util';
import { contactPhoneForStorage, normalizeToE164, phoneFlagFor, phoneKeyReadsAs, severityFor, syntaxValidEmail, type PhoneFlagField } from './crm-data-quality.util';
import { CONTACT_EVENT } from '@keyflow/shared';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';

/**
 * Optional request-scoped audit context that controllers can plumb
 * through to mutation methods so per-contact audit entries capture
 * actor/IP/UA. All fields are optional; when omitted the audit entry
 * is recorded with a SYSTEM actor.
 */
export interface AuditContext {
  actor?: ContactAuditActor | null;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}

/**
 * W3-V1-55c review (SEC-V55C-1, CR-V155c-1; owner ruling D-90, on D-08): the
 * contact.created bus payload createContact emits. Beside ContactCreatedPayload
 * it carries the actor the contact's contact.created ContactEvent records
 * (eventActor of the audit context: USER and the member for POST /contacts,
 * none for a caller that names no actor). Since that ContactEvent has no
 * Activity copy (meta.feedCopy=false), ActivityEventListener's 'New contact'
 * is the create's one feed row, and it names this actor as the copy did.
 */
export type ContactCreatedEmit = ContactCreatedPayload & { actorType?: string; actorId?: string };

type ContactSortBy = 'name' | 'newest' | 'oldest' | 'revenue' | 'score' | 'lastInteraction';

export type ContactListOptions = {
  businessId: string;
  status?: string;
  search?: string;
  hasUnpaidInvoices?: boolean;
  hasUpcomingBookings?: boolean;
  hasOpenDeals?: boolean;
  dealStageIds?: string[];
  staleDays?: number;
  newThisWeek?: boolean;
  tags?: string[];
  ownerId?: string;
  lifecycleStage?: string;
  companyName?: string;
  industry?: string;
  city?: string;
  country?: string;
  segment?: string;
  doNotContact?: boolean;
  ageGroups?: string[];
  relationshipTypes?: string[];
  priorities?: string[];
  relationshipHealth?: string[];
  pipelineStages?: string[];
  favorite?: boolean;
  includeArchived?: boolean;
  bestChannels?: string[];
  bestTimeNow?: boolean;
  bestTimeNowIds?: string[];
  skip?: number;
  take?: number;
  cursor?: string;
  includeStats?: boolean;
  sortBy?: ContactSortBy;
  sortOrder?: 'asc' | 'desc';
  minRevenue?: number;
  /**
   * When provided, applies M7 ownership/visibility scoping based on the
   * caller's effective CRM permissions. Server callers (cron, internal
   * jobs) can omit this to bypass scoping.
   */
  actorUserId?: string;
  /**
   * Restrict the result set to contacts owned by `actorUserId`. Used by
   * the "My Book" smart view in the web UI.
   */
  ownedByActor?: boolean;
};

type ContactExtraAttributes = {
  displayName?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  whatsappNumber?: string | null;
  preferredChannel?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  industry?: string | null;
  ownerId?: string | null;
  lifecycleStage?: string | null;
  sourceDetail?: string | null;
  segment?: string | null;
  language?: string | null;
  marketingOptIn?: boolean | null;
  doNotContact?: boolean | null;
  notesInternal?: string | null;
  ageGroup?: string | null;
  relationshipType?: string | null;
  pipelineStage?: string | null;
  relationshipHealth?: string | null;
  nextActionAt?: string | null;
  nextActionType?: string | null;
  priority?: string | null;
  favorite?: boolean | null;
  archivedAt?: string | null;
};

/**
 * What a Prisma P2002 `meta.target` may say when a contact write lands on an
 * identity unique: the identity column, the SQL-only partial index over live
 * rows (D-16), or the full index it replaced (a database the migration has not
 * reached yet).
 */
const CONTACT_IDENTITY_UNIQUE: Record<'email' | 'phone', readonly string[]> = {
  email: ['email_normalized', 'contacts_business_id_email_normalized_live_key', 'contacts_business_id_email_normalized_key'],
  phone: ['phone_normalized', 'contacts_business_id_phone_normalized_live_key', 'contacts_business_id_phone_normalized_key'],
};

/**
 * The identity field a Prisma P2002 landed on ('email' or 'phone'), or null
 * when `err` is not a P2002 on a contact identity unique. Exported for the
 * other un-delete of a contact, ContactPrivacyService.cancelForget
 * (FOLLOW3-D8).
 */
export function contactIdentityViolation(err: unknown): 'email' | 'phone' | null {
  const known = err as { code?: unknown; meta?: { target?: unknown } } | null;
  if (!known || typeof known !== 'object' || known.code !== 'P2002') return null;
  const target = known.meta?.target;
  const names = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return names.some((n) => CONTACT_IDENTITY_UNIQUE.email.includes(n)) ? 'email'
    : names.some((n) => CONTACT_IDENTITY_UNIQUE.phone.includes(n)) ? 'phone'
      : null;
}

/**
 * A contact write whose phone a live contact of the tenant already holds under
 * another key (WA-E164-SERVER): a number stored before phones were kept in
 * E.164 ('868-555-0160', key '8685550160') is the same number as the E.164 key
 * the write would store ('+18685550160'), but the identity unique only sees
 * equal keys. Raised inside the write's transaction, before anything is
 * written; rejectContactIdentityTaken answers it as the same bounded 409
 * contact_phone_taken a P2002 on the phone unique gets.
 */
class ContactPhoneHeldError extends Error {
  constructor(readonly holderIds: readonly string[]) {
    super('contact_phone_taken');
    this.name = 'ContactPhoneHeldError';
  }
}

/**
 * The identity key a contact write stores for its phone (Contact.phoneNormalized,
 * normalizePhone's digits-and-'+'), or null when the phone has no digit
 * (WA-E164-SERVER): such a phone ('ask at the front desk') is kept as typed
 * and flagged, and its key was '', which the identity unique read as one
 * number, so a second contact so written answered 409.
 */
function phoneIdentityKey(phone: string | null | undefined): string | null {
  const key = normalizePhone(phone);
  return key && /\d/.test(key) ? key : null;
}

/**
 * PR196-CRM-LIFECYCLE (owner ruling D-81): the statuses a paid invoice moves
 * to CLIENT. Forward-only: every other status (CLIENT, LOST, ...) is left as it is.
 */
const PAID_INVOICE_MOVES_FROM: readonly ContactStatus[] = ['LEAD', 'PROSPECT'];
/** The source of the D-81 status event and follow-up task (as PR #196 named it). */
const LIFECYCLE_SOURCE = 'lifecycle-automation';
/** The D-81 follow-up task: its title (as PR #196 named it) and when it is due (7 days after the move). */
const LIFECYCLE_FOLLOW_UP_TITLE = 'Post-payment customer check-in & follow-up';
const LIFECYCLE_FOLLOW_UP_DUE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * W8-MONEY-SIGNALS (owner ruling D-100; CR-W7CMV-2): the stored Contact
 * riskFlags / opportunities entries derived from the contact's invoices and
 * quotes (revenue rows, D-63), which GET contacts/:contactId already withholds
 * from a member without revenue read (CrmStatsService.contactDetail,
 * REVENUE_RISK_FLAGS / REVENUE_OPPORTUNITIES in crm-stats.service.ts,
 * SEC-W7CMV-3). The list withholds the same entries;
 * test/money-signals.integration.test.ts pins the two reads to agree.
 */
const LIST_REVENUE_RISK_FLAGS: ReadonlySet<string> = new Set(['unpaid_invoices', 'poor_payment_history', 'declining_engagement']);
const LIST_REVENUE_OPPORTUNITIES: ReadonlySet<string> = new Set(['pending_quotes', 'upsell_ready']);

/** A stored riskFlags / opportunities list without the `revenue` entries; any other stored value as it is. */
function withoutRevenueEntries(value: Prisma.JsonValue | null, revenue: ReadonlySet<string>): Prisma.JsonValue | null {
  return Array.isArray(value) ? value.filter((entry) => !(typeof entry === 'string' && revenue.has(entry))) : value;
}

/**
 * W8-MONEY-SIGNALS (owner ruling D-100): a stored Contact row as a member
 * without revenue read is served it. Every stored field worked out from the
 * contact's invoices or quotes is withheld:
 * - CR-W7CMV-2 (GET contacts/:contactId's rule, V55-13h / V55-13i): the stored
 *   amounts (lifetimeValue, averageSpend) and the paid / total invoice score
 *   (paymentReliability) null, riskFlags / opportunities without their revenue
 *   entries;
 * - review repair SEC-W8MS-1: the stored leadScore, which carries the invoice
 *   terms (CrmStatsService.attachContactStats writes +10 a paid and -5 an
 *   unpaid invoice; ContactInsightService.computeContactIntelligenceFields
 *   scores the paid total), is `moneyFreeLeadScore`: the score worked out with
 *   no invoice read (meta.leadScore of the same response), or null where the
 *   response has none, so `leadScore - meta.leadScore` gives nothing back;
 * - review repair SEC-W8MS-4: the other fields computeContactIntelligenceFields
 *   works out from the invoices (nextBestAction 'Send invoice reminder' and
 *   followUpPriority 'URGENT' for an unpaid invoice, conversionProbability its
 *   lead score, referralLikelihood and responsivenessScore with paid-total and
 *   paid-invoice terms) null.
 * Every other stored field is served as it is.
 */
export function withoutStoredMoney<T extends Contact>(contact: T, moneyFreeLeadScore: number | null): T {
  return {
    ...contact,
    lifetimeValue: null,
    averageSpend: null,
    paymentReliability: null,
    riskFlags: withoutRevenueEntries(contact.riskFlags, LIST_REVENUE_RISK_FLAGS),
    opportunities: withoutRevenueEntries(contact.opportunities, LIST_REVENUE_OPPORTUNITIES),
    leadScore: moneyFreeLeadScore,
    conversionProbability: null,
    nextBestAction: null,
    followUpPriority: null,
    referralLikelihood: null,
    responsivenessScore: null,
  };
}

/**
 * W8-MONEY-SIGNALS (owner ruling D-100; CR-W7CMV-2): a GET contacts row as a
 * member without revenue read is served it: the stored fields as
 * withoutStoredMoney serves them, and, with includeStats, meta's invoice
 * figures 0 (null for the oldest unpaid due date) and its lead score without
 * the invoice terms (+10 a paid, -5 an unpaid invoice), as the detail's meta
 * is worked out with no invoice read; the row's leadScore is that score
 * (review repair SEC-W8MS-1), null without includeStats. Deal figures (open
 * deals, top open deal) are CRM pipeline rows the deal routes serve on crm
 * read and stay. Also the rows of GET .../highlights' segments (SEC-W8MS-3,
 * crm.controller.ts).
 */
export function withoutListMoney(contact: ContactWithStats): ContactWithStats {
  const meta: ContactMeta | undefined = contact.meta
    ? {
        ...contact.meta,
        leadScore: contact.meta.leadScore - contact.meta.paidInvoices * 10 + contact.meta.unpaidInvoices * 5,
        outstandingBalance: 0,
        unpaidInvoices: 0,
        paidInvoices: 0,
        oldestUnpaidInvoiceDueAt: null,
        totalRevenue: 0,
        invoiceCount: 0,
      }
    : undefined;
  const served = withoutStoredMoney(contact, meta ? meta.leadScore : null);
  if (meta) served.meta = meta;
  return served;
}

/** What CrmService's audit helpers record for one contact (actor, ip and user agent from `ctx`). */
interface AuditContactInput {
  businessId: string;
  contactId: string;
  action: ContactAuditWriteOptions['action'];
  before?: unknown;
  after?: unknown;
  entityType?: ContactAuditWriteOptions['entityType'];
  entityId?: string | null;
  ctx?: AuditContext | null;
  extraReason?: string | null;
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmStatsService) private readonly stats: CrmStatsService,
    @Inject(CrmListsService) private readonly lists: CrmListsService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(ContactAuditService) private readonly contactAudit: ContactAuditService,
    @Inject(ContactCustomFieldValueService) private readonly customFieldValues: ContactCustomFieldValueService,
  ) {}

  /**
   * Internal helper: write a per-contact audit entry.
   *
   * With `tx` (owner rulings D-25 & D-207: every contact write records a
   * ContactAuditEntry; TOF-CONTACT-AUDIT-AWAIT & FU-CONTACT-AUDIT-RESIDUAL)
   * the entry is written in that transaction, the contact write's own, and the
   * caller awaits it: when the entry cannot be written the error propagates,
   * the transaction rolls back with the contact rows and their ContactEvents,
   * and the request fails. Every contact write in CrmService (and note/task
   * writes inside CrmTimelineService) passes `tx` and writes its audit row
   * before any ContactEvent so a refused entry leaves no Activity feed copy
   * or crm.contact_event.logged announcement behind.
   */
  private auditContact(opts: AuditContactInput, tx?: ContactAuditClient): Promise<void> {
    if (tx) return this.contactAudit.write(this.auditEntry(opts), tx);
    void this.contactAudit.write(this.auditEntry(opts));
    return Promise.resolve();
  }

  private auditEntry(opts: AuditContactInput): ContactAuditWriteOptions {
    return {
      businessId: opts.businessId,
      contactId: opts.contactId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      before: opts.before,
      after: opts.after,
      actor: opts.ctx?.actor ?? { type: 'SYSTEM' },
      ip: opts.ctx?.ip ?? null,
      userAgent: opts.ctx?.userAgent ?? null,
      reason: opts.extraReason ?? opts.ctx?.reason ?? null,
    };
  }

  /**
   * ContactEvent actor fields for an explicit audit actor (a controller
   * passing the authenticated member). Callers that pass no context (system
   * jobs, automations, the KEY adapter) get nothing here and no user is
   * attributed; updateContact and softDeleteContact then record their events
   * as actorType 'SYSTEM', matching the SYSTEM ContactAuditEntry.
   */
  private eventActor(ctx?: AuditContext | null): { actorType?: string; actorId?: string } {
    const actor = ctx?.actor;
    if (!actor) return {};
    return { actorType: actor.type, actorId: actor.id ?? undefined };
  }

  /**
   * The audit context a contact mutation records. A call that names its
   * member only as actorUserId, with no audit actor (POST /contacts/:id/enrich
   * through ContactEnrichmentService), is that member's edit and records them
   * as USER on the ContactEvent and the ContactAuditEntry; only a call that
   * names no actor at all (the KEY adapter, automations) is SYSTEM.
   */
  private memberAuditContext(ctx: AuditContext | undefined, actorUserId?: string): AuditContext | undefined {
    if (ctx?.actor || !actorUserId) return ctx;
    return { ...ctx, actor: { type: 'USER', id: actorUserId } };
  }

  async healthPing(): Promise<void> {
    await this.prisma.client.$queryRaw`SELECT 1`;
  }

  private normalizeTags(tags?: string[] | null) {
    if (!tags) return [];
    return tags.map((tag) => tag.trim()).filter(Boolean);
  }

  private formatContactName(contact: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    if (contact.displayName && contact.displayName.trim()) return contact.displayName.trim();
    const full = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (full) return full;
    if (contact.email) return contact.email;
    if (contact.phone) return contact.phone;
    return 'Unnamed';
  }

  private parseDateOrNull(input?: string | null) {
    if (!input) return null;
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async assertContact(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  /**
   * W8-MONEY-SIGNALS (owner ruling D-100; CR-W7CMV-2): for a member without
   * revenue read (`actorUserId` whose module scopes do not read revenue, the
   * rule resolveTimelineViewer applies to every W7 money view) the revenue
   * sort (sortBy 'revenue', either sortOrder) and the revenue filters
   * (minRevenue, hasUnpaidInvoices) are ignored: the list keeps the order,
   * membership and cursor paging it has without them, so neither tells that
   * member who pays or who owes. Review repair SEC-W8MS-2 (D-100): so is the
   * score sort (sortBy 'score', either sortOrder): it orders by the stored
   * leadScore, which carries the invoice terms (+10 a paid, -5 an unpaid
   * invoice), so its order ranks the same thing. Its rows carry no revenue
   * field (withoutListMoney). The owner, a member with revenue read and a
   * caller that names no actor (KEY, internal jobs) are served as before.
   */
  async listContacts(input: ContactListOptions) {
    let access: CrmAccess | null = null;
    if (input.actorUserId) {
      access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
    }
    const visClause = access && input.actorUserId ? visibilityClause(access, input.actorUserId) : null;
    const readsRevenue = !input.actorUserId
      || (await resolveTimelineViewer(this.prisma, input.businessId, input.actorUserId)).readable.has('revenue');
    if (!readsRevenue) {
      const moneySort = input.sortBy === 'revenue' || input.sortBy === 'score';
      const { contacts, ...page } = await this.listContactRows({
        ...input,
        minRevenue: undefined,
        hasUnpaidInvoices: undefined,
        sortBy: moneySort ? undefined : input.sortBy,
        sortOrder: moneySort ? undefined : input.sortOrder,
      }, visClause);
      return { ...page, contacts: (contacts as ContactWithStats[]).map((contact) => withoutListMoney(contact)) };
    }
    return this.listContactRows(input, visClause);
  }

  /** The list as listContacts reads it; `visClause` is the actor's CRM visibility clause (none: tenant only). */
  private async listContactRows(input: ContactListOptions, visClause: ReturnType<typeof visibilityClause> | null) {
    const ownerFilter = input.ownedByActor && input.actorUserId
      ? input.actorUserId
      : input.ownerId;

    let revenueContactIds: string[] | undefined;
    if (input.minRevenue && input.minRevenue > 0) {
      const highRevContacts = await this.prisma.client.$queryRaw<Array<{ contact_id: string }>>`
        SELECT i.contact_id
        FROM invoices i
        WHERE i.business_id = ${input.businessId}
          AND i.status = 'PAID'
          AND i.deleted_at IS NULL
        GROUP BY i.contact_id
        HAVING SUM(i.total) >= ${input.minRevenue}
      `;
      revenueContactIds = highRevContacts.map((r) => r.contact_id);
      if (revenueContactIds.length === 0) {
        return { contacts: [], total: 0, page: input.skip ? Math.floor(input.skip / (input.take ?? DEFAULT_PAGE_SIZE)) + 1 : 1, pageSize: input.take ?? DEFAULT_PAGE_SIZE, totalPages: 0 };
      }
    }

    // SWP-CRM-SEARCH (BUG-081): the full-text hits (search_vector, filled only where the archived
    // trigger still runs) are added to the field search, never put in its place, and the field
    // search matches a tag by any part of it, in any case (findSearchTags).
    let searchContactIds: string[] | undefined;
    let searchTags: string[] | undefined;
    let phoneCountry: string | null | undefined;
    if (input.search?.trim()) {
      const tsIds = await this.searchContactIdsByTsvector(input.businessId, input.search.trim());
      if (tsIds.length > 0) {
        searchContactIds = tsIds;
      }
      searchTags = await findSearchTags(this.prisma, input.businessId, input.search);
      // D-211 (FU-PHONE-COUNTRY-DUPLICATES): a phone searched is read in the business's country only.
      phoneCountry = await this.businessPhoneCountry(this.prisma.client, input.businessId);
    }

    const where: any = buildContactWhere(input.businessId, {
      status: input.status,
      search: input.search,
      hasUnpaidInvoices: input.hasUnpaidInvoices,
      hasUpcomingBookings: input.hasUpcomingBookings,
      hasOpenDeals: input.hasOpenDeals,
      dealStageIds: input.dealStageIds,
      staleDays: input.staleDays,
      newThisWeek: input.newThisWeek,
      tags: input.tags,
      ownerId: ownerFilter,
      lifecycleStage: input.lifecycleStage,
      companyName: input.companyName,
      industry: input.industry,
      city: input.city,
      country: input.country,
      segment: input.segment,
      doNotContact: input.doNotContact,
      ageGroups: input.ageGroups,
      relationshipTypes: input.relationshipTypes,
      priorities: input.priorities,
      relationshipHealth: input.relationshipHealth,
      pipelineStages: input.pipelineStages,
      favorite: input.favorite,
      includeArchived: input.includeArchived,
    }, { searchTags, phoneCountry });

    if (searchContactIds) {
      where.OR = [...(where.OR ?? []), { id: { in: searchContactIds } }];
    }

    if (revenueContactIds) {
      where.id = { in: revenueContactIds };
    }
    if (input.bestChannels && input.bestChannels.length > 0) {
      where.bestChannel = { in: input.bestChannels };
    }
    if (input.bestTimeNow && Array.isArray(input.bestTimeNowIds)) {
      if (input.bestTimeNowIds.length === 0) {
        where.id = { in: ['__none__'] };
      } else {
        where.id = { in: input.bestTimeNowIds };
      }
    }

    if (visClause) {
      where.AND = [...(where.AND ?? []), visClause];
    }

    const take = Math.min(input.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const sortBy = input.sortBy;
    const needsPostSort = sortBy === 'revenue';

    const sortDir = input.sortOrder;
    const orderBy =
      !sortBy || needsPostSort
        ? [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
        : sortBy === 'score'
          ? [{ leadScore: sortDir ?? ('desc' as const) }, { id: sortDir ?? ('desc' as const) }]
          : sortBy === 'name'
            ? [
                { firstName: sortDir ?? ('asc' as const) },
                { lastName: sortDir ?? ('asc' as const) },
                { id: sortDir ?? ('asc' as const) },
              ]
            : sortBy === 'newest'
              ? [{ createdAt: sortDir ?? ('desc' as const) }, { id: sortDir ?? ('desc' as const) }]
              : sortBy === 'oldest'
                ? [{ createdAt: sortDir ?? ('asc' as const) }, { id: sortDir ?? ('asc' as const) }]
                : sortBy === 'lastInteraction'
                  ? [{ updatedAt: sortDir ?? ('desc' as const) }, { id: sortDir ?? ('desc' as const) }]
                  : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    if (needsPostSort) {
      const skip = input.skip ?? 0;
      const allContacts = await this.prisma.client.contact.findMany({
        where,
        orderBy,
        take: 500,
      });
      if (allContacts.length === 0) return { contacts: [], nextCursor: null, hasMore: false };
      const withStats = await this.stats.attachContactStats(input.businessId, allContacts);
      const dir = input.sortOrder ?? 'desc';
      withStats.sort((a, b) => {
        const aVal = a.meta?.totalRevenue ?? 0;
        const bVal = b.meta?.totalRevenue ?? 0;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      });
      const sliced = withStats.slice(skip, skip + take);
      return { contacts: sliced, nextCursor: null, hasMore: skip + take < withStats.length };
    }

    if (input.cursor) {
      const cursorContact = await this.prisma.client.contact.findUnique({
        where: { id: input.cursor },
        select: { createdAt: true, updatedAt: true, id: true },
      });
      if (cursorContact) {
        const isDescending = !sortBy || sortBy === 'newest' || sortBy === 'lastInteraction';
        const cursorOp = isDescending ? 'lt' : 'gt';
        const cursorField = sortBy === 'lastInteraction' ? 'updatedAt' : 'createdAt';
        const cursorValue = cursorField === 'updatedAt' ? cursorContact.updatedAt : cursorContact.createdAt;
        const cursorWhere = {
          OR: [
            { [cursorField]: { [cursorOp]: cursorValue } },
            { [cursorField]: cursorValue, id: { [cursorOp]: cursorContact.id } },
          ],
        };
        where.AND = [...(where.AND ?? []), cursorWhere];
      }
    }

    const skip = input.cursor ? 0 : (input.skip ?? 0);

    const contacts = await this.prisma.client.contact.findMany({
      where,
      orderBy,
      skip,
      take: take + 1,
    });

    const hasMore = contacts.length > take;
    const sliced = hasMore ? contacts.slice(0, take) : contacts;
    const nextCursor = hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null;

    if (!input.includeStats || sliced.length === 0) {
      return { contacts: sliced, nextCursor, hasMore };
    }
    const withStats = await this.stats.attachContactStats(input.businessId, sliced);
    return { contacts: withStats, nextCursor, hasMore };
  }

  private async searchContactIdsByTsvector(businessId: string, searchValue: string): Promise<string[]> {
    try {
      const rows = await this.prisma.client.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM contacts
        WHERE business_id = ${businessId}
          AND deleted_at IS NULL
          AND search_vector @@ plainto_tsquery('english', ${searchValue})
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${searchValue})) DESC
        LIMIT 1000
      `;
      return rows.map((r) => r.id);
    } catch (err: any) {
      this.logger.warn(`TSVector search failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Contact carries two tenant-scoped uniques over live rows,
   * `(business_id, email_normalized)` and `(business_id, phone_normalized)`,
   * each `WHERE deleted_at IS NULL` (SQL-only partial indexes, D-16, migration
   * 20261101000000_contact_partial_identity_uniques). A write that lands on one
   * of them raises Prisma P2002, which left alone surfaces as an opaque 500.
   * This turns it into a 409 that names the field and, when the actor may see
   * it, the tenant's existing live holder, so a client can link to or merge
   * with that contact. `meta.target` names the violated columns (the driver
   * adapter reads them from the error detail) or, failing that, the index; both
   * spellings are recognized. A violation of anything else, or any other error,
   * is rethrown untouched.
   *
   * The holder is looked up after the failed transaction, through the
   * soft-delete-aware client and, when `actorUserId` is given, under the same
   * M7 visibility clause the list and detail routes apply. The id is a working
   * key (it opens the contact's child routes), so a member who is denied GET
   * detail on the holder (a 'my book' STAFF, or a view-all STAFF against
   * another member's PRIVATE row) is not handed it here either. Whenever no
   * visible live holder exists, because the holder is outside the actor's
   * visibility or because it stopped being live between the failed write and
   * this read, the answer is still 409 with `existingContactId: null` and the
   * same message as the visible case: the response never says which of those
   * it is. A soft-deleted contact no longer holds either value, so it never
   * causes this 409. Callers with no actor (internal jobs) are tenant-scoped
   * only, as before.
   */
  private async rejectContactIdentityTaken(
    err: unknown,
    businessId: string,
    identity: { emailNormalized?: string | null; phoneNormalized?: string | null },
    actorUserId?: string | null,
  ): Promise<never> {
    // WA-E164-SERVER: a live holder of the same number under another key
    // (ContactPhoneHeldError, raised before the write) is the same conflict.
    const held = err instanceof ContactPhoneHeldError ? err : null;
    const field = held ? 'phone' : contactIdentityViolation(err);
    if (!field) throw err;

    const value = field === 'email' ? identity.emailNormalized : identity.phoneNormalized;
    let existing: { id: string } | null = null;
    if (held || value) {
      const where: Prisma.ContactWhereInput = held
        ? { ...contactWhereBase(businessId), id: { in: [...held.holderIds] } }
        : field === 'email'
          ? { ...contactWhereBase(businessId), emailNormalized: value }
          : { ...contactWhereBase(businessId), phoneNormalized: value };
      if (actorUserId) {
        const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
        const visClause = visibilityClause(access, actorUserId);
        if (visClause) where.AND = [visClause];
      }
      existing = await this.prisma.client.contact.findFirst({ where, select: { id: true } });
    }
    const label = field === 'email' ? 'email' : 'phone number';
    throw new ConflictException({
      code: field === 'email' ? 'contact_email_taken' : 'contact_phone_taken',
      message: `A contact with this ${label} already exists in this business`,
      existingContactId: existing?.id ?? null,
    });
  }

  /**
   * Business.country as written, the country a contact's phone typed without
   * its country code is read under (WA-E164-SERVER; unset reads as Trinidad
   * and Tobago, see resolvePhoneCountry). Read through the write's own client
   * (its transaction), so it is decided with the write.
   */
  private async businessPhoneCountry(
    client: Pick<PrismaService['client'], 'business'>,
    businessId: string,
  ): Promise<string | null> {
    const business = await client.business.findUnique({ where: { id: businessId }, select: { country: true } });
    return business?.country ?? null;
  }

  /**
   * The live contacts of the tenant, other than `exceptId`, that hold the
   * number `e164` under ANOTHER key (WA-E164-SERVER): a contact stored before
   * phones were kept in E.164 keeps the key of its spelling (no backfill in
   * v1), and that key is this number when it reads as it under the business's
   * country (review SEC-E164-1/2; livePhoneHolderIds): in Trinidad and Tobago
   * '7123401', '8687123401' and '18687123401' are +18687123401, and '7123401'
   * is not '+5927123401' or any other country's number ending in those
   * digits. A holder under the E.164 key itself is left to the identity unique
   * (the database decides; rejectContactIdentityTaken maps its P2002).
   * Tenant-wide: the caller bounds what it discloses.
   */
  private phoneHoldersUnderAnotherKey(
    client: Pick<PrismaService['client'], 'contact'>,
    businessId: string,
    e164: string,
    country: string | null,
    exceptId?: string,
  ): Promise<string[]> {
    return livePhoneHolderIds(client, businessId, e164, country, { exceptId, otherKeysOnly: true });
  }

  /**
   * The contact's phone flag (WA-E164-SERVER): a phone or WhatsApp number that
   * does not read under the business's country is kept as typed and flagged,
   * never dropped, as the open 'invalid_phone' data-quality issue the scan
   * writes for it (CrmDataQualityService keeps it). Written through the
   * write's own client, so it commits with the contact or not at all. When
   * the numbers written (`touched`) read, an open phone flag on those fields
   * is resolved.
   */
  private async syncPhoneFlag(
    client: Pick<PrismaService['client'], 'contactDataIssue'>,
    businessId: string,
    contact: { id: string; phone: string | null; whatsappNumber: string | null },
    country: string | null,
    touched: readonly PhoneFlagField[],
  ): Promise<void> {
    const flag = phoneFlagFor(contact, country);
    if (flag) {
      const fields = {
        severity: severityFor('invalid_phone'),
        field: flag.field,
        message: flag.message,
        recommendedFix: flag.recommendedFix as Prisma.InputJsonValue,
        status: 'open',
      };
      await client.contactDataIssue.upsert({
        where: { contactId_kind: { contactId: contact.id, kind: 'invalid_phone' } },
        create: { businessId, contactId: contact.id, kind: 'invalid_phone', ...fields },
        update: { ...fields, resolvedAt: null, resolvedBy: null },
      });
      return;
    }
    if (touched.length === 0) return;
    await client.contactDataIssue.updateMany({
      where: { businessId, contactId: contact.id, kind: 'invalid_phone', status: 'open', field: { in: [...touched] } },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'system' },
    });
  }

  /**
   * The member's CRM access, refusing a member who may not create contacts.
   * The same M7 edit scope updateContact enforces: a member whose crm_edit is
   * 'none' passes the module guard on crm:write but may not write contacts.
   * Callers run it before anything is written (createContact, and the import
   * routes before they open an import job, fetch a link or call the vision
   * model).
   */
  async assertCanCreateContacts(businessId: string, actorUserId: string): Promise<CrmAccess> {
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    if (!access.isOwner && !access.isSuperAdmin && access.editScope === 'none') {
      throw new ForbiddenException('You do not have permission to create contacts');
    }
    return access;
  }

  /**
   * The contacts `actorUserId` may edit, as a where clause: visible to them
   * (the list and detail visibility clause) and inside their edit scope ('owned'
   * means owned by or shared with them). Null when they may edit every contact
   * of the tenant (OWNER, SUPER_ADMIN).
   */
  private editableContactClause(access: CrmAccess, actorUserId: string): Prisma.ContactWhereInput | null {
    if (access.isOwner || access.isSuperAdmin) return null;
    const clauses: Prisma.ContactWhereInput[] = [];
    const visClause = visibilityClause(access, actorUserId);
    if (visClause) clauses.push(visClause as Prisma.ContactWhereInput);
    if (access.editScope !== 'any') {
      clauses.push({ OR: [{ ownerId: actorUserId }, { shares: { some: { userId: actorUserId } } }] });
    }
    return clauses.length > 0 ? { AND: clauses } : null;
  }

  /**
   * True when `access` reaches only contacts the member owns or that are shared
   * with them (crm_edit 'owned', or crm_view 'owned'). An ownerless contact is
   * outside editableContactClause for such a member, so a contact they create
   * through an import is made theirs; otherwise they could not open, merge into
   * or re-import a contact they had just created.
   */
  private reachLimitedToOwned(access: CrmAccess): boolean {
    if (access.isOwner || access.isSuperAdmin) return false;
    return access.editScope !== 'any' || !access.viewAll;
  }

  async createContact(input: {
    businessId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: string;
    source?: string | null;
    sourceDetail?: string | null;
    tags?: string[];
    custom?: any;
    customFieldValues?: Record<string, unknown>;
    /**
     * The member creating the contact. When provided, createContact enforces
     * that member's M7 CRM permissions (edit scope, assigning another owner)
     * and bounds the holder named in a duplicate-identity 409 to the member's
     * visibility. POST /crm/businesses/:businessId/contacts passes it, and so
     * do the import routes (through findOrCreateContact's actor argument).
     * Callers that omit it (cron, internal jobs, public intake) get none of
     * these checks and receive the tenant's holder unconditionally.
     */
    actorUserId?: string;
  } & ContactExtraAttributes, _audit?: AuditContext) {
    const start = Date.now();
    if (input.actorUserId) {
      const access = await this.assertCanCreateContacts(input.businessId, input.actorUserId);
      const privileged = access.isOwner || access.isSuperAdmin;
      // Naming someone other than yourself as the owner assigns the contact
      // to them. That needs the permission updateContact and reassignContacts
      // require for an ownership change, and, as in reassignContacts, the
      // owner must be a member of this business. Both are checked before any
      // write.
      if (input.ownerId != null && input.ownerId !== input.actorUserId) {
        if (!privileged && !access.reassign) {
          throw new ForbiddenException('You do not have permission to assign contacts to another member');
        }
        await this.assertNewOwnerIsMember(input.businessId, input.ownerId, 'ownerId');
      }
    }
    const normalizeString = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const firstName = sanitize(normalizeString(input.firstName));
    const lastName = sanitize(normalizeString(input.lastName));
    const email = normalizeString(input.email);
    const typedPhone = normalizeString(input.phone);
    const typedWhatsapp = normalizeString(input.whatsappNumber);
    const emailNormalized = normalizeEmail(email);
    // The phone key the write stores; set in the transaction, read by the 409 mapping.
    let phoneNormalized: string | null = null;
    const tags = this.normalizeTags(input.tags);

    const contact = await this.prisma.client.$transaction(async (tx) => {
      // WA-E164-SERVER: the phone and WhatsApp number are stored in E.164, read
      // under the business's country (contactPhoneForStorage); one that does
      // not read is kept as typed and flagged below.
      const country = typedPhone || typedWhatsapp ? await this.businessPhoneCountry(tx, input.businessId) : null;
      const phone = contactPhoneForStorage(typedPhone, country);
      const whatsapp = contactPhoneForStorage(typedWhatsapp, country);
      phoneNormalized = phoneIdentityKey(phone.value);
      if (phone.e164) {
        // A live contact holding this number under another key (stored before
        // E.164) is the same identity: refused before anything is written.
        const holders = await this.phoneHoldersUnderAnotherKey(tx, input.businessId, phone.e164, country);
        if (holders.length > 0) throw new ContactPhoneHeldError(holders);
      }
      const created = await tx.contact.create({
        data: {
          businessId: input.businessId,
          firstName,
          lastName,
          email,
          emailNormalized,
          phone: phone.value,
          phoneNormalized,
          status: input.status ?? 'LEAD',
          source: input.source ?? 'manual',
          tags,
          custom: input.custom ?? {},
          sourceDetail: normalizeString(input.sourceDetail),
          displayName: normalizeString(input.displayName),
          secondaryEmail: normalizeString(input.secondaryEmail),
          secondaryPhone: normalizeString(input.secondaryPhone),
          whatsappNumber: whatsapp.value,
          preferredChannel: normalizeString(input.preferredChannel),
          addressLine1: normalizeString(input.addressLine1),
          addressLine2: normalizeString(input.addressLine2),
          city: normalizeString(input.city),
          state: normalizeString(input.state),
          postalCode: normalizeString(input.postalCode),
          country: normalizeString(input.country),
          timezone: normalizeString(input.timezone),
          companyName: sanitize(normalizeString(input.companyName)),
          jobTitle: normalizeString(input.jobTitle),
          department: normalizeString(input.department),
          industry: normalizeString(input.industry),
          ownerId: input.ownerId ?? null,
          lifecycleStage: normalizeString(input.lifecycleStage),
          segment: normalizeString(input.segment),
          language: normalizeString(input.language),
          marketingOptIn: input.marketingOptIn ?? null,
          doNotContact: input.doNotContact ?? null,
          notesInternal: sanitize(input.notesInternal ?? null),
          ageGroup: normalizeString(input.ageGroup),
          relationshipType: normalizeString(input.relationshipType),
          pipelineStage: normalizeString(input.pipelineStage),
          relationshipHealth: normalizeString(input.relationshipHealth),
          nextActionAt: this.parseDateOrNull(input.nextActionAt),
          nextActionType: normalizeString(input.nextActionType),
          priority: normalizeString(input.priority),
          favorite: input.favorite ?? false,
          archivedAt: this.parseDateOrNull(input.archivedAt),
        },
      });
      // D-25 (TOF-CONTACT-AUDIT-AWAIT): the 'created' entry commits with the
      // contact or neither does, before its ContactEvent.
      await this.auditContact({
        businessId: input.businessId,
        contactId: created.id,
        action: 'created',
        after: created,
        ctx: _audit,
      }, tx);
      if (phone.unreadable || whatsapp.unreadable) {
        await this.syncPhoneFlag(tx, input.businessId, created, country, []);
      }

      // W3-V1-55c (CR-V155b-1, D-08): the feed's one row for this contact is
      // ActivityEventListener's 'New contact', from the contact.created emit
      // below, so this ContactEvent gets no Activity copy (V1-55b's
      // meta.feedCopy). crm-network.service.ts's referral, which emits no
      // contact.created, keeps its copy as its only row.
      await this.timeline.logEvent(input.businessId, created.id, 'contact.created', {
        firstName,
        lastName,
        email,
        source: input.source ?? 'manual',
      }, { ...this.eventActor(_audit), feedCopy: false }, tx);

      return created;
    }).catch((err: unknown) => this.rejectContactIdentityTaken(err, input.businessId, { emailNormalized, phoneNormalized }, input.actorUserId));
    if (contact) {
      // W3-V1-55c review (SEC-V55C-1, CR-V155c-1; D-90): the emit carries the
      // actor the contact.created ContactEvent above records, so the feed's
      // one row for the contact ('New contact') names who created it, as the
      // dropped Activity copy did.
      const payload: ContactCreatedEmit = {
        contact,
        businessId: input.businessId,
        ...this.eventActor(_audit),
      };
      this.events.emit('contact.created', payload);
    }
    if (contact && input.customFieldValues && Object.keys(input.customFieldValues).length > 0) {
      await this.customFieldValues.setValuesForContact(contact.id, input.customFieldValues).catch((err) => {
        this.logger.warn(`[CRM] Failed to save custom field values for contact ${contact.id}: ${(err as Error).message}`);
      });
    }
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    const duration = Date.now() - start;
    this.logger.log(`[CRM] createContact businessId=${input.businessId} duration=${duration}ms`);
    if (duration > 1000) this.logger.warn(`[CRM] createContact slow businessId=${input.businessId} duration=${duration}ms`);
    return contact;
  }

  /**
   * Find the tenant's contact matching `input` (EntityResolutionService:
   * email, then phone) and merge the input's missing fields into it, or create
   * one.
   *
   * `actorUserId` is the member on whose behalf this runs (the import routes
   * pass the requesting member). With it, the member's M7 permissions apply:
   * a member who may not create contacts is refused 403 before anything is
   * read or written; a match is merged into, or returned, only when the member
   * may edit that contact (editableContactClause); otherwise the input goes to
   * createContact with the same actor, so a colliding email or phone answers
   * the bounded 409 POST /contacts gives (the holder named only when the member
   * can open it) and the existing contact is left untouched. The member is
   * also the audit actor, as on POST /contacts: a created contact's
   * contact.created event and audit entry name them, and a merge that changes
   * a contact writes an 'updated' audit entry naming them. A member whose reach
   * is limited to owned contacts (reachLimitedToOwned) owns the contact an
   * import creates, so re-importing the same row merges into it. Without an
   * actor (bookings, intake, store, KEY and other system-context callers) the
   * lookup is tenant-scoped only, the owner is left unset and no merge audit is
   * written, as before.
   */
  async findOrCreateContact(
    businessId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      companyName?: string | null;
      source?: string | null;
      sourceDetail?: string | null;
      tags?: string[];
      status?: string;
      custom?: any;
    } & Partial<ContactExtraAttributes>,
    actorUserId?: string,
  ) {
    let access: CrmAccess | null = null;
    let editable: Prisma.ContactWhereInput | null = null;
    if (actorUserId) {
      access = await this.assertCanCreateContacts(businessId, actorUserId);
      editable = this.editableContactClause(access, actorUserId);
    }
    // The same actor the controller's userAuditContext records for POST /contacts.
    const audit: AuditContext | undefined = actorUserId ? { actor: { type: 'USER', id: actorUserId } } : undefined;
    const ownerId = input.ownerId ?? (actorUserId && access && this.reachLimitedToOwned(access) ? actorUserId : null);
    const scoped = (where: Prisma.ContactWhereInput): Prisma.ContactWhereInput =>
      (editable ? { ...where, AND: [editable] } : where);
    const normalizeString = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const email = normalizeString(input.email);
    const typedPhone = normalizeString(input.phone);
    // WA-E164-SERVER: the phone as createContact stores it (E.164 under the
    // business's country, or as typed when it does not read), so the match
    // below and the contact created or merged into agree on one key.
    const phoneCountry = typedPhone ? await this.businessPhoneCountry(this.prisma.client, businessId) : null;
    const phoneRead = contactPhoneForStorage(typedPhone, phoneCountry);
    const phone = phoneRead.value;
    const emailNormalized = normalizeEmail(email);
    const phoneNormalized = phoneIdentityKey(phone);
    const tags = this.normalizeTags(input.tags);

    let matched = await this.entityResolution.findContactIdByMatch(businessId, {
      source: input.source ?? null,
      email,
      phone,
    });
    if (!matched && phoneRead.e164) {
      // A contact stored before E.164 under another spelling of this number
      // (no backfill in v1) is this customer, as createContact's identity
      // check reads it: merged into, not duplicated. EntityResolutionService
      // matches on the exact key; its default match order reads the phone
      // (configureMergeRules has no caller).
      const [holderId] = await this.phoneHoldersUnderAnotherKey(this.prisma.client, businessId, phoneRead.e164, phoneCountry);
      if (holderId) matched = { contactId: holderId, matchedOn: 'phone' };
    }

    return this.prisma.client.$transaction(async (tx) => {
      if (matched) {
        const existing = await tx.contact.findFirst({
          where: scoped({ ...contactWhereWithId(businessId, matched.contactId) }),
        });
        if (existing) {
          return this.mergeContactDetails(existing, businessId, {
            firstName: input.firstName,
            lastName: input.lastName,
            email,
            phone,
            phoneUnreadable: phoneRead.unreadable,
            phoneCountry,
            companyName: input.companyName,
            source: input.source,
            sourceDetail: input.sourceDetail,
            tags,
          }, audit);
        }
      }

      if (!email && !phoneNormalized && input.firstName && input.lastName && input.sourceDetail) {
        const recentMatch = await tx.contact.findFirst({
          where: scoped({
            ...contactWhereBase(businessId),
            firstName: input.firstName,
            lastName: input.lastName,
            source: input.source ?? 'manual',
            sourceDetail: input.sourceDetail,
            createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
          }),
          orderBy: { createdAt: 'desc' },
        });
        if (recentMatch) {
          return recentMatch;
        }
      }

      const { firstName: _fn, lastName: _ln, email: _em, phone: _ph, tags: _t, ...extraFields } = input;
      return this.createContact({
        businessId,
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone,
        companyName: input.companyName ?? undefined,
        source: input.source ?? undefined,
        sourceDetail: input.sourceDetail ?? undefined,
        tags,
        ...extraFields,
        ...(ownerId ? { ownerId } : {}),
        ...(actorUserId ? { actorUserId } : {}),
      }, audit);
    }, { isolationLevel: 'Serializable' });
  }

  /**
   * Fill `existing`'s empty fields from `input` (and union the tags). With an
   * audit context (findOrCreateContact on behalf of a member), a merge that
   * changes the contact writes an 'updated' audit entry naming that actor, as
   * updateContact does, in one transaction with the change (D-25,
   * TOF-CONTACT-AUDIT-AWAIT): a refused entry leaves the contact as it was and
   * fails the import. System-context merges write no entry, as before.
   */
  private async mergeContactDetails(
    existing: Contact,
    businessId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      /** As createContact stores it (findOrCreateContact reads it under the business's country). */
      phone?: string | null;
      /** The phone did not read under `phoneCountry`: it is kept as typed and flagged (WA-E164-SERVER). */
      phoneUnreadable?: boolean;
      phoneCountry?: string | null;
      companyName?: string | null;
      source?: string | null;
      sourceDetail?: string | null;
      tags?: string[];
    },
    audit?: AuditContext,
  ) {
    const data: Record<string, any> = {};
    if (input.firstName && !existing.firstName) data.firstName = sanitize(input.firstName);
    if (input.lastName && !existing.lastName) data.lastName = sanitize(input.lastName);
    if (input.email && !existing.email) {
      data.email = input.email;
      data.emailNormalized = normalizeEmail(input.email);
    }
    if (input.phone && !existing.phone) {
      data.phone = input.phone;
      data.phoneNormalized = phoneIdentityKey(input.phone);
    }
    if (input.companyName && !existing.companyName) data.companyName = sanitize(input.companyName);
    if (input.source && !existing.source) data.source = input.source;
    if (input.sourceDetail && !existing.sourceDetail) data.sourceDetail = input.sourceDetail;
    if (input.tags && input.tags.length > 0) {
      const merged = new Set([...(existing.tags ?? []), ...input.tags]);
      data.tags = Array.from(merged);
    }
    if (Object.keys(data).length === 0) {
      return existing;
    }
    // A phone filled in that does not read is flagged with the change (WA-E164-SERVER).
    const flagsPhone = data.phone !== undefined && input.phoneUnreadable === true;
    if (!audit) {
      if (!flagsPhone) {
        return this.prisma.client.contact.update({
          where: { id: existing.id },
          data,
        });
      }
      return this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.contact.update({ where: { id: existing.id }, data });
        await this.syncPhoneFlag(tx, businessId, updated, input.phoneCountry ?? null, []);
        return updated;
      });
    }
    // Its own transaction, as the update had its own statement before: the
    // caller's serializable lookup transaction is left as it was.
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.contact.update({
        where: { id: existing.id },
        data,
      });
      if (flagsPhone) await this.syncPhoneFlag(tx, businessId, updated, input.phoneCountry ?? null, []);
      await this.auditContact({
        businessId,
        contactId: existing.id,
        action: 'updated',
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        ctx: audit,
        extraReason: `merged ${input.source ?? 'unknown'} input into existing contact`,
      }, tx);
      return updated;
    });
  }

  /**
   * The one contact-level edit check: updateContact and the enrichment route
   * (ContactEnrichmentService) both call it before they read or write the
   * contact, so the two cannot drift apart (R0-13c review CR-1).
   *
   * Returns the row the caller may reach: the tenant predicate and, with an
   * actor, the same M7 visibility clause GET detail applies (CrmStatsService
   * assertContact). A contact outside it answers exactly like an unknown id
   * (404), so a write path neither discloses nor edits a PRIVATE row the
   * caller cannot open. For a member who is not the owner or a super admin,
   * edit scope 'none' is refused 403 first, then a contact they cannot see is
   * 404, then a visible one outside edit scope 'owned' (owned by or shared
   * with them) is 403. Without an actor (KEY adapter, automation) the tenant
   * predicate alone applies and nothing is checked.
   */
  async assertCanEditContact(
    businessId: string,
    contactId: string,
    actorUserId?: string,
  ): Promise<{ access: CrmAccess | null; reachableWhere: Prisma.ContactWhereInput }> {
    const reachableWhere: Prisma.ContactWhereInput = { ...contactWhereWithId(businessId, contactId) };
    if (!actorUserId) return { access: null, reachableWhere };
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const visClause = visibilityClause(access, actorUserId);
    if (visClause) reachableWhere.AND = [visClause];
    if (!access.isOwner && !access.isSuperAdmin) {
      if (access.editScope === 'none') {
        throw new ForbiddenException('You do not have permission to edit contacts');
      }
      const visible = await this.prisma.client.contact.findFirst({ where: reachableWhere, select: { id: true } });
      if (!visible) {
        throw new NotFoundException('Contact not found');
      }
      if (access.editScope === 'owned') {
        const owned = await this.prisma.client.contact.findFirst({
          where: {
            ...reachableWhere,
            OR: [
              { ownerId: actorUserId },
              { shares: { some: { userId: actorUserId } } },
            ],
          },
          select: { id: true },
        });
        if (!owned) {
          throw new ForbiddenException('You can only edit contacts you own');
        }
      }
    }
    return { access, reachableWhere };
  }

  async updateContact(input: {
    businessId: string;
    contactId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: string;
    source?: string | null;
    sourceDetail?: string | null;
    tags?: string[];
    custom?: any;
    customFieldValues?: Record<string, unknown>;
    actorUserId?: string;
  } & ContactExtraAttributes, _audit?: AuditContext) {
    const start = Date.now();
    const audit = this.memberAuditContext(_audit, input.actorUserId);
    // The row the caller may reach, also read under the lock below.
    const { access, reachableWhere } = await this.assertCanEditContact(input.businessId, input.contactId, input.actorUserId);
    const trimOptional = (value?: string | null) => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const email = trimOptional(input.email);
    // WA-E164-SERVER: the phone and WhatsApp number as typed; what is stored
    // (E.164 under the business's country) is decided in the transaction.
    const typedPhone = trimOptional(input.phone);
    const typedWhatsapp = trimOptional(input.whatsappNumber);
    const emailNormalized = email !== undefined ? normalizeEmail(email) : undefined;
    // The phone key the write stores; set in the transaction, read by the 409 mapping.
    let phoneNormalized: string | null | undefined;
    const tags = input.tags !== undefined ? this.normalizeTags(input.tags) : undefined;

    const sanitizeOptional = (value?: string | null) => {
      if (value === undefined) return undefined;
      return sanitize(value);
    };

    // When `relationshipHealth` is explicitly set via the API, we treat that as
    // a manual override so the daily auto-warn scheduler will preserve it. The
    // override metadata is stamped onto `Contact.custom`.
    let mergedCustom: any = input.custom ?? undefined;
    if (input.relationshipHealth !== undefined && input.relationshipHealth !== null) {
      const baseCustom =
        (input.custom as Record<string, unknown>) ??
        ((await this.prisma.client.contact.findFirst({
          where: reachableWhere,
          select: { custom: true },
        }))?.custom as Record<string, unknown>) ??
        {};
      mergedCustom = {
        ...baseCustom,
        relationshipHealthOverride: {
          manual: true,
          value: input.relationshipHealth,
          at: new Date().toISOString(),
        },
      };
    }

    const data: Prisma.ContactUpdateInput = {
      firstName: sanitizeOptional(trimOptional(input.firstName)),
      lastName: sanitizeOptional(trimOptional(input.lastName)),
      email,
      emailNormalized,
      status: input.status ?? undefined,
      source: input.source ?? undefined,
      tags,
      custom: mergedCustom,
      sourceDetail: trimOptional(input.sourceDetail),
      displayName: trimOptional(input.displayName),
      secondaryEmail: trimOptional(input.secondaryEmail),
      secondaryPhone: trimOptional(input.secondaryPhone),
      preferredChannel: trimOptional(input.preferredChannel),
      addressLine1: trimOptional(input.addressLine1),
      addressLine2: trimOptional(input.addressLine2),
      city: trimOptional(input.city),
      state: trimOptional(input.state),
      postalCode: trimOptional(input.postalCode),
      country: trimOptional(input.country),
      timezone: trimOptional(input.timezone),
      companyName: sanitizeOptional(trimOptional(input.companyName)),
      jobTitle: trimOptional(input.jobTitle),
      department: trimOptional(input.department),
      industry: trimOptional(input.industry),
      ownerId: input.ownerId ?? undefined,
      lifecycleStage: trimOptional(input.lifecycleStage),
      segment: trimOptional(input.segment),
      language: trimOptional(input.language),
      marketingOptIn: input.marketingOptIn ?? undefined,
      doNotContact: input.doNotContact ?? undefined,
      notesInternal: input.notesInternal !== undefined ? sanitize(input.notesInternal ?? null) ?? undefined : undefined,
      ageGroup: trimOptional(input.ageGroup),
      relationshipType: trimOptional(input.relationshipType),
      pipelineStage: trimOptional(input.pipelineStage),
      relationshipHealth: trimOptional(input.relationshipHealth),
      nextActionAt: input.nextActionAt !== undefined ? this.parseDateOrNull(input.nextActionAt) : undefined,
      nextActionType: trimOptional(input.nextActionType),
      priority: trimOptional(input.priority),
      favorite: input.favorite ?? undefined,
      archivedAt: input.archivedAt !== undefined ? this.parseDateOrNull(input.archivedAt) : undefined,
    };

    const { existing, updated } = await this.prisma.client.$transaction(async (tx) => {
      // Lock the row before reading it, so the checks below are decided on the
      // row this transaction writes: a reassignment committing concurrently is
      // waited for and seen, not overwritten by a request that resends the
      // owner it read before (which would skip the reassign permission and the
      // membership check below).
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${input.contactId} AND business_id = ${input.businessId} FOR UPDATE`;
      const existingContact = await tx.contact.findFirst({
        where: reachableWhere,
      });
      if (!existingContact) {
        throw new NotFoundException('Contact not found');
      }
      // Changing the owner through PATCH is a reassignment and needs the same
      // permission as reassignContacts, and, as there, the new owner must be a
      // member of this business ('' and unknown ids included), for every
      // caller. Resending the current owner is not a reassignment. Checked
      // against the locked row read in this transaction, before any write.
      // (A null ownerId is written as "unchanged", see `data` above.)
      const changesOwner = input.ownerId != null && input.ownerId !== existingContact.ownerId;
      if (changesOwner && access && !access.isOwner && !access.isSuperAdmin && !access.reassign) {
        throw new ForbiddenException('You do not have permission to reassign contacts');
      }
      if (changesOwner) {
        await this.assertNewOwnerIsMember(input.businessId, input.ownerId as string, 'ownerId', tx);
      }

      // WA-E164-SERVER: a phone or WhatsApp number written is stored in E.164
      // under the business's country (one that does not read is kept as typed
      // and flagged below); a new phone a live contact holds under another key
      // (stored before E.164) is refused as contact_phone_taken before the write.
      const phonesTouched: PhoneFlagField[] = [];
      let phoneCountry: string | null = null;
      if (typedPhone !== undefined || typedWhatsapp !== undefined) {
        phoneCountry = await this.businessPhoneCountry(tx, input.businessId);
      }
      if (typedPhone !== undefined) {
        const phone = contactPhoneForStorage(typedPhone, phoneCountry);
        const nextKey = phoneIdentityKey(phone.value);
        let writesPhone = true;
        if (phone.e164 && nextKey !== existingContact.phoneNormalized) {
          if (phoneKeyReadsAs(existingContact.phoneNormalized, phone.e164, phoneCountry)) {
            // Review COR-E164-3: the contact's own number (its stored key,
            // read under the business's country), re-sent as the full edit
            // form does with every edit, would be re-keyed to E.164. When
            // another live contact holds that number too (two keys the base
            // allowed), re-keying would collide and refuse every edit of the
            // contact: the number did not change, so the phone and its key
            // stay as stored. With no other holder it is stored in E.164.
            const others = await livePhoneHolderIds(tx, input.businessId, phone.e164, phoneCountry, { exceptId: input.contactId });
            if (others.length > 0) writesPhone = false;
          } else {
            const holders = await this.phoneHoldersUnderAnotherKey(tx, input.businessId, phone.e164, phoneCountry, input.contactId);
            if (holders.length > 0) throw new ContactPhoneHeldError(holders);
          }
        }
        if (writesPhone) {
          phoneNormalized = nextKey;
          data.phone = phone.value;
          data.phoneNormalized = nextKey;
          phonesTouched.push('phone');
        }
      }
      if (typedWhatsapp !== undefined) {
        data.whatsappNumber = contactPhoneForStorage(typedWhatsapp, phoneCountry).value;
        phonesTouched.push('whatsappNumber');
      }

      const updatedContact = await tx.contact.update({
        where: { id: input.contactId },
        data,
      });
      if (phonesTouched.length > 0) {
        await this.syncPhoneFlag(tx, input.businessId, updatedContact, phoneCountry, phonesTouched);
      }
      // D-25 (TOF-CONTACT-AUDIT-AWAIT): the entry commits with the change or
      // neither does. An ownership change is a "reassigned" entry; everything
      // else is a generic "updated" entry with the diff.
      const reassigned = existingContact.ownerId !== updatedContact.ownerId;
      await this.auditContact({
        businessId: input.businessId,
        contactId: updatedContact.id,
        action: reassigned ? 'reassigned' : 'updated',
        before: existingContact as unknown as Record<string, unknown>,
        after: updatedContact as unknown as Record<string, unknown>,
        ctx: audit,
        extraReason: reassigned
          ? `owner ${existingContact.ownerId ?? 'none'} → ${updatedContact.ownerId ?? 'none'}`
          : undefined,
      }, tx);

      const updatedFields = Object.keys(data).filter(
        (key) => data[key as keyof Prisma.ContactUpdateInput] !== undefined,
      );
      if (updatedFields.length > 0) {
        await this.timeline.logEvent(
          input.businessId,
          input.contactId,
          'contact.updated',
          { updatedFields },
          { actorType: 'SYSTEM', source: 'crm', ...this.eventActor(audit) },
          tx,
        );
      }

      if (input.status && existingContact.status !== input.status) {
        await this.timeline.logEvent(
          input.businessId,
          input.contactId,
          'status.changed',
          { from: existingContact.status, to: input.status },
          { actorType: 'SYSTEM', source: 'crm', ...this.eventActor(audit) },
          tx,
        );
      }

      return { existing: existingContact, updated: updatedContact };
    }).catch((err: unknown) => this.rejectContactIdentityTaken(err, input.businessId, { emailNormalized, phoneNormalized }, input.actorUserId));

    const payload: ContactUpdatedPayload = {
      contact: updated,
      businessId: input.businessId,
      fromStatus: existing?.status,
      toStatus: updated.status,
    };
    this.events.emit('contact.updated', payload);

    if (input.customFieldValues && Object.keys(input.customFieldValues).length > 0) {
      await this.customFieldValues.setValuesForContact(input.contactId, input.customFieldValues).catch((err) => {
        this.logger.warn(`[CRM] Failed to save custom field values for contact ${input.contactId}: ${(err as Error).message}`);
      });
    }
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    const duration = Date.now() - start;
    this.logger.log(`[CRM] updateContact businessId=${input.businessId} contactId=${input.contactId} duration=${duration}ms`);
    if (duration > 1000) this.logger.warn(`[CRM] updateContact slow businessId=${input.businessId} duration=${duration}ms`);
    return updated;
  }

  /**
   * PR196-CRM-LIFECYCLE (owner ruling D-81): the one status move the system
   * makes on its own. A paid invoice of the contact moves a LEAD or PROSPECT to
   * CLIENT; any other status is left as it is, lifecycleStage is never written,
   * and nothing moves it back (a refund's reopen is not a counter-move).
   *
   * The write is a compare-and-set on the status read here (PR #196 MC-14): a
   * concurrent or replayed delivery, a human edit or a merge that changed the
   * status first leaves this call with no row, and it writes nothing else. Only
   * the call that moved the contact writes, in the same transaction as the move:
   *   - a status.changed ContactEvent naming the invoice, by SYSTEM;
   *   - one follow-up task (the canonical OPEN status) with its task.created
   *     ContactEvent by SYSTEM (review SEC-L81-1: CrmTimelineService.addTask
   *     records every task as a USER's), assigned to the contact's owner only
   *     while the owner is a member of `businessId` (review SEC-L81-2: a removed
   *     member keeps Contact.ownerId, so their follow-up is left unassigned). It
   *     is gated by the compare-and-set, never by the contact's other tasks
   *     (MC-21, MC-22), and cannot be lost after the move commits.
   * Neither ContactEvent is mirrored into the Activity feed (as
   * CrmTimelineService.logEvent would): the move's one feed row is
   * ActivityEventListener's on contact.updated (D-08, MC-15). After the commit:
   * a ContactAuditEntry by SYSTEM naming the invoice (D-25, MC-16), the
   * follow-up's task_added audit (MC-23), contact.updated with
   * fromStatus/toStatus (automations, webhooks, sync; MC-16) and
   * contact_task.created (the calendar projection).
   * Tenant-bound: the contact, its owner's membership and the task are read and
   * written only in `businessId`. Returns the moved contact, or null when
   * nothing moved.
   */
  async advanceToClientOnInvoicePaid(input: {
    businessId: string;
    contactId: string;
    invoiceId: string;
    invoiceNumber?: string | null;
  }): Promise<Contact | null> {
    const { businessId, contactId, invoiceId } = input;
    const invoiceNumber = input.invoiceNumber ?? null;
    const where = contactWhereWithId(businessId, contactId);
    const current = await this.prisma.client.contact.findFirst({ where, select: { status: true } });
    if (!current || !(PAID_INVOICE_MOVES_FROM as readonly string[]).includes(current.status)) return null;
    const from = current.status;
    const to: ContactStatus = 'CLIENT';
    const trigger = { trigger: 'invoice.paid', invoiceId, invoiceNumber };
    const dueDate = new Date(Date.now() + LIFECYCLE_FOLLOW_UP_DUE_MS);

    const result = await this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.contact.updateManyAndReturn({ where: { ...where, status: from }, data: { status: to } });
      if (rows.length !== 1) return null;
      const contact = rows[0];
      await tx.contactEvent.create({
        data: {
          businessId,
          contactId,
          type: CONTACT_EVENT.STATUS_CHANGED,
          data: { from, to, ...trigger },
          actorType: 'SYSTEM',
          source: LIFECYCLE_SOURCE,
        },
      });

      // SEC-L81-2: the owner gets the follow-up only while they are a member of this business.
      const ownerMembership = contact.ownerId
        ? await tx.membership.findUnique({
            where: { userId_businessId: { userId: contact.ownerId, businessId } },
            select: { id: true },
          })
        : null;
      const assigneeId = ownerMembership ? contact.ownerId : null;
      const task = await tx.contactTask.create({
        data: {
          businessId,
          contactId,
          title: LIFECYCLE_FOLLOW_UP_TITLE,
          dueDate,
          priority: TASK_PRIORITY.NORMAL,
          status: TASK_STATUS.OPEN,
          assigneeId,
          source: LIFECYCLE_SOURCE,
        },
      });
      if (assigneeId) {
        await tx.taskAssignment.create({
          data: {
            taskType: 'ContactTask',
            taskId: task.id,
            assignableType: 'User',
            assignableId: assigneeId,
            assignedBy: 'system',
            reason: 'task_created',
          },
        });
      }
      // SEC-L81-1: the task's timeline entry names SYSTEM, as its audit does.
      const taskEvent = await tx.contactEvent.create({
        data: {
          businessId,
          contactId,
          type: CONTACT_EVENT.TASK_CREATED,
          data: { taskId: task.id, title: task.title, dueDate: dueDate.toISOString(), priority: task.priority, assigneeId, ...trigger },
          actorType: 'SYSTEM',
          source: LIFECYCLE_SOURCE,
        },
      });
      // D-25 (FU-CONTACT-AUDIT-RESIDUAL): both audit entries commit with the
      // status move and follow-up task inside the same transaction, or roll
      // back completely.
      const actor: ContactAuditActor = { type: 'SYSTEM', label: LIFECYCLE_SOURCE };
      await this.contactAudit.write(
        {
          businessId,
          contactId,
          action: 'updated',
          entityType: 'invoice',
          entityId: invoiceId,
          before: { status: from },
          after: { status: to },
          actor,
          reason: `invoice.paid ${invoiceNumber ?? invoiceId}: ${from} -> ${to} (D-81)`,
        },
        tx,
      );
      await this.contactAudit.write(
        {
          businessId,
          contactId,
          action: 'task_added',
          entityType: 'task',
          entityId: task.id,
          after: { title: task.title, dueDate: dueDate.toISOString(), priority: task.priority, assigneeId: task.assigneeId },
          actor,
          reason: `invoice.paid ${invoiceNumber ?? invoiceId}: follow-up (D-81)`,
        },
        tx,
      );
      return { contact, task, taskEvent, ownerNotMember: Boolean(contact.ownerId) && !ownerMembership };
    });
    if (!result) return null;
    const { contact: moved, task, taskEvent } = result;
    if (result.ownerNotMember) {
      this.logger.warn(`[CRM] D-81 follow-up for contact=${contactId} left unassigned: its owner is not a member of business=${businessId}`);
    }

    const payload: ContactUpdatedPayload = { contact: moved, businessId, fromStatus: from, toStatus: to };
    this.events.emit('contact.updated', payload);
    this.events.emit('contact_task.created', { task, businessId });
    // As CrmTimelineService.logEvent announces each contact event it writes (insight, best channel, attribution).
    this.events.emit('crm.contact_event.logged', {
      businessId,
      contactId,
      type: taskEvent.type,
      eventId: taskEvent.id,
      source: LIFECYCLE_SOURCE,
      actorType: 'SYSTEM',
      data: taskEvent.data,
    });
    this.stats.invalidateCache(businessId);
    this.flow.invalidateCache(businessId);
    return moved;
  }

  async softDeleteContact(input: { businessId: string; contactId: string; actorUserId?: string }, _audit?: AuditContext) {
    const audit = this.memberAuditContext(_audit, input.actorUserId);
    // As in updateContact: with an actor, the row the caller may reach is the
    // tenant predicate plus the visibility clause GET detail applies, so a
    // contact the caller cannot see answers 404 exactly like an unknown id,
    // before any record-dependent refusal. Without an actor (KEY adapter,
    // compensation) the tenant predicate alone applies, as before.
    const reachableWhere: Prisma.ContactWhereInput = { ...contactWhereWithId(input.businessId, input.contactId) };
    let access: CrmAccess | null = null;
    if (input.actorUserId) {
      access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      const visClause = visibilityClause(access, input.actorUserId);
      if (visClause) reachableWhere.AND = [visClause];
    }
    const contact = await this.prisma.client.contact.findFirst({ where: reachableWhere });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    if (input.actorUserId && access && !access.isOwner && !access.isSuperAdmin) {
      if (access.deleteScope === 'none') {
        throw new ForbiddenException('You do not have permission to delete contacts');
      }
      if (access.deleteScope === 'owned' && contact.ownerId !== input.actorUserId) {
        throw new ForbiddenException('You can only delete contacts you own');
      }
      if (!access.viewAll && contact.ownerId !== input.actorUserId) {
        // Defensive: a 'my book' member deletes only contacts they own.
        throw new NotFoundException('Contact not found');
      }
    }
    const deleted = await this.prisma.client.$transaction(async (tx) => {
      // Claim the live, still reachable row: the UPDATE re-checks
      // `deletedAt IS NULL` (and the visibility clause) under the row lock, so
      // of two concurrent deletes only one matches and the other is refused
      // like any already-deleted contact, writing no event.
      const claimed = await tx.contact.update({
        where: reachableWhere as Prisma.ContactWhereUniqueInput,
        data: { deletedAt: new Date() },
      }).catch((err: unknown) => {
        if ((err as { code?: unknown } | null)?.code === 'P2025') {
          throw new NotFoundException('Contact not found');
        }
        throw err;
      });
      // D-25 (TOF-CONTACT-AUDIT-AWAIT): the entry commits with the deletion
      // or neither does.
      await this.auditContact({
        businessId: input.businessId,
        contactId: input.contactId,
        action: 'deleted',
        before: { deletedAt: contact.deletedAt },
        after: { deletedAt: claimed.deletedAt },
        ctx: audit,
      }, tx);
      await this.timeline.logEvent(
        input.businessId,
        input.contactId,
        'contact.deleted',
        { name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() },
        { actorType: 'SYSTEM', source: 'crm', ...this.eventActor(audit) },
        tx,
      );
      return claimed;
    });
    const deletedPayload: ContactDeletedPayload = {
      contact: deleted,
      businessId: input.businessId,
    };
    this.events.emit('contact.deleted', deletedPayload);
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return deleted;
  }

  /**
   * Undo an AI-created contact. If the contact has no related activity,
   * soft-delete it; otherwise revert it to LEAD for human review.
   */
  async undoContact(
    input: { businessId: string; contactId: string; actorId?: string | null },
    _audit?: AuditContext,
  ) {
    const audit = this.memberAuditContext(_audit, input.actorId ?? undefined);
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: input.contactId },
      include: {
        _count: { select: { bookings: true, invoices: true, tasks: true } },
      },
    });
    if (!contact || contact.businessId !== input.businessId) {
      throw new NotFoundException('Contact not found');
    }

    const totalActivity =
      (contact._count.bookings ?? 0) +
      (contact._count.invoices ?? 0) +
      (contact._count.tasks ?? 0);

    if (totalActivity === 0) {
      const deleted = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.contact.update({
          where: { id: input.contactId },
          data: { deletedAt: new Date() },
        });
        await this.auditContact(
          {
            businessId: input.businessId,
            contactId: input.contactId,
            action: 'deleted',
            before: { deletedAt: contact.deletedAt },
            after: { deletedAt: row.deletedAt },
            ctx: audit,
            extraReason: 'undo contact',
          },
          tx,
        );
        return row;
      });
      this.events.emit('contact.deleted', { contact: deleted, businessId: input.businessId });
      this.stats.invalidateCache(input.businessId);
      this.flow.invalidateCache(input.businessId);
      return { id: input.contactId, status: 'deleted' };
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.contact.update({
        where: { id: input.contactId },
        data: { status: 'LEAD' },
      });
      await this.auditContact(
        {
          businessId: input.businessId,
          contactId: input.contactId,
          action: 'updated',
          before: { status: contact.status },
          after: { status: row.status },
          ctx: audit,
          extraReason: 'undo contact',
        },
        tx,
      );
      return row;
    });
    this.events.emit('contact.updated', { contact: updated, businessId: input.businessId });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { id: input.contactId, status: 'reverted_to_lead' };
  }

  async bulkUpdateContacts(input: {
    businessId: string;
    contactIds: string[];
    status?: string;
    addTags?: string[];
    relationshipType?: string | null;
    priority?: string | null;
    favorite?: boolean;
    archived?: boolean;
    actorUserId?: string;
  }, _audit?: AuditContext) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }
    // A member named only as actorUserId (CrmController passes no audit
    // context) is recorded as USER on the audit entries and the events, as
    // updateContact records them; a call with no actor (the KEY
    // flow-orchestrator tool) stays a SYSTEM audit entry with no user on the
    // event, as bulkDeleteContacts records it.
    const audit = this.memberAuditContext(_audit, input.actorUserId);
    // Every caller, the owner and a call with no actor included, writes only
    // live contacts of this tenant: an id from another tenant is skipped, and
    // counted, exactly like a missing one, and gets no event or audit entry.
    // A member who is not the owner or a super admin is further limited to the
    // contacts they can see (the GET visibility clause) and may edit (their
    // edit scope), so a hidden id is skipped the same way and the answer never
    // reveals it.
    const scopedWhere: Prisma.ContactWhereInput = { ...contactWhereBase(input.businessId) };
    let limitedMember = false;
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin) {
        if (access.editScope === 'none') {
          throw new ForbiddenException('You do not have permission to edit contacts');
        }
        const editableClause = this.editableContactClause(access, input.actorUserId);
        if (editableClause) scopedWhere.AND = [editableClause];
        limitedMember = true;
      }
    }
    const contacts = await this.prisma.client.contact.findMany({
      where: { ...scopedWhere, id: { in: input.contactIds } },
      select: { id: true, tags: true },
    });
    if (limitedMember && contacts.length === 0) {
      throw new ForbiddenException('You cannot edit any of the selected contacts');
    }
    input = { ...input, contactIds: contacts.map((c) => c.id) };
    const auditAfter = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.addTags ? { addedTags: input.addTags } : {}),
      ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
      ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
    };
    // Audited in the write's own transaction, only for the rows it wrote and
    // before any of their events (D-25, TOF-CONTACT-AUDIT-AWAIT): a refused
    // entry rolls the whole call back and fails it.
    const auditWritten = async (writtenIds: string[], tx: ContactAuditClient) => {
      for (const cid of writtenIds) {
        await this.auditContact({
          businessId: input.businessId,
          contactId: cid,
          action: 'bulk_updated',
          after: auditAfter,
          ctx: audit,
        }, tx);
      }
    };
    const eventMeta = this.eventActor(audit);
    const data: Record<string, unknown> = {};
    if (input.status) data.status = input.status;
    if (input.relationshipType !== undefined) {
      data.relationshipType = input.relationshipType ?? null;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority ?? null;
    }
    if (typeof input.favorite === 'boolean') {
      data.favorite = input.favorite;
    }
    if (typeof input.archived === 'boolean') {
      data.archivedAt = input.archived ? new Date() : null;
    }
    if (input.addTags && input.addTags.length > 0) {
      const results = await this.prisma.client.$transaction(async (tx) => {
        const updated = [];
        for (const c of contacts) {
          const merged = Array.from(new Set([...(c.tags ?? []), ...(input.addTags ?? [])]));
          const u = await tx.contact.update({ where: { id: c.id }, data: { ...data, tags: merged } });
          updated.push(u);
        }
        await auditWritten(updated.map((u) => u.id), tx);
        for (const c of contacts) {
          await this.timeline.logEvent(input.businessId, c.id, 'bulk.updated', {
            ...(input.status ? { status: input.status } : {}),
            ...(input.addTags ? { addedTags: input.addTags } : {}),
            ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
            ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
          }, eventMeta, tx);
        }
        return updated;
      });
      this.stats.invalidateCache(input.businessId);
      this.flow.invalidateCache(input.businessId);
      return { updated: results.length };
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No update fields provided');
    }
    const writtenIds = await this.prisma.client.$transaction(async (tx) => {
      // The same scope again at the write, which also says exactly which rows
      // this call wrote: only those get an audit entry and an event, so a row
      // deleted meanwhile leaves no trace either.
      const rows = await tx.contact.updateManyAndReturn({
        where: { ...scopedWhere, id: { in: input.contactIds } },
        data,
        select: { id: true },
      });
      await auditWritten(rows.map((row) => row.id), tx);
      for (const { id: cid } of rows) {
        await this.timeline.logEvent(input.businessId, cid, 'bulk.updated', {
          ...(input.status ? { status: input.status } : {}),
          ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
          ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
        }, eventMeta, tx);
      }
      return rows.map((row) => row.id);
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { updated: writtenIds.length };
  }

  async bulkDeleteContacts(input: { businessId: string; contactIds: string[]; actorUserId?: string }, _audit?: AuditContext) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }
    // With an actor, only rows the caller can see (the GET visibility clause)
    // are deleted: a hidden id is skipped exactly like a missing one.
    let visClause: Prisma.ContactWhereInput | null = null;
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      visClause = visibilityClause(access, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin) {
        if (access.deleteScope === 'none') {
          throw new ForbiddenException('You do not have permission to delete contacts');
        }
        if (access.deleteScope === 'owned') {
          const owned = await this.prisma.client.contact.findMany({
            where: {
              ...contactWhereBase(input.businessId),
              id: { in: input.contactIds },
              ownerId: input.actorUserId,
            },
            select: { id: true },
          });
          input = { ...input, contactIds: owned.map((c) => c.id) };
          if (input.contactIds.length === 0) {
            throw new ForbiddenException('You can only delete contacts you own');
          }
        }
      }
    }
    // Delete first, scoped to this tenant's live rows the caller can see, and
    // learn exactly which rows this call deleted. Only those get an audit
    // entry and an event: an id from another tenant, a missing or hidden id, or
    // one already deleted (including by a concurrent request) gets no trace.
    // Each entry is written in the deletion's own transaction (D-25,
    // TOF-CONTACT-AUDIT-AWAIT): a refused entry rolls every deletion back and
    // fails the call. The events follow the commit, best-effort as before.
    const deletedIds = await this.prisma.client.$transaction(async (tx) => {
      const deletedRows = await tx.contact.updateManyAndReturn({
        where: { id: { in: input.contactIds }, ...contactWhereBase(input.businessId), ...(visClause ? { AND: [visClause] } : {}) },
        data: { deletedAt: new Date() },
        select: { id: true },
      });
      for (const { id: cid } of deletedRows) {
        await this.auditContact({
          businessId: input.businessId,
          contactId: cid,
          action: 'bulk_deleted',
          ctx: _audit,
        }, tx);
      }
      return deletedRows.map((row) => row.id);
    });
    const eventMeta = this.eventActor(_audit);
    const eventOps = deletedIds.map((cid) =>
      this.timeline.logEvent(input.businessId, cid, 'contact.deleted', { bulk: true }, eventMeta),
    );
    await Promise.allSettled(eventOps);
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { deleted: deletedIds.length };
  }

  /**
   * Refuses (400) a new contact owner who is not a member of `businessId`:
   * the one membership check reassignContacts, updateContact (a PATCH that
   * changes ownerId) and createContact (naming another owner) apply. An
   * unknown id or '' has no membership either. The message names `field`,
   * the body field the caller sent ('newOwnerId' for bulk reassign, 'ownerId'
   * for PATCH and POST). `client` is the transaction when the caller holds one.
   */
  private async assertNewOwnerIsMember(
    businessId: string,
    userId: string,
    field: 'ownerId' | 'newOwnerId',
    client: Pick<PrismaService['client'], 'membership'> = this.prisma.client,
  ): Promise<void> {
    const membership = await client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException(`${field} must belong to a member of this business`);
    }
  }

  /**
   * Reassign ownership of one or more contacts. Verifies that
   *   - the actor has crm_reassign permission (or is OWNER/SUPER_ADMIN);
   *   - the new owner is a member of the same business; and
   *   - every target contact lives in the business and is currently
   *     visible to the actor under their effective scope.
   * Writes a 'reassigned' ContactAuditEntry per contact it moved, from the old
   * owner to the new, in the ownership change's own transaction (D-25,
   * TOF-CONTACT-AUDIT-AWAIT; review repair SEC-CAA-2: an ownership change
   * widens what a 'my book' member can open, and it had no audit row): a
   * refused entry leaves every owner as it was and fails the call. The entry
   * names the member (actorUserId) as USER, as updateContact's 'reassigned'
   * entry does; a call with no actor is SYSTEM. A `contact.reassigned`
   * timeline event per contact follows the commit, as before.
   *
   * The owner each entry and event names as `from`, and whether the member may
   * still see the contact, are decided on the rows the transaction locks
   * (review repair SEC-TCAC-1), as updateContact decides on its locked row: the
   * read before the transaction only refuses early when nothing is eligible. A
   * concurrent ownership change that commits first is waited for and seen, so
   * the trail records the transition this reassign really made, and a contact
   * that has left a member's book in the meantime is not moved (when none is
   * left, 403 and nothing is written).
   */
  async reassignContacts(input: {
    businessId: string;
    contactIds: string[];
    newOwnerId: string;
    actorUserId?: string;
  }) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }

    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin && !access.reassign) {
        throw new ForbiddenException('You do not have permission to reassign contacts');
      }
    }

    await this.assertNewOwnerIsMember(input.businessId, input.newOwnerId, 'newOwnerId');

    const eligibleWhere: any = {
      ...contactWhereBase(input.businessId),
      id: { in: input.contactIds },
    };
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      const visClause = visibilityClause(access, input.actorUserId);
      if (visClause) {
        eligibleWhere.AND = [visClause];
      }
    }

    const eligible = await this.prisma.client.contact.findMany({
      where: eligibleWhere,
      select: { id: true, ownerId: true },
    });
    if (eligible.length === 0) {
      throw new ForbiddenException('No eligible contacts to reassign');
    }

    const eligibleIds = eligible.map((c) => c.id);
    const audit = this.memberAuditContext(undefined, input.actorUserId);
    const moved = await this.prisma.client.$transaction(async (tx) => {
      // Lock the rows first (in id order, so overlapping reassigns queue rather
      // than deadlock), then read them again under the lock with the same
      // tenant, liveness and visibility predicate: the owner each one moves
      // from, and whether the member may still see it, are those of the row
      // this transaction writes (SEC-TCAC-1).
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ANY(${eligibleIds}) AND business_id = ${input.businessId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`;
      const locked = await tx.contact.findMany({
        where: { ...eligibleWhere, id: { in: eligibleIds } },
        select: { id: true, ownerId: true },
      });
      if (locked.length === 0) {
        throw new ForbiddenException('No eligible contacts to reassign');
      }
      await tx.contact.updateMany({
        where: { id: { in: locked.map((c) => c.id) }, ...contactWhereBase(input.businessId) },
        data: { ownerId: input.newOwnerId },
      });
      for (const { id: cid, ownerId } of locked) {
        const from = ownerId ?? null;
        await this.auditContact({
          businessId: input.businessId,
          contactId: cid,
          action: 'reassigned',
          before: { ownerId: from },
          after: { ownerId: input.newOwnerId },
          ctx: audit,
          extraReason: `owner ${from ?? 'none'} → ${input.newOwnerId}`,
        }, tx);
      }
      return locked;
    });

    await Promise.allSettled(
      moved.map((c) =>
        this.timeline.logEvent(input.businessId, c.id, 'contact.reassigned', {
          fromOwnerId: c.ownerId ?? null,
          toOwnerId: input.newOwnerId,
          actorUserId: input.actorUserId ?? null,
        }),
      ),
    );

    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);

    return { reassigned: moved.length, newOwnerId: input.newOwnerId };
  }

  async mergeContacts(input: { businessId: string; primaryId: string; duplicateId: string; fieldOverrides?: Record<string, unknown>; actorId?: string; actorType?: string }, _audit?: AuditContext) {
    if (input.primaryId === input.duplicateId) {
      throw new BadRequestException('Cannot merge a contact into itself');
    }

    // The merge's audit entries name the member who merged (the route passes
    // actorId with actorType USER and no audit context), as its ContactEvent
    // does; KEY and other callers without a member stay SYSTEM.
    const audit = this.memberAuditContext(_audit, input.actorType === 'USER' ? input.actorId : undefined);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Populated inside the transaction from the locked rows; read by the 409 mapping.
    let emailNormalized: string | null | undefined;
    let phoneNormalized: string | null | undefined;

    const result = await this.prisma.client.$transaction(async (tx) => {
      emailNormalized = undefined;
      phoneNormalized = undefined;

      // Lock both contact rows in deterministic id order so concurrent merges or
      // deletes serialize cleanly, then read the live locked rows inside the tx
      // so tags, fields, snapshots and audit diffs never race with stale pre-lock reads.
      const [lockA, lockB] = input.primaryId < input.duplicateId
        ? [input.primaryId, input.duplicateId]
        : [input.duplicateId, input.primaryId];
      const locked = await tx.$queryRaw<Array<{ id: string; deleted_at: Date | null }>>`
        SELECT id, deleted_at FROM contacts
        WHERE business_id = ${input.businessId} AND id IN (${lockA}, ${lockB})
        ORDER BY id FOR UPDATE
      `;
      if (locked.length !== 2 || locked.some((r) => r.deleted_at !== null)) {
        throw new NotFoundException('Contact not found');
      }

      const lockedContacts = await tx.contact.findMany({
        where: { businessId: input.businessId, id: { in: [input.primaryId, input.duplicateId] }, deletedAt: null },
      });
      const primary = lockedContacts.find((c) => c.id === input.primaryId);
      const duplicate = lockedContacts.find((c) => c.id === input.duplicateId);
      if (!primary || !duplicate) {
        throw new NotFoundException('Contact not found');
      }

      const mergedTags = Array.from(new Set([...(primary.tags ?? []), ...(duplicate.tags ?? [])]));
      const mergedLeadScore = Math.max(primary.leadScore ?? 0, duplicate.leadScore ?? 0);

      const fillableFields: Array<keyof typeof primary> = [
        'firstName', 'lastName', 'email', 'phone',
        'displayName', 'secondaryEmail', 'secondaryPhone', 'whatsappNumber',
        'preferredChannel', 'addressLine1', 'addressLine2', 'city', 'state',
        'postalCode', 'country', 'timezone', 'companyName', 'jobTitle',
        'department', 'industry', 'sourceDetail', 'segment', 'language', 'notesInternal',
      ];

      const contactUpdate: Record<string, unknown> = {
        tags: mergedTags,
        leadScore: mergedLeadScore,
      };
      const resolvedChoices: Record<string, { from: 'primary' | 'duplicate' | 'override'; value: unknown }> = {};

      for (const field of fillableFields) {
        const primaryVal = primary[field];
        const duplicateVal = duplicate[field];
        if ((primaryVal === null || primaryVal === undefined || primaryVal === '') && duplicateVal) {
          contactUpdate[field] = duplicateVal;
          resolvedChoices[String(field)] = { from: 'duplicate', value: duplicateVal };
        } else if (primaryVal !== null && primaryVal !== undefined && primaryVal !== '') {
          resolvedChoices[String(field)] = { from: 'primary', value: primaryVal };
        }
      }

      const primaryCustom = (typeof primary.custom === 'object' && primary.custom) ? primary.custom as Record<string, unknown> : {};
      const duplicateCustom = (typeof duplicate.custom === 'object' && duplicate.custom) ? duplicate.custom as Record<string, unknown> : {};
      // Default behaviour: union with primary winning on key collisions.
      const mergedCustom: Record<string, unknown> = { ...duplicateCustom, ...primaryCustom };

      let emailOverridden = false;
      if (input.fieldOverrides) {
        const fillableSet = new Set<string>(fillableFields as readonly string[]);
        for (const [key, value] of Object.entries(input.fieldOverrides)) {
          if (value === undefined) continue;
          if (key === 'custom' && value && typeof value === 'object') {
            // Full replace of merged custom map (UI sends the resolved map).
            for (const k of Object.keys(mergedCustom)) delete mergedCustom[k];
            Object.assign(mergedCustom, value as Record<string, unknown>);
            resolvedChoices['custom'] = { from: 'override', value };
            continue;
          }
          if (key.startsWith('custom.')) {
            // Per-key override: e.g. "custom.preferredColor" → resolve a single key.
            const customKey = key.slice('custom.'.length);
            if (customKey) {
              mergedCustom[customKey] = value;
              resolvedChoices[`custom.${customKey}`] = { from: 'override', value };
            }
            continue;
          }
          if (fillableSet.has(key) || key === 'tags' || key === 'status') {
            if ((key === 'email' || key === 'phone' || key === 'whatsappNumber') && value !== null && typeof value !== 'string') {
              throw new BadRequestException(`Invalid ${key} override`);
            }
            contactUpdate[key] = value;
            resolvedChoices[key] = { from: 'override', value };
            if (key === 'email') emailOverridden = true;
          }
        }
      }
      contactUpdate.custom = mergedCustom;

      // Keep emailNormalized in sync whenever email is copied from duplicate or
      // overridden (FU-MERGE-CONTACTS-UNIQUE, D-221); tracked for 409 mapping.
      if ('email' in contactUpdate) {
        const rawEmail = typeof contactUpdate.email === 'string' ? contactUpdate.email.trim() : null;
        const trimmedEmail = rawEmail ? rawEmail : null;
        if (emailOverridden && trimmedEmail && !syntaxValidEmail(trimmedEmail)) {
          throw new BadRequestException('Invalid email address');
        }
        emailNormalized = normalizeEmail(trimmedEmail);
        contactUpdate.email = trimmedEmail;
        contactUpdate.emailNormalized = emailNormalized;
      } else if (primary.email && !primary.emailNormalized) {
        const trimmedPrimary = primary.email.trim();
        if (trimmedPrimary) {
          emailNormalized = normalizeEmail(trimmedPrimary);
          contactUpdate.emailNormalized = emailNormalized;
        }
      }

      // Deterministic repointing: capture explicit row IDs first, then update by IN list.
      // Storing IDs (not just counts) allows revertMerge to restore precisely the rows
      // that were moved, avoiding any time-based heuristics.
      const repointedRows: Record<string, { ids: string[]; count: number }> = {};
      const repointByIds = async <T extends { id: string }>(
        label: string,
        findFn: () => Promise<T[]>,
        updateFn: (ids: string[]) => Promise<{ count: number }>,
      ) => {
        const rows = await findFn();
        const ids = rows.map((r) => r.id);
        if (ids.length > 0) {
          const r = await updateFn(ids);
          repointedRows[label] = { ids, count: r.count ?? ids.length };
        } else {
          repointedRows[label] = { ids: [], count: 0 };
        }
      };

      // 1. Repoint relations that are not unique-per-contact. Errors propagate -> rollback.
      await repointByIds('events',
        () => tx.contactEvent.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactEvent.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('notes',
        () => tx.contactNote.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactNote.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('tasks',
        () => tx.contactTask.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactTask.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('enrollments',
        () => tx.crmSequenceEnrollment.findMany({ where: { contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.crmSequenceEnrollment.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('quotes',
        () => tx.quote.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.quote.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('invoices',
        () => tx.invoice.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.invoice.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('bookings',
        () => tx.booking.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.booking.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('media',
        () => tx.contactMedia.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactMedia.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('playbooks',
        () => tx.contactPlaybook.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactPlaybook.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('recurringInvoices',
        () => tx.recurringInvoice.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.recurringInvoice.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('externalMappings',
        () => tx.contactExternalMapping.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactExternalMapping.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('momentumRecommendations',
        () => tx.momentumRecommendation.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.momentumRecommendation.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('whatsappContacts',
        () => tx.whatsAppContact.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.whatsAppContact.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('importRecords',
        () => tx.contactImportContact.findMany({ where: { contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactImportContact.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('journeyTouchpoints',
        () => tx.journeyTouchpoint.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.journeyTouchpoint.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));

      // Custom field values: unique on (contactId, definitionId). Repoint only when
      // primary doesn't already have a value for that definition.
      const dupCustomValues = await tx.contactCustomFieldValue.findMany({
        where: { contactId: input.duplicateId },
      });
      const primaryCustomValues = await tx.contactCustomFieldValue.findMany({
        where: { contactId: input.primaryId },
      });
      const primaryDefinitionIds = new Set(primaryCustomValues.map((v) => v.definitionId));
      const repointableCustomValues = dupCustomValues.filter((v) => !primaryDefinitionIds.has(v.definitionId));
      for (const v of repointableCustomValues) {
        await tx.contactCustomFieldValue.update({
          where: { id: v.id },
          data: { contactId: input.primaryId },
        });
      }
      await tx.contactCustomFieldValue.deleteMany({
        where: { contactId: input.duplicateId },
      });
      repointedRows['customFieldValues'] = {
        ids: repointableCustomValues.map((v) => v.id),
        count: repointableCustomValues.length,
      };

      // 2. Capture full snapshots of unique-per-contact rows owned by the duplicate so
      //    they can be re-created on revert. They are deleted (not repointed) here to
      //    respect the (businessId, contactId) unique constraint on the primary side.
      const momentumDup = await tx.contactMomentum.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      if (momentumDup.length) await tx.contactMomentum.deleteMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      const momentumSnapDup = await tx.contactMomentumSnapshot.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      if (momentumSnapDup.length) await tx.contactMomentumSnapshot.deleteMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      const customerJourneyDup = await tx.customerJourney.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      if (customerJourneyDup.length) await tx.customerJourney.deleteMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });

      repointedRows['contactMomentum_deleted'] = { ids: momentumDup.map((r) => r.id), count: momentumDup.length };
      repointedRows['contactMomentumSnapshot_deleted'] = { ids: momentumSnapDup.map((r) => r.id), count: momentumSnapDup.length };
      repointedRows['customerJourney_deleted'] = { ids: customerJourneyDup.map((r) => r.id), count: customerJourneyDup.length };

      // 3. List membership: unique on (listId, contactId). Capture decision per row so
      //    revert can recreate exactly the original rows.
      // Capture FULL row (not just id+listId) so revertMerge can recreate
      // dropped list memberships verbatim — contactListMember requires
      // contactId, addedAt, etc.
      const dupMembers = await tx.contactListMember.findMany({ where: { contactId: input.duplicateId } });
      const listMembersMoved: string[] = [];
      const listMembersDropped: string[] = [];
      for (const m of dupMembers) {
        const existing = await tx.contactListMember.findFirst({ where: { listId: m.listId, contactId: input.primaryId }, select: { id: true } });
        if (existing) {
          await tx.contactListMember.delete({ where: { id: m.id } });
          listMembersDropped.push(m.id);
        } else {
          await tx.contactListMember.update({ where: { id: m.id }, data: { contactId: input.primaryId } });
          listMembersMoved.push(m.id);
        }
      }
      repointedRows['listMembers'] = { ids: listMembersMoved, count: listMembersMoved.length };
      repointedRows['listMembers_dropped'] = { ids: listMembersDropped, count: listMembersDropped.length };

      // Snapshot deleted unique rows + dropped list memberships into the same JSON
      // payload so revert can restore them verbatim.
      const droppedMemberRows = dupMembers.filter((m) => listMembersDropped.includes(m.id));
      const repointedRowsForStorage: Record<string, unknown> = { ...repointedRows };
      repointedRowsForStorage._deletedSnapshots = {
        contactMomentum: momentumDup,
        contactMomentumSnapshot: momentumSnapDup,
        customerJourney: customerJourneyDup,
        contactListMembers: droppedMemberRows,
      };

      // Persist the merge operation first so we can stamp its id onto both
      // contact rows. Storing `lastMergeId` on both sides (and `mergedIntoId`
      // on the duplicate) makes the undo path deterministic without time
      // heuristics, satisfying the task's "merge_id on both rows" contract.
      const mergeOp = await tx.mergeOperation.create({
        data: {
          businessId: input.businessId,
          primaryId: input.primaryId,
          duplicateId: input.duplicateId,
          duplicateSnapshot: JSON.parse(JSON.stringify(duplicate)) as Prisma.InputJsonValue,
          fieldOverrides: (input.fieldOverrides ?? {}) as Prisma.InputJsonValue,
          resolvedFields: JSON.parse(JSON.stringify(resolvedChoices)) as Prisma.InputJsonValue,
          repointedCounts: repointedRowsForStorage as Prisma.InputJsonValue,
          actorId: input.actorId,
          actorType: input.actorType ?? 'SYSTEM',
          expiresAt,
        },
      });

      // FU-MERGE-CONTACTS-UNIQUE (D-221): soft-delete the duplicate BEFORE
      // updating the primary, inside the same transaction, so the live-row
      // partial unique indexes (contacts_business_id_email_normalized_live_key
      // and contacts_business_id_phone_normalized_live_key, D-16) release the
      // duplicate's email and phone before the primary takes them. Any failure
      // below (e.g. a third live contact holding the target email or phone)
      // rolls the entire transaction back atomically.
      await tx.contact.update({
        where: { id: input.duplicateId },
        data: { deletedAt: new Date(), lastMergeId: mergeOp.id, mergedIntoId: input.primaryId },
      });

      const primaryUpdate: Record<string, unknown> = { ...contactUpdate };
      const phonesTouched: PhoneFlagField[] = [];
      let phoneCountry: string | null = null;
      if ('phone' in primaryUpdate || 'whatsappNumber' in primaryUpdate) {
        phoneCountry = await this.businessPhoneCountry(tx, input.businessId);
      }
      if ('phone' in primaryUpdate) {
        const rawPhone = typeof primaryUpdate.phone === 'string' ? primaryUpdate.phone.trim() : null;
        const phone = contactPhoneForStorage(rawPhone, phoneCountry);
        const nextKey = phoneIdentityKey(phone.value);
        let writesPhone = true;
        if (phone.e164 && nextKey !== primary.phoneNormalized) {
          if (phoneKeyReadsAs(primary.phoneNormalized, phone.e164, phoneCountry)) {
            // Review COR-E164-3 parity with updateContact: if the override re-sends
            // primary's own number under a legacy spelling while a third live contact
            // holds that E.164 key, keep primary's phone as stored instead of 409.
            const others = await livePhoneHolderIds(tx, input.businessId, phone.e164, phoneCountry, { exceptId: input.primaryId });
            if (others.length > 0) writesPhone = false;
          } else {
            const holders = await this.phoneHoldersUnderAnotherKey(tx, input.businessId, phone.e164, phoneCountry, input.primaryId);
            if (holders.length > 0) throw new ContactPhoneHeldError(holders);
          }
        }
        if (writesPhone) {
          phoneNormalized = nextKey;
          primaryUpdate.phone = phone.value;
          primaryUpdate.phoneNormalized = nextKey;
          phonesTouched.push('phone');
        } else {
          delete primaryUpdate.phone;
        }
      } else if (primary.phone && !primary.phoneNormalized) {
        phoneNormalized = phoneIdentityKey(primary.phone);
        primaryUpdate.phoneNormalized = phoneNormalized;
      }
      if ('whatsappNumber' in primaryUpdate) {
        const rawWa = typeof primaryUpdate.whatsappNumber === 'string' ? primaryUpdate.whatsappNumber.trim() : null;
        primaryUpdate.whatsappNumber = contactPhoneForStorage(rawWa, phoneCountry).value;
        phonesTouched.push('whatsappNumber');
      }

      const mergedContact = await tx.contact.update({
        where: { id: input.primaryId },
        data: { ...(primaryUpdate as Prisma.ContactUpdateInput), lastMergeId: mergeOp.id },
      });
      if (phonesTouched.length > 0) {
        await this.syncPhoneFlag(tx, input.businessId, mergedContact, phoneCountry, phonesTouched);
      }

      // D-25 (TOF-CONTACT-AUDIT-AWAIT; review repair SEC-CAA-2): both entries
      // commit with the merge or nothing does, and they come before the
      // merge's ContactEvent, so a refused entry leaves no feed copy either.
      await this.auditContact({
        businessId: input.businessId,
        contactId: input.primaryId,
        action: 'merged',
        before: primary as unknown as Record<string, unknown>,
        after: mergedContact as unknown as Record<string, unknown>,
        ctx: audit,
        extraReason: `merged duplicate ${input.duplicateId} into primary`,
      }, tx);
      await this.auditContact({
        businessId: input.businessId,
        contactId: input.duplicateId,
        action: 'merged',
        before: duplicate as unknown as Record<string, unknown>,
        after: { mergedInto: input.primaryId },
        ctx: audit,
        extraReason: `duplicate merged into ${input.primaryId}`,
      }, tx);

      const repointedCountsForEvent = Object.fromEntries(
        Object.entries(repointedRows).map(([k, v]) => [k, v.count]),
      );
      await this.timeline.logEvent(
        input.businessId,
        input.primaryId,
        CONTACT_EVENT.CONTACT_MERGED,
        {
          mergeId: mergeOp.id,
          primaryId: input.primaryId,
          duplicateId: input.duplicateId,
          mergedFields: Object.keys(primaryUpdate),
          resolvedChoices,
          repointedCounts: repointedCountsForEvent,
          revertableUntil: expiresAt.toISOString(),
        },
        { actorType: input.actorType ?? 'SYSTEM', actorId: input.actorId, source: 'crm' },
        tx,
      );
      return { mergedContact, mergeId: mergeOp.id, repointedCounts: repointedCountsForEvent };
    }).catch((err: unknown) => this.rejectContactIdentityTaken(
      err,
      input.businessId,
      { emailNormalized, phoneNormalized },
      input.actorType === 'USER' ? input.actorId : null,
    ));
    const merged = result.mergedContact;
    if (merged) {
      const payload: ContactMergedPayload = {
        contact: merged,
        businessId: input.businessId,
        duplicateId: input.duplicateId,
      };
      this.events.emit('contact.merged', payload);
    }
    this.stats.invalidateCache(input.businessId);
    return { ...merged, mergeId: result.mergeId, revertableUntil: expiresAt.toISOString() };
  }

  async revertMerge(
    input: { businessId: string; mergeId: string; actorId?: string; actorType?: string },
    _audit?: AuditContext,
  ) {
    const audit = this.memberAuditContext(_audit, input.actorType === 'USER' ? input.actorId : undefined);
    const op = await this.prisma.client.mergeOperation.findFirst({
      where: { id: input.mergeId, businessId: input.businessId },
    });
    if (!op) throw new NotFoundException('Merge operation not found');
    if (op.revertedAt) throw new BadRequestException('Merge has already been reverted');
    if (op.expiresAt && new Date(op.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Undo window has expired');
    }

    const snapshot = (op.duplicateSnapshot ?? null) as Record<string, unknown> | null;
    if (!snapshot || typeof snapshot.id !== 'string') {
      throw new BadRequestException('Merge snapshot is missing');
    }

    const stored = (op.repointedCounts ?? {}) as Record<string, { ids?: string[]; count?: number } | unknown>;
    const deletedSnapshots = (stored._deletedSnapshots ?? {}) as {
      contactMomentum?: Array<Record<string, unknown>>;
      contactMomentumSnapshot?: Array<Record<string, unknown>>;
      customerJourney?: Array<Record<string, unknown>>;
      contactListMembers?: Array<Record<string, unknown>>;
    };
    const idsFor = (label: string): string[] => {
      const v = stored[label];
      if (v && typeof v === 'object' && Array.isArray((v as { ids?: unknown }).ids)) {
        return ((v as { ids: unknown[] }).ids).filter((x): x is string => typeof x === 'string');
      }
      return [];
    };

    // Best-effort revert: each child restoration step runs inside a savepoint so
    // any recoverable conflict is captured into a structured conflict report
    // instead of aborting the outer transaction. The duplicate restore and both
    // ContactAuditEntry rows commit or roll back atomically (D-25).
    type RevertConflict = { table: string; id?: string; ids?: string[]; reason: string };
    const reasonOf = (e: unknown): string =>
      e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error';

    // 1. Prepare duplicate contact restoration (undelete + restore snapshot fields).
    const restoreData: Record<string, unknown> = {};
    const restorableFields = [
      'firstName','lastName','email','emailNormalized','phone','phoneNormalized',
      'displayName','secondaryEmail','secondaryPhone','whatsappNumber','status',
      'preferredChannel','addressLine1','addressLine2','city','state','postalCode',
      'country','timezone','companyName','jobTitle','department','industry',
      'source','sourceDetail','segment','language','marketingOptIn','doNotContact',
      'notesInternal','ageGroup','tags','leadScore','custom',
    ];
    for (const f of restorableFields) {
      if (snapshot[f] !== undefined) restoreData[f] = snapshot[f];
    }
    restoreData.deletedAt = null;
    restoreData.mergedIntoId = null;

    let restoreErr: unknown = null;
    const { revertedAt, conflictReport } = await this.prisma.client.$transaction(async (tx) => {
      const conflicts: RevertConflict[] = [];
      const restored: Record<string, number> = {};
      const skipped: Record<string, number> = {};

      try {
        await tx.contact.update({ where: { id: op.duplicateId }, data: restoreData as Prisma.ContactUpdateInput });
        restored.contact = 1;
      } catch (err: unknown) {
        restoreErr = err;
        throw err;
      }

      // D-25 (FU-CONTACT-AUDIT-RESIDUAL): both audit entries commit with the
      // revert or nothing does, before any child repoints or ContactEvent.
      await this.auditContact(
        {
          businessId: input.businessId,
          contactId: op.duplicateId,
          action: 'restored',
          entityType: 'contact',
          entityId: op.id,
          before: { mergedIntoId: op.primaryId, deletedAt: op.createdAt.toISOString() },
          after: { mergedIntoId: null, deletedAt: null },
          ctx: audit,
          extraReason: `reverted merge ${op.id} from primary ${op.primaryId}`,
        },
        tx,
      );
      await this.auditContact(
        {
          businessId: input.businessId,
          contactId: op.primaryId,
          action: 'restored',
          entityType: 'contact',
          entityId: op.id,
          before: { mergedDuplicateId: op.duplicateId },
          after: { mergedDuplicateId: null },
          ctx: audit,
          extraReason: `reverted merge ${op.id} restoring duplicate ${op.duplicateId}`,
        },
        tx,
      );

      let spSeq = 0;
      const runIsolated = async <T,>(fn: () => Promise<T>): Promise<T> => {
        const sp = `sp_revert_${++spSeq}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
        try {
          const val = await fn();
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
          return val;
        } catch (err) {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
          throw err;
        }
      };

      // 2. Move every previously-repointed row back to the duplicate, table by
      //    table. Each updateMany runs inside its own savepoint so a row-level
      //    conflict in one table does not abort the others.
      const movePairs: Array<[string, (ids: string[]) => Promise<{ count: number }>]> = [
        ['events', (ids) => tx.contactEvent.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['notes', (ids) => tx.contactNote.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['tasks', (ids) => tx.contactTask.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['enrollments', (ids) => tx.crmSequenceEnrollment.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['quotes', (ids) => tx.quote.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['invoices', (ids) => tx.invoice.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['bookings', (ids) => tx.booking.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['media', (ids) => tx.contactMedia.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['playbooks', (ids) => tx.contactPlaybook.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['recurringInvoices', (ids) => tx.recurringInvoice.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['externalMappings', (ids) => tx.contactExternalMapping.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['momentumRecommendations', (ids) => tx.momentumRecommendation.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['whatsappContacts', (ids) => tx.whatsAppContact.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['importRecords', (ids) => tx.contactImportContact.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['journeyTouchpoints', (ids) => tx.journeyTouchpoint.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
        ['listMembers', (ids) => tx.contactListMember.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ];
      for (const [label, fn] of movePairs) {
        const ids = idsFor(label);
        if (ids.length === 0) continue;
        try {
          const r = await runIsolated(() => fn(ids));
          restored[label] = r.count;
          if (r.count < ids.length) {
            // Some rows were edited/deleted post-merge.
            skipped[label] = (skipped[label] ?? 0) + (ids.length - r.count);
            conflicts.push({ table: label, ids, reason: `${ids.length - r.count} row(s) missing or already moved` });
          }
        } catch (err: any) {
          skipped[label] = (skipped[label] ?? 0) + ids.length;
          conflicts.push({ table: label, ids, reason: reasonOf(err) });
        }
      }

      // 3. Restore unique-per-contact rows deleted during merge, one at a time
      //    so a single row conflict (e.g. someone re-created a CustomerJourney
      //    after the merge) doesn't block the rest of the undo.
      const recreate = async <T,>(
        table: string,
        rows: Array<Record<string, unknown>>,
        create: (row: Record<string, unknown>) => Promise<T>,
      ) => {
        for (const row of rows) {
          try {
            await runIsolated(() => create(row));
            restored[table] = (restored[table] ?? 0) + 1;
          } catch (err: any) {
            skipped[table] = (skipped[table] ?? 0) + 1;
            conflicts.push({ table, id: typeof row.id === 'string' ? row.id : undefined, reason: reasonOf(err) });
          }
        }
      };
      await recreate('contactMomentum', deletedSnapshots.contactMomentum ?? [],
        (row) => tx.contactMomentum.create({ data: row as Prisma.ContactMomentumUncheckedCreateInput }));
      await recreate('contactMomentumSnapshot', deletedSnapshots.contactMomentumSnapshot ?? [],
        (row) => tx.contactMomentumSnapshot.create({ data: row as Prisma.ContactMomentumSnapshotUncheckedCreateInput }));
      await recreate('customerJourney', deletedSnapshots.customerJourney ?? [],
        (row) => tx.customerJourney.create({ data: row as Prisma.CustomerJourneyUncheckedCreateInput }));
      await recreate('contactListMembers', deletedSnapshots.contactListMembers ?? [],
        (row) => tx.contactListMember.create({ data: row as Prisma.ContactListMemberUncheckedCreateInput }));

      const report = { restored, skipped, conflicts };
      const now = new Date();
      try {
        await runIsolated(() =>
          tx.mergeOperation.update({
            where: { id: op.id },
            data: {
              revertedAt: now,
              revertedActorId: input.actorId,
              // Persist the conflict report inside repointedCounts so it's
              // queryable later without changing the schema.
              repointedCounts: { ...(stored as Record<string, unknown>), _revertReport: report } as Prisma.InputJsonValue,
            },
          }),
        );
      } catch (err: any) {
        this.logger.warn(`Don't fail the user-visible revert because we couldn't persist the: ${err instanceof Error ? err.message : err}`);
      }

      const iso = now.toISOString();
      await this.timeline.logEvent(
        input.businessId,
        op.primaryId,
        CONTACT_EVENT.CONTACT_MERGE_REVERTED,
        {
          mergeId: op.id,
          primaryId: op.primaryId,
          duplicateId: op.duplicateId,
          revertedAt: iso,
          restored: report.restored,
          skipped: report.skipped,
          conflicts: report.conflicts,
        },
        { actorType: input.actorType ?? 'SYSTEM', actorId: input.actorId, source: 'crm' },
        tx,
      );
      return { revertedAt: iso, conflictReport: report };
    }).catch(async (err: unknown) => {
      if (restoreErr && err === restoreErr) {
        // Failing to restore the surviving "duplicate" row is the only true blocker:
        // the rest of the revert depends on this row existing as a contact.
        // Since D-16 the merged duplicate releases its email and phone during the
        // undo window, so another live contact may hold one of them by now; the
        // un-delete is then a P2002 on an identity unique and answers like every
        // other identity conflict: 409 contact_email_taken / contact_phone_taken
        // naming the live holder the actor may see. Nothing has been restored or
        // stamped yet, so the merge stays revertable once the conflict is
        // resolved. Any other failure is a 400 that carries no database text
        // (Prisma's message names server paths, source lines and columns); the
        // cause goes to the log.
        if (contactIdentityViolation(err)) {
          await this.rejectContactIdentityTaken(
            err,
            input.businessId,
            {
              emailNormalized: typeof restoreData.emailNormalized === 'string' ? restoreData.emailNormalized : null,
              phoneNormalized: typeof restoreData.phoneNormalized === 'string' ? restoreData.phoneNormalized : null,
            },
            input.actorType === 'USER' ? input.actorId : null,
          );
        }
        this.logger.warn(`revertMerge ${op.id}: restoring duplicate contact ${op.duplicateId} failed: ${reasonOf(err)}`);
        throw new BadRequestException('Failed to restore duplicate contact');
      }
      throw err;
    });

    this.events.emit('contact.merge_reverted', {
      businessId: input.businessId,
      mergeId: op.id,
      primaryId: op.primaryId,
      duplicateId: op.duplicateId,
      conflicts: conflictReport.conflicts,
    });
    this.stats.invalidateCache(input.businessId);
    return {
      mergeId: op.id,
      primaryId: op.primaryId,
      duplicateId: op.duplicateId,
      revertedAt,
      restored: conflictReport.restored,
      skipped: conflictReport.skipped,
      conflicts: conflictReport.conflicts,
    };
  }

  getContactsPollState(businessId: string) {
    return this.stats.getContactsPollState(businessId);
  }

  getContactStats(businessId: string) {
    return this.stats.getContactStats(businessId);
  }

  contactDetail(params: { businessId: string; contactId: string }) {
    return this.stats.contactDetail(params);
  }

  findDuplicates(businessId: string) {
    return this.stats.findDuplicates(businessId);
  }

  segmentSummary(input: { businessId: string }) {
    return this.stats.segmentSummary(input);
  }

  flowHighlights(input: { businessId: string }) {
    return this.stats.flowHighlights(input);
  }

  toggleFavorite(businessId: string, contactId: string) {
    return this.stats.toggleFavorite(businessId, contactId);
  }

  getFavorites(businessId: string) {
    return this.stats.getFavorites(businessId);
  }

  async addNote(input: { businessId: string; contactId: string; body: string; authorId?: string | null; source?: string }, _audit?: AuditContext) {
    return this.timeline.addNote(input, _audit);
  }

  /**
   * WEDGE-WA-INBOUND-CAPTURE (P46, D-263 wedge):
   * Normalizes a pasted customer WhatsApp number under Business.country
   * (WA-E164-SERVER), finds an existing visible contact by E.164 (or creates
   * one), saves the message verbatim as a plain-text ContactNote, and logs a
   * canonical `communication.whatsapp` ContactEvent (consumed by P41 timeline
   * channel filters). Never sends any outbound message and never invokes KEY.
   */
  async captureInboundWhatsApp(
    input: {
      businessId: string;
      phone: string;
      message: string;
      firstName?: string;
      lastName?: string;
      contactId?: string;
      actorUserId: string;
    },
    audit?: AuditContext,
  ) {
    const trimmedMessage = input.message.trim();
    if (!trimmedMessage) {
      throw new BadRequestException('Message text is required');
    }
    if (trimmedMessage.length > 10_000) {
      throw new BadRequestException('Message text exceeds the 10,000 character limit');
    }

    const country = await this.businessPhoneCountry(this.prisma.client, input.businessId);
    const phoneRead = normalizeToE164(input.phone, country);
    if (!phoneRead.ok || !phoneRead.e164) {
      throw new BadRequestException(
        'Phone number could not be normalised for this business country. Include the country code or check the digits.',
      );
    }
    const e164 = phoneRead.e164;

    const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
    let contact: Contact;
    let created = false;

    if (input.contactId) {
      await assertContactVisible(this.prisma, input.businessId, input.contactId, input.actorUserId);
      const found = await this.prisma.client.contact.findFirst({
        where: contactWhereWithId(input.businessId, input.contactId),
      });
      if (!found) throw new NotFoundException('Contact not found');
      contact = found;
    } else {
      const phoneHolders = await livePhoneHolderIds(this.prisma.client, input.businessId, e164, country);
      const waTail = e164.replace(/\D/g, '').slice(-7);
      const waCandidates = waTail.length === 7
        ? await this.prisma.client.$queryRaw<Array<{ id: string; whatsappNumber: string | null }>>`
            SELECT id, whatsapp_number AS "whatsappNumber"
            FROM contacts
            WHERE business_id = ${input.businessId}
              AND deleted_at IS NULL
              AND whatsapp_number IS NOT NULL
              AND RIGHT(regexp_replace(whatsapp_number, '[^0-9]', '', 'g'), 7) = ${waTail}
            ORDER BY created_at ASC
            LIMIT 200
          `
        : [];
      const waHolders = waCandidates
        .filter((row) => phoneKeyReadsAs(contactPhoneKey(row.whatsappNumber), e164, country))
        .map((row) => row.id);
      const holderIds = Array.from(new Set([...phoneHolders, ...waHolders]));

      if (holderIds.length > 0) {
        const canOpen = await contactVisibilityFilter(
          this.prisma,
          input.businessId,
          access,
          input.actorUserId,
          holderIds,
        );
        const visibleId = holderIds.find((id) => !canOpen || canOpen(id));
        if (!visibleId) {
          throw new ConflictException({
            statusCode: 409,
            code: 'contact_phone_taken',
            message: 'A contact with this phone number already exists in this workspace.',
          });
        }
        const found = await this.prisma.client.contact.findFirst({
          where: contactWhereWithId(input.businessId, visibleId),
        });
        if (!found) throw new NotFoundException('Contact not found');
        contact = found;
      } else {
        const ownerId = this.reachLimitedToOwned(access) ? input.actorUserId : undefined;
        contact = await this.createContact(
          {
            businessId: input.businessId,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            phone: e164,
            whatsappNumber: e164,
            source: 'whatsapp_inbound',
            actorUserId: input.actorUserId,
            ...(ownerId ? { ownerId } : {}),
          },
          audit,
        );
        created = true;
      }
    }

    const note = await this.addNote(
      {
        businessId: input.businessId,
        contactId: contact.id,
        body: trimmedMessage,
        authorId: input.actorUserId,
        source: 'whatsapp_inbound',
      },
      audit,
    );

    const event = await this.timeline.logEvent(
      input.businessId,
      contact.id,
      'communication.whatsapp',
      {
        channel: 'whatsapp',
        direction: 'inbound',
        source: 'pasted_whatsapp',
        body: trimmedMessage,
        senderPhone: e164,
        noteId: note.id,
      },
      {
        source: 'whatsapp_inbound',
        actorType: 'USER',
        actorId: input.actorUserId,
      },
    );

    return {
      contact: {
        id: contact.id,
        businessId: contact.businessId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        whatsappNumber: contact.whatsappNumber,
        status: contact.status,
        source: contact.source,
      },
      created,
      normalizedPhone: e164,
      note,
      event,
    };
  }

  async addTask(input: {
    businessId: string;
    contactId: string;
    title: string;
    dueDate?: string | null;
    priority?: string | null;
    assigneeId?: string | null;
    remindAt?: string | null;
    creatorId?: string | null;
    source?: string | null;
  }, _audit?: AuditContext) {
    return this.timeline.addTask(input, _audit);
  }

  async updateNote(input: { businessId: string; noteId: string; body?: string; source?: string }, _audit?: AuditContext) {
    return this.timeline.updateNote(input, _audit);
  }

  async deleteNote(input: { businessId: string; noteId: string }, _audit?: AuditContext) {
    return this.timeline.deleteNote(input, _audit);
  }

  async updateTask(input: { businessId: string; taskId: string; title?: string; dueDate?: string; priority?: string; remindAt?: string }, _audit?: AuditContext) {
    return this.timeline.updateTask(input, _audit);
  }

  async deleteTask(input: { businessId: string; taskId: string }, _audit?: AuditContext) {
    return this.timeline.deleteTask(input, _audit);
  }

  async completeTask(input: { businessId: string; taskId: string }, _audit?: AuditContext) {
    return this.timeline.completeTask(input, _audit);
  }

  reopenTask(input: { businessId: string; taskId: string }, _audit?: AuditContext) {
    return this.timeline.reopenTask(input, _audit);
  }

  logCommunication(input: {
    businessId: string;
    contactId: string;
    channelType: string;
    outcome: string;
    duration?: number | null;
    notes?: string | null;
    actorId?: string | null;
  }) {
    return this.timeline.logCommunication(input);
  }

  logContactEvent(input: {
    businessId: string;
    contactId: string;
    type: string;
    data: any;
    actorType?: string;
    actorId?: string;
    source?: string;
    /** W4-FEED-COPY-COMPLETE (D-90): passed through to CrmTimelineService.logContactEvent (false: no Activity copy). */
    feedCopy?: boolean;
  }) {
    return this.timeline.logContactEvent(input);
  }

  listContactEvents(params: { businessId: string; contactId: string; limit?: number; viewerUserId?: string | null }) {
    return this.timeline.listContactEvents(params);
  }

  listContactEventsPage(params: Parameters<CrmTimelineService['listContactEventsPage']>[0]) {
    return this.timeline.listContactEventsPage(params);
  }

  listContactNotes(params: { businessId: string; contactId: string }) {
    return this.timeline.listContactNotes(params);
  }

  listContactTasks(input: { businessId: string; contactId?: string; status?: string; dueBefore?: Date }) {
    return this.timeline.listContactTasks(input);
  }

  getContactTimeline(businessId: string, contactId: string, limit?: number) {
    return this.timeline.getContactTimeline(businessId, contactId, limit);
  }

  async countContacts(input: { businessId: string; status?: string; tag?: string }) {
    const where = buildContactWhere(input.businessId, {
      status: input.status,
      tags: input.tag ? [input.tag] : undefined,
    });
    return this.prisma.client.contact.count({ where });
  }

  dueTasks(input: { businessId: string; windowDays?: number }) {
    return this.timeline.dueTasks(input);
  }

  /**
   * W9-CRM-RESIDUALS review SEC-W9CR-1 (D-37): `visibility` is the caller's CRM
   * visibility clause (GET contact-next-actions passes the session member's;
   * null or absent for the OWNER and SUPER_ADMIN): with one, only the contacts
   * the member may open are listed, by the rule GET contacts/:contactId applies.
   */
  async listNextActions(input: { businessId: string; windowDays?: number; limit?: number; visibility?: Prisma.ContactWhereInput | null }) {
    const windowDays = Math.max(0, Math.min(60, input.windowDays ?? 7));
    const limit = Math.max(1, Math.min(100, input.limit ?? 25));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + windowDays);
    const now = new Date();

    const contacts = await this.prisma.client.contact.findMany({
      where: {
        ...contactWhereBase(input.businessId),
        archivedAt: null,
        nextActionAt: { not: null, lte: cutoff },
        ...(input.visibility ? { AND: [input.visibility] } : {}),
      },
      orderBy: [
        { nextActionAt: 'asc' },
      ],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        email: true,
        phone: true,
        priority: true,
        status: true,
        nextActionAt: true,
        nextActionType: true,
      },
    });

    const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const ranked = contacts
      .map((c) => ({
        ...c,
        overdue: c.nextActionAt ? c.nextActionAt.getTime() < now.getTime() : false,
        priorityRank: priorityRank[(c.priority ?? 'NORMAL').toUpperCase()] ?? 2,
      }))
      .sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
        const at = a.nextActionAt?.getTime() ?? 0;
        const bt = b.nextActionAt?.getTime() ?? 0;
        return at - bt;
      })
      .slice(0, limit);

    return {
      windowDays,
      now: now.toISOString(),
      items: ranked.map(({ priorityRank: _r, ...rest }) => ({
        ...rest,
        nextActionAt: rest.nextActionAt?.toISOString() ?? null,
      })),
    };
  }

  async completeNextAction(
    input: { businessId: string; contactId: string; actorId?: string | null },
    _audit?: AuditContext,
  ) {
    const existing = await this.assertContact(input.businessId, input.contactId);
    if (!existing.nextActionAt && !existing.nextActionType) {
      return existing;
    }
    const audit = this.memberAuditContext(_audit, input.actorId ?? undefined);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.contact.update({
        where: { id: input.contactId },
        data: { nextActionAt: null, nextActionType: null },
      });
      await this.auditContact(
        {
          businessId: input.businessId,
          contactId: input.contactId,
          action: 'updated',
          before: { nextActionAt: existing.nextActionAt, nextActionType: existing.nextActionType },
          after: { nextActionAt: null, nextActionType: null },
          ctx: audit,
          extraReason: 'next_action.completed',
        },
        tx,
      );
      await this.timeline.logEvent(
        input.businessId,
        input.contactId,
        'next_action.completed',
        {
          previousNextActionAt: existing.nextActionAt?.toISOString() ?? null,
          previousNextActionType: existing.nextActionType ?? null,
        },
        { actorType: 'SYSTEM', source: 'crm', ...this.eventActor(audit) },
        tx,
      );
      return row;
    });
    this.events.emit('contact.next_action_cleared', {
      businessId: input.businessId,
      contactId: input.contactId,
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return updated;
  }

  async snoozeNextAction(
    input: {
      businessId: string;
      contactId: string;
      snoozeUntil?: string | null;
      days?: number | null;
      actorId?: string | null;
    },
    _audit?: AuditContext,
  ) {
    const existing = await this.assertContact(input.businessId, input.contactId);
    let target: Date;
    if (input.snoozeUntil) {
      const parsed = new Date(input.snoozeUntil);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('snoozeUntil must be a valid ISO date');
      }
      target = parsed;
    } else if (typeof input.days === 'number' && Number.isFinite(input.days)) {
      const days = Math.max(1, Math.min(60, Math.floor(input.days)));
      const now = new Date();
      const baseMs = Math.max(existing.nextActionAt?.getTime() ?? 0, now.getTime());
      target = new Date(baseMs + days * 24 * 60 * 60 * 1000);
    } else {
      throw new BadRequestException('Provide snoozeUntil (ISO date) or days (1-60)');
    }
    const audit = this.memberAuditContext(_audit, input.actorId ?? undefined);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.contact.update({
        where: { id: input.contactId },
        data: { nextActionAt: target },
      });
      await this.auditContact(
        {
          businessId: input.businessId,
          contactId: input.contactId,
          action: 'updated',
          before: { nextActionAt: existing.nextActionAt },
          after: { nextActionAt: target },
          ctx: audit,
          extraReason: 'next_action.snoozed',
        },
        tx,
      );
      await this.timeline.logEvent(
        input.businessId,
        input.contactId,
        'next_action.snoozed',
        {
          previousNextActionAt: existing.nextActionAt?.toISOString() ?? null,
          nextActionAt: target.toISOString(),
          nextActionType: existing.nextActionType ?? null,
        },
        { actorType: 'SYSTEM', source: 'crm', ...this.eventActor(audit) },
        tx,
      );
      return row;
    });
    this.events.emit('contact.next_action_set', {
      businessId: input.businessId,
      contactId: input.contactId,
      nextActionAt: target.toISOString(),
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return updated;
  }

  approveAutopilotAction(input: { businessId: string; actionId: string }) {
    return this.timeline.approveAutopilotAction(input);
  }

  denyAutopilotAction(input: { businessId: string; actionId: string }) {
    return this.timeline.denyAutopilotAction(input);
  }

  listContactLists(businessId: string) {
    return this.lists.listContactLists(businessId);
  }

  createContactList(input: { businessId: string; name: string; description?: string; color?: string; type?: string; filters?: any; rules?: any; contactIds?: string[] }) {
    return this.lists.createContactList(input);
  }

  updateContactList(input: { businessId: string; listId: string; name?: string; description?: string; color?: string; type?: string; filters?: any; rules?: any; contactIds?: string[] }) {
    return this.lists.updateContactList(input);
  }

  deleteContactList(input: { businessId: string; listId: string }) {
    return this.lists.deleteContactList(input);
  }

  getContactListContacts(input: { businessId: string; listId: string; limit?: number; offset?: number }) {
    return this.lists.getContactListContacts(input);
  }

  addContactsToList(input: { businessId: string; listId: string; contactIds: string[] }) {
    return this.lists.addContactsToList(input);
  }

  removeContactFromList(input: { businessId: string; listId: string; contactId: string }) {
    return this.lists.removeContactFromList(input);
  }

  /**
   * POST .../contacts/check-duplicates: which rows of an import already have a contact, and which
   * one. Only contacts `actorUserId` may open are matched (findExistingBulk applies the M7
   * visibility clause; SWP-CRM-SEARCH review SEC-CRMS-1): the answer names the holder, and a
   * holder the member is denied on GET detail reads as a new row here.
   *
   * A phone is read the way POST .../contacts and the import read it
   * (WA-E164-SERVER review COR-E164-5): under the business's country, to the
   * E.164 key a create would store ('712-3401' in Trinidad and Tobago is
   * '+18687123401'), and a contact holds it when its stored key reads as that
   * number under the same country (a key stored before E.164 included). A
   * phone that does not read is matched by its exact key only.
   */
  async checkDuplicates(
    businessId: string,
    contacts: Array<{ email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null }>,
    actorUserId: string,
  ) {
    const limited = contacts.slice(0, 100);
    const emails = limited
      .map((c) => normalizeEmail(c.email))
      .filter((e): e is string => !!e);
    const country = limited.some((c) => c.phone?.trim())
      ? await this.businessPhoneCountry(this.prisma.client, businessId)
      : null;
    // The identity key a create would store for the phone (E.164 when it reads).
    const phoneKeyOf = (phone?: string | null): string | null => {
      const read = contactPhoneForStorage(phone, country);
      return read.e164 ?? phoneIdentityKey(read.value);
    };
    const samePhone = (storedKey: string | null, asked: string) =>
      asked.startsWith('+') ? phoneKeyReadsAs(storedKey, asked, country) : storedKey === asked;
    const phones = limited
      .map((c) => phoneKeyOf(c.phone))
      .filter((p): p is string => !!p);

    const { existingByEmail, existingByPhone } = await findExistingBulk(this.prisma, businessId, emails, phones, actorUserId, samePhone);

    const duplicates: Array<{
      importIndex: number;
      importContact: typeof limited[0];
      existingContact: typeof existingByEmail[0];
      matchField: 'email' | 'phone';
    }> = [];

    const newContacts: number[] = [];

    for (let i = 0; i < limited.length; i++) {
      const c = limited[i];
      const normalizedEmailVal = normalizeEmail(c.email);
      const normalizedPhoneVal = phoneKeyOf(c.phone);
      let matched = false;

      if (normalizedEmailVal) {
        const match = existingByEmail.find((e) => e.emailNormalized === normalizedEmailVal);
        if (match) {
          duplicates.push({ importIndex: i, importContact: c, existingContact: match, matchField: 'email' });
          matched = true;
        }
      }
      if (!matched && normalizedPhoneVal) {
        // The same number in any spelling (SWP-CRM-SEARCH, BUG-083), read under the
        // business's country (WA-E164-SERVER review COR-E164-5), the exact key first.
        const match = findPhoneKeyMatch(existingByPhone, normalizedPhoneVal, samePhone);
        if (match) {
          duplicates.push({ importIndex: i, importContact: c, existingContact: match, matchField: 'phone' });
          matched = true;
        }
      }
      if (!matched) {
        newContacts.push(i);
      }
    }

    return {
      total: limited.length,
      newCount: newContacts.length,
      duplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 50),
    };
  }
}

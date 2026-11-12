import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Contact } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmCacheService } from './crm-cache.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { resolveCrmAccess, visibilityClause } from './crm-permissions.helper';
import { crmRowCarriesMoney, readVisibleActivityPage, resolveTimelineViewer } from '../timeline/timeline-visibility';

export type TopOpenDeal = {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  stage: { id: string; name: string; slug: string };
};

export type ContactMeta = {
  outstandingBalance: number;
  unpaidInvoices: number;
  paidInvoices: number;
  oldestUnpaidInvoiceDueAt: Date | null;
  lastInteractionAt: Date;
  nextDueTaskAt: Date | null;
  overdueTasks: number;
  overdueBookings: number;
  bookingsRecent: number;
  leadScore: number;
  totalRevenue: number;
  invoiceCount: number;
  bookingCount: number;
  openDealsCount?: number;
  openDealsValue?: number;
  topOpenDeal?: TopOpenDeal | null;
  aiDominantSentiment?: string | null;
  aiLastIntent?: string | null;
};

export type ContactWithStats = Contact & {
  meta?: ContactMeta;
};

/**
 * W7-CONTACT-MONEY-VIEWS review repair SEC-W7CMV-3 (V55-13i; owner rulings
 * D-90 and D-63): the Contact.riskFlags entries ContactInsightService.recompute
 * derives from the contact's invoices (revenue rows, D-63): 'unpaid_invoices'
 * (an unpaid invoice), 'poor_payment_history' (its paymentReliability) and
 * 'declining_engagement' (a paid total above 0).
 */
const REVENUE_RISK_FLAGS: ReadonlySet<string> = new Set(['unpaid_invoices', 'poor_payment_history', 'declining_engagement']);

/**
 * The Contact.opportunities entries it derives from the contact's quotes and
 * invoices (SEC-W7CMV-3; D-90 / D-63): 'pending_quotes' (a quote not accepted)
 * and 'upsell_ready' (a paid total above 500, a revenue threshold like the
 * insight's 'high-value' tag).
 */
const REVENUE_OPPORTUNITIES: ReadonlySet<string> = new Set(['pending_quotes', 'upsell_ready']);

/** A stored riskFlags / opportunities list without the `revenue` entries; any other stored value as it is. */
function withoutRevenueSignals(value: Prisma.JsonValue | null, revenue: ReadonlySet<string>): Prisma.JsonValue | null {
  return Array.isArray(value) ? value.filter((entry) => !(typeof entry === 'string' && revenue.has(entry))) : value;
}

/**
 * W9-MONEY-RANKING (owner ruling D-100; SEC-W8MS-3): a contact's stats with no
 * invoice term: meta's lead score without +10 a paid and -5 an unpaid invoice
 * (attachContactStats' terms; the score withoutListMoney in crm.service.ts
 * serves a member without revenue read) and its invoice figures 0.
 */
function withoutInvoiceTerms(contact: ContactWithStats): ContactWithStats {
  const meta = contact.meta;
  if (!meta) return contact;
  return {
    ...contact,
    meta: {
      ...meta,
      leadScore: meta.leadScore - meta.paidInvoices * 10 + meta.unpaidInvoices * 5,
      outstandingBalance: 0,
      unpaidInvoices: 0,
      paidInvoices: 0,
      oldestUnpaidInvoiceDueAt: null,
      totalRevenue: 0,
      invoiceCount: 0,
    },
  };
}

/** The entries GET .../highlights serves in its timeline (CrmTimelineService.buildTimeline's default cut). */
const HIGHLIGHTS_TIMELINE_ENTRIES = 20;

/** A contact scope no contact matches: the highlights of a member without revenue read when the call names no viewer (fail closed). */
const NO_CONTACT: Prisma.ContactWhereInput = { id: { in: [] } };

/**
 * W11-CRM-SEGMENTS-VISIBLE (F-10, D-63) and its review repair SEC-W11SV-1
 * (D-133): the live contacts of the business a CRM count reads: all of them
 * with no visibility clause, else the base AND the clause.
 */
function viewerContactWhere(businessId: string, visibility: Prisma.ContactWhereInput | null): Prisma.ContactWhereInput {
  return visibility ? { ...contactWhereBase(businessId), AND: [visibility] } : contactWhereBase(businessId);
}

/**
 * W8-MONEY-SIGNALS review repair SEC-W8MS-3 / W9-MONEY-RANKING review repair
 * SEC-W9MR-2 (owner ruling D-100): whether a highlights timeline entry carries
 * money: an invoice row ('Total <amount> <currency>') or a ContactEvent row of
 * a money type (crmRowCarriesMoney, the feed's rule). A member without revenue
 * read is served neither (crm.controller.ts withoutHighlightsMoney).
 *
 * An entry carries no data, so this cannot see an event of another type whose
 * data carries an amount (e.g. payment.completed, store_order.paid): that one
 * is judged on its row, data included, before the entry is made
 * (CrmTimelineService.buildTimeline withoutMoney; W10-MONEY-SIGNALS-REST review
 * repair SEC-W10MSR-1, D-100, D-90, D-63). This stays as the backstop.
 */
export function timelineEntryCarriesMoney(entry: { type: string; title: string }): boolean {
  return entry.type === 'invoice' || (entry.type === 'event' && crmRowCarriesMoney({ module: 'crm', type: entry.title }));
}

type ContactHighlight = {
  contactId: string;
  name: string;
  status: string;
  leadScore: number;
  outstandingBalance: number;
  unpaidInvoices: number;
  lastInteractionAt: Date | null;
  tags: string[];
};

type ServiceAffinity = {
  serviceId: string;
  serviceName: string;
  bookings: number;
  revenue: number;
  topContact?: {
    id: string;
    name: string;
    bookings: number;
  };
};

type SegmentInsight = {
  key: string;
  label: string;
  description: string;
  count: number;
  contacts: ContactWithStats[];
};

type TimelineEntry = {
  id: string;
  type: 'event' | 'note' | 'task' | 'invoice' | 'booking';
  contactId: string;
  contactName?: string;
  contactEmail?: string | null;
  title: string;
  description?: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
};

type NextActionSeverity = 'high' | 'medium' | 'info';

type NextAction = {
  id: string;
  contactId: string;
  contactName?: string;
  title: string;
  detail: string;
  severity: NextActionSeverity;
  trigger: string;
};

type AiNextAction = {
  type: 'follow_up' | 'send_quote' | 'payment_reminder' | 'add_note';
  contactId: string;
  contactName: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
};

type FlowHighlightsPayload = {
  highlights: {
    highPotential: ContactHighlight[];
    overdueReminders: ContactHighlight[];
    serviceAffinity: ServiceAffinity[];
  };
  segments: SegmentInsight[];
  timeline: TimelineEntry[];
  nextActions: NextAction[];
  aiNextActions: AiNextAction[];
};

@Injectable()
export class CrmStatsService {
  private readonly logger = new Logger(CrmStatsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmCacheService) private readonly cache: CrmCacheService,
  ) {}

  invalidateCache(businessId: string): void {
    void this.cache.invalidate(businessId);
  }

  getCacheMetrics() {
    return { hits: 0, misses: 0, hitRate: 0, size: 0 };
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

  /**
   * Resolve one contact the way the list path does.
   *
   * With an actor, the row must satisfy the actor's effective CRM visibility
   * (`resolveCrmAccess` + `visibilityClause`, the same rule `listContacts`
   * applies) as well as the tenant predicate. A row the actor may not see is
   * reported exactly like an absent one, so a forbidden PRIVATE record is
   * never disclosed, and nothing related to it is read.
   *
   * Without an actor the tenant predicate alone applies, as before. That is
   * the system context: automation, the flow executor and the KEY adapter
   * reach this through `CrmService.contactDetail` with no caller identity.
   */
  private async assertContact(businessId: string, contactId: string, actorUserId?: string) {
    const where: Prisma.ContactWhereInput = { ...contactWhereWithId(businessId, contactId) };
    if (actorUserId) {
      const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
      const visClause = visibilityClause(access, actorUserId);
      if (visClause) {
        where.AND = [visClause];
      }
    }
    const contact = await this.prisma.client.contact.findFirst({ where });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  /**
   * W11-CRM-SEGMENTS-VISIBLE (F-10; owner rulings D-63 and D-100) and its
   * review repair SEC-W11SV-1 (owner ruling D-133, the CRM count widgets): the
   * visibility clause a CRM count read for `viewerUserId` ANDs onto its
   * contact where (resolveCrmAccess + visibilityClause, the rule GET
   * contacts/:contactId and GET .../highlights apply). Null when no rule hides
   * a contact from that viewer (the OWNER, SUPER_ADMIN) or the call names no
   * viewer (a system caller): the counts are then the whole business's.
   * resolveCrmAccess refuses a non-member (ForbiddenException).
   */
  private async viewerContactVisibility(businessId: string, viewerUserId?: string): Promise<Prisma.ContactWhereInput | null> {
    if (!viewerUserId) return null;
    return visibilityClause(await resolveCrmAccess(this.prisma, businessId, viewerUserId), viewerUserId) as Prisma.ContactWhereInput | null;
  }

  /**
   * The contact stats (GET .../contact-stats): totalCount, countByStatus,
   * countBySource, recentGrowth (six weeks) and topTags. A viewer no
   * visibility rule hides a contact from (the OWNER, SUPER_ADMIN), or a call
   * that names no viewer, gets the business-wide stats, cached for it under
   * `${businessId}:getContactStats`, as before.
   *
   * W11-CRM-SEGMENTS-VISIBLE review repair SEC-W11SV-1 (owner ruling D-133:
   * CRM count widgets count only the contacts the member may open; the owner
   * sees business-wide figures): any other viewer gets every figure over the
   * contacts they may open, as GET .../segments counts them, so another
   * member's PRIVATE contact is neither counted nor named by its source or
   * tags. Not cached (neither read nor written): the visibility is that
   * viewer's and is read at each request.
   */
  async getContactStats(businessId: string, viewerUserId?: string) {
    const visibility = await this.viewerContactVisibility(businessId, viewerUserId);
    const cacheKey = `${businessId}:getContactStats`;
    if (!visibility) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // SEC-W11SV-1 (D-133): with a visibility clause every figure's where is the base AND the clause.
    const base = viewerContactWhere(businessId, visibility);

    const totalCount = await this.prisma.client.contact.count({
      where: base,
    });

    const statusGroups = await this.prisma.client.contact.groupBy({
      by: ['status'],
      where: base,
      _count: { id: true },
    });
    const countByStatus: Record<string, number> = { LEAD: 0, PROSPECT: 0, CLIENT: 0, LOST: 0 };
    for (const g of statusGroups) {
      countByStatus[g.status] = g._count.id;
    }

    const sourceGroups = await this.prisma.client.contact.groupBy({
      by: ['source'],
      where: base,
      _count: { id: true },
    });
    const countBySource = sourceGroups.map((g) => ({
      source: g.source ?? 'unknown',
      count: g._count.id,
    }));

    const recentGrowth: { week: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - i * 7);
      weekStart.setHours(0, 0, 0, 0);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
      weekStart.setDate(diff);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const count = await this.prisma.client.contact.count({
        where: {
          ...base,
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      });
      recentGrowth.push({ week: weekStart.toISOString(), count });
    }

    const allContacts = await this.prisma.client.contact.findMany({
      where: base,
      select: { tags: true },
    });
    const tagCounts = new Map<string, number>();
    for (const c of allContacts) {
      for (const tag of c.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const result = { totalCount, countByStatus, countBySource, recentGrowth, topTags };
    // SEC-W11SV-1 (D-133): a viewer's stats are never written to the business cache.
    if (!visibility) await this.cache.set(cacheKey, result);
    return result;
  }

  async attachContactStats(businessId: string, contacts: Contact[]): Promise<ContactWithStats[]> {
    const ids = contacts.map((c) => c.id);
    if (ids.length === 0) return contacts;

    const idList = Prisma.join(ids);

    const [
      invoiceRows,
      taskRows,
      eventRows,
      noteRows,
      bookingRows,
      openDeals,
    ] = await Promise.all([
      this.prisma.client.$queryRaw<Array<{
        contact_id: string;
        invoice_count: number;
        total_revenue: number;
        outstanding_balance: number;
        paid_invoices: number;
        unpaid_invoices: number;
        oldest_unpaid_due_at: Date | null;
      }>>`
        SELECT
          contact_id,
          COUNT(*)::int AS invoice_count,
          COALESCE(SUM(total) FILTER (WHERE status = 'PAID'), 0)::float AS total_revenue,
          COALESCE(SUM(total) FILTER (WHERE status IN ('SENT','OVERDUE')), 0)::float AS outstanding_balance,
          COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_invoices,
          COUNT(*) FILTER (WHERE status IN ('SENT','OVERDUE'))::int AS unpaid_invoices,
          MIN(due_date) FILTER (WHERE status IN ('SENT','OVERDUE')) AS oldest_unpaid_due_at
        FROM invoices
        WHERE business_id = ${businessId}
          AND contact_id IN (${idList})
          AND deleted_at IS NULL
        GROUP BY contact_id
      `,
      this.prisma.client.$queryRaw<Array<{
        contact_id: string;
        overdue_tasks: number;
        next_due_task_at: Date | null;
        max_created_at: Date | null;
      }>>`
        SELECT
          contact_id,
          COUNT(*) FILTER (WHERE status != 'DONE' AND due_date < NOW())::int AS overdue_tasks,
          MIN(due_date) FILTER (WHERE status != 'DONE') AS next_due_task_at,
          MAX(created_at) AS max_created_at
        FROM contact_tasks
        WHERE business_id = ${businessId}
          AND contact_id IN (${idList})
        GROUP BY contact_id
      `,
      this.prisma.client.$queryRaw<Array<{
        contact_id: string;
        max_created_at: Date | null;
      }>>`
        SELECT contact_id, MAX(created_at) AS max_created_at
        FROM contact_events
        WHERE business_id = ${businessId}
          AND contact_id IN (${idList})
        GROUP BY contact_id
      `,
      this.prisma.client.$queryRaw<Array<{
        contact_id: string;
        max_created_at: Date | null;
      }>>`
        SELECT contact_id, MAX(created_at) AS max_created_at
        FROM contact_notes
        WHERE business_id = ${businessId}
          AND contact_id IN (${idList})
        GROUP BY contact_id
      `,
      this.prisma.client.$queryRaw<Array<{
        contact_id: string;
        booking_count: number;
        bookings_recent: number;
        overdue_bookings: number;
        max_start_time: Date | null;
      }>>`
        SELECT
          contact_id,
          COUNT(*)::int AS booking_count,
          COUNT(*) FILTER (WHERE status = 'COMPLETED' AND start_time > NOW() - INTERVAL '14 days')::int AS bookings_recent,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND start_time < NOW())::int AS overdue_bookings,
          MAX(start_time) AS max_start_time
        FROM bookings
        WHERE business_id = ${businessId}
          AND contact_id IN (${idList})
          AND deleted_at IS NULL
        GROUP BY contact_id
      `,
      this.prisma.client.deal.findMany({
        where: { businessId, contactId: { in: ids }, status: 'OPEN', deletedAt: null },
        orderBy: [{ value: 'desc' }],
        select: {
          id: true,
          contactId: true,
          title: true,
          value: true,
          currency: true,
          stage: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    const statsMap = new Map<string, ContactMeta>();
    for (const contact of contacts) {
      statsMap.set(contact.id, {
        outstandingBalance: 0,
        unpaidInvoices: 0,
        paidInvoices: 0,
        oldestUnpaidInvoiceDueAt: null,
        lastInteractionAt: contact.updatedAt,
        nextDueTaskAt: null,
        overdueTasks: 0,
        overdueBookings: 0,
        bookingsRecent: 0,
        leadScore: 50,
        totalRevenue: 0,
        invoiceCount: 0,
        bookingCount: 0,
        openDealsCount: 0,
        openDealsValue: 0,
        topOpenDeal: null,
      });
    }

    const mergeDate = (current: Date, candidate: Date | null): Date => {
      if (!candidate) return current;
      return candidate > current ? candidate : current;
    };

    for (const row of invoiceRows) {
      const stats = statsMap.get(row.contact_id);
      if (!stats) continue;
      stats.invoiceCount = row.invoice_count;
      stats.totalRevenue = row.total_revenue;
      stats.outstandingBalance = row.outstanding_balance;
      stats.paidInvoices = row.paid_invoices;
      stats.unpaidInvoices = row.unpaid_invoices;
      stats.oldestUnpaidInvoiceDueAt = row.oldest_unpaid_due_at;
    }

    for (const row of taskRows) {
      const stats = statsMap.get(row.contact_id);
      if (!stats) continue;
      stats.overdueTasks = row.overdue_tasks;
      stats.nextDueTaskAt = row.next_due_task_at;
      stats.lastInteractionAt = mergeDate(stats.lastInteractionAt, row.max_created_at);
    }

    for (const row of eventRows) {
      const stats = statsMap.get(row.contact_id);
      if (stats) stats.lastInteractionAt = mergeDate(stats.lastInteractionAt, row.max_created_at);
    }

    for (const row of noteRows) {
      const stats = statsMap.get(row.contact_id);
      if (stats) stats.lastInteractionAt = mergeDate(stats.lastInteractionAt, row.max_created_at);
    }

    for (const row of bookingRows) {
      const stats = statsMap.get(row.contact_id);
      if (!stats) continue;
      stats.bookingCount = row.booking_count;
      stats.bookingsRecent = row.bookings_recent;
      stats.overdueBookings = row.overdue_bookings;
      stats.lastInteractionAt = mergeDate(stats.lastInteractionAt, row.max_start_time);
    }

    for (const deal of openDeals) {
      const stats = statsMap.get(deal.contactId);
      if (!stats) continue;
      stats.openDealsCount = (stats.openDealsCount ?? 0) + 1;
      stats.openDealsValue = (stats.openDealsValue ?? 0) + Number(deal.value ?? 0);
      if (!stats.topOpenDeal) {
        stats.topOpenDeal = {
          id: deal.id,
          title: deal.title,
          value: deal.value,
          currency: deal.currency,
          stage: deal.stage,
        };
      }
    }

    // Latest AI rollup per contact (best-effort; failure is silent).
    const aiRollupMap = new Map<string, { sentiment: string | null; intent: string | null }>();
    try {
      const latestInsights = await this.prisma.client.conversationAIInsight.findMany({
        where: { businessId, contactId: { in: ids }, kind: 'message_analysis' },
        orderBy: { createdAt: 'desc' },
        take: ids.length * 5,
        select: { contactId: true, payload: true, createdAt: true },
      });
      for (const ins of latestInsights) {
        if (aiRollupMap.has(ins.contactId)) continue;
        const p = (ins.payload ?? {}) as { sentiment?: string | null; intent?: string | null };
        aiRollupMap.set(ins.contactId, { sentiment: p.sentiment ?? null, intent: p.intent ?? null });
      }
    } catch (err: any) {
      this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
    }

    const updates: { id: string; leadScore: number; lastInteractionAt: Date }[] = [];
    const withStats = contacts.map((contact) => {
      const stats = statsMap.get(contact.id);
      if (!stats) return contact;
      const leadScore =
        50 +
        stats.bookingsRecent * 15 +
        stats.paidInvoices * 10 -
        stats.unpaidInvoices * 5 -
        stats.overdueTasks * 5 +
        (contact.status === 'CLIENT' ? 5 : 0);
      stats.leadScore = leadScore;
      const ai = aiRollupMap.get(contact.id);
      if (ai) {
        stats.aiDominantSentiment = ai.sentiment;
        stats.aiLastIntent = ai.intent;
      }
      if (
        contact.leadScore !== leadScore ||
        !contact.lastInteractionAt ||
        contact.lastInteractionAt.getTime() !== stats.lastInteractionAt.getTime()
      ) {
        updates.push({ id: contact.id, leadScore, lastInteractionAt: stats.lastInteractionAt });
      }
      return {
        ...contact,
        meta: stats,
      };
    });
    if (updates.length > 0) {
      this.prisma.client.$transaction(
        updates.map((u) =>
          this.prisma.client.contact.update({
            where: { id: u.id },
            data: { leadScore: u.leadScore, lastInteractionAt: u.lastInteractionAt },
          }),
        ),
      ).catch((err) => {
        this.logger.warn('Background lead score update failed', (err as Error).message);
      });
    }
    return withStats;
  }

  async findDuplicates(businessId: string) {
    const contacts = await this.prisma.client.contact.findMany({
      where: contactWhereBase(businessId),
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        emailNormalized: true,
        phone: true,
        phoneNormalized: true,
        status: true,
        companyName: true,
        source: true,
        createdAt: true,
      },
    });

    type DuplicateGroup = {
      field: 'email' | 'phone' | 'name';
      value: string;
      contacts: typeof contacts;
    };

    const groups: DuplicateGroup[] = [];
    const seenKeys = new Set<string>();

    const emailMap = new Map<string, typeof contacts>();
    const phoneMap = new Map<string, typeof contacts>();
    const nameMap = new Map<string, typeof contacts>();

    for (const contact of contacts) {
      if (contact.emailNormalized) {
        const key = contact.emailNormalized;
        if (!emailMap.has(key)) emailMap.set(key, []);
        emailMap.get(key)!.push(contact);
      }

      if (contact.phoneNormalized) {
        const key = contact.phoneNormalized;
        if (!phoneMap.has(key)) phoneMap.set(key, []);
        phoneMap.get(key)!.push(contact);
      }

      const firstName = (contact.firstName ?? '').trim().toLowerCase();
      const lastName = (contact.lastName ?? '').trim().toLowerCase();
      if (firstName && lastName) {
        const key = `${firstName}|${lastName}`;
        if (!nameMap.has(key)) nameMap.set(key, []);
        nameMap.get(key)!.push(contact);
      }
    }

    for (const [value, dupes] of emailMap) {
      if (dupes.length > 1) {
        const key = `email:${value}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          groups.push({ field: 'email', value, contacts: dupes });
        }
      }
    }

    for (const [value, dupes] of phoneMap) {
      if (dupes.length > 1) {
        const key = `phone:${value}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          groups.push({ field: 'phone', value, contacts: dupes });
        }
      }
    }

    for (const [value, dupes] of nameMap) {
      if (dupes.length > 1) {
        const contactIds = new Set(dupes.map((c) => c.id));
        const alreadyCovered = groups.some(
          (g) => g.contacts.length === dupes.length && g.contacts.every((c) => contactIds.has(c.id)),
        );
        if (!alreadyCovered) {
          const key = `name:${value}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            groups.push({ field: 'name', value, contacts: dupes });
          }
        }
      }
    }

    return { groups: groups.slice(0, 20) };
  }

  /**
   * Contact detail projection. `actorUserId` is the caller whose CRM
   * visibility bounds the lookup (the HTTP route always supplies it); omitted
   * only by system-context callers, which keep the tenant-only predicate.
   *
   * W7-CONTACT-MONEY-VIEWS (V55-13h; CR-W6CEM-1, owner rulings D-90 and D-63,
   * the V1-84 timeline rule): `actorUserId` is also the reading member whose
   * revenue read decides the money in the response (GET contacts/:id and the
   * dossier's contact and meta). One without revenue read is served no money
   * row and no money figure: `events` are the ContactEvents GET .../events
   * serves them (the rule of CrmTimelineService.listContactEvents, V55-13e,
   * read here through Prisma: the money events withheld, the 50 filled from
   * older events), the contact's invoices are not read (`invoices` is empty,
   * so meta's invoice figures, totalRevenue and outstandingBalance included,
   * are 0 and its lead score has no invoice term), and the contact's stored
   * lifetimeValue / averageSpend (the paid total ContactInsightService
   * writes) are null. Review repair SEC-W7CMV-3 (V55-13i; D-90 / D-63): so is
   * its stored paymentReliability (the paid / total invoice score, which GET
   * .../revenue-summary already serves that member as null), and its stored
   * riskFlags / opportunities lose the entries ContactInsightService derives
   * from the contact's invoices and quotes (REVENUE_RISK_FLAGS,
   * REVENUE_OPPORTUNITIES); the other entries stay. Not closed here (outside
   * this write set, follow-up CR-W7CMV-2): GET /crm/businesses/:b/contacts
   * (CrmService.listContacts) still serves the same stored fields, and sorts
   * and filters on revenue, to the same member, so until that list is closed
   * this withholding does not keep them from that member. Before it the route served
   * every event, invoice total and revenue figure on crm read alone. The owner,
   * a member with revenue read and a system-context caller get every row and
   * figure, as before.
   */
  async contactDetail(params: { businessId: string; contactId: string; actorUserId?: string }) {
    const contact = await this.assertContact(params.businessId, params.contactId, params.actorUserId);
    const viewer = params.actorUserId ? await resolveTimelineViewer(this.prisma, params.businessId, params.actorUserId) : null;
    const readsRevenue = viewer === null || viewer.readable.has('revenue');
    const eventWhere = { businessId: params.businessId, contactId: params.contactId };
    const [events, notes, tasks, invoices, bookings, customFieldValues] = await Promise.all([
      viewer
        ? // The rule CrmTimelineService.listContactEvents applies to GET .../events (V55-13e):
          // each event judged as the feed judges its CRM copy (module crm, naming the contact).
          readVisibleActivityPage(this.prisma, viewer, 50, async (skip, take) => {
            const rows = await this.prisma.client.contactEvent.findMany({ where: eventWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take });
            return rows.map((event) => ({ module: 'crm', action: event.type, type: event.type, contactId: event.contactId, data: event.data, event }));
          }).then((page) => page.map((row) => row.event))
        : this.prisma.client.contactEvent.findMany({
            where: eventWhere,
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
      this.prisma.client.contactNote.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      readsRevenue
        ? this.prisma.client.invoice.findMany({
            where: { businessId: params.businessId, contactId: params.contactId, deletedAt: null },
            select: {
              id: true,
              status: true,
              total: true,
              currency: true,
              dueDate: true,
              issueDate: true,
              createdAt: true,
              paidAt: true,
            },
          })
        : [],
      this.prisma.client.booking.findMany({
        where: { businessId: params.businessId, contactId: params.contactId, deletedAt: null },
        select: { id: true, status: true, startTime: true, endTime: true, serviceId: true, staffId: true },
      }),
      // Only the contact's own business's definitions (SEC-R015c-3 review SF-1,
      // W9-CUSTOM-FIELDS-TENANT): the tenant extension never reaches the
      // included definition, so a value row bound to another business's
      // definition would serve its label, description and options here.
      this.prisma.client.contactCustomFieldValue.findMany({
        where: { contactId: params.contactId, definition: { businessId: params.businessId } },
        include: { definition: true },
      }),
    ]);

    const meta: ContactMeta = {
      outstandingBalance: 0,
      unpaidInvoices: 0,
      paidInvoices: 0,
      oldestUnpaidInvoiceDueAt: null,
      lastInteractionAt: contact.updatedAt,
      nextDueTaskAt: null,
      overdueTasks: 0,
      overdueBookings: 0,
      bookingsRecent: 0,
      leadScore: 50,
      totalRevenue: 0,
      invoiceCount: 0,
      bookingCount: 0,
    };

    const now = new Date();
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 14);

    for (const inv of invoices) {
      meta.invoiceCount += 1;
      if (['SENT', 'OVERDUE'].includes(inv.status)) {
        meta.outstandingBalance += Number(inv.total ?? 0);
        meta.unpaidInvoices += 1;
        const dueDate = inv.dueDate ?? inv.issueDate ?? inv.createdAt;
        if (dueDate) {
          if (!meta.oldestUnpaidInvoiceDueAt || dueDate < meta.oldestUnpaidInvoiceDueAt) {
            meta.oldestUnpaidInvoiceDueAt = dueDate;
          }
        }
      }
      if (inv.status === 'PAID') {
        meta.paidInvoices += 1;
        meta.totalRevenue += Number(inv.total ?? 0);
      }
    }

    for (const task of tasks) {
      if (task.status !== 'DONE' && task.dueDate) {
        const due = new Date(task.dueDate);
        if (!meta.nextDueTaskAt || due < meta.nextDueTaskAt) meta.nextDueTaskAt = due;
        if (due < now) meta.overdueTasks += 1;
      }
      if (task.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = task.createdAt;
    }

    for (const event of events) {
      if (event.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = event.createdAt;
    }
    for (const note of notes) {
      if (note.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = note.createdAt;
    }
    for (const booking of bookings) {
      meta.bookingCount += 1;
      if (booking.status === 'COMPLETED' && booking.startTime > recentCutoff) meta.bookingsRecent += 1;
      if (booking.status === 'PENDING' && booking.startTime < now) meta.overdueBookings += 1;
      if (booking.startTime > meta.lastInteractionAt) meta.lastInteractionAt = booking.startTime;
    }

    meta.leadScore =
      50 +
      meta.bookingsRecent * 15 +
      meta.paidInvoices * 10 -
      meta.unpaidInvoices * 5 -
      meta.overdueTasks * 5 +
      (contact.status === 'CLIENT' ? 5 : 0);

    // W7-CONTACT-MONEY-VIEWS (V55-13h; D-90 / D-63): the stored amounts on the contact row itself.
    // Review repair SEC-W7CMV-3 (V55-13i; D-90 / D-63): and the stored signals
    // read from the same invoice and quote rows, so this read agrees with
    // GET .../revenue-summary (paymentReliability null for that member).
    const servedContact: Contact = readsRevenue
      ? contact
      : {
          ...contact,
          lifetimeValue: null,
          averageSpend: null,
          paymentReliability: null,
          riskFlags: withoutRevenueSignals(contact.riskFlags, REVENUE_RISK_FLAGS),
          opportunities: withoutRevenueSignals(contact.opportunities, REVENUE_OPPORTUNITIES),
        };
    return { contact: servedContact, events, notes, tasks, invoices, bookings, meta, customFieldValues };
  }

  /**
   * The CRM segment counts. A viewer no visibility rule hides a contact from
   * (the OWNER, SUPER_ADMIN), or a call that names no viewer, gets the counts
   * of the whole business, cached for it under `${businessId}:segmentSummary`,
   * as before.
   *
   * W11-CRM-SEGMENTS-VISIBLE (F-10; owner rulings D-63, the contact rule, and
   * D-100): any other viewer gets every count over the contacts they may open
   * (resolveCrmAccess + visibilityClause, as flowHighlights and GET
   * contacts/:contactId apply it), so another member's PRIVATE contact is not
   * counted, for a member with revenue read too; the invoice and booking terms
   * are unchanged. Not cached (neither read nor written): the visibility is
   * that viewer's and is read at each request. resolveCrmAccess refuses a
   * non-member (ForbiddenException). The controller still serves unpaid 0 to a
   * member without revenue read (D-100, SEC-W8MS-3).
   */
  async segmentSummary(input: { businessId: string; viewerUserId?: string }) {
    const visibility = await this.viewerContactVisibility(input.businessId, input.viewerUserId);
    const cacheKey = `${input.businessId}:segmentSummary`;
    if (!visibility) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // W11-CRM-SEGMENTS-VISIBLE (F-10; D-63): with a visibility clause every count's where is the base AND the clause.
    const base = viewerContactWhere(input.businessId, visibility);
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 30);

    const [lead, prospect, client, lost, unpaid, stale, newThisWeek, atRisk, dormant] = await Promise.all([
      this.prisma.client.contact.count({ where: { ...base, status: 'LEAD' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'PROSPECT' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'CLIENT' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'LOST' } }),
      this.prisma.client.contact.count({
        where: { ...base, invoices: { some: { status: { in: ['SENT', 'OVERDUE'] }, deletedAt: null } } },
      }),
      this.prisma.client.contact.count({
        where: {
          ...base,
          createdAt: { lte: staleCutoff },
          bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } },
        },
      }),
      this.prisma.client.contact.count({ where: { ...base, createdAt: { gte: start } } }),
      this.prisma.client.contact.count({ where: { ...base, relationshipHealth: 'AT_RISK' } }),
      this.prisma.client.contact.count({ where: { ...base, relationshipHealth: 'DORMANT' } }),
    ]);
    const segResult = { lead, prospect, client, lost, unpaid, stale, newThisWeek, atRisk, dormant };
    // W11-CRM-SEGMENTS-VISIBLE (F-10; D-63): a viewer's counts are never written to the business cache.
    if (!visibility) await this.cache.set(cacheKey, segResult);
    return segResult;
  }

  /**
   * The CRM highlights. A viewer no visibility rule hides a contact from (the
   * OWNER, SUPER_ADMIN) with revenue read, or a call that names no viewer
   * with `readsRevenue` absent or true, gets the payload of the whole
   * business, cached for it, as before.
   *
   * W10-MONEY-SIGNALS-REST (owner rulings D-63 and D-100; review residuals
   * SEC-W9MR-1 and SEC-W9MR-2 remainder): any other viewer gets every part
   * worked out from the contacts they may open (buildHighlights), a member
   * with revenue read included, so another member's PRIVATE contact is never
   * named or counted there; W9-MONEY-RANKING (D-100): with `readsRevenue`
   * false (a member without revenue read) no money signal chooses, places or
   * crowds out an entry, and a call naming no viewer reads no contact (fails
   * closed). Not cached: the visibility is that viewer's and is read at each
   * request.
   */
  async flowHighlights(input: { businessId: string; readsRevenue?: boolean; viewerUserId?: string }): Promise<FlowHighlightsPayload> {
    const readsRevenue = input.readsRevenue !== false;
    const visibility = input.viewerUserId
      ? (visibilityClause(await resolveCrmAccess(this.prisma, input.businessId, input.viewerUserId), input.viewerUserId) as Prisma.ContactWhereInput | null)
      : null;
    if (!readsRevenue || visibility) {
      // W10-MONEY-SIGNALS-REST (D-63, D-100): worked out for this viewer, not cached; no viewer reads no contact (fails closed).
      return this.buildHighlights(input.businessId, readsRevenue, input.viewerUserId ? visibility : NO_CONTACT);
    }
    const cacheKey = `${input.businessId}:flowHighlights`;
    const cached = await this.cache.get<FlowHighlightsPayload>(cacheKey);
    if (cached) return cached;

    const flowResult = await this.buildHighlights(input.businessId, true, null);
    await this.cache.set(cacheKey, flowResult);
    return flowResult;
  }

  /**
   * The highlights of the contacts matching `scope` (null: every contact of
   * the business, the owner's payload as before).
   *
   * W10-MONEY-SIGNALS-REST (owner ruling D-63, the contact rule; review
   * residual SEC-W9MR-1): every part is read from the contacts `scope` admits,
   * the viewer's visibility clause (resolveCrmAccess + visibilityClause, the
   * rule GET contacts/:contactId applies), so another member's PRIVATE contact
   * is never a card, an overdue reminder, a next action, a segment contact or
   * count, a timeline entry or a service-affinity booking or top contact, for
   * a member with revenue read too:
   * - the 200 newest such contacts, with their stats, give highPotential,
   *   overdueReminders and nextActions;
   * - the segments count and list only such contacts (buildSegmentInsights);
   * - service affinity counts their bookings only (buildServiceAffinity);
   * - the timeline reads their rows only (CrmTimelineService.buildTimeline).
   *
   * With `readsRevenue` false (a member without revenue read; W9-MONEY-RANKING,
   * owner ruling D-100, review repairs SEC-W9MR-1 / SEC-W9MR-2) no money signal
   * chooses, places or crowds out an entry: each contact's stats are taken
   * without the invoice terms (withoutInvoiceTerms: the lead score without +10
   * a paid / -5 an unpaid invoice, the score that member's list and segment
   * rows carry; balance, unpaid count and due date 0 or null), so the
   * high-potential cards are ranked by the money-free score and no invoice
   * follow-up takes an action's place before the cap of 6; there are no
   * overdue reminders and no 'cold-with-unpaid' segment; the timeline is read
   * without money (timelineWithoutMoney). The controller then projects what
   * is left for that member (crm.controller.ts withoutHighlightsMoney).
   */
  private async buildHighlights(businessId: string, readsRevenue: boolean, scope: Prisma.ContactWhereInput | null): Promise<FlowHighlightsPayload> {
    // A related row's contact, as the viewer may open it (live and within the clause).
    const visibleContact: Prisma.ContactWhereInput | null = scope ? { deletedAt: null, AND: [scope] } : null;
    const rawContacts = await this.prisma.client.contact.findMany({
      where: scope ? { ...contactWhereBase(businessId), AND: [scope] } : contactWhereBase(businessId),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const withStats = rawContacts.length > 0
      ? await this.attachContactStats(businessId, rawContacts)
      : [];
    const contacts = readsRevenue ? withStats : withStats.map(withoutInvoiceTerms);
    const [segments, serviceAffinity, timeline] = await Promise.all([
      this.buildSegmentInsights(businessId, scope, readsRevenue),
      this.buildServiceAffinity(businessId, visibleContact),
      readsRevenue
        ? this.timeline.buildTimeline(businessId, HIGHLIGHTS_TIMELINE_ENTRIES, { contacts: visibleContact })
        : this.timelineWithoutMoney(businessId, visibleContact),
    ]);
    return {
      highlights: {
        highPotential: this.buildHighlightCards(contacts, 4, (meta) => meta.leadScore),
        overdueReminders: readsRevenue
          ? this.buildHighlightCards(
              contacts,
              4,
              (meta) => meta.outstandingBalance,
              (contact) => (contact.meta?.outstandingBalance ?? 0) > 0,
            )
          : [],
        serviceAffinity,
      },
      segments,
      timeline,
      nextActions: this.buildNextActions(contacts),
      aiNextActions: [],
    };
  }

  /**
   * W9-MONEY-RANKING review repair SEC-W9MR-2 (owner ruling D-100): the
   * timeline for a member without revenue read. CrmTimelineService.buildTimeline
   * reads it without money (no invoice; every ContactEvent the feed rule
   * withholds from that member, a sales_revenue type or data carrying an
   * amount, left out before its 10 events are taken, so they take none of the
   * places: W10-MONEY-SIGNALS-REST, SEC-W9MR-2 remainder and review repair
   * SEC-W10MSR-1, D-100, D-90) and with no cut, from the
   * rows of the contacts `contacts` admits (D-63); any entry that still
   * carries money (timelineEntryCarriesMoney) is left out, then the timeline
   * is cut to the 20 the highlights serve.
   */
  private async timelineWithoutMoney(businessId: string, contacts: Prisma.ContactWhereInput | null): Promise<TimelineEntry[]> {
    const entries = await this.timeline.buildTimeline(businessId, Number.POSITIVE_INFINITY, { contacts, withoutMoney: true });
    return entries.filter((entry) => !timelineEntryCarriesMoney(entry)).slice(0, HIGHLIGHTS_TIMELINE_ENTRIES);
  }

  /**
   * The contacts poll (GET .../contacts/poll): the newest contact edit and the
   * contact count, which the contacts list polls to refetch on a change.
   *
   * W11-CRM-SEGMENTS-VISIBLE review repair SEC-W11SV-1 (owner ruling D-133,
   * "the contacts poll"): named a viewer a visibility rule hides contacts
   * from, both are worked out over the contacts that viewer may open, so a
   * hidden contact's existence or edit time is not told; the OWNER,
   * SUPER_ADMIN and a call naming no viewer keep the business-wide figures.
   */
  async getContactsPollState(businessId: string, viewerUserId?: string) {
    const where = viewerContactWhere(businessId, await this.viewerContactVisibility(businessId, viewerUserId));
    const [result, totalCount] = await Promise.all([
      this.prisma.client.contact.aggregate({
        where,
        _max: { updatedAt: true },
      }),
      this.prisma.client.contact.count({
        where,
      }),
    ]);
    return {
      lastUpdatedAt: result._max.updatedAt?.toISOString() ?? null,
      totalCount,
    };
  }

  async toggleFavorite(businessId: string, contactId: string) {
    const contact = await this.assertContact(businessId, contactId);
    const custom = (contact.custom as Record<string, unknown>) ?? {};
    const isFavorite = !custom.isFavorite;
    const updatedCustom = { ...custom, isFavorite };
    const updated = await this.prisma.client.contact.update({
      where: { id: contactId },
      data: { custom: updatedCustom },
    });
    return { isFavorite, contact: updated };
  }

  async getFavorites(businessId: string) {
    const allContacts = await this.prisma.client.contact.findMany({
      where: contactWhereBase(businessId),
      orderBy: { updatedAt: 'desc' },
    });
    return allContacts.filter((c) => {
      const custom = c.custom as Record<string, unknown> | null;
      return custom?.isFavorite === true;
    });
  }

  private buildHighlightCards(
    contacts: ContactWithStats[],
    limit: number,
    metric: (meta: ContactMeta) => number,
    filter: (contact: ContactWithStats) => boolean = () => true,
  ): ContactHighlight[] {
    const filtered = contacts.filter((contact) => contact.meta && filter(contact));
    return filtered
      .sort((a, b) => metric(b.meta!) - metric(a.meta!))
      .slice(0, limit)
      .map((contact) => this.contactToHighlight(contact));
  }

  private contactToHighlight(contact: ContactWithStats): ContactHighlight {
    const meta = contact.meta;
    return {
      contactId: contact.id,
      name: this.formatContactName(contact),
      status: contact.status,
      leadScore: meta?.leadScore ?? 50,
      outstandingBalance: meta?.outstandingBalance ?? 0,
      unpaidInvoices: meta?.unpaidInvoices ?? 0,
      lastInteractionAt: meta?.lastInteractionAt ?? null,
      tags: contact.tags ?? [],
    };
  }

  /**
   * The highlights' segments. W10-MONEY-SIGNALS-REST (owner ruling D-63;
   * SEC-W9MR-1 residual): with a `scope` (the viewer's visibility clause) each
   * segment counts and lists only the contacts it admits; null, every contact
   * of the business, as before. Without revenue read (D-100) the
   * 'cold-with-unpaid' segment, whose members are the contacts with an unpaid
   * invoice, is not read (the controller leaves it out for that member too).
   */
  private async buildSegmentInsights(businessId: string, scope: Prisma.ContactWhereInput | null = null, readsRevenue = true): Promise<SegmentInsight[]> {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 21);

    const definitions: Array<{
      key: string;
      label: string;
      description: string;
      take?: number;
      countWhere: Prisma.ContactWhereInput;
    }> = [
      {
        key: 'new-this-week',
        label: 'New this week',
        description: 'Fresh leads created since the start of the week',
        take: 6,
        countWhere: { ...contactWhereBase(businessId), createdAt: { gte: startOfWeek } },
      },
      {
        key: 'cold-with-unpaid',
        label: 'Cold leads with unpaid invoices',
        description: 'No recent activity plus outstanding invoices',
        countWhere: {
          ...contactWhereBase(businessId),
          invoices: {
            some: {
              status: { in: ['SENT', 'OVERDUE'] as const },
              deletedAt: null,
            },
          },
          bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } },
        },
      },
      {
        key: 'top-clients',
        label: 'Top clients',
        description: 'Clients who book and pay frequently',
        countWhere: { ...contactWhereBase(businessId), status: 'CLIENT' },
      },
    ];

    const insights: SegmentInsight[] = [];
    for (const def of definitions) {
      if (!readsRevenue && def.key === 'cold-with-unpaid') continue;
      const take = def.take ?? 6;
      const where: Prisma.ContactWhereInput = scope ? { ...def.countWhere, AND: [scope] } : def.countWhere;
      const [rawContacts, count] = await Promise.all([
        this.prisma.client.contact.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.client.contact.count({ where }),
      ]);
      const contactsWithStats = rawContacts.length > 0
        ? await this.attachContactStats(businessId, rawContacts)
        : [];
      insights.push({
        key: def.key,
        label: def.label,
        description: def.description,
        count,
        contacts: contactsWithStats.slice(0, 6),
      });
    }
    return insights;
  }

  /**
   * The highlights' service affinity. W10-MONEY-SIGNALS-REST (owner ruling
   * D-63; SEC-W9MR-1 residual): with `visibleContact` (the contacts the
   * viewer may open) only their bookings are counted and only one of them is a
   * service's top contact; null, every booking of the business, as before.
   */
  private async buildServiceAffinity(businessId: string, visibleContact: Prisma.ContactWhereInput | null = null): Promise<ServiceAffinity[]> {
    const bookingWhere: Prisma.BookingWhereInput = { businessId, deletedAt: null, ...(visibleContact ? { contact: visibleContact } : {}) };
    const serviceStats = await this.prisma.client.booking.groupBy({
      by: ['serviceId'],
      where: bookingWhere,
      _count: { serviceId: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: 5,
    });
    if (serviceStats.length === 0) return [];
    const serviceIds = serviceStats.map((stat) => stat.serviceId);
    const services = await this.prisma.client.service.findMany({
      where: { id: { in: serviceIds } },
    });
    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const contactStats = await this.prisma.client.booking.groupBy({
      by: ['serviceId', 'contactId'],
      where: { ...bookingWhere, serviceId: { in: serviceIds } },
      _count: { contactId: true },
    });
    const contactIds = Array.from(new Set(contactStats.map((stat) => stat.contactId)));
    const contacts = await this.prisma.client.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));

    const affinity = serviceStats.map((stat) => {
      const service = serviceMap.get(stat.serviceId);
      if (!service) return null;
      const bestContact = contactStats
        .filter((entry) => entry.serviceId === stat.serviceId)
        .sort((a, b) => b._count.contactId - a._count.contactId)[0];
      const topContact = bestContact ? contactMap.get(bestContact.contactId) : undefined;
      const entry: ServiceAffinity = {
        serviceId: service.id,
        serviceName: service.name,
        bookings: stat._count.serviceId,
        revenue: stat._count.serviceId * service.price,
      };
      if (topContact) {
        entry.topContact = {
          id: topContact.id,
          name: this.formatContactName(topContact),
          bookings: bestContact?._count.contactId ?? 0,
        };
      }
      return entry;
    });
    return affinity.filter((entry): entry is ServiceAffinity => entry !== null);
  }

  private buildNextActions(contacts: ContactWithStats[]): NextAction[] {
    const actions: NextAction[] = [];
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 7);
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const now = new Date();
    const pushAction = (action: NextAction) => {
      if (actions.length >= 6) return;
      actions.push(action);
    };

    for (const contact of contacts) {
      if (!contact.meta) continue;
      const {
        outstandingBalance,
        lastInteractionAt,
        nextDueTaskAt,
        overdueTasks,
        overdueBookings,
        oldestUnpaidInvoiceDueAt,
      } = contact.meta;
      const contactName = this.formatContactName(contact);
      if (outstandingBalance > 0) {
        const overdue = oldestUnpaidInvoiceDueAt ? oldestUnpaidInvoiceDueAt < now : false;
        const dueLabel = oldestUnpaidInvoiceDueAt
          ? `Oldest due ${oldestUnpaidInvoiceDueAt.toLocaleDateString()}`
          : `Outstanding balance of ${outstandingBalance.toFixed(2)}`;
        pushAction({
          id: `${contact.id}-invoice`,
          contactId: contact.id,
          contactName,
          title: overdue ? 'Overdue invoice follow-up' : 'Invoice payment follow-up',
          detail: dueLabel,
          severity: overdue ? 'high' : 'medium',
          trigger: 'invoice-unpaid',
        });
      }
      if (overdueBookings > 0) {
        pushAction({
          id: `${contact.id}-booking`,
          contactId: contact.id,
          contactName,
          title: 'Confirm overdue booking',
          detail: `${overdueBookings} booking${overdueBookings > 1 ? 's' : ''} awaiting confirmation`,
          severity: 'high',
          trigger: 'booking-overdue',
        });
      }
      if (overdueTasks > 0) {
        pushAction({
          id: `${contact.id}-task-overdue`,
          contactId: contact.id,
          contactName,
          title: 'Overdue tasks',
          detail: `${overdueTasks} task${overdueTasks > 1 ? 's' : ''} overdue`,
          severity: 'medium',
          trigger: 'task-overdue',
        });
      }
      if (lastInteractionAt <= staleCutoff) {
        pushAction({
          id: `${contact.id}-stale`,
          contactId: contact.id,
          contactName,
          title: 'Re-engage stale contact',
          detail: `No interaction since ${lastInteractionAt.toLocaleDateString()}`,
          severity: 'medium',
          trigger: 'stale-contact',
        });
      }
      if (nextDueTaskAt && nextDueTaskAt <= soon) {
        pushAction({
          id: `${contact.id}-task`,
          contactId: contact.id,
          contactName,
          title: 'Task due soon',
          detail: `Next task due ${nextDueTaskAt.toLocaleDateString()}`,
          severity: 'medium',
          trigger: 'upcoming-task',
        });
      }
      if (actions.length >= 6) break;
    }

    return actions;
  }
}

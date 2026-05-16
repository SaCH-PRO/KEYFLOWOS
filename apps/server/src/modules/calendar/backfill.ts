import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CalendarEventInput,
  CalendarEventStatus,
  CalendarEventType,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CalendarProjectionService } from './calendar-projection.service';

interface BackfillOptions {
  /** Limit to a single business; otherwise every business is backfilled. */
  businessId?: string;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

interface BackfillStats {
  businessId: string;
  bookings: number;
  socialPosts: number;
  emailCampaigns: number;
  contactTasks: number;
  invoicesDue: number;
  invoicesOverdue: number;
  quotes: number;
  projects: number;
  projectTasks: number;
  marketplaceOrders: number;
  recurringInvoices: number;
  total: number;
}

const BOOKING_STATUS_MAP: Record<string, CalendarEventStatus> = {
  PENDING: 'TENTATIVE',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
};

const SOCIAL_STATUS_MAP: Record<string, CalendarEventStatus> = {
  DRAFT: 'TENTATIVE',
  SCHEDULED: 'SCHEDULED',
  POSTED: 'COMPLETED',
  FAILED: 'FAILED',
};

const CAMPAIGN_STATUS_MAP: Record<string, CalendarEventStatus> = {
  DRAFT: 'TENTATIVE',
  SCHEDULED: 'SCHEDULED',
  SENDING: 'IN_PROGRESS',
  SENT: 'COMPLETED',
  FAILED: 'FAILED',
};

const TASK_STATUS_MAP: Record<string, CalendarEventStatus> = {
  OPEN: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

function priority(value?: string | null): CalendarEventInput['priority'] {
  switch ((value ?? '').toUpperCase()) {
    case 'LOW':
      return 'LOW';
    case 'HIGH':
      return 'HIGH';
    case 'URGENT':
      return 'URGENT';
    default:
      return 'NORMAL';
  }
}

@Injectable()
export class CalendarBackfillService {
  private readonly logger = new Logger(CalendarBackfillService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
  ) {}

  async run(options: BackfillOptions = {}): Promise<BackfillStats[]> {
    const businesses = options.businessId
      ? [{ id: options.businessId }]
      : await this.prisma.client.business.findMany({
          where: { deletedAt: null },
          select: { id: true },
        });

    const stats: BackfillStats[] = [];
    for (const b of businesses) {
      const s = await this.runForBusiness(b.id, options.now ?? new Date());
      stats.push(s);
      this.logger.log(
        `Calendar backfill — business=${b.id} projected=${s.total}`,
      );
    }
    return stats;
  }

  async runForBusiness(businessId: string, now: Date = new Date()): Promise<BackfillStats> {
    const stats: BackfillStats = {
      businessId,
      bookings: 0,
      socialPosts: 0,
      emailCampaigns: 0,
      contactTasks: 0,
      invoicesDue: 0,
      invoicesOverdue: 0,
      quotes: 0,
      projects: 0,
      projectTasks: 0,
      marketplaceOrders: 0,
      recurringInvoices: 0,
      total: 0,
    };

    stats.bookings = await this.backfillBookings(businessId);
    stats.socialPosts = await this.backfillSocialPosts(businessId);
    stats.emailCampaigns = await this.backfillEmailCampaigns(businessId);
    stats.contactTasks = await this.backfillContactTasks(businessId);
    const invoices = await this.backfillInvoices(businessId, now);
    stats.invoicesDue = invoices.due;
    stats.invoicesOverdue = invoices.overdue;
    stats.quotes = await this.backfillQuotes(businessId);
    stats.projects = await this.backfillProjects(businessId);
    stats.projectTasks = await this.backfillProjectTasks(businessId);
    stats.marketplaceOrders = await this.backfillMarketplaceOrders(businessId);
    stats.recurringInvoices = await this.backfillRecurringInvoices(businessId);

    stats.total =
      stats.bookings +
      stats.socialPosts +
      stats.emailCampaigns +
      stats.contactTasks +
      stats.invoicesDue +
      stats.invoicesOverdue +
      stats.quotes +
      stats.projects +
      stats.projectTasks +
      stats.marketplaceOrders +
      stats.recurringInvoices;

    return stats;
  }

  private async backfillBookings(businessId: string): Promise<number> {
    const rows = await this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null },
      include: { contact: true, service: true },
    });
    const inputs: CalendarEventInput[] = rows.map((b) => ({
      businessId,
      type: 'BOOKING' as CalendarEventType,
      module: 'BOOKINGS',
      title: `${b.service?.name ?? 'Booking'} — ${this.contactName(b.contact) ?? 'Customer'}`,
      description: b.notes ?? null,
      startAt: b.startTime,
      endAt: b.endTime,
      timezone: null,
      status: BOOKING_STATUS_MAP[b.status] ?? 'SCHEDULED',
      sourceType: 'booking',
      sourceId: b.id,
      contactId: b.contactId,
      staffId: b.staffId ?? null,
      meta: { location: b.location ?? null, serviceId: b.serviceId },
    }));
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillSocialPosts(businessId: string): Promise<number> {
    const rows = await this.prisma.client.socialPost.findMany({
      where: { businessId, deletedAt: null, scheduledAt: { not: null } },
    });
    const inputs: CalendarEventInput[] = rows.map((p) => ({
      businessId,
      type: 'CONTENT_POST',
      module: 'MARKETING',
      title: this.preview(p.content, 80) || 'Social post',
      description: p.content,
      startAt: p.scheduledAt as Date,
      endAt: null,
      status: SOCIAL_STATUS_MAP[p.status] ?? 'SCHEDULED',
      sourceType: 'social_post',
      sourceId: p.id,
      sourceUrl: p.externalUrl ?? null,
      meta: { channelIds: p.channelIds, postedAt: p.postedAt },
    }));
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillEmailCampaigns(businessId: string): Promise<number> {
    const rows = await this.prisma.client.emailCampaign.findMany({
      where: {
        businessId,
        deletedAt: null,
        OR: [{ scheduledAt: { not: null } }, { sentAt: { not: null } }],
      },
    });
    const inputs: CalendarEventInput[] = rows.map((c) => {
      const start = (c.scheduledAt ?? c.sentAt) as Date;
      return {
        businessId,
        type: 'EMAIL_CAMPAIGN',
        module: 'MARKETING',
        title: c.name || c.subject || 'Email campaign',
        description: c.subject,
        startAt: start,
        endAt: null,
        status: CAMPAIGN_STATUS_MAP[c.status] ?? 'SCHEDULED',
        sourceType: 'email_campaign',
        sourceId: c.id,
        meta: { totalRecipients: c.totalRecipients, sentCount: c.sentCount },
      } satisfies CalendarEventInput;
    });
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillContactTasks(businessId: string): Promise<number> {
    const rows = await this.prisma.client.contactTask.findMany({
      where: { businessId, deletedAt: null, dueDate: { not: null } },
    });
    const inputs: CalendarEventInput[] = rows.map((t) => {
      const isFollowUp = (t.source ?? '').toLowerCase().includes('follow');
      return {
        businessId,
        type: isFollowUp ? 'FOLLOW_UP' : 'CONTACT_TASK',
        module: 'CRM',
        title: t.title,
        startAt: t.dueDate as Date,
        endAt: null,
        status: TASK_STATUS_MAP[t.status] ?? 'SCHEDULED',
        priority: priority(t.priority),
        sourceType: 'contact_task',
        sourceId: t.id,
        contactId: t.contactId,
        assigneeId: t.assigneeId ?? null,
        meta: { remindAt: t.remindAt, completedAt: t.completedAt },
      } satisfies CalendarEventInput;
    });
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillInvoices(
    businessId: string,
    now: Date,
  ): Promise<{ due: number; overdue: number }> {
    const rows = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, dueDate: { not: null } },
    });

    const dueInputs: CalendarEventInput[] = [];
    const overdueInputs: CalendarEventInput[] = [];

    for (const i of rows) {
      const due = i.dueDate as Date;
      const isUnpaid =
        i.status !== 'PAID' && i.status !== 'VOID' && i.paidAt === null;
      const isOverdue = isUnpaid && due.getTime() < now.getTime();

      const base: Omit<CalendarEventInput, 'type' | 'sourceType' | 'status'> = {
        businessId,
        module: 'REVENUE',
        title: `Invoice ${i.invoiceNumber} due`,
        startAt: due,
        endAt: null,
        sourceId: i.id,
        contactId: i.contactId,
        amount: i.total,
        currency: i.currency,
        meta: { status: i.status, paidAt: i.paidAt },
      };

      dueInputs.push({
        ...base,
        type: 'INVOICE_DUE',
        sourceType: 'invoice',
        status: i.status === 'PAID' ? 'COMPLETED' : 'SCHEDULED',
      });

      if (isOverdue) {
        overdueInputs.push({
          ...base,
          type: 'INVOICE_OVERDUE',
          sourceType: 'invoice_overdue',
          status: 'OVERDUE',
          priority: 'HIGH',
          title: `Invoice ${i.invoiceNumber} overdue`,
        });
      }
    }

    const due = await this.projection.upsertManyFromSource(dueInputs);
    const overdue = await this.projection.upsertManyFromSource(overdueInputs);
    return { due, overdue };
  }

  private async backfillQuotes(businessId: string): Promise<number> {
    const rows = await this.prisma.client.quote.findMany({
      where: { businessId, deletedAt: null, expiryDate: { not: null } },
    });
    const inputs: CalendarEventInput[] = rows.map((q) => ({
      businessId,
      type: 'QUOTE_EXPIRY',
      module: 'REVENUE',
      title: `Quote ${q.quoteNumber} expires`,
      startAt: q.expiryDate as Date,
      endAt: null,
      status: q.status === 'ACCEPTED' ? 'COMPLETED' : 'SCHEDULED',
      sourceType: 'quote',
      sourceId: q.id,
      contactId: q.contactId,
      amount: q.total,
      currency: q.currency,
      meta: { status: q.status },
    }));
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillProjects(businessId: string): Promise<number> {
    const rows = await this.prisma.client.project.findMany({
      where: { businessId, deletedAt: null, dueDate: { not: null } },
    });
    const inputs: CalendarEventInput[] = rows.map((p) => ({
      businessId,
      type: 'PROJECT_TASK',
      module: 'PROJECTS',
      title: `${p.name} (project due)`,
      description: p.description,
      startAt: p.dueDate as Date,
      endAt: null,
      status: p.status === 'COMPLETED' ? 'COMPLETED' : 'SCHEDULED',
      priority: priority(p.priority),
      color: p.color ?? null,
      sourceType: 'project',
      sourceId: p.id,
      contactId: p.contactId ?? null,
      meta: { status: p.status, bookingId: p.bookingId, invoiceId: p.invoiceId },
    }));
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillProjectTasks(businessId: string): Promise<number> {
    const rows = await this.prisma.client.projectTask.findMany({
      where: { businessId, deletedAt: null, dueDate: { not: null } },
    });
    const inputs: CalendarEventInput[] = rows.map((t) => ({
      businessId,
      type: 'PROJECT_TASK',
      module: 'PROJECTS',
      title: t.title,
      description: t.description,
      startAt: t.dueDate as Date,
      endAt: null,
      status: t.isCompleted ? 'COMPLETED' : 'SCHEDULED',
      priority: priority(t.priority),
      sourceType: 'project_task',
      sourceId: t.id,
      assigneeId: t.assigneeId ?? null,
      meta: { projectId: t.projectId },
    }));
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillMarketplaceOrders(businessId: string): Promise<number> {
    const rows = await this.prisma.client.marketplaceOrder.findMany({
      where: { businessId },
      include: {
        shipments: {
          select: {
            id: true,
            status: true,
            trackingNumber: true,
            carrier: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const inputs: CalendarEventInput[] = [];
    for (const o of rows) {
      // Order itself becomes a SHIPMENT-typed projection if we have an
      // expected ship/delivery hint in metadata; otherwise we skip and
      // rely on per-shipment rows below.
      const meta = (o.metadata as Record<string, unknown> | null) ?? {};
      const expected = (meta['expectedShipAt'] as string | undefined) ??
        (meta['expectedDeliveryAt'] as string | undefined);
      if (expected) {
        inputs.push({
          businessId,
          type: 'SHIPMENT',
          module: 'ORDERS',
          title: `Order ${o.orderNumber} — expected delivery`,
          startAt: new Date(expected),
          endAt: null,
          status: o.status === 'delivered' ? 'COMPLETED' : 'SCHEDULED',
          sourceType: 'marketplace_order',
          sourceId: o.id,
          amount: o.total,
          currency: o.currency,
          meta: { status: o.status, paymentStatus: o.paymentStatus },
        });
      }

      for (const s of o.shipments) {
        inputs.push({
          businessId,
          type: 'SHIPMENT',
          module: 'ORDERS',
          title: `Shipment for ${o.orderNumber}` +
            (s.trackingNumber ? ` (${s.trackingNumber})` : ''),
          startAt: s.updatedAt ?? s.createdAt,
          endAt: null,
          status: s.status === 'DELIVERED' ? 'COMPLETED' : 'SCHEDULED',
          sourceType: 'shipment',
          sourceId: s.id,
          meta: { orderId: o.id, carrier: s.carrier, status: s.status },
        });
      }
    }
    return this.projection.upsertManyFromSource(inputs);
  }

  private async backfillRecurringInvoices(businessId: string): Promise<number> {
    const rows = await this.prisma.client.recurringInvoice.findMany({
      where: { businessId, deletedAt: null, status: 'ACTIVE' },
    });
    const inputs: CalendarEventInput[] = rows.map((r) => ({
      businessId,
      type: 'RECURRING_INVOICE',
      module: 'REVENUE',
      title: `${r.name} (next ${r.frequency.toLowerCase()})`,
      startAt: r.nextRunDate,
      endAt: null,
      status: 'SCHEDULED',
      sourceType: 'recurring_invoice',
      sourceId: r.id,
      contactId: r.contactId,
      amount: r.amount,
      currency: r.currency,
      meta: { frequency: r.frequency, runCount: r.generatedCount },
    }));
    return this.projection.upsertManyFromSource(inputs);
  }

  private contactName(c: { displayName?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string | null {
    if (!c) return null;
    if (c.displayName) return c.displayName;
    const fn = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
    return fn || c.email || null;
  }

  private preview(text: string | null | undefined, max: number): string {
    if (!text) return '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  }
}

// CLI entrypoint lives in ./backfill.cli.ts so this file remains a pure
// Nest module without side effects when imported from AppModule.

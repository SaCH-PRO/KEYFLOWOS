import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type TimeCostRefType = 'INVOICE' | 'QUOTE' | 'BOOKING' | 'PROJECT' | 'ORDER';

const ALLOWED_REFS: TimeCostRefType[] = ['INVOICE', 'QUOTE', 'BOOKING', 'PROJECT', 'ORDER'];

export interface CreateTimeCostInput {
  businessId: string;
  refType: TimeCostRefType;
  refId: string;
  minutes: number;
  contactId?: string | null;
  staffId?: string | null;
  userId?: string | null;
  costRate?: number | null;
  currency?: string;
  notes?: string | null;
  source?: string;
  occurredAt?: Date;
}

export interface UpdateTimeCostInput {
  minutes?: number;
  contactId?: string | null;
  staffId?: string | null;
  costRate?: number | null;
  currency?: string;
  notes?: string | null;
  occurredAt?: Date;
}

/**
 * R5: Time-cost ledger service.
 *
 * Single owner of `time_cost_entries` writes/reads. Holds the small bit of
 * domain logic that translates `minutes + costRate` into a `costAmount`
 * (truncated to 2 decimals) so every read site sees the same number.
 *
 * Polymorphic via (refType, refId) — caller is responsible for confirming the
 * referenced row belongs to `businessId` before logging time. We do a
 * defensive existence check inside `create()` for the supported types so we
 * never end up with orphan ledger rows.
 */
@Injectable()
export class TimeCostService {
  private readonly logger = new Logger(TimeCostService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  private toCostAmount(minutes: number, costRate: number | null | undefined): number | null {
    if (costRate === null || costRate === undefined || !Number.isFinite(costRate)) return null;
    return Math.round((minutes / 60) * costRate * 100) / 100;
  }

  private async assertRef(businessId: string, refType: TimeCostRefType, refId: string): Promise<void> {
    let exists = false;
    switch (refType) {
      case 'INVOICE':
        exists = !!(await this.db.invoice.findFirst({ where: { id: refId, businessId, deletedAt: null }, select: { id: true } }));
        break;
      case 'QUOTE':
        exists = !!(await this.db.quote.findFirst({ where: { id: refId, businessId, deletedAt: null }, select: { id: true } }));
        break;
      case 'BOOKING':
        exists = !!(await this.db.booking.findFirst({ where: { id: refId, businessId, deletedAt: null }, select: { id: true } }));
        break;
      case 'PROJECT':
        exists = !!(await this.db.project.findFirst({ where: { id: refId, businessId, deletedAt: null }, select: { id: true } }));
        break;
      case 'ORDER':
        exists = !!(await this.db.marketplaceOrder.findFirst({ where: { id: refId, businessId }, select: { id: true } }));
        break;
    }
    if (!exists) {
      throw new NotFoundException(`Referenced ${refType.toLowerCase()} ${refId} not found`);
    }
  }

  async create(input: CreateTimeCostInput) {
    if (!ALLOWED_REFS.includes(input.refType)) {
      throw new BadRequestException(`Unsupported refType: ${input.refType}`);
    }
    if (!Number.isFinite(input.minutes) || input.minutes <= 0) {
      throw new BadRequestException('minutes must be a positive number');
    }
    await this.assertRef(input.businessId, input.refType, input.refId);

    // Inherit contactId from the referenced row when caller didn't supply one
    // — most time entries are billable against a contact and we want the
    // contact rollup to work without forcing the UI to pass it explicitly.
    let contactId = input.contactId ?? null;
    if (!contactId) {
      contactId = await this.inferContactId(input.businessId, input.refType, input.refId);
    }

    return this.db.timeCostEntry.create({
      data: {
        businessId: input.businessId,
        refType: input.refType,
        refId: input.refId,
        contactId,
        staffId: input.staffId ?? null,
        userId: input.userId ?? null,
        minutes: Math.round(input.minutes),
        costRate: input.costRate ?? null,
        costAmount: this.toCostAmount(input.minutes, input.costRate),
        currency: input.currency ?? 'TTD',
        notes: input.notes ?? null,
        source: input.source ?? 'manual',
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  }

  async update(businessId: string, id: string, patch: UpdateTimeCostInput) {
    const existing = await this.db.timeCostEntry.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Time entry not found');
    const minutes = patch.minutes !== undefined ? Math.round(patch.minutes) : existing.minutes;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new BadRequestException('minutes must be a positive number');
    }
    const costRate = patch.costRate === undefined ? existing.costRate : patch.costRate;
    return this.db.timeCostEntry.update({
      where: { id },
      data: {
        minutes,
        contactId: patch.contactId === undefined ? undefined : patch.contactId,
        staffId: patch.staffId === undefined ? undefined : patch.staffId,
        costRate: costRate ?? null,
        costAmount: this.toCostAmount(minutes, costRate),
        currency: patch.currency ?? undefined,
        notes: patch.notes === undefined ? undefined : patch.notes,
        occurredAt: patch.occurredAt ?? undefined,
      },
    });
  }

  async remove(businessId: string, id: string) {
    const existing = await this.db.timeCostEntry.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Time entry not found');
    await this.db.timeCostEntry.delete({ where: { id } });
    return { id };
  }

  async listForRef(businessId: string, refType: TimeCostRefType, refId: string) {
    if (!ALLOWED_REFS.includes(refType)) {
      throw new BadRequestException(`Unsupported refType: ${refType}`);
    }
    const rows = await this.db.timeCostEntry.findMany({
      where: { businessId, refType, refId },
      orderBy: { occurredAt: 'desc' },
    });
    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const totalCost = rows.reduce((s, r) => s + (r.costAmount ?? 0), 0);
    return {
      entries: rows,
      summary: {
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        entryCount: rows.length,
      },
    };
  }

  /**
   * Per-contact rollup: total minutes / cost spent on this contact in the
   * trailing 30 days (window aligns with the contact-card chip semantics),
   * plus a revenue-per-hour ratio over the same window when we have any
   * paid invoice revenue.
   */
  async getContactTimeRollup(
    businessId: string,
    contactId: string,
    opts: { windowDays?: number } = {},
  ) {
    const windowDays = opts.windowDays ?? 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Use server-side aggregation so totals aren't truncated by an arbitrary
    // page size — the previous `take: 200` could under-count for high-volume
    // contacts and produce a misleading revenue/hour ratio.
    const [agg, latest, paidInvoices] = await Promise.all([
      this.db.timeCostEntry.aggregate({
        where: { businessId, contactId, occurredAt: { gte: since } },
        _sum: { minutes: true, costAmount: true },
        _count: { _all: true },
      }),
      this.db.timeCostEntry.findFirst({
        where: { businessId, contactId, occurredAt: { gte: since } },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true, currency: true },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          contactId,
          status: 'PAID',
          deletedAt: null,
          paidAt: { gte: since },
        },
        select: { total: true, currency: true },
      }),
    ]);

    const totalMinutes = agg._sum.minutes ?? 0;
    const totalCost = (agg._sum.costAmount as unknown as number) ?? 0;
    const totalHours = totalMinutes / 60;
    const windowRevenue = paidInvoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
    const currency = latest?.currency ?? paidInvoices[0]?.currency ?? 'TTD';
    const revenuePerHour =
      totalHours > 0 ? Math.round((windowRevenue / totalHours) * 100) / 100 : null;

    return {
      contactId,
      windowDays,
      currency,
      totalMinutes,
      totalHours: Math.round(totalHours * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      entryCount: agg._count._all,
      windowRevenue,
      revenuePerHour,
      grossProfit: Math.round((windowRevenue - totalCost) * 100) / 100,
      lastLoggedAt: latest?.occurredAt?.toISOString() ?? null,
    };
  }

  /**
   * Business-wide rollups for the leverage dashboards. Buckets by ref type
   * so callers can answer "how many hours went to projects vs bookings vs
   * invoiced work?" in one round trip.
   */
  async getBusinessTimeRollup(
    businessId: string,
    opts: { from?: Date; to?: Date } = {},
  ) {
    const where = {
      businessId,
      ...(opts.from || opts.to
        ? { occurredAt: { gte: opts.from ?? undefined, lte: opts.to ?? undefined } }
        : {}),
    };
    const [byRefType, byStaff] = await Promise.all([
      this.db.timeCostEntry.groupBy({
        by: ['refType'],
        where,
        _sum: { minutes: true, costAmount: true },
        _count: { _all: true },
      }),
      this.db.timeCostEntry.groupBy({
        by: ['staffId'],
        where,
        _sum: { minutes: true, costAmount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      byRefType: byRefType.map((r) => ({
        refType: r.refType,
        minutes: r._sum.minutes ?? 0,
        cost: Math.round(((r._sum.costAmount as unknown as number) ?? 0) * 100) / 100,
        entries: r._count._all,
      })),
      byStaff: byStaff
        .filter((r) => r.staffId)
        .map((r) => ({
          staffId: r.staffId,
          minutes: r._sum.minutes ?? 0,
          cost: Math.round(((r._sum.costAmount as unknown as number) ?? 0) * 100) / 100,
          entries: r._count._all,
        })),
    };
  }

  private async inferContactId(
    businessId: string,
    refType: TimeCostRefType,
    refId: string,
  ): Promise<string | null> {
    try {
      switch (refType) {
        case 'INVOICE': {
          const r = await this.db.invoice.findFirst({ where: { id: refId, businessId }, select: { contactId: true } });
          return r?.contactId ?? null;
        }
        case 'QUOTE': {
          const r = await this.db.quote.findFirst({ where: { id: refId, businessId }, select: { contactId: true } });
          return r?.contactId ?? null;
        }
        case 'BOOKING': {
          const r = await this.db.booking.findFirst({ where: { id: refId, businessId }, select: { contactId: true } });
          return r?.contactId ?? null;
        }
        case 'PROJECT': {
          const r = await this.db.project.findFirst({ where: { id: refId, businessId }, select: { contactId: true } });
          return r?.contactId ?? null;
        }
        case 'ORDER': {
          // MarketplaceOrder is keyed by customer email rather than a CRM
          // Contact id; resolve by email when possible so the rollup still
          // attaches to the right contact card.
          const r = await this.db.marketplaceOrder.findFirst({ where: { id: refId, businessId }, select: { customerEmail: true } });
          if (!r?.customerEmail) return null;
          const c = await this.db.contact.findFirst({
            where: { businessId, email: r.customerEmail, deletedAt: null },
            select: { id: true },
          });
          return c?.id ?? null;
        }
      }
    } catch (err) {
      this.logger.warn(`inferContactId failed for ${refType}:${refId}: ${(err as Error).message}`);
      return null;
    }
  }
}

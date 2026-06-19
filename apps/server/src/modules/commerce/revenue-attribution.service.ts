import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export type RevenueType = 'ORDER' | 'INVOICE' | 'BOOKING';
export type RevenueSource =
  | 'storefront'
  | 'quote'
  | 'recurring'
  | 'manual'
  | 'community'
  | 'other';

export interface RecordRevenueInput {
  businessId: string;
  source: RevenueSource;
  sourceDetail?: string | null;
  revenueType: RevenueType;
  revenueId: string;
  amount: number;
  currency?: string;
  contactId?: string | null;
  referralCode?: string | null;
  visitorId?: string | null;
  occurredAt?: Date;
  campaignId?: string | null;
  staffId?: string | null;
  attributionPercent?: number | null;
}

export interface UpdateRevenueAttributionInput {
  source?: RevenueSource | string;
  sourceDetail?: string | null;
  contactId?: string | null;
  referralCode?: string | null;
  campaignId?: string | null;
  staffId?: string | null;
  attributionPercent?: number;
  editedBy?: string | null;
}

/**
 * Single owner of `revenue_attributions` rows. Every storefront-originated
 * revenue event (order paid, deposit invoice paid, booking confirmed/completed)
 * MUST flow through here so GrowthStack/ProfitLens can answer
 * "where did this revenue come from?" without re-deriving it from scratch.
 *
 * The (businessId, revenueType, revenueId) tuple is unique — re-recording the
 * same revenue event is a no-op (upsert). This makes the call-sites idempotent
 * and safe to wire into transactional flows.
 *
 * Referral resolution: when a `referralCode` is provided we attempt to map it
 * to a Contact via Contact.customFields.referralCode. Failures are swallowed
 * and the row is still written without the referral link, because attribution
 * must never break a paying flow.
 */
@Injectable()
export class RevenueAttributionService {
  private readonly logger = new Logger(RevenueAttributionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async record(
    input: RecordRevenueInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ? (tx as any) : (this.prisma.client as any);
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return;
    }

    // Referral lookup failures are tolerated — a missing referral contact
    // never blocks attribution. The attribution row write itself is a hard
    // requirement and propagates failures to the caller (so transactional
    // checkout/booking flows roll back if attribution can't be recorded).
    let referralContactId: string | null = null;
    if (input.referralCode) {
      try {
        referralContactId = await this.resolveReferralContact(
          input.businessId,
          input.referralCode,
          db,
        );
      } catch (err) {
        this.logger.warn(
          `[revenue-attribution] referral lookup failed code=${input.referralCode}: ${(err as Error).message}`,
        );
      }
    }

    const occurredAt = input.occurredAt ?? new Date();

    await db.revenueAttribution.upsert({
      where: {
        businessId_revenueType_revenueId: {
          businessId: input.businessId,
          revenueType: input.revenueType,
          revenueId: input.revenueId,
        },
      },
      create: {
        businessId: input.businessId,
        source: input.source,
        sourceDetail: input.sourceDetail ?? null,
        revenueType: input.revenueType,
        revenueId: input.revenueId,
        contactId: input.contactId ?? null,
        referralContactId,
        referralCode: input.referralCode ?? null,
        visitorId: input.visitorId ?? null,
        campaignId: input.campaignId ?? null,
        staffId: input.staffId ?? null,
        attributionPercent: input.attributionPercent ?? 100,
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        occurredAt,
      },
      update: {
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        contactId: input.contactId ?? undefined,
        referralContactId: referralContactId ?? undefined,
        referralCode: input.referralCode ?? undefined,
        visitorId: input.visitorId ?? undefined,
        // Only seed campaign/staff/percent on initial record. Manual edits via
        // `update()` are preserved across re-records.
        occurredAt,
      },
    });
  }

  /**
   * Manual edit of an attribution row. Used by the invoice/order detail UI
   * when the operator wants to override the auto-attributed source/staff/
   * campaign/percent. Stamps `editedAt` + `editedBy` for audit.
   */
  async update(
    businessId: string,
    revenueType: RevenueType,
    revenueId: string,
    patch: UpdateRevenueAttributionInput,
  ) {
    const existing = await this.prisma.client.revenueAttribution.findUnique({
      where: {
        businessId_revenueType_revenueId: { businessId, revenueType, revenueId },
      },
    });
    if (!existing) {
      // No row yet — synthesize one from the underlying revenue artifact so
      // the operator can override attribution before a payment ever lands.
      // We pull amount/contact/currency from the artifact itself.
      const seed = await this.deriveSeedFromArtifact(businessId, revenueType, revenueId);
      if (!seed) return null;
      await this.record({
        businessId,
        revenueType,
        revenueId,
        amount: seed.amount,
        currency: seed.currency,
        contactId: seed.contactId,
        source: (patch.source as RevenueSource) ?? 'manual',
        sourceDetail: patch.sourceDetail ?? null,
        campaignId: patch.campaignId ?? null,
        staffId: patch.staffId ?? null,
        attributionPercent: patch.attributionPercent ?? 100,
        referralCode: patch.referralCode ?? null,
        occurredAt: seed.occurredAt,
      });
      return this.findOne(businessId, revenueType, revenueId);
    }

    let attributionPercent = patch.attributionPercent;
    if (typeof attributionPercent === 'number') {
      attributionPercent = Math.max(0, Math.min(100, attributionPercent));
    }

    return this.prisma.client.revenueAttribution.update({
      where: { id: existing.id },
      data: {
        source: patch.source ?? undefined,
        sourceDetail: patch.sourceDetail === undefined ? undefined : patch.sourceDetail,
        contactId: patch.contactId === undefined ? undefined : patch.contactId,
        referralCode: patch.referralCode === undefined ? undefined : patch.referralCode,
        campaignId: patch.campaignId === undefined ? undefined : patch.campaignId,
        staffId: patch.staffId === undefined ? undefined : patch.staffId,
        attributionPercent: attributionPercent ?? undefined,
        editedAt: new Date(),
        editedBy: patch.editedBy ?? null,
      },
    });
  }

  /**
   * Look up the underlying revenue artifact (invoice / booking / order) so
   * we can synthesize an attribution row when the operator wants to edit one
   * before a payment lands.
   */
  private async deriveSeedFromArtifact(
    businessId: string,
    revenueType: RevenueType,
    revenueId: string,
  ): Promise<{ amount: number; currency: string; contactId: string | null; occurredAt: Date } | null> {
    if (revenueType === 'INVOICE') {
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id: revenueId, businessId, deletedAt: null },
        select: { total: true, currency: true, contactId: true, paidAt: true, issueDate: true, createdAt: true },
      });
      if (!inv) return null;
      return {
        amount: Math.max(0.01, Number(inv.total ?? 0)),
        currency: inv.currency ?? 'TTD',
        contactId: inv.contactId ?? null,
        occurredAt: inv.paidAt ?? inv.issueDate ?? inv.createdAt,
      };
    }
    if (revenueType === 'BOOKING') {
      const b = await this.prisma.client.booking.findFirst({
        where: { id: revenueId, businessId, deletedAt: null },
        select: { contactId: true, startTime: true, createdAt: true, invoice: { select: { total: true, currency: true } } },
      });
      if (!b) return null;
      return {
        amount: Math.max(0.01, Number(b.invoice?.total ?? 0)),
        currency: b.invoice?.currency ?? 'TTD',
        contactId: b.contactId ?? null,
        occurredAt: b.startTime ?? b.createdAt,
      };
    }
    if (revenueType === 'ORDER') {
      const o = await this.prisma.client.marketplaceOrder.findFirst({
        where: { id: revenueId, businessId },
        select: { total: true, currency: true, createdAt: true },
      });
      if (!o) return null;
      return {
        amount: Math.max(0.01, Number(o.total ?? 0)),
        currency: o.currency ?? 'TTD',
        contactId: null,
        occurredAt: o.createdAt,
      };
    }
    return null;
  }

  async findOne(businessId: string, revenueType: RevenueType, revenueId: string) {
    return this.prisma.client.revenueAttribution.findUnique({
      where: {
        businessId_revenueType_revenueId: { businessId, revenueType, revenueId },
      },
    });
  }

  private async resolveReferralContact(
    businessId: string,
    referralCode: string,
    db: Prisma.TransactionClient,
  ): Promise<string | null> {
    // CRM stores referral code in Contact.custom JSON. We use a JSON
    // path predicate so we don't have to scan + decode every contact in JS.
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM contacts
      WHERE business_id = ${businessId}
        AND deleted_at IS NULL
        AND custom ->> 'referralCode' = ${referralCode}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  /**
   * Roll up revenue by source for a business over a time window. Used by
   * GrowthStack dashboards.
   */
  async summarizeBySource(
    businessId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ source: string; amount: number; count: number }>> {
    const rows = await this.prisma.client.revenueAttribution.groupBy({
      by: ['source'],
      where: {
        businessId,
        occurredAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      source: r.source,
      amount: Number(r._sum.amount ?? 0),
      count: r._count._all,
    }));
  }
}

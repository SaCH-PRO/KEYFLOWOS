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
    const db = (tx ?? this.prisma.client) as Prisma.TransactionClient;
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
        occurredAt,
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

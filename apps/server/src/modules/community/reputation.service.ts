import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ReputationSnapshot {
  averageRating: number;
  totalReviews: number;
  totalCompleted: number;
  completedQuotes: number;
  completedCollabs: number;
  completedReferrals: number;
  onTimeRate: number;
  responseTimeHours: number | null;
  repeatClientRate: number;
  referralsSent: number;
  referralsConverted: number;
  referralsReceived: number;
  referralsAccepted: number;
  reputationScore: number;
  isVerified: boolean;
  verifiedAt: Date | null;
  lastCalculatedAt: Date | null;
}

const VERIFY_MIN_COMPLETENESS = 80;
const VERIFY_MIN_COMPLETED = 3;
const VERIFY_MIN_RATING = 4.0;
const VERIFY_MIN_ACCOUNT_AGE_DAYS = 30;

@Injectable()
export class ReputationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async getOrCompute(businessId: string): Promise<ReputationSnapshot> {
    const existing = await this.prisma.client.businessReputation.findUnique({
      where: { businessId },
    });
    if (existing && existing.lastCalculatedAt) {
      const ageMs = Date.now() - existing.lastCalculatedAt.getTime();
      if (ageMs < 60 * 60 * 1000) return this.toSnapshot(existing);
    }
    return this.recalculate(businessId);
  }

  async getSnapshotCached(businessId: string): Promise<ReputationSnapshot | null> {
    const existing = await this.prisma.client.businessReputation.findUnique({
      where: { businessId },
    });
    return existing ? this.toSnapshot(existing) : null;
  }

  async recalculate(businessId: string): Promise<ReputationSnapshot> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, profileCompleteness: true, createdAt: true },
    });
    if (!business) throw new Error('Business not found');

    const [reviewAgg, quotes, collabs, referralsTo, referralsFrom, activePartnerCount] = await Promise.all([
      this.prisma.client.communityReview.aggregate({
        where: { revieweeBusinessId: businessId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.client.communityQuoteRequest.findMany({
        where: { toBusinessId: businessId },
        select: {
          id: true,
          fromBusinessId: true,
          status: true,
          createdAt: true,
          respondedAt: true,
        },
      }),
      this.prisma.client.communityCollaboration.findMany({
        where: {
          OR: [
            { toBusinessId: businessId },
            { fromBusinessId: businessId },
          ],
        },
        select: {
          id: true,
          fromBusinessId: true,
          toBusinessId: true,
          status: true,
          createdAt: true,
          respondedAt: true,
        },
      }),
      this.prisma.client.communityReferral.findMany({
        where: { toBusinessId: businessId },
        select: { id: true, status: true, createdAt: true },
      }),
      this.prisma.client.communityReferral.findMany({
        where: { fromBusinessId: businessId },
        select: { id: true, status: true, createdAt: true },
      }),
      this.prisma.client.partnerProgram.count({
        where: {
          status: 'ACTIVE',
          OR: [
            { initiatorBusinessId: businessId },
            { partnerBusinessId: businessId },
          ],
        },
      }),
    ]);

    const totalReviews = reviewAgg._count._all ?? 0;
    const averageRating = reviewAgg._avg.rating ? Number(reviewAgg._avg.rating.toFixed(2)) : 0;

    const completedQuotes = quotes.filter((q) => q.status === 'RESPONDED' || q.status === 'ACCEPTED').length;
    const completedCollabs = collabs.filter((c) => c.status === 'COMPLETED').length;
    const completedReferrals = referralsTo.filter((r) => r.status === 'COMPLETED').length;
    const totalCompleted = completedQuotes + completedCollabs + completedReferrals;

    const totalQuotesReceived = quotes.length;
    const respondedQuotes = quotes.filter((q) => ['RESPONDED', 'ACCEPTED', 'DECLINED'].includes(q.status)).length;
    const onTimeRate = totalQuotesReceived > 0 ? respondedQuotes / totalQuotesReceived : 0;

    const respTimes = quotes
      .filter((q) => q.respondedAt)
      .map((q) => (q.respondedAt!.getTime() - q.createdAt.getTime()) / (1000 * 60 * 60));
    const responseTimeHours = respTimes.length > 0
      ? Number((respTimes.reduce((a, b) => a + b, 0) / respTimes.length).toFixed(2))
      : null;

    const completedQuotePartners = quotes
      .filter((q) => q.status === 'RESPONDED' || q.status === 'ACCEPTED')
      .map((q) => q.fromBusinessId);
    const partnerCounts = new Map<string, number>();
    for (const id of completedQuotePartners) {
      partnerCounts.set(id, (partnerCounts.get(id) ?? 0) + 1);
    }
    const repeatClientCount = Array.from(partnerCounts.values()).filter((n) => n > 1).reduce((a, b) => a + b, 0);
    const repeatClientRate = completedQuotePartners.length > 0
      ? repeatClientCount / completedQuotePartners.length
      : 0;

    const referralsSent = referralsFrom.length;
    const referralsConverted = referralsFrom.filter((r) => r.status === 'COMPLETED').length;
    const referralsReceived = referralsTo.length;
    const referralsAccepted = referralsTo.filter((r) => ['ACCEPTED', 'COMPLETED'].includes(r.status)).length;
    const referralConvRate = referralsSent > 0 ? referralsConverted / referralsSent : 0;

    const ratingScore = averageRating * 8;
    const completedScore = Math.min(totalCompleted, 20) * 1;
    const onTimeScore = onTimeRate * 15;
    const repeatScore = repeatClientRate * 10;
    const referralScore = referralConvRate * 15;
    const partnerScore = Math.min(activePartnerCount as number, 5) * 2;
    const reputationScore = Math.min(
      Math.round(ratingScore + completedScore + onTimeScore + repeatScore + referralScore + partnerScore),
      100,
    );

    const accountAgeDays = (Date.now() - business.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const qualifies =
      business.profileCompleteness >= VERIFY_MIN_COMPLETENESS &&
      totalCompleted >= VERIFY_MIN_COMPLETED &&
      averageRating >= VERIFY_MIN_RATING &&
      accountAgeDays >= VERIFY_MIN_ACCOUNT_AGE_DAYS;

    const existing = await this.prisma.client.businessReputation.findUnique({
      where: { businessId },
    });
    const wasVerified = existing?.isVerified ?? false;
    const verifiedAt = qualifies
      ? (existing?.verifiedAt ?? new Date())
      : null;

    const data = {
      averageRating,
      totalReviews,
      totalCompleted,
      completedQuotes,
      completedCollabs,
      completedReferrals,
      onTimeRate: Number(onTimeRate.toFixed(3)),
      responseTimeHours,
      repeatClientRate: Number(repeatClientRate.toFixed(3)),
      referralsSent,
      referralsConverted,
      referralsReceived,
      referralsAccepted,
      reputationScore,
      isVerified: qualifies,
      verifiedAt,
      lastCalculatedAt: new Date(),
    };

    const saved = await this.prisma.client.businessReputation.upsert({
      where: { businessId },
      create: { ...data, businessId },
      update: data,
    });

    if (qualifies && !wasVerified) {
      await this.notifications.create({
        businessId,
        type: 'community_verified',
        title: "You're now a Verified Provider",
        body: 'Your business has met the standards for verification on the community marketplace.',
        data: { reputationScore },
      });
    }

    return this.toSnapshot(saved);
  }

  async listReviewsForBusiness(businessId: string, limit = 20) {
    return this.prisma.client.communityReview.findMany({
      where: { revieweeBusinessId: businessId, isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        reviewer: { select: { id: true, name: true, logoUrl: true, headline: true, industry: true } },
      },
    });
  }

  async listReviewsByBusiness(businessId: string, limit = 20) {
    return this.prisma.client.communityReview.findMany({
      where: { reviewerBusinessId: businessId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        reviewee: { select: { id: true, name: true, logoUrl: true, headline: true, industry: true } },
      },
    });
  }

  async getReviewableTransactions(businessId: string, otherBusinessId: string) {
    const [quotes, collabs, referrals, existingReviews] = await Promise.all([
      this.prisma.client.communityQuoteRequest.findMany({
        where: {
          fromBusinessId: businessId,
          toBusinessId: otherBusinessId,
          status: { in: ['RESPONDED', 'ACCEPTED'] },
        },
        select: { id: true, title: true, status: true, createdAt: true },
      }),
      this.prisma.client.communityCollaboration.findMany({
        where: {
          OR: [
            { fromBusinessId: businessId, toBusinessId: otherBusinessId },
            { fromBusinessId: otherBusinessId, toBusinessId: businessId },
          ],
          status: 'COMPLETED',
        },
        select: { id: true, title: true, status: true, createdAt: true },
      }),
      this.prisma.client.communityReferral.findMany({
        where: {
          fromBusinessId: businessId,
          toBusinessId: otherBusinessId,
          status: { in: ['ACCEPTED', 'COMPLETED'] },
        },
        select: { id: true, opportunity: true, status: true, createdAt: true },
      }),
      this.prisma.client.communityReview.findMany({
        where: { reviewerBusinessId: businessId, revieweeBusinessId: otherBusinessId },
        select: { transactionType: true, transactionId: true },
      }),
    ]);

    const reviewedKey = new Set(existingReviews.map((r) => `${r.transactionType}:${r.transactionId}`));

    return [
      ...quotes
        .filter((q) => !reviewedKey.has(`QUOTE_REQUEST:${q.id}`))
        .map((q) => ({ id: q.id, type: 'QUOTE_REQUEST' as const, title: q.title, status: q.status, createdAt: q.createdAt })),
      ...collabs
        .filter((c) => !reviewedKey.has(`COLLABORATION:${c.id}`))
        .map((c) => ({ id: c.id, type: 'COLLABORATION' as const, title: c.title, status: c.status, createdAt: c.createdAt })),
      ...referrals
        .filter((r) => !reviewedKey.has(`REFERRAL:${r.id}`))
        .map((r) => ({ id: r.id, type: 'REFERRAL' as const, title: r.opportunity, status: r.status, createdAt: r.createdAt })),
    ];
  }

  async createReview(reviewerBusinessId: string, input: {
    revieweeBusinessId: string;
    transactionType: 'QUOTE_REQUEST' | 'COLLABORATION' | 'REFERRAL';
    transactionId: string;
    rating: number;
    title?: string;
    body?: string;
    qualityRating?: number;
    communicationRating?: number;
    timelinessRating?: number;
    isPublic?: boolean;
  }) {
    if (reviewerBusinessId === input.revieweeBusinessId) {
      throw new Error('You cannot review yourself');
    }
    if (input.rating < 1 || input.rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const ok = await this.assertEligible(reviewerBusinessId, input.revieweeBusinessId, input.transactionType, input.transactionId);
    if (!ok) throw new Error('This transaction is not eligible for review');

    const review = await this.prisma.client.communityReview.create({
      data: {
        reviewerBusinessId,
        revieweeBusinessId: input.revieweeBusinessId,
        transactionType: input.transactionType,
        transactionId: input.transactionId,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body ?? null,
        qualityRating: input.qualityRating ?? null,
        communicationRating: input.communicationRating ?? null,
        timelinessRating: input.timelinessRating ?? null,
        isPublic: input.isPublic ?? true,
      },
      include: {
        reviewer: { select: { id: true, name: true, logoUrl: true, headline: true, industry: true } },
        reviewee: { select: { id: true, name: true } },
      },
    });

    await this.recalculate(input.revieweeBusinessId);

    await this.notifications.create({
      businessId: input.revieweeBusinessId,
      type: 'community_review',
      title: `New ${input.rating}-star review`,
      body: `${review.reviewer.name} left you a review${input.title ? `: "${input.title}"` : ''}`,
      data: { reviewId: review.id, fromBusinessId: reviewerBusinessId, rating: input.rating },
    });

    return review;
  }

  async deleteReview(reviewerBusinessId: string, reviewId: string) {
    const review = await this.prisma.client.communityReview.findFirst({
      where: { id: reviewId, reviewerBusinessId },
    });
    if (!review) throw new Error('Review not found');
    await this.prisma.client.communityReview.delete({ where: { id: reviewId } });
    await this.recalculate(review.revieweeBusinessId);
    return { ok: true };
  }

  async markReferralOutcome(businessId: string, referralId: string, outcome: 'CONVERTED' | 'NOT_CONVERTED', note?: string) {
    const referral = await this.prisma.client.communityReferral.findFirst({
      where: { id: referralId, toBusinessId: businessId },
    });
    if (!referral) throw new Error('Referral not found');

    const status = outcome === 'CONVERTED' ? 'COMPLETED' : 'DECLINED';
    const updated = await this.prisma.client.communityReferral.update({
      where: { id: referralId },
      data: { status, statusNote: note ?? referral.statusNote },
      include: {
        fromBusiness: { select: { id: true, name: true } },
        toBusiness: { select: { id: true, name: true } },
      },
    });

    await Promise.all([
      this.recalculate(updated.fromBusinessId),
      this.recalculate(updated.toBusinessId),
    ]);

    await this.notifications.create({
      businessId: updated.fromBusinessId,
      type: 'community_referral_outcome',
      title: outcome === 'CONVERTED' ? 'Your referral converted' : 'Referral did not convert',
      body: `${updated.toBusiness.name} marked your referral for "${updated.opportunity}" as ${outcome.toLowerCase().replace('_', ' ')}.`,
      data: { referralId, outcome },
    });

    return updated;
  }

  private async assertEligible(reviewerId: string, revieweeId: string, type: string, transactionId: string): Promise<boolean> {
    if (type === 'QUOTE_REQUEST') {
      const tx = await this.prisma.client.communityQuoteRequest.findFirst({
        where: {
          id: transactionId,
          fromBusinessId: reviewerId,
          toBusinessId: revieweeId,
          status: { in: ['RESPONDED', 'ACCEPTED'] },
        },
        select: { id: true },
      });
      return !!tx;
    }
    if (type === 'COLLABORATION') {
      const tx = await this.prisma.client.communityCollaboration.findFirst({
        where: {
          id: transactionId,
          OR: [
            { fromBusinessId: reviewerId, toBusinessId: revieweeId },
            { fromBusinessId: revieweeId, toBusinessId: reviewerId },
          ],
          status: 'COMPLETED',
        },
        select: { id: true },
      });
      return !!tx;
    }
    if (type === 'REFERRAL') {
      const tx = await this.prisma.client.communityReferral.findFirst({
        where: {
          id: transactionId,
          fromBusinessId: reviewerId,
          toBusinessId: revieweeId,
          status: { in: ['ACCEPTED', 'COMPLETED'] },
        },
        select: { id: true },
      });
      return !!tx;
    }
    return false;
  }

  private toSnapshot(row: any): ReputationSnapshot {
    return {
      averageRating: row.averageRating,
      totalReviews: row.totalReviews,
      totalCompleted: row.totalCompleted,
      completedQuotes: row.completedQuotes,
      completedCollabs: row.completedCollabs,
      completedReferrals: row.completedReferrals,
      onTimeRate: row.onTimeRate,
      responseTimeHours: row.responseTimeHours,
      repeatClientRate: row.repeatClientRate,
      referralsSent: row.referralsSent,
      referralsConverted: row.referralsConverted,
      referralsReceived: row.referralsReceived,
      referralsAccepted: row.referralsAccepted,
      reputationScore: row.reputationScore,
      isVerified: row.isVerified,
      verifiedAt: row.verifiedAt,
      lastCalculatedAt: row.lastCalculatedAt,
    };
  }
}

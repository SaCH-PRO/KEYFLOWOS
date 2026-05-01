import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const businessSelect = {
  id: true, name: true, logoUrl: true, headline: true, industry: true, slug: true,
};

@Injectable()
export class NetworkAnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordProfileView(viewedBusinessId: string, viewerBusinessId: string | null, source?: string) {
    if (viewerBusinessId && viewerBusinessId === viewedBusinessId) return null;

    if (viewerBusinessId) {
      const recent = await this.prisma.client.profileView.findFirst({
        where: {
          viewerBusinessId,
          viewedBusinessId,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) return recent;
    }

    return this.prisma.client.profileView.create({
      data: {
        viewerBusinessId: viewerBusinessId ?? null,
        viewedBusinessId,
        source: source ?? null,
      },
    });
  }

  async getDashboard(businessId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const previousSince = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

    const [
      totalViews, currentViews, previousViews,
      uniqueViewerRows,
      sentQuotes, receivedQuotes,
      sentReferrals, receivedReferrals,
      partnerActiveCount,
      reputation,
      followers, following,
      opportunitiesPosted, applicationsSent,
      resourceDownloadsReceived,
      resourceDownloadsMade,
      myReviewsRecent,
      myActivityRecent,
      topViewers,
      viewsByDay,
    ] = await Promise.all([
      this.prisma.client.profileView.count({ where: { viewedBusinessId: businessId } }),
      this.prisma.client.profileView.count({ where: { viewedBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.profileView.count({ where: { viewedBusinessId: businessId, createdAt: { gte: previousSince, lt: since } } }),
      this.prisma.client.profileView.findMany({
        where: { viewedBusinessId: businessId, viewerBusinessId: { not: null }, createdAt: { gte: since } },
        select: { viewerBusinessId: true },
        distinct: ['viewerBusinessId'],
      }),
      this.prisma.client.communityQuoteRequest.count({ where: { fromBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.communityQuoteRequest.count({ where: { toBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.communityReferral.count({ where: { fromBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.communityReferral.count({ where: { toBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.partnerProgram.count({ where: { status: 'ACTIVE', OR: [{ initiatorBusinessId: businessId }, { partnerBusinessId: businessId }] } }),
      this.prisma.client.businessReputation.findUnique({ where: { businessId } }),
      this.prisma.client.networkConnection.count({ where: { toBusinessId: businessId, type: 'FOLLOW' } }),
      this.prisma.client.networkConnection.count({ where: { fromBusinessId: businessId, type: 'FOLLOW' } }),
      this.prisma.client.opportunity.count({ where: { posterBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.opportunityApplication.count({ where: { applicantBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.resourceDownload.count({ where: { product: { businessId }, createdAt: { gte: since } } }),
      this.prisma.client.resourceDownload.count({ where: { downloaderBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.communityReview.count({ where: { revieweeBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.networkActivity.count({ where: { actorBusinessId: businessId, createdAt: { gte: since } } }),
      this.prisma.client.profileView.groupBy({
        by: ['viewerBusinessId'],
        where: { viewedBusinessId: businessId, viewerBusinessId: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { viewerBusinessId: 'desc' } },
        take: 5,
      }),
      this.prisma.client.profileView.findMany({
        where: { viewedBusinessId: businessId, createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Compute reputation rank by score
    let reputationRank: number | null = null;
    let totalRanked: number | null = null;
    if (reputation && reputation.reputationScore > 0) {
      const [higher, total] = await Promise.all([
        this.prisma.client.businessReputation.count({ where: { reputationScore: { gt: reputation.reputationScore } } }),
        this.prisma.client.businessReputation.count({ where: { reputationScore: { gt: 0 } } }),
      ]);
      reputationRank = higher + 1;
      totalRanked = total;
    }

    // Hydrate top viewer business details
    const topViewerIds = topViewers.map((t) => t.viewerBusinessId).filter((id): id is string => !!id);
    const topViewerBizs = topViewerIds.length
      ? await this.prisma.client.business.findMany({
          where: { id: { in: topViewerIds } },
          select: businessSelect,
        })
      : [];
    const topViewersHydrated = topViewers.map((t) => ({
      business: topViewerBizs.find((b) => b.id === t.viewerBusinessId) ?? null,
      viewCount: t._count._all,
    })).filter((t) => t.business);

    // Aggregate views by day
    const viewsByDayMap = new Map<string, number>();
    for (const v of viewsByDay) {
      const key = v.createdAt.toISOString().slice(0, 10);
      viewsByDayMap.set(key, (viewsByDayMap.get(key) ?? 0) + 1);
    }
    const trend = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      return { date: key, views: viewsByDayMap.get(key) ?? 0 };
    });

    const viewsDelta = previousViews > 0
      ? ((currentViews - previousViews) / previousViews) * 100
      : (currentViews > 0 ? 100 : 0);

    return {
      windowDays: days,
      profileViews: {
        total: totalViews,
        window: currentViews,
        previous: previousViews,
        deltaPct: Number(viewsDelta.toFixed(1)),
        uniqueViewers: uniqueViewerRows.length,
        trend,
        topViewers: topViewersHydrated,
      },
      quoteRequests: { sent: sentQuotes, received: receivedQuotes },
      referrals: { sent: sentReferrals, received: receivedReferrals },
      partnerships: { active: partnerActiveCount },
      network: { followers, following },
      opportunities: { posted: opportunitiesPosted, applicationsSent },
      resources: { downloadsReceived: resourceDownloadsReceived, downloadsMade: resourceDownloadsMade },
      reviews: { receivedInWindow: myReviewsRecent },
      activity: { eventsInWindow: myActivityRecent },
      reputation: reputation ? {
        score: reputation.reputationScore,
        averageRating: reputation.averageRating,
        totalReviews: reputation.totalReviews,
        totalCompleted: reputation.totalCompleted,
        rank: reputationRank,
        totalRanked,
        percentile: reputationRank && totalRanked && totalRanked > 0
          ? Number((((totalRanked - reputationRank) / totalRanked) * 100).toFixed(1))
          : null,
      } : null,
    };
  }

  async listRecentViewers(businessId: string, limit = 20) {
    const views = await this.prisma.client.profileView.findMany({
      where: { viewedBusinessId: businessId, viewerBusinessId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { viewer: { select: businessSelect } },
    });
    return views;
  }
}

import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async getDashboard(businessId: string) {
    const [
      totalPages,
      indexedPages,
      totalKeywords,
      trackedKeywords,
      openIssues,
      criticalIssues,
      pendingBriefs,
      topPages,
      topKeywords,
      recentIssues,
    ] = await Promise.all([
      this.prisma.client.seoPage.count({ where: { businessId } }),
      this.prisma.client.seoPage.count({ where: { businessId, indexingStatus: 'indexed' } }),
      this.prisma.client.seoKeyword.count({ where: { businessId } }),
      this.prisma.client.seoKeyword.count({ where: { businessId, isTracked: true } }),
      this.prisma.client.seoIssue.count({ where: { businessId, status: 'open' } }),
      this.prisma.client.seoIssue.count({ where: { businessId, status: 'open', severity: 'critical' } }),
      this.prisma.client.contentBrief.count({ where: { businessId, status: 'draft' } }),
      this.prisma.client.seoPage.findMany({
        where: { businessId },
        orderBy: { clicks: 'desc' },
        take: 10,
        select: {
          id: true, url: true, path: true, pageType: true, title: true,
          impressions: true, clicks: true, ctr: true, avgPosition: true,
          organicSessions: true, conversions: true, revenue: true,
          indexingStatus: true,
        },
      }),
      this.prisma.client.seoKeyword.findMany({
        where: { businessId, isTracked: true },
        orderBy: { clicks: 'desc' },
        take: 10,
        select: {
          id: true, keyword: true, currentPosition: true, previousPosition: true,
          impressions: true, clicks: true, ctr: true, trend: true,
          positionChange: true, pageId: true,
        },
      }),
      this.prisma.client.seoIssue.findMany({
        where: { businessId, status: 'open' },
        orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
        take: 10,
      }),
    ]);

    const totalClicks = await this.prisma.client.seoPage.aggregate({
      where: { businessId },
      _sum: { clicks: true, impressions: true, conversions: true, revenue: true },
    });

    const rankingDrops = await this.prisma.client.seoKeyword.count({
      where: { businessId, isTracked: true, trend: 'declining' },
    });

    const rankingGains = await this.prisma.client.seoKeyword.count({
      where: { businessId, isTracked: true, trend: 'improving' },
    });

    const seoScore = this.calculateSeoScore({
      totalPages, indexedPages, totalKeywords, openIssues, criticalIssues,
    });

    return {
      score: seoScore,
      overview: {
        totalPages,
        indexedPages,
        indexRate: totalPages > 0 ? Math.round((indexedPages / totalPages) * 100) : 0,
        totalKeywords,
        trackedKeywords,
        openIssues,
        criticalIssues,
        pendingBriefs,
        rankingDrops,
        rankingGains,
      },
      traffic: {
        totalClicks: totalClicks._sum.clicks ?? 0,
        totalImpressions: totalClicks._sum.impressions ?? 0,
        totalConversions: totalClicks._sum.conversions ?? 0,
        totalRevenue: totalClicks._sum.revenue ?? 0,
      },
      topPages,
      topKeywords,
      recentIssues,
    };
  }

  private calculateSeoScore(data: {
    totalPages: number;
    indexedPages: number;
    totalKeywords: number;
    openIssues: number;
    criticalIssues: number;
  }): number {
    let score = 50;
    if (data.totalPages > 0) score += 10;
    if (data.totalPages > 5) score += 5;
    if (data.totalPages > 0) {
      const indexRate = data.indexedPages / data.totalPages;
      score += Math.round(indexRate * 15);
    }
    if (data.totalKeywords > 0) score += 10;
    if (data.totalKeywords > 10) score += 5;
    score -= Math.min(20, data.criticalIssues * 10);
    score -= Math.min(15, data.openIssues * 3);
    return Math.max(0, Math.min(100, score));
  }

  async getPages(businessId: string, filters?: { pageType?: string; indexingStatus?: string; sortBy?: string }) {
    const where: any = { businessId };
    if (filters?.pageType) where.pageType = filters.pageType;
    if (filters?.indexingStatus) where.indexingStatus = filters.indexingStatus;

    const orderBy: any = {};
    switch (filters?.sortBy) {
      case 'clicks': orderBy.clicks = 'desc'; break;
      case 'impressions': orderBy.impressions = 'desc'; break;
      case 'position': orderBy.avgPosition = 'asc'; break;
      case 'revenue': orderBy.revenue = 'desc'; break;
      default: orderBy.clicks = 'desc';
    }

    return this.prisma.client.seoPage.findMany({
      where,
      orderBy,
      include: { keywords: { select: { id: true, keyword: true, currentPosition: true, isPrimary: true } } },
      take: 100,
    });
  }

  async getPageDetail(businessId: string, pageId: string) {
    const page = await this.prisma.client.seoPage.findFirst({
      where: { id: pageId, businessId },
      include: {
        keywords: true,
        rankings: { orderBy: { snapshotDate: 'desc' }, take: 90 },
      },
    });
    if (!page) throw new NotFoundException('SEO page not found');
    return page;
  }

  async getKeywords(businessId: string, filters?: { tracked?: boolean; trend?: string }) {
    const where: any = { businessId };
    if (filters?.tracked !== undefined) where.isTracked = filters.tracked;
    if (filters?.trend) where.trend = filters.trend;

    return this.prisma.client.seoKeyword.findMany({
      where,
      orderBy: { clicks: 'desc' },
      include: { page: { select: { id: true, url: true, path: true, title: true } } },
      take: 200,
    });
  }

  async addKeyword(businessId: string, data: { keyword: string; pageId?: string; isPrimary?: boolean }) {
    const existing = await this.prisma.client.seoKeyword.findUnique({
      where: { businessId_keyword: { businessId, keyword: data.keyword.toLowerCase().trim() } },
    });
    if (existing) return existing;

    return this.prisma.client.seoKeyword.create({
      data: {
        businessId,
        keyword: data.keyword.toLowerCase().trim(),
        pageId: data.pageId,
        isPrimary: data.isPrimary ?? false,
        isTracked: true,
      },
    });
  }

  async removeKeyword(businessId: string, keywordId: string) {
    const kw = await this.prisma.client.seoKeyword.findFirst({ where: { id: keywordId, businessId } });
    if (!kw) throw new NotFoundException('Keyword not found');
    await this.prisma.client.seoKeyword.delete({ where: { id: keywordId } });
    return { deleted: true };
  }

  async getIssues(businessId: string, filters?: { status?: string; severity?: string; category?: string }) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.severity) where.severity = filters.severity;
    if (filters?.category) where.category = filters.category;

    return this.prisma.client.seoIssue.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
      take: 100,
    });
  }

  async resolveIssue(businessId: string, issueId: string) {
    const issue = await this.prisma.client.seoIssue.findFirst({ where: { id: issueId, businessId } });
    if (!issue) throw new NotFoundException('SEO issue not found');

    return this.prisma.client.seoIssue.update({
      where: { id: issueId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }

  async getContentBriefs(businessId: string, filters?: { status?: string }) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;

    return this.prisma.client.contentBrief.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async getContentBriefDetail(businessId: string, briefId: string) {
    const brief = await this.prisma.client.contentBrief.findFirst({
      where: { id: briefId, businessId },
    });
    if (!brief) throw new NotFoundException('Content brief not found');
    return brief;
  }

  async updateContentBriefStatus(businessId: string, briefId: string, status: string, approvedBy?: string) {
    const brief = await this.prisma.client.contentBrief.findFirst({
      where: { id: briefId, businessId },
    });
    if (!brief) throw new NotFoundException('Content brief not found');

    const data: any = { status };
    if (status === 'approved') {
      data.approvalStatus = 'approved';
      data.approvedBy = approvedBy;
      data.approvedAt = new Date();
    }

    return this.prisma.client.contentBrief.update({ where: { id: briefId }, data });
  }

  async getRevenueAttribution(businessId: string) {
    const pages = await this.prisma.client.seoPage.findMany({
      where: { businessId, conversions: { gt: 0 } },
      orderBy: { revenue: 'desc' },
      take: 50,
      select: {
        id: true, url: true, path: true, pageType: true, title: true,
        organicSessions: true, conversions: true, revenue: true,
        clicks: true, impressions: true,
        keywords: {
          where: { isPrimary: true },
          select: { keyword: true, currentPosition: true },
          take: 3,
        },
      },
    });

    const totals = await this.prisma.client.seoPage.aggregate({
      where: { businessId },
      _sum: { organicSessions: true, conversions: true, revenue: true },
    });

    const conversionRate = (totals._sum.organicSessions ?? 0) > 0
      ? Math.round(((totals._sum.conversions ?? 0) / (totals._sum.organicSessions ?? 1)) * 10000) / 100
      : 0;

    return {
      totalOrganicSessions: totals._sum.organicSessions ?? 0,
      totalConversions: totals._sum.conversions ?? 0,
      totalRevenue: totals._sum.revenue ?? 0,
      conversionRate,
      topRevenuePages: pages,
    };
  }

  async syncPageInventory(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { slug: true, name: true, metaData: true },
    });
    if (!business?.slug) return { synced: 0 };

    const [products, services] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true, description: true },
      }),
      this.prisma.client.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, description: true },
      }),
    ]);

    let synced = 0;
    const baseUrl = `/book/${business.slug}`;

    await this.upsertPage(businessId, {
      url: baseUrl,
      path: baseUrl,
      pageType: 'storefront',
      title: business.name ?? 'Storefront',
      wordCount: ((business.metaData as any)?.storefront?.seo?.metaDescription ?? '').length,
    });
    synced++;

    for (const product of products) {
      const path = `${baseUrl}/product/${product.id}`;
      await this.upsertPage(businessId, {
        url: path,
        path,
        pageType: 'product',
        title: product.name,
        wordCount: product.description?.length ?? 0,
        productId: product.id,
      });
      synced++;
    }

    for (const service of services) {
      const path = `${baseUrl}/service/${service.id}`;
      await this.upsertPage(businessId, {
        url: path,
        path,
        pageType: 'service',
        title: service.name,
        wordCount: service.description?.length ?? 0,
        serviceId: service.id,
      });
      synced++;
    }

    await this.detectIssues(businessId);

    this.events.emit('seo.sync_completed', {
      businessId,
      source: 'page_inventory',
      pagesUpdated: synced,
      keywordsUpdated: 0,
    });

    return { synced };
  }

  private async upsertPage(businessId: string, data: {
    url: string;
    path: string;
    pageType: string;
    title: string;
    wordCount?: number;
    productId?: string;
    serviceId?: string;
  }) {
    return this.prisma.client.seoPage.upsert({
      where: { businessId_path: { businessId, path: data.path } },
      create: { ...data, businessId },
      update: {
        title: data.title,
        wordCount: data.wordCount,
        pageType: data.pageType,
        productId: data.productId,
        serviceId: data.serviceId,
      },
    });
  }

  async detectIssues(businessId: string) {
    const pages = await this.prisma.client.seoPage.findMany({
      where: { businessId },
      select: {
        id: true, url: true, path: true, title: true,
        metaTitle: true, metaDescription: true, wordCount: true,
        indexingStatus: true, pageType: true,
      },
    });

    const existingOpenIssues = await this.prisma.client.seoIssue.findMany({
      where: { businessId, status: 'open' },
      select: { issueType: true, pageUrl: true },
    });
    const existingSet = new Set(existingOpenIssues.map(i => `${i.issueType}:${i.pageUrl}`));

    const newIssues: any[] = [];

    for (const page of pages) {
      if (!page.metaTitle && !page.title) {
        const key = `missing_title:${page.url}`;
        if (!existingSet.has(key)) {
          newIssues.push({
            businessId,
            issueType: 'missing_title',
            severity: 'high',
            category: 'on_page',
            title: `Missing page title: ${page.path}`,
            description: 'This page has no title tag set. Titles are critical for search rankings.',
            pageUrl: page.url,
            recommendation: 'Add a compelling, keyword-rich title under 60 characters.',
          });
        }
      }

      if (!page.metaDescription) {
        const key = `missing_meta_description:${page.url}`;
        if (!existingSet.has(key)) {
          newIssues.push({
            businessId,
            issueType: 'missing_meta_description',
            severity: 'medium',
            category: 'on_page',
            title: `Missing meta description: ${page.path}`,
            description: 'This page has no meta description. Meta descriptions improve click-through rates.',
            pageUrl: page.url,
            recommendation: 'Write a compelling meta description of 150-160 characters.',
          });
        }
      }

      if (page.wordCount !== null && page.wordCount < 100 && page.pageType !== 'storefront') {
        const key = `thin_content:${page.url}`;
        if (!existingSet.has(key)) {
          newIssues.push({
            businessId,
            issueType: 'thin_content',
            severity: 'medium',
            category: 'content',
            title: `Thin content: ${page.path}`,
            description: `This page has only ${page.wordCount} words. Search engines prefer substantial content.`,
            pageUrl: page.url,
            recommendation: 'Expand the page content to at least 300 words with relevant information.',
          });
        }
      }

      if (page.indexingStatus === 'not_indexed') {
        const key = `not_indexed:${page.url}`;
        if (!existingSet.has(key)) {
          newIssues.push({
            businessId,
            issueType: 'not_indexed',
            severity: 'high',
            category: 'indexing',
            title: `Page not indexed: ${page.path}`,
            description: 'This page is not showing up in search engine indexes.',
            pageUrl: page.url,
            recommendation: 'Submit this page for indexing in Google Search Console.',
          });
        }
      }
    }

    if (newIssues.length > 0) {
      await this.prisma.client.seoIssue.createMany({ data: newIssues });

      for (const issue of newIssues) {
        this.events.emit('seo.issue_detected', {
          businessId,
          issueId: issue.id ?? 'batch',
          issueType: issue.issueType,
          severity: issue.severity,
          title: issue.title,
        });
      }
    }

    return { detected: newIssues.length };
  }

  async ingestSearchConsoleData(businessId: string, data: {
    rows: Array<{
      keys: string[];
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }>;
    dimension: 'query' | 'page';
  }) {
    let updated = 0;

    if (data.dimension === 'page') {
      for (const row of data.rows) {
        const url = row.keys[0];
        if (!url) continue;
        try {
          const path = new URL(url).pathname;
          await this.prisma.client.seoPage.upsert({
            where: { businessId_path: { businessId, path } },
            create: {
              businessId,
              url,
              path,
              pageType: 'content',
              impressions: row.impressions,
              clicks: row.clicks,
              ctr: row.ctr,
              avgPosition: row.position,
              lastSynced: new Date(),
            },
            update: {
              impressions: row.impressions,
              clicks: row.clicks,
              ctr: row.ctr,
              avgPosition: row.position,
              lastSynced: new Date(),
            },
          });
          updated++;
        } catch {
          this.logger.warn(`Failed to parse URL: ${url}`);
        }
      }
    }

    if (data.dimension === 'query') {
      for (const row of data.rows) {
        const keyword = row.keys[0]?.toLowerCase().trim();
        if (!keyword) continue;

        const existing = await this.prisma.client.seoKeyword.findUnique({
          where: { businessId_keyword: { businessId, keyword } },
        });

        const previousPosition = existing?.currentPosition ?? null;
        const currentPosition = row.position;
        let trend = 'stable';
        let positionChange = 0;

        if (previousPosition !== null) {
          positionChange = previousPosition - currentPosition;
          if (positionChange > 2) trend = 'improving';
          else if (positionChange < -2) trend = 'declining';
        }

        const kw = await this.prisma.client.seoKeyword.upsert({
          where: { businessId_keyword: { businessId, keyword } },
          create: {
            businessId,
            keyword,
            currentPosition: currentPosition,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            trend,
            positionChange,
            lastUpdated: new Date(),
          },
          update: {
            previousPosition: previousPosition,
            currentPosition: currentPosition,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            trend,
            positionChange,
            bestPosition: existing?.bestPosition
              ? Math.min(existing.bestPosition, currentPosition)
              : currentPosition,
            lastUpdated: new Date(),
          },
        });

        if (trend === 'declining' && positionChange < -5) {
          this.events.emit('seo.ranking_drop', {
            businessId,
            keywordId: kw.id,
            keyword,
            previousPosition: previousPosition ?? 0,
            currentPosition,
          });
        }

        await this.prisma.client.rankingSnapshot.create({
          data: {
            keywordId: kw.id,
            pageId: kw.pageId,
            position: currentPosition,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            snapshotDate: new Date(),
          },
        });

        updated++;
      }
    }

    this.events.emit('seo.sync_completed', {
      businessId,
      source: 'search_console',
      pagesUpdated: data.dimension === 'page' ? updated : 0,
      keywordsUpdated: data.dimension === 'query' ? updated : 0,
    });

    return { updated };
  }

  async ingestAnalyticsData(businessId: string, data: {
    rows: Array<{
      pagePath: string;
      sessions: number;
      bounceRate: number;
      avgSessionDuration: number;
      conversions: number;
      revenue: number;
    }>;
  }) {
    let updated = 0;

    for (const row of data.rows) {
      const existing = await this.prisma.client.seoPage.findUnique({
        where: { businessId_path: { businessId, path: row.pagePath } },
      });

      if (existing) {
        await this.prisma.client.seoPage.update({
          where: { id: existing.id },
          data: {
            organicSessions: row.sessions,
            bounceRate: row.bounceRate,
            avgSessionDuration: row.avgSessionDuration,
            conversions: row.conversions,
            revenue: row.revenue,
            lastSynced: new Date(),
          },
        });
        updated++;
      }
    }

    this.events.emit('seo.sync_completed', {
      businessId,
      source: 'analytics',
      pagesUpdated: updated,
      keywordsUpdated: 0,
    });

    return { updated };
  }

  async getRankingHistory(businessId: string, keywordId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const kw = await this.prisma.client.seoKeyword.findFirst({
      where: { id: keywordId, businessId },
    });
    if (!kw) throw new NotFoundException('Keyword not found');

    const snapshots = await this.prisma.client.rankingSnapshot.findMany({
      where: { keywordId, snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'asc' },
    });

    return { keyword: kw, snapshots };
  }
}

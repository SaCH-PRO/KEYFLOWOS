import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ContentNeed {
  type: string;
  reason: string;
  priority: string;
  suggestedContentTypes: string[];
  suggestedGoal: string;
}

@Injectable()
export class KeyPlannerService {
  private readonly logger = new Logger(KeyPlannerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async detectContentNeeds(businessId: string): Promise<ContentNeed[]> {
    const needs: ContentNeed[] = [];

    // Check 1: High inventory + low sales → promotion content
    const inventorySignal = await this.checkInventorySignal(businessId);
    if (inventorySignal) needs.push(inventorySignal);

    // Check 2: New products without content → launch content
    const newProductSignal = await this.checkNewProductSignal(businessId);
    if (newProductSignal) needs.push(newProductSignal);

    // Check 3: No social posts in N days → engagement content
    const engagementSignal = await this.checkEngagementSignal(businessId);
    if (engagementSignal) needs.push(engagementSignal);

    // Check 4: Seasonal opportunity → seasonal content
    const seasonalSignal = await this.checkSeasonalSignal(businessId);
    if (seasonalSignal) needs.push(seasonalSignal);

    // Check 5: Stale content requests stuck in pipeline
    const stuckContentSignal = await this.checkStuckContentSignal(businessId);
    if (stuckContentSignal) needs.push(stuckContentSignal);

    return needs.sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));
  }

  private async checkInventorySignal(businessId: string): Promise<ContentNeed | null> {
    try {
      const productCount = await this.prisma.client.product.count({
        where: { businessId, isActive: true },
      });
      if (productCount < 3) return null;

      // Check for low recent sales (no invoices in 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentInvoices = await this.prisma.client.invoice.count({
        where: { businessId, createdAt: { gte: thirtyDaysAgo } },
      });

      if (recentInvoices === 0 && productCount >= 3) {
        return {
          type: 'promotion',
          reason: `High inventory (${productCount} products) with no sales in 30 days`,
          priority: 'high',
          suggestedContentTypes: ['social_post', 'email', 'ad_copy'],
          suggestedGoal: 'Drive sales for existing inventory',
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async checkNewProductSignal(businessId: string): Promise<ContentNeed | null> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const newProducts = await this.prisma.client.product.findMany({
        where: { businessId, createdAt: { gte: sevenDaysAgo } },
        take: 5,
        select: { id: true, name: true },
      });

      if (newProducts.length === 0) return null;

      return {
        type: 'launch',
        reason: `${newProducts.length} new product(s) added in the last 7 days: ${newProducts.map((p) => p.name).join(', ')}`,
        priority: 'high',
        suggestedContentTypes: ['social_post', 'email', 'landing_page'],
        suggestedGoal: 'Announce and drive adoption of new products',
      };
    } catch {
      return null;
    }
  }

  private async checkEngagementSignal(businessId: string): Promise<ContentNeed | null> {
    try {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const recentPosts = await this.prisma.client.socialPost.count({
        where: { businessId, createdAt: { gte: fourteenDaysAgo } },
      });

      if (recentPosts > 0) return null;

      return {
        type: 'engagement',
        reason: 'No social posts in the last 14 days',
        priority: 'normal',
        suggestedContentTypes: ['social_post', 'blog_post'],
        suggestedGoal: 'Re-engage audience with fresh content',
      };
    } catch {
      return null;
    }
  }

  private async checkSeasonalSignal(businessId: string): Promise<ContentNeed | null> {
    try {
      const now = new Date();
      const month = now.getMonth(); // 0-11
      const seasonalEvents = this.getSeasonalEvents(month);
      if (seasonalEvents.length === 0) return null;

      // Check if already have content for this season
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const seasonalContent = await this.prisma.client.contentRequest.count({
        where: {
          businessId,
          createdAt: { gte: thirtyDaysAgo },
          OR: seasonalEvents.map((e) => ({ businessGoal: { contains: e.keyword, mode: 'insensitive' as const } })),
        },
      });

      if (seasonalContent > 0) return null;

      return {
        type: 'seasonal',
        reason: `Upcoming seasonal opportunity: ${seasonalEvents.map((e) => e.name).join(', ')}`,
        priority: 'normal',
        suggestedContentTypes: ['social_post', 'email', 'flyer'],
        suggestedGoal: `Capitalize on ${seasonalEvents[0].name} season`,
      };
    } catch {
      return null;
    }
  }

  private async checkStuckContentSignal(businessId: string): Promise<ContentNeed | null> {
    try {
      const stuckRequests = await this.prisma.client.contentRequest.count({
        where: {
          businessId,
          status: { in: ['draft', 'submitted', 'assigned', 'in_production', 'internal_review'] },
        },
      });

      if (stuckRequests === 0) return null;

      return {
        type: 'pipeline_attention',
        reason: `${stuckRequests} content request(s) are active in the pipeline and may need attention`,
        priority: 'low',
        suggestedContentTypes: [],
        suggestedGoal: 'Review and advance content pipeline',
      };
    } catch {
      return null;
    }
  }

  private getSeasonalEvents(month: number): { name: string; keyword: string }[] {
    const events: Record<number, { name: string; keyword: string }[]> = {
      0: [{ name: 'New Year', keyword: 'new year' }],
      1: [{ name: 'Valentine\'s Day', keyword: 'valentine' }],
      2: [{ name: 'Carnival', keyword: 'carnival' }, { name: 'Easter', keyword: 'easter' }],
      3: [{ name: 'Easter', keyword: 'easter' }],
      4: [{ name: 'Mother\'s Day', keyword: 'mother' }],
      5: [{ name: 'Father\'s Day', keyword: 'father' }],
      6: [{ name: 'Summer Sale', keyword: 'summer' }],
      7: [{ name: 'Back to School', keyword: 'school' }],
      8: [{ name: 'Independence', keyword: 'independence' }],
      9: [{ name: 'Halloween', keyword: 'halloween' }],
      10: [{ name: 'Black Friday', keyword: 'black friday' }, { name: 'Christmas', keyword: 'christmas' }],
      11: [{ name: 'Christmas', keyword: 'christmas' }, { name: 'New Year', keyword: 'new year' }],
    };
    return events[month] ?? [];
  }

  private priorityWeight(priority: string): number {
    switch (priority) {
      case 'urgent': return 4;
      case 'high': return 3;
      case 'normal': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }
}

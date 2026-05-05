import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevenueBriefingService } from './revenue-briefing.service';

const CHECK_INTERVAL_MS = 60_000;
const TARGET_HOUR = 8;
const TARGET_DAY = 1; // Monday

/**
 * Every Monday 08:00 in the business timezone, generate a fresh revenue
 * briefing and persist a single AutopilotTask summarizing last week +
 * recommending the top 5 actions for the new week.
 */
@Injectable()
export class WeeklyRevenueReviewScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeeklyRevenueReviewScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RevenueBriefingService) private readonly briefing: RevenueBriefingService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[WeeklyRevenueReview] Disabled via env');
      return;
    }
    this.logger.log('[WeeklyRevenueReview] Starting — checks every 60s for Monday 8am business-tz');
    this.intervalRef = setInterval(() => {
      void this.tick().catch((e) =>
        this.logger.error(`tick failed: ${(e as Error).message}`),
      );
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  private async tick() {
    const businesses = await this.prisma.client.business.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, timezone: true },
    });
    for (const biz of businesses) {
      const tz = biz.timezone || 'America/Port_of_Spain';
      const info = this.localTime(tz);
      if (info.dayOfWeek !== TARGET_DAY || info.hour !== TARGET_HOUR) continue;
      if (await this.alreadyRanToday(biz.id, info.dateKey)) continue;
      try {
        await this.runFor(biz.id);
        this.logger.log(`[WeeklyRevenueReview] Created weekly task for ${biz.name} (${biz.id})`);
      } catch (e) {
        this.logger.error(`[WeeklyRevenueReview] Failed for ${biz.id}: ${(e as Error).message}`);
      }
    }
  }

  async runFor(businessId: string) {
    const snapshot = await this.briefing.generate(businessId);
    const top5 = snapshot.briefing.whatToChase.slice(0, 5);
    const description = [
      snapshot.briefing.headline,
      '',
      'Top 5 actions for this week:',
      ...top5.map((c, i) => `${i + 1}. ${c.title} — ${c.detail}`),
    ].join('\n');

    await this.prisma.client.autopilotTask.create({
      data: {
        businessId,
        title: 'Weekly revenue review',
        description,
        category: 'FINANCE',
        priority: 'HIGH',
        autoExecutable: false,
        requiresApproval: false,
        scheduledFor: new Date(),
        aiContext: {
          source: 'weekly_revenue_review',
          generatedAt: snapshot.generatedAt,
          forecastTotalExpected: snapshot.forecast.totalExpected,
          overdueCount: snapshot.inputs.overdueCount,
          slowPayerCount: snapshot.slowPayers.slowPayers.length,
          chases: top5.map((c) => ({
            title: c.title,
            detail: c.detail,
            amountAtRisk: c.amountAtRisk ?? null,
            contactId: c.contactId ?? null,
            relatedType: c.relatedType ?? null,
            relatedId: c.relatedId ?? null,
          })),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async alreadyRanToday(businessId: string, dateKey: string): Promise<boolean> {
    const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);
    const existing = await this.prisma.client.autopilotTask.findFirst({
      where: {
        businessId,
        title: 'Weekly revenue review',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });
    return !!existing;
  }

  private localTime(tz: string): { hour: number; dayOfWeek: number; dateKey: string } {
    try {
      const now = new Date();
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now),
        10,
      );
      const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
      const dateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now);
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { hour, dayOfWeek: dayMap[dayStr] ?? new Date().getDay(), dateKey };
    } catch {
      const n = new Date();
      return { hour: n.getHours(), dayOfWeek: n.getDay(), dateKey: n.toISOString().slice(0, 10) };
    }
  }
}

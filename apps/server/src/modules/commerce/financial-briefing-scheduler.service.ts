import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinancialCopilotService } from './financial-copilot.service';

const CHECK_INTERVAL_MS = 60 * 1000;
const TARGET_HOUR = 7;
const TARGET_DAY = 1;

@Injectable()
export class FinancialBriefingSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinancialBriefingSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinancialCopilotService) private readonly financialCopilot: FinancialCopilotService,
  ) {}

  onModuleInit() {
    this.logger.log('[FinancialBriefingScheduler] Starting — checking every 60s for Monday 7am briefings');
    this.intervalRef = setInterval(() => {
      void this.checkAndRunBriefings();
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    this.logger.log('[FinancialBriefingScheduler] Stopped');
  }

  private getLocalTimeInfo(tz: string): { hour: number; dayOfWeek: number; dateKey: string } {
    try {
      const now = new Date();
      const hourFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      });
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      });
      const dateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const dayStr = dayFormatter.format(now);
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

      return {
        hour: parseInt(hourFormatter.format(now), 10),
        dayOfWeek: dayMap[dayStr] ?? now.getDay(),
        dateKey: dateFormatter.format(now),
      };
    } catch {
      const now = new Date();
      return {
        hour: now.getHours(),
        dayOfWeek: now.getDay(),
        dateKey: now.toISOString().split('T')[0],
      };
    }
  }

  private async hasBriefingForDate(businessId: string, dateKey: string): Promise<boolean> {
    const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);

    const existing = await this.prisma.client.notification.findFirst({
      where: {
        businessId,
        type: 'financial.weekly_briefing',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });

    return !!existing;
  }

  private async checkAndRunBriefings() {
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true, timezone: true, name: true },
      });

      for (const business of businesses) {
        const tz = business.timezone || 'America/Port_of_Spain';
        const { hour, dayOfWeek, dateKey } = this.getLocalTimeInfo(tz);

        if (dayOfWeek !== TARGET_DAY || hour !== TARGET_HOUR) continue;

        const alreadySent = await this.hasBriefingForDate(business.id, dateKey);
        if (alreadySent) continue;

        try {
          this.logger.log(`[FinancialBriefingScheduler] Generating weekly briefing for ${business.name} (${business.id})`);
          const briefing = await this.financialCopilot.generateWeeklyBriefing(business.id);

          await this.prisma.client.notification.create({
            data: {
              businessId: business.id,
              type: 'financial.weekly_briefing',
              title: 'Weekly Financial Briefing',
              body: briefing.summary,
              data: {
                lastWeekRevenue: briefing.lastWeekRevenue,
                lastWeekExpenses: briefing.lastWeekExpenses,
                lastWeekNet: briefing.lastWeekNet,
                outstandingReceivables: briefing.outstandingReceivables,
                cashPosition: briefing.cashPosition,
                highlights: briefing.highlights,
                concerns: briefing.concerns,
                recommendation: briefing.recommendation,
                outlook: briefing.outlook,
              },
            },
          });

          this.logger.log(`[FinancialBriefingScheduler] Briefing saved for ${business.name}`);
        } catch (error) {
          this.logger.error(`[FinancialBriefingScheduler] Failed for ${business.id}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.error(`[FinancialBriefingScheduler] Check failed: ${(error as Error).message}`);
    }
  }
}

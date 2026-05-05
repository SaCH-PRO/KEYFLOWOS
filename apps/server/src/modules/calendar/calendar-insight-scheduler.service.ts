import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CalendarInsightService } from './calendar-insight.service';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MAX_BUSINESSES_PER_TICK = 50;

@Injectable()
export class CalendarInsightSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CalendarInsightSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarInsightService)
    private readonly insights: CalendarInsightService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.DISABLE_CALENDAR_INSIGHT_SCHEDULER === '1') return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.warn(`Scheduler tick failed: ${(err as Error).message}`);
      });
    }, REFRESH_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(
      `Calendar insight scheduler armed (every ${REFRESH_INTERVAL_MS / 60000}m).`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<{ refreshed: number }> {
    if (this.running) return { refreshed: 0 };
    this.running = true;
    let refreshed = 0;
    try {
      const businesses = await this.prisma.client.business.findMany({
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: MAX_BUSINESSES_PER_TICK,
        select: { id: true, ownerId: true },
      });
      const now = new Date();
      const day = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
      const weekStart = new Date(day);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      for (const biz of businesses) {
        if (!biz.ownerId) continue;
        try {
          this.insights.invalidate(biz.id, biz.ownerId);
          await this.insights.generateDailyPlan(
            biz.id,
            biz.ownerId,
            'OWNER',
            day,
            { force: true },
          );
          await this.insights.generateWeeklyCapacity(
            biz.id,
            biz.ownerId,
            'OWNER',
            weekStart,
            { force: true },
          );
          refreshed += 1;
        } catch (err) {
          this.logger.warn(
            `Failed to refresh insights for ${biz.id}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return { refreshed };
  }
}

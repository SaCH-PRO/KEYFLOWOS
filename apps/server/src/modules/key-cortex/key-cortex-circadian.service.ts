import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * The circadian clock — KEY's suprachiasmatic nucleus.
 *
 * Every time-of-day rhythm in this server ran on SERVER time. The morning
 * briefing fires at `EVERY_DAY_AT_8AM`, the end-of-day report at 6PM, the
 * weekly digest on Monday 9AM — all in whatever timezone the host happens to be
 * configured with.
 *
 * `Business.timezone` has existed the whole time, defaulting to
 * `America/Port_of_Spain`, and nothing that schedules a rhythm read it. For a
 * product serving Caribbean businesses off a UTC host, a "morning" briefing
 * arrives at 4am local. The feature is not broken in a way that errors; it is
 * broken in a way that makes KEY feel like it does not know what time it is
 * where you are.
 *
 * A circadian rhythm that is not entrained to local light is not a rhythm, it
 * is a timer. This is the entrainment.
 *
 * HOW IT IS USED
 *
 * A rhythm switches from "fire at 8AM" to "run hourly, and act on the
 * businesses for which it is currently 8AM locally":
 *
 *     @Cron(CronExpression.EVERY_HOUR)
 *     async morningBriefs() {
 *       for (const b of await this.circadian.businessesAtLocalHour(8)) { ... }
 *     }
 *
 * Each business is then served once per day, at its own 8AM.
 */
@Injectable()
export class KeyCortexCircadianService {
  private readonly logger = new Logger(KeyCortexCircadianService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The hour (0–23) it currently is for this timezone.
   *
   * Uses Intl rather than manual offset arithmetic so daylight saving is
   * handled by the platform's tz database. Hand-rolled offsets are the classic
   * way to be right for eight months a year.
   */
  localHour(timezone: string, now: Date = new Date()): number {
    try {
      const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(now);
      const parsed = Number.parseInt(hour, 10);
      return Number.isFinite(parsed) ? parsed % 24 : now.getUTCHours();
    } catch {
      // An invalid tz string must not stop a rhythm for every other business.
      // Falling back to UTC keeps the old behaviour rather than skipping.
      return now.getUTCHours();
    }
  }

  /** Day of week (0 = Sunday) for this timezone — a Monday digest needs the local Monday. */
  localDayOfWeek(timezone: string, now: Date = new Date()): number {
    try {
      const day = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
      }).format(now);
      const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
      return index >= 0 ? index : now.getUTCDay();
    } catch {
      return now.getUTCDay();
    }
  }

  /**
   * Businesses for which it is currently `hour` o'clock locally.
   *
   * Intended to be called from an hourly cron. Because the hour advances once
   * per hour in every timezone, each business matches exactly once per day —
   * so a rhythm driven this way fires once daily per business, at its own local
   * time, with no scheduling state to keep.
   */
  async businessesAtLocalHour(
    hour: number,
    now: Date = new Date(),
  ): Promise<Array<{ id: string; timezone: string }>> {
    const businesses = await this.prisma.client.business
      .findMany({
        where: { deletedAt: null },
        select: { id: true, timezone: true },
      })
      .catch(() => [] as Array<{ id: string; timezone: string }>);

    return (businesses as Array<{ id: string; timezone: string | null }>)
      .map((b) => ({ id: b.id, timezone: b.timezone || 'UTC' }))
      .filter((b) => this.localHour(b.timezone, now) === hour);
  }

  /** As above, but also requiring a particular local weekday. */
  async businessesAtLocalTime(
    hour: number,
    dayOfWeek: number,
    now: Date = new Date(),
  ): Promise<Array<{ id: string; timezone: string }>> {
    const atHour = await this.businessesAtLocalHour(hour, now);
    return atHour.filter((b) => this.localDayOfWeek(b.timezone, now) === dayOfWeek);
  }

  /**
   * Is it outside working hours for this business?
   *
   * The parasympathetic question. Consolidation, reflection and maintenance
   * belong in the quiet hours — running them mid-morning competes with the
   * traffic they are meant to learn from.
   */
  isRestingHours(timezone: string, now: Date = new Date()): boolean {
    const hour = this.localHour(timezone, now);
    return hour < 7 || hour >= 20;
  }
}

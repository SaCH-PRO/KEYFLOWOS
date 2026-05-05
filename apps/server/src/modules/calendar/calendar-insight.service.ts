import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import {
  DailyPlanContract,
  WeeklyCapacityContract,
} from '../ai/ai-output-contracts';
import {
  CalendarQueryService,
  ReturnedEvent,
} from './calendar-query.service';
import {
  CalendarConflict,
  CalendarConflictService,
} from './calendar-conflict.service';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class CalendarInsightService {
  private readonly logger = new Logger(CalendarInsightService.name);
  private readonly dailyPlanCache = new Map<string, CacheEntry<DailyPlanContract>>();
  private readonly weeklyCache = new Map<string, CacheEntry<WeeklyCapacityContract>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(CalendarQueryService) private readonly query: CalendarQueryService,
    @Inject(CalendarConflictService)
    private readonly conflicts: CalendarConflictService,
  ) {}

  // ----- Cache helpers ------------------------------------------------

  private cacheKey(businessId: string, userId: string, day: string): string {
    return `${businessId}:${userId}:${day}`;
  }

  invalidate(businessId: string, userId?: string): void {
    const prefix = userId ? `${businessId}:${userId}:` : `${businessId}:`;
    for (const key of this.dailyPlanCache.keys()) {
      if (key.startsWith(prefix)) this.dailyPlanCache.delete(key);
    }
    for (const key of this.weeklyCache.keys()) {
      if (key.startsWith(prefix)) this.weeklyCache.delete(key);
    }
  }

  // ----- Daily plan ---------------------------------------------------

  async generateDailyPlan(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    day: Date,
    options: { force?: boolean } = {},
  ): Promise<DailyPlanContract> {
    const dayIso = day.toISOString().slice(0, 10);
    const key = this.cacheKey(businessId, userId, dayIso);
    if (!options.force) {
      const cached = this.dailyPlanCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const start = new Date(`${dayIso}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86400_000);
    const where = await this.query.buildWhere(businessId, userId, userRole, {
      start,
      end,
    });
    const events = (await this.prisma.client.calendarEvent.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { startAt: 'asc' }],
      take: 200,
    })) as ReturnedEvent[];

    const { conflicts } = await this.conflicts.detect(
      businessId,
      userId,
      userRole,
      start,
      end,
    );

    const plan = await this.callDailyPlanModel(
      businessId,
      dayIso,
      events,
      conflicts,
    );
    this.dailyPlanCache.set(key, {
      value: plan,
      expiresAt: Date.now() + ONE_HOUR_MS * 6,
    });
    return plan;
  }

  private async callDailyPlanModel(
    businessId: string,
    dayIso: string,
    events: ReturnedEvent[],
    conflicts: CalendarConflict[],
  ): Promise<DailyPlanContract> {
    const fallback = this.deterministicDailyPlan(dayIso, events, conflicts);
    if (events.length === 0) return fallback;

    const summary = events.slice(0, 30).map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      module: e.module,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt?.toISOString() ?? null,
      priority: e.priority,
      amount: e.amount,
    }));
    const conflictSummary = conflicts.slice(0, 10).map((c) => ({
      kind: c.kind,
      severity: c.severity,
      message: c.message,
    }));

    const systemPrompt = `You are KEYFLOW's daily planning assistant for Caribbean small-business owners.
Return STRICT JSON matching this TypeScript shape:
{
  "date": "${dayIso}",
  "greeting": "string",
  "summary": "string (1-2 sentences)",
  "topPriorities": [{ "title": "string", "why": "string", "kind": "string", "eventId": "string?", "suggestedTime": "string?" }],
  "focusBlocks": [{ "startAt": "ISO string", "endAt": "ISO string", "label": "string" }],
  "warnings": ["string"]
}
Currency is TTD. Timezone is America/Port_of_Spain. Pick at most 5 topPriorities and 2 focusBlocks. Mention conflicts in warnings.`;

    const userPrompt = `Date: ${dayIso}\nEvents:\n${JSON.stringify(summary)}\nConflicts:\n${JSON.stringify(conflictSummary)}`;

    try {
      const response = await this.gateway.complete({
        businessId,
        taskCategory: 'summarization',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        maxTokens: 900,
        expectedContract: 'daily_plan',
      });
      const parsed = this.parseJson(response.content);
      if (parsed && typeof parsed === 'object') {
        return {
          date: dayIso,
          greeting: String(
            (parsed as Record<string, unknown>).greeting ?? fallback.greeting,
          ),
          summary: String(
            (parsed as Record<string, unknown>).summary ?? fallback.summary,
          ),
          topPriorities: Array.isArray(
            (parsed as Record<string, unknown>).topPriorities,
          )
            ? ((parsed as Record<string, unknown>)
                .topPriorities as DailyPlanContract['topPriorities'])
            : fallback.topPriorities,
          focusBlocks: Array.isArray(
            (parsed as Record<string, unknown>).focusBlocks,
          )
            ? ((parsed as Record<string, unknown>)
                .focusBlocks as DailyPlanContract['focusBlocks'])
            : fallback.focusBlocks,
          warnings: Array.isArray((parsed as Record<string, unknown>).warnings)
            ? ((parsed as Record<string, unknown>)
                .warnings as string[])
            : fallback.warnings,
        };
      }
    } catch (err) {
      this.logger.warn(
        `Daily plan AI call failed for ${businessId}: ${(err as Error).message}`,
      );
    }
    return fallback;
  }

  private deterministicDailyPlan(
    dayIso: string,
    events: ReturnedEvent[],
    conflicts: CalendarConflict[],
  ): DailyPlanContract {
    const priorityOrder: Record<string, number> = {
      URGENT: 4,
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    };
    const sorted = [...events].sort(
      (a, b) =>
        (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0) ||
        a.startAt.getTime() - b.startAt.getTime(),
    );
    const topPriorities = sorted.slice(0, 5).map((e) => ({
      title: e.title,
      why: `${e.type.replace(/_/g, ' ').toLowerCase()} (${e.module.toLowerCase()})`,
      kind: e.type,
      eventId: e.id,
      suggestedTime: e.startAt.toISOString(),
    }));
    return {
      date: dayIso,
      greeting:
        events.length === 0
          ? 'Quiet day ahead.'
          : `You have ${events.length} item${events.length === 1 ? '' : 's'} on the books.`,
      summary:
        events.length === 0
          ? 'Nothing scheduled — a good window to plan ahead or knock out admin.'
          : `Focus on the top ${Math.min(5, events.length)} highest-priority item${events.length === 1 ? '' : 's'} first.`,
      topPriorities,
      focusBlocks: [],
      warnings: conflicts.slice(0, 5).map((c) => c.message),
    };
  }

  // ----- Weekly capacity ----------------------------------------------

  async generateWeeklyCapacity(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    weekStart: Date,
    options: { force?: boolean } = {},
  ): Promise<WeeklyCapacityContract> {
    const startIso = weekStart.toISOString().slice(0, 10);
    const key = this.cacheKey(businessId, userId, `week:${startIso}`);
    if (!options.force) {
      const cached = this.weeklyCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const start = new Date(`${startIso}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 7 * 86400_000);
    const where = await this.query.buildWhere(businessId, userId, userRole, {
      start,
      end,
    });
    const events = (await this.prisma.client.calendarEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
      take: 1000,
    })) as ReturnedEvent[];

    const result = await this.callWeeklyCapacityModel(
      businessId,
      startIso,
      events,
    );
    this.weeklyCache.set(key, {
      value: result,
      expiresAt: Date.now() + ONE_HOUR_MS * 6,
    });
    return result;
  }

  private async callWeeklyCapacityModel(
    businessId: string,
    weekStart: string,
    events: ReturnedEvent[],
  ): Promise<WeeklyCapacityContract> {
    const baseline = this.deterministicWeeklyCapacity(weekStart, events);
    if (events.length === 0) return baseline;

    const systemPrompt = `You are KEYFLOW's capacity planner. Return STRICT JSON:
{
  "weekStart": "${weekStart}",
  "totalScheduledHours": number,
  "byDay": [{ "date": "YYYY-MM-DD", "hours": number, "eventCount": number, "capacityPct": number }],
  "overloadedDays": ["YYYY-MM-DD"],
  "underutilizedDays": ["YYYY-MM-DD"],
  "recommendations": ["string"]
}
Use the byDay totals provided as ground truth. Add 1-3 recommendations to balance the week.`;
    const userPrompt = `weekStart: ${weekStart}\nbyDay: ${JSON.stringify(baseline.byDay)}\noverloaded: ${JSON.stringify(baseline.overloadedDays)}\nunderutilized: ${JSON.stringify(baseline.underutilizedDays)}`;

    try {
      const response = await this.gateway.complete({
        businessId,
        taskCategory: 'summarization',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 700,
        expectedContract: 'weekly_capacity',
      });
      const parsed = this.parseJson(response.content);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        return {
          weekStart,
          totalScheduledHours: baseline.totalScheduledHours,
          byDay: baseline.byDay,
          overloadedDays: baseline.overloadedDays,
          underutilizedDays: baseline.underutilizedDays,
          recommendations: Array.isArray(obj.recommendations)
            ? (obj.recommendations as string[]).slice(0, 5)
            : baseline.recommendations,
        };
      }
    } catch (err) {
      this.logger.warn(
        `Weekly capacity AI call failed for ${businessId}: ${(err as Error).message}`,
      );
    }
    return baseline;
  }

  private deterministicWeeklyCapacity(
    weekStart: string,
    events: ReturnedEvent[],
  ): WeeklyCapacityContract {
    const dayBuckets = new Map<string, { hours: number; eventCount: number }>();
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(`${weekStart}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      dayBuckets.set(d.toISOString().slice(0, 10), { hours: 0, eventCount: 0 });
    }
    for (const ev of events) {
      const day = ev.startAt.toISOString().slice(0, 10);
      const bucket = dayBuckets.get(day);
      if (!bucket) continue;
      const hours = ev.endAt
        ? Math.max(
            0,
            (ev.endAt.getTime() - ev.startAt.getTime()) / (60 * 60 * 1000),
          )
        : 0.25;
      bucket.hours += hours;
      bucket.eventCount += 1;
    }
    const CAPACITY_HOURS_PER_DAY = 8;
    const byDay = Array.from(dayBuckets.entries()).map(([date, b]) => ({
      date,
      hours: Math.round(b.hours * 10) / 10,
      eventCount: b.eventCount,
      capacityPct: Math.round((b.hours / CAPACITY_HOURS_PER_DAY) * 100),
    }));
    const overloadedDays = byDay
      .filter((d) => d.capacityPct > 100)
      .map((d) => d.date);
    const underutilizedDays = byDay
      .filter((d) => d.capacityPct < 25 && d.eventCount === 0)
      .map((d) => d.date);
    const totalScheduledHours = Math.round(
      byDay.reduce((s, d) => s + d.hours, 0) * 10,
    ) / 10;
    const recommendations: string[] = [];
    if (overloadedDays.length > 0) {
      recommendations.push(
        `Move work off ${overloadedDays.join(', ')} — capacity over 100%.`,
      );
    }
    if (underutilizedDays.length > 0) {
      recommendations.push(
        `Use ${underutilizedDays.join(', ')} for outreach or content prep.`,
      );
    }
    if (recommendations.length === 0) {
      recommendations.push('Workload is balanced for the week.');
    }
    return {
      weekStart,
      totalScheduledHours,
      byDay,
      overloadedDays,
      underutilizedDays,
      recommendations,
    };
  }

  // ----- Helpers -------------------------------------------------------

  private parseJson(content: string): unknown {
    try {
      let cleaned = content.trim();
      const fence = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fence) cleaned = fence[1].trim();
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

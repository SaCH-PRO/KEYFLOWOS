import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelGatewayService } from './model-gateway.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { AiUsageService } from './ai-usage.service';

export interface AvailabilitySlot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface CalendarConflict {
  existingEvent: { title: string; start: Date; end: Date };
  proposedStart: Date;
  proposedEnd: Date;
  overlapMinutes: number;
}

@Injectable()
export class CalendarIntelligenceService {
  private readonly logger = new Logger(CalendarIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  /**
   * Check if a proposed booking time conflicts with existing events
   * Uses Google Calendar free/busy API if connected, falls back to internal CalendarEvent
   */
  async checkAvailability(
    businessId: string,
    proposedStart: Date,
    proposedEnd: Date,
    options?: { ignoreEventId?: string; checkBuffer?: boolean; bufferMinutes?: number },
  ): Promise<{ available: boolean; conflicts: CalendarConflict[]; alternativeSlots?: AvailabilitySlot[] }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        calendarAccessToken: true,
        calendarId: true,
        calendarTokenExpiry: true,
        timezone: true,
      },
    });

    // Check Google Calendar if connected and token valid
    if (business?.calendarAccessToken && business.calendarId) {
      try {
        const googleConflicts = await this.checkGoogleCalendarFreeBusy(
          businessId,
          business.calendarAccessToken,
          business.calendarId,
          proposedStart,
          proposedEnd,
          options?.ignoreEventId,
        );

        if (googleConflicts.available) {
          // Still check internal calendar for any non-synced events
          const internalConflicts = await this.checkInternalCalendarConflicts(
            businessId,
            proposedStart,
            proposedEnd,
            options?.ignoreEventId,
          );

          if (internalConflicts.length > 0) {
            const alternatives = await this.findAlternativeSlots(
              businessId,
              proposedStart,
              Math.round((proposedEnd.getTime() - proposedStart.getTime()) / 60000),
              business.timezone,
            );
            return { available: false, conflicts: internalConflicts, alternativeSlots: alternatives };
          }

          return { available: true, conflicts: [] };
        }

        const alternatives = await this.findAlternativeSlots(
          businessId,
          proposedStart,
          Math.round((proposedEnd.getTime() - proposedStart.getTime()) / 60000),
          business.timezone,
        );

        return { available: false, conflicts: googleConflicts.conflicts, alternativeSlots: alternatives };
      } catch (err) {
        this.logger.warn(`Google Calendar check failed, falling back to internal: ${(err as Error).message}`);
      }
    }

    // Fallback: check internal CalendarEvent records
    const conflicts = await this.checkInternalCalendarConflicts(
      businessId,
      proposedStart,
      proposedEnd,
      options?.ignoreEventId,
    );

    if (conflicts.length > 0) {
      const alternatives = await this.findAlternativeSlots(
        businessId,
        proposedStart,
        Math.round((proposedEnd.getTime() - proposedStart.getTime()) / 60000),
        business?.timezone ?? 'UTC',
      );
      return { available: false, conflicts, alternativeSlots: alternatives };
    }

    return { available: true, conflicts: [] };
  }

  /**
   * Find the next N available slots starting from a given date
   */
  async findAlternativeSlots(
    businessId: string,
    after: Date,
    durationMinutes: number,
    timezone: string,
    options?: { daysAhead?: number; maxSlots?: number; businessHoursOnly?: boolean },
  ): Promise<AvailabilitySlot[]> {
    const daysAhead = options?.daysAhead ?? 14;
    const maxSlots = options?.maxSlots ?? 5;
    const businessHoursOnly = options?.businessHoursOnly ?? true;

    // Get business hours from settings
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { businessHours: true, timezone: true },
    });

    const businessHours = (business?.businessHours as any) ?? {
      monday: { open: '09:00', close: '17:00' },
      tuesday: { open: '09:00', close: '17:00' },
      wednesday: { open: '09:00', close: '17:00' },
      thursday: { open: '09:00', close: '17:00' },
      friday: { open: '09:00', close: '17:00' },
    };

    const slots: AvailabilitySlot[] = [];
    const endDate = new Date(after.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // Get all existing events in the range
    const existingEvents = await this.prisma.client.calendarEvent.findMany({
      where: {
        businessId,
        OR: [
          { startAt: { gte: after, lte: endDate } },
          { endAt: { gte: after, lte: endDate } },
        ],
        status: { notIn: ['cancelled', 'declined'] },
      },
      select: { startAt: true, endAt: true, title: true },
      orderBy: { startAt: 'asc' },
    });

    // Generate candidate slots
    const currentDate = new Date(after);
    while (slots.length < maxSlots && currentDate < endDate) {
      const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }).toLowerCase();
      const hours = businessHours[dayName];

      if (businessHoursOnly && (!hours || hours.closed)) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
        continue;
      }

      const dayStart = new Date(currentDate);
      if (businessHoursOnly && hours) {
        const [openHour, openMin] = hours.open.split(':').map(Number);
        dayStart.setHours(openHour, openMin, 0, 0);
      }

      const dayEnd = new Date(currentDate);
      if (businessHoursOnly && hours) {
        const [closeHour, closeMin] = hours.close.split(':').map(Number);
        dayEnd.setHours(closeHour, closeMin, 0, 0);
      } else {
        dayEnd.setHours(23, 59, 0, 0);
      }

      // Start from after the proposed time if it's the first day
      let slotStart = new Date(Math.max(dayStart.getTime(), currentDate.getTime()));

      while (slotStart.getTime() + durationMinutes * 60000 <= dayEnd.getTime() && slots.length < maxSlots) {
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

        // Check if this slot conflicts with any existing event
        const hasConflict = existingEvents.some((ev) => {
          const evStart = new Date(ev.startAt).getTime();
          const evEnd = new Date(ev.endAt ?? ev.startAt).getTime();
          return slotStart.getTime() < evEnd && slotEnd.getTime() > evStart;
        });

        if (!hasConflict) {
          slots.push({ start: new Date(slotStart), end: slotEnd, durationMinutes });
        }

        // Move forward by 30-minute increments
        slotStart = new Date(slotStart.getTime() + 30 * 60000);
      }

      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    return slots;
  }

  /**
   * AI-powered smart scheduling — suggests best times based on patterns
   */
  async suggestOptimalSlots(
    businessId: string,
    durationMinutes: number,
    preferredDate?: Date,
  ): Promise<{ slots: AvailabilitySlot[]; reasoning: string }> {
    const startTime = Date.now();

    // Analyze past booking patterns
    const pastBookings = await this.prisma.client.calendarEvent.findMany({
      where: {
        businessId,
        startAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        status: { notIn: ['cancelled'] },
      },
      select: { startAt: true, title: true },
      orderBy: { startAt: 'desc' },
      take: 100,
    });

    // Find available slots
    const searchStart = preferredDate ?? new Date();
    const availableSlots = await this.findAlternativeSlots(
      businessId,
      searchStart,
      durationMinutes,
      'UTC',
      { daysAhead: 7, maxSlots: 10, businessHoursOnly: true },
    );

    // Use AI to rank slots based on patterns
    const prompt = `Given these past booking times: ${pastBookings.map((b) => new Date(b.startAt).toISOString()).join(', ')}

And these available slots: ${availableSlots.map((s) => s.start.toISOString()).join(', ')}

Suggest the top 3 best slots considering:
1. Customer preference patterns (if any)
2. Avoiding back-to-back bookings (buffer)
3. Preferring mid-morning or early afternoon
4. Avoiding very early or very late slots

Return JSON only:
{
  "recommendedSlots": ["ISO date strings"],
  "reasoning": "brief explanation"
}`;

    try {
      const aiResponse = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'calendar_suggest',
        {
          messages: [{ role: 'system', content: prompt }],
          maxTokens: 300,
          temperature: 0.2,
        },
      );

      const content = aiResponse.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      let reasoning = 'Based on availability and business hours';

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        reasoning = parsed.reasoning ?? reasoning;
        if (Array.isArray(parsed.recommendedSlots)) {
          const recommended = parsed.recommendedSlots as string[];
          const sorted = availableSlots.sort((a, b) => {
            const aIdx = recommended.indexOf(a.start.toISOString());
            const bIdx = recommended.indexOf(b.start.toISOString());
            if (aIdx === -1) return 1;
            if (bIdx === -1) return -1;
            return aIdx - bIdx;
          });

          await this.executionLog.log({
            businessId,
            action: 'calendar.suggest_slots',
            toolName: undefined,
            mode: 'advisory',
            actor: 'ai',
            success: true,
            durationMs: Date.now() - startTime,
            inputSummary: { durationMinutes, preferredDate: preferredDate?.toISOString() },
            outputSummary: { slotsFound: sorted.length, reasoning },
          }).catch(() => {});

          return { slots: sorted.slice(0, 5), reasoning };
        }
      }
    } catch (err) {
      this.logger.warn(`AI slot suggestion failed: ${(err as Error).message}`);
    }

    return { slots: availableSlots.slice(0, 5), reasoning: 'Based on availability and business hours' };
  }

  private async checkGoogleCalendarFreeBusy(
    businessId: string,
    accessToken: string,
    calendarId: string,
    start: Date,
    end: Date,
    ignoreEventId?: string,
  ): Promise<{ available: boolean; conflicts: CalendarConflict[] }> {
    const body = {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: calendarId }],
    };

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Google Calendar freeBusy failed: ${error}`);
    }

    const data = await res.json() as {
      calendars?: Record<string, { busy: Array<{ start: string; end: string }> }>;
    };

    const busy = data.calendars?.[calendarId]?.busy ?? [];
    const conflicts: CalendarConflict[] = [];

    for (const b of busy) {
      const busyStart = new Date(b.start);
      const busyEnd = new Date(b.end);

      // Check overlap
      if (start < busyEnd && end > busyStart) {
        const overlapStart = start > busyStart ? start : busyStart;
        const overlapEnd = end < busyEnd ? end : busyEnd;
        const overlapMinutes = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000);

        conflicts.push({
          existingEvent: { title: 'Google Calendar Event', start: busyStart, end: busyEnd },
          proposedStart: start,
          proposedEnd: end,
          overlapMinutes,
        });
      }
    }

    return { available: conflicts.length === 0, conflicts };
  }

  private async checkInternalCalendarConflicts(
    businessId: string,
    start: Date,
    end: Date,
    ignoreEventId?: string,
  ): Promise<CalendarConflict[]> {
    const where: any = {
      businessId,
      status: { notIn: ['cancelled', 'declined'] },
      OR: [
        { startAt: { lte: end, gte: start } },
        { endAt: { gte: start, lte: end } },
        { AND: [{ startAt: { lte: start } }, { endAt: { gte: end } }] },
      ],
    };

    if (ignoreEventId) {
      where.NOT = { id: ignoreEventId };
    }

    const events = await this.prisma.client.calendarEvent.findMany({
      where,
      select: { id: true, title: true, startAt: true, endAt: true },
    });

    return events.map((ev) => {
      const evStart = new Date(ev.startAt);
      const evEnd = new Date(ev.endAt ?? ev.startAt);
      const overlapStart = start > evStart ? start : evStart;
      const overlapEnd = end < evEnd ? end : evEnd;
      return {
        existingEvent: { title: ev.title ?? 'Scheduled Event', start: evStart, end: evEnd },
        proposedStart: start,
        proposedEnd: end,
        overlapMinutes: Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000)),
      };
    }).filter((c) => c.overlapMinutes > 0);
  }
}

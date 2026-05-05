import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CALENDAR_EVENT_DEFAULT_COLORS,
  CalendarEventInput,
  CalendarSourceType,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * CalendarProjectionService
 *
 * Generic helper that any source module (bookings, marketing, CRM, revenue,
 * projects, orders, ...) can call to materialize one of its rows into the
 * canonical `CalendarEvent` table. The contract is intentionally narrow so
 * source modules don't depend on calendar internals:
 *
 *   - upsertFromSource(input) — idempotent insert/update keyed by
 *     (businessId, sourceType, sourceId).
 *   - removeForSource({ businessId, sourceType, sourceId }) — soft-delete
 *     the projection when its origin is gone.
 *   - upsertManyFromSource(items) — convenience for backfill.
 */
@Injectable()
export class CalendarProjectionService {
  private readonly logger = new Logger(CalendarProjectionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async upsertFromSource(input: CalendarEventInput) {
    const data = this.normalize(input);
    return this.prisma.client.calendarEvent.upsert({
      where: {
        businessId_sourceType_sourceId: {
          businessId: data.businessId,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
        },
      },
      create: data,
      update: {
        title: data.title,
        description: data.description,
        type: data.type,
        module: data.module,
        startAt: data.startAt,
        endAt: data.endAt,
        allDay: data.allDay,
        timezone: data.timezone,
        status: data.status,
        priority: data.priority,
        color: data.color,
        visibility: data.visibility,
        sourceUrl: data.sourceUrl,
        contactId: data.contactId,
        staffId: data.staffId,
        assigneeId: data.assigneeId,
        amount: data.amount,
        currency: data.currency,
        meta: data.meta,
        deletedAt: null,
      },
    });
  }

  async upsertManyFromSource(inputs: CalendarEventInput[]): Promise<number> {
    let count = 0;
    for (const input of inputs) {
      try {
        await this.upsertFromSource(input);
        count += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to project ${input.sourceType}:${input.sourceId} for business ${input.businessId}: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }

  async removeForSource(args: {
    businessId: string;
    sourceType: CalendarSourceType;
    sourceId: string;
  }) {
    return this.prisma.client.calendarEvent.updateMany({
      where: {
        businessId: args.businessId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Remove every projection for a given (businessId, sourceType) whose
   * sourceId is NOT in `keepIds`. Useful for backfill reconciliation.
   */
  async pruneMissing(args: {
    businessId: string;
    sourceType: CalendarSourceType;
    keepIds: string[];
  }) {
    return this.prisma.client.calendarEvent.updateMany({
      where: {
        businessId: args.businessId,
        sourceType: args.sourceType,
        sourceId: { notIn: args.keepIds.length ? args.keepIds : ['__none__'] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
  }

  private normalize(input: CalendarEventInput): Prisma.CalendarEventUncheckedCreateInput {
    const startAt = input.startAt;
    const endAt = input.endAt ?? null;
    const color = input.color ?? CALENDAR_EVENT_DEFAULT_COLORS[input.type] ?? null;
    return {
      businessId: input.businessId,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      module: input.module,
      startAt,
      endAt,
      allDay: input.allDay ?? false,
      timezone: input.timezone ?? null,
      status: input.status ?? 'SCHEDULED',
      priority: input.priority ?? 'NORMAL',
      color,
      visibility: input.visibility ?? 'TEAM',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl ?? null,
      contactId: input.contactId ?? null,
      staffId: input.staffId ?? null,
      assigneeId: input.assigneeId ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      meta: (input.meta ?? null) as Prisma.InputJsonValue | null,
      syncStatus: 'LOCAL',
    };
  }
}

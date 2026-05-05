import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CALENDAR_EVENT_DEFAULT_COLORS,
  CalendarEventInput,
  CalendarSourceType,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

type CalendarStatus = 'SCHEDULED' | 'TENTATIVE' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'OVERDUE' | 'FAILED';

function mapEventStatusToBooking(status: CalendarStatus): string {
  switch (status) {
    case 'TENTATIVE':
      return 'PENDING';
    case 'CONFIRMED':
    case 'IN_PROGRESS':
      return 'CONFIRMED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
    case 'FAILED':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

function mapEventStatusToTask(status: CalendarStatus): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
    case 'FAILED':
      return 'CANCELLED';
    default:
      return 'OPEN';
  }
}

function mapEventStatusToSocialPost(status: CalendarStatus): string {
  switch (status) {
    case 'TENTATIVE':
      return 'DRAFT';
    case 'COMPLETED':
      return 'POSTED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'DRAFT';
    default:
      return 'SCHEDULED';
  }
}

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
   * Patch the originating row for a CalendarEvent and re-project. Used by
   * the calendar API when a UI surface reschedules / completes / cancels an
   * event without going to the source module first. Only a small set of
   * source types (those that own first-class scheduled rows) are supported.
   * Source modules that don't have a writable schedule (invoice_overdue,
   * marketplace_order, ...) raise an error so callers can show a clearer
   * message.
   */
  async applyPatchToSource(args: {
    businessId: string;
    sourceType: CalendarSourceType;
    sourceId: string;
    patch: {
      startAt?: Date | null;
      endAt?: Date | null;
      status?: 'SCHEDULED' | 'TENTATIVE' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'OVERDUE' | 'FAILED';
      title?: string;
      description?: string | null;
    };
    soft?: boolean;
  }): Promise<void> {
    const { businessId, sourceType, sourceId, patch, soft } = args;
    const client = this.prisma.client;
    const now = new Date();

    switch (sourceType) {
      case 'booking': {
        if (soft) {
          await client.booking.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data: { status: 'CANCELLED', deletedAt: now },
          });
          return;
        }
        const data: Record<string, unknown> = {};
        if (patch.startAt) data.startTime = patch.startAt;
        if (patch.endAt) data.endTime = patch.endAt;
        if (patch.status) {
          data.status = mapEventStatusToBooking(patch.status);
        }
        if (patch.description !== undefined) data.notes = patch.description;
        if (Object.keys(data).length) {
          await client.booking.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data,
          });
        }
        return;
      }

      case 'contact_task': {
        if (soft) {
          await client.contactTask.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data: { status: 'CANCELLED', deletedAt: now },
          });
          return;
        }
        const data: Record<string, unknown> = {};
        if (patch.startAt !== undefined) data.dueDate = patch.startAt;
        if (patch.title !== undefined) data.title = patch.title;
        if (patch.status) {
          const mapped = mapEventStatusToTask(patch.status);
          data.status = mapped;
          if (mapped === 'COMPLETED') data.completedAt = now;
        }
        if (Object.keys(data).length) {
          await client.contactTask.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data,
          });
        }
        return;
      }

      case 'project_task': {
        if (soft) {
          await client.projectTask.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data: { isCompleted: false, deletedAt: now },
          });
          return;
        }
        const data: Record<string, unknown> = {};
        if (patch.startAt !== undefined) data.dueDate = patch.startAt;
        if (patch.title !== undefined) data.title = patch.title;
        if (patch.description !== undefined) data.description = patch.description;
        if (patch.status) {
          data.isCompleted = patch.status === 'COMPLETED';
        }
        if (Object.keys(data).length) {
          await client.projectTask.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data,
          });
        }
        return;
      }

      case 'social_post': {
        if (soft) {
          await client.socialPost.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data: { status: 'DRAFT', deletedAt: now },
          });
          return;
        }
        const data: Record<string, unknown> = {};
        if (patch.startAt !== undefined) data.scheduledAt = patch.startAt;
        if (patch.description !== undefined && patch.description !== null) {
          data.content = patch.description;
        }
        if (patch.status) {
          data.status = mapEventStatusToSocialPost(patch.status);
        }
        if (Object.keys(data).length) {
          await client.socialPost.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data,
          });
        }
        return;
      }

      case 'project': {
        if (soft) return; // projects aren't deleted from the calendar surface
        const data: Record<string, unknown> = {};
        if (patch.startAt !== undefined) data.dueDate = patch.startAt;
        if (patch.title !== undefined) data.name = patch.title;
        if (patch.description !== undefined) data.description = patch.description;
        if (patch.status === 'COMPLETED') data.status = 'COMPLETED';
        if (Object.keys(data).length) {
          await client.project.updateMany({
            where: { id: sourceId, businessId, deletedAt: null },
            data,
          });
        }
        return;
      }

      case 'google_event':
      case 'activity':
      case 'invoice':
      case 'invoice_overdue':
      case 'quote':
      case 'recurring_invoice':
      case 'marketplace_order':
      case 'shipment':
      case 'email_campaign':
        // Read-only or owned by another sub-system — calendar surface
        // shouldn't mutate the source row directly.
        throw new Error(
          `Source type "${sourceType}" cannot be edited from the calendar surface`,
        );
    }
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

  /** Look up a CalendarEvent by id (skipping soft-deleted rows). */
  async findByIdWithBusiness(eventId: string) {
    return this.prisma.client.calendarEvent.findFirst({
      where: { id: eventId, deletedAt: null },
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
      meta: (input.meta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      syncStatus: 'LOCAL',
    };
  }
}

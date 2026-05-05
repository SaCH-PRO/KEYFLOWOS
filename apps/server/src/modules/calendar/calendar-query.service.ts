import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CALENDAR_EVENT_MODULES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  CALENDAR_SOURCE_TYPES,
  CalendarEventInput,
  CalendarEventModule,
  CalendarEventStatus,
  CalendarEventType,
  CalendarSourceType,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CalendarPermissionService } from './calendar-permission.service';
import { CalendarProjectionService } from './calendar-projection.service';

export interface CalendarFilters {
  start?: Date;
  end?: Date;
  modules?: CalendarEventModule[];
  types?: CalendarEventType[];
  statuses?: CalendarEventStatus[];
  contactId?: string;
  staffId?: string;
  assigneeId?: string;
  sourceType?: CalendarSourceType;
  sourceId?: string;
  hasRevenue?: boolean;
  synced?: boolean;
  view?: 'agenda' | 'day' | 'week' | 'month';
  includeTimeline?: boolean;
  includeExternal?: boolean;
  limit?: number;
  cursor?: string;
}

export const MAX_EVENTS_RETURNED = 1000;
export const DEFAULT_PAGE_LIMIT = 200;

interface ListResult {
  events: ReturnedEvent[];
  total: number;
  truncated: boolean;
  cap: number;
  limit: number;
  nextCursor: string | null;
}

export interface ReturnedEvent {
  id: string;
  businessId: string;
  title: string;
  description: string | null;
  type: string;
  module: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timezone: string | null;
  status: string;
  priority: string;
  color: string | null;
  visibility: string;
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  contactId: string | null;
  staffId: string | null;
  assigneeId: string | null;
  amount: number | null;
  currency: string | null;
  meta: Prisma.JsonValue | null;
  syncStatus: string;
  googleEventId: string | null;
  googleCalendarId: string | null;
  lastSyncedAt: Date | null;
  syncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CalendarQueryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarPermissionService)
    private readonly permissions: CalendarPermissionService,
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
  ) {}

  // ----- Where-builder -------------------------------------------------

  async buildWhere(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    filters: CalendarFilters,
  ): Promise<Prisma.CalendarEventWhereInput> {
    const { where: visibility } = await this.permissions.buildVisibilityWhere(
      businessId,
      userId,
      userRole,
    );

    const where: Prisma.CalendarEventWhereInput = {
      businessId,
      deletedAt: null,
    };

    // Date range — startAt within [start, end). End is exclusive so callers
    // can pass the next-day midnight to get a single full day.
    if (filters.start && filters.end) {
      where.startAt = { gte: filters.start, lt: filters.end };
    } else if (filters.start) {
      where.startAt = { gte: filters.start };
    } else if (filters.end) {
      where.startAt = { lt: filters.end };
    }

    if (filters.modules?.length) where.module = { in: filters.modules };
    if (filters.types?.length) where.type = { in: filters.types };
    if (filters.statuses?.length) where.status = { in: filters.statuses };
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.staffId) where.staffId = filters.staffId;
    if (filters.assigneeId) where.assigneeId = filters.assigneeId;
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.sourceId) where.sourceId = filters.sourceId;

    if (filters.hasRevenue === true) {
      where.amount = { not: null, gt: 0 };
    } else if (filters.hasRevenue === false) {
      where.OR = [{ amount: null }, { amount: { lte: 0 } }];
    }

    if (filters.synced === true) {
      where.syncStatus = 'SYNCED';
    } else if (filters.synced === false) {
      where.syncStatus = { in: ['LOCAL', 'PENDING', 'ERROR', 'DISABLED'] };
    }

    if (filters.includeExternal === false) {
      where.sourceType = { not: 'google_event' };
    }

    if (filters.includeTimeline === false) {
      // Timeline = activity-log style audit events; exclude the ACTIVITY
      // module + activity sourceType in that case.
      where.module = where.module
        ? { ...(where.module as Prisma.StringFilter), not: 'ACTIVITY' }
        : { not: 'ACTIVITY' };
    }

    if (visibility) {
      const existingAnd = (where.AND as Prisma.CalendarEventWhereInput[] | undefined) ?? [];
      where.AND = [
        ...existingAnd,
        visibility as Prisma.CalendarEventWhereInput,
      ];
    }

    return where;
  }

  // ----- Endpoints -----------------------------------------------------

  async listEvents(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    filters: CalendarFilters,
  ): Promise<ListResult> {
    const where = await this.buildWhere(businessId, userId, userRole, filters);

    // Page size: caller-controlled, with a hard cap of MAX_EVENTS_RETURNED so
    // a malicious client can't exfiltrate the entire calendar in one shot.
    const requested =
      filters.limit && Number.isFinite(filters.limit) && filters.limit > 0
        ? Math.floor(filters.limit)
        : DEFAULT_PAGE_LIMIT;
    const limit = Math.min(requested, MAX_EVENTS_RETURNED);

    const cursor = filters.cursor ? { id: filters.cursor } : undefined;

    const [total, events] = await Promise.all([
      this.prisma.client.calendarEvent.count({ where }),
      this.prisma.client.calendarEvent.findMany({
        where,
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor, skip: 1 } : {}),
      }),
    ]);

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    // `truncated` reflects whether the *unpaged* total exceeds the hard cap.
    const truncated = total > MAX_EVENTS_RETURNED;
    return {
      events: page as ReturnedEvent[],
      total,
      truncated,
      cap: MAX_EVENTS_RETURNED,
      limit,
      nextCursor,
    };
  }

  async agenda(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    day: string,
  ): Promise<ListResult> {
    const date = parseDay(day);
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return this.listEvents(businessId, userId, userRole, {
      start: date,
      end: next,
    });
  }

  // The full categorized conflict scan lives in CalendarConflictService
  // (C7). This method is kept as a lightweight overlap-only fallback used
  // by tests that don't wire the conflict service.
  async conflicts(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    from: Date,
    to: Date,
  ) {
    const where = await this.buildWhere(businessId, userId, userRole, {
      start: from,
      end: to,
    });

    const events = (await this.prisma.client.calendarEvent.findMany({
      where: { ...where, endAt: { not: null } },
      orderBy: { startAt: 'asc' },
      take: MAX_EVENTS_RETURNED,
    })) as ReturnedEvent[];

    type Pair = { left: ReturnedEvent; right: ReturnedEvent; reason: string };
    const pairs: Pair[] = [];
    const scopes = new Map<string, ReturnedEvent[]>();
    const push = (key: string, ev: ReturnedEvent) => {
      const arr = scopes.get(key) ?? [];
      arr.push(ev);
      scopes.set(key, arr);
    };
    for (const ev of events) {
      if (ev.staffId) push(`staff:${ev.staffId}`, ev);
      if (ev.assigneeId) push(`assignee:${ev.assigneeId}`, ev);
      if (ev.contactId) push(`contact:${ev.contactId}`, ev);
    }
    const seen = new Set<string>();
    for (const [scope, list] of scopes) {
      for (let i = 0; i < list.length; i += 1) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j += 1) {
          const b = list[j];
          const aEnd = a.endAt!.getTime();
          const bStart = b.startAt.getTime();
          if (bStart >= aEnd) break;
          const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push({ left: a, right: b, reason: scope.split(':')[0] });
        }
      }
    }
    return { conflicts: pairs, scanned: events.length };
  }

  async insights(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    from: Date,
    to: Date,
  ) {
    const where = await this.buildWhere(businessId, userId, userRole, {
      start: from,
      end: to,
    });

    const grouped = await this.prisma.client.calendarEvent.groupBy({
      by: ['module', 'type'],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    });

    const totalEvents = grouped.reduce(
      (sum, g) => sum + (g._count?._all ?? 0),
      0,
    );
    const totalRevenue = grouped.reduce(
      (sum, g) => sum + (g._sum?.amount ?? 0),
      0,
    );

    return {
      from,
      to,
      totalEvents,
      totalRevenue,
      byModule: rollUp(grouped, 'module'),
      byType: rollUp(grouped, 'type'),
      // Placeholder until C7 fills in conflicts / load / focus-time hints
      // generated by the time-intelligence service.
      hints: [] as { kind: string; message: string }[],
    };
  }

  // ----- Manual events -------------------------------------------------

  async createManualEvent(
    businessId: string,
    userId: string,
    body: {
      title: string;
      description?: string | null;
      type: CalendarEventType;
      module?: CalendarEventModule;
      startAt: string;
      endAt?: string | null;
      allDay?: boolean;
      timezone?: string | null;
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      visibility?: 'PRIVATE' | 'TEAM' | 'PUBLIC';
      color?: string | null;
      contactId?: string | null;
      assigneeId?: string | null;
      meta?: Record<string, unknown> | null;
    },
  ): Promise<ReturnedEvent> {
    if (!CALENDAR_EVENT_TYPES.includes(body.type as CalendarEventType)) {
      throw new BadRequestException(`Unsupported event type: ${body.type}`);
    }
    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt');
    }
    let endAt: Date | null = null;
    if (body.endAt) {
      endAt = new Date(body.endAt);
      if (Number.isNaN(endAt.getTime())) {
        throw new BadRequestException('Invalid endAt');
      }
      if (endAt.getTime() <= startAt.getTime()) {
        throw new BadRequestException('endAt must be after startAt');
      }
    }

    // Manual sourceId is generated client-side as a stable id derived from
    // a uuid-like prefix so subsequent PATCH/DELETE keep working.
    const sourceId = `manual_${cryptoId()}`;

    const input: CalendarEventInput = {
      businessId,
      title: body.title,
      description: body.description ?? null,
      type: body.type,
      module: body.module ?? defaultModuleForType(body.type),
      startAt,
      endAt,
      allDay: body.allDay ?? false,
      timezone: body.timezone ?? null,
      priority: body.priority ?? 'NORMAL',
      visibility: body.visibility ?? 'TEAM',
      color: body.color ?? null,
      sourceType: 'manual',
      sourceId,
      sourceUrl: null,
      contactId: body.contactId ?? null,
      staffId: userId,
      assigneeId: body.assigneeId ?? userId,
      meta: { ...(body.meta ?? {}), manual: true, createdBy: userId },
    };

    const ev = await this.projection.upsertFromSource(input);
    return ev as ReturnedEvent;
  }

  async patchEvent(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    eventId: string,
    patch: {
      startAt?: string;
      endAt?: string | null;
      status?: CalendarEventStatus;
      title?: string;
      description?: string | null;
    },
  ): Promise<ReturnedEvent> {
    const event = await this.requireVisibleEvent(
      businessId,
      userId,
      userRole,
      eventId,
    );

    await this.permissions.assertCanMutate(businessId, userId, userRole, event);

    const startAt = patch.startAt ? new Date(patch.startAt) : undefined;
    if (startAt && Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt');
    }
    let endAt: Date | null | undefined;
    if (patch.endAt === null) endAt = null;
    else if (typeof patch.endAt === 'string') {
      endAt = new Date(patch.endAt);
      if (Number.isNaN(endAt.getTime())) {
        throw new BadRequestException('Invalid endAt');
      }
      const baseStart = startAt ?? event.startAt;
      if (endAt.getTime() <= baseStart.getTime()) {
        throw new BadRequestException('endAt must be after startAt');
      }
    }

    if (patch.status && !CALENDAR_EVENT_STATUSES.includes(patch.status)) {
      throw new BadRequestException(`Unsupported status: ${patch.status}`);
    }

    // 1. Push to source row when supported. Manual events have no separate
    //    source row; for everything else we propagate. Read-only sources
    //    surface a 4xx so the caller can't silently desync the projection.
    if (event.sourceType !== 'manual') {
      try {
        await this.projection.applyPatchToSource({
          businessId,
          sourceType: event.sourceType as CalendarSourceType,
          sourceId: event.sourceId,
          patch: {
            startAt,
            endAt,
            status: patch.status,
            title: patch.title,
            description: patch.description,
          },
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('cannot be edited')) {
          throw new BadRequestException(
            `Events from sourceType "${event.sourceType}" cannot be edited via the calendar API`,
          );
        }
        throw err;
      }
    }

    // 2. Always also update the projection so the UI sees the new values
    //    immediately even if the source-module re-projection lag is high.
    const updated = await this.prisma.client.calendarEvent.update({
      where: { id: eventId },
      data: {
        ...(startAt ? { startAt } : {}),
        ...(endAt !== undefined ? { endAt } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
      },
    });
    return updated as ReturnedEvent;
  }

  async cancelEvent(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    eventId: string,
  ): Promise<{ id: string; cancelled: true }> {
    const event = await this.requireVisibleEvent(
      businessId,
      userId,
      userRole,
      eventId,
    );
    await this.permissions.assertCanMutate(businessId, userId, userRole, event);

    if (event.sourceType !== 'manual') {
      try {
        await this.projection.applyPatchToSource({
          businessId,
          sourceType: event.sourceType as CalendarSourceType,
          sourceId: event.sourceId,
          patch: { status: 'CANCELLED' },
          soft: true,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('cannot be edited')) {
          throw new BadRequestException(
            `Events from sourceType "${event.sourceType}" cannot be cancelled via the calendar API`,
          );
        }
        throw err;
      }
    }

    await this.prisma.client.calendarEvent.update({
      where: { id: eventId },
      data: { status: 'CANCELLED', deletedAt: new Date() },
    });

    return { id: eventId, cancelled: true };
  }

  // ----- Helpers -------------------------------------------------------

  /**
   * Fetch an event scoped to the caller's read visibility. Returning 404
   * (rather than 403) keeps the existence of unrelated events private and
   * matches the behaviour of the read endpoints — staff who can't see an
   * event also can't mutate it by guessing its id.
   */
  private async requireVisibleEvent(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    eventId: string,
  ) {
    const where = await this.buildWhere(businessId, userId, userRole, {});
    const event = await this.prisma.client.calendarEvent.findFirst({
      where: { ...where, id: eventId },
    });
    if (!event) throw new NotFoundException('Calendar event not found');
    return event;
  }
}

function parseDay(day: string): Date {
  // Expect YYYY-MM-DD; treat as UTC midnight so range maths is deterministic.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestException('day must be YYYY-MM-DD');
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('day is not a valid date');
  }
  return date;
}

function defaultModuleForType(type: CalendarEventType): CalendarEventModule {
  switch (type) {
    case 'BOOKING':
      return 'BOOKINGS';
    case 'CONTENT_POST':
    case 'EMAIL_CAMPAIGN':
      return 'MARKETING';
    case 'CONTACT_TASK':
    case 'FOLLOW_UP':
      return 'CRM';
    case 'INVOICE_DUE':
    case 'INVOICE_OVERDUE':
    case 'QUOTE_EXPIRY':
    case 'RECURRING_INVOICE':
      return 'REVENUE';
    case 'PROJECT_TASK':
      return 'PROJECTS';
    case 'SHIPMENT':
    case 'REORDER':
      return 'ORDERS';
    case 'EXTERNAL_GOOGLE_EVENT':
      return 'EXTERNAL';
    case 'ACTIVITY_LOG':
    default:
      return 'ACTIVITY';
  }
}

function rollUp(
  rows: { module: string; type: string; _count?: { _all: number }; _sum?: { amount: number | null } }[],
  field: 'module' | 'type',
): { key: string; count: number; revenue: number }[] {
  const map = new Map<string, { key: string; count: number; revenue: number }>();
  for (const r of rows) {
    const key = r[field];
    const cur = map.get(key) ?? { key, count: 0, revenue: 0 };
    cur.count += r._count?._all ?? 0;
    cur.revenue += r._sum?.amount ?? 0;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function cryptoId(): string {
  // Avoid extra deps — Node 18+ provides crypto.randomUUID.
  // Fall back to a 12-char base36 seed if randomUUID isn't available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const c = require('node:crypto') as { randomUUID?: () => string };
    if (c.randomUUID) return c.randomUUID().replace(/-/g, '');
  } catch {
    /* ignore */
  }
  return Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export const SUPPORTED_FILTER_VALUES = {
  modules: CALENDAR_EVENT_MODULES,
  types: CALENDAR_EVENT_TYPES,
  statuses: CALENDAR_EVENT_STATUSES,
  sourceTypes: CALENDAR_SOURCE_TYPES,
};

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CalendarPermissionService,
} from './calendar-permission.service';
import {
  CalendarQueryService,
  ReturnedEvent,
} from './calendar-query.service';

export type CalendarConflictKind =
  | 'staff_double_booking'
  | 'assignee_double_booking'
  | 'contact_double_booking'
  | 'content_overload'
  | 'task_overload'
  | 'invoice_due_no_reminder'
  | 'quote_expiring_no_followup'
  | 'customer_unpaid_invoice'
  | 'shipment_late';

export type CalendarConflictSeverity = 'low' | 'medium' | 'high';

export interface CalendarConflict {
  kind: CalendarConflictKind;
  severity: CalendarConflictSeverity;
  message: string;
  eventIds: string[];
  // Backwards-compatible (used by Time Intelligence rail). Populated for
  // pairwise overlap conflicts only.
  left?: ReturnedEvent;
  right?: ReturnedEvent;
  reason?: string;
}

const CONTENT_OVERLOAD_THRESHOLD = 3;
const TASK_OVERLOAD_THRESHOLD = 8;

@Injectable()
export class CalendarConflictService {
  private readonly logger = new Logger(CalendarConflictService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarPermissionService)
    private readonly permissions: CalendarPermissionService,
    @Inject(CalendarQueryService)
    private readonly query: CalendarQueryService,
  ) {}

  async detect(
    businessId: string,
    userId: string,
    userRole: string | undefined,
    from: Date,
    to: Date,
  ): Promise<{ conflicts: CalendarConflict[]; scanned: number }> {
    const where = await this.query.buildWhere(businessId, userId, userRole, {
      start: from,
      end: to,
    });

    const events = (await this.prisma.client.calendarEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
      take: 1000,
    })) as ReturnedEvent[];

    const conflicts: CalendarConflict[] = [];

    conflicts.push(...this.detectOverlaps(events));
    conflicts.push(...this.detectContentOverload(events));
    conflicts.push(...this.detectTaskOverload(events));
    conflicts.push(...this.detectInvoiceDueWithoutReminder(events));
    conflicts.push(...this.detectQuoteExpiringNoFollowup(events));

    return { conflicts, scanned: events.length };
  }

  // ----- Detectors -----------------------------------------------------

  private detectOverlaps(events: ReturnedEvent[]): CalendarConflict[] {
    const timed = events.filter((e) => e.endAt !== null);
    const conflicts: CalendarConflict[] = [];

    const scopes: Array<{
      key: keyof Pick<ReturnedEvent, 'staffId' | 'assigneeId' | 'contactId'>;
      kind: CalendarConflictKind;
      reason: string;
    }> = [
      { key: 'staffId', kind: 'staff_double_booking', reason: 'staff' },
      { key: 'assigneeId', kind: 'assignee_double_booking', reason: 'assignee' },
      { key: 'contactId', kind: 'contact_double_booking', reason: 'contact' },
    ];

    const seen = new Set<string>();
    for (const scope of scopes) {
      const groups = new Map<string, ReturnedEvent[]>();
      for (const ev of timed) {
        const v = ev[scope.key];
        if (!v) continue;
        const arr = groups.get(v) ?? [];
        arr.push(ev);
        groups.set(v, arr);
      }
      for (const list of groups.values()) {
        list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
        for (let i = 0; i < list.length; i += 1) {
          const a = list[i];
          for (let j = i + 1; j < list.length; j += 1) {
            const b = list[j];
            const aEnd = a.endAt!.getTime();
            if (b.startAt.getTime() >= aEnd) break;
            const dedup = `${scope.kind}:${a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`}`;
            if (seen.has(dedup)) continue;
            seen.add(dedup);
            conflicts.push({
              kind: scope.kind,
              severity: 'high',
              message: `${this.label(scope.reason)} double-booked: "${a.title}" overlaps "${b.title}"`,
              eventIds: [a.id, b.id],
              left: a,
              right: b,
              reason: scope.reason,
            });
          }
        }
      }
    }
    return conflicts;
  }

  private detectContentOverload(events: ReturnedEvent[]): CalendarConflict[] {
    const buckets = new Map<string, ReturnedEvent[]>();
    for (const ev of events) {
      if (ev.type !== 'CONTENT_POST' && ev.type !== 'EMAIL_CAMPAIGN') continue;
      const key = ev.startAt.toISOString().slice(0, 10);
      const arr = buckets.get(key) ?? [];
      arr.push(ev);
      buckets.set(key, arr);
    }
    const conflicts: CalendarConflict[] = [];
    for (const [day, list] of buckets) {
      if (list.length > CONTENT_OVERLOAD_THRESHOLD) {
        conflicts.push({
          kind: 'content_overload',
          severity: 'medium',
          message: `${list.length} content items scheduled for ${day} (threshold ${CONTENT_OVERLOAD_THRESHOLD})`,
          eventIds: list.map((e) => e.id),
        });
      }
    }
    return conflicts;
  }

  private detectTaskOverload(events: ReturnedEvent[]): CalendarConflict[] {
    const buckets = new Map<string, ReturnedEvent[]>();
    for (const ev of events) {
      if (
        ev.type !== 'CONTACT_TASK' &&
        ev.type !== 'PROJECT_TASK' &&
        ev.type !== 'FOLLOW_UP'
      )
        continue;
      const owner = ev.assigneeId ?? ev.staffId ?? 'unassigned';
      const day = ev.startAt.toISOString().slice(0, 10);
      const key = `${owner}:${day}`;
      const arr = buckets.get(key) ?? [];
      arr.push(ev);
      buckets.set(key, arr);
    }
    const conflicts: CalendarConflict[] = [];
    for (const [key, list] of buckets) {
      if (list.length > TASK_OVERLOAD_THRESHOLD) {
        const [owner, day] = key.split(':');
        conflicts.push({
          kind: 'task_overload',
          severity: 'medium',
          message: `${list.length} tasks for ${owner === 'unassigned' ? 'an unassigned owner' : owner.slice(0, 8)} on ${day} (threshold ${TASK_OVERLOAD_THRESHOLD})`,
          eventIds: list.map((e) => e.id),
        });
      }
    }
    return conflicts;
  }

  private detectInvoiceDueWithoutReminder(
    events: ReturnedEvent[],
  ): CalendarConflict[] {
    const dues = events.filter(
      (e) => e.type === 'INVOICE_DUE' || e.type === 'INVOICE_OVERDUE',
    );
    const reminders = events.filter(
      (e) => e.type === 'FOLLOW_UP' || e.type === 'CONTACT_TASK',
    );
    const conflicts: CalendarConflict[] = [];
    for (const due of dues) {
      if (!due.contactId) continue;
      const dueAt = due.startAt.getTime();
      const hasReminder = reminders.some(
        (r) =>
          r.contactId === due.contactId &&
          r.startAt.getTime() <= dueAt &&
          dueAt - r.startAt.getTime() <= 7 * 86400_000,
      );
      if (!hasReminder) {
        conflicts.push({
          kind: 'invoice_due_no_reminder',
          severity: due.type === 'INVOICE_OVERDUE' ? 'high' : 'medium',
          message: `Invoice "${due.title}" due ${due.startAt.toISOString().slice(0, 10)} has no follow-up scheduled`,
          eventIds: [due.id],
        });
      }
    }
    return conflicts;
  }

  private detectQuoteExpiringNoFollowup(
    events: ReturnedEvent[],
  ): CalendarConflict[] {
    const expiries = events.filter((e) => e.type === 'QUOTE_EXPIRY');
    const reminders = events.filter(
      (e) => e.type === 'FOLLOW_UP' || e.type === 'CONTACT_TASK',
    );
    const conflicts: CalendarConflict[] = [];
    for (const q of expiries) {
      if (!q.contactId) continue;
      const at = q.startAt.getTime();
      const hasReminder = reminders.some(
        (r) =>
          r.contactId === q.contactId &&
          r.startAt.getTime() <= at &&
          at - r.startAt.getTime() <= 3 * 86400_000,
      );
      if (!hasReminder) {
        conflicts.push({
          kind: 'quote_expiring_no_followup',
          severity: 'medium',
          message: `Quote "${q.title}" expires ${q.startAt.toISOString().slice(0, 10)} with no follow-up scheduled`,
          eventIds: [q.id],
        });
      }
    }
    return conflicts;
  }

  private label(reason: string): string {
    if (reason === 'staff') return 'Staff';
    if (reason === 'assignee') return 'Assignee';
    if (reason === 'contact') return 'Contact';
    return reason;
  }
}

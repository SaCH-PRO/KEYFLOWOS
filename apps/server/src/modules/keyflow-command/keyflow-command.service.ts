import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CalendarService } from '../bookings/calendar.service';

export type KeyflowEventKind =
  | 'booking'
  | 'contact_task'
  | 'project_task'
  | 'autopilot_task'
  | 'project_deadline'
  | 'google_event';

export interface KeyflowEvent {
  id: string;
  kind: KeyflowEventKind;
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  status?: string;
  priority?: string;
  href?: string;
  refType?: string;
  refId?: string;
  meta?: Record<string, any>;
  color?: string;
  source?: string;
}

@Injectable()
export class KeyflowCommandService {
  private readonly logger = new Logger(KeyflowCommandService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
  ) {}

  /**
   * Aggregate every time-bound item across the workspace into a single
   * unified timeline that the Keyflow Calendar can render.
   */
  async listUnifiedEvents(
    businessId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<KeyflowEvent[]> {
    const events: KeyflowEvent[] = [];

    const [bookings, contactTasks, projectTasks, autopilotTasks, projects] =
      await Promise.all([
        this.prisma.client.booking.findMany({
          where: {
            businessId,
            deletedAt: null,
            startTime: { gte: timeMin, lte: timeMax },
          },
          include: {
            contact: { select: { id: true, firstName: true, lastName: true } },
            service: { select: { id: true, name: true } },
            staff: { select: { id: true, name: true } },
          },
          orderBy: { startTime: 'asc' },
          take: 500,
        }),
        this.prisma.client.contactTask.findMany({
          where: {
            businessId,
            deletedAt: null,
            OR: [
              { dueDate: { gte: timeMin, lte: timeMax } },
              { remindAt: { gte: timeMin, lte: timeMax } },
            ],
          },
          include: { contact: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { dueDate: 'asc' },
          take: 500,
        }),
        this.prisma.client.projectTask.findMany({
          where: {
            businessId,
            deletedAt: null,
            dueDate: { gte: timeMin, lte: timeMax },
          },
          include: { project: { select: { id: true, name: true } } },
          orderBy: { dueDate: 'asc' },
          take: 500,
        }),
        this.prisma.client.autopilotTask.findMany({
          where: {
            businessId,
            OR: [
              { scheduledFor: { gte: timeMin, lte: timeMax } },
              { dueDate: { gte: timeMin, lte: timeMax } },
            ],
          },
          orderBy: { scheduledFor: 'asc' },
          take: 250,
        }),
        this.prisma.client.project.findMany({
          where: {
            businessId,
            deletedAt: null,
            dueDate: { gte: timeMin, lte: timeMax },
          },
          select: { id: true, name: true, dueDate: true, status: true },
          take: 250,
        }),
      ]);

    for (const b of bookings) {
      const contactName = [b.contact?.firstName, b.contact?.lastName].filter(Boolean).join(' ') || 'Client';
      events.push({
        id: `booking-${b.id}`,
        kind: 'booking',
        title: `${b.service?.name ?? 'Booking'} — ${contactName}`,
        description: b.notes ?? undefined,
        start: b.startTime.toISOString(),
        end: b.endTime.toISOString(),
        allDay: false,
        status: b.status,
        href: `/app/bookings?focus=${b.id}`,
        refType: 'booking',
        refId: b.id,
        color: '#3b82f6',
        source: 'bookings',
      });
    }

    for (const t of contactTasks) {
      const contactName = [t.contact?.firstName, t.contact?.lastName].filter(Boolean).join(' ');
      const when = t.dueDate ?? t.remindAt;
      if (!when) continue;
      const start = when.toISOString();
      events.push({
        id: `contact-task-${t.id}`,
        kind: 'contact_task',
        title: t.title,
        description: contactName ? `Contact: ${contactName}` : undefined,
        start,
        end: start,
        allDay: !t.dueDate,
        status: t.status,
        priority: t.priority,
        href: `/app/crm?focus=${t.contactId}`,
        refType: 'contact_task',
        refId: t.id,
        color: '#14B8A6',
        source: 'crm',
      });
    }

    for (const t of projectTasks) {
      if (!t.dueDate) continue;
      const start = t.dueDate.toISOString();
      events.push({
        id: `project-task-${t.id}`,
        kind: 'project_task',
        title: t.title,
        description: t.project ? `Project: ${t.project.name}` : undefined,
        start,
        end: start,
        allDay: true,
        status: t.isCompleted ? 'COMPLETED' : 'OPEN',
        priority: t.priority,
        href: `/app/projects?focus=${t.projectId}`,
        refType: 'project_task',
        refId: t.id,
        color: '#a78bfa',
        source: 'projects',
      });
    }

    for (const t of autopilotTasks) {
      const when = t.scheduledFor ?? t.dueDate;
      if (!when) continue;
      const start = when.toISOString();
      events.push({
        id: `autopilot-task-${t.id}`,
        kind: 'autopilot_task',
        title: t.title,
        description: t.description ?? undefined,
        start,
        end: start,
        allDay: !t.scheduledFor,
        status: t.status,
        priority: t.priority,
        href: `/app/autopilot?focus=${t.id}`,
        refType: 'autopilot_task',
        refId: t.id,
        color: '#F97316',
        source: 'autopilot',
      });
    }

    for (const p of projects) {
      if (!p.dueDate) continue;
      const start = p.dueDate.toISOString();
      events.push({
        id: `project-deadline-${p.id}`,
        kind: 'project_deadline',
        title: `${p.name} — deadline`,
        start,
        end: start,
        allDay: true,
        status: p.status ?? undefined,
        href: `/app/projects?focus=${p.id}`,
        refType: 'project',
        refId: p.id,
        color: '#f59e0b',
        source: 'projects',
      });
    }

    try {
      const googleEvents = await this.calendar.listCalendarEvents(
        businessId,
        timeMin.toISOString(),
        timeMax.toISOString(),
      );
      for (const g of googleEvents) {
        events.push({
          id: `google-${g.id}`,
          kind: 'google_event',
          title: g.summary,
          description: g.description,
          start: g.start,
          end: g.end,
          allDay: g.allDay,
          href: g.htmlLink,
          refType: 'google_event',
          refId: g.id,
          color: '#34a853',
          source: 'google',
          meta: {
            location: g.location,
            organizer: g.organizer,
            attendees: g.attendees ?? [],
            allDay: g.allDay,
          },
        });
      }
    } catch (err: any) {
      this.logger.debug(`Google calendar unavailable: ${(err as Error).message}`);
    }

    events.sort((a, b) => a.start.localeCompare(b.start));
    return events;
  }
}

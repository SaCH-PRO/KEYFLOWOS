import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CalendarService } from '../bookings/calendar.service';
import { CalendarProjectionService } from './calendar-projection.service';

export const CALENDAR_SYNC_EVENT_TYPES = [
  'booking',
  'contact_task',
  'invoice_due',
  'quote_expiry',
  'content_post',
] as const;
export type CalendarSyncEventTypeKey = (typeof CALENDAR_SYNC_EVENT_TYPES)[number];

export interface CalendarSyncSettings {
  booking: boolean;
  contact_task: boolean;
  invoice_due: boolean;
  quote_expiry: boolean;
  content_post: boolean;
  pullExternal: boolean;
  defaultVisibility: 'PRIVATE' | 'TEAM' | 'PUBLIC';
  lastResyncAt: string | null;
  lastResyncError: string | null;
  consecutiveErrors: number;
}

const DEFAULT_SETTINGS: CalendarSyncSettings = {
  booking: true,
  contact_task: false,
  invoice_due: false,
  quote_expiry: false,
  content_post: false,
  pullExternal: false,
  defaultVisibility: 'TEAM',
  lastResyncAt: null,
  lastResyncError: null,
  consecutiveErrors: 0,
};

const PUSH_HORIZON_DAYS = 90;
const PULL_HORIZON_DAYS = 60;

/**
 * Platform-level Google Calendar sync orchestrator. Lives in the calendar
 * module so the connection becomes a Settings → Connections concern instead
 * of a Bookings header concern. Reuses the underlying CalendarService for
 * OAuth/HTTP plumbing while owning the per-event-type push fan-out, the
 * external pull, the per-business sync settings, and the manual resync.
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(CalendarProjectionService) private readonly projection: CalendarProjectionService,
  ) {}

  // ----- Settings -------------------------------------------------------

  async getSettings(businessId: string): Promise<CalendarSyncSettings> {
    const row = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarSyncSettings: true },
    });
    return mergeSettings(row?.calendarSyncSettings);
  }

  async patchSettings(
    businessId: string,
    patch: Partial<CalendarSyncSettings> & {
      calendarId?: string | null;
      syncDirection?: string;
      syncEnabled?: boolean;
    },
  ): Promise<CalendarSyncSettings & {
    calendarId: string | null;
    syncDirection: string;
    syncEnabled: boolean;
  }> {
    const { calendarId, syncDirection, syncEnabled, ...settingsPatch } = patch;
    if (
      calendarId !== undefined ||
      syncDirection !== undefined ||
      syncEnabled !== undefined
    ) {
      await this.calendar.updateSyncSettings(businessId, {
        calendarId,
        syncDirection,
        syncEnabled,
      });
    }

    const current = await this.getSettings(businessId);
    const next: CalendarSyncSettings = { ...current, ...settingsPatch };
    if (
      next.defaultVisibility !== 'PRIVATE' &&
      next.defaultVisibility !== 'TEAM' &&
      next.defaultVisibility !== 'PUBLIC'
    ) {
      throw new BadRequestException('Invalid defaultVisibility');
    }
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { calendarSyncSettings: next as unknown as Prisma.InputJsonValue },
    });

    const status = await this.calendar.getCalendarStatus(businessId);
    return {
      ...next,
      calendarId: status.calendarId ?? null,
      syncDirection: status.syncDirection ?? 'two_way',
      syncEnabled: status.syncEnabled ?? true,
    };
  }

  // ----- Status / OAuth -------------------------------------------------

  /**
   * Returns the consolidated status used by /app/settings/connections to
   * render the Google Calendar card. Combines core CalendarService status
   * with per-event-type settings, last resync info and open-conflict count.
   */
  async getStatus(businessId: string) {
    const [core, settings, openConflicts] = await Promise.all([
      this.calendar.getCalendarStatus(businessId),
      this.getSettings(businessId),
      this.prisma.client.calendarSyncConflict
        .count({ where: { businessId, status: 'open' } })
        .catch(() => 0),
    ]);
    return {
      connected: core.connected,
      email: core.email ?? null,
      calendarId: core.calendarId ?? null,
      syncDirection: core.syncDirection ?? 'two_way',
      syncEnabled: core.syncEnabled ?? true,
      settings,
      lastSyncedAt: settings.lastResyncAt,
      lastError: settings.lastResyncError,
      consecutiveErrors: settings.consecutiveErrors,
      openConflicts,
    };
  }

  getAuthUrl(businessId: string): string {
    return this.calendar.getAuthUrl(businessId);
  }

  verifyState(state: string): { businessId: string } | null {
    return this.calendar.verifyState(state);
  }

  async completeOAuth(businessId: string, code: string): Promise<void> {
    await this.calendar.saveCalendarCredentials(businessId, code);
  }

  async disconnect(businessId: string): Promise<void> {
    await this.calendar.disconnectCalendar(businessId);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { calendarSyncSettings: Prisma.JsonNull },
    });
  }

  async listAvailableCalendars(businessId: string) {
    return this.calendar.listAvailableCalendars(businessId);
  }

  // ----- Manual + scheduled resync --------------------------------------

  async manualResync(businessId: string): Promise<{
    pushed: number;
    pulled: number;
    errors: string[];
  }> {
    return this.runResyncCycle(businessId);
  }

  async runResyncCycle(businessId: string): Promise<{
    pushed: number;
    pulled: number;
    errors: string[];
  }> {
    const status = await this.calendar.getCalendarStatus(businessId);
    if (!status.connected) {
      return { pushed: 0, pulled: 0, errors: ['not_connected'] };
    }
    const settings = await this.getSettings(businessId);
    const errors: string[] = [];
    let pushed = 0;
    let pulled = 0;

    if (status.syncEnabled !== false && status.syncDirection !== 'pull' && status.syncDirection !== 'disabled') {
      try {
        pushed = await this.pushSelectedTypes(businessId, settings);
      } catch (err: any) {
        errors.push(`push:${(err as Error).message}`);
      }
    }

    if (
      settings.pullExternal &&
      status.syncEnabled !== false &&
      status.syncDirection !== 'push' &&
      status.syncDirection !== 'disabled'
    ) {
      try {
        pulled = await this.pullExternalEvents(businessId);
      } catch (err: any) {
        errors.push(`pull:${(err as Error).message}`);
      }
    }

    const lastError = errors.length ? errors.join('; ') : null;
    const next: CalendarSyncSettings = {
      ...settings,
      lastResyncAt: new Date().toISOString(),
      lastResyncError: lastError,
      consecutiveErrors: lastError ? settings.consecutiveErrors + 1 : 0,
    };
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { calendarSyncSettings: next as unknown as Prisma.InputJsonValue },
    });

    return { pushed, pulled, errors };
  }

  /**
   * Walks the calendar_events projection for the next PUSH_HORIZON_DAYS,
   * pushes any unsynced row whose source type is enabled in settings as a
   * Google Calendar event. Booking events go through CalendarService so the
   * existing booking <-> event linkage stays intact.
   */
  private async pushSelectedTypes(
    businessId: string,
    settings: CalendarSyncSettings,
  ): Promise<number> {
    const allowed = sourceTypesForSettings(settings);
    if (allowed.length === 0) return 0;
    const now = new Date();
    const horizon = new Date(now.getTime() + PUSH_HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.client.calendarEvent.findMany({
      where: {
        businessId,
        deletedAt: null,
        sourceType: { in: allowed },
        startAt: { gte: now, lte: horizon },
        OR: [{ syncStatus: 'LOCAL' }, { syncStatus: 'PENDING' }, { syncStatus: 'ERROR' }],
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });

    let pushed = 0;
    for (const row of rows) {
      try {
        if (row.sourceType === 'booking') {
          const eventId = await this.calendar.syncBookingToCalendar(row.sourceId, businessId);
          if (eventId) {
            await this.prisma.client.calendarEvent.update({
              where: { id: row.id },
              data: {
                syncStatus: 'SYNCED',
                googleEventId: eventId,
                lastSyncedAt: new Date(),
                syncError: null,
              },
            });
            pushed += 1;
          }
          continue;
        }
        const eventBody = projectionToGoogleEvent(row, businessId);
        if (!eventBody) continue;
        const eventId = row.googleEventId
          ? (await this.calendar.updateCalendarEvent(businessId, row.googleEventId, eventBody))
            ? row.googleEventId
            : null
          : await this.calendar.createCalendarEvent(businessId, eventBody);
        if (eventId) {
          await this.prisma.client.calendarEvent.update({
            where: { id: row.id },
            data: {
              syncStatus: 'SYNCED',
              googleEventId: eventId,
              lastSyncedAt: new Date(),
              syncError: null,
            },
          });
          pushed += 1;
        }
      } catch (err: any) {
        await this.prisma.client.calendarEvent
          .update({
            where: { id: row.id },
            data: { syncStatus: 'ERROR', syncError: (err as Error).message.slice(0, 500) },
          })
          .catch(() => undefined);
      }
    }
    return pushed;
  }

  /**
   * Pulls events from the connected Google Calendar in the PULL_HORIZON_DAYS
   * window and projects them into calendar_events as EXTERNAL_GOOGLE_EVENT
   * rows so they appear on the master calendar without colliding with any
   * KeyFlow source-of-truth row (sourceType=google_event).
   */
  private async pullExternalEvents(businessId: string): Promise<number> {
    const settings = await this.getSettings(businessId);
    const defaultVisibility = settings.defaultVisibility;
    const now = new Date();
    const horizon = new Date(now.getTime() + PULL_HORIZON_DAYS * 24 * 60 * 60 * 1000);
    const events = await this.calendar.listCalendarEvents(
      businessId,
      now.toISOString(),
      horizon.toISOString(),
    );

    let pulled = 0;
    for (const ev of events) {
      try {
        const startAt = new Date(ev.start);
        const endAt = ev.end ? new Date(ev.end) : null;
        if (Number.isNaN(startAt.getTime())) continue;
        await this.projection.upsertFromSource({
          businessId,
          title: ev.summary || '(No title)',
          description: ev.description ?? null,
          type: 'EXTERNAL_GOOGLE_EVENT',
          module: 'BOOKINGS',
          startAt,
          endAt: endAt && !Number.isNaN(endAt.getTime()) ? endAt : null,
          allDay: ev.allDay,
          status: 'SCHEDULED',
          visibility: defaultVisibility,
          sourceType: 'google_event',
          sourceId: ev.id,
          sourceUrl: ev.htmlLink ?? null,
          meta: {
            location: ev.location ?? null,
            organizer: ev.organizer ?? null,
            attendees: ev.attendees ?? [],
          },
        });
        await this.prisma.client.calendarEvent
          .updateMany({
            where: { businessId, sourceType: 'google_event', sourceId: ev.id },
            data: {
              syncStatus: 'SYNCED',
              googleEventId: ev.id,
              lastSyncedAt: new Date(),
              syncError: null,
            },
          })
          .catch(() => undefined);
        pulled += 1;
      } catch (err: any) {
        this.logger.warn(`Pull external event ${ev.id} failed: ${(err as Error).message}`);
      }
    }
    return pulled;
  }

  /** Used by the scheduler to discover work without scanning every business. */
  async listConnectedBusinessIds(): Promise<string[]> {
    const rows = await this.prisma.client.business.findMany({
      where: {
        calendarAccessToken: { not: null },
        calendarSyncEnabled: true,
        calendarSyncDirection: { not: 'disabled' },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

function mergeSettings(raw: unknown): CalendarSyncSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    booking: typeof obj.booking === 'boolean' ? obj.booking : DEFAULT_SETTINGS.booking,
    contact_task:
      typeof obj.contact_task === 'boolean' ? obj.contact_task : DEFAULT_SETTINGS.contact_task,
    invoice_due:
      typeof obj.invoice_due === 'boolean' ? obj.invoice_due : DEFAULT_SETTINGS.invoice_due,
    quote_expiry:
      typeof obj.quote_expiry === 'boolean' ? obj.quote_expiry : DEFAULT_SETTINGS.quote_expiry,
    content_post:
      typeof obj.content_post === 'boolean' ? obj.content_post : DEFAULT_SETTINGS.content_post,
    pullExternal:
      typeof obj.pullExternal === 'boolean' ? obj.pullExternal : DEFAULT_SETTINGS.pullExternal,
    defaultVisibility:
      obj.defaultVisibility === 'PRIVATE' ||
      obj.defaultVisibility === 'TEAM' ||
      obj.defaultVisibility === 'PUBLIC'
        ? obj.defaultVisibility
        : DEFAULT_SETTINGS.defaultVisibility,
    lastResyncAt:
      typeof obj.lastResyncAt === 'string' ? obj.lastResyncAt : DEFAULT_SETTINGS.lastResyncAt,
    lastResyncError:
      typeof obj.lastResyncError === 'string'
        ? obj.lastResyncError
        : DEFAULT_SETTINGS.lastResyncError,
    consecutiveErrors:
      typeof obj.consecutiveErrors === 'number' && Number.isFinite(obj.consecutiveErrors)
        ? obj.consecutiveErrors
        : DEFAULT_SETTINGS.consecutiveErrors,
  };
}

function sourceTypesForSettings(settings: CalendarSyncSettings): string[] {
  const out: string[] = [];
  if (settings.booking) out.push('booking');
  if (settings.contact_task) out.push('contact_task');
  if (settings.invoice_due) out.push('invoice_overdue', 'invoice');
  if (settings.quote_expiry) out.push('quote');
  if (settings.content_post) out.push('social_post', 'email_campaign');
  return out;
}

type ProjectionRow = {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timezone: string | null;
  sourceType: string;
};

function projectionToGoogleEvent(
  row: ProjectionRow,
  _businessId: string,
):
  | {
      summary: string;
      description?: string;
      start: { dateTime: string; timeZone: string } | { date: string };
      end: { dateTime: string; timeZone: string } | { date: string };
    }
  | null {
  if (!row.startAt) return null;
  const tz = row.timezone || 'UTC';
  const end = row.endAt ?? new Date(row.startAt.getTime() + 30 * 60 * 1000);
  if (row.allDay) {
    const startStr = row.startAt.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    return {
      summary: row.title,
      description: row.description ?? undefined,
      start: { date: startStr },
      end: { date: endStr > startStr ? endStr : startStr },
    };
  }
  return {
    summary: row.title,
    description: row.description ?? undefined,
    start: { dateTime: row.startAt.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
  };
}

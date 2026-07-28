import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';

@Injectable()
export class GoogleCalendarConnector implements IConnector {
  private readonly logger = new Logger(GoogleCalendarConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync bookings and events with your Google Calendar automatically',
    category: 'calendar',
    group: 'google',
    icon: 'calendar',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    externalUrl: 'https://calendar.google.com',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarAccessToken: true },
    });
    if (business?.calendarAccessToken) {
      return { connected: true };
    }
    return { connected: false, authUrl: `/calendar/businesses/${businessId}/auth-url` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        calendarAccessToken: true,
        calendarEmail: true,
        calendarId: true,
        calendarSyncDirection: true,
        calendarSyncEnabled: true,
      },
    });
    const realStatus = business?.calendarAccessToken ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    const openConflicts = realStatus === 'connected'
      ? await this.prisma.client.calendarSyncConflict.count({
          where: { businessId, status: 'open' },
        }).catch(() => 0)
      : 0;

    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.calendarEmail ?? stored?.connectedAccount ?? null,
      metadata: {
        calendarId: business?.calendarId ?? null,
        syncDirection: business?.calendarSyncDirection ?? 'two_way',
        syncEnabled: business?.calendarSyncEnabled ?? true,
        openConflicts,
      },
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return {
      type: this.meta.type,
      name: this.meta.name,
      category: this.meta.category,
      status: health.status,
      connectedAccount: health.connectedAccount,
    };
  }

  async isConnected(businessId: string): Promise<boolean> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarAccessToken: true },
    });
    return !!business?.calendarAccessToken;
  }

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    // Provider pull sync is not yet implemented for this connector. It previously
    // counted local rows and returned success:true, misrepresenting a no-op as a
    // successful provider sync. Real pull sync is future work per connector.
    return {
      success: false,
      itemsSynced: 0,
      unsupported: true,
      code: 'PULL_SYNC_NOT_IMPLEMENTED',
      errors: ['Provider pull sync is not implemented for this connector.'],
      duration: 0,
    };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarAccessToken: true, calendarEmail: true },
    });
    if (!business?.calendarAccessToken) {
      return { success: false, error: 'Google Calendar is not connected' };
    }
    try {
      // We only request the `calendar.events` scope, which does NOT cover
      // `calendarList`. Probe the primary calendar's events list — that
      // endpoint is authorized by `calendar.events` alone.
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=items(id)',
        { headers: { Authorization: `Bearer ${business.calendarAccessToken}` } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Calendar API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      return { success: true, account: business.calendarEmail ?? undefined };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarAccessToken: true, calendarEmail: true },
    });
    if (!business?.calendarAccessToken) {
      return { success: false, error: 'Google Calendar is not connected' };
    }
    try {
      const headers = {
        Authorization: `Bearer ${business.calendarAccessToken}`,
        'Content-Type': 'application/json',
      };
      const start = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
      const end = new Date(start.getTime() + 15 * 60 * 1000);
      const insertRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            summary: 'Keyflow connection test (auto-delete)',
            description: 'Automated Keyflow Google Calendar smoke test — safe to ignore.',
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            transparency: 'transparent',
          }),
        },
      );
      if (!insertRes.ok) {
        const body = await insertRes.text().catch(() => '');
        return { success: false, error: `Calendar insert ${insertRes.status}${body ? `: ${body}` : ''}` };
      }
      const event = (await insertRes.json()) as { id?: string; htmlLink?: string };
      if (event.id) {
        const delRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.id)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${business.calendarAccessToken}` } },
        );
        if (!delRes.ok && delRes.status !== 410) {
          const body = await delRes.text().catch(() => '');
          return {
            success: false,
            error: `Inserted event ${event.id} but DELETE failed (${delRes.status})${body ? `: ${body}` : ''} — please remove manually`,
            account: business.calendarEmail ?? undefined,
          };
        }
      }
      return {
        success: true,
        action: 'Inserted and immediately deleted a 15-minute primary calendar event',
        account: business.calendarEmail ?? undefined,
        detail: event.htmlLink ?? undefined,
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        calendarAccessToken: null,
        calendarRefreshToken: null,
        calendarTokenExpiry: null,
        calendarEmail: null,
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_calendar' } },
      create: { businessId, connectorType: 'google_calendar', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitCalendarEventCreated(
    businessId: string,
    opts: { title: string; startTime: Date; endTime: Date; bookingId?: string; externalId?: string; clientEmail?: string; clientName?: string },
  ) {
    await this.trackActivity(businessId);
    let contactId: string | undefined;

    if (opts.clientEmail) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: 'google_calendar',
        email: opts.clientEmail,
        firstName: opts.clientName?.split(' ')[0],
        lastName: opts.clientName?.split(' ').slice(1).join(' ') || undefined,
      });
      contactId = resolved.contactId;

      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: 'google_calendar',
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }

    this.events.emit('calendar_event.created', {
      connectorType: 'google_calendar' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      title: opts.title,
      startTime: opts.startTime,
      endTime: opts.endTime,
      bookingId: opts.bookingId,
      contactId,
    });
  }

  async emitCalendarEventUpdated(businessId: string, opts: { title: string; startTime: Date; endTime: Date; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('calendar_event.updated', {
      connectorType: 'google_calendar' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      title: opts.title,
      startTime: opts.startTime,
      endTime: opts.endTime,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_calendar' } },
      create: { businessId, connectorType: 'google_calendar', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track calendar activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_calendar' } },
    });
  }
}

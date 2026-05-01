import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

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
      select: { calendarAccessToken: true, calendarEmail: true },
    });
    const realStatus = business?.calendarAccessToken ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.calendarEmail ?? stored?.connectedAccount ?? null,
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

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Google Calendar not connected'], duration: Date.now() - start };
    }

    const upcomingBookings = await this.prisma.client.booking.count({
      where: {
        businessId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        startTime: { gte: new Date() },
      },
    });

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_calendar' } },
      create: { businessId, connectorType: 'google_calendar', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });

    return { success: true, itemsSynced: upcomingBookings, errors: [], duration: Date.now() - start };
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
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
        { headers: { Authorization: `Bearer ${business.calendarAccessToken}` } },
      );
      if (!res.ok) {
        return { success: false, error: `Calendar API returned ${res.status}` };
      }
      return { success: true, account: business.calendarEmail ?? undefined };
    } catch (err) {
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

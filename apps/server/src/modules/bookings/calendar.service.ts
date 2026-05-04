import { Injectable, BadRequestException, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHmac } from 'crypto';
import { GoogleCalendarConnector } from '../../core/connectors/implementations/google-calendar.connector';

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
}

interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{ email: string; displayName?: string }>;
}

export type CalendarEventPatch = Partial<{
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{ email: string; displayName?: string }>;
}>;

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly redirectUri = process.env.CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI?.replace('/api/crm/google/callback', '/api/bookings/calendar/callback');
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(GoogleCalendarConnector) private readonly calendarConnector?: GoogleCalendarConnector,
  ) {
    if (!this.stateSecret) {
      this.logger.warn('GOOGLE_STATE_SECRET not configured - Calendar OAuth will not be secure');
    }
  }

  private ensureStateSecret(): string {
    if (!this.stateSecret) {
      throw new BadRequestException('Calendar OAuth state secret not configured');
    }
    return this.stateSecret;
  }

  private signState(state: OAuthState): string {
    const secret = this.ensureStateSecret();
    const payload = JSON.stringify(state);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64');
  }

  verifyState(signedState: string): OAuthState | null {
    try {
      if (!this.stateSecret) {
        this.logger.error('Cannot verify state: GOOGLE_STATE_SECRET not configured');
        return null;
      }
      
      const decoded = Buffer.from(signedState, 'base64').toString('utf-8');
      const lastDotIndex = decoded.lastIndexOf('.');
      if (lastDotIndex === -1) return null;
      
      const payload = decoded.substring(0, lastDotIndex);
      const signature = decoded.substring(lastDotIndex + 1);
      
      const expectedSignature = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
      if (signature !== expectedSignature) {
        this.logger.warn('Invalid OAuth state signature');
        return null;
      }
      
      const state: OAuthState = JSON.parse(payload);
      if (state.exp < Date.now()) {
        this.logger.warn('OAuth state expired');
        return null;
      }
      
      return state;
    } catch {
      this.logger.warn('Failed to verify OAuth state');
      return null;
    }
  }

  getAuthUrl(businessId: string): string {
    if (!this.clientId) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const state: OAuthState = {
      businessId,
      nonce: Math.random().toString(36).substring(2),
      exp: Date.now() + 10 * 60 * 1000,
    };

    const signedState = this.signState(state);

    const scopes = [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri || '',
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: signedState,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async saveCalendarCredentials(businessId: string, code: string): Promise<void> {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      this.logger.error('Failed to exchange code for tokens', err);
      throw new BadRequestException('Failed to connect Google Calendar');
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 3600;

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    let email = '';
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      email = userInfo.email || '';
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        calendarEmail: email,
        calendarAccessToken: accessToken,
        calendarRefreshToken: refreshToken,
        calendarTokenExpiry: new Date(Date.now() + expiresIn * 1000),
      },
    });

    this.logger.log(`Connected Google Calendar for business ${businessId}: ${email}`);
  }

  async getCalendarStatus(businessId: string): Promise<{ connected: boolean; email?: string; calendarId?: string; syncDirection?: string; syncEnabled?: boolean }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        calendarEmail: true,
        calendarAccessToken: true,
        calendarId: true,
        calendarSyncDirection: true,
        calendarSyncEnabled: true,
      },
    });

    return {
      connected: !!(business?.calendarAccessToken && business?.calendarEmail),
      email: business?.calendarEmail || undefined,
      calendarId: business?.calendarId || undefined,
      syncDirection: business?.calendarSyncDirection || 'two_way',
      syncEnabled: business?.calendarSyncEnabled ?? true,
    };
  }

  async listAvailableCalendars(
    businessId: string,
  ): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string; backgroundColor?: string }>> {
    const accessToken = await this.refreshAccessToken(businessId);
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=100',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      this.logger.error(`Failed to list calendars: ${res.status}`);
      throw new BadRequestException('Could not load Google calendars');
    }
    const data = await res.json();
    const items: any[] = data.items ?? [];
    return items.map((c) => ({
      id: c.id,
      summary: c.summaryOverride ?? c.summary ?? c.id,
      primary: !!c.primary,
      accessRole: c.accessRole,
      backgroundColor: c.backgroundColor,
    }));
  }

  async updateSyncSettings(
    businessId: string,
    settings: { calendarId?: string | null; syncDirection?: string; syncEnabled?: boolean },
  ): Promise<{ calendarId: string | null; syncDirection: string; syncEnabled: boolean }> {
    const direction = settings.syncDirection;
    if (direction && !['push', 'pull', 'two_way', 'disabled'].includes(direction)) {
      throw new BadRequestException('Invalid sync direction');
    }
    const updated = await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        ...(settings.calendarId !== undefined ? { calendarId: settings.calendarId } : {}),
        ...(direction ? { calendarSyncDirection: direction } : {}),
        ...(settings.syncEnabled !== undefined ? { calendarSyncEnabled: settings.syncEnabled } : {}),
      },
      select: { calendarId: true, calendarSyncDirection: true, calendarSyncEnabled: true },
    });
    return {
      calendarId: updated.calendarId,
      syncDirection: updated.calendarSyncDirection,
      syncEnabled: updated.calendarSyncEnabled,
    };
  }

  async scanForConflicts(
    businessId: string,
    horizonDays = 30,
  ): Promise<{ created: number; total: number }> {
    const status = await this.getCalendarStatus(businessId);
    if (!status.connected) {
      throw new BadRequestException('Google Calendar is not connected');
    }
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
    const events = await this.listCalendarEvents(
      businessId,
      now.toISOString(),
      horizon.toISOString(),
    );

    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        startTime: { gte: now, lte: horizon },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        calendarEventId: true,
        service: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, displayName: true, email: true } },
      },
    });

    const existing = await this.prisma.client.calendarSyncConflict.findMany({
      where: { businessId, status: 'open' },
      select: { id: true, bookingId: true, externalEventId: true, conflictType: true },
    });
    const existingKey = new Set(
      existing.map((c) => `${c.conflictType}:${c.bookingId ?? ''}:${c.externalEventId ?? ''}`),
    );

    const toCreate: Array<{
      businessId: string;
      bookingId: string;
      externalEventId: string | null;
      conflictType: string;
      summary: string;
      externalSummary?: string;
      bookingStart: Date;
      bookingEnd: Date;
      externalStart?: Date;
      externalEnd?: Date;
    }> = [];
    for (const booking of bookings) {
      for (const ev of events) {
        if (ev.id === booking.calendarEventId) continue;
        if (ev.allDay) continue;
        const evStart = new Date(ev.start).getTime();
        const evEnd = new Date(ev.end).getTime();
        const bStart = booking.startTime.getTime();
        const bEnd = booking.endTime.getTime();
        if (evStart < bEnd && evEnd > bStart) {
          const key = `overlap:${booking.id}:${ev.id}`;
          if (existingKey.has(key)) continue;
          const contactName = booking.contact
            ? booking.contact.displayName ||
              [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') ||
              booking.contact.email ||
              'Client'
            : 'Client';
          toCreate.push({
            businessId,
            bookingId: booking.id,
            externalEventId: ev.id,
            conflictType: 'overlap',
            summary: `${booking.service?.name ?? 'Booking'} — ${contactName}`,
            externalSummary: ev.summary,
            bookingStart: booking.startTime,
            bookingEnd: booking.endTime,
            externalStart: new Date(ev.start),
            externalEnd: new Date(ev.end),
          });
        }
      }
    }

    for (const booking of bookings) {
      if (!booking.calendarEventId) continue;
      const found = events.find((e) => e.id === booking.calendarEventId);
      if (!found) {
        const key = `external_only:${booking.id}:${booking.calendarEventId}`;
        if (existingKey.has(key)) continue;
        const contactName = booking.contact
          ? booking.contact.displayName ||
            [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') ||
            'Client'
          : 'Client';
        toCreate.push({
          businessId,
          bookingId: booking.id,
          externalEventId: booking.calendarEventId,
          conflictType: 'external_only',
          summary: `${booking.service?.name ?? 'Booking'} — ${contactName}`,
          externalSummary: 'External event was deleted',
          bookingStart: booking.startTime,
          bookingEnd: booking.endTime,
        });
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.client.calendarSyncConflict.createMany({ data: toCreate, skipDuplicates: true });
    }

    const total = await this.prisma.client.calendarSyncConflict.count({
      where: { businessId, status: 'open' },
    });
    return { created: toCreate.length, total };
  }

  async listConflicts(businessId: string, status: string = 'open') {
    return this.prisma.client.calendarSyncConflict.findMany({
      where: { businessId, status },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async resolveConflict(
    businessId: string,
    conflictId: string,
    resolution: 'keep_keyflow' | 'keep_external' | 'dismissed',
  ) {
    const conflict = await this.prisma.client.calendarSyncConflict.findFirst({
      where: { id: conflictId, businessId },
    });
    if (!conflict) throw new BadRequestException('Conflict not found');
    if (conflict.status !== 'open') {
      return conflict;
    }

    if (resolution === 'keep_keyflow') {
      // Push the KeyFlow booking to the calendar (re-create or update event).
      if (conflict.bookingId) {
        await this.syncBookingToCalendar(conflict.bookingId, businessId);
      }
      // If there's an overlapping external event, remove it so the KeyFlow
      // booking wins the slot.
      if (conflict.conflictType === 'overlap' && conflict.externalEventId) {
        await this.deleteCalendarEvent(businessId, conflict.externalEventId);
      }
    } else if (resolution === 'keep_external') {
      // Cancel the KeyFlow booking. For overlap conflicts the external event
      // is the winner so we keep it; for external_only (booking points at a
      // deleted external event) there's nothing to delete. In other cases
      // remove any duplicate Google event the booking previously created so
      // the external event isn't shadowed.
      if (conflict.bookingId) {
        const booking = await this.prisma.client.booking.findUnique({
          where: { id: conflict.bookingId },
          select: { calendarEventId: true },
        });
        if (
          booking?.calendarEventId &&
          booking.calendarEventId !== conflict.externalEventId
        ) {
          await this.deleteCalendarEvent(businessId, booking.calendarEventId);
        }
        await this.prisma.client.booking.update({
          where: { id: conflict.bookingId },
          data: { status: 'CANCELLED', calendarEventId: null },
        });
      }
    }

    return this.prisma.client.calendarSyncConflict.update({
      where: { id: conflictId },
      data: {
        status: resolution === 'dismissed' ? 'dismissed' : 'resolved',
        resolution,
        resolvedAt: new Date(),
      },
    });
  }

  async disconnectCalendar(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        calendarEmail: null,
        calendarAccessToken: null,
        calendarRefreshToken: null,
        calendarTokenExpiry: null,
        calendarId: null,
      },
    });
    this.logger.log(`Disconnected Google Calendar for business ${businessId}`);
  }

  private async refreshAccessToken(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarRefreshToken: true, calendarTokenExpiry: true, calendarAccessToken: true },
    });

    if (!business?.calendarRefreshToken) {
      throw new BadRequestException('Google Calendar not connected');
    }

    const now = new Date();
    const expiry = business.calendarTokenExpiry ? new Date(business.calendarTokenExpiry) : null;
    const buffer = 5 * 60 * 1000;

    if (expiry && now.getTime() + buffer < expiry.getTime() && business.calendarAccessToken) {
      return business.calendarAccessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: business.calendarRefreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      this.logger.error('Failed to refresh calendar token');
      throw new BadRequestException('Failed to refresh Google Calendar token');
    }

    const tokens = await res.json();
    const newAccessToken = tokens.access_token;
    const expiresIn = tokens.expires_in || 3600;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        calendarAccessToken: newAccessToken,
        calendarTokenExpiry: new Date(Date.now() + expiresIn * 1000),
      },
    });

    return newAccessToken;
  }

  private async getActiveCalendarId(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarId: true },
    });
    return business?.calendarId || 'primary';
  }

  async createCalendarEvent(
    businessId: string,
    event: CalendarEvent,
  ): Promise<string | null> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);
      const calendarId = encodeURIComponent(await this.getActiveCalendarId(businessId));

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        this.logger.error('Failed to create calendar event', err);
        return null;
      }

      const created = await res.json();
      return created.id;
    } catch (error) {
      this.logger.error('Error creating calendar event', error);
      return null;
    }
  }

  async updateCalendarEvent(
    businessId: string,
    eventId: string,
    event: CalendarEvent,
  ): Promise<boolean> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);

      const calendarId = encodeURIComponent(await this.getActiveCalendarId(businessId));
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        },
      );

      return res.ok;
    } catch (error) {
      this.logger.error('Error updating calendar event', error);
      return false;
    }
  }

  async patchCalendarEvent(
    businessId: string,
    eventId: string,
    patch: CalendarEventPatch,
  ): Promise<boolean> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);
      const calendarId = encodeURIComponent(await this.getActiveCalendarId(businessId));
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        this.logger.error('Failed to patch calendar event', err);
      }
      return res.ok;
    } catch (error) {
      this.logger.error('Error patching calendar event', error);
      return false;
    }
  }

  async deleteCalendarEvent(businessId: string, eventId: string): Promise<boolean> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);

      const calendarId = encodeURIComponent(await this.getActiveCalendarId(businessId));
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      return res.ok || res.status === 404;
    } catch (error) {
      this.logger.error('Error deleting calendar event', error);
      return false;
    }
  }

  async syncBookingToCalendar(bookingId: string, businessId: string): Promise<string | null> {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId },
      include: {
        business: true,
        contact: true,
        service: true,
        staff: true,
      },
    });

    if (!booking) {
      this.logger.warn(`Booking ${bookingId} not found or does not belong to business ${businessId}`);
      return null;
    }

    const { connected, syncDirection, syncEnabled } = await this.getCalendarStatus(booking.businessId);
    if (!connected) {
      this.logger.debug(`Calendar not connected for business ${booking.businessId}`);
      return null;
    }
    if (!syncEnabled || syncDirection === 'disabled' || syncDirection === 'pull') {
      this.logger.debug(
        `Calendar push skipped for business ${booking.businessId} (direction=${syncDirection}, enabled=${syncEnabled})`,
      );
      return booking.calendarEventId ?? null;
    }

    const contactName = booking.contact
      ? (booking.contact.displayName || 
          [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') || 
          booking.contact.email || 'Client')
      : 'Walk-in Client';
    const serviceName = booking.service?.name ?? 'Service';
    
    const event: CalendarEvent = {
      summary: `${serviceName} - ${contactName}`,
      description: `Booking for ${contactName}\nService: ${serviceName}\nStaff: ${booking.staff?.name ?? 'Unassigned'}\nStatus: ${booking.status}`,
      location: booking.location ?? undefined,
      start: {
        dateTime: booking.startTime.toISOString(),
        timeZone: booking.business.timezone || 'America/Port_of_Spain',
      },
      end: {
        dateTime: booking.endTime.toISOString(),
        timeZone: booking.business.timezone || 'America/Port_of_Spain',
      },
      attendees: booking.contact?.email ? [{ email: booking.contact.email, displayName: contactName }] : undefined,
    };

    if (booking.calendarEventId) {
      const updated = await this.updateCalendarEvent(booking.businessId, booking.calendarEventId, event);
      if (updated) {
        this.calendarConnector?.emitCalendarEventUpdated(booking.businessId, {
          title: event.summary,
          startTime: booking.startTime,
          endTime: booking.endTime,
          externalId: booking.calendarEventId,
        }).catch((e) => this.logger.warn(`Calendar connector event emission failed: ${e.message}`));
        return booking.calendarEventId;
      }
    }

    const eventId = await this.createCalendarEvent(booking.businessId, event);
    if (eventId) {
      await this.prisma.client.booking.update({
        where: { id: bookingId },
        data: { calendarEventId: eventId },
      });

      this.calendarConnector?.emitCalendarEventCreated(booking.businessId, {
        title: event.summary,
        startTime: booking.startTime,
        endTime: booking.endTime,
        bookingId,
        externalId: eventId,
        clientEmail: booking.contact?.email ?? undefined,
        clientName: contactName || undefined,
      }).catch((e) => this.logger.warn(`Calendar connector event emission failed: ${e.message}`));
    }

    return eventId;
  }

  async listCalendarEvents(
    businessId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{
    id: string;
    summary: string;
    description?: string;
    start: string;
    end: string;
    allDay: boolean;
    htmlLink?: string;
    location?: string;
    organizer?: string;
    attendees?: Array<{ email: string; displayName?: string }>;
  }>> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });

      const calendarId = encodeURIComponent(await this.getActiveCalendarId(businessId));
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!res.ok) {
        const err = await res.text();
        this.logger.error('Failed to list calendar events', err);
        return [];
      }

      const data = await res.json();
      const items: any[] = data.items ?? [];

      return items
        .filter((item: any) => item.status !== 'cancelled')
        .map((item: any) => {
          const allDay = !!(item.start?.date && !item.start?.dateTime);
          return {
            id: item.id,
            summary: item.summary ?? '(No title)',
            description: item.description ?? undefined,
            start: allDay ? item.start.date : item.start.dateTime,
            end: allDay ? item.end.date : item.end.dateTime,
            allDay,
            htmlLink: item.htmlLink ?? undefined,
            location: item.location ?? undefined,
            organizer: item.organizer?.email ?? undefined,
            attendees: Array.isArray(item.attendees)
              ? item.attendees
                  .filter((a: any) => a?.email)
                  .map((a: any) => ({ email: a.email as string, displayName: a.displayName }))
              : undefined,
          };
        });
    } catch (error) {
      this.logger.error('Error listing calendar events', error);
      return [];
    }
  }

  async removeBookingFromCalendar(bookingId: string): Promise<boolean> {
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      select: { businessId: true, calendarEventId: true },
    });

    if (!booking?.calendarEventId) {
      return true;
    }

    const deleted = await this.deleteCalendarEvent(booking.businessId, booking.calendarEventId);
    if (deleted) {
      await this.prisma.client.booking.update({
        where: { id: bookingId },
        data: { calendarEventId: null },
      });
    }

    return deleted;
  }
}

import { Injectable, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHmac } from 'crypto';

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
}

interface CalendarEvent {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{ email: string; displayName?: string }>;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly redirectUri = process.env.CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI?.replace('/crm/google/callback', '/bookings/calendar/callback');
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

  async getCalendarStatus(businessId: string): Promise<{ connected: boolean; email?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { calendarEmail: true, calendarAccessToken: true },
    });

    return {
      connected: !!(business?.calendarAccessToken && business?.calendarEmail),
      email: business?.calendarEmail || undefined,
    };
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

  async createCalendarEvent(
    businessId: string,
    event: CalendarEvent,
  ): Promise<string | null> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);

      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
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

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
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

  async deleteCalendarEvent(businessId: string, eventId: string): Promise<boolean> {
    try {
      const accessToken = await this.refreshAccessToken(businessId);

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
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

    const { connected } = await this.getCalendarStatus(booking.businessId);
    if (!connected) {
      this.logger.debug(`Calendar not connected for business ${booking.businessId}`);
      return null;
    }

    const contactName = booking.contact.displayName || 
      [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') || 
      booking.contact.email || 'Client';
    
    const event: CalendarEvent = {
      summary: `${booking.service.name} - ${contactName}`,
      description: `Booking for ${contactName}\nService: ${booking.service.name}\nStaff: ${booking.staff.name}\nStatus: ${booking.status}`,
      start: {
        dateTime: booking.startTime.toISOString(),
        timeZone: booking.business.timezone || 'America/Port_of_Spain',
      },
      end: {
        dateTime: booking.endTime.toISOString(),
        timeZone: booking.business.timezone || 'America/Port_of_Spain',
      },
      attendees: booking.contact.email ? [{ email: booking.contact.email, displayName: contactName }] : undefined,
    };

    if (booking.calendarEventId) {
      const updated = await this.updateCalendarEvent(booking.businessId, booking.calendarEventId, event);
      if (updated) {
        return booking.calendarEventId;
      }
    }

    const eventId = await this.createCalendarEvent(booking.businessId, event);
    if (eventId) {
      await this.prisma.client.booking.update({
        where: { id: bookingId },
        data: { calendarEventId: eventId },
      });
    }

    return eventId;
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

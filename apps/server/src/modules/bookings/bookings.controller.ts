import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, UseGuards, Delete, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { BookingsService } from './bookings.service';
import { CalendarService } from './calendar.service';
import { BookingOptimizerService } from './booking-optimizer.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { PublicCreateBookingDto } from './dto/public-create-booking.dto';
import { appUrl } from '../../core/config/runtime-urls';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';
import { CatalogService } from '../catalog/catalog.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(BookingOptimizerService) private readonly optimizer: BookingOptimizerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  listBookings(@Param('businessId') businessId: string) {
    return this.bookings.listBookings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/stats')
  getBookingStats(@Param('businessId') businessId: string) {
    return this.bookings.getBookingStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/bookings/:bookingId/status')
  updateBookingStatus(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body('status') status: string,
  ) {
    return this.bookings.updateBookingStatus(businessId, bookingId, status);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/bookings/:bookingId/reschedule')
  rescheduleBooking(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body('startTime') startTime: string,
  ) {
    return this.bookings.rescheduleBooking(businessId, bookingId, new Date(startTime));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/bookings/:bookingId/notes')
  updateBookingNotes(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body('notes') notes: string,
  ) {
    return this.bookings.updateBookingNotes(businessId, bookingId, notes);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/bookings/:bookingId')
  async updateBooking(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body() body: UpdateBookingDto,
  ) {
    const updated = await this.bookings.updateBookingLocation(businessId, bookingId, {
      location: body.location,
      locationPlaceId: body.locationPlaceId,
      locationLatLng: body.locationLatLng ?? null,
    });

    if (updated.calendarEventId) {
      this.calendar
        .syncBookingToCalendar(bookingId, businessId)
        .catch(() => undefined);
    }

    return updated;
  }

  @UseGuards(AuthGuard, BusinessGuard, PlanLimitGuard)
  @RequirePlanLimit('bookings')
  @Post('businesses/:businessId')
  createBooking(
    @Param('businessId') businessId: string,
    @Body() body: CreateBookingDto,
  ) {
    if (!body.contactId) {
      throw new BadRequestException('contactId is required');
    }
    return this.bookings.createBooking({
      businessId,
      contactId: body.contactId,
      serviceId: body.serviceId,
      staffId: body.staffId,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      notes: body.notes,
      location: body.location,
      locationPlaceId: body.locationPlaceId,
      locationLatLng: body.locationLatLng,
    });
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('public/businesses/:businessId/services')
  publicListServices(@Param('businessId') businessId: string) {
    return this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('public/businesses/:businessId/staff')
  publicListStaff(@Param('businessId') businessId: string) {
    return this.prisma.client.staffMember.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(10, 60_000)
  @Post('public/businesses/:businessId')
  async publicCreateBooking(
    @Param('businessId') businessId: string,
    @Body() body: PublicCreateBookingDto,
  ) {
    const limitCheck = await this.subscriptions.checkLimit(businessId, 'bookings');
    if (!limitCheck.allowed) {
      const limitLabel = limitCheck.limit === -1 ? 'unlimited' : String(limitCheck.limit);
      throw new ForbiddenException({
        statusCode: 403,
        error: 'PLAN_LIMIT_REACHED',
        message: `You have reached the bookings limit for your current plan (${limitCheck.current}/${limitLabel}). Please upgrade to add more.`,
        resource: 'bookings',
        current: limitCheck.current,
        limit: limitCheck.limit,
        upgradeTo: limitCheck.upgradeTo,
      });
    }
    return this.bookings.publicCreateBooking({
      businessId,
      serviceId: body.serviceId,
      staffId: body.staffId || undefined,
      startTime: new Date(body.startTime),
      contact: {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        companyName: body.company,
      },
      notes: body.notes ?? undefined,
      location: body.location ?? undefined,
      locationPlaceId: body.locationPlaceId ?? undefined,
      locationLatLng: body.locationLatLng ?? undefined,
    });
  }

  /**
   * @deprecated Bookings owns scheduling, not the service catalog. Use
   * `/catalog/businesses/:businessId/services` (CatalogService). This
   * pass-through stays so existing clients keep working.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/services')
  listServices(@Param('businessId') businessId: string) {
    return this.catalog.listServices(businessId);
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.createService. */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services')
  createService(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; duration: number; price: number; description?: string; sourceProductId?: string },
  ) {
    return this.catalog.createService({
      businessId,
      name: body.name,
      duration: body.duration,
      price: body.price,
      description: body.description ?? null,
      sourceProductId: body.sourceProductId ?? null,
    });
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.updateService. */
  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/services/:serviceId')
  async updateService(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: { name?: string; duration?: number; price?: number; description?: string; bufferMins?: number; leadTimeMins?: number },
  ) {
    return this.catalog.updateService({ businessId, serviceId, ...body });
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.deleteService. */
  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/services/:serviceId')
  async deleteService(@Param('businessId') businessId: string, @Param('serviceId') serviceId: string) {
    await this.catalog.deleteService(businessId, serviceId);
    return { success: true };
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.batchServices. */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services/batch')
  async batchServices(
    @Param('businessId') businessId: string,
    @Body() body: { add?: { name: string; duration: number; price: number; description?: string }[]; remove?: string[] },
  ) {
    return this.catalog.batchServices(businessId, {
      add: body.add?.map(s => ({
        businessId,
        name: s.name,
        duration: s.duration,
        price: s.price,
        description: s.description ?? null,
      })),
      remove: body.remove,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/staff')
  listStaff(@Param('businessId') businessId: string) {
    return this.prisma.client.staffMember.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/staff')
  createStaff(
    @Param('businessId') businessId: string,
    @Body() body: { name: string },
  ) {
    return this.prisma.client.staffMember.create({
      data: {
        businessId,
        name: body.name,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/staff/:staffId')
  async deleteStaff(@Param('businessId') businessId: string, @Param('staffId') staffId: string) {
    const existing = await this.prisma.client.staffMember.findFirst({ where: { id: staffId, businessId } });
    if (!existing) throw new NotFoundException('Staff member not found');
    await this.prisma.client.staffMember.update({
      where: { id: staffId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/staff/:staffId/availability')
  listStaffAvailability(
    @Param('businessId') businessId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.prisma.client.availability.findMany({
      where: { staffId, staff: { businessId, deletedAt: null } },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/staff/:staffId/availability')
  async setStaffAvailability(
    @Param('businessId') businessId: string,
    @Param('staffId') staffId: string,
    @Body() body: { slots: { dayOfWeek: number; startTime: string; endTime: string }[] },
  ) {
    const staff = await this.prisma.client.staffMember.findFirst({
      where: { id: staffId, businessId, deletedAt: null },
    });
    if (!staff) throw new ForbiddenException('Staff member not found in this business');
    await this.prisma.client.availability.deleteMany({
      where: { staffId, staff: { businessId } },
    });
    if (body.slots.length > 0) {
      await this.prisma.client.availability.createMany({
        data: body.slots.map((s) => ({
          staffId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      });
    }
    return this.prisma.client.availability.findMany({
      where: { staffId, staff: { businessId, deletedAt: null } },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/auth-url')
  getCalendarAuthUrl(@Param('businessId') businessId: string) {
    const url = this.calendar.getAuthUrl(businessId);
    return { url };
  }

  @Get('calendar/callback')
  async handleCalendarCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = appUrl();

    const parsedState = this.calendar.verifyState(state);
    if (!parsedState) {
      return res.redirect(`${frontendUrl}/app/bookings?calendar=error&reason=invalid_state`);
    }

    try {
      await this.calendar.saveCalendarCredentials(parsedState.businessId, code);
      return res.redirect(`${frontendUrl}/app/bookings?calendar=success`);
    } catch {
      return res.redirect(`${frontendUrl}/app/bookings?calendar=error`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/status')
  getCalendarStatus(@Param('businessId') businessId: string) {
    return this.calendar.getCalendarStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/calendar/disconnect')
  async disconnectCalendar(@Param('businessId') businessId: string) {
    await this.calendar.disconnectCalendar(businessId);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/events')
  async listCalendarEvents(
    @Param('businessId') businessId: string,
    @Query('timeMin') timeMin: string,
    @Query('timeMax') timeMax: string,
  ) {
    if (!timeMin || !timeMax) {
      throw new BadRequestException('timeMin and timeMax query parameters are required');
    }
    return this.calendar.listCalendarEvents(businessId, timeMin, timeMax);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/calendar/events')
  async createExternalCalendarEvent(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      summary?: string;
      description?: string;
      location?: string;
      start: string;
      end: string;
      allDay?: boolean;
      attendees?: Array<string | { email: string; displayName?: string }>;
      timeZone?: string;
    },
  ) {
    if (!body?.start || !body?.end) {
      throw new BadRequestException('start and end are required');
    }
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = body.timeZone || business?.timezone || 'America/Port_of_Spain';
    const attendees = (body.attendees ?? [])
      .map((a) => (typeof a === 'string' ? { email: a.trim() } : { email: a.email?.trim() ?? '', displayName: a.displayName }))
      .filter((a) => a.email && /.+@.+\..+/.test(a.email));

    const dateOnlyRe = /^\d{4}-\d{2}-\d{2}$/;
    let startSpec: { dateTime: string; timeZone: string } | { date: string };
    let endSpec: { dateTime: string; timeZone: string } | { date: string };
    if (body.allDay) {
      if (!dateOnlyRe.test(body.start) || !dateOnlyRe.test(body.end)) {
        throw new BadRequestException('All-day events require start and end as YYYY-MM-DD');
      }
      if (body.end <= body.start) {
        throw new BadRequestException('end must be after start');
      }
      startSpec = { date: body.start };
      endSpec = { date: body.end };
    } else {
      const startDate = new Date(body.start);
      const endDate = new Date(body.end);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid start or end date');
      }
      if (endDate.getTime() <= startDate.getTime()) {
        throw new BadRequestException('end must be after start');
      }
      startSpec = { dateTime: startDate.toISOString(), timeZone: tz };
      endSpec = { dateTime: endDate.toISOString(), timeZone: tz };
    }

    const eventId = await this.calendar.createCalendarEvent(businessId, {
      summary: body.summary?.trim() || '(No title)',
      description: body.description,
      location: body.location,
      start: startSpec,
      end: endSpec,
      attendees: attendees.length ? attendees : undefined,
    });
    if (!eventId) {
      throw new BadRequestException('Failed to create calendar event');
    }
    return { id: eventId };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/calendar/events/:eventId')
  async updateExternalCalendarEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Body()
    body: {
      summary?: string;
      description?: string;
      location?: string;
      start?: string;
      end?: string;
      allDay?: boolean;
      attendees?: Array<string | { email: string; displayName?: string }>;
      timeZone?: string;
    },
  ) {
    if (!eventId) throw new BadRequestException('eventId is required');
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = body.timeZone || business?.timezone || 'America/Port_of_Spain';
    const patch: Record<string, unknown> = {};
    const dateOnlyRe = /^\d{4}-\d{2}-\d{2}$/;
    const isAllDay = body.allDay === true
      || (body.allDay === undefined
          && ((body.start !== undefined && dateOnlyRe.test(body.start))
              || (body.end !== undefined && dateOnlyRe.test(body.end))));

    if (body.summary !== undefined) {
      patch.summary = body.summary.trim() || '(No title)';
    }
    if (body.description !== undefined) {
      patch.description = body.description;
    }
    if (body.location !== undefined) {
      patch.location = body.location;
    }
    if (body.start !== undefined) {
      if (isAllDay) {
        if (!dateOnlyRe.test(body.start)) {
          throw new BadRequestException('All-day start must be YYYY-MM-DD');
        }
        // Switching to all-day: send date and explicitly clear dateTime/timeZone
        patch.start = { date: body.start, dateTime: null, timeZone: null };
      } else {
        const startDate = new Date(body.start);
        if (Number.isNaN(startDate.getTime())) {
          throw new BadRequestException('Invalid start date');
        }
        patch.start = { dateTime: startDate.toISOString(), timeZone: tz, date: null };
      }
    }
    if (body.end !== undefined) {
      if (isAllDay) {
        if (!dateOnlyRe.test(body.end)) {
          throw new BadRequestException('All-day end must be YYYY-MM-DD');
        }
        patch.end = { date: body.end, dateTime: null, timeZone: null };
      } else {
        const endDate = new Date(body.end);
        if (Number.isNaN(endDate.getTime())) {
          throw new BadRequestException('Invalid end date');
        }
        patch.end = { dateTime: endDate.toISOString(), timeZone: tz, date: null };
      }
    }
    if (body.start !== undefined && body.end !== undefined) {
      if (isAllDay) {
        if (body.end <= body.start) {
          throw new BadRequestException('end must be after start');
        }
      } else if (new Date(body.end).getTime() <= new Date(body.start).getTime()) {
        throw new BadRequestException('end must be after start');
      }
    }
    if (body.attendees !== undefined) {
      const attendees = body.attendees
        .map((a) =>
          typeof a === 'string'
            ? { email: a.trim() }
            : { email: a.email?.trim() ?? '', displayName: a.displayName },
        )
        .filter((a) => a.email && /.+@.+\..+/.test(a.email));
      patch.attendees = attendees;
    }

    if (Object.keys(patch).length === 0) {
      return { id: eventId, success: true };
    }

    const ok = await this.calendar.patchCalendarEvent(businessId, eventId, patch);
    if (!ok) {
      throw new BadRequestException('Failed to update calendar event');
    }
    return { id: eventId, success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/calendar/events/:eventId')
  async deleteExternalCalendarEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
  ) {
    if (!eventId) throw new BadRequestException('eventId is required');
    const ok = await this.calendar.deleteCalendarEvent(businessId, eventId);
    if (!ok) {
      throw new BadRequestException('Failed to delete calendar event');
    }
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/list')
  async listAvailableCalendars(@Param('businessId') businessId: string) {
    return this.calendar.listAvailableCalendars(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/calendar/settings')
  async updateCalendarSettings(
    @Param('businessId') businessId: string,
    @Body() body: { calendarId?: string | null; syncDirection?: string; syncEnabled?: boolean },
  ) {
    return this.calendar.updateSyncSettings(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/conflicts')
  async listCalendarConflicts(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
  ) {
    return this.calendar.listConflicts(businessId, status || 'open');
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/calendar/conflicts/scan')
  async scanCalendarConflicts(@Param('businessId') businessId: string) {
    return this.calendar.scanForConflicts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/calendar/conflicts/:conflictId/resolve')
  async resolveCalendarConflict(
    @Param('businessId') businessId: string,
    @Param('conflictId') conflictId: string,
    @Body() body: { resolution: 'keep_keyflow' | 'keep_external' | 'dismissed' },
  ) {
    if (!body?.resolution || !['keep_keyflow', 'keep_external', 'dismissed'].includes(body.resolution)) {
      throw new BadRequestException('Invalid resolution');
    }
    return this.calendar.resolveConflict(businessId, conflictId, body.resolution);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/bookings/:bookingId/sync-calendar')
  async syncBookingToCalendar(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ) {
    const eventId = await this.calendar.syncBookingToCalendar(bookingId, businessId);
    return { success: !!eventId, eventId };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/optimizer/schedule-health')
  getScheduleHealth(@Param('businessId') businessId: string) {
    return this.optimizer.getScheduleHealth(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/optimizer/no-show-risks')
  getNoShowRisks(@Param('businessId') businessId: string) {
    return this.optimizer.getNoShowRisks(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/optimizer/reminders')
  getUpcomingReminders(@Param('businessId') businessId: string) {
    return this.optimizer.getUpcomingReminders(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/optimizer/rebooking-suggestions')
  getRebookingSuggestions(@Param('businessId') businessId: string) {
    return this.optimizer.getRebookingSuggestions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/reminder-settings')
  async getReminderSettings(@Param('businessId') businessId: string) {
    return this.bookings.getReminderSettings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/reminder-settings')
  async updateReminderSettings(
    @Param('businessId') businessId: string,
    @Body() body: { bookingReminderMins: number },
  ) {
    return this.bookings.updateReminderSettings(businessId, body.bookingReminderMins);
  }
}

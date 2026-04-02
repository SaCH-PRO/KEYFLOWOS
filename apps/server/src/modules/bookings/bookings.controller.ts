import { Body, Controller, ForbiddenException, Get, Inject, Param, Patch, Post, UseGuards, Delete, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { BookingsService } from './bookings.service';
import { CalendarService } from './calendar.service';
import { BookingOptimizerService } from './booking-optimizer.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { PublicCreateBookingDto } from './dto/public-create-booking.dto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(BookingOptimizerService) private readonly optimizer: BookingOptimizerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
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

  @UseGuards(AuthGuard, BusinessGuard, PlanLimitGuard)
  @RequirePlanLimit('bookings')
  @Post('businesses/:businessId')
  createBooking(
    @Param('businessId') businessId: string,
    @Body() body: CreateBookingDto,
  ) {
    return this.bookings.createBooking({
      businessId,
      contactId: body.contactId,
      serviceId: body.serviceId,
      staffId: body.staffId,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      notes: body.notes,
    });
  }

  @Get('public/businesses/:businessId/services')
  publicListServices(@Param('businessId') businessId: string) {
    return this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  @Get('public/businesses/:businessId/staff')
  publicListStaff(@Param('businessId') businessId: string) {
    return this.prisma.client.staffMember.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

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
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/services')
  listServices(@Param('businessId') businessId: string) {
    return this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services')
  createService(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; duration: number; price: number; description?: string },
  ) {
    return this.prisma.client.service.create({
      data: {
        businessId,
        name: body.name,
        duration: body.duration,
        price: body.price,
        description: body.description ?? null,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/services/:serviceId')
  updateService(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: { name?: string; duration?: number; price?: number; description?: string; bufferMins?: number; leadTimeMins?: number },
  ) {
    return this.prisma.client.service.update({
      where: { id: serviceId, businessId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.duration !== undefined && { duration: body.duration }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.bufferMins !== undefined && { bufferMins: body.bufferMins }),
        ...(body.leadTimeMins !== undefined && { leadTimeMins: body.leadTimeMins }),
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/services/:serviceId')
  async deleteService(@Param('businessId') businessId: string, @Param('serviceId') serviceId: string) {
    await this.prisma.client.service.update({
      where: { id: serviceId, businessId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services/batch')
  async batchServices(
    @Param('businessId') businessId: string,
    @Body() body: { add?: { name: string; duration: number; price: number; description?: string }[]; remove?: string[] },
  ) {
    const results: { added: number; removed: number; errors: string[] } = { added: 0, removed: 0, errors: [] };

    if (body.remove?.length) {
      await this.prisma.client.service.updateMany({
        where: { id: { in: body.remove }, businessId },
        data: { deletedAt: new Date() },
      });
      results.removed = body.remove.length;
    }

    if (body.add?.length) {
      for (const item of body.add) {
        try {
          await this.prisma.client.service.create({
            data: { businessId, name: item.name, duration: item.duration, price: item.price, description: item.description ?? null },
          });
          results.added++;
        } catch (e) {
          results.errors.push(`Failed to add ${item.name}`);
        }
      }
    }

    return results;
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
    await this.prisma.client.staffMember.update({
      where: { id: staffId, businessId },
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
    const frontendUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';

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
}

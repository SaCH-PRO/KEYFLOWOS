import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, UseGuards, Delete, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { BookingStatus } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { isStrictIsoDateTimeWithTz } from './business-hours.util';
import { BookingWaitlistService } from './booking-waitlist.service';
import { CalendarService, assertCalendarNamesReader, type CalendarNamesReader } from './calendar.service';
import { BookingOptimizerService } from './booking-optimizer.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { OfferWaitlistSlotDto } from './dto/offer-waitlist-slot.dto';
import { WaitlistQueryDto } from './dto/waitlist-query.dto';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { PublicCreateBookingDto } from './dto/public-create-booking.dto';
import { appUrl } from '../../core/config/runtime-urls';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';
import { CatalogService, PUBLIC_SERVICE_SELECT, PUBLIC_STAFF_SELECT } from '../catalog/catalog.service';
import { HoneypotGuard, Honeypot } from '../../core/guards/honeypot.guard';
import { sanitizeRequired, sanitizeString } from '../../core/utils/sanitize';
import { assertGoogleConnectOwner, type GoogleConnectActor } from '../../core/connectors/google-suite.controller';
import {
  STOREFRONT_CHECKOUT_METHODS,
  normalizeStorefrontMethod,
  storefrontMethodUnsupported,
} from '../payments/storefront-checkout-methods';

/** Postgres int4's upper bound: Service.duration is an Int column. */
const INT4_MAX = 2147483647;

/** A UTF-16 surrogate without its pair. */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Text a Postgres text column refuses: a NUL character, or an unpaired UTF-16 surrogate. */
function unstorableText(value: string): boolean {
  return value.includes('\u0000') || UNPAIRED_SURROGATE.test(value);
}

/**
 * V1-64 (SWP-BOOKING-PAYMENT-GATE side fix): the body of the deprecated POST
 * bookings/businesses/:businessId/services, checked before the catalog is
 * called. The handler's body is an inline type, so the global ValidationPipe
 * checks nothing, and CatalogService.createService refuses a bad name,
 * duration or price with a plain Error: `durationMins` in place of `duration`
 * (and a missing, mistyped or out-of-range name, duration or price) answered 500. Each is a
 * 400 here, with nothing written. The checks are the catalog's own (a non-blank
 * name, a positive duration, a non-negative price) plus the column types and
 * int4's range. A fractional duration is left as it was: accepted, stored as
 * whole minutes.
 */
function assertServiceCreateBody(body: unknown): asserts body is {
  name: string;
  duration: number;
  price: number;
  description?: string | null;
  sourceProductId?: string | null;
} {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('A service needs a name, a duration and a price');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || b.name.trim() === '') {
    throw new BadRequestException('name is required');
  }
  if (typeof b.duration !== 'number' || !Number.isFinite(b.duration) || b.duration <= 0 || b.duration > INT4_MAX) {
    throw new BadRequestException('duration must be a positive number of minutes');
  }
  if (typeof b.price !== 'number' || !Number.isFinite(b.price) || b.price < 0) {
    throw new BadRequestException('price must be a non-negative number');
  }
  for (const key of ['description', 'sourceProductId']) {
    if (b[key] !== undefined && b[key] !== null && typeof b[key] !== 'string') {
      throw new BadRequestException(`${key} must be a string`);
    }
  }
  // Review SEC-BPG-2 and round 2: Postgres text holds no NUL character and no unpaired UTF-16 surrogate (each answered 500).
  for (const key of ['name', 'description', 'sourceProductId']) {
    if (typeof b[key] === 'string' && unstorableText(b[key] as string)) {
      throw new BadRequestException(`${key} contains a character that cannot be stored`);
    }
  }
}

@Controller('bookings')
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(BookingWaitlistService) private readonly waitlist: BookingWaitlistService,
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(BookingOptimizerService) private readonly optimizer: BookingOptimizerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  listBookings(
    @Param('businessId') businessId: string,
    @Query('orgUnitId') orgUnitId?: string,
  ) {
    return this.bookings.listBookings(businessId, orgUnitId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/stats')
  getBookingStats(
    @Param('businessId') businessId: string,
    @Query('orgUnitId') orgUnitId?: string,
  ) {
    return this.bookings.getBookingStats(businessId, orgUnitId);
  }

  /**
   * V1-84 (CR-V28-4): the body says who cancelled (cancelledBy). Only a
   * customer cancel forfeits a paid deposit (D-26); a CANCELLED sent without
   * an initiator is a customer cancel (D-65), as before the field existed.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/bookings/:bookingId/status')
  updateBookingStatus(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body() body: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateBookingStatus(businessId, bookingId, body?.status as BookingStatus, body?.cancelledBy ?? 'CUSTOMER');
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/bookings/:bookingId/create-invoice')
  createInvoiceFromBooking(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookings.createInvoiceFromBooking(businessId, bookingId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/bookings/:bookingId/reschedule')
  rescheduleBooking(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body('startTime') startTime: string,
  ) {
    return this.bookings.rescheduleBooking(businessId, bookingId, new Date(startTime));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/bookings/:bookingId/notes')
  updateBookingNotes(
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body('notes') notes: string,
  ) {
    return this.bookings.updateBookingNotes(businessId, bookingId, notes);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('bookings', 'write')
  @RequirePlanLimit('bookings')
  @Post('businesses/:businessId')
  createBooking(
    @Param('businessId') businessId: string,
    @Body() body: CreateBookingDto,
    @Req() req: { user?: { id?: string } },
  ) {
    if (!body.contactId) {
      throw new BadRequestException('contactId is required');
    }
    // The member's CRM view bounds which contact they may book (V1-06 review):
    // a contact GET contacts/:id would answer 404 for them is a 404 here too.
    // AuthGuard has already refused a request without a user.
    const actorUserId = req?.user?.id;
    if (!actorUserId) throw new UnauthorizedException('Authentication required');
    return this.bookings.createBooking({
      actorUserId,
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
      orgUnitId: body.orgUnitId,
    });
  }

  /**
   * The public service and staff lists the booking page reads (V1-23, M36):
   * projected rows only (no invoice timing, deposit terms or sourceProductId;
   * no hourlyRate or maxHoursPerWeek), and a 404 when the storefront is off,
   * as publicCreateBooking already refuses a closed store.
   */
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('public/businesses/:businessId/services')
  async publicListServices(@Param('businessId') businessId: string) {
    await this.catalog.assertPublicStore(businessId);
    // SWP-STORE-LISTING-SERVER (BUG-055, ruling storelisting): product listing
    // services (sourceProductId != null) mark products added to the store and
    // must not appear as standalone bookable services.
    return this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null, sourceProductId: null },
      orderBy: { name: 'asc' },
      select: PUBLIC_SERVICE_SELECT,
    });
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('public/businesses/:businessId/staff')
  async publicListStaff(@Param('businessId') businessId: string) {
    await this.catalog.assertPublicStore(businessId);
    return this.prisma.client.staffMember.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: PUBLIC_STAFF_SELECT,
    });
  }

  /**
   * The times a customer can actually book, for the public widget.
   *
   * Public because the booking form is public — a customer choosing a time has
   * no session. Rate limited like the other public endpoint, and it exposes
   * only timestamps: no contact, no existing booking, nothing about who holds
   * the slots it omits.
   *
   * Read-only, so no honeypot: that guard exists to catch bots submitting
   * forms, and refusing to answer "when are you open" would just push the
   * widget back to asking people to type an ISO timestamp.
   *
   * A closed or unknown storefront is a 404 (assertPublicStore), like the
   * service and staff lists beside it (V1-23): a closed store's open times,
   * derived from its business hours and existing bookings, are not public.
   */
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(60, 60_000)
  @Get('public/businesses/:businessId/slots')
  async publicAvailableSlots(
    @Param('businessId') businessId: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId?: string,
  ) {
    if (!serviceId) throw new BadRequestException('serviceId is required');
    // Parsed as a LOCAL date, deliberately. `new Date('2026-12-15')` is UTC
    // midnight, which in this timezone (UTC-4) is the 14th at 20:00 — so the
    // service then reported the previous day's slots. Measured: asking for
    // 2026-12-15 returned "date":"2026-12-14".
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
    if (!parts) throw new BadRequestException('date must be YYYY-MM-DD');
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const dayOfMonth = Number(parts[3]);
    const day = new Date(year, month - 1, dayOfMonth);
    if (
      Number.isNaN(day.getTime()) ||
      day.getFullYear() !== year ||
      day.getMonth() !== month - 1 ||
      day.getDate() !== dayOfMonth
    ) {
      throw new BadRequestException('date must be a valid date');
    }
    await this.catalog.assertPublicStore(businessId);
    return this.bookings.getAvailableSlots({
      businessId,
      serviceId: sanitizeRequired(serviceId, 'serviceId', 200),
      date: day,
      staffId: staffId ? sanitizeString(staffId, 200) ?? undefined : undefined,
    });
  }
  @UseGuards(PublicRateLimitGuard, HoneypotGuard)
  @PublicRateLimit(10, 60_000)
  @Honeypot()
  @Post('public/businesses/:businessId')
  async publicCreateBooking(
    @Param('businessId') businessId: string,
    @Body() body: PublicCreateBookingDto,
  ) {
    // V1-64 (SWP-BOOKING-PAYMENT-GATE, BUG-037): the payment method the
    // customer chose, read once, trimmed and upper-cased, as the storefront
    // checkout reads it (SiteController.publicCheckout). Only no method, CASH,
    // MANUAL, WIPAY, PAYPAL or STRIPE is taken; anything else, and a method
    // that is not a string, is refused here before anything is read or
    // written. Whether THIS business offers the provider is
    // BookingsService.publicCreateBooking's check, also before the write.
    const rawMethod: unknown = body?.paymentMethod;
    if (rawMethod !== undefined && rawMethod !== null && typeof rawMethod !== 'string') {
      throw new BadRequestException('paymentMethod must be a string');
    }
    const paymentMethod = normalizeStorefrontMethod(rawMethod);
    if (paymentMethod !== null && !STOREFRONT_CHECKOUT_METHODS.includes(paymentMethod)) {
      throw new BadRequestException(storefrontMethodUnsupported(rawMethod as string));
    }

    // V1-91 / P226 (FU-PUBLIC-BOOKING-GRID, SEC-SLOTS-M1, R1-SEC-01): validate
    // startTime as a strict RFC 3339 / ISO 8601 date-time with explicit
    // timezone here as well as in PublicCreateBookingDto so invalid, blank,
    // non-string, date-only, ordinal, timezone-less, 24:00 rollover, or
    // impossible calendar dates always answer 400 and never reach
    // BookingsService as Invalid Date (NaN) or server-TZ-dependent instants.
    const rawStartTime: unknown = body?.startTime;
    if (!isStrictIsoDateTimeWithTz(rawStartTime)) {
      throw new BadRequestException('startTime must be a valid ISO 8601 date string');
    }
    const startTime = new Date(rawStartTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime must be a valid ISO 8601 date string');
    }

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
      serviceId: sanitizeRequired(body.serviceId, 'serviceId', 200),
      staffId: body.staffId ? sanitizeString(body.staffId, 200) : undefined,
      startTime,
      contact: {
        firstName: sanitizeRequired(body.firstName, 'firstName', 100),
        lastName: sanitizeRequired(body.lastName, 'lastName', 100),
        email: sanitizeRequired(body.email, 'email', 200),
        phone: sanitizeRequired(body.phone, 'phone', 50),
        companyName: body.company ? sanitizeString(body.company, 200) : undefined,
      },
      notes: body.notes ? sanitizeString(body.notes, 2000) : undefined,
      location: body.location ? sanitizeString(body.location, 500) : undefined,
      locationPlaceId: body.locationPlaceId ? sanitizeString(body.locationPlaceId, 200) : undefined,
      locationLatLng: body.locationLatLng ?? undefined,
      storefrontSlug: body.storefrontSlug ? sanitizeString(body.storefrontSlug, 200) : undefined,
      // V1-64 review SEC2-BPG-1: the slug exactly as the customer's page sent it, for the payment-method gate only.
      // sanitizeString strips tokens a real slug may hold ('--'), so the sanitised copy above is not the store's slug.
      storefrontSlugAsSent: typeof body.storefrontSlug === 'string' ? body.storefrontSlug : null,
      visitorId: body.visitorId ? sanitizeString(body.visitorId, 100) : undefined,
      referralCode: body.referralCode ? sanitizeString(body.referralCode, 100) : undefined,
      orgUnitId: body.orgUnitId ? sanitizeString(body.orgUnitId, 200) : undefined,
      paymentMethod,
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

  /**
   * @deprecated Use Catalog endpoint. Pass-through to CatalogService.createService.
   * V1-64: a body the catalog cannot store is a 400 (assertServiceCreateBody), not a 500.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/services')
  createService(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      duration: number;
      price: number;
      description?: string | null;
      sourceProductId?: string | null;
      depositRequired?: boolean;
      depositType?: string | null;
      depositValue?: number | null;
    },
  ) {
    assertServiceCreateBody(body);
    return this.catalog.createService({
      businessId,
      name: body.name,
      duration: body.duration,
      price: body.price,
      description: body.description ?? null,
      sourceProductId: body.sourceProductId ?? null,
      ...(body.depositRequired !== undefined ? { depositRequired: body.depositRequired } : {}),
      ...(body.depositType !== undefined ? { depositType: body.depositType } : {}),
      ...(body.depositValue !== undefined ? { depositValue: body.depositValue } : {}),
    });
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.updateService. */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Patch('businesses/:businessId/services/:serviceId')
  async updateService(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: {
      name?: string;
      duration?: number;
      price?: number;
      description?: string;
      bufferMins?: number;
      leadTimeMins?: number;
      depositRequired?: boolean;
      depositType?: string | null;
      depositValue?: number | null;
    },
  ) {
    return this.catalog.updateService({ ...body, businessId, serviceId });
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.deleteService. */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Delete('businesses/:businessId/services/:serviceId')
  async deleteService(@Param('businessId') businessId: string, @Param('serviceId') serviceId: string) {
    await this.catalog.deleteService(businessId, serviceId);
    return { success: true };
  }

  /** @deprecated Use Catalog endpoint. Pass-through to CatalogService.batchServices. */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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
  @Get('businesses/:businessId/waitlist')
  listWaitlist(
    @Param('businessId') businessId: string,
    @Query() query: WaitlistQueryDto,
  ) {
    return this.waitlist.listWaitlist(businessId, query);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/waitlist')
  addToWaitlist(
    @Param('businessId') businessId: string,
    @Body() body: CreateWaitlistEntryDto,
  ) {
    return this.waitlist.addToWaitlist({
      businessId,
      contactId: body.contactId,
      serviceId: body.serviceId,
      preferredStaffId: body.preferredStaffId,
      preferredDateFrom: body.preferredDateFrom,
      preferredDateTo: body.preferredDateTo,
      preferredTimeOfDay: body.preferredTimeOfDay,
      notes: body.notes,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/waitlist/:entryId/offer')
  offerWaitlistSlot(
    @Param('businessId') businessId: string,
    @Param('entryId') entryId: string,
    @Body() body: OfferWaitlistSlotDto,
  ) {
    return this.waitlist.offerSlot(
      entryId,
      {
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        serviceId: body.serviceId ?? '',
        staffId: body.staffId ?? null,
      },
      'USER',
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/waitlist/:entryId/convert')
  convertWaitlistEntry(
    @Param('businessId') businessId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.waitlist.convertWaitlistEntry(businessId, entryId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/waitlist/:entryId/cancel')
  cancelWaitlistEntry(
    @Param('businessId') businessId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.waitlist.cancelWaitlistEntry(businessId, entryId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/waitlist/matches')
  previewWaitlistMatches(
    @Param('businessId') businessId: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('serviceId') serviceId: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.waitlist.previewMatchesForSlot(
      businessId,
      {
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        serviceId,
        staffId: staffId ?? null,
      },
      { limit: 10 },
    );
  }

  /**
   * W8-GOOGLE-CONSENT-OWNER (owner ruling D-99; W7 review SEC-W7RCV-2): the
   * Google Calendar connection is the business owner's to start and to
   * disconnect (assertGoogleConnectOwner: OWNER membership, Business.ownerId
   * or SUPER_ADMIN, else 403 GOOGLE_CONNECT_OWNER_ONLY, first). The status
   * read and the event routes stay open to members. Review repairs: the
   * platform twins of these doors (POST /calendar/businesses/:b/sync/google/
   * connect, disconnect and resync) follow the same rule (SEC-W8GCO-2), and the
   * state this URL carries is tagged for the Google Calendar connection and
   * good for one callback (CalendarService.verifyState, SEC-W8GCO-1), so no
   * other door's state completes the calendar callback below.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/auth-url')
  async getCalendarAuthUrl(
    @Param('businessId') businessId: string,
    @Req() req: { user?: GoogleConnectActor },
  ) {
    await assertGoogleConnectOwner(this.prisma, businessId, req.user);
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
      return res.redirect(
        `${frontendUrl}/app/settings/connections?calendar=error&reason=invalid_state`,
      );
    }

    try {
      await this.calendar.saveCalendarCredentials(parsedState.businessId, code);
      return res.redirect(`${frontendUrl}/app/settings/connections?calendar=success`);
    } catch {
      return res.redirect(`${frontendUrl}/app/settings/connections?calendar=error`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/status')
  getCalendarStatus(@Param('businessId') businessId: string) {
    return this.calendar.getCalendarStatus(businessId);
  }

  // W8-GOOGLE-CONSENT-OWNER (D-99): disconnecting is the owner's, as starting is.
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/calendar/disconnect')
  async disconnectCalendar(
    @Param('businessId') businessId: string,
    @Req() req: { user?: GoogleConnectActor },
  ) {
    await assertGoogleConnectOwner(this.prisma, businessId, req.user);
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  // W11-CALENDAR-NAMES-SCOPE (owner ruling D-120, read with D-125): the names
  // of the owner's Google calendars are listed to an OWNER-membership holder
  // and an ADMIN only (assertCalendarNamesReader, 403
  // CALENDAR_NAMES_OWNER_OR_ADMIN first, before any Google call), as on the
  // platform twin GET /calendar/businesses/:b/sync/calendars. STAFF learn that
  // a calendar is connected from GET .../calendar/status, which stays a member's.
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/calendar/list')
  async listAvailableCalendars(
    @Param('businessId') businessId: string,
    @Req() req: { user?: CalendarNamesReader },
  ) {
    await assertCalendarNamesReader(this.prisma, businessId, req.user);
    return this.calendar.listAvailableCalendars(businessId);
  }

  // W10-GOOGLE-DOORS-REST review repair (owner rulings D-99 and D-111;
  // SEC-W10GDR-1, [V94D-T08]): calendarId, syncDirection and syncEnabled choose
  // which of the owner's Google calendars the hourly resync reads and writes,
  // which way it runs and whether it runs at all, so changing them is changing
  // the sync of the Google connection: the owner's, as on the platform twin
  // PATCH /calendar/businesses/:b/sync/settings (assertGoogleConnectOwner, 403
  // GOOGLE_CONNECT_OWNER_ONLY, first). The calendar status read stays a member's;
  // the calendar list is the owner's and ADMINs' (D-120, W11-CALENDAR-NAMES-SCOPE).
  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/calendar/settings')
  async updateCalendarSettings(
    @Param('businessId') businessId: string,
    @Body() body: { calendarId?: string | null; syncDirection?: string; syncEnabled?: boolean },
    @Req() req: { user?: GoogleConnectActor },
  ) {
    await assertGoogleConnectOwner(this.prisma, businessId, req.user);
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/calendar/conflicts/scan')
  async scanCalendarConflicts(@Param('businessId') businessId: string) {
    return this.calendar.scanForConflicts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Patch('businesses/:businessId/reminder-settings')
  async updateReminderSettings(
    @Param('businessId') businessId: string,
    @Body() body: { bookingReminderMins: number },
  ) {
    return this.bookings.updateReminderSettings(businessId, body.bookingReminderMins);
  }
}

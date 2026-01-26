import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PublicCreateBookingDto } from './dto/public-create-booking.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  listBookings(@Param('businessId') businessId: string) {
    return this.bookings.listBookings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('bookings/:bookingId/status')
  updateBookingStatus(
    @Param('bookingId') bookingId: string,
    @Body() body: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateBookingStatus({
      bookingId,
      status: body.status,
    });
  }

  @Post('public/businesses/:businessId')
  publicCreateBooking(
    @Param('businessId') businessId: string,
    @Body() body: PublicCreateBookingDto,
  ) {
    return this.bookings.publicCreateBooking({
      businessId,
      serviceId: body.serviceId,
      staffId: body.staffId,
      startTime: new Date(body.startTime),
      contact: {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
      },
    });
  }

  @Get('public/businesses/:businessId/services')
  listPublicServices(@Param('businessId') businessId: string) {
    return this.bookings.listServices(businessId);
  }

  @Get('public/businesses/:businessId/staff')
  listPublicStaff(@Param('businessId') businessId: string) {
    return this.bookings.listStaff(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/services')
  listServices(@Param('businessId') businessId: string) {
    return this.bookings.listServices(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services')
  createService(@Param('businessId') businessId: string, @Body() body: CreateServiceDto) {
    return this.bookings.createService({
      businessId,
      name: body.name,
      description: body.description,
      duration: body.duration,
      price: body.price,
      currency: body.currency,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('services/:serviceId')
  updateService(@Param('serviceId') serviceId: string, @Body() body: UpdateServiceDto) {
    return this.bookings.updateService({
      serviceId,
      name: body.name,
      description: body.description,
      duration: body.duration,
      price: body.price,
      currency: body.currency,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('services/:serviceId')
  deleteService(@Param('serviceId') serviceId: string) {
    return this.bookings.deleteService(serviceId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/staff')
  listStaff(@Param('businessId') businessId: string) {
    return this.bookings.listStaff(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/staff')
  createStaff(@Param('businessId') businessId: string, @Body() body: CreateStaffDto) {
    return this.bookings.createStaff({ businessId, name: body.name });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('staff/:staffId')
  updateStaff(@Param('staffId') staffId: string, @Body() body: UpdateStaffDto) {
    return this.bookings.updateStaff({ staffId, name: body.name });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('staff/:staffId')
  deleteStaff(@Param('staffId') staffId: string) {
    return this.bookings.deleteStaff(staffId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('staff/:staffId/availability')
  listAvailability(@Param('staffId') staffId: string) {
    return this.bookings.listAvailability(staffId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('staff/:staffId/availability')
  createAvailability(@Param('staffId') staffId: string, @Body() body: CreateAvailabilityDto) {
    return this.bookings.createAvailability({
      staffId,
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('availability/:availabilityId')
  deleteAvailability(@Param('availabilityId') availabilityId: string) {
    return this.bookings.deleteAvailability(availabilityId);
  }
}

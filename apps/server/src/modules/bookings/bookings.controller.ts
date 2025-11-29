import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PublicCreateBookingDto } from './dto/public-create-booking.dto';

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
}

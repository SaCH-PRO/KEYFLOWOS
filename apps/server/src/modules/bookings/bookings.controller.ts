import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('businesses/:businessId')
  listBookings(@Param('businessId') businessId: string) {
    return this.bookings.listBookings(businessId);
  }

  @Post('businesses/:businessId')
  createBooking(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      contactId: string;
      serviceId: string;
      staffId: string;
      startTime: string;
      endTime: string;
    },
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
}

import { Body, Controller, Get, Param, Post, UseGuards, Delete } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PublicCreateBookingDto } from './dto/public-create-booking.dto';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
  ) {}

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
    @Body() body: { name: string; durationMins: number; price: number; currency?: string },
  ) {
    return this.prisma.client.service.create({
      data: {
        businessId,
        name: body.name,
        durationMins: body.durationMins,
        price: body.price,
        currency: body.currency ?? 'TTD',
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
    @Body() body: { name: string; email?: string },
  ) {
    return this.prisma.client.staffMember.create({
      data: {
        businessId,
        name: body.name,
        email: body.email,
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
}

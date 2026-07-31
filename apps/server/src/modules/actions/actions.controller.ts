import { Body, Controller, Inject, Post, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('actions')
@UseGuards(AuthGuard, BusinessGuard)
export class ActionsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post('send-receipt')
  async sendReceipt(
    @Body('businessId') businessId: string,
    @Body() body: { invoiceId: string; contactEmail?: string },
    @Req() req: any,
  ) {
    if (!body.invoiceId) {
      throw new NotFoundException('invoiceId required');
    }
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: body.invoiceId },
      include: { contact: true, items: true, business: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    const contactEmail = body.contactEmail ?? invoice.contact?.email;
    return {
      message: `Receipt prepared for invoice ${invoice.invoiceNumber ?? invoice.id}`,
      contactEmail: contactEmail ?? null,
      total: invoice.total,
      currency: invoice.currency,
    };
  }

  @Post('remind-contact')
  async remindContact(
    @Body('businessId') businessId: string,
    @Body() body: { contactId: string; message?: string },
  ) {
    if (!body.contactId) {
      throw new NotFoundException('contactId required');
    }
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: body.contactId },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return {
      message: `Reminder queued for ${contact.email ?? contact.id}`,
      preview: body.message ?? 'Please complete your payment/booking.',
    };
  }

  @Post('booking-followup')
  async bookingFollowup(
    @Body('businessId') businessId: string,
    @Body() body: { bookingId: string },
    @Req() req: any,
  ) {
    if (!body.bookingId) {
      throw new NotFoundException('bookingId required');
    }
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: body.bookingId },
      include: { contact: true, service: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return {
      message: `Follow-up prepared for booking ${booking.id}`,
      status: booking.status,
      startTime: booking.startTime,
      endTime: booking.endTime,
      contactEmail: booking.contact?.email ?? null,
      service: booking.service?.name ?? null,
    };
  }
}

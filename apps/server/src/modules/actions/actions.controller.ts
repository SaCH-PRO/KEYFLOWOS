import { Body, Controller, Post, UseGuards, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('actions')
@UseGuards(AuthGuard)
export class ActionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('send-receipt')
  async sendReceipt(@Body() body: { invoiceId: string; contactEmail?: string }) {
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
  async remindContact(@Body() body: { contactEmail: string; message?: string }) {
    if (!body.contactEmail) {
      throw new NotFoundException('contactEmail required');
    }
    return {
      message: `Reminder queued for ${body.contactEmail}`,
      preview: body.message ?? 'Please complete your payment/booking.',
    };
  }

  @Post('booking-followup')
  async bookingFollowup(@Body() body: { bookingId: string }) {
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

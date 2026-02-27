import { Body, Controller, Inject, Post, Req, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('actions')
@UseGuards(AuthGuard)
export class ActionsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async verifyResourceOwnership(userId: string, businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: {
        id: businessId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
    });
    if (!business) {
      throw new ForbiddenException('You do not have access to this resource');
    }
  }

  @Post('send-receipt')
  async sendReceipt(@Body() body: { invoiceId: string; contactEmail?: string }, @Req() req: any) {
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
    await this.verifyResourceOwnership(req.user.id, invoice.businessId);
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
  async bookingFollowup(@Body() body: { bookingId: string }, @Req() req: any) {
    if (!body.bookingId) {
      throw new NotFoundException('bookingId required');
    }
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: body.bookingId },
      include: { contact: true, service: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    await this.verifyResourceOwnership(req.user.id, booking.businessId);
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

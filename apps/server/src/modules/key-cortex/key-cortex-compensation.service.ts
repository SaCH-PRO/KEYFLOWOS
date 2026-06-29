import { Injectable, Logger } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../../core/prisma/prisma.service';

export type CompensationHandler = (input: {
  businessId: string;
  output?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}) => Promise<void>;

@Injectable()
export class KeyCortexCompensationService {
  private readonly logger = new Logger(KeyCortexCompensationService.name);
  private readonly handlers = new Map<string, CompensationHandler>();

  constructor(
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
  ) {
    this.registerDefaults();
  }

  register(actionRef: string, handler: CompensationHandler) {
    this.handlers.set(actionRef, handler);
  }

  async compensate(actionRef: string, input: { businessId: string; output?: Record<string, unknown>; parameters?: Record<string, unknown> }) {
    const handler = this.handlers.get(actionRef);
    if (!handler) {
      this.logger.warn(`No compensator registered for ${actionRef}`);
      return { compensated: false, reason: 'No compensator registered' };
    }
    await handler(input);
    return { compensated: true, actionRef };
  }

  private registerDefaults() {
    this.register('crm.create_contact', async (input) => {
      const contactId = (input.output?.id ?? input.parameters?.contactId) as string | undefined;
      if (!contactId || !input.businessId) return;
      this.logger.log(`[compensate] soft-delete contact ${contactId}`);
      await this.crm.softDeleteContact({ businessId: input.businessId, contactId });
    });

    this.register('commerce.create_invoice', async (input) => {
      const invoiceId = (input.output?.id ?? input.parameters?.invoiceId) as string | undefined;
      if (!invoiceId) return;
      this.logger.log(`[compensate] void invoice ${invoiceId}`);
      await this.commerce.updateInvoiceStatus({ invoiceId, status: 'VOID' });
    });

    this.register('bookings.create_booking', async (input) => {
      const bookingId = (input.output?.id ?? input.parameters?.bookingId) as string | undefined;
      if (!bookingId || !input.businessId) return;
      this.logger.log(`[compensate] cancel booking ${bookingId}`);
      await this.bookings.updateBookingStatus(input.businessId, bookingId, BookingStatus.CANCELLED);
    });

    this.register('key_inbox.send_reply', async (input) => {
      const messageId = (input.output?.id ?? input.parameters?.messageId) as string | undefined;
      if (!messageId) return;
      this.logger.log(`[compensate] remove sent reply ${messageId}`);
      await this.prisma.client.message.deleteMany({ where: { id: messageId, businessId: input.businessId } });
    });
  }
}

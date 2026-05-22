import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from '../commerce/commerce.service';

@Injectable()
export class ContentInvoiceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  async generateInvoiceFromDelivery(contentRequestId: string, businessId: string) {
    const contentRequest = await this.prisma.client.contentRequest.findUnique({
      where: { id: contentRequestId },
      include: { invoice: true },
    });

    if (!contentRequest) {
      throw new NotFoundException('Content request not found');
    }

    if (contentRequest.businessId !== businessId) {
      throw new BadRequestException('Content request does not belong to this business');
    }

    if (contentRequest.status !== 'delivered') {
      throw new BadRequestException('Content request must be delivered before generating an invoice');
    }

    if (contentRequest.invoiceId) {
      throw new BadRequestException('Invoice already generated for this content request');
    }

    const deliveryPackage = await this.prisma.client.contentDeliveryPackage.findFirst({
      where: { contentRequestId },
    });

    const items = contentRequest.contentTypes.map((contentType) => ({
      description: `Content deliverable: ${contentType.replace(/_/g, ' ')}`,
      quantity: 1,
      unitPrice: 0,
    }));

    const invoice = await this.commerce.createInvoice({
      businessId,
      items,
      notes: `Auto-generated invoice for content request: ${contentRequest.businessGoal}${deliveryPackage ? ` (${deliveryPackage.uploadedFileIds.length} file(s) delivered)` : ''}`,
    });

    await this.prisma.client.contentRequest.update({
      where: { id: contentRequestId },
      data: { invoiceId: invoice.id },
    });

    this.emitter.emit('content.delivered_invoiced', {
      businessId,
      contentRequestId,
      invoiceId: invoice.id,
      businessGoal: contentRequest.businessGoal,
    });

    return invoice;
  }
}

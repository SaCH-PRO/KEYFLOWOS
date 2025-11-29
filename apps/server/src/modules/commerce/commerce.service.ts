import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CommerceService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  listProducts(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createProduct(input: { businessId: string; name: string; price: number; currency?: string; description?: string | null }) {
    return this.prisma.client.product.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        price: input.price,
        currency: input.currency ?? 'TTD',
        description: input.description ?? null,
      },
    });
  }

  async markInvoicePaid(invoiceId: string) {
    const invoice = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date() },
    });
    this.events.emit('invoice.paid', { invoiceId, businessId: invoice.businessId });
    return invoice;
  }
}

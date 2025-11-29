import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  async buildReceipt(invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, contact: true, business: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return {
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      total: invoice.total,
      currency: invoice.currency,
      contact: invoice.contact ? { name: `${invoice.contact.firstName ?? ''} ${invoice.contact.lastName ?? ''}`.trim(), email: invoice.contact.email } : null,
      business: invoice.business ? { name: invoice.business.name } : null,
      items: invoice.items?.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      })),
      issuedAt: invoice.issueDate,
      paidAt: invoice.paidAt,
    };
  }
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class InvoiceReceiptBuilderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * KF-REVENUE-AUTH-PROJECTION-001 (G7): the receipt is bound to the tenant the
   * guard validated. The lookup was by id alone, so any authenticated member of
   * any business could read any invoice's receipt by supplying their own
   * businessId in the query. A mismatch answers exactly like an unknown id.
   */
  async buildReceipt(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
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

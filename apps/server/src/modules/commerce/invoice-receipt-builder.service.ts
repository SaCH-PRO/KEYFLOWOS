import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { computeBalance, isShareableInvoiceStatus } from './invoice-workflow.service';

/**
 * V1-49 (M24): the statuses a customer receipt exists for. D-07 put "the
 * receipt" into Release 0 beside the link that already shows paid and
 * remaining, so a part-paid invoice gets a receipt for what has arrived, with
 * what remains stated (never "remaining 0").
 */
const PUBLIC_RECEIPT_STATUSES: ReadonlySet<string> = new Set(['PAID', 'PARTIALLY_PAID']);

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

  /**
   * V1-49-PUBLIC-RECEIPT (M24): the customer's receipt, for the invoice a live
   * pay link resolved to (the controller resolves the token and passes the
   * link's tenant). Anonymous, so it is a projection: the printed invoice
   * facts, the business's public profile (the five fields the token view
   * serves), the customer's name and two figures. No payment row, reference,
   * note or evidence, no customer email, no `metaData`.
   *
   * amountPaid / amountDue are computeBalance's paid / remaining over this
   * invoice's Payment rows of its own tenant, the figures the token view shows
   * (getPaymentLinkBalance): Payment sits outside the tenant extension and has
   * no FK to Business (M31), so a row carrying another businessId is not this
   * invoice's money. A manually refunded row is counted twice by
   * computeBalance (M28); this mirrors it until V1-29 settles the convention.
   *
   * PAID and PARTIALLY_PAID answer the receipt; a shareable invoice with
   * nothing received (SENT, OVERDUE) is a 409; a DRAFT, VOID, PENDING,
   * FAILED, soft-deleted or other-tenant invoice answers the same 404 as an
   * unknown token. Read-only.
   */
  async buildPublicReceipt(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      select: {
        invoiceNumber: true,
        status: true,
        total: true,
        currency: true,
        issueDate: true,
        paidAt: true,
        items: { select: { description: true, quantity: true, unitPrice: true, total: true } },
        payments: { where: { businessId }, select: { amount: true, status: true } },
        contact: { select: { firstName: true, lastName: true } },
        business: { select: { name: true, logoUrl: true, primaryColor: true, email: true, phone: true } },
      },
    });
    if (!invoice || !isShareableInvoiceStatus(invoice.status)) throw new NotFoundException('Receipt not found');
    if (!PUBLIC_RECEIPT_STATUSES.has(invoice.status)) {
      throw new ConflictException('No payment has been received on this invoice yet');
    }
    const balance = computeBalance(Number(invoice.total), invoice.payments, invoice.currency);
    return {
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      total: invoice.total,
      amountPaid: balance.paid,
      amountDue: balance.remaining,
      paidAt: invoice.status === 'PAID' ? invoice.paidAt ?? null : null,
      issuedAt: invoice.issueDate,
      items: invoice.items,
      contact: invoice.contact ? { firstName: invoice.contact.firstName, lastName: invoice.contact.lastName } : null,
      business: invoice.business,
    };
  }
}

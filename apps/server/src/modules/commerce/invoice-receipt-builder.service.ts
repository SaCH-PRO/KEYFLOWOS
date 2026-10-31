import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { computeBalance, isShareableInvoiceStatus, type BalanceSummary } from './invoice-workflow.service';

/** The invoice fields a receipt email's figures come from (full Payment rows carry businessId). */
export interface ReceiptBalanceSource {
  businessId: string;
  status: string;
  total: number | string;
  currency: string;
  payments?: ReadonlyArray<{ amount: number | string; status: string; businessId?: string | null }> | null;
}

/**
 * V1-49 (M24, M31): the balance every receipt email states, the invoice.paid
 * listener's and the operator's "Resend receipt" alike: computeBalance over
 * the invoice's Payment rows of its own tenant. Payment sits outside the
 * tenant extension and has no FK to Business, so a row carrying another
 * businessId is not this invoice's money. One rule, so the two receipt emails
 * for one invoice and the public receipt never state different amounts.
 */
export function ownTenantReceiptBalance(invoice: ReceiptBalanceSource): BalanceSummary {
  const own = (invoice.payments ?? [])
    .filter((p) => p.businessId === invoice.businessId)
    .map((p) => ({ amount: Number(p.amount), status: p.status }));
  return computeBalance(Number(invoice.total), own, invoice.currency);
}

/**
 * V1-49 (M24): a receipt email ("we've received your payment") goes out only
 * for an invoice that is PAID with nothing remaining over its own-tenant
 * rows. A partial, or a PAID invoice whose own rows fall short (no row at
 * all, a foreign-tenant row, a refund that left it PAID), gets none.
 */
export function isSettledForReceiptEmail(invoice: Pick<ReceiptBalanceSource, 'status'>, balance: BalanceSummary): boolean {
  return invoice.status === 'PAID' && balance.remaining <= 0;
}

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
   * Whether a receipt exists is decided by those rows, not by the status
   * (review CR-V49-1, SEC-V49-2). A shareable invoice (SENT, PAID,
   * PARTIALLY_PAID, OVERDUE) whose own-tenant net is above zero answers the
   * receipt, so a part-paid invoice moved to OVERDUE still gets one for what
   * has arrived. A net of zero or less answers 409 with no figures: either
   * nothing was received, or a refund took the net to zero or below. The
   * invoice can then still be PAID, because deriveStatusAfterPayment reopens
   * only on a positive net, and under M28 the receipt would read "PAID,
   * received 0, remaining twice the total". With a positive net, amountDue
   * stays below the total. A DRAFT, VOID, PENDING, FAILED, soft-deleted or
   * other-tenant invoice answers the same 404 as an unknown token. Read-only.
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
    const balance = computeBalance(Number(invoice.total), invoice.payments, invoice.currency);
    if (balance.net <= 0) {
      // "Nothing received" would be false after a refund, so that case gets a neutral message.
      throw new ConflictException(
        balance.refunded > 0 ? 'No receipt is available for this invoice' : 'No payment has been received on this invoice yet',
      );
    }
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

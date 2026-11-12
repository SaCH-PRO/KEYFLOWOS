import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  appliedCreditsOf,
  balanceOfStoredRows,
  creditAwareBalance,
  isCreditAwareShareableInvoiceStatus,
  type BalanceSummary,
} from './invoice-workflow.service';

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
 * listener's and the operator's "Resend receipt" alike: the invoice's Payment
 * rows of its own tenant. Payment sits outside the tenant extension and has
 * no FK to Business, so a row carrying another businessId is not this
 * invoice's money. One rule, so the two receipt emails for one invoice and
 * the public receipt never state different amounts.
 *
 * V1-29b-REFUND-READERS (CR-V29-3, CR-V29-4): the rows are read through
 * balanceOfStoredRows, the contract every balance reader uses: integer cents,
 * each refund a separate negative REFUNDED row (D-14), and a row the manual
 * refund flipped before V1-29 read as its payment plus its refund (net 0).
 * computeBalance alone subtracted such a row twice, so a PAID invoice paid
 * after a flipped refund read 60 still owed and got no receipt. The amount
 * received is the balance's `net` (paid less refunded), not `paid`, which
 * counts refunded money too.
 */
export function ownTenantReceiptBalance(invoice: ReceiptBalanceSource): BalanceSummary {
  const own = (invoice.payments ?? []).filter((p) => p.businessId === invoice.businessId);
  return balanceOfStoredRows(Number(invoice.total), own, invoice.currency);
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
   * amountPaid / amountDue are the net received and the remaining of
   * balanceOfStoredRows over this invoice's Payment rows of its own tenant:
   * Payment sits outside the tenant extension and has no FK to Business (M31),
   * so a row carrying another businessId is not this invoice's money.
   * V1-29b-REFUND-READERS (CR-V29-3): amountPaid is the balance's `net` (60
   * for 60 + 40 paid with the 40 refunded; 100, not 200, for an invoice paid,
   * fully refunded and paid again), and a row flipped to REFUNDED before
   * V1-29 reads as its payment plus its refund (CR-V29-4).
   *
   * Whether a receipt exists is decided by those rows, not by the status
   * (review CR-V49-1, SEC-V49-2). A shareable invoice (SENT, PAID,
   * PARTIALLY_PAID, OVERDUE) whose own-tenant net is above zero answers the
   * receipt, so a part-paid invoice moved to OVERDUE still gets one for what
   * has arrived. A net of zero or less answers 409 with no figures: either
   * nothing was received, or a refund took the net to zero (since V1-29 a
   * full refund returns the invoice to SENT, D-14). With a positive net,
   * amountDue stays below the total. A DRAFT, VOID, PENDING, FAILED, soft-deleted or
   * other-tenant invoice answers the same 404 as an unknown token. Read-only.
   *
   * W5-CREDIT-AWARE-PAY (V1-44 review CR-V44-1 rest; D-13, D-75, D-78): the
   * credit-aware shareable statuses (isCreditAwareShareableInvoiceStatus), so
   * a PARTIALLY_CREDITED invoice with money received has a receipt, which it
   * keeps once its remainder is paid (D-78: it stays PARTIALLY_CREDITED).
   * amountDue is the remaining net of the invoice's own APPLIED credit notes
   * (creditAwareBalance over appliedCreditsOf), the figure the token view and
   * the status poll state, and a credited invoice's receipt lists `credited`,
   * the notes netted, so total, received, credited and due add up. An invoice
   * with nothing credited keeps its keys. FULLY_CREDITED answers 404.
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
    if (!invoice || !isCreditAwareShareableInvoiceStatus(invoice.status)) throw new NotFoundException('Receipt not found');
    const credited = await appliedCreditsOf(this.prisma.client as unknown as Prisma.TransactionClient, {
      id: invoiceId,
      businessId,
      status: invoice.status,
    });
    const balance = creditAwareBalance(balanceOfStoredRows(Number(invoice.total), invoice.payments, invoice.currency), credited);
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
      amountPaid: balance.net,
      ...(balance.credited > 0 ? { credited: balance.credited } : {}),
      amountDue: balance.remaining,
      paidAt: invoice.status === 'PAID' ? invoice.paidAt ?? null : null,
      issuedAt: invoice.issueDate,
      items: invoice.items,
      contact: invoice.contact ? { firstName: invoice.contact.firstName, lastName: invoice.contact.lastName } : null,
      business: invoice.business,
    };
  }
}

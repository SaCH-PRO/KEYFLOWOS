import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CommerceService } from './commerce.service';
import { GmailService } from './gmail.service';
import { buildInvoiceEmailHtml } from './invoice-email.template';
import { sumSuccessfulPayments, type InvoiceForEmail } from './invoice-email.types';
import { appUrl } from '../../core/config/runtime-urls';

/**
 * Listens for `invoice.paid` and auto-sends a receipt email when:
 *   - the invoice has a contact with an email address, AND
 *   - the business has Gmail connected.
 * The matching `invoice.receipt_sent` ContactEvent is logged via
 * CommerceService.recordReceiptSent so the timeline reflects the auto-send.
 *
 * This satisfies R2's "auto receipt on full payment" requirement; the manual
 * "Resend receipt" controller path uses the same email template + log helper.
 */
@Injectable()
export class InvoiceReceiptListener {
  private readonly logger = new Logger(InvoiceReceiptListener.name);

  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(GmailService) private readonly gmail: GmailService,
  ) {}

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: { invoice: { id: string }; businessId: string }) {
    try {
      const invoice = (await this.commerce.getInvoiceWithBusiness(payload.invoice.id, true)) as
        | InvoiceForEmail
        | null;
      if (!invoice) return;
      const recipient = invoice.contact?.email;
      if (!recipient) return;
      // createPaymentLink throws for PAID/VOID; that's an expected business
      // condition for the receipt path, so swallow only that and fall back
      // to the most-recent existing link (or null pay CTA).
      let link = await this.commerce.findAnyPaymentLink(invoice.id, payload.businessId);
      if (!link) {
        try {
          link = await this.commerce.createPaymentLink(invoice.id, payload.businessId);
        } catch (err: any) {
          if (!isExpectedLinkRefusal(err)) throw err;
          link = null;
        }
      }
      const paymentUrl = link ? `${appUrl()}/public/invoice/${link.token}` : null;
      const paid = sumSuccessfulPayments(invoice.payments);

      const html = buildInvoiceEmailHtml({
        businessName: invoice.business?.name ?? 'Your business',
        businessLogo: invoice.business?.logoUrl,
        businessEmail: invoice.business?.email,
        businessPhone: invoice.business?.phone,
        primaryColor: invoice.business?.primaryColor || '#F97316',
        contactName:
          `${invoice.contact?.firstName ?? ''} ${invoice.contact?.lastName ?? ''}`.trim() ||
          invoice.contact?.email ||
          'Customer',
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: new Date(invoice.issueDate ?? invoice.createdAt ?? Date.now()).toLocaleDateString(
          'en-TT',
          { dateStyle: 'medium' },
        ),
        dueDate: invoice.dueDate
          ? new Date(invoice.dueDate).toLocaleDateString('en-TT', { dateStyle: 'medium' })
          : null,
        items: (invoice.items ?? []).map((it) => ({
          description: it.description,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
        subtotal: Number(invoice.subtotal ?? invoice.total),
        taxRate: invoice.taxRate != null ? Number(invoice.taxRate) : null,
        taxAmount: invoice.taxAmount != null ? Number(invoice.taxAmount) : null,
        discountType: invoice.discountType,
        discountValue: invoice.discountValue != null ? Number(invoice.discountValue) : null,
        discountAmount: invoice.discountAmount != null ? Number(invoice.discountAmount) : null,
        total: Number(invoice.total),
        amountPaid: paid || Number(invoice.total),
        amountRemaining: 0,
        currency: invoice.currency,
        notes: invoice.notes,
        invoiceUrl: paymentUrl,
        paymentUrl: null,
        variant: 'receipt',
      });

      const result = await this.gmail.sendEmail({
        businessId: payload.businessId,
        to: recipient,
        subject: `Receipt for Invoice #${invoice.invoiceNumber}`,
        htmlBody: html,
      });

      await this.commerce.recordReceiptSent({
        invoiceId: invoice.id,
        businessId: payload.businessId,
        channel: 'email',
        recipientEmail: recipient,
        messageId: result.messageId,
        actorId: null,
      });
    } catch (err: any) {
      // Don't propagate — receipt auto-send is best-effort. The user can
      // always click "Resend receipt" from the invoice detail drawer. We
      // log loudly so an outage in Gmail/CRM is observable.
      this.logger.warn(
        `Auto-receipt send skipped for invoice ${payload.invoice?.id}: ${(err as Error).message}`,
      );
    }
  }
}

function isExpectedLinkRefusal(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /paid or voided/i.test(msg);
}

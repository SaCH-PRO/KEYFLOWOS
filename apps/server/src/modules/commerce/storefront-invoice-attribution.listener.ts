import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevenueAttributionService } from './revenue-attribution.service';

/**
 * S2: Whenever an Invoice transitions to PAID via the canonical
 * InvoiceWorkflowService, write a `revenue_attributions` row for the
 * storefront-originated subset (deposit invoices attached to a Booking
 * that came from the public storefront, plus any booking-completion
 * invoice produced from a storefront booking).
 *
 * Order checkouts are already attributed at completeCheckout time
 * (revenueType=ORDER), so we deliberately skip invoices we recognize as
 * "storefront order" via the `INV-{orderNumber}` pattern + matching
 * MarketplaceOrder.
 *
 * The write is idempotent (RevenueAttributionService upsert), so this
 * listener is safe even if invoice.paid fires twice for the same row.
 */
@Injectable()
export class StorefrontInvoiceAttributionListener {
  private readonly logger = new Logger(StorefrontInvoiceAttributionListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RevenueAttributionService) private readonly attribution: RevenueAttributionService,
  ) {}

  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: { invoice: { id: string; businessId: string; total: number; currency: string; contactId: string | null }; businessId: string }) {
    const invoiceId = payload?.invoice?.id;
    if (!invoiceId) return;

    // Hydrate enough context to determine origin + referral.
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        booking: { select: { id: true, contactId: true } },
        depositForBooking: { select: { id: true, contactId: true } },
        contact: true,
      },
    });
    if (!invoice) return;

    // Skip storefront product-checkout invoices — already attributed as ORDER
    // by StoreOrderService.completeCheckout in the same transaction as the
    // invoice payment, so we'd otherwise be writing a duplicate row.
    const matchingOrder = await this.prisma.client.marketplaceOrder.findFirst({
      where: { businessId: invoice.businessId, orderNumber: invoice.invoiceNumber.replace(/^INV-/, '') },
      select: { id: true },
    });
    if (matchingOrder) return;

    const booking = invoice.booking ?? invoice.depositForBooking ?? null;
    if (!booking) return; // Non-booking, non-order invoices are out-of-scope for storefront attribution.

    const customFields = (invoice.contact?.custom as Record<string, unknown> | null) ?? {};
    const referralCode = typeof customFields.referralCode === 'string' ? customFields.referralCode : null;
    const isDeposit = !!invoice.depositForBooking;

    // Hard requirement — propagate failures so they surface in unhandled
    // exception logs / APM rather than silently dropping attribution. The
    // upsert is idempotent on (businessId, revenueType, revenueId), so
    // safe re-delivery via event replay or retry queue will not duplicate.
    await this.attribution.record({
      businessId: invoice.businessId,
      source: 'storefront',
      sourceDetail: isDeposit ? `booking-deposit:${booking.id}` : `booking:${booking.id}`,
      revenueType: 'INVOICE',
      revenueId: invoice.id,
      amount: invoice.total,
      currency: invoice.currency,
      contactId: invoice.contactId,
      referralCode,
    });
  }
}

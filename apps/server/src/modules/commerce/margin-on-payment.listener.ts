import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LandedCostEngine } from './landed-cost-engine.service';

/**
 * R5: Margin-on-payment.
 *
 * Whenever an invoice transitions to PAID we look at its line items, and for
 * any line item bound to a `productId` we capture a per-revenue MarginSnapshot
 * row using the existing landed-cost engine. The snapshot is linked back to
 * the invoice (and the order, if the invoice came from a marketplace order)
 * so the invoice/order detail UI can show the margin chip and reports can
 * roll margin up by product/contact.
 *
 * Idempotency: we de-dupe by `(productId, invoiceId)` — re-emitting
 * `invoice.paid` for the same invoice never writes more than one snapshot
 * per product line.
 */
@Injectable()
export class MarginOnPaymentListener {
  private readonly logger = new Logger(MarginOnPaymentListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly landedCostEngine: LandedCostEngine,
  ) {}

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: { invoice?: { id?: string }; businessId: string }) {
    const invoiceId = payload.invoice?.id;
    if (!invoiceId || !payload.businessId) return;
    try {
      await this.captureForInvoice(payload.businessId, invoiceId);
    } catch (err) {
      this.logger.warn(`margin-on-payment failed invoice=${invoiceId}: ${(err as Error).message}`);
    }
  }

  async captureForInvoice(businessId: string, invoiceId: string): Promise<{ captured: number }> {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      include: { items: true },
    });
    if (!invoice) return { captured: 0 };

    // Item.productId may not exist on every InvoiceItem (services, ad-hoc
    // line items). We narrow to the rows that point at a real Product.
    const productLines = (invoice.items as Array<Record<string, unknown>>).filter(
      (it) => typeof it.productId === 'string' && it.productId,
    );
    if (productLines.length === 0) return { captured: 0 };

    let captured = 0;
    for (const line of productLines) {
      const productId = line.productId as string;
      const quantity = Number(line.quantity ?? 1);

      // De-dupe: one snapshot per (product, invoice).
      const existing = await this.prisma.client.marginSnapshot.findFirst({
        where: { productId, invoiceId },
        select: { id: true },
      });
      if (existing) continue;

      const product = await this.prisma.client.product.findFirst({
        where: { id: productId, businessId },
        select: { price: true, currency: true, deletedAt: true },
      });
      if (!product || product.deletedAt) continue;

      const cost = await this.landedCostEngine.calculateForProduct(productId, businessId);
      if (!cost) continue;

      // Use the actual selling price recorded on the invoice line, not the
      // current catalog product.price — discounts, custom-priced lines, and
      // post-sale price changes would otherwise produce a misleading margin.
      // Prefer line.unitPrice; fall back to (line.total / qty) if unitPrice
      // is missing; only fall back to product.price as a last resort.
      const lineUnitPrice = Number((line as { unitPrice?: unknown }).unitPrice ?? NaN);
      const lineTotal = Number((line as { total?: unknown }).total ?? NaN);
      const sellingPrice = Number.isFinite(lineUnitPrice) && lineUnitPrice > 0
        ? lineUnitPrice
        : Number.isFinite(lineTotal) && lineTotal > 0 && quantity > 0
          ? lineTotal / quantity
          : Number(product.price ?? 0);

      const grossMargin = sellingPrice > 0
        ? Math.round(((sellingPrice - cost.landedCostEstimate) / sellingPrice) * 100 * 10) / 10
        : 0;
      const marginBand = this.landedCostEngine.classifyMarginBand(grossMargin);
      const grossProfit = Math.round((sellingPrice - cost.landedCostEstimate) * quantity * 100) / 100;

      await this.prisma.client.marginSnapshot.create({
        data: {
          productId,
          sourceCost: cost.sourceCost,
          sellingPrice,
          landedCostEstimate: cost.landedCostEstimate,
          grossMargin,
          marginBand,
          currency: product.currency,
          snapshotReason: 'invoice_paid',
          invoiceId,
          quantity,
          grossProfit,
        },
      });
      captured++;
    }
    return { captured };
  }
}

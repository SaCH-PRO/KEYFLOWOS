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
 *
 * W10-REOPEN-REVERSALS (owner ruling D-102): a refund's reopen of the invoice
 * marks its snapshots reversed (snapshotReason invoice_paid_reversed; the row
 * and its figures are kept, never deleted, no schema change). Paying the
 * invoice again restores the same row to invoice_paid, so a product line keeps
 * one snapshot per invoice.
 */
const SNAPSHOT_PAID = 'invoice_paid';
const SNAPSHOT_REVERSED = 'invoice_paid_reversed';
@Injectable()
export class MarginOnPaymentListener {
  private readonly logger = new Logger(MarginOnPaymentListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly landedCostEngine: LandedCostEngine,
  ) {}

  /**
   * W10-REOPEN-REVERSALS review repair CR-REOPEN-1 (owner ruling D-102; the
   * SEC-A9-1 pattern of RevenueActionService): the invoice is read PAID before
   * the capture and again after. A stale delivery (the invoice reopened since)
   * captures nothing; a snapshot captured (or restored) after the refund's
   * reopen handler ran is marked reversed here by the same compare-and-set.
   */
  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: { invoice?: { id?: string }; businessId: string }) {
    const invoiceId = payload.invoice?.id;
    const businessId = payload.businessId;
    if (!invoiceId || !businessId) return;
    try {
      if ((await this.invoiceStatus(businessId, invoiceId)) !== 'PAID') return;
      const { captured } = await this.captureForInvoice(businessId, invoiceId);
      if (captured > 0 && (await this.invoiceStatus(businessId, invoiceId)) !== 'PAID') {
        await this.markReversed(businessId, invoiceId);
      }
    } catch (err: any) {
      this.logger.warn(`margin-on-payment failed invoice=${invoiceId}: ${(err as Error).message}`);
    }
  }

  /**
   * W10-REOPEN-REVERSALS (owner ruling D-102): marks the reopened invoice's
   * invoice_paid snapshots reversed (a compare-and-set on the reason: a
   * re-delivered or second reopen marks nothing more; an invoice that never
   * captured one, e.g. PARTIALLY_PAID back to SENT, has nothing to mark). Only
   * snapshots of this business's products. If the invoice is PAID again by the
   * time this ran, its snapshots are restored (as on invoice.paid).
   */
  @OnEvent('invoice.reopened', { async: true })
  async onInvoiceReopened(payload: { invoice?: { id?: string }; businessId: string }) {
    const invoiceId = payload?.invoice?.id;
    const businessId = payload?.businessId;
    if (!invoiceId || !businessId) return;
    try {
      const status = await this.invoiceStatus(businessId, invoiceId);
      if (status == null || status === 'PAID') return;
      const marked = await this.markReversed(businessId, invoiceId);
      if (marked > 0 && (await this.invoiceStatus(businessId, invoiceId)) === 'PAID') {
        await this.captureForInvoice(businessId, invoiceId);
      }
    } catch (err) {
      this.logger.warn(`margin reversal failed invoice=${invoiceId}: ${(err as Error).message}`);
    }
  }

  /** W10-REOPEN-REVERSALS (D-102): marks the invoice's invoice_paid snapshots (this business's products) reversed; returns how many. */
  private async markReversed(businessId: string, invoiceId: string): Promise<number> {
    const marked = await this.prisma.client.marginSnapshot.updateMany({
      where: { invoiceId, snapshotReason: SNAPSHOT_PAID, product: { is: { businessId } } },
      data: { snapshotReason: SNAPSHOT_REVERSED },
    });
    return marked.count;
  }

  private async invoiceStatus(businessId: string, invoiceId: string): Promise<string | null> {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { status: true },
    });
    return inv?.status ?? null;
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
        select: { id: true, snapshotReason: true },
      });
      if (existing) {
        // W10-REOPEN-REVERSALS (D-102): paid again after a reopen: the reversed row is restored.
        if (existing.snapshotReason === SNAPSHOT_REVERSED) {
          const restored = await this.prisma.client.marginSnapshot.updateMany({
            where: { id: existing.id, snapshotReason: SNAPSHOT_REVERSED },
            data: { snapshotReason: SNAPSHOT_PAID },
          });
          captured += restored.count;
        }
        continue;
      }

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
          snapshotReason: SNAPSHOT_PAID,
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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CalendarProjectionService } from '../calendar-projection.service';
import {
  mapInvoiceDue,
  mapInvoiceOverdue,
  mapQuote,
  mapRecurringInvoice,
  SourceInvoice,
  SourceQuote,
  SourceRecurringInvoice,
} from '../projection-mappers';

interface InvoicePayload {
  businessId?: string;
  invoice: SourceInvoice;
}
interface InvoiceDeletedPayload {
  businessId: string;
  invoiceId: string;
}
interface QuotePayload {
  businessId?: string;
  quote: SourceQuote;
}
interface QuoteDeletedPayload {
  businessId: string;
  quoteId: string;
}
interface RecurringPayload {
  businessId?: string;
  recurringInvoice: SourceRecurringInvoice;
}
interface RecurringDeletedPayload {
  businessId: string;
  recurringInvoiceId: string;
}

@Injectable()
export class CalendarCommerceListener {
  private readonly logger = new Logger(CalendarCommerceListener.name);

  constructor(
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
  ) {}

  // ---- Invoices: project on every status / due-date change ----

  @OnEvent('invoice.created', { async: true })
  @OnEvent('invoice.sent', { async: true })
  @OnEvent('invoice.paid', { async: true })
  @OnEvent('invoice.overdue', { async: true })
  @OnEvent('invoice.void', { async: true })
  @OnEvent('invoice.payment_recorded', { async: true })
  @OnEvent('invoice.payment_failed', { async: true })
  @OnEvent('invoice.due_date_changed', { async: true })
  @OnEvent('invoice.updated', { async: true })
  async onInvoiceChanged(payload: InvoicePayload): Promise<void> {
    const invoice = payload?.invoice;
    const businessId = payload?.businessId ?? (invoice as { businessId?: string })?.businessId;
    if (!businessId || !invoice) return;

    const dueInput = mapInvoiceDue(invoice, businessId);
    if (dueInput) {
      try {
        await this.projection.upsertFromSource(dueInput);
      } catch (err: any) {
        this.logger.warn(`invoice projection failed id=${invoice.id}: ${(err as Error).message}`);
      }
    } else {
      await this.projection
        .removeForSource({ businessId, sourceType: 'invoice', sourceId: invoice.id })
        .catch(() => {});
    }

    // OVERDUE projection: keep when status indicates overdue, otherwise remove.
    const isUnpaid =
      invoice.status !== 'PAID' && invoice.status !== 'VOID' && invoice.paidAt == null;
    const isOverdue =
      isUnpaid && invoice.dueDate != null && new Date(invoice.dueDate).getTime() < Date.now();

    if (isOverdue) {
      const overdueInput = mapInvoiceOverdue(invoice, businessId);
      if (overdueInput) {
        await this.projection
          .upsertFromSource(overdueInput)
          .catch((err: Error) =>
            this.logger.warn(`invoice_overdue projection failed: ${err.message}`),
          );
      }
    } else {
      await this.projection
        .removeForSource({ businessId, sourceType: 'invoice_overdue', sourceId: invoice.id })
        .catch(() => {});
    }
  }

  @OnEvent('invoice.deleted', { async: true })
  async onInvoiceDeleted(payload: InvoiceDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.invoiceId) return;
    await Promise.all([
      this.projection.removeForSource({
        businessId: payload.businessId,
        sourceType: 'invoice',
        sourceId: payload.invoiceId,
      }),
      this.projection.removeForSource({
        businessId: payload.businessId,
        sourceType: 'invoice_overdue',
        sourceId: payload.invoiceId,
      }),
    ]).catch((err: Error) => this.logger.warn(`invoice delete projection failed: ${err.message}`));
  }

  // ---- Quotes ----

  @OnEvent('quote.created', { async: true })
  @OnEvent('quote.sent', { async: true })
  @OnEvent('quote.updated', { async: true })
  @OnEvent('quote.expiry_changed', { async: true })
  @OnEvent('quote.converted', { async: true })
  async onQuoteChanged(payload: QuotePayload): Promise<void> {
    const quote = payload?.quote;
    const businessId = payload?.businessId ?? (quote as { businessId?: string })?.businessId;
    if (!businessId || !quote) return;
    const input = mapQuote(quote, businessId);
    if (!input) {
      await this.projection
        .removeForSource({ businessId, sourceType: 'quote', sourceId: quote.id })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(`quote projection failed id=${quote.id}: ${(err as Error).message}`);
    }
  }

  @OnEvent('quote.deleted', { async: true })
  async onQuoteDeleted(payload: QuoteDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.quoteId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'quote',
        sourceId: payload.quoteId,
      })
      .catch((err: Error) => this.logger.warn(`quote delete projection failed: ${err.message}`));
  }

  // ---- Recurring invoices ----

  @OnEvent('recurring_invoice.created', { async: true })
  @OnEvent('recurring_invoice.updated', { async: true })
  @OnEvent('recurring_invoice.generated', { async: true })
  async onRecurringChanged(payload: RecurringPayload): Promise<void> {
    const r = payload?.recurringInvoice;
    const businessId = payload?.businessId ?? (r as { businessId?: string })?.businessId;
    if (!businessId || !r) return;
    const input = mapRecurringInvoice(r, businessId);
    if (!input) return;
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(
        `recurring_invoice projection failed id=${r.id}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('recurring_invoice.deleted', { async: true })
  async onRecurringDeleted(payload: RecurringDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.recurringInvoiceId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'recurring_invoice',
        sourceId: payload.recurringInvoiceId,
      })
      .catch((err: Error) =>
        this.logger.warn(`recurring_invoice delete projection failed: ${err.message}`),
      );
  }
}

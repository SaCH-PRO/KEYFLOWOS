import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { CommerceService } from '../../commerce/commerce.service';

/**
 * Typed adapter that exposes the commerce methods expected by
 * KeyCortexConnectorService.  Delegates to CommerceService where a real
 * implementation exists; otherwise returns a typed placeholder or
 * throws NotImplementedException.
 */
@Injectable()
export class CommerceAdapterService {
  constructor(private readonly commerce: CommerceService) {}

  async createInvoice(input: {
    businessId: string;
    contactId?: string;
    items: Array<Record<string, unknown>>;
    dueDate?: string;
    notes?: string;
    sendImmediately?: boolean;
    source?: string;
  }) {
    const invoice = await this.commerce.createInvoice({
      businessId: input.businessId,
      contactId: input.contactId,
      items: (input.items ?? []).map((item) => ({
        description: String(item.description ?? ''),
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
        productId: item.productId ? String(item.productId) : undefined,
      })),
      dueDate: input.dueDate,
      notes: input.notes,
    });

    if (input.sendImmediately) {
      await this.sendInvoice({
        businessId: input.businessId,
        invoiceId: (invoice as { id: string }).id,
      });
    }

    return invoice;
  }

  async sendInvoice(input: {
    businessId: string;
    invoiceId: string;
    message?: string;
  }) {
    return this.commerce.bulkUpdateInvoices(input.businessId, [input.invoiceId], 'send');
  }

  async getInvoice(input: { businessId: string; invoiceId: string }) {
    const invoice = await this.commerce.getInvoiceWithBusiness(input.invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async listInvoices(input: {
    businessId: string;
    contactId?: string;
    status?: string;
    limit?: number;
  }) {
    const result = await this.commerce.listInvoices(input.businessId, 1, input.limit ?? 50);
    let rows = (result as { data?: unknown[] }).data ?? [];
    if (input.contactId) {
      rows = rows.filter(
        (inv) => (inv as { contactId?: string }).contactId === input.contactId,
      );
    }
    if (input.status) {
      rows = rows.filter(
        (inv) =>
          (inv as { status?: string }).status?.toLowerCase() ===
          input.status?.toLowerCase(),
      );
    }
    return rows;
  }

  async createProduct(input: {
    businessId: string;
    name: string;
    description?: string;
    price: number;
    sku?: string;
    taxable?: boolean;
  }) {
    return this.commerce.createProduct({
      businessId: input.businessId,
      name: input.name,
      description: input.description,
      price: input.price,
      sku: input.sku,
      isActive: input.taxable ?? true,
    });
  }

  async getProduct(input: {
    businessId: string;
    productId?: string;
    sku?: string;
  }) {
    if (!input.productId && !input.sku) {
      throw new NotFoundException('productId or sku required');
    }
    const catalog = await this.commerce.listProducts(input.businessId, 1, 200);
    const products = (catalog as { data?: unknown[] }).data ?? [];
    return (
      products.find((p) =>
        input.productId
          ? (p as { id: string }).id === input.productId
          : (p as { sku?: string }).sku === input.sku,
      ) ?? null
    );
  }

  async createOrder(input: {
    businessId: string;
    contactId: string;
    items: Array<Record<string, unknown>>;
    notes?: string;
  }) {
    // Commerce module does not yet expose a dedicated order service, so we
    // create an invoice as the canonical order record.
    return this.createInvoice({
      businessId: input.businessId,
      contactId: input.contactId,
      items: input.items,
      notes: input.notes,
    });
  }

  async processPayment(input: {
    businessId: string;
    invoiceId: string;
    amount: number;
    method: string;
    reference?: string;
  }) {
    return this.commerce.recordPayment(input.invoiceId, input.businessId, {
      amount: input.amount,
      method: input.method,
      reference: input.reference,
    });
  }

  async createQuote(input: {
    businessId: string;
    contactId: string;
    items: Array<Record<string, unknown>>;
    validUntil?: string;
    notes?: string;
  }) {
    return this.commerce.createQuote({
      businessId: input.businessId,
      contactId: input.contactId,
      items: (input.items ?? []).map((item) => ({
        description: String(item.description ?? ''),
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
        productId: item.productId ? String(item.productId) : undefined,
      })),
      expiryDate: input.validUntil,
      notes: input.notes,
    });
  }

  async sendQuote(input: {
    businessId: string;
    quoteId: string;
    message?: string;
  }) {
    return this.commerce.bulkUpdateQuotes(input.businessId, [input.quoteId], 'send');
  }

  async getRevenueSummary(input: {
    businessId: string;
    from?: string;
    to?: string;
    period?: string;
  }) {
    const now = new Date();
    let from: Date;
    let to: Date;

    if (input.from && input.to) {
      from = new Date(input.from);
      to = new Date(input.to);
    } else {
      switch (input.period) {
        case 'this_month':
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          to = now;
          break;
        case 'last_month':
          from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          to = new Date(now.getFullYear(), now.getMonth(), 0);
          break;
        case 'this_quarter':
          from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
          to = now;
          break;
        case 'this_year':
          from = new Date(now.getFullYear(), 0, 1);
          to = now;
          break;
        default:
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          to = now;
      }
    }

    const invoices = await this.commerce.listInvoices(input.businessId, 1, 1000);
    const rows = ((invoices as { data?: Array<{ status?: string; total?: number; paidAt?: Date | string }> }).data ?? []).filter(
      (inv) =>
        inv.status === 'PAID' &&
        inv.paidAt &&
        new Date(inv.paidAt) >= from &&
        new Date(inv.paidAt) <= to,
    );
    const total = rows.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);

    return {
      total,
      count: rows.length,
      currency: 'TTD',
      period: input.period ?? 'custom',
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async getOutstandingInvoices(input: {
    businessId: string;
    contactId?: string;
    overdueOnly?: boolean;
    limit?: number;
  }) {
    const result = await this.commerce.listInvoices(input.businessId, 1, input.limit ?? 200);
    let rows = (result as { data?: Array<{ status?: string; contactId?: string; dueDate?: string | Date }> }).data ?? [];
    rows = rows.filter((inv) =>
      ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(inv.status ?? ''),
    );
    if (input.contactId) {
      rows = rows.filter((inv) => inv.contactId === input.contactId);
    }
    if (input.overdueOnly) {
      const now = new Date();
      rows = rows.filter((inv) => inv.dueDate && new Date(inv.dueDate) < now);
    }
    return rows;
  }

  async getProductCatalog(input: { businessId: string; search?: string; limit?: number }) {
    const result = await this.commerce.listProducts(input.businessId, 1, input.limit ?? 200);
    let rows = (result as { data?: unknown[] }).data ?? [];
    if (input.search) {
      const q = input.search.toLowerCase();
      rows = rows.filter((p) =>
        String((p as { name?: string }).name ?? '').toLowerCase().includes(q) ||
        String((p as { description?: string }).description ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }

  async getPaymentHistory(input: {
    businessId: string;
    contactId?: string;
    invoiceId?: string;
    limit?: number;
  }) {
    const payments = await this.commerce.listAllPayments(input.businessId, {
      contactId: input.contactId,
    });
    let rows = payments as unknown[];
    if (input.invoiceId) {
      rows = rows.filter((p) => (p as { invoiceId?: string }).invoiceId === input.invoiceId);
    }
    return rows.slice(0, input.limit ?? 50);
  }

  async getQuoteStatus(input: { businessId: string; quoteId: string }) {
    const quote = await this.commerce.getQuote(input.quoteId);
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    return quote;
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_invoice': {
        const invoice = await this.createInvoice({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          items: command.parameters.items as Array<Record<string, unknown>>,
          dueDate: command.parameters.dueDate as string,
          notes: command.parameters.notes as string,
          sendImmediately: (command.parameters.sendImmediately as boolean) || false,
          source: 'key_cortex',
        });
        return connectorOk(command, start, invoice);
      }
      case 'send_invoice': {
        const sent = await this.sendInvoice({
          businessId: command.businessId,
          invoiceId: command.parameters.invoiceId as string,
          message: command.parameters.message as string,
        });
        return connectorOk(command, start, sent);
      }
      case 'get_invoice': {
        const invoice = await this.getInvoice({
          businessId: command.businessId,
          invoiceId: command.parameters.invoiceId as string,
        });
        return connectorOk(command, start, invoice);
      }
      case 'list_invoices': {
        const invoices = await this.listInvoices({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          status: command.parameters.status as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, invoices);
      }
      case 'create_product': {
        const product = await this.createProduct({
          businessId: command.businessId,
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          price: command.parameters.price as number,
          sku: command.parameters.sku as string,
          taxable: (command.parameters.taxable as boolean) ?? true,
        });
        return connectorOk(command, start, product);
      }
      case 'get_product': {
        const product = await this.getProduct({
          businessId: command.businessId,
          productId: command.parameters.productId as string,
          sku: command.parameters.sku as string,
        });
        return connectorOk(command, start, product);
      }
      case 'create_order': {
        const order = await this.createOrder({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          items: command.parameters.items as Array<Record<string, unknown>>,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, order);
      }
      case 'process_payment': {
        const payment = await this.processPayment({
          businessId: command.businessId,
          invoiceId: command.parameters.invoiceId as string,
          amount: command.parameters.amount as number,
          method: command.parameters.method as string,
          reference: command.parameters.reference as string,
        });
        return connectorOk(command, start, payment);
      }
      case 'create_quote': {
        const quote = await this.createQuote({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          items: command.parameters.items as Array<Record<string, unknown>>,
          validUntil: command.parameters.validUntil as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, quote);
      }
      case 'send_quote': {
        const sent = await this.sendQuote({
          businessId: command.businessId,
          quoteId: command.parameters.quoteId as string,
          message: command.parameters.message as string,
        });
        return connectorOk(command, start, sent);
      }
      case 'get_revenue_summary': {
        const summary = await this.getRevenueSummary({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          period: command.parameters.period as string,
        });
        return connectorOk(command, start, summary);
      }
      case 'get_outstanding_invoices': {
        const invoices = await this.getOutstandingInvoices({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          overdueOnly: (command.parameters.overdueOnly as boolean) || false,
          limit: (command.parameters.limit as number) || 200,
        });
        return connectorOk(command, start, invoices);
      }
      case 'get_product_catalog': {
        const catalog = await this.getProductCatalog({
          businessId: command.businessId,
          search: command.parameters.search as string,
          limit: (command.parameters.limit as number) || 200,
        });
        return connectorOk(command, start, catalog);
      }
      case 'get_payment_history': {
        const payments = await this.getPaymentHistory({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          invoiceId: command.parameters.invoiceId as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, payments);
      }
      case 'get_quote_status': {
        const quote = await this.getQuoteStatus({
          businessId: command.businessId,
          quoteId: command.parameters.quoteId as string,
        });
        return connectorOk(command, start, quote);
      }
      default:
        return connectorFail(command, start, `Unknown commerce action: ${command.action}`);
    }
  }
}

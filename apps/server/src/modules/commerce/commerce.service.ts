import { ForbiddenException, Inject, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  QuoteCreatedPayload,
  QuoteSentPayload,
  QuoteViewedPayload,
  QuoteAcceptedPayload,
  QuoteRejectedPayload,
  QuoteStalePayload,
  QuoteConvertedPayload,
  InvoiceCreatedPayload,
} from '../../core/event-bus/events.types';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Service, Prisma } from '@keyflow/db';
import { CrmService } from '../crm/crm.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CommerceStatsService } from './commerce-stats.service';
import { InvoiceWorkflowService, InvoiceStatus } from './invoice-workflow.service';
import { CatalogService } from '../catalog/catalog.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';

@Injectable()
export class CommerceService {
  private readonly logger = new Logger(CommerceService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CommerceStatsService) private readonly statsCache: CommerceStatsService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
    @Inject(RevenuePostingService) private readonly revenuePosting: RevenuePostingService,
  ) {}

  /**
   * @deprecated Use CatalogService.listProducts directly. This pass-through
   * remains so the existing /commerce/businesses/:id/products endpoint keeps
   * working; it will be removed once Commerce callers migrate (see S2).
   */
  async listProducts(businessId: string, page = 1, pageSize = 50) {
    return this.catalog.listProducts(businessId, page, pageSize);
  }

  /** @deprecated Use CatalogService.listPublicProducts. */
  async listPublicProducts(businessId: string) {
    return this.catalog.listPublicProducts(businessId);
  }

  /** @deprecated Use CatalogService.createProduct. */
  async createProduct(input: {
    businessId: string;
    name: string;
    price: number;
    currency?: string;
    description?: string | null;
    category?: string;
    duration?: number | null;
    imageUrl?: string | null;
    sku?: string | null;
    isActive?: boolean;
  }) {
    const result = await this.catalog.createProduct(input);
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  /** @deprecated Use CatalogService.updateProduct. */
  async updateProduct(input: {
    businessId: string;
    productId: string;
    name?: string;
    price?: number;
    currency?: string;
    description?: string | null;
    category?: string;
    duration?: number | null;
    imageUrl?: string | null;
    sku?: string | null;
    isActive?: boolean;
  }) {
    const result = await this.catalog.updateProduct(input);
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  /** @deprecated Use CatalogService.deleteProduct. */
  async deleteProduct(businessId: string, productId: string) {
    const result = await this.catalog.deleteProduct(businessId, productId);
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  /** @deprecated Use CatalogService.bulkUpdateProducts. */
  async bulkUpdateProducts(businessId: string, ids: string[], action: 'activate' | 'deactivate' | 'delete') {
    const result = await this.catalog.bulkUpdateProducts(businessId, ids, action);
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async createInvoiceForService(
    businessId: string,
    contactId: string,
    service: Service,
    options?: { kind?: 'FULL' | 'DEPOSIT'; amountOverride?: number; descriptionSuffix?: string },
  ) {
    const kind = options?.kind ?? 'FULL';
    const total = options?.amountOverride ?? service.price;
    const description =
      kind === 'DEPOSIT'
        ? `Deposit — ${service.name}${options?.descriptionSuffix ?? ''}`
        : `${service.name}${options?.descriptionSuffix ?? ''}`;
    return this.prisma.client.invoice.create({
      data: {
        businessId,
        contactId,
        invoiceNumber: `INV-${Date.now()}`,
        status: 'DRAFT',
        issueDate: new Date(),
        subtotal: total,
        total,
        currency: 'TTD',
        notes: kind === 'DEPOSIT' ? `Deposit for service "${service.name}"` : null,
        items: {
          create: [
            {
              description,
              quantity: 1,
              unitPrice: total,
              total,
            },
          ],
        },
      },
      include: { items: true, contact: true },
    });
  }

  /**
   * Compute the deposit amount for a service using its deposit config.
   * Returns 0 when deposit is not required or value is invalid.
   */
  computeServiceDeposit(service: Pick<Service, 'price'> & { depositRequired?: boolean | null; depositType?: string | null; depositValue?: number | null }): number {
    if (!service.depositRequired) return 0;
    const value = service.depositValue ?? 0;
    if (value <= 0) return 0;
    if (service.depositType === 'PERCENT') {
      const pct = Math.min(Math.max(value, 0), 100);
      return Math.round(((service.price * pct) / 100) * 100) / 100;
    }
    if (service.depositType === 'FIXED') {
      return Math.min(value, service.price);
    }
    return 0;
  }

  private validateTaxAndDiscount(taxRate?: number, discountValue?: number, discountType?: string) {
    if (taxRate !== undefined && taxRate !== null) {
      if (taxRate < 0 || taxRate > 100) {
        throw new Error('Tax rate must be between 0 and 100');
      }
    }
    if (discountValue !== undefined && discountValue !== null) {
      if (discountValue < 0) {
        throw new Error('Discount value must be non-negative');
      }
      if (discountType === 'PERCENT' && discountValue > 100) {
        throw new Error('Percentage discount cannot exceed 100%');
      }
    }
  }

  async createInvoice(input: {
    businessId: string;
    contactId?: string;
    items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    dueDate?: Date | string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
  }) {
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = (subtotal * taxRate) / 100;
    let discountAmount = 0;
    if (input.discountType === 'PERCENT' && input.discountValue) {
      discountAmount = (subtotal * input.discountValue) / 100;
    } else if (input.discountType === 'FIXED' && input.discountValue) {
      discountAmount = input.discountValue;
    }
    const total = subtotal + taxAmount - discountAmount;
    const data: any = {
      businessId: input.businessId,
      invoiceNumber: `INV-${Date.now()}`,
      status: 'DRAFT',
      issueDate: new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      subtotal,
      taxRate,
      taxAmount,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? null,
      discountAmount,
      total,
      currency: input.currency ?? 'TTD',
      notes: input.notes ?? null,
      items: {
        create: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
        })),
      },
    };
    if (input.contactId) {
      data.contactId = input.contactId;
    }
    const invoice = await this.prisma.client.invoice.create({
      data,
      include: { items: true, contact: true },
    });
    this.events.emit('invoice.created', {
      invoice,
      businessId: input.businessId,
      source: 'manual',
      quoteId: null,
    } as InvoiceCreatedPayload);
    this.statsCache.invalidateCache(input.businessId);
    return invoice;
  }

  async listInvoices(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { contact: true, quote: true, payments: true, items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.invoice.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async bulkUpdateInvoices(businessId: string, ids: string[], action: 'send' | 'void' | 'delete') {
    if (action === 'delete') {
      // Delete is not a state transition; gated by status check.
      const result = await this.prisma.client.invoice.updateMany({
        where: { id: { in: ids }, businessId, deletedAt: null, status: { notIn: ['PAID', 'PARTIALLY_PAID'] } },
        data: { deletedAt: new Date() },
      });
      this.statsCache.invalidateCache(businessId);
      return { updated: result.count, action };
    }
    // 'send' / 'void' route through the workflow so the state machine is
    // enforced per-row; illegal transitions silently no-op (the bulk caller
    // does not want a single bad row to fail the whole batch).
    const target: InvoiceStatus = action === 'send' ? 'SENT' : 'VOID';
    const candidates = await this.prisma.client.invoice.findMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      select: { id: true, status: true },
    });
    let updated = 0;
    for (const row of candidates) {
      try {
        await this.invoiceWorkflow.transition(
          row.id,
          target,
          target === 'SENT' ? { sentAt: new Date() } : {},
        );
        updated++;
      } catch (err) {
          this.logger.warn(`409 illegal transition -> skip silently in bulk mode.: ${err instanceof Error ? err.message : err}`);
        }
    }
    this.statsCache.invalidateCache(businessId);
    return { updated, action };
  }

  async bulkUpdateQuotes(businessId: string, ids: string[], action: 'send' | 'reject' | 'delete') {
    const where = { id: { in: ids }, businessId, deletedAt: null };
    let result: { count: number };
    switch (action) {
      case 'send': {
        // Mint viewTokens per-row so bulk-sent quotes have valid public links.
        const candidates = await this.prisma.client.quote.findMany({
          where: { ...where, status: 'DRAFT' },
          select: { id: true, viewToken: true },
        });
        let updatedCount = 0;
        for (const q of candidates) {
          const data: Record<string, any> = { status: 'SENT', sentAt: new Date() };
          if (!q.viewToken) data.viewToken = this.generateQuoteToken();
          await this.prisma.client.quote.update({ where: { id: q.id }, data });
          updatedCount++;
          this.events.emit('quote.sent', { quote: { id: q.id, ...data }, businessId } as QuoteSentPayload);
        }
        result = { count: updatedCount };
        break;
      }
      case 'reject':
        result = await this.prisma.client.quote.updateMany({
          where: { ...where, status: { in: ['SENT'] } },
          data: { status: 'REJECTED' },
        });
        break;
      case 'delete':
        result = await this.prisma.client.quote.updateMany({
          where: { ...where, status: { in: ['DRAFT', 'SENT', 'REJECTED', 'EXPIRED'] } },
          data: { deletedAt: new Date() },
        });
        break;
    }
    this.statsCache.invalidateCache(businessId);
    return { updated: result.count, action };
  }

  async deleteInvoice(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      throw new Error('Cannot delete a paid or partially paid invoice');
    }
    const result = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('invoice.deleted', { businessId, invoiceId });
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async getInvoiceWithBusiness(invoiceId: string, requireShareable = false) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contact: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        items: true,
        // Required by buildInvoiceEmailContext so amountPaid/remaining
        // render correctly on invoice/reminder/receipt emails — without
        // payments the customer-facing template falls back to 0 paid.
        payments: true,
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            city: true,
            country: true,
            phone: true,
            email: true,
            website: true,
            primaryColor: true,
            secondaryColor: true,
            invoiceTemplate: true,
            quoteTemplate: true,
            facebook: true,
            instagram: true,
            twitter: true,
            whatsapp: true,
          },
        },
      },
    });

    if (!invoice) return null;

    if (requireShareable) {
      const shareableStatuses = ['SENT', 'PAID', 'OVERDUE', 'PARTIALLY_PAID'];
      if (!shareableStatuses.includes(invoice.status)) {
        return null;
      }
    }

    if ((!invoice.subtotal || invoice.subtotal === 0) && invoice.items?.length > 0) {
      const computedSubtotal = invoice.items.reduce((sum, item) => sum + (item.total || 0), 0);
      const computedTaxAmount = invoice.taxRate ? computedSubtotal * (invoice.taxRate / 100) : 0;
      return {
        ...invoice,
        subtotal: computedSubtotal,
        taxAmount: invoice.taxAmount ?? computedTaxAmount,
      };
    }

    return invoice;
  }

  async markInvoicePaid(invoiceId: string, actorId?: string | null) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true, status: true, total: true, currency: true },
    });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
    if (actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingInvoice.businessId, userId: actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this invoice');
      }
    }
    // Delegate the state mutation + invoice.paid event emission to the
    // workflow service so the (DRAFT|SENT|...) -> PAID transition is
    // enforced through the canonical state machine. Idempotent: callers
    // can re-invoke and we just re-load the row.
    let invoice;
    if (existingInvoice.status === 'PAID') {
      invoice = await this.prisma.client.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true, contact: true, booking: true },
      });
    } else {
      invoice = await this.invoiceWorkflow.transition(invoiceId, 'PAID');
    }
    if (!invoice) throw new Error('Invoice not found');

    // Create a Payment record if none exists so reconciliation math works.
    const existingPayments = await this.prisma.client.payment.count({
      where: { invoiceId },
    });
    if (existingPayments === 0) {
      await this.prisma.client.payment.create({
        data: {
          businessId: existingInvoice.businessId,
          invoiceId,
          amount: existingInvoice.total,
          currency: existingInvoice.currency,
          status: 'COMPLETED',
          method: 'MANUAL',
          paidAt: new Date(),
        },
      });
    }

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.paid',
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          paidAt: invoice.paidAt,
          bookingId: invoice.booking?.id,
        },
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }
    
    return invoice;
  }

  async markInvoicePaymentFailed(invoiceId: string, actorId?: string | null, reason?: string) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
    if (actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingInvoice.businessId, userId: actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this invoice');
      }
    }
    const invoice = await this.invoiceWorkflow.transition(invoiceId, 'FAILED');
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_failed',
        data: { invoiceId: invoice.id, reason },
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }
    return invoice;
  }

  async updateQuoteStatus(params: {
    quoteId: string;
    status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    actorId?: string | null;
    source?: 'public' | 'internal';
    reason?: string | null;
  }) {
    const existingQuote = await this.prisma.client.quote.findUnique({
      where: { id: params.quoteId },
      select: { businessId: true, status: true, viewToken: true },
    });
    if (!existingQuote) {
      throw new Error('Quote not found');
    }
    if (params.actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingQuote.businessId, userId: params.actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this quote');
      }
    }
    const now = new Date();
    const data: Record<string, any> = { status: params.status };
    if (params.status === 'SENT') {
      data.sentAt = now;
      // Make sure a public-link token exists so the email URL works.
      if (!existingQuote.viewToken) {
        data.viewToken = this.generateQuoteToken();
      }
    } else if (params.status === 'ACCEPTED') {
      data.acceptedAt = now;
    } else if (params.status === 'REJECTED') {
      data.rejectedAt = now;
    }
    const quote = await this.prisma.client.quote.update({
      where: { id: params.quoteId },
      data,
      include: { contact: true },
    });
    const source = params.source ?? 'internal';
    if (params.status === 'SENT' && existingQuote.status !== 'SENT') {
      this.events.emit('quote.sent', { quote, businessId: quote.businessId } as QuoteSentPayload);
    }
    if (params.status === 'ACCEPTED' && existingQuote.status !== 'ACCEPTED') {
      this.events.emit('quote.accepted', {
        quote,
        businessId: quote.businessId,
        acceptedAt: now,
        source,
      } as QuoteAcceptedPayload);
    }
    if (params.status === 'REJECTED' && existingQuote.status !== 'REJECTED') {
      this.events.emit('quote.rejected', {
        quote,
        businessId: quote.businessId,
        rejectedAt: now,
        source,
        reason: params.reason ?? null,
      } as QuoteRejectedPayload);
    }
    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: `quote.${params.status.toLowerCase()}`,
        data: {
          quoteId: quote.id,
          total: quote.total,
          currency: quote.currency,
          source,
          reason: params.reason ?? undefined,
        },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      });
    }
    this.statsCache.invalidateCache(existingQuote.businessId);
    return quote;
  }

  // R2: how many days a SENT quote can sit without a view/accept before
  // we surface it as a stale-quote candidate for the Action Queue.
  static readonly QUOTE_STALE_DAYS = 7;

  private generateQuoteToken(): string {
    return randomBytes(24).toString('base64url');
  }

  private isStaleQuote(quote: {
    status: string;
    sentAt?: Date | null;
    viewedAt?: Date | null;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    lastFollowUpAt?: Date | null;
  }, now: Date = new Date()): boolean {
    if (quote.status !== 'SENT') return false;
    if (quote.viewedAt || quote.acceptedAt || quote.rejectedAt) return false;
    if (!quote.sentAt) return false;
    // R3: a recent follow-up reminder clears the stale state until the
    // quote ages another QUOTE_STALE_DAYS without progress.
    const reference = quote.lastFollowUpAt && new Date(quote.lastFollowUpAt) > new Date(quote.sentAt)
      ? new Date(quote.lastFollowUpAt)
      : new Date(quote.sentAt);
    const daysSinceReference = (now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceReference >= CommerceService.QUOTE_STALE_DAYS;
  }

  private decorateQuote<T extends {
    status: string;
    expiryDate?: Date | null;
    sentAt?: Date | null;
    viewedAt?: Date | null;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    invoiceId?: string | null;
    invoice?: { status?: string | null } | null;
  }>(quote: T, now: Date = new Date()): T & { isStale: boolean; isExpired: boolean; lifecycleStep: string } {
    const isExpired =
      !!quote.expiryDate &&
      new Date(quote.expiryDate).getTime() < now.getTime() &&
      quote.status !== 'ACCEPTED' &&
      !quote.invoiceId;
    let lifecycleStep: string = 'DRAFT';
    if (quote.invoice?.status === 'PAID') lifecycleStep = 'PAID';
    else if (quote.invoiceId) lifecycleStep = 'INVOICED';
    else if (quote.status === 'ACCEPTED') lifecycleStep = 'ACCEPTED';
    else if (quote.status === 'REJECTED') lifecycleStep = 'REJECTED';
    else if (quote.viewedAt && quote.status === 'SENT') lifecycleStep = 'VIEWED';
    else if (quote.status === 'SENT') lifecycleStep = 'SENT';
    return {
      ...quote,
      isStale: this.isStaleQuote(quote, now),
      isExpired,
      lifecycleStep,
    };
  }

  async updateInvoiceStatus(params: {
    invoiceId: string;
    status: 'SENT' | 'OVERDUE' | 'VOID';
    actorId?: string | null;
    sentAt?: Date | string;
    dueDate?: Date | string | null;
  }) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: params.invoiceId },
      select: { businessId: true },
    });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
    if (params.actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingInvoice.businessId, userId: params.actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this invoice');
      }
    }
    // Route through the workflow so transitions like PAID -> SENT throw
    // 409 instead of silently corrupting the row.
    const invoice = await this.invoiceWorkflow.transition(params.invoiceId, params.status, {
      sentAt: params.sentAt ? new Date(params.sentAt) : undefined,
      dueDate: params.dueDate ? new Date(params.dueDate) : undefined,
    });

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: `invoice.${params.status.toLowerCase()}`,
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          bookingId: invoice.booking?.id,
        },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      });
    }
    // (Event emission is handled inside InvoiceWorkflowService.transition.)

    this.statsCache.invalidateCache(existingInvoice.businessId);
    return invoice;
  }

  // ========== QUOTES ==========

  async listQuotes(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.quote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { contact: true, items: true, invoice: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.quote.count({ where }),
    ]);
    const now = new Date();
    return {
      data: data.map((q) => this.decorateQuote(q, now)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * R2: returns SENT quotes that have been sitting `daysThreshold` days
   * without a view/accept/reject. R3 consumes this for the Action Queue.
   */
  async getStaleQuotes(businessId: string, daysThreshold = CommerceService.QUOTE_STALE_DAYS) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.client.quote.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'SENT',
        viewedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        sentAt: { lte: cutoff },
      },
      include: { contact: true, items: true, invoice: true },
      orderBy: { sentAt: 'asc' },
    });
    // R3: filter out quotes that were nudged within the last
    // QUOTE_STALE_DAYS so we don't keep re-surfacing the same row in
    // the Action Queue every day.
    const stale = candidates.filter((q) => {
      if (!q.lastFollowUpAt) return true;
      const lastFollowUp = new Date(q.lastFollowUpAt);
      return lastFollowUp.getTime() <= cutoff.getTime();
    });
    const decoratedRows = stale.map((q) => {
      const decorated = this.decorateQuote(q, now);
      const reference = q.lastFollowUpAt && new Date(q.lastFollowUpAt) > new Date(q.sentAt!)
        ? new Date(q.lastFollowUpAt)
        : new Date(q.sentAt!);
      const daysSinceSent = Math.floor((now.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24));
      return { ...decorated, daysSinceSent };
    });
    // Emit one canonical quote.stale event per stale row so the Action
    // Queue / notification consumers can pick them up. Idempotency is
    // delegated to the caller (typically a once-per-day scheduled scan)
    // so we never silently swallow events here.
    for (const row of decoratedRows) {
      this.events.emit('quote.stale', {
        quote: row,
        businessId,
        sentAt: row.sentAt ?? now,
        daysSinceSent: row.daysSinceSent,
      } as QuoteStalePayload);
    }
    return decoratedRows;
  }

  /**
   * R3: stamp a follow-up timestamp on a quote so it's no longer
   * considered stale until it ages another QUOTE_STALE_DAYS without
   * progress. Returns the updated quote.
   */
  async markQuoteFollowedUp(params: {
    quoteId: string;
    businessId: string;
    actorId?: string | null;
  }) {
    const existing = await this.prisma.client.quote.findFirst({
      where: { id: params.quoteId, businessId: params.businessId, deletedAt: null },
      select: { id: true, status: true, contactId: true },
    });
    if (!existing) throw new NotFoundException('Quote not found');
    if (existing.status !== 'SENT') {
      throw new BadRequestException(`Quote is ${existing.status} — only SENT quotes can be followed up`);
    }
    const now = new Date();
    const updated = await this.prisma.client.quote.update({
      where: { id: params.quoteId },
      data: { lastFollowUpAt: now },
      include: { contact: true, items: true, invoice: true },
    });
    if (existing.contactId) {
      await this.crm.logContactEvent({
        businessId: params.businessId,
        contactId: existing.contactId,
        type: 'quote.follow_up_sent',
        data: { quoteId: params.quoteId, followUpAt: now.toISOString() },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      }).catch(() => undefined);
    }
    return this.decorateQuote(updated, now);
  }

  async getQuote(quoteId: string) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { id: quoteId },
      include: {
        contact: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        items: true,
        invoice: true,
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            phone: true,
            email: true,
            website: true,
            primaryColor: true,
          },
        },
      },
    });
    if (!quote) return null;
    return this.decorateQuote(quote);
  }

  // ----- R2: public quote-view + accept/reject by signed token -----

  async getQuoteByToken(token: string) {
    if (!token) return null;
    const quote = await this.prisma.client.quote.findUnique({
      where: { viewToken: token },
      include: {
        contact: { select: { firstName: true, lastName: true, email: true } },
        items: true,
        invoice: { select: { id: true, invoiceNumber: true, status: true, total: true } },
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            phone: true,
            email: true,
            website: true,
            primaryColor: true,
          },
        },
      },
    });
    if (!quote || quote.deletedAt) return null;
    return this.decorateQuote(quote);
  }

  async markQuoteViewedByToken(token: string, visitorId?: string | null) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { viewToken: token },
      select: {
        id: true,
        businessId: true,
        status: true,
        viewedAt: true,
        deletedAt: true,
        contactId: true,
      },
    });
    if (!quote || quote.deletedAt) return null;
    // Only flip the first time someone views it; later visits are no-ops
    // so we never spam quote.viewed events.
    if (quote.viewedAt || quote.status !== 'SENT') {
      return this.getQuoteByToken(token);
    }
    const now = new Date();
    const updated = await this.prisma.client.quote.update({
      where: { id: quote.id },
      data: { viewedAt: now },
      include: { contact: true },
    });
    this.events.emit('quote.viewed', {
      quote: updated,
      businessId: quote.businessId,
      viewedAt: now,
      source: 'public',
    } as QuoteViewedPayload);
    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: 'quote.viewed',
        data: { quoteId: quote.id, source: 'public' },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
      if (visitorId) {
        await this.publicEvents
          .attachVisitorToContact({
            businessId: quote.businessId,
            contactId: quote.contactId,
            visitorId,
            sourceDetail: `quote:${quote.id}`,
          })
          .catch(() => undefined);
      }
    }
    this.statsCache.invalidateCache(quote.businessId);
    return this.getQuoteByToken(token);
  }

  async respondToQuoteByToken(
    token: string,
    decision: 'accept' | 'reject',
    reason?: string,
    visitorId?: string | null,
  ) {
    const quote = await this.prisma.client.quote.findUnique({
      where: { viewToken: token },
      select: {
        id: true,
        businessId: true,
        status: true,
        invoiceId: true,
        deletedAt: true,
        expiryDate: true,
        contactId: true,
      },
    });
    if (!quote || quote.deletedAt) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.invoiceId) {
      throw new BadRequestException('This quote has already been converted to an invoice.');
    }
    // Only quotes the business has explicitly sent can be acted on via
    // the public link — a draft (or already-decided) quote must not be
    // accepted/rejected by a token holder.
    if (quote.status !== 'SENT') {
      if (quote.status === 'ACCEPTED' || quote.status === 'REJECTED') {
        throw new BadRequestException(`This quote has already been ${quote.status.toLowerCase()}.`);
      }
      throw new BadRequestException('This quote is not available for a response yet.');
    }
    if (quote.expiryDate && new Date(quote.expiryDate).getTime() < Date.now()) {
      throw new BadRequestException('This quote has expired and can no longer be responded to.');
    }
    const target: 'ACCEPTED' | 'REJECTED' = decision === 'accept' ? 'ACCEPTED' : 'REJECTED';
    const result = await this.updateQuoteStatus({
      quoteId: quote.id,
      status: target,
      source: 'public',
      reason: reason ?? null,
    });
    // Stitch the public visitor cookie onto the quote's contact so first-touch
    // attribution (firstSource / utmMedium / utmCampaign / firstReferrer /
    // firstLandingPath) lands on the Contact even though it was originally
    // created internally without a visitorId.
    if (visitorId && quote.contactId) {
      await this.publicEvents
        .attachVisitorToContact({
          businessId: quote.businessId,
          contactId: quote.contactId,
          visitorId,
          sourceDetail: `quote:${quote.id}`,
        })
        .catch(() => undefined);
    }
    return result;
  }

  async createQuote(input: {
    businessId: string;
    contactId: string;
    items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    expiryDate?: Date | string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
  }) {
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = subtotal * taxRate / 100;
    const discountValue = input.discountValue ?? 0;
    const discountAmount = input.discountType === 'FIXED' ? discountValue : subtotal * discountValue / 100;
    const total = subtotal + taxAmount - discountAmount;
    
    // R2: viewToken is intentionally NOT generated at draft time. The
    // public accept/reject URL is minted only when the quote is sent so
    // pre-send drafts can never be acted on via a leaked link.
    const quote = await this.prisma.client.quote.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        quoteNumber: `QT-${Date.now()}`,
        status: 'DRAFT',
        issueDate: new Date(),
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        subtotal,
        taxRate,
        taxAmount,
        discountType: input.discountType ?? null,
        discountValue,
        discountAmount,
        total,
        currency: input.currency ?? 'TTD',
        notes: input.notes ?? null,
        items: {
          create: input.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
            productId: item.productId ?? null,
          })),
        },
      },
      include: { items: true, contact: true },
    });
    this.events.emit('quote.created', { quote, businessId: input.businessId } as QuoteCreatedPayload);
    if (input.contactId) {
      await this.crm.logContactEvent({
        businessId: input.businessId,
        contactId: input.contactId,
        type: 'quote.created',
        data: { quoteId: quote.id, total: quote.total, currency: quote.currency },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }
    this.statsCache.invalidateCache(input.businessId);
    return quote;
  }

  async updateQuote(input: {
    quoteId: string;
    businessId: string;
    contactId?: string;
    items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    expiryDate?: Date | string | null;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
  }) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId },
    });
    if (!quote) {
      throw new Error('Quote not found');
    }
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    if (quote.status === 'ACCEPTED' && quote.invoiceId) {
      throw new Error('Cannot edit a quote that has been converted to an invoice');
    }
    
    const updateData: any = {};
    if (input.contactId) updateData.contactId = input.contactId;
    if (input.currency) updateData.currency = input.currency;
    if (input.expiryDate !== undefined) {
      updateData.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
    }
    if (input.notes !== undefined) updateData.notes = input.notes;
    
    // Get items for recalculating totals
    const currentItems = input.items ?? (await this.prisma.client.quoteItem.findMany({ where: { quoteId: input.quoteId } }));
    const subtotal = currentItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    
    // Handle tax/discount updates
    const taxRate = input.taxRate ?? quote.taxRate ?? 0;
    const discountType = input.discountType ?? quote.discountType;
    const discountValue = input.discountValue ?? quote.discountValue ?? 0;
    
    const taxAmount = subtotal * taxRate / 100;
    const discountAmount = discountType === 'FIXED' ? discountValue : subtotal * discountValue / 100;
    const total = subtotal + taxAmount - discountAmount;
    
    updateData.subtotal = subtotal;
    updateData.taxRate = taxRate;
    updateData.taxAmount = taxAmount;
    updateData.discountType = discountType;
    updateData.discountValue = discountValue;
    updateData.discountAmount = discountAmount;
    updateData.total = total;
    
    if (input.items) {
      await this.prisma.client.quoteItem.deleteMany({ where: { quoteId: input.quoteId } });
      updateData.items = {
        create: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
          productId: item.productId ?? null,
        })),
      };
    }
    
    const updated = await this.prisma.client.quote.update({
      where: { id: input.quoteId },
      data: updateData,
      include: { items: true, contact: true },
    });
    const prevExp = quote.expiryDate ? new Date(quote.expiryDate).getTime() : null;
    const newExp = updated.expiryDate ? new Date(updated.expiryDate).getTime() : null;
    if (input.expiryDate !== undefined && prevExp !== newExp) {
      this.events.emit('quote.expiry_changed', {
        quote: updated,
        businessId: input.businessId,
        previousExpiryDate: quote.expiryDate ?? null,
      });
    }
    this.events.emit('quote.updated', { quote: updated, businessId: input.businessId });
    this.statsCache.invalidateCache(input.businessId);
    return updated;
  }

  async deleteQuote(quoteId: string, businessId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId },
    });
    if (!quote) {
      throw new Error('Quote not found');
    }
    if (quote.invoiceId) {
      throw new Error('Cannot delete a quote that has been converted to an invoice');
    }
    const result = await this.prisma.client.quote.update({
      where: { id: quoteId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('quote.deleted', { businessId, quoteId });
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async convertQuoteToInvoice(input: {
    quoteId: string;
    businessId: string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
    dueDate?: Date | string;
  }) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId, deletedAt: null },
      include: { items: true },
    });
    if (!quote) {
      throw new Error('Quote not found');
    }
    if (quote.status !== 'ACCEPTED') {
      throw new Error('Only accepted quotes can be converted to invoices');
    }
    if (quote.invoiceId) {
      throw new Error('Quote has already been converted to an invoice');
    }

    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const subtotal = quote.items.reduce((sum, item) => sum + item.total, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = (subtotal * taxRate) / 100;
    let discountAmount = 0;
    if (input.discountType === 'PERCENT' && input.discountValue) {
      discountAmount = (subtotal * input.discountValue) / 100;
    } else if (input.discountType === 'FIXED' && input.discountValue) {
      discountAmount = input.discountValue;
    }
    const total = subtotal + taxAmount - discountAmount;

    // R2: do the invoice insert + the quote.invoiceId backlink in a single
    // transaction so we never end up with a quote that thinks it was
    // converted but no invoice (or an invoice that has no parent quote).
    const invoice = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          businessId: quote.businessId,
          contactId: quote.contactId,
          invoiceNumber: `INV-${Date.now()}`,
          status: 'DRAFT',
          issueDate: new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          subtotal,
          taxRate,
          taxAmount,
          discountType: input.discountType ?? null,
          discountValue: input.discountValue ?? null,
          discountAmount,
          total,
          currency: quote.currency,
          notes: input.notes ?? null,
          quoteId: quote.id,
          items: {
            create: quote.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
              productId: item.productId ?? null,
            })),
          },
        },
        include: { items: true, contact: true },
      });
      await tx.quote.update({
        where: { id: quote.id },
        data: { invoiceId: created.id },
      });
      return created;
    });

    this.events.emit('quote.converted', { quote, invoice, businessId: quote.businessId } as QuoteConvertedPayload);
    this.events.emit('invoice.created', {
      invoice,
      businessId: quote.businessId,
      source: 'quote',
      quoteId: quote.id,
    } as InvoiceCreatedPayload);

    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: 'invoice.created',
        data: { invoiceId: invoice.id, quoteId: quote.id, total: invoice.total },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }

    this.statsCache.invalidateCache(input.businessId);
    return invoice;
  }

  // ========== PARTIAL PAYMENTS ==========

  async recordPayment(invoiceId: string, businessId: string, input: {
    amount: number;
    method: string;
    reference?: string;
    notes?: string;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: { payments: true },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new Error(`Cannot record payment on a ${invoice.status} invoice`);
    }
    if (input.amount <= 0) {
      throw new Error('Payment amount must be positive');
    }

    const existingPaid = invoice.payments
      .filter((p) => p.status === 'SUCCESSFUL')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Math.max(0, Number(invoice.total) - existingPaid);
    // Allow over-payment: store the actual amount the operator received so the
    // ledger stays truthful. The UI presents an explicit confirm + warning
    // toast when amount > remaining and prompts the operator to issue a refund
    // from the Payments tab to settle the over-paid balance.
    const paymentAmount = input.amount;
    const isOverPayment = paymentAmount > remaining + 0.005;

    // FIN2 — record the payment row and post the deposit-side ledger
    // entries in a single transaction so a posting failure rolls back the
    // payment row (preserves invariant: every SUCCESSFUL payment has a
    // matching ledger transaction unless basis is CASH and posting silently
    // skipped — also fine, idempotent on replay).
    const payment = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          amount: paymentAmount,
          currency: invoice.currency,
          status: 'SUCCESSFUL',
          provider: input.method,
          method: input.method,
          providerPaymentId: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          businessId,
          invoiceId,
        },
      });
      await this.revenuePosting.onPaymentRecorded(created.id, {
        tx: tx as unknown as Prisma.TransactionClient,
      });
      return created;
    });

    // Single source of truth: workflow recomputes status from payment rows
    // and emits the appropriate event (invoice.paid / invoice.payment_recorded).
    const reconciled = await this.invoiceWorkflow.reconcileFromPayments(invoiceId);
    const newPaidTotal = existingPaid + paymentAmount;
    const newStatus = reconciled.status;
    const updatedInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true, contact: true, items: true },
    });

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_recorded',
        data: {
          invoiceId,
          amount: paymentAmount,
          method: input.method,
          reference: input.reference,
          totalPaid: newPaidTotal,
          invoiceTotal: invoice.total,
          newStatus,
          overPaid: isOverPayment ? Number((newPaidTotal - Number(invoice.total)).toFixed(2)) : 0,
        },
        actorType: 'USER',
        source: 'commerce',
      });
    }

    this.statsCache.invalidateCache(businessId);

    return {
      payment,
      invoice: updatedInvoice,
      paidAmount: newPaidTotal,
      remaining: Math.max(0, Number(invoice.total) - newPaidTotal),
    };
  }

  /** List every payment row for a business, with rich filtering. */
  async listAllPayments(businessId: string, filters: {
    status?: string;
    method?: string;
    provider?: string;
    contactId?: string;
    minAmount?: number;
    maxAmount?: number;
    from?: string | Date;
    to?: string | Date;
  } = {}) {
    const where: Prisma.PaymentWhereInput = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.method) where.method = filters.method;
    if (filters.provider) where.provider = filters.provider;
    if (filters.minAmount != null || filters.maxAmount != null) {
      const amount: Prisma.FloatFilter = {};
      if (filters.minAmount != null) amount.gte = filters.minAmount;
      if (filters.maxAmount != null) amount.lte = filters.maxAmount;
      where.amount = amount;
    }
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = new Date(filters.from);
      if (filters.to) createdAt.lte = new Date(filters.to);
      where.createdAt = createdAt;
    }
    if (filters.contactId) {
      where.invoice = { is: { contactId: filters.contactId } };
    }

    const payments = await this.prisma.client.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            currency: true,
            total: true,
            dueDate: true,
            issueDate: true,
            receiptSentAt: true,
            contactId: true,
            contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    return payments;
  }

  /** Mark a payment refunded (no provider call — local bookkeeping only). */
  async markPaymentRefunded(paymentId: string, businessId: string, reason?: string) {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, businessId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    // FIN2 — flip the row + reverse the original posting in one tx so the
    // refunded state and the offsetting ledger entries commit together.
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const next = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REFUNDED',
          notes: reason ? `${payment.notes ? payment.notes + ' | ' : ''}Refunded: ${reason}` : payment.notes,
        },
      });
      await this.revenuePosting.onPaymentRefunded(paymentId, {
        tx: tx as unknown as Prisma.TransactionClient,
      });
      return next;
    });
    if (payment.invoiceId) {
      await this.invoiceWorkflow.reconcileFromPayments(payment.invoiceId).catch(() => null);
    }
    this.statsCache.invalidateCache(businessId);
    return updated;
  }

  /** Retry a failed payment by flipping it to PENDING and emitting an event. */
  async retryPayment(paymentId: string, businessId: string) {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, businessId },
      include: { invoice: { select: { contactId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'FAILED') {
      throw new BadRequestException('Only failed payments can be retried');
    }
    const updated = await this.prisma.client.payment.update({
      where: { id: paymentId },
      data: { status: 'PENDING' },
    });
    if (payment.invoice?.contactId && payment.invoiceId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: payment.invoice.contactId,
        type: 'invoice.payment_retry_initiated',
        data: { paymentId, invoiceId: payment.invoiceId, amount: payment.amount },
        actorType: 'USER',
        source: 'commerce',
      });
    }
    return updated;
  }

  /** Mark that a receipt was (re)sent for an invoice. */
  async markReceiptSent(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const updated = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { receiptSentAt: new Date() },
      select: { id: true, receiptSentAt: true },
    });
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: invoice.contactId,
        type: 'invoice.receipt_resent',
        data: { invoiceId },
        actorType: 'USER',
        source: 'commerce',
      });
    }
    return updated;
  }

  /**
   * Returns a unified, time-ordered invoice activity timeline assembled from
   * payments, the invoice's own status timestamps, and matching ContactEvent
   * rows. Used by the invoice detail drawer to show created/sent/viewed/
   * partial-payment/paid/reminder/receipt entries.
   */
  async getInvoiceTimeline(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const entries: Array<{
      id: string;
      type: string;
      label: string;
      at: Date;
      data?: Record<string, unknown>;
    }> = [];

    entries.push({
      id: `created-${invoice.id}`,
      type: 'invoice.created',
      label: 'Invoice created',
      at: invoice.createdAt,
      data: { total: invoice.total, currency: invoice.currency },
    });
    if (invoice.sentAt) {
      entries.push({
        id: `sent-${invoice.id}`,
        type: 'invoice.sent',
        label: 'Invoice sent',
        at: invoice.sentAt,
      });
    }
    for (const p of invoice.payments) {
      if (p.status === 'SUCCESSFUL') {
        entries.push({
          id: `pay-${p.id}`,
          type: 'invoice.payment_recorded',
          label: `Payment of ${p.amount} ${p.currency} via ${p.method ?? p.provider ?? 'manual'}`,
          at: p.createdAt,
          data: { amount: p.amount, method: p.method, reference: p.reference },
        });
      } else if (p.status === 'REFUNDED') {
        entries.push({
          id: `refund-${p.id}`,
          type: 'invoice.refund',
          label: `Refund of ${Math.abs(p.amount)} ${p.currency}`,
          at: p.createdAt,
        });
      } else if (p.status === 'FAILED') {
        entries.push({
          id: `fail-${p.id}`,
          type: 'invoice.payment_failed',
          label: 'Payment attempt failed',
          at: p.createdAt,
        });
      }
    }
    if (invoice.paidAt) {
      entries.push({
        id: `paid-${invoice.id}`,
        type: 'invoice.paid',
        label: 'Invoice fully paid',
        at: invoice.paidAt,
      });
    }
    if (invoice.contactId) {
      const events = await this.prisma.client.contactEvent.findMany({
        where: {
          businessId,
          contactId: invoice.contactId,
          type: {
            in: [
              'invoice.viewed',
              'invoice.payment_reminder_sent',
              'invoice.receipt_sent',
              'invoice.overdue',
              'invoice.void',
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      for (const e of events) {
        const data = (e.data as Record<string, unknown>) ?? {};
        if (data.invoiceId !== invoice.id) continue;
        const labels: Record<string, string> = {
          'invoice.viewed': 'Invoice viewed by client',
          'invoice.payment_reminder_sent': `Reminder sent${data.channel ? ` (${String(data.channel)})` : ''}`,
          'invoice.receipt_sent': `Receipt sent${data.channel ? ` (${String(data.channel)})` : ''}`,
          'invoice.overdue': 'Invoice marked overdue',
          'invoice.void': 'Invoice voided',
        };
        entries.push({
          id: `evt-${e.id}`,
          type: e.type,
          label: labels[e.type] ?? e.type,
          at: e.createdAt,
          data,
        });
      }
    }

    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { invoiceId, entries };
  }

  /**
   * Sends a payment reminder for the given invoice via Gmail (if connected)
   * and persists the canonical `invoice.payment_reminder_sent` ContactEvent
   * (the PAYMENT_REMINDER_SENT spec event from R2). Returns success metadata
   * even when Gmail isn't connected so the UI can fall back to a local copy.
   */
  async sendInvoiceReminder(input: {
    invoiceId: string;
    businessId: string;
    actorId?: string;
    customMessage?: string;
    channel?: 'email' | 'whatsapp' | 'manual';
    deliver: (params: {
      invoice: import('@prisma/client').Invoice & {
        contact: import('@prisma/client').Contact | null;
        items: import('@prisma/client').InvoiceItem[];
        payments: import('@prisma/client').Payment[];
        business: import('@prisma/client').Business | null;
      };
      recipientEmail: string | null;
      paymentUrl: string | null;
    }) => Promise<{ delivered: boolean; messageId?: string }>;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId, deletedAt: null },
      include: { contact: true, items: true, payments: true, business: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new BadRequestException(`Cannot send reminder for ${invoice.status} invoice`);
    }

    // Always provide a pay CTA in the reminder. Reuse the active link if one
    // already exists, otherwise create one — `createPaymentLink` itself
    // returns the existing active row when present, so this is idempotent.
    let paymentUrl: string | null = null;
    let link = await this.prisma.client.paymentLink.findFirst({
      where: { invoiceId: invoice.id, businessId: input.businessId, active: true },
    });
    if (!link) {
      try {
        link = await this.createPaymentLink(invoice.id, input.businessId);
      } catch (err) {
        // Reminders are only sent for non-PAID/non-VOID invoices, so the
        // "paid or voided" refusal shouldn't normally fire — but if a
        // payment landed between the status check above and link creation
        // we degrade to a CTA-less reminder rather than 500. Anything else
        // is a real failure and should surface.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/paid or voided/i.test(msg)) throw err;
        link = null;
      }
    }
    if (link) {
      const { appUrl } = await import('../../core/config/runtime-urls');
      paymentUrl = `${appUrl()}/public/invoice/${link.token}`;
    }

    const recipientEmail = invoice.contact?.email ?? null;
    const channel = input.channel ?? (recipientEmail ? 'email' : 'manual');

    let delivered: boolean;
    let messageId: string | undefined;
    try {
      const result = await input.deliver({ invoice, recipientEmail, paymentUrl });
      delivered = result.delivered;
      messageId = result.messageId;
    } catch (err) {
      // Persist the event regardless so the timeline shows the operator's
      // intent even when delivery fails — but surface the error to the UI.
      this.events.emit('invoice.reminder_failed', {
        invoice,
        businessId: invoice.businessId,
        reason: (err as Error).message,
      });
      throw err;
    }

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_reminder_sent',
        data: {
          invoiceId: invoice.id,
          channel,
          messageId: messageId ?? null,
          recipientEmail,
          status: invoice.status,
        },
        actorType: input.actorId ? 'USER' : 'SYSTEM',
        actorId: input.actorId,
        source: 'commerce',
      });
    }

    this.events.emit('invoice.payment_reminder_sent', {
      invoice,
      businessId: invoice.businessId,
      channel,
      eventName: 'invoice.payment_reminder_sent',
    });

    return { delivered, channel, messageId, paymentUrl };
  }

  /**
   * Logs a `invoice.receipt_sent` event (called by the controller after
   * rendering & emailing the receipt). Centralised so both the auto-on-paid
   * listener and the manual "Resend receipt" path use the same log shape.
   */
  async recordReceiptSent(input: {
    invoiceId: string;
    businessId: string;
    channel: 'email' | 'manual';
    recipientEmail?: string | null;
    messageId?: string | null;
    actorId?: string | null;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
      select: { id: true, contactId: true, businessId: true },
    });
    if (!invoice || !invoice.contactId) return;
    await this.crm.logContactEvent({
      businessId: invoice.businessId,
      contactId: invoice.contactId,
      type: 'invoice.receipt_sent',
      data: {
        invoiceId: invoice.id,
        channel: input.channel,
        recipientEmail: input.recipientEmail ?? null,
        messageId: input.messageId ?? null,
      },
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      actorId: input.actorId ?? undefined,
      source: 'commerce',
    });
  }

  /**
   * Records a one-shot `invoice.viewed` ContactEvent the first time a
   * client opens the public payment-link page. Subsequent views within the
   * same calendar day are coalesced so we don't spam the timeline.
   */
  async recordInvoiceView(invoiceId: string, businessId: string, contactId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.client.contactEvent.findFirst({
      where: {
        businessId,
        contactId,
        type: 'invoice.viewed',
        createdAt: { gte: since },
      },
    });
    if (recent) {
      const data = (recent.data as Record<string, unknown>) ?? {};
      if (data.invoiceId === invoiceId) return;
    }
    await this.crm.logContactEvent({
      businessId,
      contactId,
      type: 'invoice.viewed',
      data: { invoiceId, channel: 'public_link' },
      actorType: 'SYSTEM',
      source: 'commerce',
    });
  }

  async listPayments(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    const payments = await this.prisma.client.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    const paidAmount = payments
      .filter((p) => p.status === 'SUCCESSFUL')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      payments,
      paidAmount,
      remaining: Math.max(0, Number(invoice.total) - paidAmount),
      invoiceTotal: invoice.total,
    };
  }

  // ========== UPDATE INVOICE ==========

  async updateInvoice(input: {
    invoiceId: string;
    businessId: string;
    contactId?: string;
    items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    dueDate?: Date | string | null;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED' | null;
    discountValue?: number | null;
    notes?: string | null;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    this.validateTaxAndDiscount(input.taxRate, input.discountValue ?? undefined, input.discountType ?? undefined);
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      throw new Error('Cannot edit a paid or partially paid invoice');
    }

    const updateData: any = {};
    if (input.contactId !== undefined) updateData.contactId = input.contactId;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.dueDate !== undefined) {
      updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if (input.notes !== undefined) updateData.notes = input.notes;

    if (input.items) {
      await this.prisma.client.invoiceItem.deleteMany({ where: { invoiceId: input.invoiceId } });
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const taxRate = input.taxRate ?? invoice.taxRate ?? 0;
      const taxAmount = (subtotal * taxRate) / 100;
      let discountAmount = 0;
      const discountType = input.discountType !== undefined ? input.discountType : invoice.discountType;
      const discountValue = input.discountValue !== undefined ? input.discountValue : invoice.discountValue;
      if (discountType === 'PERCENT' && discountValue) {
        discountAmount = (subtotal * discountValue) / 100;
      } else if (discountType === 'FIXED' && discountValue) {
        discountAmount = discountValue;
      }
      const total = subtotal + taxAmount - discountAmount;

      updateData.subtotal = subtotal;
      updateData.taxRate = taxRate;
      updateData.taxAmount = taxAmount;
      updateData.discountType = discountType;
      updateData.discountValue = discountValue;
      updateData.discountAmount = discountAmount;
      updateData.total = total;
      updateData.items = {
        create: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
          productId: item.productId ?? null,
        })),
      };
    } else if (input.taxRate !== undefined || input.discountType !== undefined || input.discountValue !== undefined) {
      const subtotal = invoice.subtotal;
      const taxRate = input.taxRate ?? invoice.taxRate ?? 0;
      const taxAmount = (subtotal * taxRate) / 100;
      let discountAmount = 0;
      const discountType = input.discountType !== undefined ? input.discountType : invoice.discountType;
      const discountValue = input.discountValue !== undefined ? input.discountValue : invoice.discountValue;
      if (discountType === 'PERCENT' && discountValue) {
        discountAmount = (subtotal * discountValue) / 100;
      } else if (discountType === 'FIXED' && discountValue) {
        discountAmount = discountValue;
      }
      const total = subtotal + taxAmount - discountAmount;
      updateData.taxRate = taxRate;
      updateData.taxAmount = taxAmount;
      updateData.discountType = discountType;
      updateData.discountValue = discountValue;
      updateData.discountAmount = discountAmount;
      updateData.total = total;
    }

    const result = await this.prisma.client.invoice.update({
      where: { id: input.invoiceId },
      data: updateData,
      include: { items: true, contact: true },
    });
    const prevDue = invoice.dueDate ? new Date(invoice.dueDate).getTime() : null;
    const newDue = result.dueDate ? new Date(result.dueDate).getTime() : null;
    if (input.dueDate !== undefined && prevDue !== newDue) {
      this.events.emit('invoice.due_date_changed', {
        invoice: result,
        businessId: input.businessId,
        previousDueDate: invoice.dueDate ?? null,
      });
    }
    this.events.emit('invoice.updated', { invoice: result, businessId: input.businessId });
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  async getCampaignRevenue(businessId: string, campaignId: string) {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        campaignId,
        deletedAt: null,
        status: { in: ['PAID', 'PARTIALLY_PAID', 'SENT', 'OVERDUE'] },
      },
      select: { id: true, total: true, status: true, currency: true },
    });
    const totalRevenue = invoices
      .filter((i: any) => i.status === 'PAID')
      .reduce((sum: number, i: any) => sum + i.total, 0);
    const pipelineRevenue = invoices
      .filter((i: any) => i.status !== 'PAID')
      .reduce((sum: number, i: any) => sum + i.total, 0);
    return {
      totalRevenue,
      pipelineRevenue,
      invoiceCount: invoices.length,
      currency: invoices[0]?.currency || 'TTD',
    };
  }

  /**
   * Returns any payment link (active or not) for an invoice — used by flows
   * that need to surface a previously-issued public URL even when the invoice
   * is no longer eligible for new link creation (PAID / VOID). Most recent
   * link first.
   */
  async findAnyPaymentLink(invoiceId: string, businessId: string) {
    return this.prisma.client.paymentLink.findFirst({
      where: { invoiceId, businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPaymentLink(invoiceId: string, businessId: string, expiresInDays?: number) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new Error('Cannot create payment link for a paid or voided invoice');
    }

    const existing = await this.prisma.client.paymentLink.findFirst({
      where: { invoiceId, businessId, active: true },
    });
    if (existing) return existing;

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    return this.prisma.client.paymentLink.create({
      data: { invoiceId, businessId, expiresAt },
    });
  }

  async getPaymentLinkByToken(token: string) {
    const link = await this.prisma.client.paymentLink.findUnique({
      where: { token },
      select: {
        id: true,
        token: true,
        active: true,
        expiresAt: true,
        invoiceId: true,
        businessId: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            currency: true,
            status: true,
          },
        },
      },
    });
    if (!link || !link.active) return null;
    if (link.expiresAt && link.expiresAt < new Date()) return null;
    return link;
  }

  async listPaymentLinks(businessId: string) {
    return this.prisma.client.paymentLink.findMany({
      where: { businessId, active: true },
      include: { invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, contact: { select: { firstName: true, lastName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivatePaymentLink(id: string, businessId: string) {
    return this.prisma.client.paymentLink.updateMany({
      where: { id, businessId },
      data: { active: false },
    });
  }

  async recordPublicPaymentIntent(invoiceId: string, method: string, amount?: number) {
    const validMethods = ['bank_transfer', 'cash', 'check', 'other', 'google_pay'];
    if (!validMethods.includes(method)) {
      throw new BadRequestException('Invalid offline payment method');
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, total: true, businessId: true, invoiceNumber: true, currency: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice is already paid');

    // PENDING — customer-asserted intent, no money yet, so no FIN2 posting
    // until the operator records the actual receipt via recordPayment().
    await this.prisma.client.payment.create({
      data: {
        invoiceId,
        businessId: invoice.businessId,
        amount: amount || 0,
        currency: invoice.currency || 'TTD',
        status: 'PENDING',
        provider: method || 'cash',
        providerPaymentId: `manual_${invoiceId}_${Date.now()}`,
        method,
        reference: `Intent: ${invoice.invoiceNumber}`,
        notes: `Customer indicated ${method} payment via public payment page`,
      },
    });

    if (method === 'bank_transfer' || method === 'cash') {
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PENDING' },
      });
    }

    return { success: true, method, invoiceNumber: invoice.invoiceNumber };
  }
}

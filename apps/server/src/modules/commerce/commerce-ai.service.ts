import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CommerceStatsService } from './commerce-stats.service';
import {
  buildCommerceCommandPrompt,
  buildRevenueAnalysisPrompt,
  buildCashFlowPrompt,
  buildInvoiceReminderPrompt,
  buildPricingSuggestionPrompt,
} from './prompts/commerce-command.prompt';

@Injectable()
export class CommerceAiService {
  private readonly logger = new Logger(CommerceAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(CommerceStatsService) private readonly stats: CommerceStatsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  sanitizeAiInput(input: string, maxLen = 500): string {
    let sanitized = input;
    const injectionPatterns = [
      /<\|system\|>/gi,
      /<\|user\|>/gi,
      /<\|assistant\|>/gi,
      /\[INST\]/gi,
      /\[\/INST\]/gi,
      /<<SYS>>/gi,
      /<<\/SYS>>/gi,
      /<\/s>/gi,
      /^Human:/gim,
      /^Assistant:/gim,
      /^System:/gim,
    ];
    for (const pattern of injectionPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return sanitized.slice(0, maxLen);
  }

  private async buildCommerceContext(businessId: string): Promise<string> {
    const [products, invoices, quotes, contacts] = await Promise.all([
      this.db.product.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, category: true, isActive: true, currency: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, invoiceNumber: true, status: true, total: true, currency: true,
          dueDate: true, paidAt: true, createdAt: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, quoteNumber: true, status: true, total: true, currency: true,
          expiryDate: true, createdAt: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.db.contact.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const now = new Date();
    const parts: string[] = [];

    parts.push(`Products (${products.length}):`);
    products.forEach((p) => {
      parts.push(`  - ${p.name} (${p.category}, $${p.price} ${p.currency}, ${p.isActive ? 'Active' : 'Inactive'})`);
    });

    parts.push(`\nInvoices (${invoices.length}):`);
    invoices.forEach((inv) => {
      const contactName = inv.contact
        ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || inv.contact.email || 'Unknown'
        : 'No contact';
      const daysOverdue = inv.dueDate && inv.status !== 'PAID'
        ? Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000))
        : 0;
      parts.push(`  - #${inv.invoiceNumber} | ${inv.status} | $${inv.total} ${inv.currency} | ${contactName}${daysOverdue > 0 ? ` | ${daysOverdue} days overdue` : ''}`);
    });

    parts.push(`\nQuotes (${quotes.length}):`);
    quotes.forEach((q) => {
      const contactName = q.contact
        ? `${q.contact.firstName ?? ''} ${q.contact.lastName ?? ''}`.trim() || q.contact.email || 'Unknown'
        : 'No contact';
      parts.push(`  - #${q.quoteNumber} | ${q.status} | $${q.total} ${q.currency} | ${contactName}`);
    });

    parts.push(`\nContacts (${contacts.length}):`);
    contacts.slice(0, 30).forEach((c) => {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || 'Unknown';
      parts.push(`  - ${name} (${c.status}) [ID: ${c.id}]`);
    });

    return parts.join('\n');
  }

  private async findInvoice(businessId: string, params: Record<string, any>) {
    if (params.invoiceId) {
      return this.db.invoice.findFirst({
        where: { id: String(params.invoiceId), businessId, deletedAt: null },
        select: { id: true, invoiceNumber: true },
      });
    }
    if (params.invoiceNumber) {
      return this.db.invoice.findFirst({
        where: { businessId, invoiceNumber: { contains: String(params.invoiceNumber) }, deletedAt: null },
        select: { id: true, invoiceNumber: true },
      });
    }
    return null;
  }

  private async findProduct(businessId: string, params: Record<string, any>) {
    if (params.productId) {
      return this.db.product.findFirst({
        where: { id: String(params.productId), businessId, deletedAt: null },
        select: { id: true, name: true },
      });
    }
    if (params.productName) {
      return this.db.product.findFirst({
        where: { businessId, name: { contains: String(params.productName), mode: 'insensitive' }, deletedAt: null },
        select: { id: true, name: true },
      });
    }
    return null;
  }

  async analyzeRevenue(businessId: string) {
    const start = Date.now();
    const [context, statsData] = await Promise.all([
      this.buildCommerceContext(businessId),
      this.stats.getCommerceStats(businessId),
    ]);

    const contextBlock = `${context}\n\nAggregated Stats:\n${JSON.stringify(statsData, null, 2)}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_revenue_analysis',
      messages: [
        { role: 'system', content: buildRevenueAnalysisPrompt(contextBlock) },
        { role: 'user', content: 'Analyze my revenue performance and provide actionable recommendations.' },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Revenue analysis took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return { summary: result.content, trends: [], topClients: [], recommendations: [], healthScore: 50, healthLabel: 'fair' };
    }
  }

  async generateInvoiceReminder(businessId: string, invoiceId: string) {
    const invoice = await this.db.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: {
        contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        business: { select: { name: true, email: true, phone: true } },
        items: true,
      },
    });
    if (!invoice) throw new Error('Invoice not found');

    const contactName = invoice.contact
      ? `${invoice.contact.firstName ?? ''} ${invoice.contact.lastName ?? ''}`.trim() || invoice.contact.email || 'Customer'
      : 'Customer';
    const now = new Date();
    const daysOverdue = invoice.dueDate
      ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000))
      : 0;

    const contextBlock = `Invoice #${invoice.invoiceNumber}
Amount: $${invoice.total} ${invoice.currency}
Status: ${invoice.status}
Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-TT') : 'Not set'}
Days Overdue: ${daysOverdue}
Contact: ${contactName}
Contact Email: ${invoice.contact?.email ?? 'N/A'}
Business Name: ${invoice.business?.name ?? 'My Business'}
Items: ${invoice.items.map((i: any) => `${i.description} ($${i.total})`).join(', ')}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_invoice_reminder',
      messages: [
        { role: 'system', content: buildInvoiceReminderPrompt(contextBlock) },
        { role: 'user', content: `Draft a payment reminder for this ${daysOverdue > 14 ? 'significantly overdue' : daysOverdue > 0 ? 'overdue' : 'upcoming'} invoice.` },
      ],
      maxTokens: 1500,
      temperature: 0.5,
    });

    try {
      return JSON.parse(result.content);
    } catch {
      return { subject: `Payment Reminder - Invoice #${invoice.invoiceNumber}`, message: result.content, tone: 'firm', alternativeMessages: [] };
    }
  }

  async suggestPricing(businessId: string, productId: string) {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new Error('Product not found');

    const relatedInvoices = await this.db.invoiceItem.findMany({
      where: {
        invoice: { businessId, deletedAt: null },
        productId,
      },
      select: { unitPrice: true, quantity: true, total: true },
      take: 50,
    });

    const allProducts = await this.db.product.findMany({
      where: { businessId, deletedAt: null, category: product.category },
      select: { name: true, price: true },
    });

    const contextBlock = `Product: ${product.name}
Category: ${product.category}
Current Price: $${product.price} ${product.currency}
Description: ${product.description ?? 'None'}
Active: ${product.isActive}

Sales History (${relatedInvoices.length} line items):
${relatedInvoices.map((i) => `  - Sold at $${i.unitPrice} x${i.quantity} = $${i.total}`).join('\n') || '  No sales history yet'}

Similar Products in Category (${allProducts.length}):
${allProducts.map((p) => `  - ${p.name}: $${p.price}`).join('\n')}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_pricing_suggestion',
      messages: [
        { role: 'system', content: buildPricingSuggestionPrompt(contextBlock) },
        { role: 'user', content: `Suggest optimal pricing for "${product.name}".` },
      ],
      maxTokens: 1500,
      temperature: 0.4,
    });

    try {
      return JSON.parse(result.content);
    } catch {
      return { currentPrice: product.price, suggestedPrice: product.price, reasoning: result.content, factors: [], strategies: [] };
    }
  }

  async cashFlowForecast(businessId: string) {
    const start = Date.now();
    const [context, statsData] = await Promise.all([
      this.buildCommerceContext(businessId),
      this.stats.getCommerceStats(businessId),
    ]);

    const recurringInvoices = await this.db.recurringInvoice.findMany({
      where: { businessId, isActive: true, deletedAt: null },
      select: { name: true, frequency: true, nextRunDate: true, lineItems: true },
      take: 20,
    });

    const recurringContext = recurringInvoices.length > 0
      ? `\nRecurring Invoices (${recurringInvoices.length}):\n${recurringInvoices.map((r) => `  - ${r.name} (${r.frequency}, next: ${r.nextRunDate ? new Date(r.nextRunDate).toLocaleDateString('en-TT') : 'N/A'})`).join('\n')}`
      : '';

    const contextBlock = `${context}${recurringContext}\n\nAggregated Stats:\n${JSON.stringify(statsData, null, 2)}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_cashflow_forecast',
      messages: [
        { role: 'system', content: buildCashFlowPrompt(contextBlock) },
        { role: 'user', content: 'Forecast my cash flow for the next 30, 60, and 90 days. Consider outstanding invoices, recurring revenue, and seasonal patterns.' },
      ],
      maxTokens: 2000,
      temperature: 0.3,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Cash flow forecast took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return { summary: result.content, forecast: {}, risks: [], opportunities: [], collectionPriority: [] };
    }
  }

  async interpretCommand(businessId: string, command: string) {
    const sanitized = this.sanitizeAiInput(command, 500);
    const context = await this.buildCommerceContext(businessId);
    const prompt = buildCommerceCommandPrompt(context);

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_command',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 800,
      temperature: 0.2,
    });

    try {
      return JSON.parse(result.content);
    } catch {
      return { isAction: false, action: null, params: {}, confirmation: result.content, confidence: 0 };
    }
  }

  async executeCommand(businessId: string, action: string, params: Record<string, any> = {}) {
    this.logger.log(`Executing commerce command: ${action} for business ${businessId}`);
    const start = Date.now();

    try {
      switch (action) {
        case 'mark_paid': {
          const invoice = await this.findInvoice(businessId, params);
          if (!invoice) return { success: false, error: `Invoice not found` };
          await this.db.invoice.update({
            where: { id: invoice.id },
            data: { status: 'PAID', paidAt: new Date() },
          });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Invoice #${invoice.invoiceNumber} marked as paid`, invoiceId: invoice.id };
        }

        case 'void_invoice': {
          const invoice = await this.findInvoice(businessId, params);
          if (!invoice) return { success: false, error: `Invoice not found` };
          await this.db.invoice.update({
            where: { id: invoice.id },
            data: { status: 'VOID' },
          });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Invoice #${invoice.invoiceNumber} voided`, invoiceId: invoice.id };
        }

        case 'send_reminder': {
          const invoice = await this.findInvoice(businessId, params);
          if (!invoice) return { success: false, error: `Invoice not found` };
          const reminder = await this.generateInvoiceReminder(businessId, invoice.id);
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Reminder drafted for Invoice #${invoice.invoiceNumber}`, invoiceId: invoice.id, reminder };
        }

        case 'convert_quote': {
          const quoteNumber = params.quoteNumber;
          if (!quoteNumber) return { success: false, error: 'Quote number is required' };
          const quote = await this.db.quote.findFirst({
            where: { businessId, quoteNumber: { contains: String(quoteNumber) }, deletedAt: null },
          });
          if (!quote) return { success: false, error: `Quote "${quoteNumber}" not found` };
          await this.db.quote.update({ where: { id: quote.id }, data: { status: 'ACCEPTED' } });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Quote #${quote.quoteNumber} marked as accepted`, quoteId: quote.id };
        }

        case 'send_quote': {
          const quoteNumber = params.quoteNumber;
          if (!quoteNumber) return { success: false, error: 'Quote number is required' };
          const quote = await this.db.quote.findFirst({
            where: { businessId, quoteNumber: { contains: String(quoteNumber) }, deletedAt: null },
          });
          if (!quote) return { success: false, error: `Quote "${quoteNumber}" not found` };
          await this.db.quote.update({ where: { id: quote.id }, data: { status: 'SENT' } });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Quote #${quote.quoteNumber} marked as sent`, quoteId: quote.id };
        }

        case 'deactivate_product': {
          const product = await this.findProduct(businessId, params);
          if (!product) return { success: false, error: 'Product not found' };
          await this.db.product.update({
            where: { id: product.id },
            data: { isActive: false },
          });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Product "${product.name}" deactivated`, productId: product.id };
        }

        case 'update_product': {
          const product = await this.findProduct(businessId, params);
          if (!product) return { success: false, error: 'Product not found' };
          const updateData: Record<string, any> = {};
          if (params.price !== undefined) updateData.price = Number(params.price);
          if (params.description !== undefined) updateData.description = String(params.description);
          if (params.category !== undefined) updateData.category = String(params.category);
          if (params.name !== undefined && params.name !== params.productName) updateData.name = String(params.name);
          if (Object.keys(updateData).length === 0) return { success: false, error: 'No fields to update' };
          const updated = await this.db.product.update({ where: { id: product.id }, data: updateData });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Product "${updated.name}" updated`, productId: updated.id };
        }

        case 'create_product': {
          if (!params.name || !params.price) return { success: false, error: 'Product name and price are required' };
          const product = await this.db.product.create({
            data: {
              businessId,
              name: params.name,
              price: Number(params.price),
              currency: 'TTD',
              category: params.category || 'SERVICE',
              description: params.description || null,
              isActive: true,
            },
          });
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Product "${product.name}" created at $${product.price} TTD`, productId: product.id };
        }

        case 'filter_invoices':
        case 'show_overdue':
        case 'switch_tab':
        case 'show_stats':
        case 'view_invoice':
          return { success: true, message: 'Navigation command — handled on frontend', action, params };

        case 'analyze_revenue':
        case 'cash_flow_forecast':
        case 'pricing_suggestion':
        case 'overdue_recovery':
        case 'pipeline_analysis':
          return { success: true, message: 'AI tool command — handled via AI Hub', action, params };

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } finally {
      const duration = Date.now() - start;
      if (duration > 1000) this.logger.warn(`Command execution (${action}) took ${duration}ms`);
    }
  }
}

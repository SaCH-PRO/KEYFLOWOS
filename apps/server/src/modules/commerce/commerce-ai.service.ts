import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CommerceStatsService } from './commerce-stats.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  buildCommerceCommandPrompt,
  buildRevenueAnalysisPrompt,
  buildCashFlowPrompt,
  buildInvoiceReminderPrompt,
  buildPricingSuggestionPrompt,
} from './prompts/commerce-command.prompt';
import {
  buildCollectionsScoringPrompt,
  buildPaymentPlanPrompt,
  buildQuoteFollowUpPrompt,
  buildChurnRiskPrompt,
  buildRevenueJourneyPrompt,
} from './prompts/innovation.prompt';

@Injectable()
export class CommerceAiService {
  private readonly logger = new Logger(CommerceAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(CommerceStatsService) private readonly stats: CommerceStatsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
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
      outputCategory: 'reports',
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
    if (!invoice) throw new NotFoundException('Invoice not found');

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
      outputCategory: 'messages',
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
    if (!product) throw new NotFoundException('Product not found');

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
      outputCategory: 'general',
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
      outputCategory: 'reports',
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Cash flow forecast took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return { summary: result.content, forecast: {}, risks: [], opportunities: [], collectionPriority: [] };
    }
  }

  async naturalLanguageSearch(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);

    const [products, invoices, quotes] = await Promise.all([
      this.db.product.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, category: true, isActive: true, currency: true, sku: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, invoiceNumber: true, status: true, total: true, currency: true,
          dueDate: true, paidAt: true, createdAt: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, quoteNumber: true, status: true, total: true, currency: true,
          expiryDate: true, createdAt: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const knownStatuses = {
      invoices: [...new Set(invoices.map(i => i.status))],
      quotes: [...new Set(quotes.map(q => q.status))],
    };
    const knownCategories = [...new Set(products.map(p => p.category).filter(Boolean))];

    const prompt = `You are a Commerce search translator for a Caribbean service business (TTD currency, Trinidad & Tobago).
Convert a natural language query into structured Commerce filter parameters.

Available data types: products, invoices, quotes

Product filter fields:
- type: "products"
- search: text search across name, SKU
- category: product category (known: ${knownCategories.join(', ') || 'SERVICE, PRODUCT, PACKAGE'})
- isActive: boolean
- priceMin: minimum price
- priceMax: maximum price
- sortBy: name|price|newest|oldest

Invoice filter fields:
- type: "invoices"
- search: text search across invoice number, contact name
- status: invoice status (known: ${knownStatuses.invoices.join(', ') || 'DRAFT, SENT, PAID, OVERDUE, VOID'})
- totalMin: minimum total
- totalMax: maximum total
- overdue: boolean (only overdue invoices)
- dateFrom: ISO date string
- dateTo: ISO date string
- sortBy: newest|oldest|amount|dueDate

Quote filter fields:
- type: "quotes"
- search: text search across quote number, contact name
- status: quote status (known: ${knownStatuses.quotes.join(', ') || 'DRAFT, SENT, ACCEPTED, REJECTED'})
- totalMin: minimum total
- totalMax: maximum total
- expired: boolean
- sortBy: newest|oldest|amount|expiryDate

Respond in valid JSON:
{
  "type": "products|invoices|quotes",
  "filters": { ... relevant filters only ... },
  "interpretation": "What you understood the user wants",
  "confidence": 0.9
}

Only include filters relevant to the query. Set irrelevant filters to null.`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_nl_search',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 600,
      temperature: 0.2,
      outputCategory: 'general',
      responseMode: 'structured_json',
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Commerce NL search took ${duration}ms`);

    try {
      const parsed = JSON.parse(result.content);
      const resultData = await this.executeNlSearch(businessId, parsed);
      return { ...parsed, results: resultData };
    } catch {
      return { type: 'invoices', filters: {}, interpretation: result.content, confidence: 0, results: [] };
    }
  }

  private async executeNlSearch(businessId: string, parsed: any) {
    const { type, filters } = parsed;
    if (!filters) return [];

    if (type === 'products') {
      const where: any = { businessId, deletedAt: null };
      if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
      if (filters.category) where.category = filters.category;
      if (filters.isActive !== undefined && filters.isActive !== null) where.isActive = filters.isActive;
      if (filters.priceMin || filters.priceMax) {
        where.price = {};
        if (filters.priceMin) where.price.gte = Number(filters.priceMin);
        if (filters.priceMax) where.price.lte = Number(filters.priceMax);
      }
      const orderBy: any = {};
      if (filters.sortBy === 'price') orderBy.price = 'asc';
      else if (filters.sortBy === 'oldest') orderBy.createdAt = 'asc';
      else orderBy.createdAt = 'desc';
      return this.db.product.findMany({ where, orderBy, take: 50 });
    }

    if (type === 'invoices') {
      const where: any = { businessId, deletedAt: null };
      if (filters.status) where.status = filters.status;
      if (filters.overdue) where.status = 'OVERDUE';
      if (filters.totalMin || filters.totalMax) {
        where.total = {};
        if (filters.totalMin) where.total.gte = Number(filters.totalMin);
        if (filters.totalMax) where.total.lte = Number(filters.totalMax);
      }
      if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
      }
      const orderBy: any = {};
      if (filters.sortBy === 'oldest') orderBy.createdAt = 'asc';
      else if (filters.sortBy === 'amount') orderBy.total = 'desc';
      else if (filters.sortBy === 'dueDate') orderBy.dueDate = 'asc';
      else orderBy.createdAt = 'desc';
      return this.db.invoice.findMany({
        where, orderBy, take: 50,
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
    }

    if (type === 'quotes') {
      const where: any = { businessId, deletedAt: null };
      if (filters.status) where.status = filters.status;
      if (filters.expired) {
        where.expiryDate = { lt: new Date() };
        where.status = { not: 'ACCEPTED' };
      }
      if (filters.totalMin || filters.totalMax) {
        where.total = {};
        if (filters.totalMin) where.total.gte = Number(filters.totalMin);
        if (filters.totalMax) where.total.lte = Number(filters.totalMax);
      }
      const orderBy: any = {};
      if (filters.sortBy === 'oldest') orderBy.createdAt = 'asc';
      else if (filters.sortBy === 'amount') orderBy.total = 'desc';
      else if (filters.sortBy === 'expiryDate') orderBy.expiryDate = 'asc';
      else orderBy.createdAt = 'desc';
      return this.db.quote.findMany({
        where, orderBy, take: 50,
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
    }

    return [];
  }

  async productHealthScan(businessId: string) {
    const start = Date.now();
    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true, name: true, price: true, category: true, isActive: true,
        currency: true, description: true, sku: true, imageUrl: true, createdAt: true, updatedAt: true,
      },
    });

    const invoiceItems = await this.db.invoiceItem.findMany({
      where: { invoice: { businessId, deletedAt: null }, productId: { not: null } },
      select: { productId: true, quantity: true, total: true },
    });

    const salesByProduct = new Map<string, { count: number; totalRevenue: number }>();
    invoiceItems.forEach((item) => {
      if (!item.productId) return;
      const existing = salesByProduct.get(item.productId) ?? { count: 0, totalRevenue: 0 };
      existing.count += item.quantity;
      existing.totalRevenue += Number(item.total);
      salesByProduct.set(item.productId, existing);
    });

    const issues: Array<{ productId: string; productName: string; issue: string; severity: 'high' | 'medium' | 'low'; suggestion: string }> = [];
    const now = new Date();

    for (const p of products) {
      const sales = salesByProduct.get(p.id);
      if (!p.description || p.description.trim().length < 10) {
        issues.push({ productId: p.id, productName: p.name, issue: 'Missing or short description', severity: 'medium', suggestion: 'Add a detailed description to improve client understanding and AI recommendations.' });
      }
      if (!p.imageUrl) {
        issues.push({ productId: p.id, productName: p.name, issue: 'No product image', severity: 'low', suggestion: 'Add an image to make the product more appealing in quotes and invoices.' });
      }
      if (!p.sku) {
        issues.push({ productId: p.id, productName: p.name, issue: 'No SKU assigned', severity: 'low', suggestion: 'Assign a SKU for better inventory tracking and searchability.' });
      }
      if (p.price <= 0) {
        issues.push({ productId: p.id, productName: p.name, issue: 'Zero or negative price', severity: 'high', suggestion: 'Set a valid price to enable invoicing.' });
      }
      if (!sales || sales.count === 0) {
        const daysSinceCreated = Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86400000);
        if (daysSinceCreated > 30) {
          issues.push({ productId: p.id, productName: p.name, issue: `No sales in ${daysSinceCreated} days`, severity: 'high', suggestion: 'Consider promoting this product, adjusting pricing, or bundling it with popular items.' });
        }
      }
      if (!p.isActive) {
        issues.push({ productId: p.id, productName: p.name, issue: 'Product is inactive', severity: 'medium', suggestion: 'Reactivate if still offered, or archive if discontinued.' });
      }
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(p.updatedAt).getTime()) / 86400000);
      if (daysSinceUpdate > 180) {
        issues.push({ productId: p.id, productName: p.name, issue: `Pricing not reviewed in ${daysSinceUpdate} days`, severity: 'medium', suggestion: 'Review pricing to account for inflation and market changes.' });
      }
    }

    const totalProducts = products.length;
    const activeProducts = products.filter(p => p.isActive).length;
    const productsWithSales = salesByProduct.size;
    const healthScore = totalProducts === 0 ? 100 : Math.max(0, Math.min(100,
      100 - (issues.filter(i => i.severity === 'high').length * 15)
          - (issues.filter(i => i.severity === 'medium').length * 5)
          - (issues.filter(i => i.severity === 'low').length * 2)
    ));

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Product health scan took ${duration}ms`);

    return {
      healthScore,
      healthLabel: healthScore >= 80 ? 'excellent' : healthScore >= 60 ? 'good' : healthScore >= 40 ? 'fair' : 'needs_attention',
      summary: {
        totalProducts,
        activeProducts,
        inactiveProducts: totalProducts - activeProducts,
        productsWithSales,
        productsWithoutSales: totalProducts - productsWithSales,
      },
      issues: issues.sort((a, b) => {
        const sev = { high: 0, medium: 1, low: 2 };
        return sev[a.severity] - sev[b.severity];
      }),
      issueCount: { high: issues.filter(i => i.severity === 'high').length, medium: issues.filter(i => i.severity === 'medium').length, low: issues.filter(i => i.severity === 'low').length },
    };
  }

  async clientPaymentIntelligence(businessId: string, contactId: string) {
    const start = Date.now();
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, status: true, createdAt: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const [invoices, quotes, payments] = await Promise.all([
      this.db.invoice.findMany({
        where: { contactId, businessId, deletedAt: null },
        select: { id: true, invoiceNumber: true, status: true, total: true, currency: true, createdAt: true, dueDate: true, paidAt: true, sentAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.quote.findMany({
        where: { contactId, businessId, deletedAt: null },
        select: { id: true, quoteNumber: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.payment.findMany({
        where: { invoice: { contactId, businessId } },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const contactName = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email || 'Unknown';
    const now = new Date();
    const paidInvoices = invoices.filter(i => i.status === 'PAID');
    const overdueInvoices = invoices.filter(i => i.status === 'OVERDUE');
    const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
    const outstandingBalance = invoices.filter(i => ['SENT', 'OVERDUE'].includes(i.status)).reduce((s, i) => s + Number(i.total), 0);

    const paymentDelays = paidInvoices
      .filter(i => i.dueDate && i.paidAt)
      .map(i => {
        const due = new Date(i.dueDate!).getTime();
        const paid = new Date(i.paidAt!).getTime();
        return Math.floor((paid - due) / 86400000);
      });
    const avgPaymentDelay = paymentDelays.length > 0 ? Math.round(paymentDelays.reduce((s, d) => s + d, 0) / paymentDelays.length) : 0;

    const reliabilityScore = (() => {
      if (invoices.length === 0) return 50;
      let score = 70;
      const paidRatio = paidInvoices.length / invoices.length;
      score += paidRatio * 20;
      if (avgPaymentDelay <= 0) score += 10;
      else if (avgPaymentDelay <= 7) score += 5;
      else if (avgPaymentDelay > 30) score -= 15;
      else if (avgPaymentDelay > 14) score -= 5;
      if (overdueInvoices.length > 0) score -= overdueInvoices.length * 5;
      return Math.max(0, Math.min(100, Math.round(score)));
    })();

    const acceptedQuotes = quotes.filter(q => q.status === 'ACCEPTED').length;
    const quoteConversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;

    const daysSinceFirstInvoice = invoices.length > 0
      ? Math.floor((now.getTime() - new Date(invoices[invoices.length - 1].createdAt).getTime()) / 86400000)
      : 0;
    const monthsActive = Math.max(1, Math.ceil(daysSinceFirstInvoice / 30));
    const avgMonthlyRevenue = Math.round(totalRevenue / monthsActive);

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Client payment intelligence took ${duration}ms`);

    return {
      contactId,
      contactName,
      reliabilityScore,
      reliabilityLabel: reliabilityScore >= 80 ? 'excellent' : reliabilityScore >= 60 ? 'good' : reliabilityScore >= 40 ? 'fair' : 'risky',
      lifetimeValue: totalRevenue,
      outstandingBalance,
      avgPaymentDelay,
      paymentDelayLabel: avgPaymentDelay <= 0 ? 'pays_early' : avgPaymentDelay <= 7 ? 'on_time' : avgPaymentDelay <= 14 ? 'slightly_late' : 'frequently_late',
      invoiceSummary: {
        total: invoices.length,
        paid: paidInvoices.length,
        overdue: overdueInvoices.length,
        outstanding: invoices.filter(i => ['SENT', 'OVERDUE'].includes(i.status)).length,
        void: invoices.filter(i => i.status === 'VOID').length,
      },
      quoteSummary: {
        total: quotes.length,
        accepted: acceptedQuotes,
        conversionRate: quoteConversionRate,
      },
      avgMonthlyRevenue,
      monthsActive,
      recentInvoices: invoices.slice(0, 5).map(i => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        total: i.total,
        currency: i.currency,
        createdAt: i.createdAt,
        dueDate: i.dueDate,
        paidAt: i.paidAt,
      })),
      totalPayments: payments.length,
    };
  }

  async quoteWinAnalysis(businessId: string) {
    const start = Date.now();
    const quotes = await this.db.quote.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true, quoteNumber: true, status: true, total: true, currency: true,
        createdAt: true, expiryDate: true,
        contact: { select: { id: true, firstName: true, lastName: true } },
        items: { select: { description: true, quantity: true, unitPrice: true, total: true } },
        invoiceId: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const totalQuotes = quotes.length;
    const accepted = quotes.filter(q => q.status === 'ACCEPTED');
    const rejected = quotes.filter(q => q.status === 'REJECTED');
    const sent = quotes.filter(q => q.status === 'SENT');
    const draft = quotes.filter(q => q.status === 'DRAFT');
    const expired = sent.filter(q => q.expiryDate && new Date(q.expiryDate) < now);
    const converted = quotes.filter(q => q.invoiceId);

    const conversionRate = totalQuotes > 0 ? Math.round((accepted.length / totalQuotes) * 100) : 0;
    const rejectionRate = totalQuotes > 0 ? Math.round((rejected.length / totalQuotes) * 100) : 0;

    const avgAcceptedValue = accepted.length > 0
      ? Math.round(accepted.reduce((s, q) => s + Number(q.total), 0) / accepted.length)
      : 0;
    const avgRejectedValue = rejected.length > 0
      ? Math.round(rejected.reduce((s, q) => s + Number(q.total), 0) / rejected.length)
      : 0;

    const pipelineValue = sent.reduce((s, q) => s + Number(q.total), 0) + draft.reduce((s, q) => s + Number(q.total), 0);

    const suggestions: string[] = [];
    if (conversionRate < 30 && totalQuotes > 5) suggestions.push('Your quote conversion rate is below 30%. Consider reviewing your pricing strategy or follow-up process.');
    if (expired.length > 0) suggestions.push(`You have ${expired.length} expired quote(s) still marked as sent. Follow up or close them.`);
    if (avgRejectedValue > avgAcceptedValue * 1.5 && rejected.length > 2) suggestions.push('Rejected quotes tend to be higher value. Consider breaking large proposals into phases.');
    if (draft.length > sent.length && draft.length > 3) suggestions.push(`You have ${draft.length} draft quotes not yet sent. Review and send them to keep your pipeline moving.`);
    if (totalQuotes === 0) suggestions.push('Start creating quotes to track your proposal-to-revenue pipeline.');

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Quote win analysis took ${duration}ms`);

    return {
      conversionRate,
      rejectionRate,
      summary: {
        total: totalQuotes,
        accepted: accepted.length,
        rejected: rejected.length,
        sent: sent.length,
        draft: draft.length,
        expired: expired.length,
        converted: converted.length,
      },
      values: {
        avgAcceptedValue,
        avgRejectedValue,
        pipelineValue,
        totalWonValue: accepted.reduce((s, q) => s + Number(q.total), 0),
        totalLostValue: rejected.reduce((s, q) => s + Number(q.total), 0),
      },
      suggestions,
      recentQuotes: quotes.slice(0, 10).map(q => ({
        id: q.id,
        quoteNumber: q.quoteNumber,
        status: q.status,
        total: q.total,
        currency: q.currency,
        contactName: q.contact ? `${q.contact.firstName ?? ''} ${q.contact.lastName ?? ''}`.trim() || 'Unknown' : 'No contact',
        createdAt: q.createdAt,
        expiryDate: q.expiryDate,
        converted: !!q.invoiceId,
      })),
    };
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
      outputCategory: 'general',
      responseMode: 'structured_json',
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
          await this.catalog.deactivateProduct(businessId, product.id);
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Product "${product.name}" deactivated`, productId: product.id };
        }

        case 'update_product': {
          const product = await this.findProduct(businessId, params);
          if (!product) return { success: false, error: 'Product not found' };
          const patch: Record<string, any> = { businessId, productId: product.id };
          if (params.price !== undefined) patch.price = Number(params.price);
          if (params.description !== undefined) patch.description = String(params.description);
          if (params.category !== undefined) patch.category = String(params.category);
          if (params.name !== undefined && params.name !== params.productName) patch.name = String(params.name);
          if (Object.keys(patch).length === 2) return { success: false, error: 'No fields to update' };
          const updated = await this.catalog.updateProduct(patch as any);
          this.stats.invalidateCache(businessId);
          return { success: true, message: `Product "${updated.name}" updated`, productId: updated.id };
        }

        case 'create_product': {
          if (!params.name || !params.price) return { success: false, error: 'Product name and price are required' };
          const product = await this.catalog.createProduct({
            businessId,
            name: params.name,
            price: Number(params.price),
            currency: 'TTD',
            category: params.category || 'SERVICE',
            description: params.description || null,
            isActive: true,
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

  async predictiveCollectionsScore(businessId: string) {
    const start = Date.now();
    const now = new Date();

    const overdueInvoices = await this.db.invoice.findMany({
      where: { businessId, deletedAt: null, status: { in: ['OVERDUE', 'SENT'] }, dueDate: { lt: now } },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    if (overdueInvoices.length === 0) {
      return {
        scores: [],
        summary: { totalOverdue: 0, estimatedRecovery: 0, highPriorityCount: 0, averageRecoveryScore: 0 },
        strategy: 'No overdue invoices — great job staying on top of collections!',
      };
    }

    const contactIds = [...new Set(overdueInvoices.map(i => i.contactId).filter(Boolean))];
    const paymentHistory = await this.db.invoice.findMany({
      where: { businessId, deletedAt: null, contactId: { in: contactIds as string[] }, status: 'PAID' },
      select: { contactId: true, total: true, dueDate: true, paidAt: true },
    });

    const historyByContact = new Map<string, { paidCount: number; avgDelay: number; totalPaid: number }>();
    for (const cid of contactIds) {
      if (!cid) continue;
      const paid = paymentHistory.filter(p => p.contactId === cid);
      const delays = paid.filter(p => p.dueDate && p.paidAt).map(p => Math.floor((new Date(p.paidAt!).getTime() - new Date(p.dueDate!).getTime()) / 86400000));
      historyByContact.set(cid, {
        paidCount: paid.length,
        avgDelay: delays.length > 0 ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length) : 0,
        totalPaid: paid.reduce((s, p) => s + Number(p.total), 0),
      });
    }

    const contextBlock = overdueInvoices.map(inv => {
      const contactName = inv.contact ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || 'Unknown' : 'Unknown';
      const contactId = inv.contact?.id ?? 'unknown';
      const daysOverdue = inv.dueDate ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000) : 0;
      const history = inv.contactId ? historyByContact.get(inv.contactId) : null;
      return `InvoiceID: ${inv.id} | Invoice #${inv.invoiceNumber} | $${inv.total} ${inv.currency} | ContactID: ${contactId} | ${contactName} | ${daysOverdue} days overdue | Contact history: ${history ? `${history.paidCount} paid, avg ${history.avgDelay}d delay, $${history.totalPaid} total` : 'no history'}`;
    }).join('\n');

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_collections_scoring',
      messages: [
        { role: 'system', content: buildCollectionsScoringPrompt(contextBlock) },
        { role: 'user', content: `Score these ${overdueInvoices.length} overdue invoices for recovery likelihood.` },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'general',
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Collections scoring took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      const totalOverdue = overdueInvoices.reduce((s, i) => s + Number(i.total), 0);
      return {
        scores: overdueInvoices.map(inv => ({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          contactName: inv.contact ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() : 'Unknown',
          amount: Number(inv.total),
          daysOverdue: inv.dueDate ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000) : 0,
          recoveryScore: 50,
          recoveryLabel: 'uncertain',
          recommendedChannel: 'email',
          recommendedTone: 'firm',
          reasoning: result.content,
          nextAction: 'Send a follow-up reminder',
        })),
        summary: { totalOverdue, estimatedRecovery: totalOverdue * 0.6, highPriorityCount: 0, averageRecoveryScore: 50 },
        strategy: result.content,
      };
    }
  }

  async suggestPaymentPlan(businessId: string, invoiceId: string) {
    const invoice = await this.db.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        items: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const contactName = invoice.contact
      ? `${invoice.contact.firstName ?? ''} ${invoice.contact.lastName ?? ''}`.trim() || 'Customer'
      : 'Customer';

    let historyContext = '';
    if (invoice.contactId) {
      const pastInvoices = await this.db.invoice.findMany({
        where: { contactId: invoice.contactId, businessId, deletedAt: null, status: 'PAID' },
        select: { total: true, dueDate: true, paidAt: true },
        orderBy: { paidAt: 'desc' },
        take: 20,
      });
      const delays = pastInvoices.filter(i => i.dueDate && i.paidAt).map(i => Math.floor((new Date(i.paidAt!).getTime() - new Date(i.dueDate!).getTime()) / 86400000));
      historyContext = `\nPayment History: ${pastInvoices.length} paid invoices, avg delay: ${delays.length > 0 ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length) : 0} days, total paid: $${pastInvoices.reduce((s, i) => s + Number(i.total), 0)}`;
    }

    const now = new Date();
    const daysOverdue = invoice.dueDate
      ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000))
      : 0;

    const contextBlock = `Invoice #${invoice.invoiceNumber}
Amount: $${invoice.total} ${invoice.currency}
Status: ${invoice.status}
Days Overdue: ${daysOverdue}
Contact: ${contactName}
Items: ${invoice.items.map((i: any) => `${i.description} ($${i.total})`).join(', ')}${historyContext}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_payment_plan',
      messages: [
        { role: 'system', content: buildPaymentPlanPrompt(contextBlock) },
        { role: 'user', content: `Suggest payment plan options for this $${invoice.total} invoice.` },
      ],
      maxTokens: 1500,
      temperature: 0.4,
      outputCategory: 'general',
    });

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        plans: [],
        recommendation: result.content,
        customerProfile: { paymentReliability: 'unknown', averagePaymentDelay: 0, totalRelationshipValue: 0 },
      };
    }
  }

  async smartQuoteFollowUp(businessId: string, quoteId: string) {
    const quote = await this.db.quote.findFirst({
      where: { id: quoteId, businessId, deletedAt: null },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        items: { select: { description: true, quantity: true, unitPrice: true, total: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    const contactName = quote.contact
      ? `${quote.contact.firstName ?? ''} ${quote.contact.lastName ?? ''}`.trim() || 'Customer'
      : 'Customer';

    let historyContext = '';
    if (quote.contactId) {
      const pastQuotes = await this.db.quote.findMany({
        where: { contactId: quote.contactId, businessId, deletedAt: null },
        select: { status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const accepted = pastQuotes.filter(q => q.status === 'ACCEPTED').length;
      historyContext = `\nQuote History: ${pastQuotes.length} quotes, ${accepted} accepted (${pastQuotes.length > 0 ? Math.round((accepted / pastQuotes.length) * 100) : 0}% conversion)`;
    }

    const now = new Date();
    const daysSinceCreated = Math.floor((now.getTime() - new Date(quote.createdAt).getTime()) / 86400000);
    const daysUntilExpiry = quote.expiryDate
      ? Math.floor((new Date(quote.expiryDate).getTime() - now.getTime()) / 86400000)
      : null;

    const contextBlock = `Quote #${quote.quoteNumber}
Amount: $${quote.total} ${quote.currency}
Status: ${quote.status}
Created: ${daysSinceCreated} days ago
Expiry: ${daysUntilExpiry !== null ? `${daysUntilExpiry} days ${daysUntilExpiry < 0 ? 'ago (expired)' : 'remaining'}` : 'No expiry set'}
Contact: ${contactName}
Items: ${(quote.items ?? []).map((i: any) => `${i.description} ($${i.total})`).join(', ')}${historyContext}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_quote_followup',
      messages: [
        { role: 'system', content: buildQuoteFollowUpPrompt(contextBlock) },
        { role: 'user', content: `What's the best follow-up strategy for this $${quote.total} quote?` },
      ],
      maxTokens: 1500,
      temperature: 0.4,
      outputCategory: 'messages',
    });

    try {
      return { quoteId: quote.id, quoteNumber: quote.quoteNumber, ...JSON.parse(result.content) };
    } catch {
      return {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        closeProbability: 50,
        closeProbabilityLabel: 'moderate',
        followUpWindow: 'within_week',
        messagingApproach: { tone: 'consultative', keyPoints: [], openingLine: '', closingLine: '' },
        reasoning: result.content,
      };
    }
  }

  async churnRiskAlerts(businessId: string) {
    const start = Date.now();
    const now = new Date();

    const recurringSchedules = await this.db.recurringInvoice.findMany({
      where: { businessId, deletedAt: null },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
      },
    });

    const contactIds = [...new Set(recurringSchedules.map(r => r.contactId).filter(Boolean))];
    if (contactIds.length === 0) {
      return {
        alerts: [],
        summary: { totalAtRisk: 0, revenueAtRisk: 0, criticalCount: 0, highCount: 0 },
        retentionStrategies: ['Set up recurring billing schedules to start tracking churn risk.'],
      };
    }

    const invoices = await this.db.invoice.findMany({
      where: { businessId, deletedAt: null, contactId: { in: contactIds } },
      select: { contactId: true, status: true, total: true, createdAt: true, dueDate: true, paidAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const contextParts: string[] = [];
    for (const schedule of recurringSchedules) {
      if (!schedule.contact) continue;
      const name = `${schedule.contact.firstName ?? ''} ${schedule.contact.lastName ?? ''}`.trim() || 'Unknown';
      const contactInvoices = invoices.filter(i => i.contactId === schedule.contactId);
      const paid = contactInvoices.filter(i => i.status === 'PAID');
      const overdue = contactInvoices.filter(i => i.status === 'OVERDUE');
      const lastPayment = paid.length > 0 ? paid[0].paidAt : null;
      const daysSinceLastPayment = lastPayment ? Math.floor((now.getTime() - new Date(lastPayment).getTime()) / 86400000) : null;

      contextParts.push(`ContactID: ${schedule.contact.id} | Contact: ${name} (${schedule.contact.status}) | Schedule: ${schedule.name} (${schedule.frequency}, ${schedule.isActive ? 'Active' : 'Paused'}) | Invoices: ${contactInvoices.length} total, ${paid.length} paid, ${overdue.length} overdue | Last payment: ${daysSinceLastPayment !== null ? `${daysSinceLastPayment} days ago` : 'never'} | Monthly value: ~$${Number(schedule.total || 0)}`);
    }

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_churn_risk',
      messages: [
        { role: 'system', content: buildChurnRiskPrompt(contextParts.join('\n')) },
        { role: 'user', content: `Analyze these ${recurringSchedules.length} recurring customers for churn risk.` },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'general',
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Churn risk analysis took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        alerts: [],
        summary: { totalAtRisk: 0, revenueAtRisk: 0, criticalCount: 0, highCount: 0 },
        retentionStrategies: [result.content],
      };
    }
  }

  async revenueJourney(businessId: string) {
    const start = Date.now();

    const [contacts, quotes, invoices, payments] = await Promise.all([
      this.db.contact.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, createdAt: true },
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, contactId: true, status: true, total: true, invoiceId: true, createdAt: true },
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, contactId: true, status: true, total: true, createdAt: true, paidAt: true },
      }),
      this.db.payment.findMany({
        where: { invoice: { businessId, deletedAt: null } },
        select: { id: true, amount: true, invoiceId: true, createdAt: true },
      }),
    ]);

    const totalContacts = contacts.length;
    const contactsWithQuotes = new Set(quotes.map(q => q.contactId).filter(Boolean)).size;
    const contactsWithInvoices = new Set(invoices.map(i => i.contactId).filter(Boolean)).size;
    const paidInvoices = invoices.filter(i => i.status === 'PAID');
    const contactsWithPayments = new Set(paidInvoices.map(i => i.contactId).filter(Boolean)).size;
    const quotesConvertedToInvoice = quotes.filter(q => q.invoiceId).length;

    const funnel = {
      totalContacts,
      contactsWithQuotes,
      quotesToInvoices: quotesConvertedToInvoice,
      invoicesToPayments: paidInvoices.length,
      contactToQuoteRate: totalContacts > 0 ? Math.round((contactsWithQuotes / totalContacts) * 100) : 0,
      quoteToInvoiceRate: quotes.length > 0 ? Math.round((quotesConvertedToInvoice / quotes.length) * 100) : 0,
      invoiceToPaymentRate: invoices.length > 0 ? Math.round((paidInvoices.length / invoices.length) * 100) : 0,
      overallConversionRate: totalContacts > 0 ? Math.round((contactsWithPayments / totalContacts) * 100) : 0,
    };

    const contextBlock = `Contacts: ${totalContacts}
Contacts with quotes: ${contactsWithQuotes}
Total quotes: ${quotes.length} (${quotes.filter(q => q.status === 'ACCEPTED').length} accepted, ${quotes.filter(q => q.status === 'REJECTED').length} rejected)
Quotes converted to invoices: ${quotesConvertedToInvoice}
Total invoices: ${invoices.length} (${paidInvoices.length} paid)
Total payments: ${payments.length}
Total revenue: $${paidInvoices.reduce((s, i) => s + Number(i.total), 0)}
Funnel rates: Contact→Quote ${funnel.contactToQuoteRate}%, Quote→Invoice ${funnel.quoteToInvoiceRate}%, Invoice→Payment ${funnel.invoiceToPaymentRate}%`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_revenue_journey',
      messages: [
        { role: 'system', content: buildRevenueJourneyPrompt(contextBlock) },
        { role: 'user', content: 'Analyze the revenue journey funnel and identify drop-off points.' },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'reports',
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Revenue journey analysis took ${duration}ms`);

    try {
      const aiAnalysis = JSON.parse(result.content);
      return { ...aiAnalysis, funnel };
    } catch {
      return {
        funnel,
        dropOffPoints: [],
        topPaths: [],
        insights: [result.content],
        recommendations: [],
      };
    }
  }

  async quoteFromConversation(businessId: string, conversationText: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(conversationText, 5000);
    if (!sanitized.trim()) {
      throw new Error('Conversation text is required');
    }

    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, price: true, category: true, currency: true,
        description: true, duration: true, executionModel: true, executionMeta: true,
      },
    });

    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const productList = products.map(p =>
      `- ${p.name} (${p.category}, $${p.price} ${p.currency}${p.executionModel ? `, ${p.executionModel}` : ''}): ${p.description?.slice(0, 100) || 'No description'}`
    ).join('\n');

    const contactList = contacts.slice(0, 20).map(c =>
      `- ${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() + ` (${c.email || 'no email'}) [ID: ${c.id}]`
    ).join('\n');

    const prompt = `You are a business intelligence assistant for a Caribbean service business. Analyze the following client conversation/message and extract structured information for creating a quote.

Available Products/Services:
${productList}

Known Contacts:
${contactList}

Analyze the conversation and return a JSON object with:
{
  "analysis": {
    "detectedNeeds": ["list of identified needs/services requested"],
    "budgetSignals": { "mentioned": true/false, "range": "low/medium/high/premium", "specificAmount": null or number, "currency": "TTD" },
    "urgency": "low/medium/high/critical",
    "objections": ["any hesitations or concerns mentioned"],
    "intent": "inquiry/ready_to_buy/comparing/negotiating",
    "sentiment": "positive/neutral/cautious/negative"
  },
  "matchedContact": { "id": "contact_id or null", "name": "detected name", "email": "detected email or null" },
  "draftQuote": {
    "items": [
      { "productId": "matched_product_id or null", "description": "line item description", "quantity": 1, "unitPrice": 0.00 }
    ],
    "currency": "TTD",
    "notes": "any special notes or conditions",
    "suggestedDiscount": { "type": "PERCENT or FIXED or null", "value": 0, "reason": "why this discount" },
    "expiryDays": 14
  },
  "followUpSuggestions": ["actionable next steps for the business owner"]
}

Only include items that directly match the conversation. Map to existing products when possible. If a need doesn't match an existing product, create a custom line item with a reasonable price estimate.`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_quote_from_conversation',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Analyze this conversation and generate a draft quote:\n\n${sanitized}` },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'general',
      responseMode: 'structured_json',
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Quote from conversation took ${duration}ms`);

    try {
      const parsed = JSON.parse(result.content);
      if (parsed.draftQuote?.items) {
        for (const item of parsed.draftQuote.items) {
          if (item.productId) {
            const product = products.find(p => p.id === item.productId);
            if (product && item.unitPrice === 0) {
              item.unitPrice = product.price;
            }
          }
        }
      }
      return parsed;
    } catch {
      return {
        analysis: {
          detectedNeeds: [],
          budgetSignals: { mentioned: false, range: 'medium', specificAmount: null, currency: 'TTD' },
          urgency: 'medium',
          objections: [],
          intent: 'inquiry',
          sentiment: 'neutral',
        },
        matchedContact: null,
        draftQuote: { items: [], currency: 'TTD', notes: result.content, suggestedDiscount: null, expiryDays: 14 },
        followUpSuggestions: ['Review the conversation manually and create a quote.'],
      };
    }
  }
}

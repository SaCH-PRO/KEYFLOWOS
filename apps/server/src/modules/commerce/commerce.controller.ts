import { Body, Controller, Delete, ForbiddenException, Get, Inject, Logger, Param, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CommerceService } from './commerce.service';
import { CommerceVisionService } from './commerce-vision.service';
import { StoreReadinessService } from './store-readiness.service';
import { PaymentEvidenceService } from './payment-evidence.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { appUrl } from '../../core/config/runtime-urls';
import { TeamAuditInterceptor, AuditAction } from '../../core/interceptors/team-audit.interceptor';
import { CreateProductDto } from './dto/create-product.dto';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';
import { sanitizeString } from '../../core/utils/sanitize';
import { readVisitorIdFromRequest } from '../../core/utils/visitor-cookie';
import type { Request } from 'express';
import { BulkProductsDto } from './dto/bulk-products.dto';
import { InvoiceReceiptBuilderService } from './invoice-receipt-builder.service';
import { GmailService } from './gmail.service';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { buildQuoteEmailHtml } from './quote-email.template';
import { buildInvoiceEmailHtml } from './invoice-email.template';
import { sumSuccessfulPayments, type InvoiceForEmail } from './invoice-email.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Controller('commerce')
export class CommerceController {
  private readonly logger = new Logger(CommerceController.name);

  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(InvoiceReceiptBuilderService) private readonly receipts: InvoiceReceiptBuilderService,
    @Inject(GmailService) private readonly gmail: GmailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceVisionService) private readonly vision: CommerceVisionService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(StoreReadinessService) private readonly storeReadiness: StoreReadinessService,
    @Inject(PaymentEvidenceService) private readonly paymentEvidence: PaymentEvidenceService,
  ) {}

  private async verifyBusinessAccess(userId: string, businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: {
        id: businessId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
    });
    if (!business) {
      throw new ForbiddenException('You do not have access to this resource');
    }
  }

  @Get('public/businesses/:businessId/products')
  listPublicProducts(@Param('businessId') businessId: string) {
    return this.commerce.listPublicProducts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/products')
  listProducts(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listProducts(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'product_created', 'product')
  @RequirePlanLimit('products')
  @Post('businesses/:businessId/products')
  createProduct(
    @Param('businessId') businessId: string,
    @Body() body: CreateProductDto,
  ) {
    return this.commerce.createProduct({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/products/bulk')
  bulkUpdateProducts(
    @Param('businessId') businessId: string,
    @Body() body: BulkProductsDto,
  ) {
    return this.commerce.bulkUpdateProducts(businessId, body.ids, body.action);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'product_updated', 'product')
  @Patch('businesses/:businessId/products/:productId')
  updateProduct(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: Partial<CreateProductDto>,
  ) {
    return this.commerce.updateProduct({ businessId, productId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'product_deleted', 'product')
  @Delete('businesses/:businessId/products/:productId')
  deleteProduct(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.commerce.deleteProduct(businessId, productId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/products/:productId/cost-profile')
  async getProductCostProfile(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId },
      include: { costProfile: true },
    });
    if (!product) return { costProfile: null, margin: null };
    const price = Number(product.price ?? 0);
    const cp = product.costProfile;
    const landedCost = cp
      ? Number(cp.sourceCost ?? 0) + Number(cp.shippingEstimate ?? 0) + Number(cp.dutiesEstimate ?? 0) +
        Number(cp.packagingCost ?? 0) + Number(cp.transactionCost ?? 0)
      : 0;
    const grossMargin = price > 0 && landedCost > 0 ? Math.round(((price - landedCost) / price) * 1000) / 10 : null;
    const marginBand = grossMargin != null
      ? grossMargin < 20 ? 'low' : grossMargin < 40 ? 'medium' : grossMargin < 60 ? 'high' : 'premium'
      : null;
    return {
      costProfile: cp ?? null,
      price,
      landedCost: landedCost > 0 ? landedCost : null,
      grossMargin,
      marginBand,
      currency: cp?.currency ?? product.currency ?? 'TTD',
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/products/:productId/cost-profile')
  async upsertProductCostProfile(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: {
      sourceCost?: number;
      shippingEstimate?: number;
      dutiesEstimate?: number;
      packagingCost?: number;
      transactionCost?: number;
      currency?: string;
    },
  ) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId },
      select: { id: true, price: true, currency: true },
    });
    if (!product) throw new ForbiddenException('Product not found');

    const price = Number(product.price ?? 0);
    const landedCost = Number(body.sourceCost ?? 0) + Number(body.shippingEstimate ?? 0) +
      Number(body.dutiesEstimate ?? 0) + Number(body.packagingCost ?? 0) + Number(body.transactionCost ?? 0);
    const grossMargin = price > 0 && landedCost > 0 ? Math.round(((price - landedCost) / price) * 1000) / 10 : null;
    const marginBand = grossMargin != null
      ? grossMargin < 20 ? 'low' : grossMargin < 40 ? 'medium' : grossMargin < 60 ? 'high' : 'premium'
      : null;

    const costProfile = await this.prisma.client.productCostProfile.upsert({
      where: { productId },
      create: {
        productId,
        sourceCost: body.sourceCost ?? 0,
        shippingEstimate: body.shippingEstimate ?? 0,
        dutiesEstimate: body.dutiesEstimate ?? 0,
        packagingCost: body.packagingCost ?? 0,
        transactionCost: body.transactionCost ?? 0,
        landedCostEstimate: landedCost,
        grossMargin,
        marginBand,
        currency: body.currency ?? product.currency ?? 'TTD',
      },
      update: {
        sourceCost: body.sourceCost ?? 0,
        shippingEstimate: body.shippingEstimate ?? 0,
        dutiesEstimate: body.dutiesEstimate ?? 0,
        packagingCost: body.packagingCost ?? 0,
        transactionCost: body.transactionCost ?? 0,
        landedCostEstimate: landedCost,
        grossMargin,
        marginBand,
        currency: body.currency ?? product.currency ?? 'TTD',
      },
    });

    // Create margin snapshot for history
    await this.prisma.client.marginSnapshot.create({
      data: {
        productId,
        sourceCost: body.sourceCost ?? 0,
        sellingPrice: price,
        landedCostEstimate: landedCost,
        grossMargin: grossMargin ?? 0,
        marginBand: marginBand ?? 'unknown',
        currency: body.currency ?? product.currency ?? 'TTD',
        snapshotReason: 'manual_update',
      },
    });

    return { costProfile, landedCost, grossMargin, marginBand };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/products/import/scan')
  @UseInterceptors(FileInterceptor('image'))
  async scanProductImage(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { currency?: string },
  ) {
    if (!file) throw new ForbiddenException('Image file is required');
    const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    const extracted = await this.vision.extractProductsFromImage(businessId, base64, body.currency || 'TTD');
    return { extracted, count: extracted.length };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/products/import/file')
  @UseInterceptors(FileInterceptor('file'))
  async importProductsFile(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new ForbiddenException('File is required');
    const content = file.buffer.toString('utf-8');
    const extracted = this.vision.parseProductsCsv(content);
    return { extracted, count: extracted.length };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/products/import/confirm')
  async confirmImportedProducts(
    @Param('businessId') businessId: string,
    @Body() body: { products: CreateProductDto[] },
  ) {
    if (!body.products || !Array.isArray(body.products) || body.products.length === 0) {
      throw new ForbiddenException('At least one product is required');
    }
    if (body.products.length > 200) {
      throw new ForbiddenException('Maximum 200 products per import');
    }
    const validProducts = body.products.filter(p => p.name && typeof p.name === 'string' && p.name.trim().length > 0);
    if (validProducts.length === 0) {
      throw new ForbiddenException('No valid products found — each product must have a name');
    }
    const limitCheck = await this.subscriptions.checkLimit(businessId, 'products');
    if (!limitCheck.allowed) {
      const limitLabel = limitCheck.limit === -1 ? 'unlimited' : String(limitCheck.limit);
      throw new ForbiddenException({
        statusCode: 403,
        error: 'PLAN_LIMIT_REACHED',
        message: `You have reached the products limit for your current plan (${limitCheck.current}/${limitLabel}). Please upgrade to add more.`,
        resource: 'products',
        current: limitCheck.current,
        limit: limitCheck.limit,
        upgradeTo: limitCheck.upgradeTo,
      });
    }
    if (limitCheck.limit !== -1) {
      const remaining = limitCheck.limit - limitCheck.current;
      if (validProducts.length > remaining) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'PLAN_LIMIT_REACHED',
          message: `Import would exceed your plan limit. You can add ${remaining} more product${remaining === 1 ? '' : 's'} (${limitCheck.current}/${limitCheck.limit} used). Please reduce the import size or upgrade your plan.`,
          resource: 'products',
          current: limitCheck.current,
          limit: limitCheck.limit,
          upgradeTo: limitCheck.upgradeTo,
        });
      }
    }
    const created = [];
    const errors: string[] = [];
    for (const p of validProducts) {
      try {
        const result = await this.commerce.createProduct({
          businessId,
          name: p.name.trim(),
          price: typeof p.price === 'number' && p.price >= 0 ? p.price : 0,
          currency: p.currency || 'TTD',
          description: p.description || null,
          category: p.category || 'PRODUCT',
          duration: p.duration || null,
          imageUrl: p.imageUrl || null,
          sku: p.sku || null,
          isActive: p.isActive ?? true,
        });
        created.push(result);
      } catch (err) {
        this.logger.warn(`Failed to import product "${p.name}":`, err);
        errors.push(p.name);
      }
    }
    return { created, count: created.length, errors, totalAttempted: validProducts.length };
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/paid')
  async markInvoicePaid(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.commerce.markInvoicePaid(invoiceId, req?.user?.id);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/payment-failed')
  async markInvoicePaymentFailed(
    @Param('invoiceId') invoiceId: string,
    @Req() req: any,
    @Body() body: { reason?: string },
  ) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.commerce.markInvoicePaymentFailed(invoiceId, req?.user?.id, body?.reason);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/status/:status')
  async updateInvoiceStatus(
    @Param('invoiceId') invoiceId: string,
    @Param('status') status: string,
    @Req() req: any,
    @Body() body: UpdateInvoiceStatusDto,
  ) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.commerce.updateInvoiceStatus({
      invoiceId,
      status: status.toUpperCase() as 'SENT' | 'OVERDUE' | 'VOID',
      actorId: req?.user?.id,
      sentAt: body?.sentAt,
      dueDate: body?.dueDate,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/document-templates')
  async getDocumentTemplates(@Param('businessId') businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { invoiceTemplate: true, quoteTemplate: true, primaryColor: true, secondaryColor: true, logoUrl: true },
    });
    return {
      templates: [
        { id: 'classic', type: 'invoice', name: 'Classic', isDefault: business?.invoiceTemplate === 'classic' },
        { id: 'modern', type: 'invoice', name: 'Modern', isDefault: business?.invoiceTemplate === 'modern' },
        { id: 'minimal', type: 'invoice', name: 'Minimal', isDefault: business?.invoiceTemplate === 'minimal' },
        { id: 'classic', type: 'quote', name: 'Classic', isDefault: business?.quoteTemplate === 'classic' },
        { id: 'modern', type: 'quote', name: 'Modern', isDefault: business?.quoteTemplate === 'modern' },
        { id: 'minimal', type: 'quote', name: 'Minimal', isDefault: business?.quoteTemplate === 'minimal' },
      ],
      branding: {
        primaryColor: business?.primaryColor,
        secondaryColor: business?.secondaryColor,
        logoUrl: business?.logoUrl,
      },
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/document-templates')
  async setDocumentTemplate(
    @Param('businessId') businessId: string,
    @Body() body: { invoiceTemplate?: 'classic' | 'modern' | 'minimal'; quoteTemplate?: 'classic' | 'modern' | 'minimal' },
  ) {
    const data: Record<string, any> = {};
    if (body.invoiceTemplate) data.invoiceTemplate = body.invoiceTemplate;
    if (body.quoteTemplate) data.quoteTemplate = body.quoteTemplate;
    await this.prisma.client.business.update({ where: { id: businessId }, data });
    return { success: true, ...data };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/invoices')
  listInvoices(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listInvoices(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'invoice_created', 'invoice')
  @RequirePlanLimit('invoices')
  @Post('businesses/:businessId/invoices')
  createInvoice(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactId?: string;
      items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      dueDate?: string;
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED';
      discountValue?: number;
      notes?: string;
    },
  ) {
    return this.commerce.createInvoice({ businessId, ...body });
  }

  @UseGuards(AuthGuard)
  @Patch('quotes/:quoteId/status/:status')
  async updateQuoteStatus(
    @Param('quoteId') quoteId: string,
    @Param('status') status: string,
    @Req() req: any,
  ) {
    try {
      const quote = await this.prisma.client.quote.findUnique({ where: { id: quoteId }, select: { businessId: true } });
      if (quote) await this.verifyBusinessAccess(req.user.id, quote.businessId);
      this.logger.log(`Updating quote ${quoteId} to status ${status} by user ${req?.user?.id}`);
      const result = await this.commerce.updateQuoteStatus({
        quoteId,
        status: status.toUpperCase() as UpdateQuoteStatusDto['status'],
        actorId: req?.user?.id,
      });
      this.logger.log(`Quote ${quoteId} status updated successfully`);
      return result;
    } catch (error: any) {
      this.logger.error(`Failed to update quote status: ${error?.message}`, error?.stack);
      throw error;
    }
  }

  @UseGuards(AuthGuard)
  @Get('invoices/:invoiceId/receipt')
  async getReceipt(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.receipts.buildReceipt(invoiceId);
  }

  @Get('invoices/:invoiceId')
  getInvoice(@Param('invoiceId') invoiceId: string) {
    return this.commerce.getInvoiceWithBusiness(invoiceId, true);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/invoices/bulk')
  bulkUpdateInvoices(
    @Param('businessId') businessId: string,
    @Body() body: { ids: string[]; action: 'send' | 'void' | 'delete' },
  ) {
    return this.commerce.bulkUpdateInvoices(businessId, body.ids, body.action);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/quotes/bulk')
  bulkUpdateQuotes(
    @Param('businessId') businessId: string,
    @Body() body: { ids: string[]; action: 'send' | 'reject' | 'delete' },
  ) {
    return this.commerce.bulkUpdateQuotes(businessId, body.ids, body.action);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('businesses/:businessId/invoices/:invoiceId')
  deleteInvoice(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commerce.deleteInvoice(invoiceId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/invoices/:invoiceId')
  updateInvoice(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: {
      contactId?: string;
      items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      dueDate?: string;
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED' | null;
      discountValue?: number | null;
      notes?: string | null;
    },
  ) {
    return this.commerce.updateInvoice({ invoiceId, businessId, ...body });
  }

  // ========== QUOTES ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/quotes')
  listQuotes(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listQuotes(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  // R2: surfaced as a list endpoint so R3's Action Queue can subscribe
  // without having to recompute the staleness rule.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/quotes/stale')
  listStaleQuotes(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    const threshold = days ? Math.max(parseInt(days, 10) || 0, 1) : undefined;
    return this.commerce.getStaleQuotes(businessId, threshold);
  }

  // R3: one-click "Send reminder" used by the Action Queue stale-quote
  // card. Stamps lastFollowUpAt so the daily scan won't re-surface the
  // same quote tomorrow, and resolves any pending stale-quote approval
  // items for it as 'approved'.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/quotes/:quoteId/follow-up')
  async sendQuoteFollowUp(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Req() req: any,
  ) {
    const actorId = req?.user?.id ?? null;
    const quote = await this.commerce.markQuoteFollowedUp({ quoteId, businessId, actorId });
    // Resolve any pending stale-quote Action Queue cards for this quote.
    const pending = await this.prisma.client.aiApprovalItem.findMany({
      where: {
        businessId,
        status: 'pending',
        toolName: 'commerce_send_quote_reminder',
      },
      select: { id: true, inputPayload: true },
    });
    const matches = pending.filter(
      (p) => (p.inputPayload as Record<string, unknown> | null)?.quoteId === quoteId,
    );
    if (matches.length > 0) {
      await this.prisma.client.aiApprovalItem.updateMany({
        where: { id: { in: matches.map((m) => m.id) } },
        data: {
          status: 'approved',
          resolution: 'approved',
          resolvedAt: new Date(),
          resolvedBy: actorId,
          resolvedByUserId: actorId,
        },
      });
    }
    return { success: true, quote, resolvedApprovals: matches.length };
  }

  @Get('quotes/:quoteId')
  getQuote(@Param('quoteId') quoteId: string) {
    return this.commerce.getQuote(quoteId);
  }

  // ----- R2: public endpoints (signed-token authenticated) -----

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(60, 60_000)
  @Get('public/quotes/:token')
  async getPublicQuote(@Param('token') token: string, @Req() req: Request) {
    const visitorId = readVisitorIdFromRequest(req);
    const quote = await this.commerce.markQuoteViewedByToken(token, visitorId);
    if (!quote) {
      throw new ForbiddenException('Quote not found');
    }
    return quote;
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Post('public/quotes/:token/accept')
  acceptPublicQuote(
    @Param('token') token: string,
    @Body() body: { visitorId?: string } | undefined,
    @Req() req: Request,
  ) {
    const visitorId =
      (body?.visitorId ? sanitizeString(body.visitorId, 100) : null) ??
      readVisitorIdFromRequest(req);
    return this.commerce.respondToQuoteByToken(token, 'accept', undefined, visitorId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Post('public/quotes/:token/reject')
  rejectPublicQuote(
    @Param('token') token: string,
    @Body() body: { reason?: string; visitorId?: string },
    @Req() req: Request,
  ) {
    const visitorId =
      (body?.visitorId ? sanitizeString(body.visitorId, 100) : null) ??
      readVisitorIdFromRequest(req);
    return this.commerce.respondToQuoteByToken(token, 'reject', body?.reason, visitorId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/quotes')
  createQuote(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactId: string;
      items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      expiryDate?: string;
    },
  ) {
    return this.commerce.createQuote({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/quotes/:quoteId')
  updateQuote(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Body() body: {
      contactId?: string;
      items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      expiryDate?: string | null;
    },
  ) {
    return this.commerce.updateQuote({ quoteId, businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('businesses/:businessId/quotes/:quoteId')
  deleteQuote(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
  ) {
    return this.commerce.deleteQuote(quoteId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/quotes/:quoteId/convert')
  convertQuoteToInvoice(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Body() body: {
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED';
      discountValue?: number;
      notes?: string;
      dueDate?: string;
    },
  ) {
    return this.commerce.convertQuoteToInvoice({ quoteId, businessId, ...body });
  }

  // ========== GMAIL INTEGRATION ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/gmail/auth-url')
  getGmailAuthUrl(@Param('businessId') businessId: string) {
    const url = this.gmail.getAuthUrl(businessId);
    return { url };
  }

  @Get('gmail/callback')
  async handleGmailCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = appUrl();
    
    const parsedState = this.gmail.verifyState(state);
    if (!parsedState) {
      return res.redirect(`${frontendUrl}/app/commerce?gmail=error&reason=invalid_state`);
    }

    try {
      await this.gmail.saveGmailCredentials(parsedState.businessId, code);
      return res.redirect(`${frontendUrl}/app/commerce?gmail=success`);
    } catch {
      return res.redirect(`${frontendUrl}/app/commerce?gmail=error`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/gmail/status')
  getGmailStatus(@Param('businessId') businessId: string) {
    return this.gmail.getGmailStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('businesses/:businessId/gmail')
  disconnectGmail(@Param('businessId') businessId: string) {
    return this.gmail.disconnectGmail(businessId);
  }

  // ----- Gmail full inbox -----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/gmail/threads')
  listGmailThreads(
    @Param('businessId') businessId: string,
    @Query('q') q?: string,
    @Query('label') label?: string,
    @Query('maxResults') maxResults?: string,
    @Query('pageToken') pageToken?: string,
  ) {
    return this.gmail.listThreads(businessId, {
      q,
      labelIds: label ? [label] : undefined,
      maxResults: maxResults ? Number.parseInt(maxResults, 10) : undefined,
      pageToken,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/gmail/threads/:threadId')
  getGmailThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.gmail.getThread(businessId, threadId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/gmail/labels')
  listGmailLabels(@Param('businessId') businessId: string) {
    return this.gmail.listLabels(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/gmail/messages/:messageId/:action')
  modifyGmailMessage(
    @Param('businessId') businessId: string,
    @Param('messageId') messageId: string,
    @Param('action') action: string,
  ) {
    switch (action) {
      case 'read':
        return this.gmail.markRead(businessId, messageId);
      case 'unread':
        return this.gmail.markUnread(businessId, messageId);
      case 'star':
        return this.gmail.star(businessId, messageId);
      case 'unstar':
        return this.gmail.unstar(businessId, messageId);
      case 'archive':
        return this.gmail.archive(businessId, messageId);
      case 'trash':
        return this.gmail.trash(businessId, messageId);
      case 'untrash':
        return this.gmail.untrash(businessId, messageId);
      default:
        throw new Error(`Unknown gmail message action: ${action}`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/gmail/messages/send')
  sendGmailMessage(
    @Param('businessId') businessId: string,
    @Body() body: { to: string; subject: string; htmlBody: string },
  ) {
    return this.gmail.sendEmail({
      businessId,
      to: body.to,
      subject: body.subject,
      htmlBody: body.htmlBody,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/gmail/threads/:threadId/reply')
  replyGmailThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Body() body: { inReplyTo: string; to: string; subject: string; htmlBody: string },
  ) {
    return this.gmail.sendReply({
      businessId,
      threadId,
      inReplyTo: body.inReplyTo,
      to: body.to,
      subject: body.subject,
      htmlBody: body.htmlBody,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/quotes/:quoteId/send-email')
  async sendQuoteEmail(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Body() body: { recipientEmail: string; message?: string },
  ) {
    const existing = await this.commerce.getQuote(quoteId);
    if (!existing || existing.businessId !== businessId) {
      throw new Error('Quote not found');
    }

    // Transition to SENT *before* composing the email so the public
    // accept/reject viewToken is minted and present in the URL we send.
    // Without this, draft → first-send would email a `/quote/{id}` link
    // that the public endpoint can't resolve.
    if (existing.status === 'DRAFT') {
      await this.commerce.updateQuoteStatus({
        quoteId,
        status: 'SENT',
        actorId: undefined,
      });
    }
    const quote = await this.commerce.getQuote(quoteId);
    if (!quote) {
      throw new Error('Quote not found');
    }

    const business = quote.business;
    const contact = quote.contact;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000';

    if (!quote.viewToken) {
      throw new Error('Quote view token missing — cannot send email.');
    }

    const emailHtml = buildQuoteEmailHtml({
      businessName: business.name,
      businessLogo: business.logoUrl,
      businessEmail: business.email,
      businessPhone: business.phone,
      businessAddress: business.address,
      businessWebsite: business.website,
      primaryColor: business.primaryColor || '#F97316',
      contactName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Customer' : 'Customer',
      quoteNumber: quote.quoteNumber,
      quoteDate: new Date(quote.createdAt).toLocaleDateString('en-TT', { dateStyle: 'medium' }),
      expiryDate: quote.expiryDate ? new Date(quote.expiryDate).toLocaleDateString('en-TT', { dateStyle: 'medium' }) : null,
      items: quote.items.map((item: { description: string; quantity: number; unitPrice: number }) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      subtotal: quote.subtotal,
      taxRate: quote.taxRate,
      taxAmount: quote.taxAmount,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      discountAmount: quote.discountAmount,
      total: quote.total,
      currency: quote.currency,
      notes: quote.notes,
      quoteUrl: `${appUrl}/quote/${quote.viewToken}`,
      customMessage: body.message,
    });

    await this.gmail.sendEmail({
      businessId,
      to: body.recipientEmail,
      subject: `Quote #${quote.quoteNumber} from ${business.name}`,
      htmlBody: emailHtml,
    });

    return { success: true, quote };
  }

  // ========== INVOICE EMAIL / REMINDER / RECEIPT ==========

  /**
   * Build the standardized public invoice URL (uses payment-link token if
   * available, falls back to the invoice id under the same /public/invoice
   * path so the frontend has one canonical place to render).
   */
  private async buildPublicInvoiceUrl(invoiceId: string, businessId: string): Promise<string | null> {
    // createPaymentLink throws for PAID/VOID invoices; for those (e.g. the
    // resend-receipt flow) we still want to surface the previously-issued
    // token so the customer can revisit the invoice page. Only the known
    // "paid or voided" refusal is swallowed — other failures bubble up.
    try {
      const link = await this.commerce.createPaymentLink(invoiceId, businessId);
      return `${appUrl()}/public/invoice/${link.token}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/paid or voided/i.test(msg)) throw err;
      const existing = await this.commerce.findAnyPaymentLink(invoiceId, businessId);
      return existing ? `${appUrl()}/public/invoice/${existing.token}` : null;
    }
  }

  private buildInvoiceEmailContext(
    invoice: InvoiceForEmail,
    paymentUrl: string | null,
    customMessage?: string | null,
    variant: 'invoice' | 'reminder' | 'receipt' = 'invoice',
  ) {
    const business = invoice.business;
    const contact = invoice.contact;
    const paid = sumSuccessfulPayments(invoice.payments);
    return buildInvoiceEmailHtml({
      businessName: business?.name ?? 'Your business',
      businessLogo: business?.logoUrl,
      businessEmail: business?.email,
      businessPhone: business?.phone,
      primaryColor: business?.primaryColor || '#F97316',
      contactName: contact
        ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email || 'Customer'
        : 'Customer',
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
      amountPaid: paid,
      amountRemaining: Math.max(0, Number(invoice.total) - paid),
      currency: invoice.currency,
      notes: invoice.notes,
      invoiceUrl: paymentUrl,
      paymentUrl,
      customMessage: customMessage ?? null,
      variant,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/send-email')
  async sendInvoiceEmail(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: { recipientEmail?: string; message?: string },
    @Req() req: any,
  ) {
    // Allow drafts: sending the email is precisely what transitions DRAFT -> SENT.
    const invoice = (await this.commerce.getInvoiceWithBusiness(invoiceId, false)) as
      | InvoiceForEmail
      | null;
    if (!invoice || invoice.businessId !== businessId) throw new ForbiddenException('Invoice not found');
    if (invoice.status === 'VOID') throw new ForbiddenException('Cannot email a voided invoice');
    const recipient = body.recipientEmail || invoice.contact?.email;
    if (!recipient) throw new ForbiddenException('Recipient email is required');
    const paymentUrl = await this.buildPublicInvoiceUrl(invoiceId, businessId);
    const html = this.buildInvoiceEmailContext(invoice, paymentUrl, body.message, 'invoice');
    const send = await this.gmail.sendEmail({
      businessId,
      to: recipient,
      subject: `Invoice #${invoice.invoiceNumber} from ${invoice.business?.name ?? 'us'}`,
      htmlBody: html,
    });
    if (invoice.status === 'DRAFT') {
      await this.commerce.updateInvoiceStatus({
        invoiceId,
        status: 'SENT',
        actorId: req?.user?.id,
        sentAt: new Date(),
      });
    }
    return { success: true, messageId: send.messageId, paymentUrl };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/send-reminder')
  async sendInvoiceReminder(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: { recipientEmail?: string; message?: string; channel?: 'email' | 'whatsapp' | 'manual' },
    @Req() req: any,
  ) {
    return this.commerce.sendInvoiceReminder({
      invoiceId,
      businessId,
      actorId: req?.user?.id,
      customMessage: body.message,
      channel: body.channel,
      deliver: async ({ invoice, recipientEmail, paymentUrl }) => {
        const channel = body.channel ?? (recipientEmail ? 'email' : 'manual');
        if (channel !== 'email') return { delivered: false };
        const target = body.recipientEmail || recipientEmail;
        if (!target) return { delivered: false };
        const html = this.buildInvoiceEmailContext(invoice, paymentUrl, body.message, 'reminder');
        const result = await this.gmail.sendEmail({
          businessId,
          to: target,
          subject: `Reminder: Invoice #${invoice.invoiceNumber} — payment due`,
          htmlBody: html,
        });
        return { delivered: true, messageId: result.messageId };
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/resend-receipt')
  async resendInvoiceReceipt(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: { recipientEmail?: string },
    @Req() req: any,
  ) {
    // Receipts are only meaningful for paid invoices; explicit guard.
    const invoice = (await this.commerce.getInvoiceWithBusiness(invoiceId, false)) as
      | InvoiceForEmail
      | null;
    if (!invoice || invoice.businessId !== businessId) throw new ForbiddenException('Invoice not found');
    if (invoice.status !== 'PAID') throw new ForbiddenException('Invoice is not yet paid');
    const recipient = body.recipientEmail || invoice.contact?.email;
    if (!recipient) throw new ForbiddenException('Recipient email is required');
    const paymentUrl = await this.buildPublicInvoiceUrl(invoiceId, businessId);
    const html = this.buildInvoiceEmailContext(invoice, paymentUrl, null, 'receipt');
    const send = await this.gmail.sendEmail({
      businessId,
      to: recipient,
      subject: `Receipt for Invoice #${invoice.invoiceNumber}`,
      htmlBody: html,
    });
    await this.commerce.recordReceiptSent({
      invoiceId,
      businessId,
      channel: 'email',
      recipientEmail: recipient,
      messageId: send.messageId,
      actorId: req?.user?.id,
    });
    return { success: true, messageId: send.messageId };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/invoices/:invoiceId/timeline')
  getInvoiceTimeline(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commerce.getInvoiceTimeline(invoiceId, businessId);
  }

  // Public viewer for /public/invoice/[token] — records a `invoice.viewed`
  // event on first view so the timeline / dunning logic can react.
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(60, 60_000)
  @Get('public/invoice-link/:token')
  async getPublicInvoiceByToken(@Param('token') token: string) {
    const link = await this.commerce.getPaymentLinkByToken(token);
    if (!link) return { ok: false, reason: 'invalid_or_expired' };
    const invoice = (await this.commerce.getInvoiceWithBusiness(link.invoiceId, true)) as
      | InvoiceForEmail
      | null;
    if (!invoice) return { ok: false, reason: 'not_found' };
    if (invoice.contactId) {
      // Best-effort, fire-and-forget so a transient CRM failure doesn't break
      // the public view.
      this.commerce
        .recordInvoiceView(invoice.id, invoice.businessId, invoice.contactId)
        .catch(() => undefined);
    }
    return {
      ok: true,
      token: link.token,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        total: invoice.total,
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes,
        items: invoice.items,
        contact: invoice.contact ? { firstName: invoice.contact.firstName, lastName: invoice.contact.lastName } : null,
        business: invoice.business ? { name: invoice.business.name, logoUrl: invoice.business.logoUrl, primaryColor: invoice.business.primaryColor, email: invoice.business.email, phone: invoice.business.phone } : null,
      },
    };
  }

  // ========== PARTIAL PAYMENTS ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/invoices/:invoiceId/payments')
  listPayments(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commerce.listPayments(invoiceId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/payments')
  recordPayment(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: {
      amount: number;
      method: string;
      reference?: string;
      notes?: string;
      evidenceUrl?: string;
      evidenceMimeType?: string;
    },
  ) {
    return this.commerce.recordPayment(invoiceId, businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/payments/from-evidence')
  recordPaymentFromEvidence(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: {
      evidenceUrl: string;
      evidenceMimeType: string;
      filename: string;
      source: 'drive' | 'upload';
      driveFileId?: string;
    },
  ) {
    return this.paymentEvidence.processEvidence({
      businessId,
      invoiceId,
      ...body,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/payments/extract-evidence')
  async extractPaymentEvidence(
    @Param('businessId') businessId: string,
    @Body() body: {
      evidenceUrl: string;
      evidenceMimeType: string;
      filename: string;
      source: 'drive' | 'upload';
      driveFileId?: string;
    },
  ) {
    const { extracted, raw } = await this.paymentEvidence.extractEvidence({
      businessId,
      ...body,
    });

    // Fetch unpaid invoices as candidates
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      include: {
        contact: true,
        payments: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    // Compute remaining balance for each invoice
    const candidates = invoices.map((inv) => {
      const paid = (inv.payments ?? [])
        .filter((p: any) => p.status === 'SUCCESSFUL')
        .reduce((s: number, p: any) => s + (p.amount ?? 0), 0);
      const remaining = Math.max(0, Number(inv.total) - paid);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        total: Number(inv.total),
        remaining,
        currency: inv.currency,
        status: inv.status,
        contactName: inv.contact
          ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || 'Unknown'
          : 'Unknown',
        dueDate: inv.dueDate,
      };
    });

    // Sort candidates by match score (amount proximity + name match)
    if (extracted) {
      candidates.sort((a, b) => {
        const scoreA = this.candidateScore(a, extracted);
        const scoreB = this.candidateScore(b, extracted);
        return scoreB - scoreA;
      });
    }

    return {
      extracted,
      candidates: candidates.slice(0, 10),
      raw,
    };
  }

  private candidateScore(
    candidate: { remaining: number; contactName: string },
    extracted: { amount: number; payer?: string },
  ): number {
    let score = 0;
    // Amount proximity: exact match = 100, within 10% = 50, within 50% = 20
    const amtDiff = Math.abs(candidate.remaining - extracted.amount);
    if (amtDiff < 0.01) score += 100;
    else if (amtDiff / Math.max(candidate.remaining, extracted.amount) < 0.1) score += 50;
    else if (amtDiff / Math.max(candidate.remaining, extracted.amount) < 0.5) score += 20;

    // Name match
    if (extracted.payer && candidate.contactName !== 'Unknown') {
      const payerLower = extracted.payer.toLowerCase();
      const nameLower = candidate.contactName.toLowerCase();
      if (nameLower.includes(payerLower) || payerLower.includes(nameLower)) score += 30;
    }

    return score;
  }

  // ========== CAMPAIGN REVENUE ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/campaigns/:campaignId/revenue')
  getCampaignRevenue(
    @Param('businessId') businessId: string,
    @Param('campaignId') campaignId: string,
  ) {
    return this.commerce.getCampaignRevenue(businessId, campaignId);
  }

  // ========== PAYMENTS (BUSINESS-SCOPED) ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/payments')
  listAllPayments(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('provider') provider?: string,
    @Query('contactId') contactId?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.commerce.listAllPayments(businessId, {
      status,
      method,
      provider,
      contactId,
      minAmount: minAmount ? Number(minAmount) : undefined,
      maxAmount: maxAmount ? Number(maxAmount) : undefined,
      from,
      to,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/payments/:paymentId/refund')
  refundPayment(
    @Param('businessId') businessId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: { reason?: string },
  ) {
    return this.commerce.markPaymentRefunded(paymentId, businessId, body?.reason);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/payments/:paymentId/retry')
  retryPayment(
    @Param('businessId') businessId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.commerce.retryPayment(paymentId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/receipt/resend')
  resendReceipt(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commerce.markReceiptSent(invoiceId, businessId);
  }

  // ========== PAYMENT LINKS ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/payment-link')
  createPaymentLink(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: { expiresInDays?: number },
  ) {
    return this.commerce.createPaymentLink(invoiceId, businessId, body.expiresInDays);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/payment-links')
  listPaymentLinks(@Param('businessId') businessId: string) {
    return this.commerce.listPaymentLinks(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('businesses/:businessId/payment-links/:id')
  deactivatePaymentLink(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commerce.deactivatePaymentLink(id, businessId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Get('payment-links/:token')
  getPaymentLinkByToken(@Param('token') token: string) {
    return this.commerce.getPaymentLinkByToken(token);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(10, 60_000)
  @Post('invoices/:invoiceId/payment-intent')
  recordPublicPaymentIntent(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { method: string; amount?: number },
  ) {
    const method = sanitizeString(body?.method ?? '', 50) ?? '';
    const amount =
      typeof body?.amount === 'number' && Number.isFinite(body.amount) && body.amount >= 0
        ? body.amount
        : undefined;
    return this.commerce.recordPublicPaymentIntent(invoiceId, method, amount);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/store/readiness')
  getStoreReadiness(@Param('businessId') businessId: string) {
    return this.storeReadiness.getReadiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/store/graph')
  getStoreGraph(@Param('businessId') businessId: string) {
    return this.storeReadiness.buildStoreGraph(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/store/backfill-links')
  backfillStoreLinks(@Param('businessId') businessId: string) {
    return this.storeReadiness.runBackfillIfNeeded(businessId);
  }
}

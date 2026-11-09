import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Logger, NotFoundException, Optional, Param, Patch, Post, Query, Req, Res, SetMetadata, UseGuards, UseInterceptors, UploadedFile, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { InvoiceFromTimeDto } from './dto/invoice-from-time.dto';
import { TimeEntryService } from '../time-tracking/time-entry.service';
import { CommerceService, OPERATOR_INVOICE_CONTACT_SELECT, OPERATOR_QUOTE_CONTACT_SELECT } from './commerce.service';
import { CommerceVisionService } from './commerce-vision.service';
import { StoreReadinessService } from './store-readiness.service';
import { PaymentEvidenceService } from './payment-evidence.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { GuardedBusinessId } from '../../core/auth/request-business-id';
import { appUrl } from '../../core/config/runtime-urls';
import { TeamAuditInterceptor, AuditAction, AuditOncePerEntity } from '../../core/interceptors/team-audit.interceptor';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ConvertQuoteDto, CreateQuoteDto, UpdateQuoteDto } from './dto/create-quote.dto';
import { AllowPlanLimitReplay, PlanLimitGuard, RequirePlanLimit, deferredPlanLimitDenial } from '../subscriptions/plan-limit.guard';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';
import { sanitizeString } from '../../core/utils/sanitize';
import { readVisitorIdFromRequest } from '../../core/utils/visitor-cookie';
import { BulkProductsDto } from './dto/bulk-products.dto';
import { InvoiceReceiptBuilderService, isSettledForReceiptEmail, ownTenantReceiptBalance } from './invoice-receipt-builder.service';
import { GmailService } from './gmail.service';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ConfirmPendingPaymentDto } from './dto/confirm-pending-payment.dto';
import { buildQuoteEmailHtml } from './quote-email.template';
import { assertQuoteStatusAgreement } from './quote-workflow';
import { buildInvoiceEmailHtml, emailLineItems } from './invoice-email.template';
import type { InvoiceForEmail } from './invoice-email.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SKIP_BUSINESS_EVENT_KEY } from '../business-events/business-event.interceptor';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BUSINESS_PROFILE_OWNER_ONLY, FinanceSettingsService } from '../finance/finance-settings.service';

/** R0-09g (owner ruling D-11): the refusal a non-owner's document-templates PATCH answers. */
const DOCUMENT_TEMPLATES_OWNER_ONLY_MESSAGE = 'Only the business owner can change the document templates.';

/**
 * R0-27: the global ValidationPipe's options, with the metatype bound
 * explicitly. The global pipe finds the DTO through tsc-emitted
 * `design:paramtypes`, which esbuild (vitest, tsx) does not emit, so there the
 * body went through unvalidated. `expectedType` makes the create contract the
 * same wherever the controller runs; on the built app the body is validated
 * twice with identical options, which is idempotent.
 */
const CREATE_INVOICE_BODY_PIPE = new ValidationPipe({ whitelist: true, transform: true, expectedType: CreateInvoiceDto });

/**
 * V1-53: the quote create, edit and convert bodies, bound the same way (see
 * CREATE_INVOICE_BODY_PIPE) so the DTO contract holds wherever the controller
 * runs.
 */
const CREATE_QUOTE_BODY_PIPE = new ValidationPipe({ whitelist: true, transform: true, expectedType: CreateQuoteDto });
const UPDATE_QUOTE_BODY_PIPE = new ValidationPipe({ whitelist: true, transform: true, expectedType: UpdateQuoteDto });
const CONVERT_QUOTE_BODY_PIPE = new ValidationPipe({ whitelist: true, transform: true, expectedType: ConvertQuoteDto });

/**
 * V1-41b: the pending-payment confirm body, bound the same way (see
 * CREATE_INVOICE_BODY_PIPE), so the whitelist drops every field but `amount`
 * wherever the controller runs.
 */
const CONFIRM_PENDING_PAYMENT_BODY_PIPE = new ValidationPipe({ whitelist: true, transform: true, expectedType: ConfirmPendingPaymentDto });

type OperatorQuoteContactKey = keyof typeof OPERATOR_QUOTE_CONTACT_SELECT;

/**
 * R28-ST-01: the HTTP body of a quote status change. The service returns the
 * quote with its whole Contact row (`include: { contact: true }`, which the
 * quote.sent listener needs for the customer's email and phone), and the
 * route handed that row back: a revenue:write member with no CRM access
 * received a PRIVATE contact's internal notes, phone, owner and visibility.
 * The body now carries only the customer fields the operator quote detail
 * discloses; a quote without a loaded contact passes through unchanged.
 */
function toQuoteStatusResponse<Q extends { contact?: Record<OperatorQuoteContactKey, unknown> | null }>(quote: Q) {
  const contact = quote.contact;
  if (!contact) return quote;
  const keys = Object.keys(OPERATOR_QUOTE_CONTACT_SELECT) as OperatorQuoteContactKey[];
  return {
    ...quote,
    contact: Object.fromEntries(keys.map((key) => [key, contact[key]])) as Pick<NonNullable<Q['contact']>, OperatorQuoteContactKey>,
  };
}

/**
 * The contact keys an invoice write response carries: the operator invoice
 * read's customer fields (OPERATOR_INVOICE_CONTACT_SELECT), plus `id` and
 * `businessId`, which repeat the invoice's own `contactId` and the path tenant
 * and so disclose nothing new (the edit form's own-tenant check reads them).
 */
type InvoiceWriteContactKey = 'id' | 'businessId' | keyof typeof OPERATOR_INVOICE_CONTACT_SELECT;
const INVOICE_WRITE_CONTACT_KEYS: readonly InvoiceWriteContactKey[] = [
  'id',
  'businessId',
  ...(Object.keys(OPERATOR_INVOICE_CONTACT_SELECT) as Array<keyof typeof OPERATOR_INVOICE_CONTACT_SELECT>),
];

/**
 * R0-CMF1 review SEC-CMF1-2 (the R28-ST-01 class, for invoices): the HTTP body
 * of an invoice write. markInvoicePaid, updateInvoiceStatus (through the
 * workflow transition) and updateInvoice return the invoice with its whole
 * Contact row, which the invoice listeners need, and the routes handed it
 * back: a revenue:write member with no CRM access received a PRIVATE contact's
 * internal notes, phone, owner and visibility. The body now carries only the
 * customer fields the operator invoice detail discloses; an invoice without a
 * loaded contact passes through unchanged.
 *
 * R0-02 review SEC-R002-3 (R0-SEC3-INVOICE-WRITE-PROJECTION): the same
 * returns carry the whole linked Booking row (markInvoicePaid reloads, and
 * InvoiceWorkflowService.transition updates, with `booking: true`, which the
 * invoice listeners need), so a revenue:write member with no bookings scope
 * read the booking's notes, location, calendarEventId, staffId and orgUnitId.
 * The operator invoice read (OPERATOR_INVOICE_INCLUDE) carries no booking, so
 * the body drops the relation on every write route, whether or not a contact
 * was loaded.
 */
function toInvoiceWriteResponse<I extends { contact?: Record<InvoiceWriteContactKey, unknown> | null; booking?: unknown }>(
  invoice: I,
) {
  const rest = Object.fromEntries(Object.entries(invoice).filter(([key]) => key !== 'booking')) as Omit<I, 'booking'>;
  const contact = rest.contact;
  if (!contact) return rest;
  return {
    ...rest,
    contact: Object.fromEntries(INVOICE_WRITE_CONTACT_KEYS.map((key) => [key, contact[key]])) as Pick<
      NonNullable<I['contact']>,
      InvoiceWriteContactKey
    >,
  };
}

/**
 * The contact keys a quote create or edit response carries: the operator
 * quote detail's customer fields (OPERATOR_QUOTE_CONTACT_SELECT), plus `id`
 * and `businessId`, which repeat the quote's own `contactId` and the path
 * tenant and so disclose nothing new (as on invoice writes).
 */
type QuoteWriteContactKey = 'id' | 'businessId' | OperatorQuoteContactKey;
const QUOTE_WRITE_CONTACT_KEYS: readonly QuoteWriteContactKey[] = [
  'id',
  'businessId',
  ...(Object.keys(OPERATOR_QUOTE_CONTACT_SELECT) as OperatorQuoteContactKey[]),
];

/**
 * V1-53 review (SEC-V53-1, the R28-ST-01 / SEC-CMF1-2 class, for quote
 * create and edit): createQuote and updateQuote return the quote with its
 * whole Contact row (`include: { contact: true }`, which the quote.created and
 * quote.updated listeners read), and the routes handed it back: a
 * revenue:write member with no CRM access received a PRIVATE contact's
 * internal notes, phone, owner and visibility. The body now carries only
 * QUOTE_WRITE_CONTACT_KEYS; a quote without a contact (a legacy row whose
 * contact belongs to another tenant reads null) passes through unchanged.
 */
function toQuoteWriteResponse<Q extends { contact?: Record<QuoteWriteContactKey, unknown> | null }>(quote: Q) {
  const contact = quote.contact;
  if (!contact) return quote;
  return {
    ...quote,
    contact: Object.fromEntries(QUOTE_WRITE_CONTACT_KEYS.map((key) => [key, contact[key]])) as Pick<
      NonNullable<Q['contact']>,
      QuoteWriteContactKey
    >,
  };
}

/**
 * V1-45b-CREATE-IDEMPOTENCY-HTTP (owner ruling D-15; V1-45 review SEC-V45-2):
 * the create's Idempotency-Key header, read as SiteController's
 * checkoutIdempotencyKey reads it. The service trims it, treats a blank one as
 * none and refuses one longer than 255 characters (400).
 */
function createIdempotencyKeyHeader(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  return typeof raw === 'string' ? raw : undefined;
}

/** The request the keyed create routes read: the header, the acting member. */
type CreateRequest = { headers: Record<string, string | string[] | undefined>; user?: { id?: string } };

/**
 * V1-45b: what a create forwards for its key: the key and the acting member,
 * whose id is part of the key's request hash (SEC-V45-3: another member
 * presenting the same key is a 409).
 *
 * W3-D64-COMMERCE-CREATE (D-64; review CR-D6-3): the acting member is
 * forwarded with or without a key, so the service judges the contact by that
 * member's CRM view whether or not the optional header is sent. A request with
 * no key still forwards no key (no request hash is taken).
 */
function createIdempotency(req: CreateRequest): { idempotencyKey?: string; actorUserId?: string } {
  const idempotencyKey = createIdempotencyKeyHeader(req.headers['idempotency-key']);
  const actorUserId = req.user?.id;
  return idempotencyKey === undefined ? { actorUserId } : { idempotencyKey, actorUserId };
}

@Controller('commerce')
export class CommerceController {
  private readonly logger = new Logger(CommerceController.name);

  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(TimeEntryService) private readonly timeEntries: TimeEntryService,
    @Inject(InvoiceReceiptBuilderService) private readonly receipts: InvoiceReceiptBuilderService,
    @Inject(GmailService) private readonly gmail: GmailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceVisionService) private readonly vision: CommerceVisionService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(StoreReadinessService) private readonly storeReadiness: StoreReadinessService,
    @Inject(PaymentEvidenceService) private readonly paymentEvidence: PaymentEvidenceService,
    // R0-09g: the owner test the document-templates PATCH runs (R0-09f's
    // FinanceSettingsService.isProfileOwner; FinanceModule exports it and
    // CommerceModule imports FinanceModule, so the app always supplies it).
    // Optional only so the test modules that compose this controller for its
    // other routes keep resolving; the route fails closed without it.
    @Optional() @Inject(FinanceSettingsService) private readonly profileOwners?: FinanceSettingsService,
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

  /**
   * FOLLOW3-A1-D46-COMMERCE-WRITES (D-46, FOLLOW3-A2's rule): a platform
   * SUPER_ADMIN acts on a business's invoices, quotes and payments only with
   * the authority that business gave it. BusinessGuard and ModuleScopeGuard
   * both admit SUPER_ADMIN to every tenant and skip the module scope, and the
   * services behind the `businesses/:businessId` writes check no Membership,
   * so a SUPER_ADMIN who was not a member recorded payments, refunded,
   * bulk-voided, deleted, edited, converted quotes and minted payment links in
   * any business (F2 SA-01..SA-07). Every such handler calls this first: that
   * role needs a Membership in :businessId whose scope map (or, without one,
   * the role defaults) holds revenue:write, exactly ModuleScopeGuard's legacy
   * rule (as payments-ops.controller.ts, payment-evidence.service.ts and
   * undo.service.ts apply it). No membership answers 403 'Not authorized to
   * update this invoice' ('... quote'), the bare-id services' refusal; a
   * membership without revenue:write answers the guard's message. Refused
   * before any read or write, so a refused call leaves no row, posting,
   * Activity or BusinessEvent. Every other caller is unchanged and costs no
   * query (the guards already applied this rule to it). The guards are not
   * changed: that would rewrite RA-G4-13's guard half and QS-07, and refuse
   * SUPER_ADMIN on every other module. d46-write-routes.spec.ts lists every
   * revenue:write handler as calling this, exempt (with the reason) or
   * service-refused; a service-refused (bare-id) route's service applies this
   * same rule to its actor, membership and revenue:write both (review
   * SEC-A1-1, CommerceService.assertActorMayWriteRevenue).
   */
  private async assertSuperAdminMayWriteRevenue(
    req: { user?: { id?: string; role?: string } } | undefined,
    businessId: string,
    subject: 'invoice' | 'quote',
  ): Promise<void> {
    const user = req?.user;
    if (user?.role !== 'SUPER_ADMIN') return;
    const membership = user.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: user.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    if (!membership) throw new ForbiddenException(`Not authorized to update this ${subject}`);
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }

  /**
   * The products list the /book storefront calls (V1-23 projection, 404 for a
   * closed store). R0-SEC3 (review SEC-V123-1 / V23-CR-1): rate limited with
   * the same guard and limit as CatalogController.listPublicProducts, which
   * serves the same rows; without it this route kept answering after the
   * catalog route was a 429.
   */
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
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
    return this.commerce.createProduct({ ...body, businessId });
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
    return this.commerce.updateProduct({ ...body, businessId, productId });
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
      } catch (err: any) {
        this.logger.warn(`Failed to import product "${p.name}":`, err);
        errors.push(p.name);
      }
    }
    return { created, count: created.length, errors, totalAttempted: validProducts.length };
  }

  /**
   * The tenant a bare-id route (no `:businessId` in the path) acts on.
   *
   * KF-REVENUE-AUTH-PROJECTION-001 review (ST-1, ST-2): `@GuardedBusinessId()`
   * is the same resolver BusinessGuard and ModuleScopeGuard ran, so the
   * handler cannot act on a tenant the guards did not check. It is `undefined`
   * only when no request field named a tenant; BusinessGuard already refuses
   * that for every ordinary user, and SUPER_ADMIN — who bypasses both guards —
   * is refused here for the same reason: a tenant that reaches the service as
   * `undefined` switches the invoice binding off. (The no-actor, no-tenant
   * service path is the deprecated webhook contract; see RA-G16-01.)
   */
  private requireGuardedTenant(businessId: string | undefined): string {
    if (!businessId) throw new ForbiddenException('businessId is required');
    return businessId;
  }

  // KF-REVENUE-AUTH-PROJECTION-001 (G4): these three bare-id routes carry no
  // :businessId param, so BusinessGuard resolves the tenant from the request
  // (params, then body, then query). The guard proves the caller belongs to
  // THAT tenant; it does not constrain which invoice the service touches, so
  // the same tenant is forwarded and bound in the service. Every other write
  // on this controller already requires revenue:write — these did not, so a
  // read-only member could mark paid.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('invoices/:invoiceId/paid')
  async markInvoicePaid(
    @GuardedBusinessId() businessId: string | undefined,
    @Param('invoiceId') invoiceId: string,
    @Req() req: any,
  ) {
    // SEC-CMF1-2: the contact is projected (see toInvoiceWriteResponse).
    return toInvoiceWriteResponse(await this.commerce.markInvoicePaid(invoiceId, req?.user?.id, this.requireGuardedTenant(businessId)));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('invoices/:invoiceId/payment-failed')
  async markInvoicePaymentFailed(
    @GuardedBusinessId() businessId: string | undefined,
    @Param('invoiceId') invoiceId: string,
    @Req() req: any,
    @Body() body: { reason?: string },
  ) {
    return toInvoiceWriteResponse(
      await this.commerce.markInvoicePaymentFailed(invoiceId, req?.user?.id, body?.reason, this.requireGuardedTenant(businessId)),
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('invoices/:invoiceId/status/:status')
  async updateInvoiceStatus(
    @GuardedBusinessId() businessId: string | undefined,
    @Param('invoiceId') invoiceId: string,
    @Param('status') status: string,
    @Req() req: any,
    @Body() body: UpdateInvoiceStatusDto,
  ) {
    // G1: the status comes from the validated body (IsIn SENT/OVERDUE/VOID),
    // never from the URL. The URL used to win, so `/status/paid` reached the
    // state machine with no payment behind it. A path that disagrees with the
    // body is a malformed request, refused before any service call.
    if (status.toUpperCase() !== body.status) {
      throw new BadRequestException('status mismatch: the URL status and the body status disagree');
    }
    return toInvoiceWriteResponse(
      await this.commerce.updateInvoiceStatus({
        invoiceId,
        status: body.status,
        actorId: req?.user?.id,
        sentAt: body?.sentAt,
        dueDate: body?.dueDate,
        businessId: this.requireGuardedTenant(businessId),
      }),
    );
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

  /**
   * R0-09g-D11-DOCUMENT-TEMPLATES, owner ruling D-11 (editing the business
   * profile is OWNER only, regardless of granted scopes; found by the R0-09f
   * static sweep): Business.invoiceTemplate and quoteTemplate are fields of the
   * owner-only profile PATCH (UpdateBusinessDto), and they are all this route
   * writes, so it is OWNER only as a whole: a non-owner — STAFF or ADMIN,
   * revenue:write or settings:write included — is refused 403
   * BUSINESS_PROFILE_OWNER_ONLY before the body is read or anything is written.
   *
   * The owner test is FinanceSettingsService.isProfileOwner (R0-09f): the OWNER
   * membership or the distinguished owner (Business.ownerId), the two arms
   * IdentityService.assertBusinessOwner and BusinessGuard admit an owner by,
   * plus the SUPER_ADMIN bypass BusinessGuard grants. Without it the route
   * refuses everyone (fails closed). The route carries AuthGuard and
   * BusinessGuard but not ModuleScopeGuard, as the Gmail connect routes below
   * (R0-CMF5): a revenue scope admits no one the owner rule refuses, and
   * ModuleScopeGuard would refuse a distinguished owner with no membership row.
   * GET .../document-templates above stays open to every member.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/document-templates')
  async setDocumentTemplate(
    @Param('businessId') businessId: string,
    @Body() body: { invoiceTemplate?: 'classic' | 'modern' | 'minimal'; quoteTemplate?: 'classic' | 'modern' | 'minimal' },
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    const owners = this.profileOwners;
    if (!owners || !(await owners.isProfileOwner(businessId, req?.user))) {
      throw new ForbiddenException({ code: BUSINESS_PROFILE_OWNER_ONLY, message: DOCUMENT_TEMPLATES_OWNER_ONLY_MESSAGE });
    }
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

  // R0-QI-01: the operator app's invoice detail and edit pages read this
  // tenant-bound route, not the public bare-id route below (which keeps its
  // shareable gate and viewer-aware shape for the customer pay page, RCR-01).
  // The tenant is the path param the guards admitted; the service binds the
  // read to it, so a cross-tenant id answers like an unknown one.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/invoices/:invoiceId')
  async getInvoiceDetail(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    const invoice = await this.commerce.getInvoiceForBusiness(invoiceId, businessId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'invoice_created', 'invoice')
  @RequirePlanLimit('invoices')
  /**
   * Invoice everything unbilled on a project.
   *
   * Lives in commerce rather than time-tracking so the module edge points
   * downward: TimeTrackingModule is a leaf (`imports: [PrismaModule]`) and does
   * not import commerce, so commerce -> time-tracking closes no cycle. The
   * reverse would have needed a forwardRef, and this server already carries 68
   * of those.
   *
   * The service takes `createInvoice` as an argument rather than injecting
   * CommerceService, which is what keeps time-tracking a leaf at all.
   */
  @Post('businesses/:businessId/invoices/from-time')
  async invoiceUnbilledTime(
    @Param('businessId') businessId: string,
    @Body() body: InvoiceFromTimeDto,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    // W3-D64-COMMERCE-CREATE (D-64; review CR-D6-1 restored): the invoice is
    // created for the acting member, so the contact must be one they may open.
    const actorUserId = req?.user?.id;
    return this.timeEntries.invoiceUnbilledTime(businessId, {
      projectId: body.projectId,
      contactId: body.contactId,
      currency: body.currency,
      dueDate: body.dueDate,
      taxRate: body.taxRate,
      notes: body.notes,
      createInvoice: (args) => this.commerce.createInvoice({ ...args, actorUserId }),
    });
  }

  // This is the PRIMARY invoice-creation endpoint and it carried no decorators
  // at all: no authentication, no tenant check, no scope, no plan limit — while
  // `invoiceProject` directly above and every other write on this controller
  // carry the full set. Anyone who could reach the API could mint an invoice
  // against any businessId, and because PlanLimitGuard was absent here, the
  // `invoices` plan limit enforced elsewhere could be bypassed by calling this
  // route instead. Decorators match `invoiceProject` deliberately.
  //
  // V1-45b (D-15; V1-45 review SEC-V45-2, SEC-V45-3): the Idempotency-Key
  // header is forwarded with the acting member, so the same key and body from
  // the same member answer the invoice the first request created. A replay is
  // audited once (AuditOncePerEntity) and, at the plan's invoice limit, answers
  // the existing invoice instead of the guard's 403 (AllowPlanLimitReplay).
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'invoice_created', 'invoice')
  @AuditOncePerEntity()
  @RequirePlanLimit('invoices')
  @AllowPlanLimitReplay()
  @Post('businesses/:businessId/invoices')
  async createInvoice(
    @Param('businessId') businessId: string,
    @Body(CREATE_INVOICE_BODY_PIPE) body: CreateInvoiceDto,
    @Req() req: CreateRequest,
  ) {
    const idempotency = createIdempotency(req);
    // V1-45b: at the plan limit, PlanLimitGuard let a keyed request through
    // with its refusal attached. Only a key that already created an invoice
    // here is answered (the service then replays it, or 409s a different
    // request); anything else is refused as the guard would have.
    const planLimitDenial = deferredPlanLimitDenial(req);
    if (planLimitDenial && !(await this.createSlotUsed(businessId, 'invoice', idempotency.idempotencyKey))) throw planLimitDenial;
    // R0-27: the body is a validated DTO (it was an inline type the
    // ValidationPipe could not see), and only its declared fields are
    // forwarded. The service computes subtotal, tax, discount and total; the
    // tenant is the guarded path param, never a body field.
    const invoice = await this.commerce.createInvoice({
      businessId,
      contactId: body.contactId,
      items: body.items.map(({ description, quantity, unitPrice, productId }) => ({ description, quantity, unitPrice, productId })),
      currency: body.currency,
      dueDate: body.dueDate,
      taxRate: body.taxRate,
      discountType: body.discountType,
      discountValue: body.discountValue,
      notes: body.notes,
      ...idempotency,
    });
    // V1-45b review SEC-V45b-2 (the SEC-CMF1-2 class): the service answers a
    // create, and a keyed replay, with the whole Contact row as it stands now;
    // the body carries only the projected contact, as every other invoice
    // write does (the quote create twin uses toQuoteWriteResponse).
    return toInvoiceWriteResponse(invoice);
  }

  /**
   * V1-45b: whether the key already created a document of this kind in this
   * business: its completed slot on idempotency_keys, named as
   * CommerceService's createClaim names it ('commerce.<kind>.create:<key>').
   * A create commits its document and its slot together, so a completed slot
   * means the create would answer (or 409), never write.
   */
  private async createSlotUsed(businessId: string, kind: 'invoice' | 'quote', key: string | undefined): Promise<boolean> {
    const trimmed = key?.trim();
    if (!trimmed) return false;
    const slot = await this.prisma.client.idempotencyKey.findUnique({
      where: { businessId_idempotencyKey: { businessId, idempotencyKey: `commerce.${kind}.create:${trimmed}` } },
      select: { status: true },
    });
    return slot?.status === 'completed';
  }

  // R0-28 (M21, CF-15 authorization half): this bare-id write ran AuthGuard and
  // BusinessGuard only, so a revenue:read member (or the STAFF default, or
  // revenue:none) sent, accepted or rejected quotes; and the handler dropped
  // the tenant the guards checked, so the service looked the quote up by id
  // alone. It now requires revenue:write like every other revenue write, and
  // forwards the guard-resolved tenant (same resolver as the guards, as on the
  // invoice status route) for the service to bind: a foreign id answers like
  // an unknown one. Path and `{ businessId }` body are unchanged for the web
  // client. No state machine here: transitions are V1-50 (D-04). The 200 body
  // is projected (R28-ST-01): the quote, with only the operator contact fields.
  // V1-QUOTE-CHAIN-finish (QSM-15): a body `status` that disagrees with the
  // path is a 400 quote_status_mismatch before anything is read, so a request
  // never does something other than what its body says (the web client sends
  // only `{ businessId }`, which passes). The body is bound to no DTO, so the
  // global ValidationPipe strips nothing from it.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('quotes/:quoteId/status/:status')
  async updateQuoteStatus(
    @GuardedBusinessId() businessId: string | undefined,
    @Param('quoteId') quoteId: string,
    @Param('status') status: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: any,
  ) {
    const tenant = this.requireGuardedTenant(businessId);
    assertQuoteStatusAgreement(status, body?.status);
    try {
      this.logger.log(`Updating quote ${quoteId} to status ${status} by user ${req?.user?.id}`);
      const result = await this.commerce.updateQuoteStatus({
        quoteId,
        status: status.toUpperCase() as UpdateQuoteStatusDto['status'],
        actorId: req?.user?.id,
        businessId: tenant,
      });
      this.logger.log(`Quote ${quoteId} status updated successfully`);
      return toQuoteStatusResponse(result);
    } catch (error: any) {
      this.logger.error(`Failed to update quote status: ${error?.message}`, error?.stack);
      throw error;
    }
  }

  // G7: the receipt is bound to the guard's tenant and revenue:read is the
  // mandatory floor; an explicit revenue:none is refused. The tenant is the
  // one the guards resolved (ST-1): reading `@Query` here while the guards
  // read the body first let a GET with a JSON body pass the guards on one
  // tenant and fetch another's receipt.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('invoices/:invoiceId/receipt')
  async getReceipt(
    @GuardedBusinessId() businessId: string | undefined,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.receipts.buildReceipt(invoiceId, this.requireGuardedTenant(businessId));
  }

  // G5: the id-based detail route answers 404 for anything not shareable —
  // the same answer as an unknown id — and otherwise serves the shape the
  // caller is entitled to: the full operator shape to an operator of the
  // invoice's business (RCR-01: the operator app's detail and edit pages load
  // this route with the operator's token), the public projection (no payment
  // rows, no customer email, no private business fields) to everyone else.
  // Rate limited like the sibling status route (ST-4): this is the richer
  // disclosure surface and the natural id-enumeration target, and the
  // integration harness does not install the global express limiter.
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Get('invoices/:invoiceId')
  async getInvoice(@Param('invoiceId') invoiceId: string, @Req() req: { user?: { id?: string; role?: string } }) {
    const view = await this.commerce.getInvoiceForViewer(invoiceId, req?.user);
    if (!view) throw new NotFoundException('Invoice not found');
    return view;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/invoices/bulk')
  async bulkUpdateInvoices(
    @Param('businessId') businessId: string,
    @Body() body: { ids: string[]; action: 'send' | 'void' | 'delete' },
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    return this.commerce.bulkUpdateInvoices(businessId, body.ids, body.action);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/quotes/bulk')
  async bulkUpdateQuotes(
    @Param('businessId') businessId: string,
    @Body() body: { ids: string[]; action: 'send' | 'reject' | 'delete' },
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    return this.commerce.bulkUpdateQuotes(businessId, body.ids, body.action);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('businesses/:businessId/invoices/:invoiceId')
  async deleteInvoice(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    return this.commerce.deleteInvoice(invoiceId, businessId);
  }

  // R0-CMF1-INVOICE-PATCH-ACTOR (R0-11 review ST-R011-1): the body is the
  // UpdateInvoiceDto, bound with `expectedType` for the same reason as
  // CREATE_INVOICE_BODY_PIPE, so unknown keys are stripped and `status` is
  // checked against PATCHABLE_INVOICE_STATUSES (400) wherever the controller
  // runs. A status change is attributed to the authenticated user, passed
  // beside the body: it used to be hard-coded to KEY in the service. PATCH
  // {status:'PAID'} needs exactly the dedicated mark-paid route's authority:
  // these guards with revenue:write, then markInvoicePaid's Membership check.
  // R0-CMF1 review SEC-CMF1-2: every branch (PAID, another status, an edit)
  // answers with the contact projected, as the mark-paid and status routes do.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/invoices/:invoiceId')
  async updateInvoice(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true, expectedType: UpdateInvoiceDto })) body: UpdateInvoiceDto,
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    const actorId = req?.user?.id;
    if (!actorId) throw new ForbiddenException('Authentication required');
    // W3-D64-COMMERCE-CREATE (D-64): actorId is also the member whose CRM view judges a new contactId.
    return toInvoiceWriteResponse(await this.commerce.updateInvoice({ ...body, invoiceId, businessId }, actorId));
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
  // V1-QUOTE-CHAIN-finish (review SEC-6, the R28-ST-01 / SEC-V53-1 class):
  // markQuoteFollowedUp returns the quote with its whole Contact row, and the
  // route handed it back, so a revenue:write member with crm:none received a
  // PRIVATE contact's internal notes, phone and owner. The quote's contact is
  // projected like the quote create and edit responses (toQuoteWriteResponse).
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/quotes/:quoteId/follow-up')
  async sendQuoteFollowUp(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Req() req: any,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
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
    return { success: true, quote: toQuoteWriteResponse(quote), resolvedApprovals: matches.length };
  }

  // R0-PC-01: the operator quote detail read. Declared after `quotes/stale`
  // so that route keeps matching first. The tenant is the path param the
  // guards admitted; the service binds the read to it, so a cross-tenant id,
  // an unknown id and a soft-deleted row answer the same 404.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/quotes/:quoteId')
  async getQuoteDetail(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
  ) {
    const quote = await this.commerce.getQuoteForBusiness(quoteId, businessId);
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  // R0-PC-01 (PC-F05 / BP-PC-01): retired. This route was unguarded and
  // unthrottled and served the full operator shape — DRAFT quotes, the
  // customer's email, internal notes, the linked invoice — to anyone holding a
  // quote id. No web page reads it: operators read the tenant route above and
  // customers read the signed-token route below. It answers the same 404 for
  // every id without reading the quote, so it can neither leak a quote nor
  // confirm that one exists, and it stays rate limited like the other public
  // reads. Still public (no AuthGuard): the public-surface ledger counts it.
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Get('quotes/:quoteId')
  getQuote(): never {
    throw new NotFoundException('Quote not found');
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

  // V1-QUOTE-CHAIN-finish (review SEC-5): the body names the termsVersion the
  // signed-token view served, so the customer accepts the terms they saw (400
  // without one, 409 quote_terms_changed when the quote was edited since).
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Post('public/quotes/:token/accept')
  acceptPublicQuote(
    @Param('token') token: string,
    @Body() body: { visitorId?: string; termsVersion?: unknown } | undefined,
    @Req() req: Request,
  ) {
    const visitorId =
      (body?.visitorId ? sanitizeString(body.visitorId, 100) : null) ??
      readVisitorIdFromRequest(req);
    return this.commerce.respondToQuoteByToken(token, 'accept', undefined, visitorId, body?.termsVersion);
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

  // V1-45b (D-15; V1-45 review SEC-V45-2, SEC-V45-3): the Idempotency-Key
  // header is forwarded with the acting member, as on invoice create, and the
  // route is audited like the invoice route: one quote_created row per quote,
  // none for a replay.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'quote_created', 'quote')
  @AuditOncePerEntity()
  @Post('businesses/:businessId/quotes')
  async createQuote(
    @Param('businessId') businessId: string,
    @Body(CREATE_QUOTE_BODY_PIPE) body: CreateQuoteDto,
    @Req() req: CreateRequest,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    // V1-53 (M19 quote half): the body is a validated DTO (it was an inline
    // type the ValidationPipe could not see), and only its declared fields are
    // forwarded. The service computes subtotal, tax, discount, total and every
    // line total; the tenant is the guarded path param, never a body field.
    // V1-53 review (SEC-V53-1): the 201 body's contact is projected.
    const quote = await this.commerce.createQuote({
      businessId,
      contactId: body.contactId,
      items: body.items.map(({ description, quantity, unitPrice, productId }) => ({ description, quantity, unitPrice, productId })),
      currency: body.currency,
      expiryDate: body.expiryDate,
      taxRate: body.taxRate,
      discountType: body.discountType,
      discountValue: body.discountValue,
      notes: body.notes,
      quoteNumber: body.quoteNumber,
      ...createIdempotency(req),
    });
    return toQuoteWriteResponse(quote);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('businesses/:businessId/quotes/:quoteId')
  async updateQuote(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    // V1-53: the edit contract (UpdateQuoteDto); unknown keys are stripped,
    // replacement lines obey the create rules. The tenant stays after the spread.
    @Body(UPDATE_QUOTE_BODY_PIPE) body: UpdateQuoteDto,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    // V1-53 review (SEC-V53-1): the 200 body's contact is projected.
    // FOLLOW3-D6 (D-64): a contactId other than the stored one must be one the acting member may open.
    const quote = await this.commerce.updateQuote({ ...body, quoteId, businessId, actorUserId: req?.user?.id });
    return toQuoteWriteResponse(quote);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('businesses/:businessId/quotes/:quoteId')
  async deleteQuote(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    return this.commerce.deleteQuote(quoteId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/quotes/:quoteId/convert')
  async convertQuoteToInvoice(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    // V1-53: the convert contract (ConvertQuoteDto); every field optional.
    @Body(CONVERT_QUOTE_BODY_PIPE) body: ConvertQuoteDto,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    // V1-QUOTE-CHAIN-finish (review SEC-2 / SEC-V51-3, the SEC-CMF1-2 class):
    // convertQuoteToInvoice returns the invoice with its whole Contact row
    // (the invoice.created listener reads it), and the route handed it back: a
    // revenue:write member with crm:none received a PRIVATE contact's internal
    // notes, phone, owner and visibility. The 201 body is the invoice write
    // response every other invoice write route answers.
    // W3-D64-COMMERCE-CREATE (D-64): the quote's contact must be one the acting member may open.
    return toInvoiceWriteResponse(
      await this.commerce.convertQuoteToInvoice({ ...body, quoteId, businessId, actorUserId: req?.user?.id }),
    );
  }

  // V1-52-QUOTE-PUBLIC-LINK (CF-16): the quote's customer link, { token, url },
  // for the operator to copy or share on any channel, with no mail provider
  // (the link used to reach a customer only inside the Gmail send-email
  // message). Bound to the path tenant: a foreign or unknown id is a 404. It
  // returns the quote's existing token and writes nothing, except minting the
  // one token of a SENT quote stored without one, so it is revenue:write like
  // send-email. A DRAFT is a 409, an expired or converted quote a 400
  // (CommerceService.getQuotePublicLink).
  //
  // V1-52 review (CR-V152-1): the global BusinessEventInterceptor
  // (APP_INTERCEPTOR) audits every successful POST that names a business. Here
  // it labelled the call quote.create with subjectId 'unknown' (the body has no
  // id) and stored the body as the after-snapshot: the redaction policy drops
  // `token` but not `url`, so each call wrote the customer's bearer
  // accept/reject link in plain text into the business event log, the KEY flow
  // bridge and KEY episodic memory. Handing out a link is not a business
  // event (it returns the stored token; its one write is the CR-V150-2 repair
  // mint of a SENT quote stored without one), so the route is skipped, as the
  // service contract says: nothing is emitted, logged or posted.
  // SetMetadata, not @SkipBusinessEvent(): that decorator (Reflect.metadata)
  // stores the flag on the prototype property, while the interceptor reads it
  // from the handler function (Reflector.get), so it skips nothing;
  // SetMetadata stores it on the handler.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @SetMetadata(SKIP_BUSINESS_EVENT_KEY, true)
  @Post('businesses/:businessId/quotes/:quoteId/public-link')
  async createQuotePublicLink(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    return this.commerce.getQuotePublicLink(quoteId, businessId);
  }

  // ========== GMAIL INTEGRATION ==========
  //
  // R0-CMF5-GMAIL-CONNECT-BINDING (owner ruling D-11; R0-07 review ST-2, ST-3):
  // the mailbox invoices, reminders, receipts and quotes are sent from is
  // business configuration. Starting a connection (auth-url), confirming it and
  // disconnecting it are OWNER only (GmailService.assertConnectAuthority:
  // OWNER membership, Business.ownerId, SUPER_ADMIN; 403 GMAIL_OWNER_ONLY
  // otherwise). They carry AuthGuard and BusinessGuard but not ModuleScopeGuard,
  // as the subscription plan changes do: a revenue scope admits no one the owner
  // rule refuses, and ModuleScopeGuard would refuse a distinguished owner with
  // no membership row. The callback links nothing; it stages a PENDING
  // connection that only the user the state names can confirm.

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/gmail/auth-url')
  async getGmailAuthUrl(@Param('businessId') businessId: string, @Req() req: { user?: { id: string; role?: string } }) {
    await this.gmail.assertConnectAuthority(businessId, req.user);
    const url = this.gmail.getAuthUrl(businessId, (req.user as { id: string }).id);
    return { url };
  }

  /**
   * Google's redirect after consent. Public by necessity (the browser comes
   * back from Google, and the web proxy at /api/commerce/gmail/callback forwards
   * no session), so it decides nothing about who is on the other end: a state
   * that verifies (signature, expiry, single use) and names a user has its code
   * exchanged and the tokens staged as a PENDING connection for that user; the
   * browser is sent to gmail=pending with the pending id, which the same user
   * must confirm from a signed-in request. Nothing is linked here.
   */
  @Get('gmail/callback')
  async handleGmailCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = appUrl();

    const parsedState = typeof state === 'string' ? this.gmail.verifyState(state) : null;
    if (!parsedState?.userId) {
      return res.redirect(`${frontendUrl}/app/commerce?gmail=error&reason=invalid_state`);
    }

    try {
      const { pendingId } = await this.gmail.stagePendingConnection(parsedState, code);
      return res.redirect(`${frontendUrl}/app/commerce?gmail=pending&pending=${encodeURIComponent(pendingId)}`);
    } catch {
      return res.redirect(`${frontendUrl}/app/commerce?gmail=error`);
    }
  }

  /**
   * R0-CMF5 review ST-CMF5-2: what the owner is about to confirm (the mailbox
   * the consent was completed with), so the confirmation is never blind. The
   * same owner rule and user binding as the confirmation; it consumes nothing.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/gmail/pending/:pendingId')
  previewGmailConnection(
    @Param('businessId') businessId: string,
    @Param('pendingId') pendingId: string,
    @Req() req: { user?: { id: string; role?: string } },
  ) {
    return this.gmail.previewPendingConnection(businessId, req.user, pendingId);
  }

  /**
   * R0-CMF5: activate the connection the callback staged. Only the user the
   * OAuth state named, still the business owner (or SUPER_ADMIN), within the
   * pending window, once. Body: { pendingId, email } — the id from the
   * gmail=pending redirect and the mailbox the preview showed (ST-CMF5-2).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/gmail/confirm')
  async confirmGmailConnection(
    @Param('businessId') businessId: string,
    @Body('pendingId') pendingId: unknown,
    @Body('email') email: unknown,
    @Req() req: { user?: { id: string; role?: string } },
  ) {
    await this.gmail.assertConnectAuthority(businessId, req.user);
    if (typeof pendingId !== 'string' || pendingId.length === 0 || pendingId.length > 200) {
      throw new BadRequestException('pendingId is required');
    }
    if (typeof email !== 'string' || email.trim().length === 0 || email.length > 320) {
      throw new BadRequestException('email (the mailbox shown for this pending connection) is required');
    }
    return this.gmail.confirmPendingConnection(businessId, req.user, pendingId, email);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/gmail/status')
  getGmailStatus(@Param('businessId') businessId: string) {
    return this.gmail.getGmailStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/gmail')
  async disconnectGmail(@Param('businessId') businessId: string, @Req() req: { user?: { id: string; role?: string } }) {
    // The owner rule, the PENDING-row removal and the audit row are in the service.
    return this.gmail.disconnectGmail(businessId, req.user);
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
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'quote');
    const existing = await this.commerce.getQuote(quoteId);
    if (!existing || existing.businessId !== businessId) {
      // V1-53: an unknown or foreign id is a 404 (a plain Error answered 500).
      throw new NotFoundException('Quote not found');
    }

    // R0-CMF4-SEND-EMAIL-ORDER (COST-LEDGER-001 section 7 item 2) and its
    // review (SEC-CMF4-1/2, CR-CMF4-1): the email carries the public
    // accept/reject link, so a first send of a DRAFT needs a view token in the
    // URL. sendQuoteWithViewToken reserves it on the DRAFT before the send
    // (the public accept and reject routes refuse a DRAFT, and only this
    // message carries the token), clears it when Gmail did not accept
    // the message (a refused or failed send leaves the DRAFT as it was: no
    // token, no sentAt, no quote.sent), and moves the DRAFT to SENT only
    // after the send, as a compare-and-set, so a rejection, acceptance or
    // second send made meanwhile is never overwritten. It used to move the
    // quote to SENT first, so a send that never reached the customer left it
    // SENT.
    const quote = existing;
    const business = quote.business;
    const contact = quote.contact;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000';

    await this.commerce.sendQuoteWithViewToken(quoteId, async (viewToken) => {
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
        // FOLLOW3-B5-EMAIL-LINE-TOTALS (D-13): each line carries its stored
        // QuoteItem.total, which the template prints.
        items: emailLineItems(quote.items),
        subtotal: quote.subtotal,
        taxRate: quote.taxRate,
        taxAmount: quote.taxAmount,
        discountType: quote.discountType,
        discountValue: quote.discountValue,
        discountAmount: quote.discountAmount,
        total: quote.total,
        currency: quote.currency,
        notes: quote.notes,
        quoteUrl: `${appUrl}/quote/${viewToken}`,
        customMessage: body.message,
      });

      await this.gmail.sendEmail({
        businessId,
        to: body.recipientEmail,
        subject: `Quote #${quote.quoteNumber} from ${business.name}`,
        htmlBody: emailHtml,
      });
    });

    if (quote.status !== 'DRAFT') return { success: true, quote };
    const sent = await this.commerce.getQuote(quoteId);
    if (!sent) {
      throw new NotFoundException('Quote not found');
    }
    return { success: true, quote: sent };
  }

  // ========== INVOICE EMAIL / REMINDER / RECEIPT ==========

  /**
   * Build the standardized public invoice URL, /public/invoice/<token>.
   * createPaymentLink throws for PAID/VOID invoices; for those (e.g. the
   * resend-receipt flow) the previously-issued token is surfaced so the
   * customer can revisit the invoice page. Only the known "paid or voided"
   * refusal is swallowed — other failures bubble up.
   *
   * V1-46b-TOKEN-PAY-COMPLETE (CR-01): the logic moved, unchanged, to
   * CommerceService.publicInvoiceUrl, so every producer of a customer
   * invoice URL (these emails, the flow reminders, KEY's invoice_sent and
   * autopilot payment recovery) builds the same token link. These operator
   * sends may issue a new link for an invoice whose links were all revoked
   * or expired; the automated producers may not (automatedInvoiceUrl, V1-46b
   * review SEC-V46B-1/2).
   */
  private async buildPublicInvoiceUrl(invoiceId: string, businessId: string): Promise<string | null> {
    return this.commerce.publicInvoiceUrl(invoiceId, businessId);
  }

  private buildInvoiceEmailContext(
    invoice: InvoiceForEmail,
    paymentUrl: string | null,
    customMessage?: string | null,
    variant: 'invoice' | 'reminder' | 'receipt' = 'invoice',
  ) {
    const business = invoice.business;
    const contact = invoice.contact;
    // V1-49 review (SEC-V49-1, CR-V49-2): the figures come from the invoice's
    // own-tenant rows, the rule the invoice.paid receipt and the public receipt
    // use. It was sumSuccessfulPayments over every row, so a SUCCESSFUL row
    // tagged with another businessId (M31) raised the "received" figure in a
    // customer email. Tenancy does not depend on the variant, so the invoice,
    // reminder and receipt emails use the same rows.
    // V1-29b-REFUND-READERS (CR-V29-1, CR-V29-3): "paid" is the balance's net
    // (money received less refunds) and "remaining" its remaining, read through
    // balanceOfStoredRows in integer cents (ownTenantReceiptBalance). The email
    // stated computeBalance's gross paid and total - gross, so a reminder for
    // 60 + 40 paid with the 40 refunded read "TT$0.00 awaiting payment" and a
    // receipt after a re-settlement "received TT$200.00" on a TT$100 invoice.
    const balance = ownTenantReceiptBalance(invoice);
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
      // FOLLOW3-B5-EMAIL-LINE-TOTALS (D-13): each line carries its stored
      // InvoiceItem.total (V1-22 lineAmount), which the template prints, so the
      // printed lines add up to the printed Subtotal.
      items: emailLineItems(invoice.items),
      subtotal: Number(invoice.subtotal ?? invoice.total),
      taxRate: invoice.taxRate != null ? Number(invoice.taxRate) : null,
      taxAmount: invoice.taxAmount != null ? Number(invoice.taxAmount) : null,
      discountType: invoice.discountType,
      discountValue: invoice.discountValue != null ? Number(invoice.discountValue) : null,
      discountAmount: invoice.discountAmount != null ? Number(invoice.discountAmount) : null,
      total: Number(invoice.total),
      amountPaid: balance.net,
      amountRemaining: balance.remaining,
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
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    // Allow drafts: sending the email is precisely what transitions DRAFT -> SENT.
    const invoice = (await this.commerce.getInvoiceWithBusiness(invoiceId, false)) as
      | InvoiceForEmail
      | null;
    if (!invoice || invoice.businessId !== businessId) throw new ForbiddenException('Invoice not found');
    if (invoice.status === 'VOID') throw new ForbiddenException('Cannot email a voided invoice');
    const recipient = body.recipientEmail || invoice.contact?.email;
    if (!recipient) throw new ForbiddenException('Recipient email is required');
    // R0-CMF4-SEND-EMAIL-ORDER (COST-LEDGER-001 section 7 item 3) and its
    // review (SEC-CMF4-3): the pay link is the one buildPublicInvoiceUrl
    // would hand out (D-07). One the invoice does not have yet is written
    // before the send as a pending link that every other request reuses, and
    // removed when Gmail did not accept the message unless another request
    // handed it out meanwhile, so a refused (503) or failed send leaves no
    // new PaymentLink and two overlapping sends share one live link.
    const { send, paymentUrl } = await this.commerce.sendWithPublicInvoiceUrl(invoiceId, businessId, async (url) => {
      const html = this.buildInvoiceEmailContext(invoice, url, body.message, 'invoice');
      const result = await this.gmail.sendEmail({
        businessId,
        to: recipient,
        subject: `Invoice #${invoice.invoiceNumber} from ${invoice.business?.name ?? 'us'}`,
        htmlBody: html,
      });
      return { send: result, paymentUrl: url };
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
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
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
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    // Receipts are only meaningful for paid invoices; explicit guard.
    const invoice = (await this.commerce.getInvoiceWithBusiness(invoiceId, false)) as
      | InvoiceForEmail
      | null;
    if (!invoice || invoice.businessId !== businessId) throw new ForbiddenException('Invoice not found');
    if (invoice.status !== 'PAID') throw new ForbiddenException('Invoice is not yet paid');
    // V1-49 review (CR-V49-2): the same settlement rule as the invoice.paid
    // receipt. A PAID row whose own-tenant rows do not cover the total (a
    // foreign-tenant row, no row, a refund that left it PAID) gets the same
    // refusal, before any link is looked up or minted, rather than a receipt
    // the automatic path would not send.
    if (!isSettledForReceiptEmail(invoice, ownTenantReceiptBalance(invoice))) {
      throw new ForbiddenException('Invoice is not yet paid');
    }
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
  //
  // V1-48-PUBLIC-TOKEN-VIEW (CF-18): beside the invoice block (unchanged: the
  // eleven keys PC-02 pins) the payload carries `balance` — amountPaid,
  // amountDue and paidAt from the invoice's own-tenant Payment rows — so the
  // page shows what has been paid and what remains. Still no payment rows,
  // references or customer email. An unknown, expired, inactive or
  // foreign-tenant link answers the same body.
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
    const balance = await this.commerce.getPaymentLinkBalance(invoice.id, invoice.businessId);
    if (!balance) return { ok: false, reason: 'not_found' };
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
      balance,
    };
  }

  // V1-49-PUBLIC-RECEIPT (M24, D-07): the customer's receipt by the pay-link
  // token. The only other receipt route (invoices/:invoiceId/receipt) is behind
  // AuthGuard, so a customer got 401. Public by design (the public-surface
  // ledger counts it): the token is the credential, as on the sibling view,
  // and it is rate limited. An unknown, expired, inactive or foreign-tenant
  // link, and an invoice no receipt can be shown for, answer one 404; a
  // shareable invoice whose own-tenant rows net to zero or less (nothing
  // received, or refunded away) is a 409. Read-only: no view event,
  // no token rotation, no write.
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('public/invoice-link/:token/receipt')
  async getPublicReceiptByToken(@Param('token') token: string) {
    const link = await this.commerce.getPaymentLinkByToken(token);
    if (!link) throw new NotFoundException('Receipt not found');
    return this.receipts.buildPublicReceipt(link.invoiceId, link.businessId);
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
  async recordPayment(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    // R0-D2: a DTO class so the global ValidationPipe sees the body; it
    // whitelists the existing fields untouched and validates only the new
    // optional idempotencyKey.
    @Body() body: RecordPaymentDto,
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    // R0-D2 review (CR-1): only this route keys a manual record on its
    // reference + amount. Here `reference` is the operator's payment
    // reference (the journey's duplicate slip); internal callers pass a
    // document-derived reference and keep one row per call.
    // R0-PL-07: the recorder is the authenticated user, never a body field.
    const result = await this.commerce.recordPayment(invoiceId, businessId, body, {
      dedupeByReference: true,
      actorId: req?.user?.id ?? null,
    });
    // R0-SEC3 review SEC3-ST-1 (SEC-CMF1-2 class): recordPayment and its keyed
    // replay reload the invoice with the whole Contact row; the HTTP body
    // projects it like every other invoice write (toInvoiceWriteResponse).
    return { ...result, invoice: result.invoice ? toInvoiceWriteResponse(result.invoice) : result.invoice };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/payments/from-evidence')
  async recordPaymentFromEvidence(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: {
      evidenceUrl: string;
      evidenceMimeType: string;
      filename: string;
      source: 'drive' | 'upload';
      driveFileId?: string;
    },
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    // R0-PL-07 review (PL07-ST-3): KEY stays the recorder of the extracted
    // payment; the authenticated uploader is kept as its initiator. Taken from
    // req.user, never from the body.
    return this.paymentEvidence.processEvidence(
      { ...body, businessId, invoiceId },
      { initiatedBy: req?.user?.id ?? null },
    );
  }

  // V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE (V1-41 review CR-V41-3; D-27): the
  // HTTP door to PaymentEvidenceService.confirmPendingPayment. A payment read
  // from an untrusted input (from-evidence above, a Drive intake
  // record_payment step) is recorded PENDING; this is how a member turns it
  // into money. The guard stack and the revenue:write scope are the manual
  // payment route's; the door restates the revenue:write rule for the member
  // and refuses a SUPER_ADMIN with no membership (D-46). The confirming member
  // is the authenticated user, never a body field (R0-PL-07): the SUCCESSFUL
  // row, its payment_recorded posting and the invoice.payment_recorded contact
  // event name them. The optional `amount` binds what the member was shown
  // (SEC-V41-1). The pending row must be this invoice's in this tenant (404
  // otherwise); a row no untrusted input wrote, or one already confirmed, is
  // a 409; nothing is written on any refusal.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/payments/:paymentId/confirm')
  async confirmPendingPayment(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Param('paymentId') paymentId: string,
    @Body(CONFIRM_PENDING_PAYMENT_BODY_PIPE) body: ConfirmPendingPaymentDto,
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    const result = await this.paymentEvidence.confirmPendingPayment(paymentId, businessId, req?.user?.id ?? null, {
      amount: body?.amount,
      invoiceId,
    });
    // V1-41 review DISC-V41-6 (the SEC3-ST-1 class): recordPayment and its
    // keyed replay reload the invoice with the whole Contact row; the body is
    // projected exactly as the manual payment route projects it.
    return { ...result, invoice: result.invoice ? toInvoiceWriteResponse(result.invoice) : result.invoice };
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
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    const { extracted, raw } = await this.paymentEvidence.extractEvidence({ ...body, businessId,
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

    // What is still owed on each invoice: the balance read contract over its
    // own-tenant rows (V1-29b-REFUND-READERS, CR-V29-1). Summing the SUCCESSFUL
    // rows never subtracted a refund, so a refunded invoice matched as settled.
    const candidates = invoices.map((inv) => {
      const { remaining } = ownTenantReceiptBalance(inv);
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
  async refundPayment(
    @Param('businessId') businessId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: { reason?: string },
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    // R0-PL-07: the refunding user is recorded on the reversal transaction.
    return this.commerce.markPaymentRefunded(paymentId, businessId, body?.reason, req?.user?.id ?? null);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/payments/:paymentId/retry')
  async retryPayment(
    @Param('businessId') businessId: string,
    @Param('paymentId') paymentId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    return this.commerce.retryPayment(paymentId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/receipt/resend')
  async resendReceipt(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    return this.commerce.markReceiptSent(invoiceId, businessId);
  }

  // ========== PAYMENT LINKS ==========

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/:invoiceId/payment-link')
  async createPaymentLink(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: { expiresInDays?: number },
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
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
  async deactivatePaymentLink(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId, 'invoice');
    return this.commerce.deactivatePaymentLink(id, businessId);
  }

  // V1-46-PUB-PAY-LINK-TOKEN-GATE (M34; D-07: token links only, the bare-id
  // pay page is retired). The customer pay page's read and its offline intent
  // are keyed by the pay-link token, so deactivating or expiring a link stops
  // those two. V1-46b-TOKEN-PAY-COMPLETE (review ST-1) finished the boundary:
  // the read no longer returns the invoice id, the gateway list, status,
  // Stripe / PayPal / WiPay checkouts and PayPal capture are token routes of
  // payments.controller.ts, and the id-keyed public routes (the bare-id read
  // below, the bare status and gateway list, the generic checkout) answer an
  // unknown-id 404 once every link of the invoice is revoked or expired
  // (CommerceService.isBareIdPublicAccessOpen). Two bare routes are retired
  // and two token routes take their place (the public-surface ledger stays at 11):
  //   GET  payment-links/:token          -> retired. It handed the invoice id to
  //                                         /pay/link/[token], which downgraded
  //                                         to /pay/:invoiceId.
  //   POST invoices/:invoiceId/payment-intent -> retired. Anyone holding the
  //                                         id could record an intent whatever
  //                                         became of the link.
  // The bare-id public read GET invoices/:invoiceId keeps its redacted
  // projection (KF-REVENUE-AUTH-PROJECTION-001) only while the invoice has a
  // live link or never had one (release0-journey step 6 pins the latter);
  // widgets/pay/[invoiceId] no longer reads it (retired, review ST-2). The
  // operator app reads the tenant-bound route (R0-QI-01).
  // What stands in for a guard on both token routes: the token IS the
  // credential (24 crypto-random bytes, V1-48; unknown, inactive, expired and
  // foreign-tenant links answer one 404) plus the rate limit.

  // The pay page's read: the public projection the bare-id read serves.
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('public/invoice-link/:token/pay')
  async getPayPageByToken(@Param('token') token: string) {
    const view = await this.commerce.getPayPageByToken(token);
    if (!view) throw new NotFoundException('Invoice not found');
    return view;
  }

  // The customer's offline intent ("I will pay by bank transfer / cash"):
  // the R0-22 contract, reachable only through a live link.
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(10, 60_000)
  @Post('public/invoice-link/:token/payment-intent')
  recordPaymentIntentByToken(
    @Param('token') token: string,
    @Body() body: { method: string; amount?: unknown },
  ) {
    const method = sanitizeString(body?.method ?? '', 50) ?? '';
    // R0-22: the amount is passed through as sent. It used to be dropped when
    // negative or not a number, so a bad amount was silently recorded as 0;
    // the service now answers 400 for it and caps a good one at the balance.
    return this.commerce.recordPaymentIntentByToken(token, method, body?.amount);
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

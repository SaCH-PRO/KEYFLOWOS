import { Controller, Get, Put, Post, Patch, Param, Body, Query, Inject, UseGuards, BadRequestException } from '@nestjs/common';
import { SiteService } from './site.service';
import { StoreOrderService } from './store-order.service';
import { PromoCodeService } from './promo-code.service';
import { IntakeService } from './intake.service';
import { QualificationService } from './qualification.service';
import { PaymentsService } from '../payments/payments.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';
import { sanitize } from '../../core/utils/sanitize';

@Controller('site')
export class SiteController {
  constructor(
    @Inject(SiteService) private readonly siteService: SiteService,
    @Inject(StoreOrderService) private readonly storeOrderService: StoreOrderService,
    @Inject(PromoCodeService) private readonly promoCodeService: PromoCodeService,
    @Inject(IntakeService) private readonly intakeService: IntakeService,
    @Inject(QualificationService) private readonly qualificationService: QualificationService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'site' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/storefront')
  getStorefrontConfig(@Param('businessId') businessId: string) {
    return this.siteService.getStorefrontConfig(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/blueprint')
  getBusinessBlueprint(@Param('businessId') businessId: string) {
    return this.siteService.getBusinessBlueprint(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/blueprint/generate')
  generateBusinessBlueprint(
    @Param('businessId') businessId: string,
  ) {
    return this.siteService.generateBusinessBlueprint(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/blueprint')
  updateBusinessBlueprint(
    @Param('businessId') businessId: string,
    @Body() body:
      | Partial<Record<keyof import('./blueprint.types').BusinessBlueprint, unknown>>
      | { blueprint?: Partial<import('./blueprint.types').BusinessBlueprint>; patch?: Partial<import('./blueprint.types').BusinessBlueprint> },
  ) {
    const wrapped = body as { blueprint?: Partial<import('./blueprint.types').BusinessBlueprint>; patch?: Partial<import('./blueprint.types').BusinessBlueprint> };
    const payload =
      (wrapped.blueprint ?? wrapped.patch ?? body) as Partial<
        import('./blueprint.types').BusinessBlueprint
      >;
    return this.siteService.updateBusinessBlueprint(businessId, payload as any);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/blueprint/complete-step')
  completeBusinessBlueprintStep(
    @Param('businessId') businessId: string,
    @Body() body: {
      stepKey: keyof import('./blueprint.types').BusinessBlueprint['activation'];
      completed?: boolean;
    },
  ) {
    return this.siteService.completeBusinessBlueprintStep(
      businessId,
      body.stepKey,
      body.completed ?? true,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/blueprint/publish-storefront')
  publishStorefrontFromBlueprint(@Param('businessId') businessId: string) {
    return this.siteService.publishStorefrontFromBlueprint(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/storefront')
  updateStorefrontConfig(
    @Param('businessId') businessId: string,
    @Body() config: Record<string, any>,
  ) {
    return this.siteService.updateStorefrontConfig(businessId, config);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('storefront/public/:slug')
  getPublicStorefront(@Param('slug') slug: string) {
    return this.siteService.getPublicStorefront(slug);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(60, 60_000)
  @Post('businesses/:businessId/analytics/event')
  trackEvent(
    @Param('businessId') businessId: string,
    @Body() body: { type: string; itemId?: string },
  ) {
    return this.siteService.trackEvent(businessId, body.type, body.itemId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/analytics')
  getAnalytics(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.siteService.getAnalytics(businessId, days ? parseInt(days, 10) : undefined);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/conversion-funnel')
  getConversionFunnel(@Param('businessId') businessId: string) {
    return this.siteService.getConversionFunnel(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/product-health')
  getProductHealth(@Param('businessId') businessId: string) {
    return this.siteService.getProductHealthAudit(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/seo-health')
  getSeoHealth(@Param('businessId') businessId: string) {
    return this.siteService.getSeoHealthCheck(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/conversion-suggestions')
  getConversionSuggestions(@Param('businessId') businessId: string) {
    return this.siteService.getConversionSuggestions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/conversion-advice')
  getAiConversionAdvice(@Param('businessId') businessId: string) {
    return this.siteService.getAiConversionAdvice(businessId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(10, 60_000)
  @Post('storefront/public/:slug/checkout')
  async publicCheckout(
    @Param('slug') slug: string,
    @Body() body: {
      items: { productId: string; quantity: number }[];
      customer: { name: string; email?: string; phone?: string; country?: string };
      promoCode?: string;
      shipping?: { zoneId?: string; address?: Record<string, any> };
      paymentMethod?: string;
      returnUrl?: string;
      notes?: string;
    },
  ) {
    const storefront = await this.siteService.getPublicStorefront(slug);
    const businessId = storefront.business.id;
    const configuredGateways = this.siteService.getConfiguredCheckoutMethods(
      storefront?.blueprint as Partial<import('./blueprint.types').BusinessBlueprint> | null | undefined,
    );
    const requestedMethod = (body.paymentMethod ?? '').toUpperCase();
    if (requestedMethod && !configuredGateways.includes(requestedMethod)) {
      throw new BadRequestException(`Payment method ${requestedMethod} is not enabled for this storefront`);
    }

    const cleanCustomer = {
      ...body.customer,
      name: sanitize(body.customer.name) ?? '',
      email: sanitize(body.customer.email ?? null) ?? undefined,
      phone: sanitize(body.customer.phone ?? null) ?? undefined,
      country: sanitize(body.customer.country ?? null) ?? undefined,
    };

    const order = await this.storeOrderService.createOrder({
      businessId,
      cartItems: body.items,
      customerInfo: cleanCustomer,
      promoCode: body.promoCode ? sanitize(body.promoCode) ?? undefined : undefined,
      shippingInfo: body.shipping,
      paymentMethod: body.paymentMethod,
      notes: sanitize(body.notes ?? null) ?? undefined,
    });

    let payment: any = null;
    if (body.paymentMethod && body.paymentMethod !== 'CASH' && body.paymentMethod !== 'MANUAL') {
      payment = await this.paymentsService.createStorePayment({
        orderId: order.id,
        amount: order.total,
        currency: order.currency,
        method: body.paymentMethod,
        businessId,
        returnUrl: body.returnUrl,
      });
    }

    return {
      order,
      payment,
    };
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(20, 60_000)
  @Get('storefront/public/:slug/payment-methods')
  async getPublicPaymentMethods(@Param('slug') slug: string) {
    const storefront = await this.siteService.getPublicStorefront(slug);
    const methods = this.siteService.getConfiguredCheckoutMethods(
      storefront?.blueprint as Partial<import('./blueprint.types').BusinessBlueprint> | null | undefined,
    );
    return { methods };
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(15, 60_000)
  @Post('storefront/public/:slug/validate-promo')
  async validatePromoCode(
    @Param('slug') slug: string,
    @Body() body: {
      code: string;
      items: { productId: string; quantity: number }[];
    },
  ) {
    const storefront = await this.siteService.getPublicStorefront(slug);
    const businessId = storefront.business.id;

    const totals = await this.storeOrderService.calculateOrderTotals(
      body.items,
      businessId,
      body.code,
    );

    return {
      valid: true,
      promo: totals.promo,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      total: totals.total,
    };
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('storefront/public/order/:orderId')
  getPublicOrder(
    @Param('orderId') orderId: string,
    @Query('email') email: string,
  ) {
    return this.storeOrderService.getPublicOrder(orderId, email);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/orders')
  listOrders(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.storeOrderService.listOrders(businessId, {
      status,
      dateFrom,
      dateTo,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/orders/summary')
  getOrderSummary(@Param('businessId') businessId: string) {
    return this.storeOrderService.getOrderSummary(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/orders/:orderId')
  getOrderDetail(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.storeOrderService.getOrder(orderId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/orders/:orderId/status')
  updateOrderStatus(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Body() body: { status: string },
  ) {
    return this.storeOrderService.updateOrderStatus(orderId, body.status, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/orders/:orderId/refund')
  refundOrder(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.storeOrderService.refundOrder(orderId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/promo-codes')
  createPromoCode(
    @Param('businessId') businessId: string,
    @Body() body: {
      code: string;
      type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
      value: number;
      minOrderValue?: number;
      maxUses?: number;
      validFrom?: string;
      validTo?: string;
      active?: boolean;
    },
  ) {
    return this.promoCodeService.create({ ...body, businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/promo-codes')
  listPromoCodes(@Param('businessId') businessId: string) {
    return this.promoCodeService.list(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/promo-codes/:promoId')
  updatePromoCode(
    @Param('businessId') businessId: string,
    @Param('promoId') promoId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.promoCodeService.update(businessId, promoId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/promo-codes/:promoId/delete')
  deletePromoCode(
    @Param('businessId') businessId: string,
    @Param('promoId') promoId: string,
  ) {
    return this.promoCodeService.delete(businessId, promoId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(5, 60_000)
  @Post('storefront/public/:slug/reviews')
  submitReview(
    @Param('slug') slug: string,
    @Body() body: {
      productId: string;
      customerName: string;
      customerEmail?: string;
      rating: number;
      reviewText?: string;
      orderReference?: string;
    },
  ) {
    const cleanBody = {
      ...body,
      customerName: sanitize(body.customerName) ?? body.customerName,
      customerEmail: sanitize(body.customerEmail ?? null) ?? undefined,
      reviewText: sanitize(body.reviewText ?? null) ?? undefined,
      orderReference: sanitize(body.orderReference ?? null) ?? undefined,
    };
    return this.siteService.submitReview(slug, cleanBody);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('storefront/public/:slug/products/:productId/reviews')
  getProductReviews(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
  ) {
    return this.siteService.getProductReviews(slug, productId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('storefront/public/:slug/review-aggregates')
  getReviewAggregates(@Param('slug') slug: string) {
    return this.siteService.getReviewAggregates(slug);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/reviews')
  listBusinessReviews(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('rating') rating?: string,
  ) {
    return this.siteService.listBusinessReviews(businessId, {
      status,
      rating: rating ? parseInt(rating, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/reviews/:reviewId')
  moderateReview(
    @Param('businessId') businessId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: { status?: string; sellerResponse?: string },
  ) {
    return this.siteService.moderateReview(businessId, reviewId, body);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(5, 60_000)
  @Post('storefront/public/:slug/intake')
  submitIntake(
    @Param('slug') slug: string,
    @Body() body: {
      name: string;
      email: string;
      phone?: string;
      category: string;
      description: string;
      budget?: string;
      urgency?: string;
    },
  ) {
    return this.intakeService.submitIntake(slug, {
      name: sanitize(body.name ?? '') ?? '',
      email: sanitize(body.email ?? '') ?? '',
      phone: body.phone ? (sanitize(body.phone) ?? undefined) : undefined,
      category: sanitize(body.category ?? '') ?? '',
      description: sanitize(body.description ?? '') ?? '',
      budget: body.budget ? (sanitize(body.budget) ?? undefined) : undefined,
      urgency: body.urgency,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/intake')
  listIntakeSubmissions(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.intakeService.listForBusiness(businessId, {
      status,
      category,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/intake/:id')
  updateIntakeStatus(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { status: string; notes?: string },
  ) {
    return this.intakeService.updateStatus(id, businessId, body.status, body.notes);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/qualification-config')
  getQualificationConfig(@Param('businessId') businessId: string) {
    return this.qualificationService.getQualificationConfig(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/qualification-config')
  updateQualificationConfig(
    @Param('businessId') businessId: string,
    @Body() config: Record<string, any>,
  ) {
    return this.qualificationService.updateQualificationConfig(businessId, config);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/qualification-analytics')
  getQualificationAnalytics(@Param('businessId') businessId: string) {
    return this.qualificationService.getJourneyAnalytics(businessId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(30, 60_000)
  @Get('storefront/public/:slug/qualification-flow')
  getPublicQualificationFlow(@Param('slug') slug: string) {
    return this.qualificationService.getPublicQualificationFlow(slug);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(10, 60_000)
  @Post('storefront/public/:slug/qualification-recommend')
  qualificationRecommend(
    @Param('slug') slug: string,
    @Body() body: { answers: { questionId: string; answer: string; tags?: string[] }[] },
  ) {
    return this.qualificationService.scoreAndRecommend(slug, body.answers ?? []);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(10, 60_000)
  @Post('storefront/public/qualification/:journeyId/select')
  qualificationSelect(
    @Param('journeyId') journeyId: string,
    @Body() body: { productId: string; executionModel?: string; customer?: { name?: string; email?: string } },
  ) {
    return this.qualificationService.selectPackage(journeyId, body.productId, body.executionModel, body.customer);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(5, 60_000)
  @Post('storefront/public/qualification/:journeyId/intake')
  qualificationIntake(
    @Param('journeyId') journeyId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.qualificationService.submitAssetIntake(journeyId, body);
  }
}

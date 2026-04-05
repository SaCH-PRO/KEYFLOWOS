import { Controller, Get, Put, Post, Patch, Param, Body, Query, Inject, UseGuards } from '@nestjs/common';
import { SiteService } from './site.service';
import { StoreOrderService } from './store-order.service';
import { PromoCodeService } from './promo-code.service';
import { PaymentsService } from '../payments/payments.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('site')
export class SiteController {
  constructor(
    @Inject(SiteService) private readonly siteService: SiteService,
    @Inject(StoreOrderService) private readonly storeOrderService: StoreOrderService,
    @Inject(PromoCodeService) private readonly promoCodeService: PromoCodeService,
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
  @Put('businesses/:businessId/storefront')
  updateStorefrontConfig(
    @Param('businessId') businessId: string,
    @Body() config: Record<string, any>,
  ) {
    return this.siteService.updateStorefrontConfig(businessId, config);
  }

  @Get('storefront/public/:slug')
  getPublicStorefront(@Param('slug') slug: string) {
    return this.siteService.getPublicStorefront(slug);
  }

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

    const order = await this.storeOrderService.createOrder({
      businessId,
      cartItems: body.items,
      customerInfo: body.customer,
      promoCode: body.promoCode,
      shippingInfo: body.shipping,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
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
}

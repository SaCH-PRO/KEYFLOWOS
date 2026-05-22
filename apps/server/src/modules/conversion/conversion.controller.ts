import { Controller, Get, Post, Patch, Param, Body, UseGuards, Query, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PublicRateLimitGuard } from '../../core/guards/public-rate-limit.guard';
import { UpsellService } from './upsell.service';
import { ReferralRewardService } from './referral-reward.service';
import { SalesTeamService } from './sales-team.service';
import { LeadMagnetService } from './lead-magnet.service';
import { MerchantSubscriptionService } from './merchant-subscription.service';

@Controller('conversion')
@UseGuards(AuthGuard, BusinessGuard)
export class ConversionController {
  constructor(
    @Inject(UpsellService) private readonly upsell: UpsellService,
    @Inject(ReferralRewardService) private readonly referralReward: ReferralRewardService,
    @Inject(SalesTeamService) private readonly salesTeam: SalesTeamService,
    @Inject(LeadMagnetService) private readonly leadMagnet: LeadMagnetService,
    @Inject(MerchantSubscriptionService) private readonly merchantSub: MerchantSubscriptionService,
  ) {}

  // ─── Upsell Engine ───
  @Get('businesses/:businessId/products/:productId/upsells')
  async getUpsells(@Param('businessId') businessId: string, @Param('productId') productId: string) {
    return this.upsell.getUpsellsForProduct(businessId, productId);
  }

  @Patch('businesses/:businessId/products/:productId/upsells')
  async setUpsells(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: { upsellIds: string[] },
  ) {
    await this.upsell.setUpsellProducts(businessId, productId, body.upsellIds);
    return { updated: true };
  }

  @Get('businesses/:businessId/cart/order-bump')
  async getOrderBump(@Param('businessId') businessId: string, @Query('products') productIds: string) {
    const ids = productIds.split(',').filter(Boolean);
    const bump = await this.upsell.getOrderBumpForCart(businessId, ids);
    return { orderBump: bump };
  }

  // ─── Referral Rewards ───
  @Get('businesses/:businessId/contacts/:contactId/referral-stats')
  async getReferralStats(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.referralReward.getReferralStats(businessId, contactId);
  }

  // ─── Sales Team ───
  @Get('businesses/:businessId/sales-reps')
  async getSalesReps(@Param('businessId') businessId: string) {
    return this.salesTeam.getSalesReps(businessId);
  }

  @Patch('businesses/:businessId/sales-reps/:repId/commission')
  async setCommission(
    @Param('businessId') businessId: string,
    @Param('repId') repId: string,
    @Body() body: { rate: number },
  ) {
    await this.salesTeam.setCommissionRate(businessId, repId, body.rate);
    return { updated: true };
  }

  @Get('businesses/:businessId/sales-reps/:repId/pipeline')
  async getRepPipeline(@Param('businessId') businessId: string, @Param('repId') repId: string) {
    return this.salesTeam.getRepPipeline(businessId, repId);
  }

  @Patch('businesses/:businessId/contacts/:contactId/sales-rep')
  async assignSalesRep(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { salesRepId: string | null },
  ) {
    await this.salesTeam.setSalesRep(businessId, contactId, body.salesRepId);
    return { updated: true };
  }

  // ─── Lead Magnets ───
  @Get('businesses/:businessId/lead-magnets')
  async listLeadMagnets(@Param('businessId') businessId: string) {
    return this.leadMagnet.listLeadMagnets(businessId);
  }

  @Post('businesses/:businessId/lead-magnets')
  async createLeadMagnet(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      description?: string;
      contentUrl?: string;
      contentType: 'pdf' | 'video' | 'guide' | 'checklist';
      sequenceId?: string;
      publicSlug: string;
    },
  ) {
    return this.leadMagnet.createLeadMagnet(businessId, { ...body, isActive: true });
  }

  @UseGuards(PublicRateLimitGuard)
  @Post('public/lead-magnets/:businessId/:slug/convert')
  async convertLeadMagnet(
    @Param('businessId') businessId: string,
    @Param('slug') slug: string,
    @Body() body: { name: string; email: string; phone?: string },
  ) {
    return this.leadMagnet.recordLeadMagnetConversion(businessId, slug, body);
  }

  // ─── Merchant Subscriptions ───
  @Get('businesses/:businessId/subscription-products')
  async listSubscriptionProducts(@Param('businessId') businessId: string) {
    return this.merchantSub.listSubscriptionProducts(businessId);
  }

  @Get('businesses/:businessId/products/:productId/subscription-config')
  async getSubConfig(@Param('businessId') businessId: string, @Param('productId') productId: string) {
    return this.merchantSub.getSubscriptionConfig(businessId, productId);
  }

  @Patch('businesses/:businessId/products/:productId/subscription-config')
  async setSubConfig(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: {
      enabled: boolean;
      billingInterval: 'week' | 'month' | 'year';
      intervalCount: number;
      trialDays: number;
      setupFee: number;
      cancellationPolicy: 'anytime' | 'end_of_period' | 'minimum_term';
    },
  ) {
    await this.merchantSub.setSubscriptionConfig(businessId, productId, body);
    return { updated: true };
  }
}

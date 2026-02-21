import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(@Inject(SubscriptionsService) private readonly subs: SubscriptionsService) {}

  @Get('plans')
  getPlans() {
    return this.subs.getPlans();
  }

  @Get('feature-registry')
  getFeatureRegistry() {
    return this.subs.getFeatureRegistry();
  }

  @Get('businesses/:businessId/current')
  async getCurrentSubscription(@Param('businessId') businessId: string) {
    return this.subs.getActiveSubscription(businessId);
  }

  @Get('businesses/:businessId/billing-dashboard')
  async getBillingDashboard(@Param('businessId') businessId: string) {
    return this.subs.getBillingDashboard(businessId);
  }

  @Post('businesses/:businessId/trial')
  async startTrial(
    @Param('businessId') businessId: string,
    @Body() body: { plan: string; currency?: string },
  ) {
    return this.subs.startTrial(businessId, body.plan, body.currency);
  }

  @Post('businesses/:businessId/activate')
  async activateSubscription(
    @Param('businessId') businessId: string,
    @Body() body: { plan: string; currency: string; gateway: string; gatewaySubId?: string },
  ) {
    return this.subs.activateSubscription(businessId, body.plan, body.currency, body.gateway, body.gatewaySubId);
  }

  @Post('businesses/:businessId/cancel')
  async cancelSubscription(@Param('businessId') businessId: string) {
    return this.subs.cancelSubscription(businessId);
  }

  @Get('businesses/:businessId/history')
  async getHistory(@Param('businessId') businessId: string) {
    return this.subs.getSubscriptionHistory(businessId);
  }

  @Get('businesses/:businessId/check-limit/:resource')
  async checkLimit(
    @Param('businessId') businessId: string,
    @Param('resource') resource: string,
  ) {
    return this.subs.checkLimit(businessId, resource);
  }
}

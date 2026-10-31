import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';

/**
 * R0-08 / R0-08c-SUBSCRIPTION-AUTHORITY: every POST here changes the plan
 * (trial, activate, cancel, checkout, record-payment) and passes the
 * authenticated user to SubscriptionsService, which admits only the business
 * owner and SUPER_ADMIN (403 SUBSCRIPTION_OWNER_ONLY otherwise) and audits the
 * change against that user. BusinessGuard alone admits any member. The GET
 * routes keep that membership rule.
 */
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/current')
  async getCurrentSubscription(@Param('businessId') businessId: string) {
    return this.subs.getActiveSubscription(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/billing-dashboard')
  async getBillingDashboard(@Param('businessId') businessId: string) {
    return this.subs.getBillingDashboard(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/trial')
  async startTrial(
    @Param('businessId') businessId: string,
    @Body() body: { plan: string; currency?: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.subs.startTrial(businessId, user, body.plan, body.currency);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/activate')
  async activateSubscription(
    @Param('businessId') businessId: string,
    @Body() body: { plan: string; currency: string; gateway: string; gatewaySubId?: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.subs.activateSubscription(businessId, user, body.plan, body.currency, body.gateway, body.gatewaySubId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/cancel')
  async cancelSubscription(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.subs.cancelSubscription(businessId, user);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/history')
  async getHistory(@Param('businessId') businessId: string) {
    return this.subs.getSubscriptionHistory(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/check-limit/:resource')
  async checkLimit(
    @Param('businessId') businessId: string,
    @Param('resource') resource: string,
  ) {
    return this.subs.checkLimit(businessId, resource);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/checkout')
  async createCheckout(
    @Param('businessId') businessId: string,
    @Body() body: { plan: string; currency: string; gateway: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.subs.createCheckout(businessId, user, body.plan, body.currency, body.gateway);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/record-payment')
  async recordSubscriptionPayment(
    @Param('businessId') businessId: string,
    @Body() body: { plan: string; currency: string; method: string; reference?: string; notes?: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.subs.recordManualPayment(businessId, user, body.plan, body.currency, body.method, body.reference, body.notes);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/payments')
  async getPaymentHistory(@Param('businessId') businessId: string) {
    return this.subs.getPaymentHistory(businessId);
  }
}

import { Controller, Get, Post, Patch, Param, Body, UseGuards, Query, Inject, Req, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PublicRateLimitGuard } from '../../core/guards/public-rate-limit.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertContactVisible, contactVisibilityFilter, resolveCrmAccess } from '../crm/crm-permissions.helper';
import { contactWhereWithId } from '../crm/crm.helpers';
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
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
  // V1-84 (FOLLOW3-D5): a contact-keyed route answers only for a contact the
  // caller may open by the GET crm contacts/:contactId rule (V1-08
  // assertContactVisible): a hidden contact gets the same 404 'Contact not
  // found' as an unknown id, before the service runs.
  @Get('businesses/:businessId/contacts/:contactId/referral-stats')
  async getReferralStats(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
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

  // V1-84 review (FOLLOW3-D5 ST-5): each pipeline entry names a contact, so a
  // member is shown only the contacts they may open (V1-08 rule,
  // contactVisibilityFilter); OWNER and SUPER_ADMIN get exactly today's list.
  @Get('businesses/:businessId/sales-reps/:repId/pipeline')
  async getRepPipeline(
    @Param('businessId') businessId: string,
    @Param('repId') repId: string,
    @Req() req: { user: { id: string } },
  ) {
    const access = await resolveCrmAccess(this.prisma, businessId, req.user.id);
    const pipeline = await this.salesTeam.getRepPipeline(businessId, repId);
    const canOpen = await contactVisibilityFilter(
      this.prisma, businessId, access, req.user.id, pipeline.map((entry) => entry.id),
    );
    return canOpen ? pipeline.filter((entry) => canOpen(entry.id)) : pipeline;
  }

  // V1-84 (FOLLOW3-D5): the contact must be one the caller may open (V1-08
  // rule); a hidden contact answers 404 'Contact not found' and is not written.
  // V1-84 review (ST-2): setting the sales rep writes the contact
  // (custom.salesRepId), so the caller must also hold the contact edit right
  // PATCH crm contacts/:contactId applies (CrmService.assertCanEditContact,
  // whose module this one does not import): crm_edit 'none' is refused 403,
  // crm_edit 'owned' on a contact neither owned by nor shared with the caller
  // is refused 403, and nothing is written. OWNER and SUPER_ADMIN are not
  // restricted.
  @Patch('businesses/:businessId/contacts/:contactId/sales-rep')
  async assignSalesRep(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { salesRepId: string | null },
    @Req() req: { user: { id: string } },
  ) {
    const actorUserId = req.user.id;
    const access = await assertContactVisible(this.prisma, businessId, contactId, actorUserId);
    if (!access.isOwner && !access.isSuperAdmin) {
      if (access.editScope === 'none') {
        throw new ForbiddenException('You do not have permission to edit contacts');
      }
      if (access.editScope === 'owned') {
        const owned = await this.prisma.client.contact.findFirst({
          where: {
            ...contactWhereWithId(businessId, contactId),
            OR: [{ ownerId: actorUserId }, { shares: { some: { userId: actorUserId } } }],
          },
          select: { id: true },
        });
        if (!owned) throw new ForbiddenException('You can only edit contacts you own');
      }
    }
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

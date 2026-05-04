import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MailchimpConnector } from '../../core/connectors/implementations/mailchimp.connector';
import { KlaviyoConnector } from '../../core/connectors/implementations/klaviyo.connector';

type MarketingProvider = 'mailchimp' | 'klaviyo';

@Controller('marketing')
@UseGuards(AuthGuard, BusinessGuard)
export class MarketingSyncController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailchimpConnector) private readonly mailchimp: MailchimpConnector,
    @Inject(KlaviyoConnector) private readonly klaviyo: KlaviyoConnector,
  ) {}

  private async getConnected(
    businessId: string,
  ): Promise<Array<{ provider: MarketingProvider; connector: MailchimpConnector | KlaviyoConnector }>> {
    const out: Array<{ provider: MarketingProvider; connector: MailchimpConnector | KlaviyoConnector }> = [];
    if (await this.mailchimp.isConnected(businessId).catch(() => false)) out.push({ provider: 'mailchimp', connector: this.mailchimp });
    if (await this.klaviyo.isConnected(businessId).catch(() => false)) out.push({ provider: 'klaviyo', connector: this.klaviyo });
    return out;
  }

  @Get('businesses/:businessId/lists')
  async lists(@Param('businessId') businessId: string) {
    const connected = await this.getConnected(businessId);
    if (connected.length === 0) {
      return { connected: false, providers: [], lists: [] };
    }
    const all: Array<{ id: string; name: string; memberCount: number; provider: MarketingProvider }> = [];
    const errors: Array<{ provider: MarketingProvider; error: string }> = [];
    for (const { provider, connector } of connected) {
      const out = await connector.listLists(businessId);
      if (out.success && out.lists) all.push(...out.lists);
      else errors.push({ provider, error: out.error ?? 'Unknown error' });
    }
    return {
      connected: true,
      providers: connected.map((c) => c.provider),
      lists: all,
      errors,
    };
  }

  @Post('businesses/:businessId/lists/push-contacts')
  async pushContacts(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      provider: MarketingProvider;
      listId: string;
      contactIds?: string[];
      segment?: { tag?: string; status?: string; marketingOptIn?: boolean };
    },
  ) {
    if (!body?.provider || !body?.listId) throw new BadRequestException('provider and listId are required');
    const target =
      body.provider === 'mailchimp'
        ? { connector: this.mailchimp as MailchimpConnector }
        : body.provider === 'klaviyo'
        ? { connector: this.klaviyo as KlaviyoConnector }
        : null;
    if (!target) throw new BadRequestException('Unknown provider');
    if (!(await target.connector.isConnected(businessId))) {
      throw new ForbiddenException(`${body.provider} is not connected`);
    }

    let contactIds = body.contactIds;
    if (!contactIds || contactIds.length === 0) {
      const where: Record<string, unknown> = { businessId, deletedAt: null, email: { not: null }, doNotContact: { not: true } };
      if (body.segment?.status) where.status = body.segment.status;
      if (typeof body.segment?.marketingOptIn === 'boolean') where.marketingOptIn = body.segment.marketingOptIn;
      if (body.segment?.tag) where.tags = { has: body.segment.tag };
      const found = await this.prisma.client.contact.findMany({ where, select: { id: true }, take: 500 });
      contactIds = found.map((c) => c.id);
    }
    if (contactIds.length === 0) {
      return { provider: body.provider, listId: body.listId, total: 0, created: 0, updated: 0, failed: 0, errors: ['No contacts matched the segment'] };
    }
    const result = await target.connector.subscribeContacts(businessId, body.listId, contactIds);
    return { provider: body.provider, listId: body.listId, total: contactIds.length, ...result };
  }

  @Get('businesses/:businessId/lists/campaigns/:provider')
  async campaigns(@Param('businessId') businessId: string, @Param('provider') provider: string) {
    if (provider !== 'mailchimp' && provider !== 'klaviyo') throw new BadRequestException('Unknown provider');
    const connector = provider === 'mailchimp' ? this.mailchimp : this.klaviyo;
    if (!(await connector.isConnected(businessId))) throw new ForbiddenException(`${provider} is not connected`);
    const out = await connector.listCampaigns(businessId);
    if (!out.success) throw new BadRequestException(out.error ?? 'Failed to list campaigns');
    return { provider, campaigns: out.campaigns ?? [] };
  }

  @Post('businesses/:businessId/lists/campaigns/:provider/:campaignId/trigger')
  async triggerCampaign(
    @Param('businessId') businessId: string,
    @Param('provider') provider: string,
    @Param('campaignId') campaignId: string,
  ) {
    if (provider !== 'mailchimp' && provider !== 'klaviyo') throw new BadRequestException('Unknown provider');
    const connector = provider === 'mailchimp' ? this.mailchimp : this.klaviyo;
    if (!(await connector.isConnected(businessId))) throw new ForbiddenException(`${provider} is not connected`);
    const out = await connector.triggerCampaign(businessId, campaignId);
    if (!out.success) throw new BadRequestException(out.error ?? 'Failed to trigger campaign');
    return { success: true };
  }
}

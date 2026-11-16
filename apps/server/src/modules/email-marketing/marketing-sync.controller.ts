import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { assertMayExport, contactIdsEveryReceiverMayOpen } from '../../core/auth/receiver-reads';
import type { ModuleLevelActor } from '../../core/auth/member-module-level';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CONNECTOR_EXPORT_READS, exportAudience } from '../../core/connectors/connector-exports';
import { MailchimpConnector } from '../../core/connectors/implementations/mailchimp.connector';
import { KlaviyoConnector } from '../../core/connectors/implementations/klaviyo.connector';

type MarketingProvider = 'mailchimp' | 'klaviyo';
type MarketingRequest = { user?: ModuleLevelActor };

/**
 * SWEEP-P0-SCOPES round 2 class repair (CLASS A; finding WHP-2): the marketing push sends contacts
 * (email, name, and to Klaviyo the phone) to the Mailchimp or Klaviyo account in the stored
 * credentials, which a settings admin binds. Every route here ran AuthGuard and BusinessGuard only: a
 * STAFF member with every module none pushed any contact, or the default segment of every contact
 * with an email, PRIVATE ones included, to an account an ADMIN with crm none had bound; and Mailchimp's
 * host was the binder's text (MailchimpConnector now pins it to <dc>.api.mailchimp.com).
 *
 * Now the provider lists and campaigns are content read, triggering a campaign is content write, and a
 * push is content write, crm read (assertMayExport, CONNECTOR_EXPORT_READS) and sends only the contacts
 * every receiver may open: the member pushing and the member who bound the account (exportAudience).
 */
@Controller('marketing')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
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

  @RequireModuleScope('content', 'read')
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

  @RequireModuleScope('content', 'write')
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
    @Req() req?: MarketingRequest,
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
    await assertMayExport(this.prisma, businessId, req?.user, CONNECTOR_EXPORT_READS[body.provider], `pushing contacts to ${body.provider}`);
    const audience = await exportAudience(this.prisma, businessId, body.provider, req?.user);

    let contactIds = Array.isArray(body.contactIds) ? body.contactIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
    if (contactIds.length === 0) {
      const where: Record<string, unknown> = { businessId, deletedAt: null, email: { not: null }, doNotContact: { not: true } };
      if (body.segment?.status) where.status = body.segment.status;
      if (typeof body.segment?.marketingOptIn === 'boolean') where.marketingOptIn = body.segment.marketingOptIn;
      if (body.segment?.tag) where.tags = { has: body.segment.tag };
      const found = await this.prisma.client.contact.findMany({ where, select: { id: true }, take: 500 });
      contactIds = found.map((c) => c.id);
    }
    // Only the contacts every receiver may open are sent; the rest are counted as not sent, with why.
    const inView = await contactIdsEveryReceiverMayOpen(this.prisma, businessId, audience, contactIds);
    const outOfView = contactIds.filter((id) => !inView.has(id)).length;
    const sendable = contactIds.filter((id) => inView.has(id));
    if (sendable.length === 0) {
      return {
        provider: body.provider, listId: body.listId, total: contactIds.length, created: 0, updated: 0, failed: outOfView,
        errors: [outOfView ? `${outOfView} contact(s) not sent: outside the view of the member pushing them or of the account they would go to` : 'No contacts matched the segment'],
      };
    }
    const result = await target.connector.subscribeContacts(businessId, body.listId, sendable);
    return {
      provider: body.provider,
      listId: body.listId,
      total: contactIds.length,
      ...result,
      failed: result.failed + outOfView,
      errors: outOfView ? [...result.errors, `${outOfView} contact(s) not sent: outside the view of the member pushing them or of the account they would go to`] : result.errors,
    };
  }

  @RequireModuleScope('content', 'read')
  @Get('businesses/:businessId/lists/campaigns/:provider')
  async campaigns(@Param('businessId') businessId: string, @Param('provider') provider: string) {
    if (provider !== 'mailchimp' && provider !== 'klaviyo') throw new BadRequestException('Unknown provider');
    const connector = provider === 'mailchimp' ? this.mailchimp : this.klaviyo;
    if (!(await connector.isConnected(businessId))) throw new ForbiddenException(`${provider} is not connected`);
    const out = await connector.listCampaigns(businessId);
    if (!out.success) throw new BadRequestException(out.error ?? 'Failed to list campaigns');
    return { provider, campaigns: out.campaigns ?? [] };
  }

  @RequireModuleScope('content', 'write')
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

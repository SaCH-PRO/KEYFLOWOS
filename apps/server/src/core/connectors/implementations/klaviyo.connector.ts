import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';

const CONNECTOR_TYPE = 'klaviyo' as const;

@Injectable()
export class KlaviyoConnector implements IConnector {
  private readonly logger = new Logger(KlaviyoConnector.name);

  readonly meta: ConnectorMeta = {
    type: CONNECTOR_TYPE,
    name: 'Klaviyo',
    description: 'Sync segments, flows, and engagement events with Klaviyo',
    category: 'email_marketing',
    group: 'marketing',
    icon: 'send',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'api_key',
    connectMode: 'dialog',
    externalUrl: 'https://www.klaviyo.com/dashboard',
    connectInstructions:
      'In Klaviyo go to Settings → API keys to generate a Private API key (full access). Paste it below.',
    credentialFields: [
      { key: 'apiKey', label: 'Private API key', type: 'password', required: true, secret: true, placeholder: 'pk_xxxxxxxxxxxxxxxx' },
      { key: 'accountName', label: 'Account name (display)', type: 'text', placeholder: 'Acme Tobago' },
    ],
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    return { connected: await this.isConnected(businessId) };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const apiKey =
      (await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey')) ||
      process.env.KLAVIYO_API_KEY;
    const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'klaviyoAccount');
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: apiKey ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: apiKey ? (stored?.connectedAccount ?? accountName ?? 'Klaviyo Account') : null,
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return { type: this.meta.type, name: this.meta.name, category: this.meta.category, status: health.status, connectedAccount: health.connectedAccount };
  }

  async isConnected(businessId: string): Promise<boolean> {
    return (await this.healthCheck(businessId)).status === 'connected';
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    if (!(await this.isConnected(businessId))) {
      return { success: false, itemsSynced: 0, errors: ['Klaviyo not connected'], duration: Date.now() - start };
    }
    const campaigns = await this.prisma.client.emailCampaign.count({ where: { businessId, deletedAt: null } }).catch(() => 0);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: campaigns, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.credentials.clearCredentials(businessId, CONNECTOR_TYPE);
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, error: 'No Klaviyo API key configured' };
    const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'klaviyoAccount');
    return { success: true, account: accountName ?? 'Klaviyo Account' };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, error: 'No Klaviyo API key configured' };
    try {
      const res = await fetch('https://a.klaviyo.com/api/accounts/', {
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          Accept: 'application/vnd.api+json',
          revision: '2024-10-15',
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Klaviyo API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { data?: Array<{ id?: string; attributes?: { contact_information?: { organization_name?: string }; preferred_currency?: string } }> };
      const first = data.data?.[0];
      const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'klaviyoAccount');
      await this.trackActivity(businessId);
      return {
        success: true,
        action: 'Fetched Klaviyo /api/accounts',
        account: first?.attributes?.contact_information?.organization_name ?? accountName ?? first?.id ?? 'Klaviyo Account',
        detail: first?.attributes?.preferred_currency ? `Currency: ${first.attributes.preferred_currency}` : undefined,
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async emitCampaignSent(businessId: string, opts: { campaignId: string; campaignName: string; recipientCount: number; externalId?: string }) {
    await this.trackActivity(businessId);
    this.events.emit('campaign.sent', {
      campaign: { id: opts.campaignId, name: opts.campaignName, externalSource: 'klaviyo', externalId: opts.externalId },
      businessId,
      recipientCount: opts.recipientCount,
    });
  }

  async emitSubscriberEvent(businessId: string, opts: { event: string; email: string; campaignId?: string; externalId?: string }) {
    await this.trackActivity(businessId);
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'klaviyo',
      email: opts.email,
      externalId: opts.externalId,
    });
    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'klaviyo',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });
    return { contactId: resolved.contactId, event: opts.event };
  }

  // ---------------------------------------------------------------------------
  // Operability surface (used by /app/marketing/lists)
  // ---------------------------------------------------------------------------

  private klaviyoHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      revision: '2024-10-15',
    };
  }

  async listLists(businessId: string): Promise<{ success: boolean; lists?: Array<{ id: string; name: string; memberCount: number; provider: 'klaviyo' }>; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Klaviyo is not connected' };
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, error: 'No Klaviyo API key configured' };
    try {
      const res = await fetch('https://a.klaviyo.com/api/lists/?fields[list]=name,profile_count', {
        headers: this.klaviyoHeaders(apiKey),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Klaviyo ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { data?: Array<{ id: string; attributes?: { name?: string; profile_count?: number } }> };
      const lists = (data.data ?? []).map((l) => ({
        id: l.id,
        name: l.attributes?.name ?? l.id,
        memberCount: l.attributes?.profile_count ?? 0,
        provider: 'klaviyo' as const,
      }));
      await this.trackActivity(businessId);
      return { success: true, lists };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async subscribeContacts(
    businessId: string,
    listId: string,
    contactIds: string[],
  ): Promise<{ success: boolean; created: number; updated: number; failed: number; errors: string[] }> {
    if (!(await this.isConnected(businessId))) {
      return { success: false, created: 0, updated: 0, failed: contactIds.length, errors: ['Klaviyo is not connected'] };
    }
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, created: 0, updated: 0, failed: contactIds.length, errors: ['No Klaviyo API key configured'] };
    const contacts = await this.prisma.client.contact.findMany({
      where: { id: { in: contactIds }, businessId, deletedAt: null, email: { not: null } },
    });
    if (contacts.length === 0) {
      return { success: false, created: 0, updated: 0, failed: 0, errors: ['No contacts with email addresses'] };
    }

    let created = 0;
    let failed = 0;
    const errors: string[] = [];
    const profileIds: string[] = [];

    for (const contact of contacts) {
      try {
        const profileBody = {
          data: {
            type: 'profile',
            attributes: {
              email: contact.email,
              first_name: contact.firstName ?? undefined,
              last_name: contact.lastName ?? undefined,
              phone_number: contact.phone ?? undefined,
            },
          },
        };
        const profRes = await fetch('https://a.klaviyo.com/api/profiles/', {
          method: 'POST',
          headers: this.klaviyoHeaders(apiKey),
          body: JSON.stringify(profileBody),
        });
        let profileId: string | null = null;
        if (profRes.ok) {
          const created201 = (await profRes.json()) as { data?: { id?: string } };
          profileId = created201.data?.id ?? null;
          created += 1;
        } else if (profRes.status === 409) {
          const conflict = (await profRes.json()) as { errors?: Array<{ meta?: { duplicate_profile_id?: string } }> };
          profileId = conflict.errors?.[0]?.meta?.duplicate_profile_id ?? null;
        } else {
          const body = await profRes.text().catch(() => '');
          failed += 1;
          errors.push(`${contact.email}: ${profRes.status}${body ? ` ${body.slice(0, 80)}` : ''}`);
          continue;
        }
        if (profileId) profileIds.push(profileId);
      } catch (err: any) {
        failed += 1;
        errors.push(`${contact.email}: ${err instanceof Error ? err.message : 'Network error'}`);
      }
    }

    let updated = 0;
    if (profileIds.length > 0) {
      try {
        const subBody = {
          data: profileIds.map((id) => ({ type: 'profile', id })),
        };
        const subRes = await fetch(`https://a.klaviyo.com/api/lists/${encodeURIComponent(listId)}/relationships/profiles/`, {
          method: 'POST',
          headers: this.klaviyoHeaders(apiKey),
          body: JSON.stringify(subBody),
        });
        if (subRes.ok) {
          updated = profileIds.length;
        } else {
          const body = await subRes.text().catch(() => '');
          errors.push(`List subscribe ${subRes.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
          failed += profileIds.length;
        }
      } catch (err: any) {
        errors.push(err instanceof Error ? err.message : 'Network error');
        failed += profileIds.length;
      }
    }

    await this.trackActivity(businessId);
    return { success: errors.length === 0 || (created + updated) > 0, created, updated, failed, errors };
  }

  async listCampaigns(businessId: string): Promise<{ success: boolean; campaigns?: Array<{ id: string; name: string; status: string }>; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Klaviyo is not connected' };
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, error: 'No Klaviyo API key configured' };
    try {
      const res = await fetch("https://a.klaviyo.com/api/campaigns/?filter=equals(messages.channel,'email')&fields[campaign]=name,status", {
        headers: this.klaviyoHeaders(apiKey),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Klaviyo ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { data?: Array<{ id: string; attributes?: { name?: string; status?: string } }> };
      const campaigns = (data.data ?? []).map((c) => ({
        id: c.id,
        name: c.attributes?.name ?? c.id,
        status: c.attributes?.status ?? 'unknown',
      }));
      return { success: true, campaigns };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async triggerCampaign(businessId: string, campaignId: string): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Klaviyo is not connected' };
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, error: 'No Klaviyo API key configured' };
    try {
      const res = await fetch('https://a.klaviyo.com/api/campaign-send-jobs/', {
        method: 'POST',
        headers: this.klaviyoHeaders(apiKey),
        body: JSON.stringify({ data: { type: 'campaign-send-job', id: campaignId } }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Klaviyo ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      await this.trackActivity(businessId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
      create: { businessId, connectorType: CONNECTOR_TYPE, status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Klaviyo activity failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
    });
  }
}

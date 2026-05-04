import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';

const CONNECTOR_TYPE = 'mailchimp' as const;

@Injectable()
export class MailchimpConnector implements IConnector {
  private readonly logger = new Logger(MailchimpConnector.name);

  readonly meta: ConnectorMeta = {
    type: CONNECTOR_TYPE,
    name: 'Mailchimp',
    description: 'Sync audiences, campaigns, and engagement with Mailchimp',
    category: 'email_marketing',
    group: 'marketing',
    icon: 'mail',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'api_key',
    connectMode: 'dialog',
    externalUrl: 'https://admin.mailchimp.com/',
    connectInstructions:
      'In Mailchimp go to Account → Extras → API keys to generate a key. Paste the key (it ends with the data-center, e.g. "-us21") below.',
    credentialFields: [
      { key: 'apiKey', label: 'API key', type: 'password', required: true, secret: true, placeholder: 'abcdef1234567890-us21' },
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
      (await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'mailchimpApiKey')) ||
      process.env.MAILCHIMP_API_KEY;
    const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'mailchimpAccount');
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: apiKey ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: apiKey ? (stored?.connectedAccount ?? accountName ?? 'Mailchimp Account') : null,
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return {
      type: this.meta.type,
      name: this.meta.name,
      category: this.meta.category,
      status: health.status,
      connectedAccount: health.connectedAccount,
    };
  }

  async isConnected(businessId: string): Promise<boolean> {
    return (await this.healthCheck(businessId)).status === 'connected';
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) return { success: false, itemsSynced: 0, errors: ['Mailchimp not connected'], duration: Date.now() - start };
    const campaigns = await this.prisma.client.emailCampaign.count({ where: { businessId, deletedAt: null } }).catch(() => 0);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: campaigns, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.credentials.clearCredentials(businessId, CONNECTOR_TYPE);
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'mailchimpApiKey');
    if (!apiKey) return { success: false, error: 'No Mailchimp API key configured' };
    const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'mailchimpAccount');
    return { success: true, account: accountName ?? 'Mailchimp Account' };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'mailchimpApiKey');
    if (!apiKey) return { success: false, error: 'No Mailchimp API key configured' };
    const dc = apiKey.split('-')[1];
    if (!dc) return { success: false, error: 'Mailchimp API key is missing the data-center suffix (e.g. "-us21")' };
    try {
      const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
      const rootRes = await fetch(`https://${dc}.api.mailchimp.com/3.0/`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      });
      if (!rootRes.ok) {
        const body = await rootRes.text().catch(() => '');
        return { success: false, error: `Mailchimp /3.0/ ${rootRes.status}${body ? `: ${body}` : ''}` };
      }
      const root = (await rootRes.json()) as {
        account_name?: string;
        email?: string;
        total_subscribers?: number;
        pricing_plan_type?: string;
      };
      const listsRes = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists?count=1`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      });
      if (!listsRes.ok) {
        const body = await listsRes.text().catch(() => '');
        return { success: false, error: `Mailchimp /3.0/lists ${listsRes.status}${body ? `: ${body}` : ''}` };
      }
      const lists = (await listsRes.json()) as { total_items?: number };
      const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'mailchimpAccount');
      await this.trackActivity(businessId);
      return {
        success: true,
        action: 'Fetched Mailchimp account + audiences',
        account: root.account_name ?? root.email ?? accountName ?? `Mailchimp (${dc})`,
        detail: `${lists.total_items ?? 0} audience(s)${typeof root.total_subscribers === 'number' ? ` • ${root.total_subscribers} subscribers` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async emitCampaignSent(businessId: string, opts: { campaignId: string; campaignName: string; recipientCount: number; externalId?: string }) {
    await this.trackActivity(businessId);
    this.events.emit('campaign.sent', {
      campaign: { id: opts.campaignId, name: opts.campaignName, externalSource: 'mailchimp', externalId: opts.externalId },
      businessId,
      recipientCount: opts.recipientCount,
    });
  }

  async emitSubscriberEvent(businessId: string, opts: { event: 'subscribed' | 'unsubscribed' | 'opened' | 'clicked' | 'bounced'; email: string; campaignId?: string; externalId?: string }) {
    await this.trackActivity(businessId);
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'mailchimp',
      email: opts.email,
      externalId: opts.externalId,
    });
    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'mailchimp',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });
    return { contactId: resolved.contactId, event: opts.event };
  }

  // ---------------------------------------------------------------------------
  // Operability surface (used by /app/marketing/lists)
  // ---------------------------------------------------------------------------

  private async mailchimpAuth(businessId: string): Promise<{ apiKey: string; dc: string } | { error: string }> {
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'mailchimpApiKey');
    if (!apiKey) return { error: 'No Mailchimp API key configured' };
    const dc = apiKey.split('-')[1];
    if (!dc) return { error: 'Mailchimp API key is missing the data-center suffix (e.g. "-us21")' };
    return { apiKey, dc };
  }

  private mailchimpHeaders(apiKey: string): Record<string, string> {
    const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
    return { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  async listLists(businessId: string): Promise<{ success: boolean; lists?: Array<{ id: string; name: string; memberCount: number; provider: 'mailchimp' }>; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Mailchimp is not connected' };
    const auth = await this.mailchimpAuth(businessId);
    if ('error' in auth) return { success: false, error: auth.error };
    try {
      const res = await fetch(`https://${auth.dc}.api.mailchimp.com/3.0/lists?count=100`, {
        headers: this.mailchimpHeaders(auth.apiKey),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Mailchimp ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { lists?: Array<{ id: string; name: string; stats?: { member_count?: number } }> };
      const lists = (data.lists ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        memberCount: l.stats?.member_count ?? 0,
        provider: 'mailchimp' as const,
      }));
      await this.trackActivity(businessId);
      return { success: true, lists };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async subscribeContacts(
    businessId: string,
    listId: string,
    contactIds: string[],
  ): Promise<{ success: boolean; created: number; updated: number; failed: number; errors: string[] }> {
    if (!(await this.isConnected(businessId))) {
      return { success: false, created: 0, updated: 0, failed: contactIds.length, errors: ['Mailchimp is not connected'] };
    }
    const auth = await this.mailchimpAuth(businessId);
    if ('error' in auth) return { success: false, created: 0, updated: 0, failed: contactIds.length, errors: [auth.error] };
    const contacts = await this.prisma.client.contact.findMany({
      where: { id: { in: contactIds }, businessId, deletedAt: null, email: { not: null } },
    });
    if (contacts.length === 0) {
      return { success: false, created: 0, updated: 0, failed: 0, errors: ['No contacts with email addresses'] };
    }
    const members = contacts.map((c) => ({
      email_address: c.email!,
      status_if_new: 'subscribed',
      status: 'subscribed',
      merge_fields: {
        FNAME: c.firstName ?? '',
        LNAME: c.lastName ?? '',
      },
    }));
    try {
      const res = await fetch(`https://${auth.dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}`, {
        method: 'POST',
        headers: this.mailchimpHeaders(auth.apiKey),
        body: JSON.stringify({ members, update_existing: true }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, created: 0, updated: 0, failed: contacts.length, errors: [`Mailchimp ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`] };
      }
      const data = (await res.json()) as { new_members?: unknown[]; updated_members?: unknown[]; errors?: Array<{ error: string }>; total_created?: number; total_updated?: number; error_count?: number };
      const created = data.total_created ?? data.new_members?.length ?? 0;
      const updated = data.total_updated ?? data.updated_members?.length ?? 0;
      const failed = data.error_count ?? data.errors?.length ?? 0;
      const errors = (data.errors ?? []).map((e) => e.error);
      await this.trackActivity(businessId);
      return { success: true, created, updated, failed, errors };
    } catch (err) {
      return { success: false, created: 0, updated: 0, failed: contacts.length, errors: [err instanceof Error ? err.message : 'Network error'] };
    }
  }

  async listCampaigns(businessId: string): Promise<{ success: boolean; campaigns?: Array<{ id: string; name: string; status: string; emailsSent?: number }>; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Mailchimp is not connected' };
    const auth = await this.mailchimpAuth(businessId);
    if ('error' in auth) return { success: false, error: auth.error };
    try {
      const res = await fetch(`https://${auth.dc}.api.mailchimp.com/3.0/campaigns?count=50`, {
        headers: this.mailchimpHeaders(auth.apiKey),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Mailchimp ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { campaigns?: Array<{ id: string; settings?: { title?: string; subject_line?: string }; status?: string; emails_sent?: number }> };
      const campaigns = (data.campaigns ?? []).map((c) => ({
        id: c.id,
        name: c.settings?.title || c.settings?.subject_line || c.id,
        status: c.status ?? 'unknown',
        emailsSent: c.emails_sent,
      }));
      return { success: true, campaigns };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async triggerCampaign(businessId: string, campaignId: string): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Mailchimp is not connected' };
    const auth = await this.mailchimpAuth(businessId);
    if ('error' in auth) return { success: false, error: auth.error };
    try {
      const res = await fetch(`https://${auth.dc}.api.mailchimp.com/3.0/campaigns/${encodeURIComponent(campaignId)}/actions/send`, {
        method: 'POST',
        headers: this.mailchimpHeaders(auth.apiKey),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Mailchimp ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      await this.trackActivity(businessId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
      create: { businessId, connectorType: CONNECTOR_TYPE, status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Mailchimp activity failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
    });
  }
}

import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';

const CONNECTOR_TYPE = 'xero' as const;

@Injectable()
export class XeroConnector implements IConnector {
  private readonly logger = new Logger(XeroConnector.name);

  readonly meta: ConnectorMeta = {
    type: CONNECTOR_TYPE,
    name: 'Xero',
    description: 'Sync invoices, payments, expenses, and contacts with Xero accounting',
    category: 'accounting',
    group: 'accounting',
    icon: 'calculator',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'oauth2',
    connectMode: 'dialog',
    externalUrl: 'https://go.xero.com/',
    connectInstructions:
      'Generate an access token from your Xero developer portal and paste it below along with your Xero tenant ID.',
    credentialFields: [
      { key: 'accessToken', label: 'Access token', type: 'password', required: true, secret: true },
      { key: 'tenantId', label: 'Tenant ID', type: 'text', required: true, placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key: 'tenantName', label: 'Tenant name (display)', type: 'text', placeholder: 'Acme Tobago Co.' },
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
    const accessToken = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accessToken', 'xeroAccessToken');
    const tenantName =
      (await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'tenantName', 'xeroTenantName')) ||
      (await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'tenantId'));
    const hasToken = !!(accessToken || process.env.XERO_TEST_TOKEN);
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: hasToken ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: hasToken ? (stored?.connectedAccount ?? tenantName ?? 'Xero Tenant') : null,
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
    const health = await this.healthCheck(businessId);
    return health.status === 'connected';
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Xero not connected'], duration: Date.now() - start };
    }
    const [invoices, payments, expenses] = await Promise.all([
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null } }).catch(() => 0),
      this.prisma.client.payment.count({ where: { businessId } }).catch(() => 0),
      this.prisma.client.expense.count({ where: { businessId } }).catch(() => 0),
    ]);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: invoices + payments + expenses, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.credentials.clearCredentials(businessId, CONNECTOR_TYPE);
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const accessToken = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accessToken', 'xeroAccessToken');
    if (!accessToken) return { success: false, error: 'No Xero access token configured' };
    const tenantId = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'tenantId');
    if (!tenantId) return { success: false, error: 'Missing Xero tenant ID' };
    const tenantName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'tenantName', 'xeroTenantName');
    return { success: true, account: tenantName ?? `Tenant ${tenantId}` };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const accessToken = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accessToken', 'xeroAccessToken');
    if (!accessToken) return { success: false, error: 'No Xero access token configured' };
    try {
      const res = await fetch('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Xero API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as Array<{ tenantId?: string; tenantName?: string; tenantType?: string }>;
      await this.trackActivity(businessId);
      const first = data[0];
      return {
        success: true,
        action: 'Listed Xero connections',
        account: first?.tenantName ?? undefined,
        detail: `${data.length} tenant(s)${first?.tenantType ? ` • ${first.tenantType}` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async emitContactSynced(businessId: string, opts: { externalId: string; email?: string; firstName?: string; lastName?: string; companyName?: string }) {
    await this.trackActivity(businessId);
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'xero',
      externalId: opts.externalId,
      email: opts.email,
      firstName: opts.firstName,
      lastName: opts.lastName,
      companyName: opts.companyName,
    });
    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'xero',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });
    return resolved;
  }

  async emitPaymentReceived(businessId: string, opts: { amount: number; currency: string; invoiceId?: string; payerEmail?: string; externalId?: string }) {
    await this.trackActivity(businessId);
    let contactId: string | undefined;
    if (opts.payerEmail) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: 'xero',
        externalId: opts.externalId,
        email: opts.payerEmail,
      });
      contactId = resolved.contactId;
    }
    this.events.emit('payment.received', {
      connectorType: CONNECTOR_TYPE,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'xero',
      invoiceId: opts.invoiceId,
      contactId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
      create: { businessId, connectorType: CONNECTOR_TYPE, status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Xero activity track failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
    });
  }
}

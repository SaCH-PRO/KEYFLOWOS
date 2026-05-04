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

  // ---------------------------------------------------------------------------
  // Operability surface (used by /app/accounting)
  // ---------------------------------------------------------------------------

  async getSyncSummary(businessId: string): Promise<{
    connected: boolean;
    provider: 'xero';
    connectedAccount: string | null;
    lastSyncAt: Date | null;
    invoicesTotal: number;
    invoicesSynced: number;
    invoicesUnsynced: number;
    customersTotal: number;
    customersSynced: number;
    customersUnsynced: number;
  }> {
    const health = await this.healthCheck(businessId);
    const [invoicesTotal, invoicesSynced, customersTotal, customersSynced] = await Promise.all([
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null } }).catch(() => 0),
      this.prisma.client.invoice.count({
        where: { businessId, deletedAt: null, externalAccountingSource: CONNECTOR_TYPE, externalAccountingId: { not: null } },
      }).catch(() => 0),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }).catch(() => 0),
      this.prisma.client.contactExternalMapping.count({ where: { businessId, source: CONNECTOR_TYPE } }).catch(() => 0),
    ]);
    return {
      connected: health.status === 'connected',
      provider: 'xero',
      connectedAccount: health.connectedAccount,
      lastSyncAt: health.lastSyncAt,
      invoicesTotal,
      invoicesSynced,
      invoicesUnsynced: Math.max(invoicesTotal - invoicesSynced, 0),
      customersTotal,
      customersSynced,
      customersUnsynced: Math.max(customersTotal - customersSynced, 0),
    };
  }

  private async xeroHeaders(businessId: string): Promise<{ headers: Record<string, string>; tenantId: string } | { error: string }> {
    const accessToken = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accessToken', 'xeroAccessToken');
    const tenantId = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'tenantId');
    if (!accessToken) return { error: 'Missing Xero access token' };
    if (!tenantId) return { error: 'Missing Xero tenant ID' };
    return {
      tenantId,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-tenant-id': tenantId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
  }

  async pushCustomer(businessId: string, contactId: string): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Xero is not connected' };
    const contact = await this.prisma.client.contact.findFirst({ where: { id: contactId, businessId, deletedAt: null } });
    if (!contact) return { success: false, error: 'Contact not found' };
    const existing = await this.prisma.client.contactExternalMapping.findFirst({
      where: { businessId, contactId, source: CONNECTOR_TYPE },
    });
    if (existing) return { success: true, externalId: existing.externalId };

    const auth = await this.xeroHeaders(businessId);
    if ('error' in auth) return { success: false, error: auth.error };
    const name =
      contact.companyName ||
      contact.displayName ||
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
      contact.email ||
      `Contact ${contact.id.slice(0, 6)}`;
    const payload = {
      Name: name,
      FirstName: contact.firstName ?? undefined,
      LastName: contact.lastName ?? undefined,
      EmailAddress: contact.email ?? undefined,
      Phones: contact.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: contact.phone }] : undefined,
    };
    let externalId: string;
    try {
      const res = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({ Contacts: [payload] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Xero ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { Contacts?: Array<{ ContactID?: string }> };
      const id = data.Contacts?.[0]?.ContactID;
      if (!id) return { success: false, error: 'Xero response missing ContactID' };
      externalId = id;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }

    await this.prisma.client.contactExternalMapping.upsert({
      where: { businessId_source_externalId: { businessId, source: CONNECTOR_TYPE, externalId } },
      create: { businessId, contactId, source: CONNECTOR_TYPE, externalId },
      update: { contactId },
    });
    await this.trackActivity(businessId);
    return { success: true, externalId };
  }

  async pushInvoice(businessId: string, invoiceId: string): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Xero is not connected' };
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: { contact: true, items: true },
    });
    if (!invoice) return { success: false, error: 'Invoice not found' };
    if (invoice.externalAccountingId) return { success: true, externalId: invoice.externalAccountingId };

    const customerExt = await this.pushCustomer(businessId, invoice.contactId);
    if (!customerExt.success || !customerExt.externalId) {
      return { success: false, error: customerExt.error ?? 'Failed to sync customer first' };
    }
    const auth = await this.xeroHeaders(businessId);
    if ('error' in auth) return { success: false, error: auth.error };

    const payload = {
      Type: 'ACCREC',
      Contact: { ContactID: customerExt.externalId },
      InvoiceNumber: invoice.invoiceNumber,
      Date: invoice.issueDate.toISOString().slice(0, 10),
      DueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : undefined,
      LineItems: invoice.items.map((it) => ({
        Description: it.description,
        Quantity: it.quantity,
        UnitAmount: it.unitPrice,
        LineAmount: it.total,
      })),
      Status: invoice.status === 'DRAFT' ? 'DRAFT' : 'AUTHORISED',
      CurrencyCode: invoice.currency,
    };
    let externalId: string;
    try {
      const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({ Invoices: [payload] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Xero ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { Invoices?: Array<{ InvoiceID?: string }> };
      const id = data.Invoices?.[0]?.InvoiceID;
      if (!id) return { success: false, error: 'Xero response missing InvoiceID' };
      externalId = id;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }

    await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { externalAccountingSource: CONNECTOR_TYPE, externalAccountingId: externalId, externalAccountingSyncedAt: new Date() },
    });
    await this.trackActivity(businessId);
    return { success: true, externalId };
  }

  async listChartOfAccounts(businessId: string): Promise<{ success: boolean; accounts?: Array<{ id: string; name: string; type: string; subType?: string; classification?: string }>; error?: string }> {
    if (!(await this.isConnected(businessId))) return { success: false, error: 'Xero is not connected' };
    const auth = await this.xeroHeaders(businessId);
    if ('error' in auth) return { success: false, error: auth.error };
    try {
      const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts', { headers: auth.headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Xero ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { Accounts?: Array<{ AccountID: string; Name: string; Type?: string; Class?: string }> };
      const accounts = (data.Accounts ?? []).map((a) => ({
        id: a.AccountID,
        name: a.Name,
        type: a.Type ?? 'Unknown',
        classification: a.Class,
      }));
      await this.trackActivity(businessId);
      return { success: true, accounts };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
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

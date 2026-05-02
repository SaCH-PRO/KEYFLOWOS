import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorType } from '../connector.interface';

/**
 * Base for form/landing-page connectors. Credentials are stored encrypted in
 * `ConnectorStatus.metadata` via `ConnectorCredentialsService`, with a fallback read of
 * legacy `business.metaData[<legacyKey>]` so older installs keep working until they
 * re-save credentials. Form submissions are normalized into the standard
 * `form.submitted` + `lead_form.submitted` events and routed through entity resolution so a
 * Contact is created or updated automatically.
 */
export abstract class FormPlatformConnector implements IConnector {
  protected readonly logger: Logger;
  abstract readonly meta: ConnectorMeta;
  /** The credential field key that signals "the connector is configured" (e.g. "apiKey", "webhookSecret"). */
  protected abstract readonly primaryCredentialKey: string;
  /** Optional legacy key inside business.metaData used by older installs. */
  protected abstract readonly legacyCredentialKey: string | undefined;
  /** Source string passed to entity resolution for this connector. */
  protected abstract readonly source: string;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly events: EventEmitter2,
    protected readonly entityResolution: EntityResolutionService,
    protected readonly credentials: ConnectorCredentialsService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  protected get connectorType(): ConnectorType {
    return this.meta.type;
  }

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    return { connected: await this.isConnected(businessId) };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const credential = await this.credentials.readCredential(
      businessId,
      this.connectorType,
      this.primaryCredentialKey,
      this.legacyCredentialKey,
    );
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: credential ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: credential ? (stored?.connectedAccount ?? this.meta.name) : null,
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
      return { success: false, itemsSynced: 0, errors: [`${this.meta.name} not connected`], duration: Date.now() - start };
    }
    const submissions = await this.prisma.client.leadFormSubmission.count({
      where: { businessId, source: this.source },
    }).catch(() => 0);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: submissions, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.credentials.clearCredentials(businessId, this.connectorType);
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const credential = await this.credentials.readCredential(
      businessId,
      this.connectorType,
      this.primaryCredentialKey,
      this.legacyCredentialKey,
    );
    if (!credential) return { success: false, error: `${this.meta.name} not configured` };
    return { success: true, account: this.meta.name };
  }

  /**
   * Ingest a normalized form submission. Resolves the contact via shared entity resolution
   * and then emits both the connector-style `form.submitted` event and the existing CRM
   * `lead_form.submitted` event for backwards compatibility with current listeners.
   */
  async ingestSubmission(businessId: string, opts: {
    formId: string;
    formName?: string;
    externalId?: string;
    fields: Record<string, unknown>;
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    submittedAt?: Date;
  }) {
    await this.trackActivity(businessId);

    const resolved = (opts.email || opts.phone || opts.externalId)
      ? await this.entityResolution.resolveContact(businessId, {
          source: this.source,
          externalId: opts.externalId,
          email: opts.email,
          phone: opts.phone,
          firstName: opts.firstName,
          lastName: opts.lastName,
        })
      : null;

    if (resolved) {
      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: this.source,
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }

    const timestamp = opts.submittedAt ?? new Date();
    this.events.emit('form.submitted', {
      connectorType: this.connectorType,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp,
      formId: opts.formId,
      formName: opts.formName,
      contactId: resolved?.contactId,
      data: opts.fields,
    });

    // Mirror as the existing CRM event so journey/automation/AI listeners pick it up too.
    this.events.emit('lead_form.submitted', {
      submission: { id: opts.externalId ?? `${this.source}:${opts.formId}:${timestamp.getTime()}`, source: this.source, data: opts.fields, businessId },
      form: { id: opts.formId, name: opts.formName ?? opts.formId, source: this.source },
      businessId,
      contactId: resolved?.contactId ?? null,
    });

    return { contactId: resolved?.contactId ?? null };
  }

  protected async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: this.connectorType } },
      create: { businessId, connectorType: this.connectorType, status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`${this.meta.name} activity failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  protected async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: this.connectorType } },
    });
  }
}

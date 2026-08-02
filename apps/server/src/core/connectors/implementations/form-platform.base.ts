import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorType, ConnectorSmokeResult, IngestionItemInput } from '../connector.interface';

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

  /**
   * Form platforms push to us; there is no provider pull to perform.
   *
   * This previously counted LOCAL leadFormSubmission rows and returned
   * `success: true, itemsSynced: <lifetime local count>` without contacting the
   * provider at all. The UI reported "Typeform synced — 47 items" when nothing
   * had been fetched, the nightly scheduler recorded it as a real sync, and
   * connector.synced fired with a fabricated count. A `.catch(() => 0)` on the
   * count also meant a failing query reported success with zero items.
   *
   * Returns the same explicit unsupported result the other non-pull connectors
   * use, so the scheduler treats it as skipped rather than healthy, and the UI
   * says what actually happened.
   */
  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    return {
      success: false,
      itemsSynced: 0,
      unsupported: true,
      code: 'PULL_SYNC_NOT_IMPLEMENTED',
      errors: ['Form connectors receive data by webhook; provider pull is not implemented.'],
      duration: 0,
    };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.credentials.clearCredentials(businessId, this.connectorType);
  }

  parseInbound(payload: unknown, _businessId: string): IngestionItemInput[] {
    const raw = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    const fields = (raw.fields ?? raw.data ?? raw) as Record<string, unknown>;
    const formId = (raw.formId as string | undefined) ?? (raw.form_id as string | undefined) ?? (raw.formID as string | undefined) ?? this.source;
    const formName = (raw.formName as string | undefined) ?? (raw.formTitle as string | undefined);
    const externalId = (raw.externalId as string | undefined) ?? (raw.submissionID as string | undefined) ?? (raw.id as string | undefined) ?? formId;
    const email = (raw.email as string | undefined) ?? this.findFieldByPattern(fields, /email/i, /@/);
    const phone = (raw.phone as string | undefined) ?? this.findFieldByPattern(fields, /phone|mobile/i);
    const firstName = (raw.firstName as string | undefined) ?? this.findFieldByPattern(fields, /first|fname|name_first/i);
    const lastName = (raw.lastName as string | undefined) ?? this.findFieldByPattern(fields, /last|lname|name_last/i);
    const name = firstName || lastName ? `${firstName ?? ''} ${lastName ?? ''}`.trim() : undefined;

    return [
      {
        sourceType: 'manual',
        sourceConnectorType: this.connectorType,
        externalId,
        receivedAt: raw.submittedAt ? new Date(raw.submittedAt as string) : new Date(),
        from: { id: externalId, name, email, phone },
        subject: formName ? `Form submission: ${formName}` : `Form submission: ${formId}`,
        body: typeof raw.message === 'string' ? raw.message : JSON.stringify(fields).slice(0, 2000),
        rawPayload: raw as Record<string, unknown>,
      },
    ];
  }

  verifyWebhook(_payload: unknown, signature: string | undefined, secret: string): boolean {
    if (!signature || !secret) return false;
    try {
      return signature === secret;
    } catch {
      return false;
    }
  }

  private findFieldByPattern(fields: Record<string, unknown>, keyPattern: RegExp, valuePattern?: RegExp): string | undefined {
    for (const [k, v] of Object.entries(fields)) {
      if (!keyPattern.test(k)) continue;
      const sv = typeof v === 'string' ? v : '';
      if (!sv) continue;
      if (!valuePattern || valuePattern.test(sv)) return sv;
    }
    return undefined;
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
   * Subclasses override to call the platform's "who am I" endpoint with the stored
   * primary credential. Default implementation just verifies the credential exists.
   */
  protected async pingProvider(_credential: string): Promise<ConnectorSmokeResult> {
    return { success: true, action: 'Verified stored credential is present' };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const credential = await this.credentials.readCredential(
      businessId,
      this.connectorType,
      this.primaryCredentialKey,
      this.legacyCredentialKey,
    );
    if (!credential) return { success: false, error: `${this.meta.name} not configured` };
    try {
      const result = await this.pingProvider(credential);
      if (result.success) await this.trackActivity(businessId);
      return result;
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
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

    // Honor per-form `autoCreate` toggle from the mapping metadata. When the user
    // disabled auto-create for this form, we still record the submission but
    // skip contact creation (we only attach to existing matches).
    const autoCreate = await this.isAutoCreateAllowed(businessId, opts.formId);

    const canResolve = opts.email || opts.phone || opts.externalId;
    let resolved: { contactId: string; isNew: boolean; merged: boolean; matchedOn: string } | null = null;
    if (canResolve) {
      if (autoCreate) {
        resolved = await this.entityResolution.resolveContact(businessId, {
          source: this.source,
          externalId: opts.externalId,
          email: opts.email,
          phone: opts.phone,
          firstName: opts.firstName,
          lastName: opts.lastName,
        });
      } else {
        // Auto-create disabled: only attach if a contact already exists. Never create
        // (avoids transient row + spurious `contact.created` events that would trigger
        // automations downstream).
        const match = await this.entityResolution.findContactIdByMatch(businessId, {
          source: this.source,
          externalId: opts.externalId,
          email: opts.email,
          phone: opts.phone,
        });
        if (match) {
          resolved = {
            contactId: match.contactId,
            isNew: false,
            merged: false,
            matchedOn: match.matchedOn,
          };
        }
      }
    }

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

    // Persist into LeadFormSubmission for unified Forms UI (list/responses/backfill).
    // Auto-create a "virtual" LeadForm row keyed by `${source}:${formId}` so each
    // external form gets its own bucket of submissions.
    const externalKey = `${this.source}:${opts.formId}`;
    let leadFormId: string | null = null;
    try {
      const existingForm = await this.prisma.client.leadForm.findFirst({
        where: { businessId, embedCode: externalKey, deletedAt: null },
        select: { id: true, name: true },
      });
      if (existingForm) {
        leadFormId = existingForm.id;
        if (opts.formName && opts.formName !== existingForm.name) {
          await this.prisma.client.leadForm.update({
            where: { id: existingForm.id },
            data: { name: opts.formName },
          }).catch(() => undefined);
        }
      } else {
        const created = await this.prisma.client.leadForm.create({
          data: {
            businessId,
            name: opts.formName ?? `${this.meta.name} ${opts.formId}`,
            description: `Auto-created from ${this.meta.name} (formId=${opts.formId})`,
            fields: [] as unknown as object,
            settings: { externalSource: this.source, externalFormId: opts.formId } as unknown as object,
            embedCode: externalKey,
            isActive: true,
          },
        });
        leadFormId = created.id;
      }
    } catch (err: any) {
      this.logger.warn(`Could not upsert virtual LeadForm: ${(err as Error).message}`);
    }

    if (leadFormId) {
      try {
        await this.prisma.client.leadFormSubmission.create({
          data: {
            formId: leadFormId,
            businessId,
            data: { ...(opts.fields as object), __externalId: opts.externalId ?? null },
            contactId: resolved?.contactId ?? null,
            source: this.source,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Could not persist submission: ${(err as Error).message}`);
      }
    }

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

    return { contactId: resolved?.contactId ?? null, leadFormId };
  }

  /**
   * Look up the per-form `autoCreate` toggle stored alongside the field mapping.
   * Returns true when no mapping exists (default behavior).
   */
  private async isAutoCreateAllowed(businessId: string, formId: string): Promise<boolean> {
    try {
      const status = await this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: this.connectorType } },
        select: { metadata: true },
      });
      const meta = (status?.metadata ?? {}) as Record<string, unknown>;
      const formMappings = (meta.formMappings ?? {}) as Record<string, { autoCreate?: boolean }>;
      const mapping = formMappings[formId];
      if (!mapping) return true;
      return mapping.autoCreate !== false;
    } catch {
      return true;
    }
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

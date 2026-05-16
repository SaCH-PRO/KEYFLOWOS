import { Body, Controller, Delete, Get, Post, Param, Query, UseGuards, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { ConnectorHealthMonitorService } from './connector-health-monitor.service';
import { ConnectorCredentialsService } from './connector-credentials.service';
import { AuthGuard } from '../auth/auth.guard';
import { BusinessGuard } from '../auth/business.guard';
import { apiLink } from '../config/runtime-urls';
import { randomBytes } from 'crypto';
import type { ConnectorType, ConnectorCredentialField } from './connector.interface';

@Controller('connectors')
@UseGuards(AuthGuard, BusinessGuard)
export class ConnectorController {
  constructor(
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(ConnectorActivityService) private readonly activity: ConnectorActivityService,
    @Inject(ConnectorHealthMonitorService) private readonly healthMonitor: ConnectorHealthMonitorService,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
  ) {}

  @Get('businesses/:businessId/dashboard')
  async getDashboard(@Param('businessId') businessId: string) {
    return this.registry.getDashboard(businessId);
  }

  @Get('businesses/:businessId/list')
  listConnectors() {
    return this.registry.list();
  }

  @Get('businesses/:businessId/statuses')
  async getStatuses(@Param('businessId') businessId: string) {
    return this.registry.getStatuses(businessId);
  }

  @Get('businesses/:businessId/health/:type')
  async getHealth(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    const health = await this.registry.getHealth(type as ConnectorType, businessId);
    if (!health) throw new BadRequestException(`Connector ${type} not found`);
    return health;
  }

  @Post('businesses/:businessId/sync/:type')
  async sync(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.syncConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/disconnect/:type')
  async disconnect(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      await this.registry.disconnectConnector(type as ConnectorType, businessId);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Disconnect failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/authenticate/:type')
  async authenticate(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.authenticateConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/reconnect/:type')
  async reconnect(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.reconnectConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Reconnect failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/test/:type')
  async test(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.testConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Test failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/smoke/:type')
  async smoke(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.smokeTestConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Smoke test failed';
      throw new BadRequestException(message);
    }
  }

  @Get('businesses/:businessId/needs-attention')
  async needsAttention(@Param('businessId') businessId: string) {
    return this.healthMonitor.needsAttention(businessId);
  }

  @Post('businesses/:businessId/health-check/run')
  async runHealthCheck(@Param('businessId') businessId: string) {
    return this.healthMonitor.tickBusiness(businessId);
  }

  /**
   * Returns the credential schema + masked existing values for a connector. Used by the
   * frontend connect dialog to render the form. Secrets come back as "•••• <last4>"
   * — the plaintext is never sent to the browser.
   */
  @Get('businesses/:businessId/credentials/:type')
  async getCredentials(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    const connector = this.registry.get(type as ConnectorType);
    if (!connector) throw new NotFoundException(`Connector ${type} not found`);
    const schema: ConnectorCredentialField[] = connector.meta.credentialFields ?? [];
    const values = schema.length
      ? await this.credentials.getMaskedCredentials(businessId, type as ConnectorType, schema)
      : {};
    const isConfigured = await this.credentials.hasCredentials(businessId, type as ConnectorType);
    return {
      type,
      name: connector.meta.name,
      connectMode: connector.meta.connectMode ?? (connector.meta.authType === 'oauth2' ? 'oauth' : 'dialog'),
      authType: connector.meta.authType,
      instructions: connector.meta.connectInstructions ?? null,
      oauthStartPath: connector.meta.oauthStartPath ?? null,
      fields: schema,
      values,
      isConfigured,
    };
  }

  /**
   * Save credentials for a connector. Secret fields whose value is the masked preview
   * (or empty) are ignored so the user can update only a subset of fields. Returns the
   * updated health record.
   */
  @Post('businesses/:businessId/credentials/:type')
  async saveCredentials(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
    @Body() body: { values?: Record<string, string>; accountLabel?: string },
  ) {
    const connector = this.registry.get(type as ConnectorType);
    if (!connector) throw new NotFoundException(`Connector ${type} not found`);
    const schema: ConnectorCredentialField[] = connector.meta.credentialFields ?? [];
    if (!schema.length) {
      throw new BadRequestException(`${connector.meta.name} does not accept credential input`);
    }

    const incoming = body.values ?? {};
    const existing = (await this.credentials.getCredentials(businessId, type as ConnectorType)) ?? {};
    const merged: Record<string, string> = { ...existing };
    const missing: string[] = [];
    for (const field of schema) {
      const raw = (incoming[field.key] ?? '').trim();
      const looksMasked = raw.startsWith('••••');
      if (raw && !looksMasked) merged[field.key] = raw;
      if (field.required && !merged[field.key]) missing.push(field.label);
    }
    if (missing.length) {
      throw new BadRequestException(`Missing required field(s): ${missing.join(', ')}`);
    }

    const accountLabel = body.accountLabel?.trim() || merged.accountLabel || merged.realmName || merged.tenantName || merged.account || null;
    await this.credentials.setCredentials(businessId, type as ConnectorType, merged, {
      accountLabel: accountLabel ?? undefined,
    });
    const health = await this.registry.getHealth(type as ConnectorType, businessId);
    return { success: true, health };
  }

  @Delete('businesses/:businessId/credentials/:type')
  async deleteCredentials(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    const connector = this.registry.get(type as ConnectorType);
    if (!connector) throw new NotFoundException(`Connector ${type} not found`);
    await this.credentials.clearCredentials(businessId, type as ConnectorType);
    return { success: true };
  }

  /**
   * Returns the per-business webhook URL (and HMAC secret) for connectors that ingest
   * data via inbound webhooks (Typeform, Jotform, generic webhook_form). Generates the
   * secret on first read and persists it in `ConnectorStatus.metadata.encryptedCredentials`.
   */
  @Get('businesses/:businessId/webhook-info/:type')
  async getWebhookInfo(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    const connector = this.registry.get(type as ConnectorType);
    if (!connector) throw new NotFoundException(`Connector ${type} not found`);
    if (!connector.meta.supportsWebhook) {
      throw new BadRequestException(`${connector.meta.name} does not expose a webhook URL`);
    }

    const stored = (await this.credentials.getCredentials(businessId, type as ConnectorType)) ?? {};
    let secret = stored.webhookSecret;
    if (!secret) {
      secret = randomBytes(24).toString('hex');
      await this.credentials.setCredentials(
        businessId,
        type as ConnectorType,
        { ...stored, webhookSecret: secret },
        { accountLabel: stored.accountLabel || `${connector.meta.name} (webhook)` },
      );
    }
    const url = apiLink(`/webhooks/forms/${businessId}/${type}`);
    return {
      url,
      secret,
      headerName: 'x-keyflow-signature',
      sampleCurl: `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-keyflow-signature: ${secret}' \\\n  -d '{"formId":"contact-us","email":"jane@example.com","fields":{"name":"Jane Doe"}}'`,
    };
  }

  @Get('businesses/:businessId/activity')
  async listActivity(
    @Param('businessId') businessId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    let sinceDate: Date | undefined;
    if (since) {
      const parsed = new Date(since);
      if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
    }
    return this.activity.list(businessId, {
      connectorType: type ? (type as ConnectorType) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      since: sinceDate,
    });
  }
}

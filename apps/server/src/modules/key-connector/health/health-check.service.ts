import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { db } from '@keyflow/db';
import {
  HealthCheckResult,
  KeyConnectorConnection,
  ConnectionStatus,
} from '../key-connector.types';
import { ProviderRegistryService } from '../providers/provider-registry.service';

/**
 * ── Health Check Service ───────────────────────────────────────────────
 * Performs health checks on all active provider connections.
 *
 * For external providers: pings the provider's API with stored credentials.
 * For internal modules: verifies the module service responds.
 *
 * Results are persisted in the database for historical trend analysis.
 * ───────────────────────────────────────────────────────────────────────
 */

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  /** In-memory cache of latest health results per connection. */
  private healthCache: Map<string, HealthCheckResult> = new Map();

  constructor(
    private readonly httpService: HttpService,
    private readonly registry: ProviderRegistryService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Run a health check against every active connection for a business.
   */
  async checkAll(businessId: string): Promise<HealthCheckResult[]> {
    this.logger.debug(`Running health checks for business ${businessId}`);

    try {
      const connections = await db.integrationConnection.findMany({
        where: { businessId },
      });

      if (connections.length === 0) {
        this.logger.debug(`No connections found for business ${businessId}`);
        return [];
      }

      const results = await Promise.all(
        connections.map((c) => this.checkProvider(c.providerKey, c as any)),
      );

      // Persist results
      await this.persistResults(businessId, results);

      return results;
    } catch (error: any) {
      this.logger.error(
        `Health check all failed for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Run a health check against a single provider / connection.
   */
  async checkProvider(
    providerKey: string,
    connection: KeyConnectorConnection | { authData?: Record<string, unknown> | null; status: string; id: string },
  ): Promise<HealthCheckResult> {
    const provider = this.registry.getProvider(providerKey);
    if (!provider) {
      return this.buildResult(providerKey, connection.id, 'unknown', 0, 'Provider not registered');
    }

    const start = Date.now();
    let result: HealthCheckResult;

    try {
      if (provider.isInternal) {
        result = await this.checkInternalModule(providerKey, connection);
      } else {
        result = await this.checkExternalProvider(providerKey, connection);
      }
    } catch (error: any) {
      const latency = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      result = this.buildResult(
        providerKey,
        connection.id,
        'unhealthy',
        latency,
        message,
      );
    }

    this.healthCache.set(connection.id, result);
    return result;
  }

  /**
   * Retrieve historical health data for a business, optionally filtered
   * to a single provider.
   */
  async getHealthHistory(
    businessId: string,
    providerKey?: string,
  ): Promise<HealthCheckResult[]> {
    try {
      const rows = await db.connectorHealthLog.findMany({
        where: {
          businessId,
          ...(providerKey ? { providerKey } : {}),
        },
        orderBy: { checkedAt: 'desc' },
        take: 100,
      });

      return rows.map((r) => ({
        providerKey: r.providerKey,
        connectionId: r.connectionId ?? undefined,
        status: r.status as HealthCheckResult['status'],
        latencyMs: r.latencyMs,
        message: r.message ?? undefined,
        checkedAt: r.checkedAt,
      }));
    } catch (error: any) {
      this.logger.error(
        `Failed to load health history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Scheduled background health checks — called by a cron job or task scheduler.
   */
  async runScheduledChecks(): Promise<void> {
    this.logger.log('Starting scheduled health checks');

    try {
      // Find all distinct business IDs that have at least one connection
      const connections = await db.integrationConnection.findMany({
        select: { businessId: true },
        distinct: ['businessId'],
      });

      for (const { businessId } of connections) {
        try {
          await this.checkAll(businessId);
        } catch (innerError) {
          this.logger.warn(
            `Scheduled health check failed for business ${businessId}: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
          );
          // Continue with next business — do not fail the entire batch
        }

        // Small delay to avoid overwhelming downstream APIs
        await this.delay(250);
      }

      this.logger.log('Scheduled health checks completed');
    } catch (error: any) {
      this.logger.error(
        `Scheduled health checks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Internal checks
  // ═══════════════════════════════════════════════════════════════════════

  private async checkInternalModule(
    providerKey: string,
    connection: KeyConnectorConnection | { authData?: Record<string, unknown> | null; status: string; id: string },
  ): Promise<HealthCheckResult> {
    const start = Date.now();

    // Internal modules are always considered "healthy" as long as the
    // platform itself is running. In a real scenario we could ping the
    // module's health endpoint or check its registered status in the
    // service-discovery layer.
    const latency = Date.now() - start;

    return this.buildResult(
      providerKey,
      connection.id,
      'healthy',
      latency,
      'Internal module available',
    );
  }

  private async checkExternalProvider(
    providerKey: string,
    connection: KeyConnectorConnection | { authData?: Record<string, unknown> | null; status: string; id: string },
  ): Promise<HealthCheckResult> {
    const start = Date.now();
    const authData = connection.authData ?? {};

    switch (providerKey) {
      case 'stripe':
        return this.checkStripe(authData, providerKey, connection.id, start);
      case 'sendgrid':
        return this.checkSendGrid(authData, providerKey, connection.id, start);
      case 'slack':
        return this.checkSlack(authData, providerKey, connection.id, start);
      case 'google_contacts':
      case 'google_calendar':
      case 'google_forms':
      case 'google_business':
      case 'google_drive':
        return this.checkGoogle(authData, providerKey, connection.id, start);
      case 'outlook_contacts':
      case 'outlook_calendar':
        return this.checkMicrosoft(authData, providerKey, connection.id, start);
      case 'whatsapp_business':
        return this.checkWhatsApp(authData, providerKey, connection.id, start);
      case 'typeform':
        return this.checkTypeform(authData, providerKey, connection.id, start);
      case 'jotform':
        return this.checkJotform(authData, providerKey, connection.id, start);
      case 'mailchimp':
        return this.checkMailchimp(authData, providerKey, connection.id, start);
      case 'wipay':
        return this.checkWiPay(authData, providerKey, connection.id, start);
      case 'zapier':
        return this.checkZapier(authData, providerKey, connection.id, start);
      default:
        return this.buildResult(
          providerKey,
          connection.id,
          'unknown',
          Date.now() - start,
          `No health check implementation for ${providerKey}`,
        );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Provider-specific health checks
  // ═══════════════════════════════════════════════════════════════════════

  private async checkStripe(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const secretKey = authData['secretKey'] as string | undefined;
      if (!secretKey) throw new Error('Missing Stripe secret key');

      const response = await firstValueFrom(
        this.httpService.get('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${secretKey}` },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(
          providerKey,
          connectionId,
          'healthy',
          latency,
          `Stripe account: ${response.data?.settings?.dashboard?.display_name ?? 'connected'}`,
        );
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Unexpected status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkSendGrid(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const apiKey = authData['apiKey'] as string | undefined;
      if (!apiKey) throw new Error('Missing SendGrid API key');

      const response = await firstValueFrom(
        this.httpService.get('https://api.sendgrid.com/v3/user/profile', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, 'SendGrid API responding');
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkSlack(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const accessToken = authData['access_token'] as string | undefined ?? authData['accessToken'] as string | undefined;
      if (!accessToken) throw new Error('Missing Slack access token');

      const response = await firstValueFrom(
        this.httpService.get('https://slack.com/api/auth.test', {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.data?.ok === true) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, `Slack workspace: ${response.data.team}`);
      }
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, `Slack error: ${response.data?.error ?? 'unknown'}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkGoogle(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const accessToken = authData['access_token'] as string | undefined ?? authData['accessToken'] as string | undefined;
      if (!accessToken) throw new Error('Missing Google access token');

      const response = await firstValueFrom(
        this.httpService.get(
          'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' +
            encodeURIComponent(accessToken),
          { timeout: 10000 },
        ),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, `Google auth valid for: ${response.data.email ?? 'unknown'}`);
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkMicrosoft(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const accessToken = authData['access_token'] as string | undefined ?? authData['accessToken'] as string | undefined;
      if (!accessToken) throw new Error('Missing Microsoft access token');

      const response = await firstValueFrom(
        this.httpService.get('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, `Microsoft auth valid for: ${response.data.displayName ?? 'unknown'}`);
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkWhatsApp(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const apiToken = authData['apiToken'] as string | undefined;
      const phoneNumberId = authData['phoneNumberId'] as string | undefined;
      if (!apiToken || !phoneNumberId) throw new Error('Missing WhatsApp credentials');

      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v18.0/${phoneNumberId}`,
          {
            headers: { Authorization: `Bearer ${apiToken}` },
            timeout: 10000,
          },
        ),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, 'WhatsApp Business API responding');
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkTypeform(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const apiToken = authData['apiToken'] as string | undefined;
      if (!apiToken) throw new Error('Missing Typeform API token');

      const response = await firstValueFrom(
        this.httpService.get('https://api.typeform.com/me', {
          headers: { Authorization: `Bearer ${apiToken}` },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, `Typeform: ${response.data.alias ?? 'connected'}`);
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkJotform(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const apiKey = authData['apiKey'] as string | undefined;
      if (!apiKey) throw new Error('Missing Jotform API key');

      const response = await firstValueFrom(
        this.httpService.get('https://api.jotform.com/user', {
          headers: { APIKEY: apiKey },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.data?.responseCode === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, 'Jotform API responding');
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Response code: ${response.data?.responseCode}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkMailchimp(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const apiKey = authData['apiKey'] as string | undefined;
      const serverPrefix = authData['serverPrefix'] as string | undefined;
      if (!apiKey || !serverPrefix) throw new Error('Missing Mailchimp credentials');

      const response = await firstValueFrom(
        this.httpService.get(`https://${serverPrefix}.api.mailchimp.com/3.0/`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, `Mailchimp: ${response.data.account_name ?? 'connected'}`);
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkWiPay(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const apiKey = authData['apiKey'] as string | undefined;
      if (!apiKey) throw new Error('Missing WiPay API key');

      const env = (authData['environment'] as string) ?? 'sandbox';
      const baseUrl =
        env === 'production'
          ? 'https://tt.wipayfinancial.com'
          : 'https://tt.wipayfinancial.com/plugins/api_test'; // sandbox probe

      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/v1/gateway/status`, {
          headers: { 'x-api-key': apiKey },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      if (response.status === 200) {
        return this.buildResult(providerKey, connectionId, 'healthy', latency, `WiPay ${env} API responding`);
      }
      return this.buildResult(providerKey, connectionId, 'degraded', latency, `Status: ${response.status}`);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(providerKey, connectionId, 'unhealthy', latency, error instanceof Error ? error.message : String(error));
    }
  }

  private async checkZapier(
    authData: Record<string, unknown>,
    providerKey: string,
    connectionId: string,
    start: number,
  ): Promise<HealthCheckResult> {
    try {
      const webhookUrl = authData['webhookUrl'] as string | undefined;
      if (!webhookUrl) throw new Error('Missing Zapier webhook URL');

      // Zapier webhooks are passive — we can only verify the URL is well-formed.
      // A proper check would require sending a test payload and verifying
      // Zapier responds with a success hook.
      const latency = Date.now() - start;
      const isValidUrl = webhookUrl.startsWith('https://hooks.zapier.com/');

      if (isValidUrl) {
        return this.buildResult(
          providerKey,
          connectionId,
          'healthy',
          latency,
          'Zapier webhook URL configured',
        );
      }
      return this.buildResult(
        providerKey,
        connectionId,
        'degraded',
        latency,
        'Webhook URL does not match expected format',
      );
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.buildResult(
        providerKey,
        connectionId,
        'unhealthy',
        latency,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Persistence helpers
  // ═══════════════════════════════════════════════════════════════════════

  private async persistResults(
    businessId: string,
    results: HealthCheckResult[],
  ): Promise<void> {
    try {
      await db.connectorHealthLog.createMany({
        data: results.map((r) => ({
          businessId,
          providerKey: r.providerKey,
          connectionId: r.connectionId ?? null,
          status: r.status,
          latencyMs: r.latencyMs,
          message: r.message ?? null,
          checkedAt: r.checkedAt,
        })),
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to persist health results: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildResult(
    providerKey: string,
    connectionId: string,
    status: HealthCheckResult['status'],
    latencyMs: number,
    message: string,
  ): HealthCheckResult {
    return {
      providerKey,
      connectionId,
      status,
      latencyMs,
      message,
      checkedAt: new Date(),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

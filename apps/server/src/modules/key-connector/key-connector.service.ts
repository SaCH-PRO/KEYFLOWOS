import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { db } from '@keyflow/db';
import {
  KeyConnectorProviderDef,
  KeyConnectorConnection,
  SyncJob,
  HealthCheckResult,
  AiGatewayCommand,
  AiGatewayResult,
  ConnectorAuditEntry,
  ConnectionStatus,
  SyncStatus,
} from './key-connector.types';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { HealthCheckService } from './health/health-check.service';
import { SyncEngineService } from './sync/sync-engine.service';
import { AiGatewayService } from './ai-gateway/ai-gateway.service';

/**
 * ── Key Connector Service ──────────────────────────────────────────────
 * The central orchestrator for the KeyConnector module.
 *
 * Unifies IntegrationHub (16 external providers), Connect (deep sync),
 * and KeyCortex (19 internal modules) behind a single API surface.
 *
 * Responsibilities:
 *   • Provider discovery with connection status
 *   • Connection lifecycle (create, read, delete)
 *   • Sync orchestration (schedule, monitor, retry)
 *   • Health monitoring
 *   • AI command routing
 *   • Audit logging
 * ───────────────────────────────────────────────────────────────────────
 */

@Injectable()
export class KeyConnectorService {
  private readonly logger = new Logger(KeyConnectorService.name);

  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly healthCheck: HealthCheckService,
    private readonly syncEngine: SyncEngineService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // Provider Discovery
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * List all providers with the connection status for a given business.
   * Optionally filter by category.
   */
  async getProviders(
    businessId: string,
    category?: string,
  ): Promise<
    Array<{
      provider: KeyConnectorProviderDef;
      connection?: KeyConnectorConnection;
    }>
  > {
    try {
      const defs = category
        ? this.registry.getProvidersByCategory(category as never)
        : this.registry.getAllProviders();

      const connections = await db.integrationConnection.findMany({
        where: { businessId },
      });

      const connectionMap = new Map(connections.map((c) => [c.providerKey, c]));

      return defs.map((def) => {
        const dbConn = connectionMap.get(def.key);
        return {
          provider: def,
          connection: dbConn
            ? this.mapDbToConnection(dbConn as any)
            : undefined,
        };
      });
    } catch (error: any) {
      this.logger.error(
        `getProviders failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get a single provider definition together with the business's
   * connection for that provider (if any).
   */
  async getProviderDetail(
    businessId: string,
    providerKey: string,
  ): Promise<{
    provider: KeyConnectorProviderDef;
    connection?: KeyConnectorConnection;
  }> {
    const provider = this.registry.getProvider(providerKey);
    if (!provider) {
      throw new NotFoundException(`Provider "${providerKey}" not found`);
    }

    const connection = await db.integrationConnection.findFirst({
      where: { businessId, providerKey },
    });

    return {
      provider,
      connection: connection
        ? this.mapDbToConnection(connection)
        : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Connection Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create a new connection for a provider.
   */
  async connectProvider(
    businessId: string,
    userId: string,
    providerKey: string,
    authData: Record<string, unknown>,
    settings?: Record<string, unknown>,
    displayName?: string,
  ): Promise<KeyConnectorConnection> {
    const provider = this.registry.getProvider(providerKey);
    if (!provider) {
      throw new NotFoundException(`Provider "${providerKey}" not found`);
    }

    // Prevent duplicate connections for the same provider
    const existing = await db.integrationConnection.findFirst({
      where: { businessId, providerKey },
    });
    if (existing) {
      throw new BadRequestException(
        `Connection for provider "${providerKey}" already exists. Disconnect first.`,
      );
    }

    try {
      const connection = await db.integrationConnection.create({
        data: {
          businessId,
          providerKey,
          status: 'connected',
          displayName:
            displayName ?? provider.name,
          authData,
          settings: settings ?? {},
          lastSyncAt: null,
          lastError: null,
          healthScore: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await this.audit(
        businessId,
        userId,
        providerKey,
        connection.id,
        'connect_provider',
        'success',
        { providerName: provider.name },
      );

      this.logger.log(
        `Business ${businessId} connected provider ${providerKey} (connection: ${connection.id})`,
      );

      return this.mapDbToConnection(connection);
    } catch (error: any) {
      await this.audit(
        businessId,
        userId,
        providerKey,
        undefined,
        'connect_provider',
        'error',
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }
  }

  /**
   * Remove a connection.
   */
  async disconnectProvider(
    businessId: string,
    connectionId: string,
    userId?: string,
  ): Promise<void> {
    const connection = await db.integrationConnection.findFirst({
      where: { id: connectionId, businessId },
    });

    if (!connection) {
      throw new NotFoundException(
        `Connection "${connectionId}" not found for this business`,
      );
    }

    try {
      await db.integrationConnection.delete({
        where: { id: connectionId },
      });

      await this.audit(
        businessId,
        userId,
        connection.providerKey,
        connectionId,
        'disconnect_provider',
        'success',
      );

      this.logger.log(
        `Business ${businessId} disconnected provider ${connection.providerKey} (connection: ${connectionId})`,
      );
    } catch (error: any) {
      await this.audit(
        businessId,
        userId,
        connection.providerKey,
        connectionId,
        'disconnect_provider',
        'error',
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }
  }

  /**
   * List all connections for a business.
   */
  async getConnections(
    businessId: string,
  ): Promise<KeyConnectorConnection[]> {
    try {
      const rows = await db.integrationConnection.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
      });

      return rows.map((r) => this.mapDbToConnection(r));
    } catch (error: any) {
      this.logger.error(
        `getConnections failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Health
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Run health checks against all connections for a business.
   */
  async getConnectionHealth(
    businessId: string,
  ): Promise<HealthCheckResult[]> {
    return this.healthCheck.checkAll(businessId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Sync
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Manually trigger a sync for a connection.
   */
  async triggerSync(
    businessId: string,
    connectionId: string,
    direction: 'inbound' | 'outbound' | 'bidirectional' = 'bidirectional',
  ): Promise<SyncJob> {
    const connection = await db.integrationConnection.findFirst({
      where: { id: connectionId, businessId },
    });

    if (!connection) {
      throw new NotFoundException(
        `Connection "${connectionId}" not found for this business`,
      );
    }

    return this.syncEngine.scheduleSync(
      this.mapDbToConnection(connection),
      direction,
    );
  }

  /**
   * Get sync history for a business.
   */
  async getSyncHistory(
    businessId: string,
    connectionId?: string,
    limit = 50,
  ): Promise<SyncJob[]> {
    if (connectionId) {
      const jobs = await this.syncEngine.getSyncHistory(businessId, limit);
      return jobs.filter((j) => j.connectionId === connectionId);
    }
    return this.syncEngine.getSyncHistory(businessId, limit);
  }

  // Convenience aliases for organ adapters
  async listProviders(businessId: string, category?: string): Promise<ReturnType<KeyConnectorService['getProviders']>> {
    return this.getProviders(businessId, category);
  }

  async listConnections(businessId: string): Promise<KeyConnectorConnection[]> {
    return this.getConnections(businessId);
  }

  async checkHealth(businessId: string, connectionId: string): Promise<HealthCheckResult | undefined> {
    const results = await this.getConnectionHealth(businessId);
    return results.find((r) => r.connectionId === connectionId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AI Gateway
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Process an AI/natural-language command and route it to the
   * appropriate module or provider.
   */
  async processAiCommand(
    businessId: string,
    userId: string,
    command: AiGatewayCommand,
  ): Promise<AiGatewayResult> {
    // If the command already specifies a module or provider, route directly
    if (command.module) {
      return this.aiGateway.executeModuleAction(
        command.module,
        command.action ?? 'query',
        command.parameters,
        { businessId, userId, start: Date.now() },
      );
    }

    if (command.provider) {
      return this.aiGateway.executeProviderAction(
        command.provider,
        command.action ?? 'query',
        command.parameters,
        { businessId, userId, start: Date.now() },
      );
    }

    // Otherwise, try to parse and route from NL
    return this.aiGateway.routeCommand(
      businessId,
      userId,
      (command.parameters.originalText as string) ?? command.intent,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Audit
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Retrieve the connector audit log for a business.
   */
  async getAuditLog(
    businessId: string,
    limit = 100,
  ): Promise<ConnectorAuditEntry[]> {
    try {
      const rows = await db.connectorAuditLog.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return rows.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        userId: r.userId ?? undefined,
        providerKey: r.providerKey ?? undefined,
        connectionId: r.connectionId ?? undefined,
        action: r.action,
        status: r.status as 'success' | 'error' | 'warning',
        details: r.details ? JSON.parse(r.details as string) : undefined,
        createdAt: r.createdAt,
      }));
    } catch (error: any) {
      this.logger.error(
        `getAuditLog failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════

  private mapDbToConnection(
    row: {
      id: string;
      businessId: string;
      providerKey: string;
      status: string;
      displayName: string | null;
      authData: unknown;
      settings: unknown;
      lastSyncAt: Date | null;
      lastError: string | null;
      healthScore: number;
      createdAt: Date;
      updatedAt: Date;
    },
  ): KeyConnectorConnection {
    return {
      id: row.id,
      businessId: row.businessId,
      providerKey: row.providerKey,
      status: row.status as ConnectionStatus,
      displayName: row.displayName || row.providerKey,
      authData: (row.authData as Record<string, unknown>) ?? undefined,
      settings: (row.settings as Record<string, unknown>) ?? undefined,
      lastSyncAt: row.lastSyncAt ?? undefined,
      lastError: row.lastError ?? undefined,
      healthScore: row.healthScore,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async audit(
    businessId: string,
    userId?: string,
    providerKey?: string,
    connectionId?: string,
    action?: string,
    status?: 'success' | 'error' | 'warning',
    details?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.connectorAuditLog.create({
        data: {
          businessId,
          userId: userId ?? null,
          providerKey: providerKey ?? null,
          connectionId: connectionId ?? null,
          action: action ?? 'unknown',
          status: status ?? 'success',
          details: details ? JSON.stringify(details) : null,
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      this.logger.warn(
        `Audit log write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

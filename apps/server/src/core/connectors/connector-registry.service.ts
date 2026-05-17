import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import type {
  IConnector,
  ConnectorType,
  ConnectorHealth,
  ConnectorMeta,
  ConnectorCategory,
  ConnectorStatusSummary,
  ConnectorSmokeResult,
} from './connector.interface';

export interface ConnectorDashboardEntry {
  meta: ConnectorMeta;
  health: ConnectorHealth;
}

@Injectable()
export class ConnectorRegistryService {
  private readonly logger = new Logger(ConnectorRegistryService.name);
  private readonly connectors = new Map<ConnectorType, IConnector>();

  constructor(
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  register(connector: IConnector): void {
    this.connectors.set(connector.meta.type, connector);
    this.logger.log(`Connector registered: ${connector.meta.type} (${connector.meta.name})`);
  }

  get(type: ConnectorType): IConnector | null {
    return this.connectors.get(type) ?? null;
  }

  list(): ConnectorMeta[] {
    return Array.from(this.connectors.values()).map((c) => c.meta);
  }

  listByCategory(category: ConnectorCategory): ConnectorMeta[] {
    return this.list().filter((m) => m.category === category);
  }

  async getHealth(type: ConnectorType, businessId: string): Promise<ConnectorHealth | null> {
    const connector = this.connectors.get(type);
    if (!connector) return null;
    try {
      return await connector.healthCheck(businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Health check failed for ${type}: ${message}`);
      return {
        status: 'error',
        lastSyncAt: null,
        lastErrorAt: new Date(),
        lastError: message,
        errorCount: 1,
        syncCount: 0,
        connectedAt: null,
        connectedAccount: null,
      };
    }
  }

  async getStatuses(businessId: string): Promise<ConnectorStatusSummary[]> {
    const summaries: ConnectorStatusSummary[] = [];
    for (const connector of this.connectors.values()) {
      try {
        summaries.push(await connector.getStatus(businessId));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`getStatus failed for ${connector.meta.type}: ${message}`);
        summaries.push({
          type: connector.meta.type,
          name: connector.meta.name,
          category: connector.meta.category,
          status: 'error',
          connectedAccount: null,
        });
      }
    }
    return summaries;
  }

  async getDashboard(businessId: string): Promise<ConnectorDashboardEntry[]> {
    const entries: ConnectorDashboardEntry[] = [];
    for (const connector of this.connectors.values()) {
      const health = await this.getHealth(connector.meta.type, businessId);
      if (health) {
        entries.push({ meta: connector.meta, health });
      }
    }
    return entries;
  }

  async syncConnector(type: ConnectorType, businessId: string) {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    const startTime = Date.now();
    try {
      const result = await connector.sync(businessId);
      this.events.emit('connector.synced', {
        connectorType: type,
        businessId,
        timestamp: new Date(),
        itemsSynced: result.itemsSynced,
        duration: result.duration,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.events.emit('connector.error', {
        connectorType: type,
        businessId,
        timestamp: new Date(),
        error: message,
        duration: Date.now() - startTime,
      });
      throw err;
    }
  }

  async disconnectConnector(type: ConnectorType, businessId: string): Promise<void> {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    await connector.disconnect(businessId);
    this.events.emit('connector.disconnected', {
      connectorType: type,
      businessId,
      timestamp: new Date(),
    });
  }

  async authenticateConnector(type: ConnectorType, businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    const result = await connector.authenticate(businessId);
    if (result.connected) {
      this.events.emit('connector.connected', {
        connectorType: type,
        businessId,
        timestamp: new Date(),
      });
    }
    return result;
  }

  async testConnector(
    type: ConnectorType,
    businessId: string,
  ): Promise<{ success: boolean; error?: string; account?: string }> {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    const startedAt = Date.now();
    let result: { success: boolean; error?: string; account?: string };
    try {
      if (typeof connector.testConnection === 'function') {
        result = await connector.testConnection(businessId);
      } else {
        const isConn = await connector.isConnected(businessId);
        result = isConn ? { success: true } : { success: false, error: 'Not connected' };
      }
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    this.events.emit('connector.tested', {
      connectorType: type,
      businessId,
      timestamp: new Date(),
      success: result.success,
      error: result.error,
      duration: Date.now() - startedAt,
    });
    return result;
  }

  async smokeTestConnector(
    type: ConnectorType,
    businessId: string,
  ): Promise<ConnectorSmokeResult> {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    const startedAt = Date.now();
    let result: ConnectorSmokeResult;
    try {
      if (typeof connector.smokeTest === 'function') {
        result = await connector.smokeTest(businessId);
      } else if (typeof connector.testConnection === 'function') {
        const t = await connector.testConnection(businessId);
        result = {
          success: t.success,
          account: t.account,
          error: t.error,
          action: 'Verified credentials with provider',
        };
      } else {
        const isConn = await connector.isConnected(businessId);
        result = isConn
          ? { success: true, action: 'Verified stored connection' }
          : { success: false, error: 'Not connected' };
      }
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (result.success) {
      try {
        const update: { lastSyncAt: Date; status: string; connectedAccount?: string } = {
          lastSyncAt: new Date(),
          status: 'connected',
        };
        if (result.account) update.connectedAccount = result.account;
        await this.prisma.client.connectorStatus.upsert({
          where: { businessId_connectorType: { businessId, connectorType: type } },
          create: {
            businessId,
            connectorType: type,
            status: 'connected',
            lastSyncAt: new Date(),
            syncCount: 1,
            connectedAccount: result.account ?? null,
          },
          update: {
            ...update,
            syncCount: { increment: 1 },
          },
        });
      } catch (e) {
        this.logger.warn(
          `Failed to persist smoke success for ${type}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    this.events.emit('connector.smoke_tested', {
      connectorType: type,
      businessId,
      timestamp: new Date(),
      success: result.success,
      action: result.action,
      account: result.account,
      detail: result.detail,
      error: result.error,
      duration: Date.now() - startedAt,
    });
    return result;
  }

  async reconnectConnector(type: ConnectorType, businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    try {
      await connector.disconnect(businessId);
    } catch (err) {
        this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
      }

    return this.authenticateConnector(type, businessId);
  }
}

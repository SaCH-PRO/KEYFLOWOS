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

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

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
    const statuses = await this.prisma.client.connectorStatus.findMany({ where: { businessId } });
    const statusMap = new Map(statuses.map((s) => [s.connectorType, s]));
    const keyInboxDefaultCategories = new Set(['communication', 'messaging', 'forms', 'email_marketing']);

    for (const connector of this.connectors.values()) {
      const health = await this.getHealth(connector.meta.type, businessId);
      if (health) {
        const status = statusMap.get(connector.meta.type);
        const flows = {
          keyInbox: status ? status.intakeEnabled : keyInboxDefaultCategories.has(connector.meta.category),
          temporal: health.status === 'connected',
        };
        entries.push({ meta: connector.meta, health: { ...health, flows } });
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
      // Only broadcast a "synced" event for a genuinely successful sync — never
      // for a failed or unsupported result, which would imply work that did not
      // happen.
      if (result.success) {
        this.events.emit('connector.synced', {
          connectorType: type,
          businessId,
          timestamp: new Date(),
          itemsSynced: result.itemsSynced,
          duration: result.duration,
        });
      }
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
    } catch (err: any) {
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
    // R0-CMF6b review (SEC-CMF6b-2): the gmail mailbox this smoke test acts on,
    // bound before the connector reads its token.
    let gmailMailbox: string | null = null;
    try {
      if (type === 'gmail') gmailMailbox = await this.linkedGmailMailboxOf(businessId);
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
    } catch (err: any) {
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
        const args = {
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
        };
        if (type === 'gmail') {
          // R0-CMF6b: the gmail row follows the business mailbox (see writeWhileGmailMailboxLinked).
          const recorded = await this.writeWhileGmailMailboxLinked(businessId, gmailMailbox, (tx) => tx.connectorStatus.upsert(args));
          if (!recorded) {
            this.logger.warn(`Gmail smoke test for ${businessId}: the mailbox was disconnected while it ran; status not written`);
          }
        } else {
          await this.prisma.client.connectorStatus.upsert(args);
        }
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

  /**
   * R0-CMF6b (review SEC-CMF6-2): the gmail connector row follows the business
   * mailbox. GmailService.disconnectGmail clears the mailbox and marks the row
   * disconnected in one transaction that first locks the business row; a smoke
   * test that had started before it used to write the row connected again
   * afterwards (or create one), so the nightly sync selected a mailbox that was
   * gone. Its write now runs in a transaction that takes the same lock first
   * and is made only while the business still has the mailbox the smoke test
   * acted on: a disconnect that committed first is seen and nothing is
   * written; one that starts later waits for this write, then marks the row
   * disconnected. Returns whether it wrote. GmailIngestionService.syncInbox
   * applies the same rule.
   *
   * Review SEC-CMF6b-1 / SEC-CMF6b-2: "linked" is gmail_refresh_token and
   * gmail_email set (as GmailService.getGmailStatus reads it), never
   * gmail_access_token, which a token refresh writes back unlocked; and
   * gmail_email is the mailbox bound before the connector read its token, so
   * a disconnect followed by a new connection is not taken for it.
   */
  private async writeWhileGmailMailboxLinked(
    businessId: string,
    mailbox: string | null,
    write: (tx: PrismaTx) => Promise<unknown>,
  ): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = (await tx.$queryRaw`
        SELECT (gmail_refresh_token IS NOT NULL AND gmail_email IS NOT NULL AND lower(gmail_email) = lower(${mailbox}::text)) AS linked
          FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`) as Array<{ linked: boolean | null }>;
      if (rows[0]?.linked !== true) return false;
      await write(tx);
      return true;
    });
  }

  /** R0-CMF6b review (SEC-CMF6b-2): the business mailbox's address while it has a refresh token, else null. */
  private async linkedGmailMailboxOf(businessId: string): Promise<string | null> {
    const rows = (await this.prisma.client.$queryRaw`
      SELECT gmail_email AS email FROM businesses
       WHERE id = ${businessId} AND gmail_refresh_token IS NOT NULL AND gmail_email IS NOT NULL`) as Array<{ email: string | null }>;
    return rows[0]?.email ?? null;
  }

  async reconnectConnector(type: ConnectorType, businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const connector = this.connectors.get(type);
    if (!connector) throw new Error(`Connector ${type} not found`);

    try {
      await connector.disconnect(businessId);
    } catch (err: any) {
        this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
      }

    return this.authenticateConnector(type, businessId);
  }
}

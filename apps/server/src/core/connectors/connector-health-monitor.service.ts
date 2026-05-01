import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { ConnectorType, ConnectorStatus } from './connector.interface';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;
const HEALTHY_STATUSES: ConnectorStatus[] = ['connected', 'syncing'];
const MONITORED_STATUSES: ConnectorStatus[] = [
  'connected',
  'syncing',
  'error',
  'expired',
];

function classifyFailure(message: string | undefined): ConnectorStatus {
  if (!message) return 'error';
  const lower = message.toLowerCase();
  if (
    lower.includes('expired') ||
    lower.includes('invalid_grant') ||
    lower.includes('token') ||
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('not connected')
  ) {
    return 'expired';
  }
  return 'error';
}

@Injectable()
export class ConnectorHealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorHealthMonitorService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private startupTimeout: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(ConnectorActivityService) private readonly activity: ConnectorActivityService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.intervalRef = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    }, INITIAL_DELAY_MS);
    this.logger.log(
      `Connector health monitor scheduled (first run in ${Math.round(
        INITIAL_DELAY_MS / 1000,
      )}s, interval ${CHECK_INTERVAL_MS / 60000}min)`,
    );
  }

  onModuleDestroy() {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  /**
   * Iterate over every business that has at least one connector marked as
   * healthy and re-test it. When a connector flips from healthy to error /
   * expired, persist the new status, write an activity log entry, and create
   * an in-app notification with a deep link back to the Connect hub.
   *
   * This method scans across all businesses and is intended to be invoked
   * by the internal scheduler only — it must not be exposed via a
   * tenant-facing endpoint.
   */
  async tick(): Promise<{ businessesChecked: number; alerts: number }> {
    if (this.running) {
      return { businessesChecked: 0, alerts: 0 };
    }
    this.running = true;
    let alerts = 0;
    const businesses = new Set<string>();

    try {
      const rows = await this.prisma.client.connectorStatus.findMany({
        where: { status: { in: MONITORED_STATUSES } },
        select: { businessId: true, connectorType: true, status: true },
      });

      for (const row of rows) {
        businesses.add(row.businessId);
        try {
          const flipped = await this.checkOne(
            row.businessId,
            row.connectorType as ConnectorType,
            row.status as ConnectorStatus,
          );
          if (flipped) alerts += 1;
        } catch (err) {
          this.logger.warn(
            `Health check failed for ${row.connectorType} (business ${row.businessId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      if (rows.length > 0) {
        this.logger.log(
          `Health monitor tick complete: ${rows.length} connectors across ${businesses.size} businesses, ${alerts} new alerts`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Health monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }

    return { businessesChecked: businesses.size, alerts };
  }

  /**
   * Re-test every healthy connector belonging to a single business. Safe to
   * expose to authenticated tenant requests because it is strictly scoped
   * to the supplied businessId.
   */
  async tickBusiness(businessId: string): Promise<{ checked: number; alerts: number }> {
    let alerts = 0;
    const rows = await this.prisma.client.connectorStatus.findMany({
      where: {
        businessId,
        status: { in: MONITORED_STATUSES },
      },
      select: { connectorType: true, status: true },
    });

    for (const row of rows) {
      try {
        const flipped = await this.checkOne(
          businessId,
          row.connectorType as ConnectorType,
          row.status as ConnectorStatus,
        );
        if (flipped) alerts += 1;
      } catch (err) {
        this.logger.warn(
          `Health check failed for ${row.connectorType} (business ${businessId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { checked: rows.length, alerts };
  }

  private async checkOne(
    businessId: string,
    type: ConnectorType,
    priorStatus: ConnectorStatus,
  ): Promise<boolean> {
    if (!this.registry.get(type)) {
      return false;
    }

    const result = await this.registry.testConnector(type, businessId);
    if (result.success) {
      return false;
    }

    const newStatus = classifyFailure(result.error);
    const errorMessage = result.error ?? 'Connector test failed';

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: type } },
      create: {
        businessId,
        connectorType: type,
        status: newStatus,
        lastErrorAt: new Date(),
        lastError: errorMessage,
        errorCount: 1,
      },
      update: {
        status: newStatus,
        lastErrorAt: new Date(),
        lastError: errorMessage,
        errorCount: { increment: 1 },
      },
    });

    await this.activity.record({
      businessId,
      connectorType: type,
      action: 'error',
      status: 'failure',
      message: `Health check flipped ${type} to ${newStatus}: ${errorMessage}`,
      metadata: { source: 'health_monitor', priorStatus },
    });

    if (HEALTHY_STATUSES.includes(priorStatus)) {
      await this.createAlert(businessId, type, newStatus, errorMessage);
      return true;
    }

    if (await this.shouldRenotify(businessId, type)) {
      await this.createAlert(businessId, type, newStatus, errorMessage);
      return true;
    }

    return false;
  }

  private async shouldRenotify(businessId: string, type: ConnectorType): Promise<boolean> {
    try {
      const last = await this.prisma.client.notification.findFirst({
        where: {
          businessId,
          type: 'connector_health',
          data: { path: ['connectorType'], equals: type },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!last) return true;
      return Date.now() - new Date(last.createdAt).getTime() > RENOTIFY_AFTER_MS;
    } catch {
      return false;
    }
  }

  private async createAlert(
    businessId: string,
    type: ConnectorType,
    status: ConnectorStatus,
    error: string,
  ): Promise<void> {
    const meta = this.registry.get(type)?.meta;
    const name = meta?.name ?? type;
    const reason =
      status === 'expired'
        ? 'access has expired or was revoked'
        : 'is no longer responding';

    try {
      await this.notifications.create({
        businessId,
        type: 'connector_health',
        title: `${name} needs to be reconnected`,
        body: `Your ${name} connection ${reason}. Reconnect it so dependent features keep working.`,
        data: {
          connectorType: type,
          connectorName: name,
          status,
          error,
          link: '/app/connect',
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to create connector_health notification for ${type} (business ${businessId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * How many connectors currently need attention for a given business.
   */
  async needsAttention(businessId: string) {
    const rows = await this.prisma.client.connectorStatus.findMany({
      where: {
        businessId,
        status: { in: ['error', 'expired'] },
      },
      select: {
        connectorType: true,
        status: true,
        lastError: true,
        lastErrorAt: true,
      },
    });

    return {
      count: rows.length,
      items: rows.map((r) => ({
        connectorType: r.connectorType,
        status: r.status,
        lastError: r.lastError,
        lastErrorAt: r.lastErrorAt,
      })),
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorType } from './connector.interface';

export type ConnectorActivityAction =
  | 'connect'
  | 'disconnect'
  | 'reconnect'
  | 'sync'
  | 'test'
  | 'error'
  | 'token_refresh';

export type ConnectorActivityStatus = 'success' | 'failure' | 'pending';

export interface RecordActivityOptions {
  businessId: string;
  connectorType: ConnectorType;
  action: ConnectorActivityAction;
  status: ConnectorActivityStatus;
  message?: string;
  itemsAffected?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ConnectorActivityService {
  private readonly logger = new Logger(ConnectorActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(opts: RecordActivityOptions) {
    try {
      await this.prisma.client.connectorActivityLog.create({
        data: {
          businessId: opts.businessId,
          connectorType: opts.connectorType,
          action: opts.action,
          status: opts.status,
          message: opts.message ?? null,
          itemsAffected: opts.itemsAffected ?? null,
          durationMs: opts.durationMs ?? null,
          metadata: (opts.metadata ?? null) as never,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record connector activity: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async list(
    businessId: string,
    opts: { connectorType?: ConnectorType; limit?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    return this.prisma.client.connectorActivityLog.findMany({
      where: {
        businessId,
        ...(opts.connectorType ? { connectorType: opts.connectorType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // Event listeners — every connector lifecycle event is logged automatically.
  @OnEvent('connector.connected')
  onConnected(payload: { connectorType: ConnectorType; businessId: string }) {
    void this.record({
      businessId: payload.businessId,
      connectorType: payload.connectorType,
      action: 'connect',
      status: 'success',
    });
  }

  @OnEvent('connector.disconnected')
  onDisconnected(payload: { connectorType: ConnectorType; businessId: string }) {
    void this.record({
      businessId: payload.businessId,
      connectorType: payload.connectorType,
      action: 'disconnect',
      status: 'success',
    });
  }

  @OnEvent('connector.synced')
  onSynced(payload: {
    connectorType: ConnectorType;
    businessId: string;
    itemsSynced?: number;
    duration?: number;
  }) {
    void this.record({
      businessId: payload.businessId,
      connectorType: payload.connectorType,
      action: 'sync',
      status: 'success',
      itemsAffected: payload.itemsSynced,
      durationMs: payload.duration,
    });
  }

  @OnEvent('connector.error')
  onError(payload: {
    connectorType: ConnectorType;
    businessId: string;
    error?: string;
    duration?: number;
  }) {
    void this.record({
      businessId: payload.businessId,
      connectorType: payload.connectorType,
      action: 'error',
      status: 'failure',
      message: payload.error,
      durationMs: payload.duration,
    });
  }
}

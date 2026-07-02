import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface WebhookIngressLogEntry {
  businessId: string;
  connectorType: string;
  payload: unknown;
  headers?: Record<string, unknown>;
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  retryCount?: number;
}

/**
 * Persists inbound webhook delivery attempts to the WebhookDeliveryLog table.
 * This service is intentionally fire-and-forget: webhook handlers call it after
 * responding so logging failures never block the caller.
 */
@Injectable()
export class WebhookIngressLoggerService {
  private readonly logger = new Logger(WebhookIngressLoggerService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(entry: WebhookIngressLogEntry): Promise<void> {
    try {
      await this.prisma.client.webhookDeliveryLog.create({
        data: {
          businessId: entry.businessId,
          connectorType: entry.connectorType,
          payload: entry.payload as any,
          headers: (entry.headers ?? {}) as any,
          statusCode: entry.statusCode ?? null,
          responseBody: entry.responseBody ?? null,
          errorMessage: entry.errorMessage ?? null,
          retryCount: entry.retryCount ?? 0,
        },
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist webhook delivery log: ${message}`);
    }
  }
}

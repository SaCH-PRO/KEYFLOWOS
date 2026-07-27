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
/**
 * Header names whose values are secrets (webhook signing secrets, bearer tokens)
 * and must never be persisted to the delivery log in plaintext. The form webhook
 * authenticates with a per-business secret carried in `x-keyflow-signature`, so
 * logging that header verbatim would store the secret.
 */
const SENSITIVE_HEADER_KEYS = new Set([
  'x-keyflow-signature',
  'authorization',
  'x-api-key',
  'x-hub-signature',
  'x-hub-signature-256',
  'stripe-signature',
]);

@Injectable()
export class WebhookIngressLoggerService {
  private readonly logger = new Logger(WebhookIngressLoggerService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Replace sensitive header values with a redaction marker (case-insensitive). */
  private redactHeaders(headers?: Record<string, unknown>): Record<string, unknown> {
    if (!headers) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
    }
    return out;
  }

  async log(entry: WebhookIngressLogEntry): Promise<void> {
    try {
      await this.prisma.client.webhookDeliveryLog.create({
        data: {
          businessId: entry.businessId,
          connectorType: entry.connectorType,
          payload: entry.payload as any,
          headers: this.redactHeaders(entry.headers) as any,
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

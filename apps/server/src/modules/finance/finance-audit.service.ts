import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export type FinanceAuditAction =
  | 'TRANSACTION_POSTED'
  | 'TRANSACTION_REVERSED'
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNT_ARCHIVED'
  | 'COA_CREATED'
  | 'COA_UPDATED'
  | 'COA_ARCHIVED'
  | 'RECONCILIATION_OPENED'
  | 'RECONCILIATION_COMPLETED'
  | 'BANK_TRANSACTION_IMPORTED'
  | 'BANK_TRANSACTION_MATCHED'
  | 'BANK_TRANSACTION_UNMATCHED'
  | 'BANK_TRANSACTION_IGNORED'
  | 'TAX_LIABILITY_FILED'
  | 'TAX_LIABILITY_PAID';

export interface FinanceAuditInput {
  businessId: string;
  userId?: string | null;
  action: FinanceAuditAction;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  detail?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Thin wrapper around TeamActivityLog with a fixed `module = 'finance'`
 * tag so all financial events are queryable in one place. Never throws —
 * audit failures must not break the calling write path.
 */
@Injectable()
export class FinanceAuditService {
  private readonly logger = new Logger(FinanceAuditService.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(input: FinanceAuditInput): Promise<void> {
    try {
      const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
      if (input.before !== undefined) meta.before = input.before;
      if (input.after !== undefined) meta.after = input.after;

      await this.prisma.client.teamActivityLog.create({
        data: {
          businessId: input.businessId,
          userId: input.userId ?? 'system',
          module: 'finance',
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          title: input.title,
          detail: input.detail ?? null,
          meta: meta as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
        this.logger.warn(`— audit must never break the financial write path.: ${err instanceof Error ? err.message : err}`);
      }
  }
}

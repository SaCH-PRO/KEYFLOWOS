import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

export const AUDIT_ACTION_KEY = 'audit_action';

export interface AuditActionMeta {
  module: string;
  action: string;
  entityType?: string;
}

export const AuditAction = (module: string, action: string, entityType?: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { module, action, entityType } as AuditActionMeta);

export const AUDIT_ONCE_PER_ENTITY_KEY = 'audit_once_per_entity';

/**
 * V1-45b (D-15; V1-45 review SEC-V45-2): the audited write creates its entity
 * and honours an Idempotency-Key, so a keyed request the route answers with an
 * entity it already created (a replay, or a concurrent retry that lost the
 * race) writes no second audit row: one row per entity and action.
 */
export const AuditOncePerEntity = () => SetMetadata(AUDIT_ONCE_PER_ENTITY_KEY, true);

/** The advisory-lock namespace that serializes the once-per-entity check and insert. */
const AUDIT_ONCE_LOCK_NAMESPACE = 'team-audit-once:';

type AuditRow = {
  businessId: string;
  userId: string;
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  title: string;
};

@Injectable()
export class TeamAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TeamAuditInterceptor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditActionMeta>(AUDIT_ACTION_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<{ user?: { id?: string }; params?: Record<string, string>; method?: string; url?: string; headers?: Record<string, unknown> }>();
    const userId = req.user?.id;
    const businessId = req.params?.businessId;

    if (!userId || !businessId) return next.handle();

    const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
    if (!writeMethods.has(req.method ?? '')) return next.handle();

    const idempotencyKey = req.headers?.['idempotency-key'];
    const oncePerEntity =
      this.reflector.get<boolean>(AUDIT_ONCE_PER_ENTITY_KEY, context.getHandler()) === true &&
      typeof idempotencyKey === 'string' &&
      idempotencyKey.trim().length > 0;

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          const entityId = (result && typeof result === 'object' && 'id' in result) ? (result as Record<string, unknown>).id as string : req.params?.contactId || req.params?.productId || req.params?.expenseId || req.params?.invoiceId || req.params?.quoteId || req.params?.taskId || req.params?.noteId;
          const row: AuditRow = {
            businessId,
            userId,
            module: meta.module,
            action: meta.action,
            ...(meta.entityType ? { entityType: meta.entityType } : {}),
            ...(entityId ? { entityId: String(entityId) } : {}),
            title: `${meta.action} ${meta.entityType || meta.module}`,
          };
          void this.record(row, oncePerEntity && !!row.entityId);
        },
      }),
    );
  }

  /**
   * Writes the row after the response, never failing it. Once per entity: the
   * check and the insert run under a transaction-scoped advisory lock on the
   * entity, so concurrent keyed requests answered with one entity write one row.
   */
  private async record(row: AuditRow, oncePerEntity: boolean): Promise<void> {
    try {
      if (!oncePerEntity) {
        await this.prisma.client.teamActivityLog.create({ data: row });
        return;
      }
      await this.prisma.client.$transaction(async (tx) => {
        const lockName = `${AUDIT_ONCE_LOCK_NAMESPACE}${row.businessId}:${row.action}:${row.entityId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockName}))`;
        const existing = await tx.teamActivityLog.findFirst({
          where: { businessId: row.businessId, module: row.module, action: row.action, entityId: row.entityId },
          select: { id: true },
        });
        if (!existing) await tx.teamActivityLog.create({ data: row });
      });
    } catch (e: unknown) {
      this.logger.warn(`Audit log failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}

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

    const req = context.switchToHttp().getRequest<{ user?: { id?: string }; params?: Record<string, string>; method?: string; url?: string }>();
    const userId = req.user?.id;
    const businessId = req.params?.businessId;

    if (!userId || !businessId) return next.handle();

    const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
    if (!writeMethods.has(req.method ?? '')) return next.handle();

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          const entityId = (result && typeof result === 'object' && 'id' in result) ? (result as Record<string, unknown>).id as string : req.params?.contactId || req.params?.productId || req.params?.expenseId || req.params?.invoiceId || req.params?.quoteId || req.params?.taskId || req.params?.noteId;
          this.prisma.client.teamActivityLog.create({
            data: {
              businessId,
              userId,
              module: meta.module,
              action: meta.action,
              ...(meta.entityType ? { entityType: meta.entityType } : {}),
              ...(entityId ? { entityId: String(entityId) } : {}),
              title: `${meta.action} ${meta.entityType || meta.module}`,
            },
          }).catch((e: unknown) => {
            this.logger.warn(`Audit log failed: ${e instanceof Error ? e.message : e}`);
          });
        },
      }),
    );
  }
}

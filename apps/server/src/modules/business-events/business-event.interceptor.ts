import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ResilientEmitterService } from './resilient-emitter.service';
import { EventSource } from './dto/create-business-event.dto';
import { Reflector } from '@nestjs/core';
import { safeRedactedSnapshot } from '../../core/security/redaction';

export const SKIP_BUSINESS_EVENT_KEY = 'skipBusinessEvent';

/**
 * Decorator to skip auto-logging for a specific route.
 */
export const SkipBusinessEvent = () =>
  Reflect.metadata(SKIP_BUSINESS_EVENT_KEY, true);

/**
 * Auto-log interceptor: creates a BusinessEvent for every mutation.
 *
 * Applied to @Post, @Patch, @Delete handlers.
 * Extracts businessId from params, actor from req.user,
 * and diffs request body vs response for before/after snapshots.
 */
@Injectable()
export class BusinessEventInterceptor implements NestInterceptor {
  constructor(
    @Inject(ResilientEmitterService) private readonly resilient: ResilientEmitterService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = context.getHandler();
    const skip = this.reflector.get<boolean>(SKIP_BUSINESS_EVENT_KEY, handler);
    if (skip) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const method = req.method?.toUpperCase();

    // Only log mutations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const businessId = req.params?.businessId ?? req.body?.businessId;
    if (!businessId) {
      return next.handle();
    }

    const before = this.safeSnapshot(req.body);
    const actorId = req.user?.id ?? 'anonymous';
    const actorType = req.user ? 'human' : 'system';
    const source = this.detectSource(req.headers);

    // Derive event type from route
    const routePath = req.route?.path ?? req.url ?? '';
    const { subjectType, action } = this.inferEventMeta(routePath, method);

    return next.handle().pipe(
      tap(async (response) => {
        try {
          const after = this.safeSnapshot(response);
          await this.resilient.emit({
            businessId,
            eventType: `${subjectType}.${action}`,
            subjectType,
            subjectId: this.extractSubjectId(response, req.params),
            actorType,
            actorId,
            action: action.toLowerCase(),
            before: before ?? undefined,
            after: after ?? undefined,
            source,
            metadata: {
              route: routePath,
              httpMethod: method,
              ip: req.ip,
            },
          });
        } catch {
          // Never fail the request because logging failed
        }
      }),
    );
  }

  private safeSnapshot(obj: unknown): Record<string, unknown> | undefined {
    // Deep-redact via the centralized sensitive-field policy (covers nested
    // objects, arrays, mixed casing, credentials/privateKey and the Business
    // OAuth token columns from relation includes).
    return safeRedactedSnapshot(obj);
  }

  private extractSubjectId(response: unknown, params: Record<string, string>): string {
    if (response && typeof response === 'object') {
      const r = response as Record<string, unknown>;
      if (r.id) return String(r.id);
      if (r.data && typeof r.data === 'object' && (r.data as Record<string, unknown>).id) {
        return String((r.data as Record<string, unknown>).id);
      }
    }
    // Fallback: look for :id or :entityId in params
    return params.id ?? params.contactId ?? params.taskId ?? params.invoiceId ?? 'unknown';
  }

  private inferEventMeta(routePath: string, method: string): { subjectType: string; action: string } {
    const segments = routePath.split('/').filter(Boolean);
    // Try to find the entity name from route, e.g., /businesses/:id/contacts -> contact
    const entityMap: Record<string, string> = {
      contacts: 'contact',
      tasks: 'task',
      invoices: 'invoice',
      quotes: 'quote',
      bookings: 'booking',
      deals: 'deal',
      projects: 'project',
      campaigns: 'campaign',
      content: 'content',
      approvals: 'approval',
      evidence: 'evidence',
      assets: 'asset',
    };

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (entityMap[seg]) {
        return { subjectType: entityMap[seg], action: this.methodToAction(method) };
      }
    }

    return { subjectType: 'unknown', action: this.methodToAction(method) };
  }

  private methodToAction(method: string): string {
    switch (method) {
      case 'POST': return 'create';
      case 'PUT':
      case 'PATCH': return 'update';
      case 'DELETE': return 'delete';
      default: return 'unknown';
    }
  }

  private detectSource(headers?: Record<string, string>): EventSource {
    const ua = headers?.['user-agent']?.toLowerCase() ?? '';
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('ios')) return 'mobile';
    if (headers?.['x-api-key']) return 'api';
    if (ua.includes('worker') || headers?.['x-worker']) return 'worker';
    return 'web';
  }
}

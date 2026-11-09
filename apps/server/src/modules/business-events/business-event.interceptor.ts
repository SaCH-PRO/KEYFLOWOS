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
 * W3-V1-45c-EVENT-REPLAY (V1-45b review SEC-V45b-1 / CR-V45b-1, D-15): the
 * request-scoped mark a handler sets when it answered an idempotent replay,
 * i.e. a document an earlier (or concurrent) request created. A symbol on the
 * request object: it never reaches the response body, and it lives exactly as
 * long as the request.
 */
const IDEMPOTENT_REPLAY = Symbol('businessEvent.idempotentReplay');

/** Mark this request as answered by an idempotent replay (see IDEMPOTENT_REPLAY). */
export function markIdempotentReplay(req: object): void {
  (req as { [IDEMPOTENT_REPLAY]?: true })[IDEMPOTENT_REPLAY] = true;
}

function isMarkedIdempotentReplay(req: unknown): boolean {
  return !!req && typeof req === 'object' && (req as { [IDEMPOTENT_REPLAY]?: true })[IDEMPOTENT_REPLAY] === true;
}

/** What a rule may know about the call it audits. */
interface RouteCall {
  /** Date.now() when the interceptor took the request, before the handler ran. */
  startedAt: number;
  /** The authenticated user the handler acts for (req.user.id), or null. */
  userId: string | null;
  /** The handler marked its answer an idempotent replay (markIdempotentReplay), read after it ran. */
  markedReplay: boolean;
}

/**
 * A route whose audit label is not "<last entity segment>.<HTTP verb>".
 * `subjectId` reads the subject from the handler's response. `isReplay`, when
 * set, says the handler answered an idempotent replay: it wrote nothing, so
 * the interceptor writes no audit row either.
 */
interface RouteEventRule {
  subjectType: string;
  action: string;
  subjectId: (response: unknown) => string | undefined;
  isReplay?: (response: unknown, call: RouteCall) => boolean;
}

/** `response[key]`, when the handler nests its subject under that key. */
function nested(response: unknown, key: string): Record<string, unknown> | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const inner = (response as Record<string, unknown>)[key];
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : undefined;
}

/** The `id` of `response[key]`. */
function nestedId(response: unknown, key: string): string | undefined {
  const id = nested(response, key)?.id;
  return id ? String(id) : undefined;
}

/** The top-level `id` of the response (the created document), as the inferred labels read it. */
function topLevelId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const id = (response as Record<string, unknown>).id;
  return id ? String(id) : undefined;
}

/** A Date, an ISO string or epoch millis, as epoch millis. */
function toMillis(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

/**
 * R0-19 review (R19-ST-1): the manual payment route answers an R0-D2
 * idempotent replay (same idempotency key, or same reference + amount) with
 * the payment it already recorded, in the same envelope and status as a fresh
 * record, and writes, posts and logs nothing (CommerceService
 * .replayRecordedPayment). Auditing that answer as payment.record would claim
 * the caller recorded a payment someone else (or the same member, earlier)
 * recorded. The envelope carries no replay flag, so the Payment row decides:
 *
 *   - recordedBy is not the acting user: the route always records the
 *     authenticated user (R0-PL-07), so this request did not record it. This
 *     holds even when the two submits race and the replay loses the insert.
 *   - createdAt is before this request reached the interceptor: Prisma stamps
 *     @default(now()) in this process (the INSERT carries created_at), so a
 *     row this request created is never older than the request.
 *
 * A response without those fields (no payment, or a payment shape without
 * them) is not a replay: the row is written as before. Residual: two
 * concurrent submits by the SAME user both pass both checks, so that payment
 * gets two payment.record rows, each naming its true recorder.
 */
function isPaymentReplay(response: unknown, call: RouteCall): boolean {
  const payment = nested(response, 'payment');
  if (!payment) return false;
  if ('recordedBy' in payment && (payment.recordedBy ?? null) !== call.userId) return true;
  const createdAt = toMillis(payment.createdAt);
  return createdAt !== undefined && createdAt < call.startedAt;
}

/**
 * Route-specific audit labels, keyed on "<METHOD> <route path without leading
 * slash>" exactly as the router reports it, so no other route's label moves.
 *
 * R0-19-EVIDENCE-BASELINE (M16): the manual payment route walked back to
 * `invoices` and was audited as `invoice.create` on the invoice. It records a
 * Payment, and its handler answers { payment, invoice, paidAmount, remaining },
 * so the subject is response.payment.id. A replay is not audited (R19-ST-1).
 *
 * V1-41b review (SEC-V41b-1, CR-V41b-1): the pending-payment confirm route
 * records the money of a PENDING extracted row through the same door
 * (CommerceService.recordPayment, as the confirming member) and answers the
 * same envelope plus confirmedPaymentId. Without a rule it walked back to
 * `invoices` too (invoice.create on the invoice). It is audited exactly as a
 * manual payment: payment.record on the SUCCESSFUL Payment it recorded, by the
 * confirming member (metadata.route and the snapshot's confirmedPaymentId say
 * it was a confirmation). A confirm that answers a Payment this request did
 * not record (the door's keyed replay after a confirm that recorded the money
 * but failed before retiring the row, or a manual payment that took the
 * door's key) is not audited as a record by this member (R19-ST-1).
 *
 * W3-V1-45c-EVENT-REPLAY (V1-45b review SEC-V45b-1 / CR-V45b-1, D-15): invoice
 * and quote create honour an Idempotency-Key. A keyed replay answers the
 * document the key already created, in the same 201 envelope as a fresh
 * create, and writes nothing, so it is not a second invoice.create /
 * quote.create. A createdAt rule cannot tell: the losers of a concurrent burst
 * started before the winner stamped its createdAt, and every request is by the
 * same member (another member's key is a 409, SEC-V45-3). So the handler marks
 * its replay answer on the request (CommerceService.isCreateReplay ->
 * markIdempotentReplay) and these rules read that mark. The label and subject
 * are the ones the route always had (invoice.create / quote.create on the
 * created document); a create without a key is never a replay.
 */
const ROUTE_EVENT_RULES: Record<string, RouteEventRule> = {
  'POST commerce/businesses/:businessId/invoices': {
    subjectType: 'invoice',
    action: 'create',
    subjectId: topLevelId,
    isReplay: (_response, call) => call.markedReplay,
  },
  'POST commerce/businesses/:businessId/quotes': {
    subjectType: 'quote',
    action: 'create',
    subjectId: topLevelId,
    isReplay: (_response, call) => call.markedReplay,
  },
  'POST commerce/businesses/:businessId/invoices/:invoiceId/payments': {
    subjectType: 'payment',
    action: 'record',
    subjectId: (response) => nestedId(response, 'payment'),
    isReplay: isPaymentReplay,
  },
  'POST commerce/businesses/:businessId/invoices/:invoiceId/payments/:paymentId/confirm': {
    subjectType: 'payment',
    action: 'record',
    subjectId: (response) => nestedId(response, 'payment'),
    isReplay: isPaymentReplay,
  },
};

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

    const startedAt = Date.now();
    const before = this.safeSnapshot(req.body);
    const actorId = req.user?.id ?? 'anonymous';
    const actorType = req.user ? 'human' : 'system';
    const source = this.detectSource(req.headers);

    // Derive event type from route
    const routePath = req.route?.path ?? req.url ?? '';
    const rule = this.routeRule(routePath, method);
    const { subjectType, action } = rule ?? this.inferEventMeta(routePath, method);

    return next.handle().pipe(
      tap(async (response) => {
        try {
          // An idempotent replay wrote nothing; it is not a new mutation to audit.
          // The handler's replay mark (W3-V1-45c-EVENT-REPLAY) is read now, after it ran.
          if (rule?.isReplay?.(response, { startedAt, userId: req.user?.id ?? null, markedReplay: isMarkedIdempotentReplay(req) })) return;
          const after = this.safeSnapshot(response);
          await this.resilient.emit({
            businessId,
            eventType: `${subjectType}.${action}`,
            subjectType,
            // A rule names its subject; never fall back to a path id of another entity.
            subjectId: rule
              ? (rule.subjectId(response) ?? 'unknown')
              : this.extractSubjectId(response, req.params),
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

  private routeRule(routePath: string, method: string): RouteEventRule | undefined {
    const key = `${method} ${routePath.split('/').filter(Boolean).join('/')}`;
    return ROUTE_EVENT_RULES[key];
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

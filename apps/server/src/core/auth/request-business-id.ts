import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The one place that says which request field names the tenant on a route
 * that carries no `:businessId` path parameter.
 *
 * KF-REVENUE-AUTH-PROJECTION-001 review (ST-1, ST-2). BusinessGuard and
 * ModuleScopeGuard resolved the tenant as params -> body -> query, while the
 * bare-id invoice handlers read `@Body('businessId')` or `@Query('businessId')`
 * — a different field from the one the guards had just validated. A request
 * that named tenant B where the guards look and tenant A where the handler
 * looks passed both guards against B and acted on A:
 *
 *   GET  /commerce/invoices/<A's invoice>/receipt?businessId=A
 *        Content-Type: application/json   {"businessId": "B"}
 *        -> a member of B only read A's receipt, customer email included.
 *
 *   PATCH /commerce/invoices/<A's invoice>/paid?businessId=B   body {}
 *        -> the guards checked revenue:write in B, the handler forwarded
 *           `undefined`, and the service skipped the tenant binding entirely.
 *
 * Both guards and every bare-id handler now call this function, so a handler
 * cannot read a source the guards did not check. Only a non-empty string
 * counts: Prisma rejects an object or an array where it expects an id, and an
 * unverifiable tenant must read as "no tenant" (refused), not as a 500.
 */
export interface TenantBearingRequest {
  params?: Record<string, unknown>;
  body?: unknown;
  query?: Record<string, unknown>;
}

export function resolveRequestBusinessId(req: TenantBearingRequest | undefined): string | undefined {
  const body = req?.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : undefined;
  for (const candidate of [req?.params?.businessId, body?.businessId, req?.query?.businessId]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Handler parameter decorator for bare-id routes behind BusinessGuard: the
 * tenant exactly as the guards resolved it, or `undefined` when no source
 * named one (only SUPER_ADMIN reaches a handler in that state — BusinessGuard
 * refuses everyone else — and the handler must refuse it rather than forward
 * an empty tenant that switches the service's binding off).
 */
export const GuardedBusinessId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined =>
  resolveRequestBusinessId(ctx.switchToHttp().getRequest<TenantBearingRequest>()),
);

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from './tenant-context';
import { requestTenantBusinessId, type BusinessGuardedRequest } from '../auth/business.guard';

/**
 * Interceptor that sets the AsyncLocalStorage tenant context for every request
 * that has a businessId and authenticated user. This allows Prisma extensions
 * and downstream services to access the current tenant without passing it
 * through every function call.
 *
 * The tenant is `requestTenantBusinessId(req)`: the string BusinessGuard
 * validated and attached, else the same string-only resolver the guard runs
 * (R0-F24-TENANT-INTERCEPTOR-ALIGN, build map CF-24). It used to be
 * `params.businessId || body.businessId || query.businessId` — the first
 * TRUTHY field — so `?businessId=A` with the JSON body `{"businessId":
 * {"not":"x"}}` passed the guard against A and then ran the handler with the
 * object as the ambient tenant, which the Prisma tenant extension wrote over
 * every scoped `where.businessId`: every tenant's rows (or B's, for
 * `{"equals":"B"}`) under a response that said A, and a 500 for an array or a
 * number. A non-string candidate is now skipped, never installed.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<BusinessGuardedRequest & { user?: { id?: string } }>();
    const userId = req?.user?.id;
    const businessId = requestTenantBusinessId(req);

    if (!userId || !businessId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      runWithTenant(businessId, userId as string, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}

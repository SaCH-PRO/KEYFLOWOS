import { Inject, Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { runWithTenant } from './tenant-context';
import { verifiedTenantBusinessId, type BusinessGuardedRequest } from '../auth/business.guard';
import { resolveRequestBusinessId } from '../auth/request-business-id';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Interceptor that sets the AsyncLocalStorage tenant context for every request
 * that has a businessId and authenticated user. This allows Prisma extensions
 * and downstream services to access the current tenant without passing it
 * through every function call.
 *
 * The tenant is `verifiedTenantBusinessId(req)` (R0-F24-TENANT-INTERCEPTOR-ALIGN,
 * build map CF-24): the string BusinessGuard validated and attached; else the
 * string the guard's own resolver finds, only for SUPER_ADMIN or a caller who
 * passes BusinessGuard's membership predicate for it; else no tenant at all.
 *
 * It used to be `params.businessId || body.businessId || query.businessId` —
 * the first TRUTHY field, unchecked. On a BusinessGuard route `?businessId=A`
 * with the JSON body `{"businessId": {"not":"x"}}` passed the guard against A
 * and ran the handler with the object as the ambient tenant, which the Prisma
 * tenant extension wrote over every scoped `where.businessId`. And because this
 * interceptor is global, on the AuthGuard-only and public routes — where no
 * guard checks the tenant at all — any caller could name any business as the
 * ambient tenant, which the extension also forces onto every create and upsert
 * (review finding F1: POST /identity/bootstrap?businessId=<B> wrote an OWNER
 * membership into B for a user with no access to B). Neither is possible now:
 * a non-string candidate is skipped, and an unverified one is never installed.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<BusinessGuardedRequest>();
    const userId = req?.user?.id;
    const guarded = req?.guardedBusinessId;
    const namesTenant = (typeof guarded === 'string' && guarded.length > 0) || !!resolveRequestBusinessId(req);

    if (!userId || !namesTenant) {
      return next.handle();
    }

    return from(verifiedTenantBusinessId(req, this.prisma)).pipe(
      switchMap((businessId) => {
        if (!businessId) return next.handle();
        // The handler subscribes inside the tenant's AsyncLocalStorage scope;
        // its subscription is returned as the teardown.
        return new Observable((subscriber) =>
          runWithTenant(businessId, userId, () =>
            next.handle().subscribe({
              next: (value) => subscriber.next(value),
              error: (err) => subscriber.error(err),
              complete: () => subscriber.complete(),
            }),
          ),
        );
      }),
    );
  }
}

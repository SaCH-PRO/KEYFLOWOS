import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from './tenant-context';

/**
 * Interceptor that sets the AsyncLocalStorage tenant context for every request
 * that has a businessId and authenticated user. This allows Prisma extensions
 * and downstream services to access the current tenant without passing it
 * through every function call.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string }; params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown> }>();
    const userId = req.user?.id;
    const businessId = req.params?.businessId || req.body?.businessId || req.query?.businessId;

    if (!userId || !businessId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      runWithTenant(businessId as string, userId as string, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}

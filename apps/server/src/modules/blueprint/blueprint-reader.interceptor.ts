import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { blueprintForReader, readsRevenueFor } from '../business-genome/key-genome/genome-composites-for-reader';

/**
 * FU-GENOME-SURFACES-REVENUE round 1 (both reviews MAJOR; D-233, D-234, D-100). The blueprint controller's write routes
 * (PATCH, POST infer/onboarding, POST infer/events, PATCH genome/dna/:section) answer the whole blueprint, so a member
 * without revenue read could read back, by sending an empty write, everything GET withholds. This interceptor answers
 * every non-GET route's blueprint as GET serves it to the request's member (blueprintForReader). It sits on the
 * controller, so the write handlers themselves (which FU-GENOME-DNA-WRITES-AND-INTEGRITY gates) are unchanged. A body
 * that is not a blueprint (no schemaVersion) passes through; GET routes project their own answer.
 */
@Injectable()
export class BlueprintReaderInterceptor implements NestInterceptor {
  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method?: string; params?: { businessId?: string }; user?: { id?: string; role?: string } }>();
    if (!req || req.method === 'GET') return next.handle();
    const businessId = req.params?.businessId;
    return next.handle().pipe(
      mergeMap((body) => from(this.project(body, businessId, req.user))),
    );
  }

  private async project(body: unknown, businessId: string | undefined, user?: { id?: string; role?: string }): Promise<unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('schemaVersion' in body)) return body;
    const readsRevenue = businessId
      ? await readsRevenueFor(this.prisma, businessId, user?.id ? { id: user.id, role: user.role } : null)
      : false;
    return blueprintForReader(body as Record<string, unknown>, readsRevenue);
  }
}

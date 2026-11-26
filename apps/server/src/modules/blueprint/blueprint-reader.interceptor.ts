import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { blueprintForReader, readsRevenueFor } from '../business-genome/key-genome/genome-composites-for-reader';

/**
 * FU-GENOME-SURFACES-REVENUE round 1 (both reviews MAJOR; D-233, D-234, D-100). Projects every non-GET blueprint
 * route response (PATCH /, PATCH genome/dna/:section, POST infer/onboarding, POST infer/events) identically to GET
 * so a reader without revenue:read cannot echo withheld fields back via a write route.
 */
@Injectable()
export class BlueprintReaderInterceptor implements NestInterceptor {
  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ method?: string; params?: { businessId?: string }; user?: { id?: string; role?: string } }>();
    if (!req || req.method === 'GET') return next.handle();
    const businessId = req.params?.businessId;
    return next.handle().pipe(mergeMap((body) => from(this.project(body, businessId, req.user))));
  }

  private async project(
    body: unknown,
    businessId: string | undefined,
    user?: { id?: string; role?: string },
  ): Promise<unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('schemaVersion' in body)) return body;
    const readsRevenue = businessId
      ? await readsRevenueFor(this.prisma, businessId, user?.id ? { id: user.id, role: user.role } : null)
      : false;
    return blueprintForReader(body as Record<string, unknown>, readsRevenue);
  }
}

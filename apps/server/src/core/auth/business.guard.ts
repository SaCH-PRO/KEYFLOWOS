import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRequestBusinessId } from './request-business-id';
import type { TenantBearingRequest } from './request-business-id';

/**
 * A request BusinessGuard has admitted: `guardedBusinessId` is the tenant it
 * resolved (resolveRequestBusinessId) and verified the caller belongs to.
 * Request parsing never sets this property; only the guard does, and only on
 * success.
 */
export interface BusinessGuardedRequest extends TenantBearingRequest {
  guardedBusinessId?: unknown;
}

/**
 * The tenant a request is scoped to: the one answer BusinessGuard and
 * TenantInterceptor share (R0-F24-TENANT-INTERCEPTOR-ALIGN, build map CF-24).
 *
 * The string BusinessGuard validated and attached, when it did; otherwise the
 * resolver the guard runs (params, then body, then query; the first non-empty
 * string). A non-string candidate is skipped, never coerced. For every request
 * whose businessId fields are strings (or falsy) this is exactly the legacy
 * `params.businessId || body.businessId || query.businessId`.
 */
export function requestTenantBusinessId(req: BusinessGuardedRequest | undefined): string | undefined {
  const guarded = req?.guardedBusinessId;
  if (typeof guarded === 'string' && guarded.length > 0) return guarded;
  return resolveRequestBusinessId(req);
}

@Injectable()
export class BusinessGuard implements CanActivate {
  private readonly logger = new Logger(BusinessGuard.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as any;
    const user = req.user as { id?: string; role?: string } | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    // The same resolver the handlers read through (core/auth/request-business-id.ts):
    // a handler behind this guard cannot act on a tenant the guard did not check.
    const businessId = resolveRequestBusinessId(req);
    this.logger.debug(`BusinessGuard checking businessId: ${businessId} for userId: ${user.id}`);
    if (!businessId) {
      throw new ForbiddenException('businessId is required');
    }

    if (!this.prisma?.client) {
      this.logger.error('PrismaService not available, rejecting request');
      throw new ForbiddenException('Service unavailable');
    }

    try {
      const business = await this.prisma.client.business.findFirst({
        where: {
          id: businessId,
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
      });

      if (!business) {
        throw new ForbiddenException('No access to this business');
      }
    } catch (err: any) {
      if (err instanceof ForbiddenException || err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`BusinessGuard error: ${(err as Error).message}`);
      throw new ForbiddenException('Unable to verify business access');
    }

    // TenantInterceptor scopes the ambient tenant to exactly this string
    // (requestTenantBusinessId), so the Prisma tenant extension injects the
    // tenant checked here and nothing else.
    (req as BusinessGuardedRequest).guardedBusinessId = businessId;
    return true;
  }
}

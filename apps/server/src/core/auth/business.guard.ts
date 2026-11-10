import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRequestBusinessId } from './request-business-id';
import type { TenantBearingRequest } from './request-business-id';

const tenantScopeLogger = new Logger('TenantScope');

/**
 * A request BusinessGuard has admitted: `guardedBusinessId` is the tenant it
 * resolved (resolveRequestBusinessId) and verified the caller belongs to.
 * Request parsing never sets this property; only the guard does, and only on
 * success.
 */
export interface BusinessGuardedRequest extends TenantBearingRequest {
  user?: { id?: string; role?: string };
  guardedBusinessId?: unknown;
}

/**
 * BusinessGuard's access predicate, the one place it is written: `userId` holds
 * a Membership in `businessId`. Owner ruling D-104 (W10-OWNER-MEMBERSHIP):
 * membership is the single rule for business access; an owner recorded only as
 * Business.ownerId, with no Membership row, is refused, as ModuleScopeGuard and
 * D-73 already refused them. scripts/backfill-owner-memberships.ts (operator,
 * dry run by default) writes the missing OWNER rows. Throws only when the
 * lookup itself fails; callers decide how to refuse.
 */
export async function userCanAccessBusiness(prisma: PrismaService, userId: string, businessId: string): Promise<boolean> {
  const business = await prisma.client.business.findFirst({
    where: { id: businessId, members: { some: { userId } } },
    select: { id: true },
  });
  return !!business;
}

/**
 * The tenant a request may be scoped to: the one answer BusinessGuard and
 * TenantInterceptor share (R0-F24-TENANT-INTERCEPTOR-ALIGN, build map CF-24).
 * Only a tenant the caller has been VERIFIED for is ever returned:
 *
 *   1. the string BusinessGuard validated and attached (no second lookup);
 *   2. otherwise the first non-empty string the shared resolver finds (params,
 *      then body, then query; a non-string candidate is skipped, never
 *      coerced), and only if the caller is SUPER_ADMIN — whom BusinessGuard
 *      admits to every tenant — or passes BusinessGuard's own predicate
 *      (userCanAccessBusiness) for it;
 *   3. otherwise undefined: the request runs exactly as if it named no tenant.
 *
 * Step 2 is what the review of this packet (finding F1) added. The interceptor
 * is global, so it also runs on the AuthGuard-only and public routes where no
 * guard attaches a tenant, and installing the named businessId there unchecked
 * was a cross-tenant WRITE primitive: the Prisma extension forces businessId on
 * create/upsert, so POST /identity/bootstrap?businessId=<B> by a user with no
 * access to B wrote the bootstrap membership upsert (keyed to the caller's own
 * business) into B as an OWNER row. For a caller who does belong to the named
 * tenant the answer is unchanged.
 *
 * A failed lookup refuses (ForbiddenException), as BusinessGuard does.
 */
export async function verifiedTenantBusinessId(
  req: BusinessGuardedRequest | undefined,
  prisma: PrismaService | undefined,
): Promise<string | undefined> {
  const guarded = req?.guardedBusinessId;
  if (typeof guarded === 'string' && guarded.length > 0) return guarded;

  const userId = req?.user?.id;
  const candidate = resolveRequestBusinessId(req);
  if (!userId || !candidate) return undefined;
  if (req?.user?.role === 'SUPER_ADMIN') return candidate;

  if (!prisma?.client) throw new ForbiddenException('Service unavailable');
  let allowed: boolean;
  try {
    allowed = await userCanAccessBusiness(prisma, userId, candidate);
  } catch (err) {
    tenantScopeLogger.error(`tenant verification failed: ${(err as Error).message}`);
    throw new ForbiddenException('Unable to verify business access');
  }
  return allowed ? candidate : undefined;
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
      if (!(await userCanAccessBusiness(this.prisma, user.id, businessId))) {
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
    // (verifiedTenantBusinessId), so the Prisma tenant extension injects the
    // tenant checked here and nothing else.
    (req as BusinessGuardedRequest).guardedBusinessId = businessId;
    return true;
  }
}

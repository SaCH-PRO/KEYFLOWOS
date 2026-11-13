import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRequestBusinessId } from './request-business-id';

/**
 * PR195-KEY-GATES (review finding SEC-P195BW-7; owner ruling D-46: "a platform SUPER_ADMIN who is not a member writes
 * none of the business's books"). The caller holds a Membership of the business the request names
 * (resolveRequestBusinessId, the tenant BusinessGuard and ModuleScopeGuard resolve); refused 403 'No access to this
 * business' otherwise, the words FinanceController.ensureAccess refuses the same caller with.
 *
 * BusinessGuard and ModuleScopeGuard both pass a platform SUPER_ADMIN whatever their membership, so a door that posts
 * the ledger and carries no membership check of its own let one who is not a member post the business's expenses and
 * pay its bills. Run after them on such a door (the expense, bill and recurring-expense doors that post), it refuses
 * exactly that caller: every other caller BusinessGuard admits already holds a Membership (D-104).
 */
@Injectable()
export class BusinessMemberGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string }; params?: Record<string, unknown>; body?: unknown; query?: Record<string, unknown> }>();
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Authentication required');
    const businessId = resolveRequestBusinessId(req);
    if (!businessId) throw new ForbiddenException('businessId is required');
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('No access to this business');
    return true;
  }
}

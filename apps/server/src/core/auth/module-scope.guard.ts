import { CanActivate, ExecutionContext, Inject, Injectable, ForbiddenException, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../authority/module-vocabulary';

export const MODULE_SCOPE_KEY = 'module_scope';

export interface ModuleScopeRequirement {
  module: string;
  minLevel: 'read' | 'write' | 'admin';
}

export const RequireModuleScope = (module: string, minLevel: 'read' | 'write' | 'admin' = 'read') =>
  SetMetadata(MODULE_SCOPE_KEY, { module, minLevel } as ModuleScopeRequirement);

/**
 * KF-EXEC-AUTH-001: the role-default table moved to `core/authority/module-vocabulary`
 * and this guard now consumes it, because IdentityService kept a SECOND copy that was
 * two keys short. Every member invited through `inviteTeamMember` was written a scope
 * map without `operations` or `analytics`, and step 6 below reads an explicit map
 * INSTEAD of these defaults — so those two keys evaluated to 'none' and 58 operations
 * routes plus 14 analytics routes refused every invited member, ADMIN included.
 *
 * The values are unchanged for the 13 keys this guard already had. `connect` is new to
 * the vocabulary and defaults to 'none' for every role, which is what it already
 * effectively was here.
 */

@Injectable()
export class ModuleScopeGuard implements CanActivate {
  private readonly logger = new Logger(ModuleScopeGuard.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.get<ModuleScopeRequirement>(MODULE_SCOPE_KEY, context.getHandler());
    if (!requirement) return true;

    const req = context.switchToHttp().getRequest<{ user?: { id?: string; role?: string }; params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, string> }>();
    const user = req.user;
    if (!user?.id) throw new ForbiddenException('Authentication required');

    if (user.role === 'SUPER_ADMIN') return true;

    const businessId = req.params?.businessId || req.body?.businessId || req.query?.businessId;
    if (!businessId) throw new ForbiddenException('businessId is required');

    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
    });

    if (!membership) throw new ForbiddenException('Not a member of this business');

    let scopes: Record<string, string>;
    if (membership.permissionScopes && typeof membership.permissionScopes === 'object') {
      scopes = membership.permissionScopes as Record<string, string>;
    } else {
      scopes = defaultScopesForRole(membership.role);
    }

    const memberLevel = scopes[requirement.module] || 'none';
    const memberRank = rankOf(memberLevel);
    const requiredRank = LEVEL_RANK[requirement.minLevel] ?? 1;

    if (memberRank < requiredRank) {
      throw new ForbiddenException(
        `Insufficient permissions: ${requirement.module} requires ${requirement.minLevel} access (you have ${memberLevel})`,
      );
    }

    return true;
  }
}

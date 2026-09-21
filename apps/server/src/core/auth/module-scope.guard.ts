import { CanActivate, ExecutionContext, Inject, Injectable, Optional, ForbiddenException, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL_RANK, defaultScopesForRole, rankOf, isCanonicalModule } from '../authority/module-vocabulary';
import { EffectiveAuthorityResolver } from '../authority/effective-authority.resolver';

export const MODULE_SCOPE_KEY = 'module_scope';

export interface ModuleScopeRequirement {
  module: string;
  minLevel: 'read' | 'write' | 'admin';
}

export const RequireModuleScope = (module: string, minLevel: 'read' | 'write' | 'admin' = 'read') =>
  SetMetadata(MODULE_SCOPE_KEY, { module, minLevel } as ModuleScopeRequirement);

export const AUTHORITY_SHADOW_KEY = 'authority_shadow';

/**
 * Opt a handler into shadow evaluation by EffectiveAuthorityResolver.
 *
 * The LEGACY guard answer below stays authoritative — this decorator changes no
 * allow/deny outcome. It only makes the resolver run alongside and record where the two
 * disagree, so a cutover is argued from evidence rather than from confidence.
 *
 * Generic metadata on purpose. A binding law of this packet is "do not create
 * route-local bespoke resolvers per controller", so the selected family is named by a
 * decorator on the routes and evaluated by this one guard, not by six hand-written
 * checks that would then have to be kept in step with each other forever.
 */
export const ShadowEffectiveAuthority = () => SetMetadata(AUTHORITY_SHADOW_KEY, true);

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
    // Optional so that every existing direct construction of this guard — tests, and
    // any module Nest resolves before AuthorityModule — keeps working with shadowing
    // simply inert. A shadow that breaks the thing it observes is not a shadow.
    @Optional() @Inject(EffectiveAuthorityResolver) private readonly authority?: EffectiveAuthorityResolver,
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

    const legacyAllows = memberRank >= requiredRank;

    // Shadow AFTER the legacy decision is computed and BEFORE it is acted on, so a
    // mismatch is recorded for both outcomes rather than only for the ones that pass.
    if (this.reflector.get<boolean>(AUTHORITY_SHADOW_KEY, context.getHandler())) {
      await this.shadowCompare(businessId, user.id, requirement, legacyAllows, memberLevel);
    }

    if (!legacyAllows) {
      throw new ForbiddenException(
        `Insufficient permissions: ${requirement.module} requires ${requirement.minLevel} access (you have ${memberLevel})`,
      );
    }

    return true;
  }

  /**
   * Run the resolver beside the legacy answer and record disagreement. Never throws,
   * never changes the outcome.
   *
   * Logged fields are non-sensitive by construction: ids, a module name, two levels and
   * a reason code. The scope map itself is never logged — it is security configuration,
   * and a mismatch report that leaks the permission set is a worse problem than the
   * mismatch.
   */
  private async shadowCompare(
    businessId: string,
    userId: string,
    requirement: ModuleScopeRequirement,
    legacyAllows: boolean,
    legacyLevel: string,
  ): Promise<void> {
    if (!this.authority) return;
    try {
      if (!isCanonicalModule(requirement.module)) {
        this.logger.warn(`[authority-shadow] non-canonical module "${requirement.module}" — skipped`);
        return;
      }
      const result = await this.authority.resolve(businessId, userId);
      const decision = result.modules[requirement.module];
      const resolverAllows = LEVEL_RANK[decision.level] >= (LEVEL_RANK[requirement.minLevel] ?? 1);

      if (resolverAllows === legacyAllows) return;

      this.logger.warn(
        `[authority-shadow] MISMATCH business=${businessId} user=${userId} ` +
          `module=${requirement.module} min=${requirement.minLevel} ` +
          `legacy=${legacyAllows ? 'ALLOW' : 'DENY'}(${legacyLevel}) ` +
          `resolver=${resolverAllows ? 'ALLOW' : 'DENY'}(${decision.level}) ` +
          `reason=${decision.reason} explicitDeny=${decision.explicitDeny} ` +
          `positions=${result.positions.length} truncated=${result.validity.truncated}`,
      );
    } catch (err) {
      // A shadow that can fail the request it is shadowing is not observation, it is a
      // second point of failure in the authority path.
      this.logger.warn(`[authority-shadow] failed, legacy answer unaffected: ${(err as Error).message}`);
    }
  }
}

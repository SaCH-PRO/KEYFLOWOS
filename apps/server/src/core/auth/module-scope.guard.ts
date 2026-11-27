import { CanActivate, ExecutionContext, Inject, Injectable, Optional, ForbiddenException, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf, isCanonicalModule } from '../authority/module-vocabulary';
import { EffectiveAuthorityResolver } from '../authority/effective-authority.resolver';
import { resolveRequestBusinessId } from './request-business-id';
import { securitySignals } from '../observability/security-signals';

export const MODULE_SCOPE_KEY = 'module_scope';
export const MODULE_SCOPE_ALTERNATIVES_KEY = 'module_scope_alternatives';

export interface ModuleScopeRequirement {
  module: string;
  minLevel: 'read' | 'write' | 'admin';
}

export const RequireModuleScope = (module: string, minLevel: 'read' | 'write' | 'admin' = 'read') =>
  SetMetadata(MODULE_SCOPE_KEY, { module, minLevel } as ModuleScopeRequirement);

/**
 * Declares an alternative module scope (OR semantics) alongside `@RequireModuleScope`.
 * Kept as a separate decorator so static censuses scanning `@RequireModuleScope('mod', 'lvl')`
 * (e.g., `job-role-tool-families.spec.ts`) keep parsing every guarded route unchanged.
 * Multiple `@RequireAlternativeModuleScope` decorators on one handler compose additively.
 */
export const RequireAlternativeModuleScope = (
  module: string,
  minLevel: 'read' | 'write' | 'admin' = 'read',
): MethodDecorator => {
  return (_target, _propertyKey, descriptor) => {
    const existing: ModuleScopeRequirement[] =
      (Reflect.getMetadata(MODULE_SCOPE_ALTERNATIVES_KEY, descriptor.value as object) as
        | ModuleScopeRequirement[]
        | undefined) ?? [];
    Reflect.defineMetadata(
      MODULE_SCOPE_ALTERNATIVES_KEY,
      [...existing, { module, minLevel }],
      descriptor.value as object,
    );
    return descriptor;
  };
};

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
    const primary = this.reflector.get<ModuleScopeRequirement>(MODULE_SCOPE_KEY, context.getHandler());
    const alternatives =
      this.reflector.get<ModuleScopeRequirement[]>(MODULE_SCOPE_ALTERNATIVES_KEY, context.getHandler()) ?? [];
    const requirements: ModuleScopeRequirement[] = primary ? [primary, ...alternatives] : alternatives;
    if (requirements.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: { id?: string; role?: string }; params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, string> }>();
    const user = req.user;
    if (!user?.id) throw new ForbiddenException('Authentication required');

    if (user.role === 'SUPER_ADMIN') return true;

    // Same resolver as BusinessGuard and the bare-id handlers (core/auth/request-business-id.ts).
    const businessId = resolveRequestBusinessId(req);
    if (!businessId) throw new ForbiddenException('businessId is required');

    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
    });

    if (!membership) {
      securitySignals.record('cross_business_refusal', 'module_scope_guard');
      throw new ForbiddenException('Not a member of this business');
    }

    // The explicit map (any non-null object, an array included) else the role's defaults; a
    // missing key is 'none'. One helper, shared with the readers that must agree with this guard
    // (PR195-PORT review SEC-P195-2: KEY's standing context had read an array as role defaults).
    const evaluated = requirements.map((requirement) => {
      const memberLevel = memberModuleLevel(membership, requirement.module);
      const memberRank = rankOf(memberLevel);
      const requiredRank = LEVEL_RANK[requirement.minLevel] ?? 1;
      return { requirement, memberLevel, allows: memberRank >= requiredRank };
    });

    const legacyAllows = evaluated.some((entry) => entry.allows);

    // Shadow AFTER the legacy decision is computed and BEFORE it is acted on, so a
    // mismatch is recorded for both outcomes rather than only for the ones that pass.
    if (this.reflector.get<boolean>(AUTHORITY_SHADOW_KEY, context.getHandler())) {
      await this.shadowCompare(businessId, user.id, evaluated, legacyAllows);
    }

    if (!legacyAllows) {
      if (evaluated.length === 1) {
        const [{ requirement, memberLevel }] = evaluated;
        throw new ForbiddenException(
          `Insufficient permissions: ${requirement.module} requires ${requirement.minLevel} access (you have ${memberLevel})`,
        );
      }
      const needed = evaluated.map((e) => `${e.requirement.module} ${e.requirement.minLevel}`).join(' or ');
      const held = evaluated.map((e) => `${e.requirement.module}:${e.memberLevel}`).join(', ');
      throw new ForbiddenException(`Insufficient permissions: requires ${needed} access (you have ${held})`);
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
    evaluated: Array<{ requirement: ModuleScopeRequirement; memberLevel: string; allows: boolean }>,
    legacyAllows: boolean,
  ): Promise<void> {
    if (!this.authority) return;
    try {
      for (const { requirement } of evaluated) {
        if (!isCanonicalModule(requirement.module)) {
          this.logger.warn(`[authority-shadow] non-canonical module "${requirement.module}" — skipped`);
          return;
        }
      }
      const result = await this.authority.resolve(businessId, userId);
      const resolverEntries = evaluated.map(({ requirement }) => {
        const decision = result.modules[requirement.module as keyof typeof result.modules];
        const allows = LEVEL_RANK[decision.level] >= (LEVEL_RANK[requirement.minLevel] ?? 1);
        return { requirement, decision, allows };
      });
      const resolverAllows = resolverEntries.some((entry) => entry.allows);

      if (resolverAllows === legacyAllows) return;

      const primary = resolverEntries[0];
      const reason =
        typeof primary.decision.reason === 'string' && primary.decision.reason ? primary.decision.reason : 'unknown';
      securitySignals.record('authority_shadow_mismatch', `${primary.requirement.module}:${reason}`);

      this.logger.warn(
        `[authority-shadow] MISMATCH business=${businessId} user=${userId} ` +
          `module=${evaluated.map((e) => e.requirement.module).join('|')} ` +
          `min=${evaluated.map((e) => e.requirement.minLevel).join('|')} ` +
          `legacy=${legacyAllows ? 'ALLOW' : 'DENY'}(${evaluated.map((e) => e.memberLevel).join('|')}) ` +
          `resolver=${resolverAllows ? 'ALLOW' : 'DENY'}(${resolverEntries.map((e) => e.decision.level).join('|')}) ` +
          `reason=${reason} explicitDeny=${primary.decision.explicitDeny} ` +
          `positions=${result.positions.length} truncated=${result.validity.truncated}`,
      );
    } catch (err) {
      // A shadow that can fail the request it is shadowing is not observation, it is a
      // second point of failure in the authority path.
      this.logger.warn(`[authority-shadow] failed, legacy answer unaffected: ${(err as Error).message}`);
    }
  }
}

import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { CANONICAL_MODULES, LEVEL_RANK, defaultScopesForRole, isAccessLevel, type AccessLevel, type CanonicalModule } from '../authority/module-vocabulary';

/** The member a request acts for, as AuthMiddleware attaches it. */
export type ModuleLevelActor = { id?: string; role?: string } | null | undefined;

/**
 * SWEEP-P0-SCOPES review repair: a member's level on one module of a business, read exactly as
 * ModuleScopeGuard reads it, for a handler that must decide by level after the guard has run (a
 * webhook's events name other modules; a settings read member is answered less than a writer).
 *
 * The membership's explicit permissionScopes map, where a missing key is none
 * (EXPLICIT_MAP_MISSING_KEY), else its role's defaults; no membership is none. A platform
 * SUPER_ADMIN is admin, as ModuleScopeGuard passes them.
 *
 * Second review repair (SV-4): any stored JSON object is the explicit map, a JSON array included,
 * as the guard reads it (`typeof scopes === 'object'`): an array names no module, so every module
 * is none. This read had sent an array to the role defaults, and the owner's team route stores one
 * without complaint (PATCH .../team/:m/permissions { scopes: [] }), so an ADMIN the guard refuses
 * everywhere passed the handler checks that use this helper alone (clearing connector credentials).
 */
export async function memberModuleLevel(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
  module: string,
): Promise<AccessLevel> {
  if (!actor?.id) return 'none';
  if (actor.role === 'SUPER_ADMIN') return 'admin';
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: actor.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return 'none';
  const stored = membership.permissionScopes;
  const scopes: Record<string, unknown> =
    stored && typeof stored === 'object' ? (Array.isArray(stored) ? {} : (stored as Record<string, unknown>)) : defaultScopesForRole(membership.role);
  const level = scopes[module];
  return isAccessLevel(level) ? level : 'none';
}

/**
 * NAV-A1 (owner rulings D-150 'hubs', D-179 'legacyaccess'): the caller's own level on every canonical module of a
 * business, by memberModuleLevel's rule (one membership read for all of them), so the web shows a member only the
 * hubs their scopes let open. It names only the actor's own levels, which ModuleScopeGuard's refusals already state,
 * and grants nothing.
 */
export async function memberModuleLevels(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
): Promise<Record<CanonicalModule, AccessLevel>> {
  const levels = {} as Record<CanonicalModule, AccessLevel>;
  const all = (level: AccessLevel) => {
    for (const module of CANONICAL_MODULES) levels[module] = level;
    return levels;
  };
  if (!actor?.id) return all('none');
  if (actor.role === 'SUPER_ADMIN') return all('admin');
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: actor.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return all('none');
  const stored = membership.permissionScopes;
  const scopes: Record<string, unknown> =
    stored && typeof stored === 'object' ? (Array.isArray(stored) ? {} : (stored as Record<string, unknown>)) : defaultScopesForRole(membership.role);
  for (const module of CANONICAL_MODULES) {
    const level = scopes[module];
    levels[module] = isAccessLevel(level) ? level : 'none';
  }
  return levels;
}

/**
 * SWEEP-P0-SCOPES round 1 class repair (CLASS B): the same rule for a KEY command, which carries its
 * human actor as an id (`command.userId`: KeyCortexController takes it from the principal AuthGuard
 * admitted, never from the request): the actor's User role is read as AuthMiddleware attaches it, so
 * SUPER_ADMIN passes as ModuleScopeGuard passes it. A command with no human actor is refused.
 */
export async function assertCommandActorModuleLevel(
  prisma: PrismaService,
  businessId: string,
  actorId: unknown,
  module: string,
  minLevel: 'read' | 'write' | 'admin',
): Promise<AccessLevel> {
  if (typeof actorId !== 'string' || actorId.length === 0) throw new ForbiddenException('Authentication required');
  const user = await prisma.client.user.findUnique({ where: { id: actorId }, select: { role: true } });
  return assertMemberModuleLevel(prisma, businessId, { id: actorId, role: user?.role ?? undefined }, module, minLevel);
}

/**
 * The same refusal ModuleScopeGuard answers (403, the same words), for a handler that applies a
 * module level itself (in order, after a stricter rule it must keep answering first). Returns the
 * member's level.
 */
export async function assertMemberModuleLevel(
  prisma: PrismaService,
  businessId: string,
  actor: ModuleLevelActor,
  module: string,
  minLevel: 'read' | 'write' | 'admin',
): Promise<AccessLevel> {
  if (!actor?.id) throw new ForbiddenException('Authentication required');
  const level = await memberModuleLevel(prisma, businessId, actor, module);
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    throw new ForbiddenException(`Insufficient permissions: ${module} requires ${minLevel} access (you have ${level})`);
  }
  return level;
}

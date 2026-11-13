import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { LEVEL_RANK, defaultScopesForRole, isAccessLevel, type AccessLevel } from '../authority/module-vocabulary';

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

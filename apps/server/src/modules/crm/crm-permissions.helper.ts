import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereWithId } from './crm.helpers';

/**
 * Effective CRM permissions derived from membership.role + permissionScopes.
 *
 * Beyond the per-module read/write/admin level used by ModuleScopeGuard,
 * M7 ownership introduces sub-flags so STAFF can be limited to "their book"
 * without losing CRM module access. Defaults are derived from the legacy
 * `crm` level when membership scopes don't explicitly override them, so
 * existing memberships keep working unchanged.
 *
 * Override keys (membership.permissionScopes JSON):
 *   crm_view     : 'all' | 'owned'                  (read scope)
 *   crm_edit     : 'any' | 'owned' | 'none'         (write scope)
 *   crm_reassign : 'true' | 'false'                 (reassign owner action)
 *   crm_delete   : 'any' | 'owned' | 'none'         (delete scope)
 */
export type CrmAccess = {
  isOwner: boolean;
  isSuperAdmin: boolean;
  viewAll: boolean;
  editScope: 'any' | 'owned' | 'none';
  reassign: boolean;
  deleteScope: 'any' | 'owned' | 'none';
  level: 'none' | 'read' | 'write' | 'admin';
};

const FULL_ACCESS: Omit<CrmAccess, 'isOwner' | 'isSuperAdmin'> = {
  viewAll: true,
  editScope: 'any',
  reassign: true,
  deleteScope: 'any',
  level: 'admin',
};

export function defaultCrmAccessForLevel(level: string): Omit<CrmAccess, 'isOwner' | 'isSuperAdmin'> {
  switch (level) {
    case 'admin':
      return { ...FULL_ACCESS, level: 'admin' };
    case 'write':
      return { viewAll: true, editScope: 'any', reassign: false, deleteScope: 'owned', level: 'write' };
    case 'read':
      return { viewAll: true, editScope: 'none', reassign: false, deleteScope: 'none', level: 'read' };
    default:
      return { viewAll: false, editScope: 'none', reassign: false, deleteScope: 'none', level: 'none' };
  }
}

export async function resolveCrmAccess(
  prisma: PrismaService,
  businessId: string,
  userId: string,
): Promise<CrmAccess> {
  const user = await prisma.client.user.findUnique({ where: { id: userId } });
  if (!user) throw new ForbiddenException('User not found');
  if (user.role === 'SUPER_ADMIN') {
    return { ...FULL_ACCESS, isOwner: true, isSuperAdmin: true };
  }

  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });
  if (!membership) {
    throw new ForbiddenException('Not a member of this business');
  }

  const isOwner = membership.role === 'OWNER';
  if (isOwner) {
    return { ...FULL_ACCESS, isOwner: true, isSuperAdmin: false };
  }

  const scopes = (membership.permissionScopes && typeof membership.permissionScopes === 'object'
    ? (membership.permissionScopes as Record<string, string>)
    : null);

  const baseLevel = (scopes?.crm
    ?? (membership.role === 'ADMIN' ? 'admin' : 'read')) as CrmAccess['level'];

  const defaults = defaultCrmAccessForLevel(baseLevel);

  const viewOverride = scopes?.crm_view;
  const editOverride = scopes?.crm_edit as CrmAccess['editScope'] | undefined;
  const reassignOverride = scopes?.crm_reassign;
  const deleteOverride = scopes?.crm_delete as CrmAccess['deleteScope'] | undefined;

  return {
    isOwner: false,
    isSuperAdmin: false,
    level: baseLevel,
    viewAll: viewOverride ? viewOverride === 'all' : defaults.viewAll,
    editScope: editOverride ?? defaults.editScope,
    reassign: reassignOverride !== undefined ? reassignOverride === 'true' || reassignOverride === 'yes' : defaults.reassign,
    deleteScope: deleteOverride ?? defaults.deleteScope,
  };
}

/**
 * Build the visibility/ownership clause that must be AND'd onto every
 * Contact `where` for non-bypass users. Returns `null` when the caller
 * has full read access (OWNER, SUPER_ADMIN, or crm_view='all') AND no
 * PRIVATE rows need to be hidden.
 */
export function visibilityClause(access: CrmAccess, userId: string) {
  if (access.isOwner || access.isSuperAdmin) return null;

  if (access.viewAll) {
    // Sees TEAM + SHARED rows for everyone, but PRIVATE is always
    // restricted to owner or explicit share.
    return {
      OR: [
        { visibility: { in: ['TEAM', 'SHARED'] } },
        { ownerId: userId },
        { shares: { some: { userId } } },
      ],
    };
  }

  // "My book" only — owner or explicit share, regardless of visibility.
  return {
    OR: [
      { ownerId: userId },
      { shares: { some: { userId } } },
    ],
  };
}

/**
 * The record-visibility gate of a contact-scoped read: resolves when
 * `actorUserId` may open the contact by the rule GET contacts/:contactId
 * applies (CrmStatsService.contactDetail: the tenant predicate, deletedAt null
 * and visibilityClause), and otherwise throws exactly what that route throws
 * for an unknown id, NotFoundException('Contact not found'), so a hidden
 * contact and an absent one cannot be told apart. resolveCrmAccess refuses a
 * non-member 403 first. It reads the user, the membership and the contact row
 * only, so a caller it refuses never reaches the contact's child rows (V1-08,
 * M13).
 */
export async function assertContactVisible(
  prisma: PrismaService,
  businessId: string,
  contactId: string,
  actorUserId: string,
): Promise<void> {
  const access = await resolveCrmAccess(prisma, businessId, actorUserId);
  const where: Prisma.ContactWhereInput = { ...contactWhereWithId(businessId, contactId) };
  const visClause = visibilityClause(access, actorUserId);
  if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
  const visible = await prisma.client.contact.findFirst({ where, select: { id: true } });
  if (!visible) {
    throw new NotFoundException('Contact not found');
  }
}

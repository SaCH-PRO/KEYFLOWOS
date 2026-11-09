import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';

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
 * The record-visibility gate of a contact-scoped read: resolves to the
 * member's CrmAccess when `actorUserId` may open the contact by the rule GET
 * contacts/:contactId applies (CrmStatsService.contactDetail: the tenant predicate, deletedAt null
 * and visibilityClause), and otherwise throws exactly what that route throws
 * for an unknown id, NotFoundException('Contact not found'), so a hidden
 * contact and an absent one cannot be told apart. resolveCrmAccess refuses a
 * non-member 403 first. It reads the user, the membership and the contact row
 * only, so a caller it refuses never reaches the contact's child rows (V1-08,
 * M13).
 *
 * `includeDeleted` drops the deletedAt null term and keeps the tenant
 * predicate and visibilityClause: for the privacy routes that act on a contact
 * a forget soft-deleted for its grace period (audit, export, forget/cancel;
 * FOLLOW3-D3), so the member who may open the contact keeps the cancel window
 * (D-25). Every other caller leaves it unset.
 */
export async function assertContactVisible(
  prisma: PrismaService,
  businessId: string,
  contactId: string,
  actorUserId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<CrmAccess> {
  const access = await resolveCrmAccess(prisma, businessId, actorUserId);
  const visClause = visibilityClause(access, actorUserId);
  let visible: boolean;
  if (options.includeDeleted) {
    const where: Prisma.ContactWhereInput = { id: contactId, businessId };
    if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
    // The soft-delete extension (packages/db) adds deletedAt null to every
    // Contact find and count; aggregate is the read it leaves as written.
    const found = await prisma.client.contact.aggregate({ where, _count: { _all: true } });
    visible = found._count._all > 0;
  } else {
    const where: Prisma.ContactWhereInput = { ...contactWhereWithId(businessId, contactId) };
    if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
    visible = (await prisma.client.contact.findFirst({ where, select: { id: true } })) !== null;
  }
  if (!visible) {
    throw new NotFoundException('Contact not found');
  }
  return access;
}

/**
 * Which of `contactIds` the member may open, by the rule assertContactVisible
 * applies (the tenant predicate, deletedAt null and visibilityClause), for a
 * read whose answer names contacts besides the one it is about: the other end
 * of a relationship, a node of a network graph. One contact lookup, made only
 * when visibilityClause restricts the member. Returns null when it does not
 * (OWNER, SUPER_ADMIN): that caller's answer is left exactly as it was. An id
 * the predicate refuses must leave the answer together with everything that
 * names it, so a contact the member cannot open on GET detail is not disclosed
 * through a neighbour's read (V1-08 review ST-1, ST-3).
 */
export async function contactVisibilityFilter(
  prisma: PrismaService,
  businessId: string,
  access: CrmAccess,
  actorUserId: string,
  contactIds: Iterable<string | null | undefined>,
): Promise<((contactId: string) => boolean) | null> {
  const visClause = visibilityClause(access, actorUserId);
  if (!visClause) return null;
  const ids = [...new Set([...contactIds].filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return () => false;
  const rows = await prisma.client.contact.findMany({
    where: { ...contactWhereBase(businessId), id: { in: ids }, AND: [visClause as Prisma.ContactWhereInput] },
    select: { id: true },
  });
  const visible = new Set(rows.map((row: { id: string }) => row.id));
  return (contactId: string) => visible.has(contactId);
}

type RelationshipEdge = { fromContactId: string; toContactId: string };

/**
 * A contact's relationship graph (CrmNetworkService.getNeighbourhood) as the
 * member may see it: the walk from the root is redone over the edges whose
 * both ends the member may open, to the same depth, so a contact they cannot
 * open is dropped with its edges (and their notes), and so is a contact reached
 * only through one. Nodes and edges keep their shape; the walk keeps
 * getNeighbourhood's own rule (every edge of a node closer than `depth`).
 */
export function visibleNeighbourhood<
  G extends { rootId: string; nodes: Array<{ id: string }>; edges: RelationshipEdge[] },
>(graph: G, depth: number, canOpen: (contactId: string) => boolean): G {
  const shown = (id: string) => id === graph.rootId || canOpen(id);
  const open = graph.edges.filter((e) => shown(e.fromContactId) && shown(e.toContactId));
  const level = new Map<string, number>([[graph.rootId, 0]]);
  let frontier = new Set<string>([graph.rootId]);
  for (let d = 1; d <= depth && frontier.size > 0; d++) {
    const next = new Set<string>();
    for (const e of open) {
      if (frontier.has(e.fromContactId) && !level.has(e.toContactId)) next.add(e.toContactId);
      if (frontier.has(e.toContactId) && !level.has(e.fromContactId)) next.add(e.fromContactId);
    }
    next.forEach((id) => level.set(id, d));
    frontier = next;
  }
  const inner = (id: string) => (level.get(id) ?? Number.POSITIVE_INFINITY) < depth;
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => level.has(n.id)),
    edges: open.filter((e) => inner(e.fromContactId) || inner(e.toContactId)),
  };
}

/**
 * A business's relationship graph (CrmNetworkService.listGraphForBusiness) as
 * the member may see it: an edge stays only if the member may open both of its
 * ends, a node only if they may open it. A node the graph showed only because
 * of edges to contacts the member cannot open is dropped as well, so the graph
 * does not reveal that it has such a relationship; a node the graph already
 * showed without edges (its other ends filtered out or deleted) stays.
 */
export function visibleRelationshipGraph<
  G extends { nodes: Array<{ id: string }>; edges: RelationshipEdge[] },
>(graph: G, canOpen: (contactId: string) => boolean): G {
  const edges = graph.edges.filter((e) => canOpen(e.fromContactId) && canOpen(e.toContactId));
  const linkedBefore = new Set(graph.edges.flatMap((e) => [e.fromContactId, e.toContactId]));
  const linkedAfter = new Set(edges.flatMap((e) => [e.fromContactId, e.toContactId]));
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => canOpen(n.id) && (linkedAfter.has(n.id) || !linkedBefore.has(n.id))),
    edges,
  };
}

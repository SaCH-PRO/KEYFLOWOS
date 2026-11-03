import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import {
  CANONICAL_MODULES,
  LEVEL_RANK,
  defaultScopesForRole,
  rankOf,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';
import { contactVisibilityFilter, resolveCrmAccess, type CrmAccess } from '../crm/crm-permissions.helper';

/**
 * V1-84 (FOLLOW3-D1-TIMELINE-SCOPE): which Activity rows a member may read.
 *
 * GET /timeline/businesses/:id/events (the cockpit feed), .../summary/:date,
 * .../upcoming and the legacy GET /api/flows/businesses/:id/activity serve
 * Activity rows. Before V1-84 they served every row of the business to every
 * member (SEC-V125-1, SEC-V125-2): a STAFF member with revenue 'none' read
 * 'Payment recorded: TTD 150' and its revenueImpact, and a member who may not
 * open a PRIVATE contact read the rows naming it.
 *
 * The rule, applied to every row of those four reads (rows are filtered, not
 * the read refused, so a partial-scope member keeps a working feed):
 *   - its module, case-folded, maps through ACTIVITY_MODULE_SCOPES to a
 *     canonical module the member reads (ModuleScopeGuard's rule: the
 *     membership's explicit scope map, else its role's defaults);
 *   - a module the table does not map is read by OWNER and ADMIN only (and
 *     SUPER_ADMIN). Owner ruling D-63; timeline-visibility.spec.ts keeps that
 *     set empty for every module written at head;
 *   - a row whose category is a revenue category (COMMERCE, PAYMENT, FINANCE)
 *     or that carries a revenueImpact also needs revenue read: it carries an
 *     amount;
 *   - a row that names a contact also needs crm read, and the contact must be
 *     one the member may open (visibilityClause, M7, via contactVisibilityFilter
 *     — the rule GET contacts/:id applies).
 */

/**
 * Activity.module (case-folded) -> the canonical module that governs its rows.
 * Pinned by owner ruling D-63. Activity.module is free text written in both
 * cases ('commerce' / 'COMMERCE', 'projects' / 'PROJECT'), so keys are lower
 * case and lookups fold. A new writer with a module not listed here fails
 * timeline-visibility.spec.ts (TV-01) until an entry is added.
 */
export const ACTIVITY_MODULE_SCOPES: Readonly<Record<string, CanonicalModule>> = Object.freeze({
  // revenue: money rows (commerce, invoicing, payments, the ledger)
  commerce: 'revenue',
  revenue: 'revenue',
  finance: 'revenue',
  invoicing: 'revenue',
  payments: 'revenue',
  // crm; D-63 (iii): communications / messages / inbox rows are contact traffic
  crm: 'crm',
  contacts: 'crm',
  communications: 'crm',
  messages: 'crm',
  inbox: 'crm',
  bookings: 'bookings',
  // operations: procurement and the command centre (their routes require operations)
  operations: 'operations',
  procurement: 'operations',
  command: 'operations',
  commandcenter: 'operations',
  expenses: 'expenses',
  expense: 'expenses',
  projects: 'projects',
  project: 'projects',
  automation: 'automations',
  automations: 'automations',
  flow: 'automations',
  content: 'content',
  social: 'content',
  marketing: 'content',
  storefront: 'storefront',
  // D-63 (iv): analytics rows -> analytics; genome, site and notifications -> settings
  analytics: 'analytics',
  // D-63 (ii): settings rows
  settings: 'settings',
  genome: 'settings',
  site: 'settings',
  notifications: 'settings',
  // D-63 (i): KEY / AI rows
  ai: 'ai',
  agent: 'ai',
  'key-ai': 'ai',
  key_cortex: 'ai',
  key_inbox: 'ai',
  intelligence: 'ai',
  autopilot: 'ai',
  connect: 'connect',
});

/** Activity.category values (case-folded) that mark a row as carrying money. */
const REVENUE_CATEGORIES: ReadonlySet<string> = new Set(['commerce', 'payment', 'finance']);

/** The canonical module an Activity.module maps to, case-folded; null when unmapped. */
export function activityModuleScope(module: string | null | undefined): CanonicalModule | null {
  if (typeof module !== 'string') return null;
  const key = module.trim().toLowerCase();
  if (!key || !Object.prototype.hasOwnProperty.call(ACTIVITY_MODULE_SCOPES, key)) return null;
  return ACTIVITY_MODULE_SCOPES[key];
}

/** The fields of an Activity row the rule reads. */
export interface ActivityRowLike {
  module?: string | null;
  category?: string | null;
  contactId?: string | null;
  revenueImpact?: unknown;
}

/** The caller of a feed read, as the rule needs them. */
export interface TimelineViewer {
  readonly businessId: string;
  readonly userId: string;
  /** SUPER_ADMIN, OWNER or ADMIN: may read rows of a module the table does not map (D-63). */
  readonly readsUnmapped: boolean;
  /** The canonical modules this member reads. */
  readonly readable: ReadonlySet<CanonicalModule>;
  /** The member's CRM access, for contact visibility (visibilityClause). */
  readonly crmAccess: CrmAccess;
}

const FULL_CRM_ACCESS: CrmAccess = {
  isOwner: true,
  isSuperAdmin: false,
  viewAll: true,
  editScope: 'any',
  reassign: true,
  deleteScope: 'any',
  level: 'admin',
};

/**
 * The viewer for `userId` in `businessId`. The module rule is ModuleScopeGuard's
 * (an explicit scope map, else the role's defaults; a key absent from an
 * explicit map is 'none'); the contact rule is resolveCrmAccess's. A business
 * owner with no Membership row (BusinessGuard admits them through
 * Business.ownerId) is read as OWNER. Anyone else without a membership is
 * refused, as ModuleScopeGuard refuses them.
 */
export async function resolveTimelineViewer(prisma: PrismaService, businessId: string, userId: string): Promise<TimelineViewer> {
  const user = await prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new ForbiddenException('User not found');
  if (user.role === 'SUPER_ADMIN') {
    return { businessId, userId, readsUnmapped: true, readable: new Set(CANONICAL_MODULES), crmAccess: { ...FULL_CRM_ACCESS, isSuperAdmin: true } };
  }

  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  let role: string;
  if (membership) {
    role = membership.role;
  } else {
    const owned = await prisma.client.business.findFirst({ where: { id: businessId, ownerId: userId }, select: { id: true } });
    if (!owned) throw new ForbiddenException('Not a member of this business');
    role = 'OWNER';
  }

  const scopes: Record<string, string> =
    membership?.permissionScopes && typeof membership.permissionScopes === 'object'
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(role);
  const readable = new Set(CANONICAL_MODULES.filter((m) => rankOf(scopes[m] || 'none') >= LEVEL_RANK.read));
  const crmAccess = membership && role !== 'OWNER' ? await resolveCrmAccess(prisma, businessId, userId) : FULL_CRM_ACCESS;
  return { businessId, userId, readsUnmapped: role === 'OWNER' || role === 'ADMIN', readable, crmAccess };
}

/**
 * Whether the viewer may read a row by its module, category, revenueImpact and
 * whether it names a contact. Which contact it names is checked separately
 * (filterVisibleActivity), because that needs the contact rows.
 */
export function canReadActivityRow(viewer: TimelineViewer, row: ActivityRowLike): boolean {
  const scope = activityModuleScope(row.module);
  if (scope === null) {
    if (!viewer.readsUnmapped) return false;
  } else if (!viewer.readable.has(scope)) {
    return false;
  }
  const category = typeof row.category === 'string' ? row.category.trim().toLowerCase() : '';
  const carriesMoney = REVENUE_CATEGORIES.has(category) || (row.revenueImpact !== null && row.revenueImpact !== undefined);
  if (carriesMoney && !viewer.readable.has('revenue')) return false;
  if (row.contactId && !viewer.readable.has('crm')) return false;
  return true;
}

/**
 * Prisma `where` terms that drop, in the database, rows the rule would drop
 * anyway (so a page is filled with fewer reads): rows naming a contact for a
 * member without crm read, rows with a revenueImpact for a member without
 * revenue read. The rule itself is canReadActivityRow.
 */
export function activityPrefilter(viewer: TimelineViewer): Array<Record<string, unknown>> {
  const terms: Array<Record<string, unknown>> = [];
  if (!viewer.readable.has('crm')) terms.push({ contactId: null });
  if (!viewer.readable.has('revenue')) terms.push({ revenueImpact: null });
  return terms;
}

/** The rows of `rows` the viewer may read, in order. */
export async function filterVisibleActivity<T extends ActivityRowLike>(
  prisma: PrismaService,
  viewer: TimelineViewer,
  rows: T[],
): Promise<T[]> {
  const readable = rows.filter((row) => canReadActivityRow(viewer, row));
  const canOpen = await contactVisibilityFilter(
    prisma,
    viewer.businessId,
    viewer.crmAccess,
    viewer.userId,
    readable.map((row) => row.contactId),
  );
  if (!canOpen) return readable;
  return readable.filter((row) => !row.contactId || canOpen(row.contactId));
}

/**
 * The most rows one feed read examines while filling a page. A member who may
 * read few of a business's rows gets a shorter page rather than a scan of the
 * whole table.
 */
export const TIMELINE_SCAN_LIMIT = 5000;

/** The smallest batch read while filling a page. */
const SCAN_BATCH = 100;

/**
 * Up to `limit` rows the viewer may read, in the order `fetch` returns them.
 * `fetch(skip, take)` reads one batch of the underlying query (whose order must
 * be total, so batches neither repeat nor skip rows); batches are read until
 * the page is full, the query is exhausted or TIMELINE_SCAN_LIMIT rows have
 * been examined.
 */
export async function readVisibleActivityPage<T extends ActivityRowLike>(
  prisma: PrismaService,
  viewer: TimelineViewer,
  limit: number,
  fetch: (skip: number, take: number) => Promise<T[]>,
): Promise<T[]> {
  const page: T[] = [];
  let skip = 0;
  while (page.length < limit && skip < TIMELINE_SCAN_LIMIT) {
    const take = Math.min(Math.max(limit, SCAN_BATCH), TIMELINE_SCAN_LIMIT - skip);
    const batch = await fetch(skip, take);
    page.push(...(await filterVisibleActivity(prisma, viewer, batch)));
    if (batch.length < take) break;
    skip += batch.length;
  }
  return page.slice(0, limit);
}

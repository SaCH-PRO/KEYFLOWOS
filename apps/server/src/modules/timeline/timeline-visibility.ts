import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import {
  CANONICAL_MODULES,
  LEVEL_RANK,
  defaultScopesForRole,
  rankOf,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';
import { resolveCrmAccess, visibilityClause, type CrmAccess } from '../crm/crm-permissions.helper';

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
 *     amount; so does a row whose data carries an amount (MONEY_DATA_FIELDS),
 *     whatever its category (W5-FEED-CATEGORIES, SEC-FCC-1: copies stored as
 *     CONTACT before V55-13 / D-90, read without a backfill);
 *   - a row that names a contact also needs crm read, and the contact must be
 *     one the member may open (visibilityClause, M7, the rule GET contacts/:id
 *     applies). A row names the contact in its contactId, and the one in its
 *     entityId when its entityType, case-folded, is 'contact' (namedContacts;
 *     review ST-1: the KEY send-message row names its contact that way only).
 *     A contact that is soft-deleted is judged by its visibility all the same
 *     (review CR-1: its history and money rows stay with the members who could
 *     open it); an id that is no contact of the business has no visibility to
 *     judge and is served to OWNER and SUPER_ADMIN only (hiddenContacts).
 *
 * What the rule cannot see: a row that names a contact only in its title or
 * detail text (review ST-2, e.g. 'Invoice <n> sent to <name>'). Those writers
 * are listed in timeline-visibility.spec.ts (TV-07, TEXT_ONLY_CONTACT_WRITERS)
 * until they set contactId.
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

/**
 * W5-FEED-CATEGORIES (SEC-FCC-1; owner rulings D-90 and D-63): the top-level
 * Activity.data fields that carry an amount. The same list CrmTimelineService
 * (crm-timeline.service.ts, MONEY_DATA_KEYS) uses since V55-13 to write a CRM
 * copy that carries money as COMMERCE.
 */
export const MONEY_DATA_FIELDS: readonly string[] = Object.freeze([
  'amount',
  'total',
  'subtotal',
  'invoiceTotal',
  'totalPaid',
  'paymentAmount',
  'refundAmount',
  'depositAmount',
]);

/**
 * Whether a stored row's data carries an amount (a MONEY_DATA_FIELDS field set
 * to anything but null). W5-FEED-CATEGORIES (SEC-FCC-1, D-90 / D-63): rows
 * already stored before V55-13 / D-90 keep the category they were written
 * with (CONTACT, or none before categories existed) whatever they carry, e.g.
 * crm:invoice.payment_recorded:contact copies with the payment's amount; the
 * rule reads their data instead of a backfill (no data migration). Data stored
 * as a JSON string is read as the object it encodes. It holds for every
 * module, as the category and revenueImpact terms do: e.g. ExpensesService's
 * EXPENSE rows (data.amount) now also need revenue read.
 */
export function dataCarriesMoney(data: unknown): boolean {
  let fields: unknown = data;
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields);
    } catch {
      return false;
    }
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
  const record = fields as Record<string, unknown>;
  return MONEY_DATA_FIELDS.some((key) => record[key] !== null && record[key] !== undefined);
}

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
  entityType?: string | null;
  entityId?: string | null;
  revenueImpact?: unknown;
  /** Activity.data: a row whose data carries an amount is a revenue row (W5-FEED-CATEGORIES). */
  data?: unknown;
}

/**
 * The contacts a row names: its contactId, and its entityId when its
 * entityType, case-folded, is 'contact' (both when both are set and differ).
 * Review ST-1: ActivityLogService.createActivity rows such as the KEY
 * send-message row ({ entityType: 'contact', entityId, title: 'Message sent
 * to <name> ...' }) carry no contactId.
 */
export function namedContacts(row: ActivityRowLike): string[] {
  const out: string[] = [];
  if (typeof row.contactId === 'string' && row.contactId.length > 0) out.push(row.contactId);
  const entityType = typeof row.entityType === 'string' ? row.entityType.trim().toLowerCase() : '';
  if (entityType === 'contact' && typeof row.entityId === 'string' && row.entityId.length > 0 && row.entityId !== row.contactId) {
    out.push(row.entityId);
  }
  return out;
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
 * Whether the viewer may read a row by its module, category, revenueImpact,
 * data and whether it names a contact. Which contact it names is checked
 * separately (filterVisibleActivity), because that needs the contact rows.
 *
 * W5-FEED-CATEGORIES (SEC-FCC-1, D-90 / D-63): a row whose data carries an
 * amount (dataCarriesMoney) is a revenue row whatever its category, so a CRM
 * copy stored as CONTACT before V55-13 / D-90 is not served, its amount
 * included, to a member without revenue read.
 */
export function canReadActivityRow(viewer: TimelineViewer, row: ActivityRowLike): boolean {
  const scope = activityModuleScope(row.module);
  if (scope === null) {
    if (!viewer.readsUnmapped) return false;
  } else if (!viewer.readable.has(scope)) {
    return false;
  }
  const category = typeof row.category === 'string' ? row.category.trim().toLowerCase() : '';
  const carriesMoney =
    REVENUE_CATEGORIES.has(category) || (row.revenueImpact !== null && row.revenueImpact !== undefined) || dataCarriesMoney(row.data);
  if (carriesMoney && !viewer.readable.has('revenue')) return false;
  if (namedContacts(row).length > 0 && !viewer.readable.has('crm')) return false;
  return true;
}

/**
 * Prisma `where` terms that drop, in the database, rows the rule would drop
 * anyway (so a page is filled with fewer reads): rows naming a contact (by
 * contactId, or by entityType 'contact' and an entityId) for a member without
 * crm read, rows with a revenueImpact for a member without revenue read. They
 * never drop a row the rule would serve; the rule itself is canReadActivityRow
 * (which also withholds a row whose data carries an amount; that one is
 * judged per row, not here).
 */
export function activityPrefilter(viewer: TimelineViewer): Array<Record<string, unknown>> {
  const terms: Array<Record<string, unknown>> = [];
  if (!viewer.readable.has('crm')) {
    terms.push({ contactId: null });
    terms.push({ OR: [{ entityId: null }, { entityId: '' }, { NOT: { entityType: { equals: 'contact', mode: 'insensitive' } } }] });
  }
  if (!viewer.readable.has('revenue')) terms.push({ revenueImpact: null });
  return terms;
}

/**
 * Which of `contactIds` the viewer may not open: the contacts of the business
 * (soft-deleted or not) that visibilityClause (M7) does not admit, and the ids
 * that are no contact of the business (nothing to judge them by, so they are
 * withheld from every member visibilityClause restricts). Null when
 * visibilityClause does not restrict the viewer (OWNER, SUPER_ADMIN): nothing
 * is withheld. Unlike contactVisibilityFilter (GET detail's rule, which also
 * requires deletedAt null), a soft-deleted contact is judged by its visibility,
 * so a view-all member keeps its history and money rows (review CR-1).
 *
 * The contacts are read through the business's `contacts` relation, not
 * contact.findMany: @keyflow/db's soft-delete extension adds deletedAt null to
 * every top-level Contact read, so a top-level read cannot see a soft-deleted
 * contact's visibility at all. The relation read applies the same predicate
 * (the business, the ids, visibilityClause) with deletedAt left out; TS-12a
 * (timeline-scope.integration.test.ts) fails if it ever stops seeing them.
 */
async function hiddenContacts(
  prisma: PrismaService,
  viewer: TimelineViewer,
  contactIds: Iterable<string>,
): Promise<ReadonlySet<string> | null> {
  const clause = visibilityClause(viewer.crmAccess, viewer.userId);
  if (!clause) return null;
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return new Set();
  const business = await prisma.client.business.findFirst({
    where: { id: viewer.businessId },
    select: { contacts: { where: { id: { in: ids }, AND: [clause as Prisma.ContactWhereInput] }, select: { id: true } } },
  });
  const visible = new Set((business?.contacts ?? []).map((row: { id: string }) => row.id));
  return new Set(ids.filter((id) => !visible.has(id)));
}

/** The rows of `rows` the viewer may read, in order. */
export async function filterVisibleActivity<T extends ActivityRowLike>(
  prisma: PrismaService,
  viewer: TimelineViewer,
  rows: T[],
): Promise<T[]> {
  const readable = rows.filter((row) => canReadActivityRow(viewer, row));
  const hidden = await hiddenContacts(prisma, viewer, readable.flatMap(namedContacts));
  if (!hidden) return readable;
  return readable.filter((row) => namedContacts(row).every((id) => !hidden.has(id)));
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

import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getContactEventCategory } from '@keyflow/shared';
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
 *     set empty for every module written at head. The D-115 backfill's
 *     withheld module is the one deliberate exception: such a row also needs
 *     its original module's scope (SEC-W10DCS-1), and one whose reason is not
 *     'source_gone' is read by OWNER and SUPER_ADMIN only (owner ruling D-118,
 *     W11-D118-NAME-MISMATCH-OWNER-ONLY; readsOwnerWithheld);
 *   - a row whose category is a revenue category (COMMERCE, PAYMENT, FINANCE)
 *     or that carries a revenueImpact also needs revenue read: it carries an
 *     amount; so does a crm-scope row whose data carries an amount
 *     (MONEY_DATA_FIELDS) or whose action is a sales_revenue type, whatever
 *     its category (W5-FEED-CATEGORIES, SEC-FCC-1 / CR-W5FC-2: copies stored
 *     as CONTACT before V55-13 / D-90, read without a backfill; rows of other
 *     modules keep D-63's binding, SEC-W5FC-2 / CR-W5FC-1);
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
 * as a JSON string is read as the object it encodes. The rule applies it to
 * crm-scope rows only (crmRowCarriesMoney; review SEC-W5FC-2 / CR-W5FC-1).
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

/**
 * W5-FEED-CATEGORIES review (CR-W5FC-2, SEC-W5FC-2, CR-W5FC-1; owner rulings
 * D-90 and D-63): whether a crm-scope row (its module maps to crm, D-63) is a
 * money row whatever its stored category, by the rule V55-13 writes a CRM
 * copy's category with today (crm-timeline.service.ts contactEventCopyCategory
 * -> COMMERCE): its action or type is a sales_revenue ContactEvent type
 * (@keyflow/shared getContactEventCategory; e.g. deal.created / won / lost,
 * whose amount is data.value, a field not on the money list), or its data
 * carries a MONEY_DATA_FIELDS field. So a copy stored as CONTACT (or with no
 * category) before V55-13 / D-90 and today's copy of the same event get the
 * same visibility.
 *
 * It reads crm-scope rows only: crm read grants no amount (the revenue scope
 * does), whereas a row of a module with its own scope keeps D-63's binding,
 * e.g. ExpensesService's EXPENSE rows carry data.amount and are read on
 * expenses read, as GET /expenses serves the same amounts (no ruling gates
 * them on revenue).
 */
export function crmRowCarriesMoney(row: ActivityRowLike): boolean {
  if (activityModuleScope(row.module) !== 'crm') return false;
  for (const eventType of [row.action, row.type]) {
    if (typeof eventType === 'string' && getContactEventCategory(eventType.trim()) === 'sales_revenue') return true;
  }
  return dataCarriesMoney(row.data);
}

/** The canonical module an Activity.module maps to, case-folded; null when unmapped. */
export function activityModuleScope(module: string | null | undefined): CanonicalModule | null {
  if (typeof module !== 'string') return null;
  const key = module.trim().toLowerCase();
  if (!key || !Object.prototype.hasOwnProperty.call(ACTIVITY_MODULE_SCOPES, key)) return null;
  return ACTIVITY_MODULE_SCOPES[key];
}

/**
 * The module the D-115 operator backfill (scripts/backfill-timeline-contact-links.ts,
 * WITHHELD_MODULE) files a withheld row under. It is unmapped, so only OWNER and
 * ADMIN read such a row (D-63), and the row keeps its original module under
 * data.d115.module. Owner ruling D-118 (W11-D118-NAME-MISMATCH-OWNER-ONLY) narrows
 * that for a row whose reason (data.d115.withheld) is not 'source_gone': OWNER and
 * SUPER_ADMIN only (d115WithheldOwnerOnly).
 */
export const D115_WITHHELD_MODULE = 'd115_withheld';

/** Whether a row is filed under D115_WITHHELD_MODULE (case-folded, as Activity.module is free text). */
function isD115Withheld(row: ActivityRowLike): boolean {
  return typeof row.module === 'string' && row.module.trim().toLowerCase() === D115_WITHHELD_MODULE;
}

/**
 * Owner ruling D-118 (W11-D118-NAME-MISMATCH-OWNER-ONLY; review SEC-W10DCS-2, ruling R-1),
 * narrowing D-115: whether a D-115 withheld row is served to the OWNER and SUPER_ADMIN only
 * (TimelineViewer.readsOwnerWithheld) rather than to OWNER and ADMIN. The backfill records
 * why it withheld the row in data.d115.withheld: 'source_gone' (no source in the row's
 * business, or a source whose contact is another business's) keeps D-115; 'name_mismatch'
 * (an invoice row whose invoice is there but names another contact, so its title may name a
 * PRIVATE contact) is owner-only. Any other reason, or none (no data, data not an object, no
 * d115 marker), is read as owner-only too: fail closed. False for a row of any other module.
 */
function d115WithheldOwnerOnly(row: ActivityRowLike): boolean {
  if (!isD115Withheld(row)) return false;
  const data = row.data;
  const d115 = data && typeof data === 'object' ? (data as Record<string, unknown>).d115 : undefined;
  const reason = d115 && typeof d115 === 'object' ? (d115 as Record<string, unknown>).withheld : undefined;
  return reason !== 'source_gone';
}

/**
 * The scope of the module a D-115 withheld row had before the backfill; null for
 * any other row, or when the stored original module is unmapped. Review
 * SEC-W10DCS-1 / CR-W10DCS-1 (D-115 with D-114's principle): the backfill must
 * not serve a row to an ADMIN whose explicit scopes withheld it before, e.g. a
 * message_intake.approved row (communications, read on crm) to an ADMIN whose
 * crm access is 'none'.
 */
function withheldSourceScope(row: ActivityRowLike): CanonicalModule | null {
  if (!isD115Withheld(row)) return null;
  const data = row.data;
  if (!data || typeof data !== 'object') return null;
  const d115 = (data as Record<string, unknown>).d115;
  if (!d115 || typeof d115 !== 'object') return null;
  const original = (d115 as Record<string, unknown>).module;
  return typeof original === 'string' ? activityModuleScope(original) : null;
}

/** The fields of an Activity row the rule reads. */
export interface ActivityRowLike {
  module?: string | null;
  category?: string | null;
  contactId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  revenueImpact?: unknown;
  /** Activity.action and Activity.type: a crm-scope row of a sales_revenue type is a revenue row (W5-FEED-CATEGORIES review CR-W5FC-2). */
  action?: string | null;
  type?: string | null;
  /** Activity.data: a crm-scope row whose data carries an amount is a revenue row (W5-FEED-CATEGORIES). */
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
  /**
   * Owner ruling D-118 (W11-D118-NAME-MISMATCH-OWNER-ONLY): SUPER_ADMIN, or the D-116 owner
   * (an OWNER-role Membership of the business; D-125: a co-owner holding OWNER is the owner,
   * a recorded Business.ownerId holding only ADMIN or STAFF is not). May read a D-115 withheld
   * row whose reason is not 'source_gone' (d115WithheldOwnerOnly). Absent reads as false
   * (fail closed).
   */
  readonly readsOwnerWithheld?: boolean;
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
 * explicit map is 'none'); the contact rule is resolveCrmAccess's. SUPER_ADMIN
 * reads every module. Anyone else without a Membership is refused, as
 * ModuleScopeGuard and BusinessGuard refuse them: owner ruling D-104
 * (W10-OWNER-MEMBERSHIP) makes the Membership the one access rule, so a
 * Business.ownerId with no Membership row is refused too, not read as OWNER.
 *
 * Owner ruling D-118 (W11-D118-NAME-MISMATCH-OWNER-ONLY): readsOwnerWithheld is set for a
 * SUPER_ADMIN and for an OWNER-role Membership, the owner rule of D-116 as D-125 reads it
 * ("holds an OWNER membership of this business"; Business.ownerId grants nothing on its own,
 * so a recorded owner holding only an ADMIN or STAFF membership is that role).
 */
export async function resolveTimelineViewer(prisma: PrismaService, businessId: string, userId: string): Promise<TimelineViewer> {
  const user = await prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new ForbiddenException('User not found');
  if (user.role === 'SUPER_ADMIN') {
    return {
      businessId,
      userId,
      readsUnmapped: true,
      readsOwnerWithheld: true,
      readable: new Set(CANONICAL_MODULES),
      crmAccess: { ...FULL_CRM_ACCESS, isSuperAdmin: true },
    };
  }

  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): a Membership is the one access
  // rule; a Business.ownerId with no Membership row is refused as anyone else is.
  if (!membership) throw new ForbiddenException('Not a member of this business');
  const role: string = membership.role;

  const scopes: Record<string, string> =
    membership?.permissionScopes && typeof membership.permissionScopes === 'object'
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(role);
  const readable = new Set(CANONICAL_MODULES.filter((m) => rankOf(scopes[m] || 'none') >= LEVEL_RANK.read));
  const crmAccess = membership && role !== 'OWNER' ? await resolveCrmAccess(prisma, businessId, userId) : FULL_CRM_ACCESS;
  return {
    businessId,
    userId,
    readsUnmapped: role === 'OWNER' || role === 'ADMIN',
    // D-118 with D-116 / D-125: the owner is the OWNER-role Membership.
    readsOwnerWithheld: role === 'OWNER',
    readable,
    crmAccess,
  };
}

/**
 * Whether the viewer may read a row by its module, category, revenueImpact,
 * data and whether it names a contact. Which contact it names is checked
 * separately (filterVisibleActivity), because that needs the contact rows.
 *
 * W5-FEED-CATEGORIES (SEC-FCC-1, D-90 / D-63): a crm-scope row whose data
 * carries an amount, or (review CR-W5FC-2) whose action is a sales_revenue
 * type, is a revenue row whatever its category (crmRowCarriesMoney), so a CRM
 * copy stored as CONTACT before V55-13 / D-90 is not served, its amount
 * included, to a member without revenue read. Rows of other modules keep
 * D-63's binding (review SEC-W5FC-2 / CR-W5FC-1: EXPENSE rows on expenses).
 *
 * A row of an unmapped module needs readsUnmapped (D-63); a D-115 withheld row also needs
 * read on its original module's scope (SEC-W10DCS-1) and, owner ruling D-118
 * (W11-D118-NAME-MISMATCH-OWNER-ONLY), readsOwnerWithheld unless its reason is
 * 'source_gone' (d115WithheldOwnerOnly: name_mismatch, absent or unknown reasons are
 * OWNER and SUPER_ADMIN only). The money and contact terms below bind every viewer.
 */
export function canReadActivityRow(viewer: TimelineViewer, row: ActivityRowLike): boolean {
  const scope = activityModuleScope(row.module);
  if (scope === null) {
    if (!viewer.readsUnmapped) return false;
    const source = withheldSourceScope(row);
    if (source !== null && !viewer.readable.has(source)) return false;
    if (d115WithheldOwnerOnly(row) && viewer.readsOwnerWithheld !== true) return false;
  } else if (!viewer.readable.has(scope)) {
    return false;
  }
  const category = typeof row.category === 'string' ? row.category.trim().toLowerCase() : '';
  const carriesMoney =
    REVENUE_CATEGORIES.has(category) || (row.revenueImpact !== null && row.revenueImpact !== undefined) || crmRowCarriesMoney(row);
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
 * (which also withholds a crm-scope row whose data carries an amount or whose
 * action is a sales_revenue type; that one is judged per row, not here).
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

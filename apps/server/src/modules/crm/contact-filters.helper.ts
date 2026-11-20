import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';
import { normalizeEmail, phoneSearchKeys } from './crm-duplicate.util';

/**
 * Shared filter primitives used by both the contacts list `where`-builder
 * (apps/server/src/modules/crm/crm.service.ts:listContacts) and smart
 * segments (apps/server/src/modules/crm/crm-lists.service.ts).
 *
 * Adding new keys here keeps the saved-views API and SMART list rules
 * in sync with the live contacts list query.
 */
export type ContactFilterPrimitives = {
  status?: string | string[];
  search?: string;
  hasUnpaidInvoices?: boolean;
  hasUpcomingBookings?: boolean;
  hasOpenDeals?: boolean;
  dealStageIds?: string[];
  staleDays?: number;
  newThisWeek?: boolean;
  tags?: string[];
  source?: string[];
  ownerId?: string;
  lifecycleStage?: string | string[];
  companyName?: string;
  industry?: string;
  city?: string;
  country?: string;
  segment?: string;
  doNotContact?: boolean;
  ageGroups?: string[];
  relationshipTypes?: string[];
  priorities?: string[];
  relationshipHealth?: string[];
  pipelineStages?: string[];
  favorite?: boolean;
  includeArchived?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  createdWithinDays?: number;
  minLeadScore?: number;
};

/**
 * A search typed into a contains filter matches the characters typed: '%' and '_' are the
 * pattern wildcards of the SQL Prisma emits for `contains` (it passes the value through
 * unescaped), so '%' found every contact and 'a_c' found 'abc' (SWP-CRM-SEARCH). Escaped with
 * the default escape character, backslash, they (and a backslash) match only themselves.
 */
export function escapeContainsText(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The most distinct tag spellings one search widens the tag match to. */
const SEARCH_TAGS_MAX = 1000;

/**
 * The tags in use in a business that contain `search`, in any case, as typed ('%' and '_'
 * literal) (SWP-CRM-SEARCH, BUG-081). Contact.tags is a text[] and Prisma's array filters match
 * whole elements only (`has`, `hasSome`), so the list search first reads which spellings of the
 * business's tags hold the text, then matches those whole tags (buildContactWhere's
 * `searchTags`). Only tag strings are read here; which contacts the member may see is decided by
 * the list query itself, so this read widens nothing. Capped at SEARCH_TAGS_MAX distinct tags.
 */
export async function findSearchTags(
  prisma: PrismaService,
  businessId: string,
  search: string | null | undefined,
): Promise<string[]> {
  const text = search?.trim();
  if (!text) return [];
  const pattern = `%${escapeContainsText(text)}%`;
  const rows = await prisma.client.$queryRaw<Array<{ tag: string }>>`
    SELECT DISTINCT t.tag
    FROM contacts c
    CROSS JOIN LATERAL unnest(c.tags) AS t(tag)
    WHERE c.business_id = ${businessId}
      AND c.deleted_at IS NULL
      AND t.tag ILIKE ${pattern} ESCAPE '\\'
    LIMIT ${SEARCH_TAGS_MAX}
  `;
  return rows.map((r) => r.tag);
}

/** What a caller resolved before building the `where` (not part of a saved view or list rule). */
export type ContactWhereOptions = {
  /** findSearchTags(search): the business's tags that contain the search text. */
  searchTags?: string[];
};

/**
 * Build a Prisma `where` clause for Contact queries from a primitives bag.
 * Excludes minRevenue (which requires an aggregate raw query — handled by
 * the lists service separately).
 */
export function buildContactWhere(
  businessId: string,
  filters: ContactFilterPrimitives | null | undefined,
  options: ContactWhereOptions = {},
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput & Record<string, unknown> = {
    ...contactWhereBase(businessId),
  };
  if (!filters) {
    where.archivedAt = null;
    return where;
  }

  if (filters.status) {
    where.status = Array.isArray(filters.status)
      ? { in: filters.status }
      : filters.status;
  }
  const searchValue = filters.search?.trim();
  if (searchValue) {
    const text = escapeContainsText(searchValue);
    const normalizedEmail = normalizeEmail(searchValue);
    const orConditions: Prisma.ContactWhereInput[] = [
      { firstName: { contains: text, mode: 'insensitive' } },
      { lastName: { contains: text, mode: 'insensitive' } },
      { displayName: { contains: text, mode: 'insensitive' } },
      { email: { contains: text, mode: 'insensitive' } },
      { phone: { contains: text, mode: 'insensitive' } },
      { companyName: { contains: text, mode: 'insensitive' } },
      { segment: { contains: text, mode: 'insensitive' } },
      // The tag as typed, and every tag of the business holding the text in any case (BUG-081).
      { tags: { hasSome: [...new Set([searchValue, ...(options.searchTags ?? [])])] } },
    ];
    if (normalizedEmail) orConditions.push({ emailNormalized: { contains: escapeContainsText(normalizedEmail) } });
    // The phone typed in any spelling of the number (BUG-083); keys hold only digits and '+'.
    for (const key of phoneSearchKeys(searchValue)) orConditions.push({ phoneNormalized: { contains: key } });
    where.OR = orConditions;
  }
  if (filters.hasUnpaidInvoices) {
    where.invoices = {
      some: { status: { in: ['SENT', 'OVERDUE'] }, deletedAt: null },
    };
  }
  if (filters.hasUpcomingBookings) {
    where.bookings = {
      some: { startTime: { gt: new Date() }, status: { notIn: ['CANCELLED'] }, deletedAt: null },
    };
  }
  if (filters.hasOpenDeals || (filters.dealStageIds && filters.dealStageIds.length > 0)) {
    const dealsSome: Prisma.DealWhereInput = { deletedAt: null, status: 'OPEN' };
    if (filters.dealStageIds && filters.dealStageIds.length > 0) {
      dealsSome.stageId = { in: filters.dealStageIds };
    }
    where.deals = { some: dealsSome };
  }
  if (filters.staleDays && filters.staleDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.staleDays);
    where.NOT = [
      { bookings: { some: { startTime: { gt: cutoff }, deletedAt: null } } },
    ];
    // Stale is known for longer than the window with no booking in it: a contact created inside
    // the window is not stale yet (SWP-CRM-SEARCH; a contact added a minute ago was listed).
    // An AND term, so createdAfter / createdWithinDays / newThisWeek below still apply.
    where.AND = [{ createdAt: { lt: cutoff } }];
  }
  if (filters.newThisWeek) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    where.createdAt = { gte: start };
  }

  let createdAtFilter: Prisma.DateTimeFilter | null = null;
  if (filters.createdWithinDays && filters.createdWithinDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.createdWithinDays);
    createdAtFilter = { ...(createdAtFilter ?? {}), gte: cutoff };
  }
  if (filters.createdAfter) {
    const d = new Date(filters.createdAfter);
    if (!isNaN(d.getTime())) createdAtFilter = { ...(createdAtFilter ?? {}), gte: d };
  }
  if (filters.createdBefore) {
    const d = new Date(filters.createdBefore);
    if (!isNaN(d.getTime())) createdAtFilter = { ...(createdAtFilter ?? {}), lte: d };
  }
  if (createdAtFilter && !filters.newThisWeek) {
    where.createdAt = createdAtFilter;
  }

  if (filters.tags && filters.tags.length > 0) where.tags = { hasSome: filters.tags };
  if (filters.source && filters.source.length > 0) where.source = { in: filters.source };
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.lifecycleStage) {
    where.lifecycleStage = Array.isArray(filters.lifecycleStage)
      ? { in: filters.lifecycleStage }
      : filters.lifecycleStage;
  }
  if (filters.companyName) where.companyName = { contains: filters.companyName, mode: 'insensitive' };
  if (filters.industry) where.industry = { contains: filters.industry, mode: 'insensitive' };
  if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
  if (filters.country) where.country = { contains: filters.country, mode: 'insensitive' };
  if (filters.segment) where.segment = filters.segment;
  if (typeof filters.doNotContact === 'boolean') where.doNotContact = filters.doNotContact;
  if (filters.ageGroups && filters.ageGroups.length > 0) where.ageGroup = { in: filters.ageGroups };
  if (filters.relationshipTypes && filters.relationshipTypes.length > 0) where.relationshipType = { in: filters.relationshipTypes };
  if (filters.priorities && filters.priorities.length > 0) where.priority = { in: filters.priorities };
  if (filters.relationshipHealth && filters.relationshipHealth.length > 0) where.relationshipHealth = { in: filters.relationshipHealth };
  if (filters.pipelineStages && filters.pipelineStages.length > 0) where.pipelineStage = { in: filters.pipelineStages };
  if (typeof filters.favorite === 'boolean') where.favorite = filters.favorite;
  if (filters.minLeadScore && filters.minLeadScore > 0) where.leadScore = { gte: filters.minLeadScore };

  if (!filters.includeArchived) where.archivedAt = null;

  return where;
}

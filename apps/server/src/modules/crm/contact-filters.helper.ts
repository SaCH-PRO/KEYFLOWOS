import type { Prisma } from '@prisma/client';
import { contactWhereBase } from './crm.helpers';
import { normalizeEmail, normalizePhone } from './crm-duplicate.util';

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
 * Build a Prisma `where` clause for Contact queries from a primitives bag.
 * Excludes minRevenue (which requires an aggregate raw query — handled by
 * the lists service separately).
 */
export function buildContactWhere(
  businessId: string,
  filters: ContactFilterPrimitives | null | undefined,
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
    const normalizedEmail = normalizeEmail(searchValue);
    const normalizedPhone = normalizePhone(searchValue);
    const orConditions: Prisma.ContactWhereInput[] = [
      { firstName: { contains: searchValue, mode: 'insensitive' } },
      { lastName: { contains: searchValue, mode: 'insensitive' } },
      { displayName: { contains: searchValue, mode: 'insensitive' } },
      { email: { contains: searchValue, mode: 'insensitive' } },
      { phone: { contains: searchValue, mode: 'insensitive' } },
      { companyName: { contains: searchValue, mode: 'insensitive' } },
      { segment: { contains: searchValue, mode: 'insensitive' } },
      { tags: { has: searchValue } },
    ];
    if (normalizedEmail) orConditions.push({ emailNormalized: { contains: normalizedEmail } });
    if (normalizedPhone) orConditions.push({ phoneNormalized: { contains: normalizedPhone } });
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

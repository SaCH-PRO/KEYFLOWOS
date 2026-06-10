import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Contact, Prisma } from '@prisma/client';
import {
  ContactCreatedPayload,
  ContactDeletedPayload,
  ContactMergedPayload,
  ContactUpdatedPayload,
} from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { sanitize } from '../../core/utils/sanitize';
import { BULK_LIMIT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './crm.constants';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CrmTimelineService } from './crm-timeline.service';
import { ContactCustomFieldValueService } from './contact-custom-field-value.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmListsService } from './crm-lists.service';
import { CrmFlowService } from './crm-flow.service';
import { ContactAuditService, ContactAuditActor } from './privacy/contact-audit.service';

/**
 * Optional request-scoped audit context that controllers can plumb
 * through to mutation methods so per-contact audit entries capture
 * actor/IP/UA. All fields are optional; when omitted the audit entry
 * is recorded with a SYSTEM actor.
 */
export interface AuditContext {
  actor?: ContactAuditActor | null;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}
import type { ContactMeta, ContactWithStats } from './crm-stats.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { buildContactWhere } from './contact-filters.helper';
import { resolveCrmAccess, visibilityClause, type CrmAccess } from './crm-permissions.helper';
import { normalizeEmail, normalizePhone, findExistingBulk } from './crm-duplicate.util';
import { CONTACT_EVENT } from '@keyflow/shared';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';

type ContactSortBy = 'name' | 'newest' | 'oldest' | 'revenue' | 'score' | 'lastInteraction';

export type ContactListOptions = {
  businessId: string;
  status?: string;
  search?: string;
  hasUnpaidInvoices?: boolean;
  hasUpcomingBookings?: boolean;
  hasOpenDeals?: boolean;
  dealStageIds?: string[];
  staleDays?: number;
  newThisWeek?: boolean;
  tags?: string[];
  ownerId?: string;
  lifecycleStage?: string;
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
  bestChannels?: string[];
  bestTimeNow?: boolean;
  bestTimeNowIds?: string[];
  skip?: number;
  take?: number;
  cursor?: string;
  includeStats?: boolean;
  sortBy?: ContactSortBy;
  sortOrder?: 'asc' | 'desc';
  minRevenue?: number;
  /**
   * When provided, applies M7 ownership/visibility scoping based on the
   * caller's effective CRM permissions. Server callers (cron, internal
   * jobs) can omit this to bypass scoping.
   */
  actorUserId?: string;
  /**
   * Restrict the result set to contacts owned by `actorUserId`. Used by
   * the "My Book" smart view in the web UI.
   */
  ownedByActor?: boolean;
};

type ContactExtraAttributes = {
  displayName?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  whatsappNumber?: string | null;
  preferredChannel?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  industry?: string | null;
  ownerId?: string | null;
  lifecycleStage?: string | null;
  sourceDetail?: string | null;
  segment?: string | null;
  language?: string | null;
  marketingOptIn?: boolean | null;
  doNotContact?: boolean | null;
  notesInternal?: string | null;
  ageGroup?: string | null;
  relationshipType?: string | null;
  pipelineStage?: string | null;
  relationshipHealth?: string | null;
  nextActionAt?: string | null;
  nextActionType?: string | null;
  priority?: string | null;
  favorite?: boolean | null;
  archivedAt?: string | null;
};

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmStatsService) private readonly stats: CrmStatsService,
    @Inject(CrmListsService) private readonly lists: CrmListsService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(ContactAuditService) private readonly contactAudit: ContactAuditService,
    @Inject(ContactCustomFieldValueService) private readonly customFieldValues: ContactCustomFieldValueService,
  ) {}

  /**
   * Internal helper: write a per-contact audit entry. Always
   * fire-and-forget — never block a mutation on its audit row.
   */
  private auditContact(opts: {
    businessId: string;
    contactId: string;
    action: Parameters<ContactAuditService['write']>[0]['action'];
    before?: unknown;
    after?: unknown;
    entityType?: Parameters<ContactAuditService['write']>[0]['entityType'];
    entityId?: string | null;
    ctx?: AuditContext | null;
    extraReason?: string | null;
  }): void {
    void this.contactAudit.write({
      businessId: opts.businessId,
      contactId: opts.contactId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      before: opts.before,
      after: opts.after,
      actor: opts.ctx?.actor ?? { type: 'SYSTEM' },
      ip: opts.ctx?.ip ?? null,
      userAgent: opts.ctx?.userAgent ?? null,
      reason: opts.extraReason ?? opts.ctx?.reason ?? null,
    });
  }

  async healthPing(): Promise<void> {
    await this.prisma.client.$queryRaw`SELECT 1`;
  }

  private normalizeTags(tags?: string[] | null) {
    if (!tags) return [];
    return tags.map((tag) => tag.trim()).filter(Boolean);
  }

  private formatContactName(contact: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    if (contact.displayName && contact.displayName.trim()) return contact.displayName.trim();
    const full = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (full) return full;
    if (contact.email) return contact.email;
    if (contact.phone) return contact.phone;
    return 'Unnamed';
  }

  private parseDateOrNull(input?: string | null) {
    if (!input) return null;
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async assertContact(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  async listContacts(input: ContactListOptions) {
    let access: CrmAccess | null = null;
    if (input.actorUserId) {
      access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
    }

    const ownerFilter = input.ownedByActor && input.actorUserId
      ? input.actorUserId
      : input.ownerId;

    let revenueContactIds: string[] | undefined;
    if (input.minRevenue && input.minRevenue > 0) {
      const highRevContacts = await this.prisma.client.$queryRaw<Array<{ contact_id: string }>>`
        SELECT i.contact_id
        FROM invoices i
        WHERE i.business_id = ${input.businessId}
          AND i.status = 'PAID'
          AND i.deleted_at IS NULL
        GROUP BY i.contact_id
        HAVING SUM(i.total) >= ${input.minRevenue}
      `;
      revenueContactIds = highRevContacts.map((r) => r.contact_id);
      if (revenueContactIds.length === 0) {
        return { contacts: [], total: 0, page: input.skip ? Math.floor(input.skip / (input.take ?? DEFAULT_PAGE_SIZE)) + 1 : 1, pageSize: input.take ?? DEFAULT_PAGE_SIZE, totalPages: 0 };
      }
    }

    let searchContactIds: string[] | undefined;
    if (input.search?.trim()) {
      const tsIds = await this.searchContactIdsByTsvector(input.businessId, input.search.trim());
      if (tsIds.length > 0) {
        searchContactIds = tsIds;
      }
    }

    const where: any = buildContactWhere(input.businessId, {
      status: input.status,
      search: searchContactIds ? undefined : input.search,
      hasUnpaidInvoices: input.hasUnpaidInvoices,
      hasUpcomingBookings: input.hasUpcomingBookings,
      hasOpenDeals: input.hasOpenDeals,
      dealStageIds: input.dealStageIds,
      staleDays: input.staleDays,
      newThisWeek: input.newThisWeek,
      tags: input.tags,
      ownerId: ownerFilter,
      lifecycleStage: input.lifecycleStage,
      companyName: input.companyName,
      industry: input.industry,
      city: input.city,
      country: input.country,
      segment: input.segment,
      doNotContact: input.doNotContact,
      ageGroups: input.ageGroups,
      relationshipTypes: input.relationshipTypes,
      priorities: input.priorities,
      relationshipHealth: input.relationshipHealth,
      pipelineStages: input.pipelineStages,
      favorite: input.favorite,
      includeArchived: input.includeArchived,
    });

    if (searchContactIds) {
      where.id = { in: searchContactIds };
    }

    if (revenueContactIds) {
      where.id = { in: revenueContactIds };
    }
    if (input.bestChannels && input.bestChannels.length > 0) {
      where.bestChannel = { in: input.bestChannels };
    }
    if (input.bestTimeNow && Array.isArray(input.bestTimeNowIds)) {
      if (input.bestTimeNowIds.length === 0) {
        where.id = { in: ['__none__'] };
      } else {
        where.id = { in: input.bestTimeNowIds };
      }
    }

    if (access && input.actorUserId) {
      const visClause = visibilityClause(access, input.actorUserId);
      if (visClause) {
        where.AND = [...(where.AND ?? []), visClause];
      }
    }

    const take = Math.min(input.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const sortBy = input.sortBy;
    const needsPostSort = sortBy === 'revenue';

    let orderBy: any;
    if (!sortBy || needsPostSort) {
      orderBy = { createdAt: 'desc' };
    } else if (sortBy === 'score') {
      orderBy = { leadScore: input.sortOrder ?? 'desc' };
    } else if (sortBy === 'name') {
      const dir = input.sortOrder ?? 'asc';
      orderBy = [{ firstName: dir }, { lastName: dir }];
    } else if (sortBy === 'newest') {
      orderBy = { createdAt: input.sortOrder ?? 'desc' };
    } else if (sortBy === 'oldest') {
      orderBy = { createdAt: input.sortOrder ?? 'asc' };
    } else if (sortBy === 'lastInteraction') {
      orderBy = { updatedAt: input.sortOrder ?? 'desc' };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    if (needsPostSort) {
      const skip = input.skip ?? 0;
      const allContacts = await this.prisma.client.contact.findMany({
        where,
        orderBy,
        take: 500,
      });
      if (allContacts.length === 0) return { contacts: [], nextCursor: null, hasMore: false };
      const withStats = await this.stats.attachContactStats(input.businessId, allContacts);
      const dir = input.sortOrder ?? 'desc';
      withStats.sort((a, b) => {
        const aVal = a.meta?.totalRevenue ?? 0;
        const bVal = b.meta?.totalRevenue ?? 0;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      });
      const sliced = withStats.slice(skip, skip + take);
      return { contacts: sliced, nextCursor: null, hasMore: skip + take < withStats.length };
    }

    if (input.cursor) {
      const cursorContact = await this.prisma.client.contact.findUnique({
        where: { id: input.cursor },
        select: { createdAt: true, updatedAt: true, id: true },
      });
      if (cursorContact) {
        const isDescending = !sortBy || sortBy === 'newest' || sortBy === 'lastInteraction';
        const cursorOp = isDescending ? 'lt' : 'gt';
        const cursorField = sortBy === 'lastInteraction' ? 'updatedAt' : 'createdAt';
        const cursorValue = cursorField === 'updatedAt' ? cursorContact.updatedAt : cursorContact.createdAt;
        const cursorWhere = {
          OR: [
            { [cursorField]: { [cursorOp]: cursorValue } },
            { [cursorField]: cursorValue, id: { [cursorOp]: cursorContact.id } },
          ],
        };
        where.AND = [...(where.AND ?? []), cursorWhere];
      }
    }

    const skip = input.cursor ? 0 : (input.skip ?? 0);

    const contacts = await this.prisma.client.contact.findMany({
      where,
      orderBy,
      skip,
      take: take + 1,
    });

    const hasMore = contacts.length > take;
    const sliced = hasMore ? contacts.slice(0, take) : contacts;
    const nextCursor = hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null;

    if (!input.includeStats || sliced.length === 0) {
      return { contacts: sliced, nextCursor, hasMore };
    }
    const withStats = await this.stats.attachContactStats(input.businessId, sliced);
    return { contacts: withStats, nextCursor, hasMore };
  }

  private async searchContactIdsByTsvector(businessId: string, searchValue: string): Promise<string[]> {
    try {
      const rows = await this.prisma.client.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM contacts
        WHERE business_id = ${businessId}
          AND deleted_at IS NULL
          AND search_vector @@ plainto_tsquery('english', ${searchValue})
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${searchValue})) DESC
        LIMIT 1000
      `;
      return rows.map((r) => r.id);
    } catch (err) {
      this.logger.warn(`TSVector search failed: ${(err as Error).message}`);
      return [];
    }
  }

  async createContact(input: {
    businessId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: string;
    source?: string | null;
    sourceDetail?: string | null;
    tags?: string[];
    custom?: any;
    customFieldValues?: Record<string, unknown>;
  } & ContactExtraAttributes, _audit?: AuditContext) {
    const start = Date.now();
    const normalizeString = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const firstName = sanitize(normalizeString(input.firstName));
    const lastName = sanitize(normalizeString(input.lastName));
    const email = normalizeString(input.email);
    const phone = normalizeString(input.phone);
    const emailNormalized = normalizeEmail(email);
    const phoneNormalized = normalizePhone(phone);
    const tags = this.normalizeTags(input.tags);

    const contact = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          businessId: input.businessId,
          firstName,
          lastName,
          email,
          emailNormalized,
          phone,
          phoneNormalized,
          status: input.status ?? 'LEAD',
          source: input.source ?? 'manual',
          tags,
          custom: input.custom ?? {},
          sourceDetail: normalizeString(input.sourceDetail),
          displayName: normalizeString(input.displayName),
          secondaryEmail: normalizeString(input.secondaryEmail),
          secondaryPhone: normalizeString(input.secondaryPhone),
          whatsappNumber: normalizeString(input.whatsappNumber),
          preferredChannel: normalizeString(input.preferredChannel),
          addressLine1: normalizeString(input.addressLine1),
          addressLine2: normalizeString(input.addressLine2),
          city: normalizeString(input.city),
          state: normalizeString(input.state),
          postalCode: normalizeString(input.postalCode),
          country: normalizeString(input.country),
          timezone: normalizeString(input.timezone),
          companyName: sanitize(normalizeString(input.companyName)),
          jobTitle: normalizeString(input.jobTitle),
          department: normalizeString(input.department),
          industry: normalizeString(input.industry),
          ownerId: input.ownerId ?? null,
          lifecycleStage: normalizeString(input.lifecycleStage),
          segment: normalizeString(input.segment),
          language: normalizeString(input.language),
          marketingOptIn: input.marketingOptIn ?? null,
          doNotContact: input.doNotContact ?? null,
          notesInternal: sanitize(input.notesInternal ?? null),
          ageGroup: normalizeString(input.ageGroup),
          relationshipType: normalizeString(input.relationshipType),
          pipelineStage: normalizeString(input.pipelineStage),
          relationshipHealth: normalizeString(input.relationshipHealth),
          nextActionAt: this.parseDateOrNull(input.nextActionAt),
          nextActionType: normalizeString(input.nextActionType),
          priority: normalizeString(input.priority),
          favorite: input.favorite ?? false,
          archivedAt: this.parseDateOrNull(input.archivedAt),
        },
      });

      await this.timeline.logEvent(input.businessId, created.id, 'contact.created', {
        firstName,
        lastName,
        email,
        source: input.source ?? 'manual',
      }, undefined, tx);

      return created;
    });
    if (contact) {
      const payload: ContactCreatedPayload = {
        contact,
        businessId: input.businessId,
      };
      this.events.emit('contact.created', payload);
      this.auditContact({
        businessId: input.businessId,
        contactId: contact.id,
        action: 'created',
        after: contact,
        ctx: _audit,
      });
    }
    if (contact && input.customFieldValues && Object.keys(input.customFieldValues).length > 0) {
      await this.customFieldValues.setValuesForContact(contact.id, input.customFieldValues).catch((err) => {
        this.logger.warn(`[CRM] Failed to save custom field values for contact ${contact.id}: ${(err as Error).message}`);
      });
    }
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    const duration = Date.now() - start;
    this.logger.log(`[CRM] createContact businessId=${input.businessId} duration=${duration}ms`);
    if (duration > 1000) this.logger.warn(`[CRM] createContact slow businessId=${input.businessId} duration=${duration}ms`);
    return contact;
  }

  async findOrCreateContact(
    businessId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      companyName?: string | null;
      source?: string | null;
      sourceDetail?: string | null;
      tags?: string[];
      status?: string;
      custom?: any;
    } & Partial<ContactExtraAttributes>,
  ) {
    const normalizeString = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const email = normalizeString(input.email);
    const phone = normalizeString(input.phone);
    const emailNormalized = normalizeEmail(email);
    const phoneNormalized = normalizePhone(phone);
    const tags = this.normalizeTags(input.tags);

    const matched = await this.entityResolution.findContactIdByMatch(businessId, {
      source: input.source ?? null,
      email,
      phone,
    });

    return this.prisma.client.$transaction(async (tx) => {
      if (matched) {
        const existing = await tx.contact.findFirst({
          where: { ...contactWhereWithId(businessId, matched.contactId) },
        });
        if (existing) {
          return this.mergeContactDetails(existing, businessId, {
            firstName: input.firstName,
            lastName: input.lastName,
            email,
            phone,
            companyName: input.companyName,
            source: input.source,
            sourceDetail: input.sourceDetail,
            tags,
          });
        }
      }

      if (!email && !phoneNormalized && input.firstName && input.lastName && input.sourceDetail) {
        const recentMatch = await tx.contact.findFirst({
          where: {
            ...contactWhereBase(businessId),
            firstName: input.firstName,
            lastName: input.lastName,
            source: input.source ?? 'manual',
            sourceDetail: input.sourceDetail,
            createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (recentMatch) {
          return recentMatch;
        }
      }

      const { firstName: _fn, lastName: _ln, email: _em, phone: _ph, tags: _t, ...extraFields } = input;
      return this.createContact({
        businessId,
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone,
        companyName: input.companyName ?? undefined,
        source: input.source ?? undefined,
        sourceDetail: input.sourceDetail ?? undefined,
        tags,
        ...extraFields,
      });
    }, { isolationLevel: 'Serializable' });
  }

  private async mergeContactDetails(
    existing: Contact,
    _businessId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      companyName?: string | null;
      source?: string | null;
      sourceDetail?: string | null;
      tags?: string[];
    },
  ) {
    const data: Record<string, any> = {};
    if (input.firstName && !existing.firstName) data.firstName = sanitize(input.firstName);
    if (input.lastName && !existing.lastName) data.lastName = sanitize(input.lastName);
    if (input.email && !existing.email) {
      data.email = input.email;
      data.emailNormalized = normalizeEmail(input.email);
    }
    if (input.phone && !existing.phone) {
      data.phone = input.phone;
      data.phoneNormalized = normalizePhone(input.phone);
    }
    if (input.companyName && !existing.companyName) data.companyName = sanitize(input.companyName);
    if (input.source && !existing.source) data.source = input.source;
    if (input.sourceDetail && !existing.sourceDetail) data.sourceDetail = input.sourceDetail;
    if (input.tags && input.tags.length > 0) {
      const merged = new Set([...(existing.tags ?? []), ...input.tags]);
      data.tags = Array.from(merged);
    }
    if (Object.keys(data).length === 0) {
      return existing;
    }
    return this.prisma.client.contact.update({
      where: { id: existing.id },
      data,
    });
  }

  async updateContact(input: {
    businessId: string;
    contactId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: string;
    source?: string | null;
    sourceDetail?: string | null;
    tags?: string[];
    custom?: any;
    customFieldValues?: Record<string, unknown>;
    actorUserId?: string;
  } & ContactExtraAttributes, _audit?: AuditContext) {
    const start = Date.now();
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin) {
        if (access.editScope === 'none') {
          throw new ForbiddenException('You do not have permission to edit contacts');
        }
        if (access.editScope === 'owned') {
          const owned = await this.prisma.client.contact.findFirst({
            where: {
              ...contactWhereWithId(input.businessId, input.contactId),
              OR: [
                { ownerId: input.actorUserId },
                { shares: { some: { userId: input.actorUserId } } },
              ],
            },
            select: { id: true },
          });
          if (!owned) {
            throw new ForbiddenException('You can only edit contacts you own');
          }
        }
      }
    }
    const trimOptional = (value?: string | null) => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const email = trimOptional(input.email);
    const phone = trimOptional(input.phone);
    const emailNormalized = email !== undefined ? normalizeEmail(email) : undefined;
    const phoneNormalized = phone !== undefined ? normalizePhone(phone) : undefined;
    const tags = input.tags !== undefined ? this.normalizeTags(input.tags) : undefined;

    const sanitizeOptional = (value?: string | null) => {
      if (value === undefined) return undefined;
      return sanitize(value);
    };

    // When `relationshipHealth` is explicitly set via the API, we treat that as
    // a manual override so the daily auto-warn scheduler will preserve it. The
    // override metadata is stamped onto `Contact.custom`.
    let mergedCustom: any = input.custom ?? undefined;
    if (input.relationshipHealth !== undefined && input.relationshipHealth !== null) {
      const baseCustom =
        (input.custom as Record<string, unknown>) ??
        ((await this.prisma.client.contact.findFirst({
          where: contactWhereWithId(input.businessId, input.contactId),
          select: { custom: true },
        }))?.custom as Record<string, unknown>) ??
        {};
      mergedCustom = {
        ...baseCustom,
        relationshipHealthOverride: {
          manual: true,
          value: input.relationshipHealth,
          at: new Date().toISOString(),
        },
      };
    }

    const data: Prisma.ContactUpdateInput = {
      firstName: sanitizeOptional(trimOptional(input.firstName)),
      lastName: sanitizeOptional(trimOptional(input.lastName)),
      email,
      emailNormalized,
      phone,
      phoneNormalized,
      status: input.status ?? undefined,
      source: input.source ?? undefined,
      tags,
      custom: mergedCustom,
      sourceDetail: trimOptional(input.sourceDetail),
      displayName: trimOptional(input.displayName),
      secondaryEmail: trimOptional(input.secondaryEmail),
      secondaryPhone: trimOptional(input.secondaryPhone),
      whatsappNumber: trimOptional(input.whatsappNumber),
      preferredChannel: trimOptional(input.preferredChannel),
      addressLine1: trimOptional(input.addressLine1),
      addressLine2: trimOptional(input.addressLine2),
      city: trimOptional(input.city),
      state: trimOptional(input.state),
      postalCode: trimOptional(input.postalCode),
      country: trimOptional(input.country),
      timezone: trimOptional(input.timezone),
      companyName: sanitizeOptional(trimOptional(input.companyName)),
      jobTitle: trimOptional(input.jobTitle),
      department: trimOptional(input.department),
      industry: trimOptional(input.industry),
      ownerId: input.ownerId ?? undefined,
      lifecycleStage: trimOptional(input.lifecycleStage),
      segment: trimOptional(input.segment),
      language: trimOptional(input.language),
      marketingOptIn: input.marketingOptIn ?? undefined,
      doNotContact: input.doNotContact ?? undefined,
      notesInternal: input.notesInternal !== undefined ? sanitize(input.notesInternal ?? null) ?? undefined : undefined,
      ageGroup: trimOptional(input.ageGroup),
      relationshipType: trimOptional(input.relationshipType),
      pipelineStage: trimOptional(input.pipelineStage),
      relationshipHealth: trimOptional(input.relationshipHealth),
      nextActionAt: input.nextActionAt !== undefined ? this.parseDateOrNull(input.nextActionAt) : undefined,
      nextActionType: trimOptional(input.nextActionType),
      priority: trimOptional(input.priority),
      favorite: input.favorite ?? undefined,
      archivedAt: input.archivedAt !== undefined ? this.parseDateOrNull(input.archivedAt) : undefined,
    };

    const { existing, updated } = await this.prisma.client.$transaction(async (tx) => {
      const existingContact = await tx.contact.findFirst({
        where: contactWhereWithId(input.businessId, input.contactId),
      });
      if (!existingContact) {
        throw new NotFoundException('Contact not found');
      }

      const updatedContact = await tx.contact.update({
        where: { id: input.contactId },
        data,
      });

      const updatedFields = Object.keys(data).filter(
        (key) => data[key as keyof Prisma.ContactUpdateInput] !== undefined,
      );
      if (updatedFields.length > 0) {
        await this.timeline.logEvent(
          input.businessId,
          input.contactId,
          'contact.updated',
          { updatedFields },
          { actorType: 'USER', source: 'crm' },
          tx,
        );
      }

      if (input.status && existingContact.status !== input.status) {
        await this.timeline.logEvent(
          input.businessId,
          input.contactId,
          'status.changed',
          { from: existingContact.status, to: input.status },
          { actorType: 'USER', source: 'crm' },
          tx,
        );
      }

      return { existing: existingContact, updated: updatedContact };
    });

    const payload: ContactUpdatedPayload = {
      contact: updated,
      businessId: input.businessId,
      fromStatus: existing?.status,
      toStatus: updated.status,
    };
    this.events.emit('contact.updated', payload);

    // Detect ownership changes -> "reassigned" action; everything
    // else is recorded as a generic "updated" entry with diff.
    const reassigned = existing?.ownerId !== updated.ownerId;
    this.auditContact({
      businessId: input.businessId,
      contactId: updated.id,
      action: reassigned ? 'reassigned' : 'updated',
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      ctx: _audit,
      extraReason: reassigned
        ? `owner ${existing?.ownerId ?? 'none'} → ${updated.ownerId ?? 'none'}`
        : undefined,
    });

    if (input.customFieldValues && Object.keys(input.customFieldValues).length > 0) {
      await this.customFieldValues.setValuesForContact(input.contactId, input.customFieldValues).catch((err) => {
        this.logger.warn(`[CRM] Failed to save custom field values for contact ${input.contactId}: ${(err as Error).message}`);
      });
    }
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    const duration = Date.now() - start;
    this.logger.log(`[CRM] updateContact businessId=${input.businessId} contactId=${input.contactId} duration=${duration}ms`);
    if (duration > 1000) this.logger.warn(`[CRM] updateContact slow businessId=${input.businessId} duration=${duration}ms`);
    return updated;
  }

  async softDeleteContact(input: { businessId: string; contactId: string; actorUserId?: string }, _audit?: AuditContext) {
    const contact = await this.assertContact(input.businessId, input.contactId);
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin) {
        if (access.deleteScope === 'none') {
          throw new ForbiddenException('You do not have permission to delete contacts');
        }
        if (access.deleteScope === 'owned' && contact.ownerId !== input.actorUserId) {
          throw new ForbiddenException('You can only delete contacts you own');
        }
        if (!access.viewAll && contact.ownerId !== input.actorUserId) {
          // Defensive: cannot delete a contact you can't even see.
          throw new NotFoundException('Contact not found');
        }
      }
    }
    await this.timeline.logEvent(
      input.businessId,
      input.contactId,
      'contact.deleted',
      { name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() },
      { actorType: 'USER', source: 'crm' },
    );
    const deleted = await this.prisma.client.contact.update({ where: { id: input.contactId }, data: { deletedAt: new Date() } });
    this.auditContact({
      businessId: input.businessId,
      contactId: input.contactId,
      action: 'deleted',
      before: { deletedAt: contact.deletedAt },
      after: { deletedAt: deleted.deletedAt },
      ctx: _audit,
    });
    const deletedPayload: ContactDeletedPayload = {
      contact: deleted,
      businessId: input.businessId,
    };
    this.events.emit('contact.deleted', deletedPayload);
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return deleted;
  }

  async bulkUpdateContacts(input: {
    businessId: string;
    contactIds: string[];
    status?: string;
    addTags?: string[];
    relationshipType?: string | null;
    priority?: string | null;
    favorite?: boolean;
    archived?: boolean;
    actorUserId?: string;
  }, _audit?: AuditContext) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }
    let allowedIds = input.contactIds;
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin) {
        if (access.editScope === 'none') {
          throw new ForbiddenException('You do not have permission to edit contacts');
        }
        const ownershipWhere: any = { ...contactWhereBase(input.businessId), id: { in: input.contactIds } };
        if (access.editScope === 'owned') {
          ownershipWhere.OR = [
            { ownerId: input.actorUserId },
            { shares: { some: { userId: input.actorUserId } } },
          ];
        }
        const editable = await this.prisma.client.contact.findMany({
          where: ownershipWhere,
          select: { id: true },
        });
        allowedIds = editable.map((c) => c.id);
        if (allowedIds.length === 0) {
          throw new ForbiddenException('You cannot edit any of the selected contacts');
        }
      }
    }
    input = { ...input, contactIds: allowedIds };
    const auditAfter = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.addTags ? { addedTags: input.addTags } : {}),
      ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
      ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
    };
    for (const cid of allowedIds) {
      this.auditContact({
        businessId: input.businessId,
        contactId: cid,
        action: 'bulk_updated',
        after: auditAfter,
        ctx: _audit,
      });
    }
    const data: Record<string, unknown> = {};
    if (input.status) data.status = input.status;
    if (input.relationshipType !== undefined) {
      data.relationshipType = input.relationshipType ?? null;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority ?? null;
    }
    if (typeof input.favorite === 'boolean') {
      data.favorite = input.favorite;
    }
    if (typeof input.archived === 'boolean') {
      data.archivedAt = input.archived ? new Date() : null;
    }
    if (input.addTags && input.addTags.length > 0) {
      const contacts = await this.prisma.client.contact.findMany({
        where: { id: { in: input.contactIds }, ...contactWhereBase(input.businessId) },
        select: { id: true, tags: true },
      });
      const results = await this.prisma.client.$transaction(async (tx) => {
        const updated = [];
        for (const c of contacts) {
          const merged = Array.from(new Set([...(c.tags ?? []), ...(input.addTags ?? [])]));
          const u = await tx.contact.update({ where: { id: c.id }, data: { ...data, tags: merged } });
          updated.push(u);
          await this.timeline.logEvent(input.businessId, c.id, 'bulk.updated', {
            ...(input.status ? { status: input.status } : {}),
            ...(input.addTags ? { addedTags: input.addTags } : {}),
            ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
            ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
          }, undefined, tx);
        }
        return updated;
      });
      this.stats.invalidateCache(input.businessId);
      this.flow.invalidateCache(input.businessId);
      return { updated: results.length };
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No update fields provided');
    }
    const result = await this.prisma.client.$transaction(async (tx) => {
      const res = await tx.contact.updateMany({
        where: { id: { in: input.contactIds }, ...contactWhereBase(input.businessId) },
        data,
      });
      for (const cid of input.contactIds) {
        await this.timeline.logEvent(input.businessId, cid, 'bulk.updated', {
          ...(input.status ? { status: input.status } : {}),
          ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
          ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
        }, undefined, tx);
      }
      return res;
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { updated: result.count };
  }

  async bulkDeleteContacts(input: { businessId: string; contactIds: string[]; actorUserId?: string }, _audit?: AuditContext) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin) {
        if (access.deleteScope === 'none') {
          throw new ForbiddenException('You do not have permission to delete contacts');
        }
        if (access.deleteScope === 'owned') {
          const owned = await this.prisma.client.contact.findMany({
            where: {
              ...contactWhereBase(input.businessId),
              id: { in: input.contactIds },
              ownerId: input.actorUserId,
            },
            select: { id: true },
          });
          input = { ...input, contactIds: owned.map((c) => c.id) };
          if (input.contactIds.length === 0) {
            throw new ForbiddenException('You can only delete contacts you own');
          }
        }
      }
    }
    const eventOps = input.contactIds.map((cid) =>
      this.timeline.logEvent(input.businessId, cid, 'contact.deleted', { bulk: true }),
    );
    await Promise.allSettled(eventOps);
    for (const cid of input.contactIds) {
      this.auditContact({
        businessId: input.businessId,
        contactId: cid,
        action: 'bulk_deleted',
        ctx: _audit,
      });
    }
    const result = await this.prisma.client.contact.updateMany({
      where: { id: { in: input.contactIds }, ...contactWhereBase(input.businessId) },
      data: { deletedAt: new Date() },
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { deleted: result.count };
  }

  /**
   * Reassign ownership of one or more contacts. Verifies that
   *   - the actor has crm_reassign permission (or is OWNER/SUPER_ADMIN);
   *   - the new owner is a member of the same business; and
   *   - every target contact lives in the business and is currently
   *     visible to the actor under their effective scope.
   * Logs a `contact.reassigned` timeline event per contact for full audit.
   */
  async reassignContacts(input: {
    businessId: string;
    contactIds: string[];
    newOwnerId: string;
    actorUserId?: string;
  }) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }

    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      if (!access.isOwner && !access.isSuperAdmin && !access.reassign) {
        throw new ForbiddenException('You do not have permission to reassign contacts');
      }
    }

    const newOwnerMembership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: input.newOwnerId, businessId: input.businessId } },
    });
    if (!newOwnerMembership) {
      throw new BadRequestException('newOwnerId must belong to a member of this business');
    }

    const eligibleWhere: any = {
      ...contactWhereBase(input.businessId),
      id: { in: input.contactIds },
    };
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      const visClause = visibilityClause(access, input.actorUserId);
      if (visClause) {
        eligibleWhere.AND = [visClause];
      }
    }

    const eligible = await this.prisma.client.contact.findMany({
      where: eligibleWhere,
      select: { id: true, ownerId: true },
    });
    if (eligible.length === 0) {
      throw new ForbiddenException('No eligible contacts to reassign');
    }

    const eligibleIds = eligible.map((c) => c.id);
    const result = await this.prisma.client.contact.updateMany({
      where: { id: { in: eligibleIds }, ...contactWhereBase(input.businessId) },
      data: { ownerId: input.newOwnerId },
    });

    await Promise.allSettled(
      eligible.map((c) =>
        this.timeline.logEvent(input.businessId, c.id, 'contact.reassigned', {
          fromOwnerId: c.ownerId ?? null,
          toOwnerId: input.newOwnerId,
          actorUserId: input.actorUserId ?? null,
        }),
      ),
    );

    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);

    return { reassigned: result.count, newOwnerId: input.newOwnerId };
  }

  async mergeContacts(input: { businessId: string; primaryId: string; duplicateId: string; fieldOverrides?: Record<string, unknown>; actorId?: string; actorType?: string }, _audit?: AuditContext) {
    if (input.primaryId === input.duplicateId) {
      throw new BadRequestException('Cannot merge a contact into itself');
    }

    const primary = await this.assertContact(input.businessId, input.primaryId);
    const duplicate = await this.assertContact(input.businessId, input.duplicateId);

    const mergedTags = Array.from(new Set([...(primary.tags ?? []), ...(duplicate.tags ?? [])]));
    const mergedLeadScore = Math.max(primary.leadScore ?? 0, duplicate.leadScore ?? 0);

    const fillableFields: Array<keyof typeof primary> = [
      'firstName', 'lastName', 'email', 'emailNormalized', 'phone', 'phoneNormalized',
      'displayName', 'secondaryEmail', 'secondaryPhone', 'whatsappNumber',
      'preferredChannel', 'addressLine1', 'addressLine2', 'city', 'state',
      'postalCode', 'country', 'timezone', 'companyName', 'jobTitle',
      'department', 'industry', 'sourceDetail', 'segment', 'language', 'notesInternal',
    ];

    const contactUpdate: Record<string, unknown> = {
      tags: mergedTags,
      leadScore: mergedLeadScore,
    };
    const resolvedChoices: Record<string, { from: 'primary' | 'duplicate' | 'override'; value: unknown }> = {};

    for (const field of fillableFields) {
      const primaryVal = primary[field];
      const duplicateVal = duplicate[field];
      if ((primaryVal === null || primaryVal === undefined || primaryVal === '') && duplicateVal) {
        contactUpdate[field] = duplicateVal;
        resolvedChoices[String(field)] = { from: 'duplicate', value: duplicateVal };
      } else if (primaryVal !== null && primaryVal !== undefined && primaryVal !== '') {
        resolvedChoices[String(field)] = { from: 'primary', value: primaryVal };
      }
    }

    if (primary.email && !primary.emailNormalized && duplicate.emailNormalized) {
      contactUpdate.emailNormalized = duplicate.emailNormalized;
    }
    if (primary.phone && !primary.phoneNormalized && duplicate.phoneNormalized) {
      contactUpdate.phoneNormalized = duplicate.phoneNormalized;
    }

    const primaryCustom = (typeof primary.custom === 'object' && primary.custom) ? primary.custom as Record<string, unknown> : {};
    const duplicateCustom = (typeof duplicate.custom === 'object' && duplicate.custom) ? duplicate.custom as Record<string, unknown> : {};
    // Default behaviour: union with primary winning on key collisions.
    const mergedCustom: Record<string, unknown> = { ...duplicateCustom, ...primaryCustom };

    if (input.fieldOverrides) {
      const fillableSet = new Set<string>(fillableFields as readonly string[]);
      for (const [key, value] of Object.entries(input.fieldOverrides)) {
        if (key === 'custom' && value && typeof value === 'object') {
          // Full replace of merged custom map (UI sends the resolved map).
          for (const k of Object.keys(mergedCustom)) delete mergedCustom[k];
          Object.assign(mergedCustom, value as Record<string, unknown>);
          resolvedChoices['custom'] = { from: 'override', value };
          continue;
        }
        if (key.startsWith('custom.')) {
          // Per-key override: e.g. "custom.preferredColor" → resolve a single key.
          const customKey = key.slice('custom.'.length);
          if (customKey) {
            mergedCustom[customKey] = value;
            resolvedChoices[`custom.${customKey}`] = { from: 'override', value };
          }
          continue;
        }
        if (fillableSet.has(key) || key === 'tags' || key === 'status') {
          contactUpdate[key] = value;
          resolvedChoices[key] = { from: 'override', value };
        }
      }
    }
    contactUpdate.custom = mergedCustom;

    // Deterministic repointing: capture explicit row IDs first, then update by IN list.
    // Storing IDs (not just counts) allows revertMerge to restore precisely the rows
    // that were moved, avoiding any time-based heuristics.
    const repointedRows: Record<string, { ids: string[]; count: number }> = {};
    const repointByIds = async <T extends { id: string }>(
      label: string,
      findFn: () => Promise<T[]>,
      updateFn: (ids: string[]) => Promise<{ count: number }>,
    ) => {
      const rows = await findFn();
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        const r = await updateFn(ids);
        repointedRows[label] = { ids, count: r.count ?? ids.length };
      } else {
        repointedRows[label] = { ids: [], count: 0 };
      }
    };

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await this.prisma.client.$transaction(async (tx) => {
      // 1. Repoint relations that are not unique-per-contact. Errors propagate -> rollback.
      await repointByIds('events',
        () => tx.contactEvent.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactEvent.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('notes',
        () => tx.contactNote.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactNote.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('tasks',
        () => tx.contactTask.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactTask.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('enrollments',
        () => tx.crmSequenceEnrollment.findMany({ where: { contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.crmSequenceEnrollment.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('quotes',
        () => tx.quote.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.quote.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('invoices',
        () => tx.invoice.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.invoice.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('bookings',
        () => tx.booking.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.booking.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('media',
        () => tx.contactMedia.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactMedia.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('playbooks',
        () => tx.contactPlaybook.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactPlaybook.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('recurringInvoices',
        () => tx.recurringInvoice.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.recurringInvoice.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('externalMappings',
        () => tx.contactExternalMapping.findMany({ where: { contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactExternalMapping.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('momentumRecommendations',
        () => tx.momentumRecommendation.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.momentumRecommendation.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('whatsappContacts',
        () => tx.whatsAppContact.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.whatsAppContact.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('importRecords',
        () => tx.contactImportContact.findMany({ where: { contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.contactImportContact.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));
      await repointByIds('journeyTouchpoints',
        () => tx.journeyTouchpoint.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId }, select: { id: true } }),
        (ids) => tx.journeyTouchpoint.updateMany({ where: { id: { in: ids } }, data: { contactId: input.primaryId } }));

      // Custom field values: unique on (contactId, definitionId). Repoint only when
      // primary doesn't already have a value for that definition.
      const dupCustomValues = await tx.contactCustomFieldValue.findMany({
        where: { contactId: input.duplicateId },
      });
      const primaryCustomValues = await tx.contactCustomFieldValue.findMany({
        where: { contactId: input.primaryId },
      });
      const primaryDefinitionIds = new Set(primaryCustomValues.map((v) => v.definitionId));
      const repointableCustomValues = dupCustomValues.filter((v) => !primaryDefinitionIds.has(v.definitionId));
      for (const v of repointableCustomValues) {
        await tx.contactCustomFieldValue.update({
          where: { id: v.id },
          data: { contactId: input.primaryId },
        });
      }
      await tx.contactCustomFieldValue.deleteMany({
        where: { contactId: input.duplicateId },
      });
      repointedRows['customFieldValues'] = {
        ids: repointableCustomValues.map((v) => v.id),
        count: repointableCustomValues.length,
      };

      // 2. Capture full snapshots of unique-per-contact rows owned by the duplicate so
      //    they can be re-created on revert. They are deleted (not repointed) here to
      //    respect the (businessId, contactId) unique constraint on the primary side.
      const momentumDup = await tx.contactMomentum.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      if (momentumDup.length) await tx.contactMomentum.deleteMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      const momentumSnapDup = await tx.contactMomentumSnapshot.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      if (momentumSnapDup.length) await tx.contactMomentumSnapshot.deleteMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      const customerJourneyDup = await tx.customerJourney.findMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });
      if (customerJourneyDup.length) await tx.customerJourney.deleteMany({ where: { businessId: input.businessId, contactId: input.duplicateId } });

      repointedRows['contactMomentum_deleted'] = { ids: momentumDup.map((r) => r.id), count: momentumDup.length };
      repointedRows['contactMomentumSnapshot_deleted'] = { ids: momentumSnapDup.map((r) => r.id), count: momentumSnapDup.length };
      repointedRows['customerJourney_deleted'] = { ids: customerJourneyDup.map((r) => r.id), count: customerJourneyDup.length };

      // 3. List membership: unique on (listId, contactId). Capture decision per row so
      //    revert can recreate exactly the original rows.
      // Capture FULL row (not just id+listId) so revertMerge can recreate
      // dropped list memberships verbatim — contactListMember requires
      // contactId, addedAt, etc.
      const dupMembers = await tx.contactListMember.findMany({ where: { contactId: input.duplicateId } });
      const listMembersMoved: string[] = [];
      const listMembersDropped: string[] = [];
      for (const m of dupMembers) {
        const existing = await tx.contactListMember.findFirst({ where: { listId: m.listId, contactId: input.primaryId }, select: { id: true } });
        if (existing) {
          await tx.contactListMember.delete({ where: { id: m.id } });
          listMembersDropped.push(m.id);
        } else {
          await tx.contactListMember.update({ where: { id: m.id }, data: { contactId: input.primaryId } });
          listMembersMoved.push(m.id);
        }
      }
      repointedRows['listMembers'] = { ids: listMembersMoved, count: listMembersMoved.length };
      repointedRows['listMembers_dropped'] = { ids: listMembersDropped, count: listMembersDropped.length };

      // Snapshot deleted unique rows + dropped list memberships into the same JSON
      // payload so revert can restore them verbatim.
      const droppedMemberRows = dupMembers.filter((m) => listMembersDropped.includes(m.id));
      const repointedRowsForStorage: Record<string, unknown> = { ...repointedRows };
      repointedRowsForStorage._deletedSnapshots = {
        contactMomentum: momentumDup,
        contactMomentumSnapshot: momentumSnapDup,
        customerJourney: customerJourneyDup,
        contactListMembers: droppedMemberRows,
      };

      // Persist the merge operation first so we can stamp its id onto both
      // contact rows. Storing `lastMergeId` on both sides (and `mergedIntoId`
      // on the duplicate) makes the undo path deterministic without time
      // heuristics, satisfying the task's "merge_id on both rows" contract.
      const mergeOp = await tx.mergeOperation.create({
        data: {
          businessId: input.businessId,
          primaryId: input.primaryId,
          duplicateId: input.duplicateId,
          duplicateSnapshot: JSON.parse(JSON.stringify(duplicate)) as Prisma.InputJsonValue,
          fieldOverrides: (input.fieldOverrides ?? {}) as Prisma.InputJsonValue,
          resolvedFields: JSON.parse(JSON.stringify(resolvedChoices)) as Prisma.InputJsonValue,
          repointedCounts: repointedRowsForStorage as Prisma.InputJsonValue,
          actorId: input.actorId,
          actorType: input.actorType ?? 'SYSTEM',
          expiresAt,
        },
      });

      const mergedContact = await tx.contact.update({
        where: { id: input.primaryId },
        data: { ...(contactUpdate as Prisma.ContactUpdateInput), lastMergeId: mergeOp.id },
      });
      await tx.contact.update({
        where: { id: input.duplicateId },
        data: { deletedAt: new Date(), lastMergeId: mergeOp.id, mergedIntoId: input.primaryId },
      });

      const repointedCountsForEvent = Object.fromEntries(
        Object.entries(repointedRows).map(([k, v]) => [k, v.count]),
      );
      await this.timeline.logEvent(
        input.businessId,
        input.primaryId,
        CONTACT_EVENT.CONTACT_MERGED,
        {
          mergeId: mergeOp.id,
          primaryId: input.primaryId,
          duplicateId: input.duplicateId,
          mergedFields: Object.keys(contactUpdate),
          resolvedChoices,
          repointedCounts: repointedCountsForEvent,
          revertableUntil: expiresAt.toISOString(),
        },
        { actorType: input.actorType ?? 'SYSTEM', actorId: input.actorId, source: 'crm' },
        tx,
      );
      return { mergedContact, mergeId: mergeOp.id, repointedCounts: repointedCountsForEvent };
    });
    const merged = result.mergedContact;
    if (merged) {
      const payload: ContactMergedPayload = {
        contact: merged,
        businessId: input.businessId,
        duplicateId: input.duplicateId,
      };
      this.events.emit('contact.merged', payload);
      this.auditContact({
        businessId: input.businessId,
        contactId: input.primaryId,
        action: 'merged',
        before: primary as unknown as Record<string, unknown>,
        after: merged as unknown as Record<string, unknown>,
        ctx: _audit,
        extraReason: `merged duplicate ${input.duplicateId} into primary`,
      });
      this.auditContact({
        businessId: input.businessId,
        contactId: input.duplicateId,
        action: 'merged',
        before: duplicate as unknown as Record<string, unknown>,
        after: { mergedInto: input.primaryId },
        ctx: _audit,
        extraReason: `duplicate merged into ${input.primaryId}`,
      });
    }
    this.stats.invalidateCache(input.businessId);
    return { ...merged, mergeId: result.mergeId, revertableUntil: expiresAt.toISOString() };
  }

  async revertMerge(input: { businessId: string; mergeId: string; actorId?: string; actorType?: string }) {
    const op = await this.prisma.client.mergeOperation.findFirst({
      where: { id: input.mergeId, businessId: input.businessId },
    });
    if (!op) throw new NotFoundException('Merge operation not found');
    if (op.revertedAt) throw new BadRequestException('Merge has already been reverted');
    if (op.expiresAt && new Date(op.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Undo window has expired');
    }

    const snapshot = (op.duplicateSnapshot ?? null) as Record<string, unknown> | null;
    if (!snapshot || typeof snapshot.id !== 'string') {
      throw new BadRequestException('Merge snapshot is missing');
    }

    const stored = (op.repointedCounts ?? {}) as Record<string, { ids?: string[]; count?: number } | unknown>;
    const deletedSnapshots = (stored._deletedSnapshots ?? {}) as {
      contactMomentum?: Array<Record<string, unknown>>;
      contactMomentumSnapshot?: Array<Record<string, unknown>>;
      customerJourney?: Array<Record<string, unknown>>;
      contactListMembers?: Array<Record<string, unknown>>;
    };
    const idsFor = (label: string): string[] => {
      const v = stored[label];
      if (v && typeof v === 'object' && Array.isArray((v as { ids?: unknown }).ids)) {
        return ((v as { ids: unknown[] }).ids).filter((x): x is string => typeof x === 'string');
      }
      return [];
    };

    // Best-effort revert: each restoration step runs independently and any
    // recoverable error is captured into a structured conflict report
    // instead of aborting the whole undo. The report is persisted on the
    // MergeOperation row, returned to the caller, and included in the
    // contact.merge_reverted event payload.
    type RevertConflict = { table: string; id?: string; ids?: string[]; reason: string };
    const conflicts: RevertConflict[] = [];
    const restored: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    const reasonOf = (e: unknown): string =>
      e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error';

    const c = this.prisma.client;

    // 1. Restore the duplicate contact (undelete + restore snapshot fields).
    const restoreData: Record<string, unknown> = {};
    const restorableFields = [
      'firstName','lastName','email','emailNormalized','phone','phoneNormalized',
      'displayName','secondaryEmail','secondaryPhone','whatsappNumber','status',
      'preferredChannel','addressLine1','addressLine2','city','state','postalCode',
      'country','timezone','companyName','jobTitle','department','industry',
      'source','sourceDetail','segment','language','marketingOptIn','doNotContact',
      'notesInternal','ageGroup','tags','leadScore','custom',
    ];
    for (const f of restorableFields) {
      if (snapshot[f] !== undefined) restoreData[f] = snapshot[f];
    }
    restoreData.deletedAt = null;
    restoreData.mergedIntoId = null;
    try {
      await c.contact.update({ where: { id: op.duplicateId }, data: restoreData as Prisma.ContactUpdateInput });
      restored.contact = 1;
    } catch (err) {
      // Failing to restore the surviving "duplicate" row is the only true blocker:
      // the rest of the revert depends on this row existing as a contact.
      throw new BadRequestException(`Failed to restore duplicate contact: ${reasonOf(err)}`);
    }

    // 2. Move every previously-repointed row back to the duplicate, table by
    //    table. Each updateMany is its own statement so a row-level conflict
    //    in one table does not abort the others.
    const movePairs: Array<[string, (ids: string[]) => Promise<{ count: number }>]> = [
      ['events', (ids) => c.contactEvent.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['notes', (ids) => c.contactNote.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['tasks', (ids) => c.contactTask.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['enrollments', (ids) => c.crmSequenceEnrollment.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['quotes', (ids) => c.quote.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['invoices', (ids) => c.invoice.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['bookings', (ids) => c.booking.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['media', (ids) => c.contactMedia.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['playbooks', (ids) => c.contactPlaybook.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['recurringInvoices', (ids) => c.recurringInvoice.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['externalMappings', (ids) => c.contactExternalMapping.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['momentumRecommendations', (ids) => c.momentumRecommendation.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['whatsappContacts', (ids) => c.whatsAppContact.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['importRecords', (ids) => c.contactImportContact.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['journeyTouchpoints', (ids) => c.journeyTouchpoint.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
      ['listMembers', (ids) => c.contactListMember.updateMany({ where: { id: { in: ids } }, data: { contactId: op.duplicateId } })],
    ];
    for (const [label, fn] of movePairs) {
      const ids = idsFor(label);
      if (ids.length === 0) continue;
      try {
        const r = await fn(ids);
        restored[label] = r.count;
        if (r.count < ids.length) {
          // Some rows were edited/deleted post-merge.
          skipped[label] = (skipped[label] ?? 0) + (ids.length - r.count);
          conflicts.push({ table: label, ids, reason: `${ids.length - r.count} row(s) missing or already moved` });
        }
      } catch (err) {
        skipped[label] = (skipped[label] ?? 0) + ids.length;
        conflicts.push({ table: label, ids, reason: reasonOf(err) });
      }
    }

    // 3. Restore unique-per-contact rows deleted during merge, one at a time
    //    so a single row conflict (e.g. someone re-created a CustomerJourney
    //    after the merge) doesn't block the rest of the undo.
    const recreate = async <T,>(
      table: string,
      rows: Array<Record<string, unknown>>,
      create: (row: Record<string, unknown>) => Promise<T>,
    ) => {
      for (const row of rows) {
        try {
          await create(row);
          restored[table] = (restored[table] ?? 0) + 1;
        } catch (err) {
          skipped[table] = (skipped[table] ?? 0) + 1;
          conflicts.push({ table, id: typeof row.id === 'string' ? row.id : undefined, reason: reasonOf(err) });
        }
      }
    };
    await recreate('contactMomentum', deletedSnapshots.contactMomentum ?? [],
      (row) => c.contactMomentum.create({ data: row as Prisma.ContactMomentumUncheckedCreateInput }));
    await recreate('contactMomentumSnapshot', deletedSnapshots.contactMomentumSnapshot ?? [],
      (row) => c.contactMomentumSnapshot.create({ data: row as Prisma.ContactMomentumSnapshotUncheckedCreateInput }));
    await recreate('customerJourney', deletedSnapshots.customerJourney ?? [],
      (row) => c.customerJourney.create({ data: row as Prisma.CustomerJourneyUncheckedCreateInput }));
    await recreate('contactListMembers', deletedSnapshots.contactListMembers ?? [],
      (row) => c.contactListMember.create({ data: row as Prisma.ContactListMemberUncheckedCreateInput }));

    const conflictReport = { restored, skipped, conflicts };

    try {
      await c.mergeOperation.update({
        where: { id: op.id },
        data: {
          revertedAt: new Date(),
          revertedActorId: input.actorId,
          // Persist the conflict report inside repointedCounts so it's
          // queryable later without changing the schema.
          repointedCounts: { ...(stored as Record<string, unknown>), _revertReport: conflictReport } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
        this.logger.warn(`Don't fail the user-visible revert because we couldn't persist the: ${err instanceof Error ? err.message : err}`);
      }

    const revertedAt = new Date().toISOString();
    await this.timeline.logEvent(
      input.businessId,
      op.primaryId,
      CONTACT_EVENT.CONTACT_MERGE_REVERTED,
      {
        mergeId: op.id,
        primaryId: op.primaryId,
        duplicateId: op.duplicateId,
        revertedAt,
        restored: conflictReport.restored,
        skipped: conflictReport.skipped,
        conflicts: conflictReport.conflicts,
      },
      { actorType: input.actorType ?? 'SYSTEM', actorId: input.actorId, source: 'crm' },
    );
    this.events.emit('contact.merge_reverted', {
      businessId: input.businessId,
      mergeId: op.id,
      primaryId: op.primaryId,
      duplicateId: op.duplicateId,
      conflicts: conflictReport.conflicts,
    });
    this.stats.invalidateCache(input.businessId);
    return {
      mergeId: op.id,
      primaryId: op.primaryId,
      duplicateId: op.duplicateId,
      revertedAt,
      restored: conflictReport.restored,
      skipped: conflictReport.skipped,
      conflicts: conflictReport.conflicts,
    };
  }

  getContactsPollState(businessId: string) {
    return this.stats.getContactsPollState(businessId);
  }

  getContactStats(businessId: string) {
    return this.stats.getContactStats(businessId);
  }

  contactDetail(params: { businessId: string; contactId: string }) {
    return this.stats.contactDetail(params);
  }

  findDuplicates(businessId: string) {
    return this.stats.findDuplicates(businessId);
  }

  segmentSummary(input: { businessId: string }) {
    return this.stats.segmentSummary(input);
  }

  flowHighlights(input: { businessId: string }) {
    return this.stats.flowHighlights(input);
  }

  toggleFavorite(businessId: string, contactId: string) {
    return this.stats.toggleFavorite(businessId, contactId);
  }

  getFavorites(businessId: string) {
    return this.stats.getFavorites(businessId);
  }

  async addNote(input: { businessId: string; contactId: string; body: string; authorId?: string | null; source?: string }, _audit?: AuditContext) {
    const note = await this.timeline.addNote(input);
    await this.auditContact({ businessId: input.businessId, contactId: input.contactId, action: 'note_added', entityType: 'note', entityId: (note as { id?: string })?.id ?? null, after: { body: input.body, source: input.source }, ctx: _audit });
    return note;
  }

  async addTask(input: {
    businessId: string;
    contactId: string;
    title: string;
    dueDate?: string | null;
    priority?: string | null;
    assigneeId?: string | null;
    remindAt?: string | null;
    creatorId?: string | null;
    source?: string | null;
  }, _audit?: AuditContext) {
    const task = await this.timeline.addTask(input);
    await this.auditContact({ businessId: input.businessId, contactId: input.contactId, action: "task_added", entityType: "task", entityId: (task as { id?: string })?.id ?? null, after: { title: input.title, dueDate: input.dueDate, priority: input.priority, assigneeId: input.assigneeId }, ctx: _audit });
    return task;
  }

  async updateNote(input: { businessId: string; noteId: string; body?: string; source?: string }, _audit?: AuditContext) {
    const before = await this.prisma.client.contactNote.findUnique({ where: { id: input.noteId } });
    const note = await this.timeline.updateNote(input);
    if (before?.contactId) {
      await this.auditContact({ businessId: input.businessId, contactId: before.contactId, action: "note_updated", entityType: "note", entityId: input.noteId, before: { body: before.body, source: before.source }, after: { body: input.body, source: input.source }, ctx: _audit });
    }
    return note;
  }

  async deleteNote(input: { businessId: string; noteId: string }, _audit?: AuditContext) {
    const before = await this.prisma.client.contactNote.findUnique({ where: { id: input.noteId } });
    const result = await this.timeline.deleteNote(input);
    if (before?.contactId) {
      await this.auditContact({ businessId: input.businessId, contactId: before.contactId, action: "note_deleted", entityType: "note", entityId: input.noteId, before: { body: before.body, source: before.source }, ctx: _audit });
    }
    return result;
  }

  async updateTask(input: { businessId: string; taskId: string; title?: string; dueDate?: string; priority?: string; remindAt?: string }, _audit?: AuditContext) {
    const before = await this.prisma.client.contactTask.findUnique({ where: { id: input.taskId } });
    const task = await this.timeline.updateTask(input);
    if (before?.contactId) {
      await this.auditContact({ businessId: input.businessId, contactId: before.contactId, action: "task_updated", entityType: "task", entityId: input.taskId, before: { title: before.title, dueDate: before.dueDate, priority: before.priority }, after: { title: input.title, dueDate: input.dueDate, priority: input.priority }, ctx: _audit });
    }
    return task;
  }

  async deleteTask(input: { businessId: string; taskId: string }, _audit?: AuditContext) {
    const before = await this.prisma.client.contactTask.findUnique({ where: { id: input.taskId } });
    const result = await this.timeline.deleteTask(input);
    if (before?.contactId) {
      await this.auditContact({ businessId: input.businessId, contactId: before.contactId, action: "task_deleted", entityType: "task", entityId: input.taskId, before: { title: before.title }, ctx: _audit });
    }
    return result;
  }

  async completeTask(input: { businessId: string; taskId: string }, _audit?: AuditContext) {
    const before = await this.prisma.client.contactTask.findUnique({ where: { id: input.taskId } });
    const result = await this.timeline.completeTask(input);
    if (before?.contactId) {
      await this.auditContact({ businessId: input.businessId, contactId: before.contactId, action: "task_completed", entityType: "task", entityId: input.taskId, before: { status: before.status }, after: { status: "completed" }, ctx: _audit });
    }
    return result;
  }

  reopenTask(input: { businessId: string; taskId: string }) {
    return this.timeline.reopenTask(input);
  }

  logCommunication(input: {
    businessId: string;
    contactId: string;
    channelType: string;
    outcome: string;
    duration?: number | null;
    notes?: string | null;
    actorId?: string | null;
  }) {
    return this.timeline.logCommunication(input);
  }

  logContactEvent(input: {
    businessId: string;
    contactId: string;
    type: string;
    data: any;
    actorType?: string;
    actorId?: string;
    source?: string;
  }) {
    return this.timeline.logContactEvent(input);
  }

  listContactEvents(params: { businessId: string; contactId: string; limit?: number }) {
    return this.timeline.listContactEvents(params);
  }

  listContactNotes(params: { businessId: string; contactId: string }) {
    return this.timeline.listContactNotes(params);
  }

  listContactTasks(input: { businessId: string; contactId?: string; status?: string; dueBefore?: Date }) {
    return this.timeline.listContactTasks(input);
  }

  dueTasks(input: { businessId: string; windowDays?: number }) {
    return this.timeline.dueTasks(input);
  }

  async listNextActions(input: { businessId: string; windowDays?: number; limit?: number }) {
    const windowDays = Math.max(0, Math.min(60, input.windowDays ?? 7));
    const limit = Math.max(1, Math.min(100, input.limit ?? 25));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + windowDays);
    const now = new Date();

    const contacts = await this.prisma.client.contact.findMany({
      where: {
        ...contactWhereBase(input.businessId),
        archivedAt: null,
        nextActionAt: { not: null, lte: cutoff },
      },
      orderBy: [
        { nextActionAt: 'asc' },
      ],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        email: true,
        phone: true,
        priority: true,
        status: true,
        nextActionAt: true,
        nextActionType: true,
      },
    });

    const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const ranked = contacts
      .map((c) => ({
        ...c,
        overdue: c.nextActionAt ? c.nextActionAt.getTime() < now.getTime() : false,
        priorityRank: priorityRank[(c.priority ?? 'NORMAL').toUpperCase()] ?? 2,
      }))
      .sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
        const at = a.nextActionAt?.getTime() ?? 0;
        const bt = b.nextActionAt?.getTime() ?? 0;
        return at - bt;
      })
      .slice(0, limit);

    return {
      windowDays,
      now: now.toISOString(),
      items: ranked.map(({ priorityRank: _r, ...rest }) => ({
        ...rest,
        nextActionAt: rest.nextActionAt?.toISOString() ?? null,
      })),
    };
  }

  async completeNextAction(input: { businessId: string; contactId: string; actorId?: string | null }) {
    const existing = await this.assertContact(input.businessId, input.contactId);
    if (!existing.nextActionAt && !existing.nextActionType) {
      return existing;
    }
    const updated = await this.prisma.client.contact.update({
      where: { id: input.contactId },
      data: { nextActionAt: null, nextActionType: null },
    });
    this.events.emit('contact.next_action_cleared', {
      businessId: input.businessId,
      contactId: input.contactId,
    });
    await this.timeline.logEvent(
      input.businessId,
      input.contactId,
      'next_action.completed',
      {
        previousNextActionAt: existing.nextActionAt?.toISOString() ?? null,
        previousNextActionType: existing.nextActionType ?? null,
      },
      { actorType: 'USER', actorId: input.actorId ?? undefined, source: 'crm' },
    );
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return updated;
  }

  async snoozeNextAction(input: {
    businessId: string;
    contactId: string;
    snoozeUntil?: string | null;
    days?: number | null;
    actorId?: string | null;
  }) {
    const existing = await this.assertContact(input.businessId, input.contactId);
    let target: Date | null;
    if (input.snoozeUntil) {
      const parsed = new Date(input.snoozeUntil);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('snoozeUntil must be a valid ISO date');
      }
      target = parsed;
    } else if (typeof input.days === 'number' && Number.isFinite(input.days)) {
      const days = Math.max(1, Math.min(60, Math.floor(input.days)));
      const now = new Date();
      const baseMs = Math.max(existing.nextActionAt?.getTime() ?? 0, now.getTime());
      target = new Date(baseMs + days * 24 * 60 * 60 * 1000);
    } else {
      throw new BadRequestException('Provide snoozeUntil (ISO date) or days (1-60)');
    }
    const updated = await this.prisma.client.contact.update({
      where: { id: input.contactId },
      data: { nextActionAt: target },
    });
    this.events.emit('contact.next_action_set', {
      businessId: input.businessId,
      contactId: input.contactId,
      nextActionAt: target.toISOString(),
    });
    await this.timeline.logEvent(
      input.businessId,
      input.contactId,
      'next_action.snoozed',
      {
        previousNextActionAt: existing.nextActionAt?.toISOString() ?? null,
        nextActionAt: target.toISOString(),
        nextActionType: existing.nextActionType ?? null,
      },
      { actorType: 'USER', actorId: input.actorId ?? undefined, source: 'crm' },
    );
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return updated;
  }

  approveAutopilotAction(input: { businessId: string; actionId: string }) {
    return this.timeline.approveAutopilotAction(input);
  }

  denyAutopilotAction(input: { businessId: string; actionId: string }) {
    return this.timeline.denyAutopilotAction(input);
  }

  listContactLists(businessId: string) {
    return this.lists.listContactLists(businessId);
  }

  createContactList(input: { businessId: string; name: string; description?: string; color?: string; type?: string; filters?: any; rules?: any; contactIds?: string[] }) {
    return this.lists.createContactList(input);
  }

  updateContactList(input: { businessId: string; listId: string; name?: string; description?: string; color?: string; type?: string; filters?: any; rules?: any; contactIds?: string[] }) {
    return this.lists.updateContactList(input);
  }

  deleteContactList(input: { businessId: string; listId: string }) {
    return this.lists.deleteContactList(input);
  }

  getContactListContacts(input: { businessId: string; listId: string; limit?: number; offset?: number }) {
    return this.lists.getContactListContacts(input);
  }

  addContactsToList(input: { businessId: string; listId: string; contactIds: string[] }) {
    return this.lists.addContactsToList(input);
  }

  removeContactFromList(input: { businessId: string; listId: string; contactId: string }) {
    return this.lists.removeContactFromList(input);
  }

  async checkDuplicates(businessId: string, contacts: Array<{ email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null }>) {
    const limited = contacts.slice(0, 100);
    const emails = limited
      .map((c) => normalizeEmail(c.email))
      .filter((e): e is string => !!e);
    const phones = limited
      .map((c) => normalizePhone(c.phone))
      .filter((p): p is string => !!p);

    const { existingByEmail, existingByPhone } = await findExistingBulk(this.prisma, businessId, emails, phones);

    const duplicates: Array<{
      importIndex: number;
      importContact: typeof limited[0];
      existingContact: typeof existingByEmail[0];
      matchField: 'email' | 'phone';
    }> = [];

    const newContacts: number[] = [];

    for (let i = 0; i < limited.length; i++) {
      const c = limited[i];
      const normalizedEmailVal = normalizeEmail(c.email);
      const normalizedPhoneVal = normalizePhone(c.phone);
      let matched = false;

      if (normalizedEmailVal) {
        const match = existingByEmail.find((e) => e.emailNormalized === normalizedEmailVal);
        if (match) {
          duplicates.push({ importIndex: i, importContact: c, existingContact: match, matchField: 'email' });
          matched = true;
        }
      }
      if (!matched && normalizedPhoneVal) {
        const match = existingByPhone.find((e) => e.phoneNormalized === normalizedPhoneVal);
        if (match) {
          duplicates.push({ importIndex: i, importContact: c, existingContact: match, matchField: 'phone' });
          matched = true;
        }
      }
      if (!matched) {
        newContacts.push(i);
      }
    }

    return {
      total: limited.length,
      newCount: newContacts.length,
      duplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 50),
    };
  }
}

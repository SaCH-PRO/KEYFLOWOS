import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
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
import { AutomationService } from '../automation/automation.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmListsService } from './crm-lists.service';
import { CrmFlowService } from './crm-flow.service';
import type { ContactMeta, ContactWithStats } from './crm-stats.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { normalizeEmail, normalizePhone, findExistingByEmailOrPhone, findExistingBulk } from './crm-duplicate.util';

type ContactSortBy = 'name' | 'newest' | 'oldest' | 'revenue' | 'score' | 'lastInteraction';

export type ContactListOptions = {
  businessId: string;
  status?: string;
  search?: string;
  hasUnpaidInvoices?: boolean;
  hasUpcomingBookings?: boolean;
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
  skip?: number;
  take?: number;
  cursor?: string;
  includeStats?: boolean;
  sortBy?: ContactSortBy;
  sortOrder?: 'asc' | 'desc';
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
};

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(forwardRef(() => AutomationService)) private readonly automation: AutomationService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmStatsService) private readonly stats: CrmStatsService,
    @Inject(CrmListsService) private readonly lists: CrmListsService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
  ) {}

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
    const where: any = { ...contactWhereBase(input.businessId) };
    if (input.status) where.status = input.status;
    const searchValue = input.search?.trim();
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
      if (normalizedEmail) {
        orConditions.push({ emailNormalized: { contains: normalizedEmail } });
      }
      if (normalizedPhone) {
        orConditions.push({ phoneNormalized: { contains: normalizedPhone } });
      }
      where.OR = orConditions;
    }
    if (input.hasUnpaidInvoices) {
      where.invoices = {
        some: {
          status: { in: ['SENT', 'OVERDUE'] },
          deletedAt: null,
        },
      };
    }
    if (input.hasUpcomingBookings) {
      where.bookings = {
        some: {
          startTime: { gt: new Date() },
          status: { notIn: ['CANCELLED'] },
          deletedAt: null,
        },
      };
    }
    if (input.staleDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.staleDays);
      where.NOT = [
        {
          bookings: {
            some: {
              startTime: { gt: cutoff },
              deletedAt: null,
            },
          },
        },
      ];
    }
    if (input.newThisWeek) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      where.createdAt = { gte: start };
    }
    if (input.tags && input.tags.length > 0) {
      where.tags = { hasSome: input.tags };
    }
    if (input.ownerId) where.ownerId = input.ownerId;
    if (input.lifecycleStage) where.lifecycleStage = input.lifecycleStage;
    if (input.companyName) where.companyName = { contains: input.companyName, mode: 'insensitive' };
    if (input.industry) where.industry = { contains: input.industry, mode: 'insensitive' };
    if (input.city) where.city = { contains: input.city, mode: 'insensitive' };
    if (input.country) where.country = { contains: input.country, mode: 'insensitive' };
    if (input.segment) where.segment = input.segment;
    if (typeof input.doNotContact === 'boolean') where.doNotContact = input.doNotContact;

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
  } & ContactExtraAttributes) {
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

    return this.prisma.client.$transaction(async (tx) => {
      if (email) {
        const existing = await tx.contact.findFirst({
          where: { ...contactWhereBase(businessId), emailNormalized },
        });
        if (existing) {
          return this.mergeContactDetails(existing, businessId, {
            firstName: input.firstName,
            lastName: input.lastName,
            email,
            phone,
            source: input.source,
            sourceDetail: input.sourceDetail,
            tags,
          });
        }
      }
      if (phoneNormalized) {
        const existingByPhone = await tx.contact.findFirst({
          where: { ...contactWhereBase(businessId), phoneNormalized },
        });
        if (existingByPhone) {
          return this.mergeContactDetails(existingByPhone, businessId, {
            firstName: input.firstName,
            lastName: input.lastName,
            email,
            phone,
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
  } & ContactExtraAttributes) {
    const start = Date.now();
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
      custom: input.custom ?? undefined,
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

    if (this.automation && input.status && existing?.status !== input.status) {
      await this.automation.handle({
        type: 'contact.stage_changed',
        businessId: input.businessId,
        contactId: input.contactId,
        from: existing?.status,
        to: input.status,
      });
    }
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    const duration = Date.now() - start;
    this.logger.log(`[CRM] updateContact businessId=${input.businessId} contactId=${input.contactId} duration=${duration}ms`);
    if (duration > 1000) this.logger.warn(`[CRM] updateContact slow businessId=${input.businessId} duration=${duration}ms`);
    return updated;
  }

  async softDeleteContact(input: { businessId: string; contactId: string }) {
    const contact = await this.assertContact(input.businessId, input.contactId);
    await this.timeline.logEvent(
      input.businessId,
      input.contactId,
      'contact.deleted',
      { name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() },
      { actorType: 'USER', source: 'crm' },
    );
    const deleted = await this.prisma.client.contact.update({ where: { id: input.contactId }, data: { deletedAt: new Date() } });
    const deletedPayload: ContactDeletedPayload = {
      contact: deleted,
      businessId: input.businessId,
    };
    this.events.emit('contact.deleted', deletedPayload);
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return deleted;
  }

  async bulkUpdateContacts(input: { businessId: string; contactIds: string[]; status?: string; addTags?: string[] }) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }
    const data: any = {};
    if (input.status) data.status = input.status;
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
          }, tx);
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
        await this.timeline.logEvent(input.businessId, cid, 'bulk.updated', { status: input.status }, tx);
      }
      return res;
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { updated: result.count };
  }

  async bulkDeleteContacts(input: { businessId: string; contactIds: string[] }) {
    if (!input.contactIds || input.contactIds.length === 0) {
      throw new BadRequestException('contactIds is required');
    }
    const eventOps = input.contactIds.map((cid) =>
      this.timeline.logEvent(input.businessId, cid, 'contact.deleted', { bulk: true }),
    );
    await Promise.allSettled(eventOps);
    const result = await this.prisma.client.contact.updateMany({
      where: { id: { in: input.contactIds }, ...contactWhereBase(input.businessId) },
      data: { deletedAt: new Date() },
    });
    this.stats.invalidateCache(input.businessId);
    this.flow.invalidateCache(input.businessId);
    return { deleted: result.count };
  }

  async mergeContacts(input: { businessId: string; primaryId: string; duplicateId: string; fieldOverrides?: Record<string, unknown> }) {
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

    for (const field of fillableFields) {
      const primaryVal = primary[field];
      const duplicateVal = duplicate[field];
      if ((primaryVal === null || primaryVal === undefined || primaryVal === '') && duplicateVal) {
        contactUpdate[field] = duplicateVal;
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
    const mergedCustom = { ...duplicateCustom, ...primaryCustom };
    contactUpdate.custom = mergedCustom;

    if (input.fieldOverrides) {
      for (const [key, value] of Object.entries(input.fieldOverrides)) {
        if (fillableFields.includes(key as any) || key === 'tags' || key === 'status') {
          contactUpdate[key] = value;
        }
      }
    }

    const merged = await this.prisma.client.$transaction(async (tx) => {
      await tx.contactEvent.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      await tx.contactNote.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      await tx.contactTask.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      await tx.crmSequenceEnrollment.updateMany({
        where: { contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      await tx.quote.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      await tx.invoice.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      await tx.booking.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      });
      const mergedContact = await tx.contact.update({
        where: { id: input.primaryId },
        data: contactUpdate as any,
      });
      await tx.contact.update({
        where: { id: input.duplicateId },
        data: { deletedAt: new Date() },
      });
      await this.timeline.logEvent(
        input.businessId,
        input.primaryId,
        'contact.merged',
        { duplicateId: input.duplicateId, mergedFields: Object.keys(contactUpdate) },
        { actorType: 'SYSTEM', source: 'crm' },
        tx,
      );
      return mergedContact;
    });
    if (merged) {
      const payload: ContactMergedPayload = {
        contact: merged,
        businessId: input.businessId,
        duplicateId: input.duplicateId,
      };
      this.events.emit('contact.merged', payload);
    }
    return merged;
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

  addNote(input: { businessId: string; contactId: string; body: string; authorId?: string | null; source?: string }) {
    return this.timeline.addNote(input);
  }

  addTask(input: {
    businessId: string;
    contactId: string;
    title: string;
    dueDate?: string | null;
    priority?: string | null;
    assigneeId?: string | null;
    remindAt?: string | null;
    creatorId?: string | null;
    source?: string | null;
  }) {
    return this.timeline.addTask(input);
  }

  updateNote(input: { businessId: string; noteId: string; body?: string; source?: string }) {
    return this.timeline.updateNote(input);
  }

  deleteNote(input: { businessId: string; noteId: string }) {
    return this.timeline.deleteNote(input);
  }

  updateTask(input: { businessId: string; taskId: string; title?: string; dueDate?: string; priority?: string; remindAt?: string }) {
    return this.timeline.updateTask(input);
  }

  deleteTask(input: { businessId: string; taskId: string }) {
    return this.timeline.deleteTask(input);
  }

  completeTask(input: { businessId: string; taskId: string }) {
    return this.timeline.completeTask(input);
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

  approveAutopilotAction(input: { businessId: string; actionId: string }) {
    return this.timeline.approveAutopilotAction(input);
  }

  denyAutopilotAction(input: { businessId: string; actionId: string }) {
    return this.timeline.denyAutopilotAction(input);
  }

  listContactLists(businessId: string) {
    return this.lists.listContactLists(businessId);
  }

  createContactList(input: { businessId: string; name: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] }) {
    return this.lists.createContactList(input);
  }

  updateContactList(input: { businessId: string; listId: string; name?: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] }) {
    return this.lists.updateContactList(input);
  }

  deleteContactList(input: { businessId: string; listId: string }) {
    return this.lists.deleteContactList(input);
  }

  getContactListContacts(input: { businessId: string; listId: string }) {
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

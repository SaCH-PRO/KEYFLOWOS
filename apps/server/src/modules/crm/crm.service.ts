import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Contact, Prisma } from '@prisma/client';
import {
  ContactCreatedPayload,
  ContactMergedPayload,
  ContactUpdatedPayload,
} from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AutomationService } from '../automation/automation.service';

type ContactMeta = {
  outstandingBalance: number;
  unpaidInvoices: number;
  paidInvoices: number;
  oldestUnpaidInvoiceDueAt: Date | null;
  lastInteractionAt: Date;
  nextDueTaskAt: Date | null;
  overdueTasks: number;
  overdueBookings: number;
  bookingsRecent: number;
  leadScore: number;
};

type ContactWithStats = Contact & {
  meta?: ContactMeta;
};

type ContactListOptions = {
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
  includeStats?: boolean;
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

type ContactHighlight = {
  contactId: string;
  name: string;
  status: string;
  leadScore: number;
  outstandingBalance: number;
  unpaidInvoices: number;
  lastInteractionAt: Date | null;
  tags: string[];
};

type ServiceAffinity = {
  serviceId: string;
  serviceName: string;
  bookings: number;
  revenue: number;
  topContact?: {
    id: string;
    name: string;
    bookings: number;
  };
};

type SegmentInsight = {
  key: string;
  label: string;
  description: string;
  count: number;
  contacts: ContactWithStats[];
};

type TimelineEntry = {
  id: string;
  type: 'event' | 'note' | 'task' | 'invoice' | 'booking';
  contactId: string;
  contactName?: string;
  contactEmail?: string | null;
  title: string;
  description?: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
};

type NextActionSeverity = 'high' | 'medium' | 'info';

type NextAction = {
  id: string;
  contactId: string;
  contactName?: string;
  title: string;
  detail: string;
  severity: NextActionSeverity;
  trigger: string;
};

type AiStub = {
  id: string;
  title: string;
  detail: string;
};

type FlowHighlightsPayload = {
  highlights: {
    highPotential: ContactHighlight[];
    overdueReminders: ContactHighlight[];
    serviceAffinity: ServiceAffinity[];
  };
  segments: SegmentInsight[];
  timeline: TimelineEntry[];
  nextActions: NextAction[];
  aiNextActions: AiStub[];
};

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(forwardRef(() => AutomationService)) private readonly automation: AutomationService,
  ) {}

  private normalizeEmail(email?: string | null) {
    return email ? email.trim().toLowerCase() : null;
  }

  private normalizePhone(phone?: string | null) {
    return phone ? phone.replace(/[^0-9+]/g, '') : null;
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
      where: { id: contactId, businessId, deletedAt: null },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  async listContacts(input: ContactListOptions) {
    const where: any = { businessId: input.businessId, deletedAt: null };
    if (input.status) where.status = input.status;
    const searchValue = input.search?.trim();
    if (searchValue) {
      const normalizedEmail = this.normalizeEmail(searchValue);
      const normalizedPhone = this.normalizePhone(searchValue);
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
      const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday start
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

    const skip = input.skip ?? 0;
    const take = input.take ?? 50;
    const contacts = await this.prisma.client.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    if (!input.includeStats || contacts.length === 0) {
      return contacts;
    }
    return this.attachContactStats(input.businessId, contacts);
  }

  private async attachContactStats(businessId: string, contacts: Contact[]): Promise<ContactWithStats[]> {
    const ids = contacts.map((c) => c.id);
    const [invoices, tasks, events, notes, bookings] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { businessId, contactId: { in: ids }, deletedAt: null },
        select: {
          id: true,
          contactId: true,
          status: true,
          total: true,
          currency: true,
          dueDate: true,
          issueDate: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId, contactId: { in: ids } },
        select: { contactId: true, status: true, dueDate: true, createdAt: true },
      }),
      this.prisma.client.contactEvent.findMany({
        where: { businessId, contactId: { in: ids } },
        select: { contactId: true, createdAt: true },
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId, contactId: { in: ids } },
        select: { contactId: true, createdAt: true },
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, contactId: { in: ids }, deletedAt: null },
        select: { contactId: true, status: true, startTime: true },
      }),
    ]);

    const statsMap = new Map<string, ContactMeta>();
    for (const contact of contacts) {
      statsMap.set(contact.id, {
        outstandingBalance: 0,
        unpaidInvoices: 0,
        paidInvoices: 0,
        oldestUnpaidInvoiceDueAt: null,
        lastInteractionAt: contact.updatedAt,
        nextDueTaskAt: null,
        overdueTasks: 0,
        overdueBookings: 0,
        bookingsRecent: 0,
        leadScore: 50,
      });
    }

    const now = new Date();
    invoices.forEach((inv) => {
      const stats = statsMap.get(inv.contactId);
      if (!stats) return;
      if (['SENT', 'OVERDUE'].includes(inv.status)) {
        stats.outstandingBalance += Number(inv.total ?? 0);
        stats.unpaidInvoices += 1;
        const dueDate = inv.dueDate ?? inv.issueDate ?? inv.createdAt;
        if (dueDate) {
          if (!stats.oldestUnpaidInvoiceDueAt || dueDate < stats.oldestUnpaidInvoiceDueAt) {
            stats.oldestUnpaidInvoiceDueAt = dueDate;
          }
        }
      }
      if (inv.status === 'PAID') {
        stats.paidInvoices += 1;
      }
    });

    tasks.forEach((task) => {
      const stats = statsMap.get(task.contactId);
      if (!stats) return;
      if (task.status !== 'DONE' && task.dueDate) {
        const due = new Date(task.dueDate);
        if (!stats.nextDueTaskAt || due < stats.nextDueTaskAt) stats.nextDueTaskAt = due;
        if (due < now) stats.overdueTasks += 1;
      }
      if (task.createdAt > stats.lastInteractionAt) stats.lastInteractionAt = task.createdAt;
    });

    events.forEach((event) => {
      const stats = statsMap.get(event.contactId);
      if (stats && event.createdAt > stats.lastInteractionAt) stats.lastInteractionAt = event.createdAt;
    });
    notes.forEach((note) => {
      const stats = statsMap.get(note.contactId);
      if (stats && note.createdAt > stats.lastInteractionAt) stats.lastInteractionAt = note.createdAt;
    });
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 14);
    bookings.forEach((booking) => {
      const stats = statsMap.get(booking.contactId);
      if (!stats) return;
      if (booking.status === 'COMPLETED' && booking.startTime > recentCutoff) stats.bookingsRecent += 1;
      if (booking.status === 'PENDING' && booking.startTime < now) stats.overdueBookings += 1;
      if (booking.startTime > stats.lastInteractionAt) stats.lastInteractionAt = booking.startTime;
    });

    const withStats = contacts.map((contact) => {
      const stats = statsMap.get(contact.id);
      if (!stats) return contact;
      const leadScore =
        50 +
        stats.bookingsRecent * 15 +
        stats.paidInvoices * 10 -
        stats.unpaidInvoices * 5 -
        stats.overdueTasks * 5 +
        (contact.status === 'CLIENT' ? 5 : 0);
      stats.leadScore = leadScore;
      return {
        ...contact,
        meta: stats,
      };
    });
    return withStats;
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
    const normalizeString = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const firstName = normalizeString(input.firstName);
    const lastName = normalizeString(input.lastName);
    const email = normalizeString(input.email);
    const phone = normalizeString(input.phone);
    const emailNormalized = this.normalizeEmail(email);
    const phoneNormalized = this.normalizePhone(phone);
    const tags = this.normalizeTags(input.tags);

    const created = await this.prisma.client.contact.create({
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
        companyName: normalizeString(input.companyName),
        jobTitle: normalizeString(input.jobTitle),
        department: normalizeString(input.department),
        industry: normalizeString(input.industry),
        ownerId: input.ownerId ?? null,
        lifecycleStage: normalizeString(input.lifecycleStage),
        segment: normalizeString(input.segment),
        language: normalizeString(input.language),
        marketingOptIn: input.marketingOptIn ?? null,
        doNotContact: input.doNotContact ?? null,
        notesInternal: input.notesInternal ?? null,
      },
      select: { id: true },
    });

    await this.logEvent(input.businessId, created.id, 'contact.created', {
      firstName,
      lastName,
      email,
      source: input.source ?? 'manual',
    });
    const contact = await this.prisma.client.contact.findUnique({ where: { id: created.id } });
    if (contact) {
      const payload: ContactCreatedPayload = {
        contact,
        businessId: input.businessId,
      };
      this.events.emit('contact.created', payload);
    }
    return contact;
  }

  async findOrCreateContact(
    businessId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      source?: string | null;
      sourceDetail?: string | null;
      tags?: string[];
    },
  ) {
    const normalizeString = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const email = normalizeString(input.email);
    const phone = normalizeString(input.phone);
    const emailNormalized = this.normalizeEmail(email);
    const phoneNormalized = this.normalizePhone(phone);
    const tags = this.normalizeTags(input.tags);

    if (email) {
      const existing = await this.prisma.client.contact.findFirst({
        where: { businessId, emailNormalized, deletedAt: null },
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
      const existingByPhone = await this.prisma.client.contact.findFirst({
        where: { businessId, phoneNormalized, deletedAt: null },
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
    return this.createContact({
      businessId,
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      phone,
      source: input.source ?? undefined,
      sourceDetail: input.sourceDetail ?? undefined,
      tags,
    });
  }

  private async mergeContactDetails(
    existing: Contact,
    businessId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      source?: string | null;
      sourceDetail?: string | null;
      tags?: string[];
    },
  ) {
    const updates: Partial<Contact> & ContactExtraAttributes = {};
    if (input.firstName && !existing.firstName) updates.firstName = input.firstName;
    if (input.lastName && !existing.lastName) updates.lastName = input.lastName;
    if (input.email && !existing.email) updates.email = input.email;
    if (input.phone && !existing.phone) updates.phone = input.phone;
    if (input.source && !existing.source) updates.source = input.source;
    if (input.sourceDetail && !existing.sourceDetail) updates.sourceDetail = input.sourceDetail;
    if (input.tags && input.tags.length > 0) {
      const merged = new Set([...(existing.tags ?? []), ...input.tags]);
      updates.tags = Array.from(merged);
    }
    if (Object.keys(updates).length === 0) {
      return existing;
    }
    return this.updateContact({ businessId, contactId: existing.id, ...updates });
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
    const existing = await this.assertContact(input.businessId, input.contactId);
    const trimOptional = (value?: string | null) => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };
    const email = trimOptional(input.email);
    const phone = trimOptional(input.phone);
    const emailNormalized = email !== undefined ? this.normalizeEmail(email) : undefined;
    const phoneNormalized = phone !== undefined ? this.normalizePhone(phone) : undefined;
    const tags = input.tags !== undefined ? this.normalizeTags(input.tags) : undefined;

    const data: Prisma.ContactUpdateInput = {
      firstName: trimOptional(input.firstName),
      lastName: trimOptional(input.lastName),
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
      companyName: trimOptional(input.companyName),
      jobTitle: trimOptional(input.jobTitle),
      department: trimOptional(input.department),
      industry: trimOptional(input.industry),
      ownerId: input.ownerId ?? undefined,
      lifecycleStage: trimOptional(input.lifecycleStage),
      segment: trimOptional(input.segment),
      language: trimOptional(input.language),
      marketingOptIn: input.marketingOptIn ?? undefined,
      doNotContact: input.doNotContact ?? undefined,
      notesInternal: input.notesInternal ?? undefined,
    };

    const updated = await this.prisma.client.contact.update({
      where: { id: input.contactId },
      data,
    });

    const updatedFields = Object.keys(data).filter(
      (key) => data[key as keyof Prisma.ContactUpdateInput] !== undefined,
    );
    if (updatedFields.length > 0) {
      await this.logEvent(
        input.businessId,
        input.contactId,
        'contact.updated',
        { updatedFields },
        { actorType: 'USER', source: 'crm' },
      );
    }

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
    return updated;
  }

  async softDeleteContact(input: { businessId: string; contactId: string }) {
    await this.assertContact(input.businessId, input.contactId);
    return this.prisma.client.contact.update({ where: { id: input.contactId }, data: { deletedAt: new Date() } });
  }

  async mergeContacts(input: { businessId: string; primaryId: string; duplicateId: string }) {
    if (input.primaryId === input.duplicateId) {
      throw new BadRequestException('Cannot merge a contact into itself');
    }

    await this.assertContact(input.businessId, input.primaryId);
    await this.assertContact(input.businessId, input.duplicateId);

    await this.prisma.client.$transaction([
      this.prisma.client.contactEvent.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      }),
      this.prisma.client.contactNote.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      }),
      this.prisma.client.contactTask.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      }),
      this.prisma.client.quote.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      }),
      this.prisma.client.invoice.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      }),
      this.prisma.client.booking.updateMany({
        where: { businessId: input.businessId, contactId: input.duplicateId },
        data: { contactId: input.primaryId },
      }),
      this.prisma.client.contact.update({
        where: { id: input.duplicateId },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.logEvent(
      input.businessId,
      input.primaryId,
      'contact.merged',
      { duplicateId: input.duplicateId },
      { actorType: 'SYSTEM', source: 'crm' },
    );
    const merged = await this.prisma.client.contact.findUnique({ where: { id: input.primaryId } });
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

  async contactDetail(params: { businessId: string; contactId: string }) {
    const contact = await this.assertContact(params.businessId, params.contactId);
    const [events, notes, tasks, invoices, bookings] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId: params.businessId, contactId: params.contactId, deletedAt: null },
        select: {
          id: true,
          status: true,
          total: true,
          currency: true,
          dueDate: true,
          issueDate: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.client.booking.findMany({
        where: { businessId: params.businessId, contactId: params.contactId, deletedAt: null },
        select: { id: true, status: true, startTime: true, endTime: true, serviceId: true, staffId: true },
      }),
    ]);

    const meta: ContactMeta = {
      outstandingBalance: 0,
      unpaidInvoices: 0,
      paidInvoices: 0,
      oldestUnpaidInvoiceDueAt: null,
      lastInteractionAt: contact.updatedAt,
      nextDueTaskAt: null,
      overdueTasks: 0,
      overdueBookings: 0,
      bookingsRecent: 0,
      leadScore: 50,
    };

    const now = new Date();
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 14);

    for (const inv of invoices) {
      if (['SENT', 'OVERDUE'].includes(inv.status)) {
        meta.outstandingBalance += Number(inv.total ?? 0);
        meta.unpaidInvoices += 1;
        const dueDate = inv.dueDate ?? inv.issueDate ?? inv.createdAt;
        if (dueDate) {
          if (!meta.oldestUnpaidInvoiceDueAt || dueDate < meta.oldestUnpaidInvoiceDueAt) {
            meta.oldestUnpaidInvoiceDueAt = dueDate;
          }
        }
      }
      if (inv.status === 'PAID') {
        meta.paidInvoices += 1;
      }
    }

    for (const task of tasks) {
      if (task.status !== 'DONE' && task.dueDate) {
        const due = new Date(task.dueDate);
        if (!meta.nextDueTaskAt || due < meta.nextDueTaskAt) meta.nextDueTaskAt = due;
        if (due < now) meta.overdueTasks += 1;
      }
      if (task.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = task.createdAt;
    }

    for (const event of events) {
      if (event.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = event.createdAt;
    }
    for (const note of notes) {
      if (note.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = note.createdAt;
    }
    for (const booking of bookings) {
      if (booking.status === 'COMPLETED' && booking.startTime > recentCutoff) meta.bookingsRecent += 1;
      if (booking.status === 'PENDING' && booking.startTime < now) meta.overdueBookings += 1;
      if (booking.startTime > meta.lastInteractionAt) meta.lastInteractionAt = booking.startTime;
    }

    meta.leadScore =
      50 +
      meta.bookingsRecent * 15 +
      meta.paidInvoices * 10 -
      meta.unpaidInvoices * 5 -
      meta.overdueTasks * 5 +
      (contact.status === 'CLIENT' ? 5 : 0);

    return { contact, events, notes, tasks, invoices, bookings, meta };
  }

  async listContactEvents(params: { businessId: string; contactId: string; limit?: number }) {
    await this.assertContact(params.businessId, params.contactId);
    return this.prisma.client.contactEvent.findMany({
      where: { businessId: params.businessId, contactId: params.contactId },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 20,
    });
  }

  async listContactNotes(params: { businessId: string; contactId: string }) {
    await this.assertContact(params.businessId, params.contactId);
    return this.prisma.client.contactNote.findMany({
      where: { businessId: params.businessId, contactId: params.contactId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listContactTasks(input: {
    businessId: string;
    contactId?: string;
    status?: string;
    dueBefore?: Date;
  }) {
    const where: any = { businessId: input.businessId };
    if (input.contactId) {
      await this.assertContact(input.businessId, input.contactId);
      where.contactId = input.contactId;
    }
    if (input.status) where.status = input.status;
    if (input.dueBefore) where.dueDate = { lte: input.dueBefore };
    return this.prisma.client.contactTask.findMany({
      where,
      orderBy: { dueDate: 'asc', createdAt: 'desc' },
      include: { contact: true },
      take: 100,
    });
  }

  addNote(input: { businessId: string; contactId: string; body: string; authorId?: string | null; source?: string }) {
    return this.assertContact(input.businessId, input.contactId).then(async () => {
      const note = await this.prisma.client.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body: input.body,
          authorId: input.authorId ?? null,
          source: input.source ?? 'manual',
        },
      });
      await this.logEvent(
        input.businessId,
        input.contactId,
        'note.created',
        { noteId: note.id },
        { source: input.source ?? 'crm', actorType: 'USER', actorId: input.authorId ?? undefined },
      );
      return note;
    });
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
    return this.assertContact(input.businessId, input.contactId)
      .then(() =>
        this.prisma.client.contactTask.create({
          data: {
            businessId: input.businessId,
            contactId: input.contactId,
            title: input.title,
            dueDate: this.parseDateOrNull(input.dueDate),
            priority: input.priority ?? 'NORMAL',
            assigneeId: input.assigneeId ?? null,
            remindAt: this.parseDateOrNull(input.remindAt),
            source: input.source ?? 'manual',
          },
        }),
      )
      .then(async (task) => {
        await this.logEvent(
          input.businessId,
          input.contactId,
          'task.created',
          {
            title: input.title,
            dueDate: input.dueDate,
            priority: input.priority ?? 'NORMAL',
            assigneeId: input.assigneeId,
          },
          { actorType: 'USER', actorId: input.creatorId ?? undefined, source: input.source ?? 'crm' },
        );
        return task;
      });
  }

  async completeTask(input: { businessId: string; taskId: string }) {
    const task = await this.prisma.client.contactTask.findFirst({
      where: { id: input.taskId, businessId: input.businessId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const updated = await this.prisma.client.contactTask.update({
      where: { id: input.taskId },
      data: { status: 'DONE', completedAt: new Date() },
    });
    await this.logEvent(input.businessId, task.contactId, 'task.completed', { taskId: task.id, title: task.title });
    return updated;
  }

  private logEvent(
    businessId: string,
    contactId: string,
    type: string,
    data: any,
    meta?: { actorType?: string; actorId?: string; source?: string },
  ) {
    return this.prisma.client.contactEvent.create({
      data: {
        businessId,
        contactId,
        type,
        data,
        actorType: meta?.actorType,
        actorId: meta?.actorId,
        source: meta?.source ?? 'system',
      },
    });
  }

  // Expose for other modules to log events without cycle
  async logContactEvent(input: {
    businessId: string;
    contactId: string;
    type: string;
    data: any;
    actorType?: string;
    actorId?: string;
    source?: string;
  }) {
    await this.assertContact(input.businessId, input.contactId);
    return this.logEvent(input.businessId, input.contactId, input.type, input.data, {
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
    });
  }

  async segmentSummary(input: { businessId: string }) {
    const base = { businessId: input.businessId, deletedAt: null };
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 30);

    const [lead, prospect, client, lost, unpaid, stale, newThisWeek] = await Promise.all([
      this.prisma.client.contact.count({ where: { ...base, status: 'LEAD' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'PROSPECT' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'CLIENT' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'LOST' } }),
      this.prisma.client.contact.count({
        where: { ...base, invoices: { some: { status: { in: ['SENT', 'OVERDUE'] }, deletedAt: null } } },
      }),
      this.prisma.client.contact.count({
        where: {
          ...base,
          createdAt: { lte: staleCutoff },
          bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } },
        },
      }),
      this.prisma.client.contact.count({ where: { ...base, createdAt: { gte: start } } }),
    ]);
    return { lead, prospect, client, lost, unpaid, stale, newThisWeek };
  }

  async flowHighlights(input: { businessId: string }): Promise<FlowHighlightsPayload> {
    const contacts = await this.listContacts({ businessId: input.businessId, includeStats: true, take: 200 });
    const [segments, serviceAffinity, timeline] = await Promise.all([
      this.buildSegmentInsights(input.businessId),
      this.buildServiceAffinity(input.businessId),
      this.buildTimeline(input.businessId),
    ]);
    return {
      highlights: {
        highPotential: this.buildHighlightCards(contacts, 4, (meta) => meta.leadScore),
        overdueReminders: this.buildHighlightCards(
          contacts,
          4,
          (meta) => meta.outstandingBalance,
          (contact) => (contact.meta?.outstandingBalance ?? 0) > 0,
        ),
        serviceAffinity,
      },
      segments,
      timeline,
      nextActions: this.buildNextActions(contacts),
      aiNextActions: [
        {
          id: 'ai-next-actions-stub',
          title: 'AI insights coming soon',
          detail: 'This placeholder will be replaced once the Flow listeners and AI module are wired.',
        },
      ],
    };
  }

  private buildHighlightCards(
    contacts: ContactWithStats[],
    limit: number,
    metric: (meta: ContactMeta) => number,
    filter: (contact: ContactWithStats) => boolean = () => true,
  ): ContactHighlight[] {
    const filtered = contacts.filter((contact) => contact.meta && filter(contact));
    return filtered
      .sort((a, b) => metric(b.meta!) - metric(a.meta!))
      .slice(0, limit)
      .map((contact) => this.contactToHighlight(contact));
  }

  private contactToHighlight(contact: ContactWithStats): ContactHighlight {
    const meta = contact.meta;
    return {
      contactId: contact.id,
      name: this.formatContactName(contact),
      status: contact.status,
      leadScore: meta?.leadScore ?? 50,
      outstandingBalance: meta?.outstandingBalance ?? 0,
      unpaidInvoices: meta?.unpaidInvoices ?? 0,
      lastInteractionAt: meta?.lastInteractionAt ?? null,
      tags: contact.tags ?? [],
    };
  }

  private async buildSegmentInsights(businessId: string): Promise<SegmentInsight[]> {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 21);

    const definitions: Array<{
      key: string;
      label: string;
      description: string;
      params?: Partial<ContactListOptions>;
      take?: number;
      countWhere: Prisma.ContactWhereInput;
    }> = [
      {
        key: 'new-this-week',
        label: 'New this week',
        description: 'Fresh leads created since the start of the week',
        params: { newThisWeek: true },
        take: 6,
        countWhere: { businessId, deletedAt: null, createdAt: { gte: startOfWeek } },
      },
      {
        key: 'cold-with-unpaid',
        label: 'Cold leads with unpaid invoices',
        description: 'No recent activity plus outstanding invoices',
        params: { hasUnpaidInvoices: true, staleDays: 21 },
        countWhere: {
          businessId,
          deletedAt: null,
          invoices: {
            some: {
              status: { in: ['SENT', 'OVERDUE'] as string[] },
              deletedAt: null,
            },
          },
          bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } },
        },
      },
      {
        key: 'top-clients',
        label: 'Top clients',
        description: 'Clients who book and pay frequently',
        params: { status: 'CLIENT' },
        countWhere: { businessId, deletedAt: null, status: 'CLIENT' },
      },
    ];

    const insights: SegmentInsight[] = [];
    for (const def of definitions) {
      const options: ContactListOptions = {
        businessId,
        ...def.params,
        includeStats: def.params?.includeStats ?? true,
        take: def.take ?? 6,
      };
      const [contacts, count] = await Promise.all([
        this.listContacts(options),
        this.prisma.client.contact.count({ where: def.countWhere }),
      ]);
      insights.push({
        key: def.key,
        label: def.label,
        description: def.description,
        count,
        contacts: contacts.slice(0, 6),
      });
    }
    return insights;
  }

  private async buildServiceAffinity(businessId: string): Promise<ServiceAffinity[]> {
    const serviceStats = await this.prisma.client.booking.groupBy({
      by: ['serviceId'],
      where: { businessId, deletedAt: null },
      _count: { serviceId: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: 5,
    });
    if (serviceStats.length === 0) return [];
    const serviceIds = serviceStats.map((stat) => stat.serviceId);
    const services = await this.prisma.client.service.findMany({
      where: { id: { in: serviceIds } },
    });
    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const contactStats = await this.prisma.client.booking.groupBy({
      by: ['serviceId', 'contactId'],
      where: { businessId, deletedAt: null, serviceId: { in: serviceIds } },
      _count: { contactId: true },
    });
    const contactIds = Array.from(new Set(contactStats.map((stat) => stat.contactId)));
    const contacts = await this.prisma.client.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));

    const affinity = serviceStats.map((stat) => {
      const service = serviceMap.get(stat.serviceId);
      if (!service) return null;
      const bestContact = contactStats
        .filter((entry) => entry.serviceId === stat.serviceId)
        .sort((a, b) => b._count.contactId - a._count.contactId)[0];
      const topContact = bestContact ? contactMap.get(bestContact.contactId) : undefined;
      const entry: ServiceAffinity = {
        serviceId: service.id,
        serviceName: service.name,
        bookings: stat._count.serviceId,
        revenue: stat._count.serviceId * service.price,
      };
      if (topContact) {
        entry.topContact = {
          id: topContact.id,
          name: this.formatContactName(topContact),
          bookings: bestContact?._count.contactId ?? 0,
        };
      }
      return entry;
    });
    return affinity.filter((entry): entry is ServiceAffinity => entry !== null);
  }

  private async buildTimeline(businessId: string, limit = 20): Promise<TimelineEntry[]> {
    const [events, notes, tasks, invoices, bookings] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const contactIds = Array.from(
      new Set(
        [
          ...events.map((event) => event.contactId),
          ...notes.map((note) => note.contactId),
          ...tasks.map((task) => task.contactId),
          ...invoices.map((invoice) => invoice.contactId),
          ...bookings.map((booking) => booking.contactId),
        ].filter(Boolean),
      ),
    );
    const contacts = contactIds.length
      ? await this.prisma.client.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true },
        })
      : [];
    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));

    const entries: TimelineEntry[] = [
      ...events.map((event) => ({
        id: event.id,
        type: 'event' as const,
        contactId: event.contactId,
        contactName: contactMap.get(event.contactId)
          ? this.formatContactName(contactMap.get(event.contactId)!)
          : undefined,
        contactEmail: contactMap.get(event.contactId)?.email ?? null,
        title: event.type,
        description: `Event recorded via ${event.source ?? 'system'}`,
        timestamp: event.createdAt,
      })),
      ...notes.map((note) => ({
        id: note.id,
        type: 'note' as const,
        contactId: note.contactId,
        contactName: contactMap.get(note.contactId) ? this.formatContactName(contactMap.get(note.contactId)!) : undefined,
        contactEmail: contactMap.get(note.contactId)?.email ?? null,
        title: 'Note added',
        description: note.body.slice(0, 120),
        timestamp: note.createdAt,
      })),
      ...tasks.map((task) => ({
        id: task.id,
        type: 'task' as const,
        contactId: task.contactId,
        contactName: contactMap.get(task.contactId) ? this.formatContactName(contactMap.get(task.contactId)!) : undefined,
        contactEmail: contactMap.get(task.contactId)?.email ?? null,
        title: `Task: ${task.title}`,
        description: task.dueDate ? `Due ${new Date(task.dueDate).toLocaleString()}` : 'No due date',
        timestamp: task.createdAt,
      })),
      ...invoices.map((invoice) => ({
        id: invoice.id,
        type: 'invoice' as const,
        contactId: invoice.contactId,
        contactName: contactMap.get(invoice.contactId)
          ? this.formatContactName(contactMap.get(invoice.contactId)!)
          : undefined,
        contactEmail: contactMap.get(invoice.contactId)?.email ?? null,
        title: `Invoice ${invoice.status}`,
        description: `Total ${invoice.total} ${invoice.currency}`,
        timestamp: invoice.createdAt,
      })),
      ...bookings.map((booking) => ({
        id: booking.id,
        type: 'booking' as const,
        contactId: booking.contactId,
        contactName: contactMap.get(booking.contactId)
          ? this.formatContactName(contactMap.get(booking.contactId)!)
          : undefined,
        contactEmail: contactMap.get(booking.contactId)?.email ?? null,
        title: `Booking ${booking.status}`,
        description: `Starts ${booking.startTime?.toISOString() ?? 'TBD'}`,
        timestamp: booking.createdAt,
      })),
    ];

    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }

  private buildNextActions(contacts: ContactWithStats[]): NextAction[] {
    const actions: NextAction[] = [];
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 7);
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const now = new Date();
    const pushAction = (action: NextAction) => {
      if (actions.length >= 6) return;
      actions.push(action);
    };

    for (const contact of contacts) {
      if (!contact.meta) continue;
      const {
        outstandingBalance,
        lastInteractionAt,
        nextDueTaskAt,
        overdueTasks,
        overdueBookings,
        oldestUnpaidInvoiceDueAt,
      } = contact.meta;
      const contactName = this.formatContactName(contact);
      if (outstandingBalance > 0) {
        const overdue = oldestUnpaidInvoiceDueAt ? oldestUnpaidInvoiceDueAt < now : false;
        const dueLabel = oldestUnpaidInvoiceDueAt
          ? `Oldest due ${oldestUnpaidInvoiceDueAt.toLocaleDateString()}`
          : `Outstanding balance of ${outstandingBalance.toFixed(2)}`;
        pushAction({
          id: `${contact.id}-invoice`,
          contactId: contact.id,
          contactName,
          title: overdue ? 'Overdue invoice follow-up' : 'Invoice payment follow-up',
          detail: dueLabel,
          severity: overdue ? 'high' : 'medium',
          trigger: 'invoice-unpaid',
        });
      }
      if (overdueBookings > 0) {
        pushAction({
          id: `${contact.id}-booking`,
          contactId: contact.id,
          contactName,
          title: 'Confirm overdue booking',
          detail: `${overdueBookings} booking${overdueBookings > 1 ? 's' : ''} awaiting confirmation`,
          severity: 'high',
          trigger: 'booking-overdue',
        });
      }
      if (overdueTasks > 0) {
        pushAction({
          id: `${contact.id}-task-overdue`,
          contactId: contact.id,
          contactName,
          title: 'Overdue tasks',
          detail: `${overdueTasks} task${overdueTasks > 1 ? 's' : ''} overdue`,
          severity: 'medium',
          trigger: 'task-overdue',
        });
      }
      if (lastInteractionAt <= staleCutoff) {
        pushAction({
          id: `${contact.id}-stale`,
          contactId: contact.id,
          contactName,
          title: 'Re-engage stale contact',
          detail: `No interaction since ${lastInteractionAt.toLocaleDateString()}`,
          severity: 'medium',
          trigger: 'stale-contact',
        });
      }
      if (nextDueTaskAt && nextDueTaskAt <= soon) {
        pushAction({
          id: `${contact.id}-task`,
          contactId: contact.id,
          contactName,
          title: 'Task due soon',
          detail: `Next task due ${nextDueTaskAt.toLocaleDateString()}`,
          severity: 'medium',
          trigger: 'upcoming-task',
        });
      }
      if (actions.length >= 6) break;
    }

    return actions;
  }

  async dueTasks(input: { businessId: string; windowDays?: number }) {
    const windowDays = input.windowDays ?? 7;
    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + windowDays);
    return this.prisma.client.contactTask.findMany({
        where: {
          businessId: input.businessId,
          status: { not: 'DONE' },
          OR: [
            { dueDate: { lte: now } },
            { dueDate: { lte: soon } },
            { remindAt: { lte: soon } },
          ],
        },
      orderBy: { dueDate: 'asc' },
      include: { contact: true },
      take: 50,
    });
  }
}

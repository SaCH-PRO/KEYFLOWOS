import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AutomationService } from '../automation/automation.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AutomationService)) private readonly automation: AutomationService,
  ) {}

  private normalizeEmail(email?: string | null) {
    return email ? email.trim().toLowerCase() : null;
  }

  private normalizePhone(phone?: string | null) {
    return phone ? phone.replace(/[^0-9+]/g, '') : null;
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

  listContacts(input: {
    businessId: string;
    status?: string;
    search?: string;
    hasUnpaidInvoices?: boolean;
    hasUpcomingBookings?: boolean;
    staleDays?: number;
    newThisWeek?: boolean;
    tags?: string[];
    skip?: number;
    take?: number;
    includeStats?: boolean;
  }) {
    const where: any = { businessId: input.businessId, deletedAt: null };
    if (input.status) where.status = input.status;
    if (input.search) {
      where.OR = [
        { firstName: { contains: input.search, mode: 'insensitive' } },
        { lastName: { contains: input.search, mode: 'insensitive' } },
        { email: { contains: input.search, mode: 'insensitive' } },
        { phone: { contains: input.search, mode: 'insensitive' } },
      ];
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

    const skip = input.skip ?? 0;
    const take = input.take ?? 50;
    return this.prisma.client.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }).then(async (contacts) => {
      if (!input.includeStats || contacts.length === 0) return contacts;
      const ids = contacts.map((c) => c.id);
      const [invoices, tasks, events, notes, bookings] = await Promise.all([
        this.prisma.client.invoice.findMany({
          where: { businessId: input.businessId, contactId: { in: ids }, deletedAt: null },
          select: { id: true, contactId: true, status: true, total: true, currency: true, dueDate: true, paidAt: true },
        }),
        this.prisma.client.contactTask.findMany({
          where: { businessId: input.businessId, contactId: { in: ids }, deletedAt: null },
          select: { contactId: true, status: true, dueDate: true, createdAt: true },
        }),
        this.prisma.client.contactEvent.findMany({
          where: { businessId: input.businessId, contactId: { in: ids } },
          select: { contactId: true, createdAt: true },
        }),
        this.prisma.client.contactNote.findMany({
          where: { businessId: input.businessId, contactId: { in: ids } },
          select: { contactId: true, createdAt: true },
        }),
        this.prisma.client.booking.findMany({
          where: { businessId: input.businessId, contactId: { in: ids }, deletedAt: null },
          select: { contactId: true, status: true, startTime: true },
        }),
      ]);

      const statsMap = new Map<string, any>();
      for (const c of contacts) {
        statsMap.set(c.id, {
          outstandingBalance: 0,
          unpaidInvoices: 0,
          paidInvoices: 0,
          lastInteractionAt: c.updatedAt,
          nextDueTaskAt: null as Date | null,
          overdueTasks: 0,
          bookingsRecent: 0,
        });
      }

      invoices.forEach((inv) => {
        const s = statsMap.get(inv.contactId);
        if (!s) return;
        if (['SENT', 'OVERDUE'].includes(inv.status)) {
          s.outstandingBalance += Number(inv.total ?? 0);
          s.unpaidInvoices += 1;
        }
        if (inv.status === 'PAID') {
          s.paidInvoices += 1;
        }
      });

      tasks.forEach((task) => {
        const s = statsMap.get(task.contactId);
        if (!s) return;
        if (task.status !== 'DONE' && task.dueDate) {
          const due = new Date(task.dueDate);
          if (!s.nextDueTaskAt || due < s.nextDueTaskAt) s.nextDueTaskAt = due;
          if (due < new Date()) s.overdueTasks += 1;
        }
        if (task.createdAt > s.lastInteractionAt) s.lastInteractionAt = task.createdAt;
      });

      events.forEach((e) => {
        const s = statsMap.get(e.contactId);
        if (s && e.createdAt > s.lastInteractionAt) s.lastInteractionAt = e.createdAt;
      });
      notes.forEach((n) => {
        const s = statsMap.get(n.contactId);
        if (s && n.createdAt > s.lastInteractionAt) s.lastInteractionAt = n.createdAt;
      });
      const recentCutoff = new Date();
      recentCutoff.setDate(recentCutoff.getDate() - 14);
      bookings.forEach((b) => {
        const s = statsMap.get(b.contactId);
        if (!s) return;
        if (b.status === 'COMPLETED' && b.startTime > recentCutoff) s.bookingsRecent += 1;
        if (b.startTime > s.lastInteractionAt) s.lastInteractionAt = b.startTime;
      });

      const withStats = contacts.map((c) => {
        const s = statsMap.get(c.id);
        if (!s) return c;
        const leadScore =
          50 +
          s.bookingsRecent * 15 +
          s.paidInvoices * 10 -
          s.unpaidInvoices * 5 -
          s.overdueTasks * 5 +
          (c.status === 'CLIENT' ? 5 : 0);
        return {
          ...c,
          meta: {
            outstandingBalance: s.outstandingBalance,
            unpaidInvoices: s.unpaidInvoices,
            paidInvoices: s.paidInvoices,
            lastInteractionAt: s.lastInteractionAt,
            nextDueTaskAt: s.nextDueTaskAt,
            overdueTasks: s.overdueTasks,
            bookingsRecent: s.bookingsRecent,
            leadScore,
          },
        };
      });
      return withStats;
    });
  }

  createContact(input: {
    businessId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: string;
    source?: string | null;
    tags?: string[];
    custom?: any;
  }) {
    const emailNormalized = this.normalizeEmail(input.email);
    const phoneNormalized = this.normalizePhone(input.phone);

    return this.prisma.client.contact
      .create({
        data: {
          businessId: input.businessId,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          email: input.email ?? null,
          emailNormalized,
          phone: input.phone ?? null,
          phoneNormalized,
          status: input.status ?? 'LEAD',
          source: input.source ?? null,
          tags: input.tags ?? [],
          custom: input.custom ?? {},
        },
        select: { id: true },
      })
      .then(async (created) => {
        await this.logEvent(input.businessId, created.id, 'contact.created', {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          source: input.source,
        });
        return this.prisma.client.contact.findUnique({ where: { id: created.id } });
      });
  }

  async findOrCreateContact(
    businessId: string,
    input: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null },
  ) {
    const emailNormalized = this.normalizeEmail(input.email);
    const phoneNormalized = this.normalizePhone(input.phone);

    if (input.email) {
      const existing = await this.prisma.client.contact.findFirst({
        where: { businessId, emailNormalized, deletedAt: null },
      });
      if (existing) {
        return existing;
      }
    }
    if (phoneNormalized) {
      const existingByPhone = await this.prisma.client.contact.findFirst({
        where: { businessId, phoneNormalized, deletedAt: null },
      });
      if (existingByPhone) {
        return existingByPhone;
      }
    }
    return this.createContact({ businessId, ...input });
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
    tags?: string[];
    custom?: any;
  }) {
    const existing = await this.assertContact(input.businessId, input.contactId);
    const emailNormalized = this.normalizeEmail(input.email);
    const phoneNormalized = this.normalizePhone(input.phone);
    return this.prisma.client.contact.update({
      where: { id: input.contactId },
      data: {
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
        email: input.email ?? undefined,
        emailNormalized,
        phone: input.phone ?? undefined,
        phoneNormalized,
        status: input.status ?? undefined,
        source: input.source ?? undefined,
        tags: input.tags ?? undefined,
        custom: input.custom ?? undefined,
      },
    }).then(async (updated) => {
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
    });
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
    return this.prisma.client.contact.findUnique({ where: { id: input.primaryId } });
  }

  async contactDetail(params: { businessId: string; contactId: string }) {
    const contact = await this.assertContact(params.businessId, params.contactId);
    const [events, notes, tasks, invoices] = await Promise.all([
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
        select: { status: true, total: true, dueDate: true, paidAt: true, createdAt: true },
      }),
    ]);
    const outstanding = invoices
      .filter((inv) => ['SENT', 'OVERDUE'].includes(inv.status))
      .reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    return { contact, events, notes, tasks, meta: { outstandingBalance: outstanding } };
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

  async dueTasks(input: { businessId: string; windowDays?: number }) {
    const windowDays = input.windowDays ?? 7;
    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + windowDays);
    return this.prisma.client.contactTask.findMany({
      where: {
        businessId: input.businessId,
        status: { not: 'DONE' },
        deletedAt: null,
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

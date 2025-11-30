import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email?: string | null) {
    return email ? email.trim().toLowerCase() : null;
  }

  private normalizePhone(phone?: string | null) {
    return phone ? phone.replace(/[^0-9+]/g, '') : null;
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

    return this.prisma.client.contact.findMany({ where, orderBy: { createdAt: 'desc' } });
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
    await this.assertContact(input.businessId, input.contactId);
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
    const [events, notes, tasks] = await Promise.all([
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
    ]);
    return { contact, events, notes, tasks };
  }

  addNote(input: { businessId: string; contactId: string; body: string }) {
    return this.assertContact(input.businessId, input.contactId).then(async () => {
      const note = await this.prisma.client.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body: input.body,
          source: 'manual',
        },
      });
      await this.logEvent(input.businessId, input.contactId, 'note.created', { noteId: note.id }, { source: 'crm' });
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
  }) {
    return this.assertContact(input.businessId, input.contactId)
      .then(() =>
        this.prisma.client.contactTask.create({
          data: {
            businessId: input.businessId,
            contactId: input.contactId,
            title: input.title,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            priority: input.priority ?? 'NORMAL',
            assigneeId: input.assigneeId ?? null,
            remindAt: input.remindAt ? new Date(input.remindAt) : null,
            source: 'manual',
          },
        }),
      )
      .then(async (task) => {
        await this.logEvent(input.businessId, input.contactId, 'task.created', {
          title: input.title,
          dueDate: input.dueDate,
          priority: input.priority ?? 'NORMAL',
        });
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
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  listContacts(businessId: string) {
    return this.prisma.client.contact.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
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
    return this.prisma.client.contact.create({
      data: {
        businessId: input.businessId,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: input.status ?? 'LEAD',
        source: input.source ?? null,
        tags: input.tags ?? [],
        custom: input.custom ?? {},
      },
    });
  }

  async findOrCreateContact(
    businessId: string,
    input: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null },
  ) {
    if (input.email) {
      const existing = await this.prisma.client.contact.findFirst({
        where: { businessId, email: input.email, deletedAt: null },
      });
      if (existing) {
        return existing;
      }
    }
    return this.createContact({ businessId, ...input });
  }

  async contactDetail(params: { businessId: string; contactId: string }) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: params.contactId, businessId: params.businessId, deletedAt: null },
    });
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
    return this.prisma.client.contactNote.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        body: input.body,
      },
    });
  }

  addTask(input: { businessId: string; contactId: string; title: string; dueDate?: string | null }) {
    return this.prisma.client.contactTask.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        title: input.title,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
  }
}

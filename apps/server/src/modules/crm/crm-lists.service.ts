import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmListsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listContactLists(businessId: string) {
    const lists = await this.prisma.client.contactList.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } } },
    });
    return lists.map((l) => ({
      ...l,
      memberCount: l._count.members,
    }));
  }

  async createContactList(input: {
    businessId: string;
    name: string;
    description?: string;
    color?: string;
    type?: string;
    filters?: any;
    contactIds?: string[];
  }) {
    const list = await this.prisma.client.contactList.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        type: input.type ?? 'MANUAL',
        filters: input.filters ?? null,
      },
    });

    if (input.contactIds && input.contactIds.length > 0) {
      await this.prisma.client.contactListMember.createMany({
        data: input.contactIds.map((contactId) => ({
          listId: list.id,
          contactId,
        })),
        skipDuplicates: true,
      });
    }

    return list;
  }

  async updateContactList(input: {
    businessId: string;
    listId: string;
    name?: string;
    description?: string;
    color?: string;
    type?: string;
    filters?: any;
    contactIds?: string[];
  }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');

    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.color !== undefined) data.color = input.color;
    if (input.type !== undefined) data.type = input.type;
    if (input.filters !== undefined) data.filters = input.filters;

    if (input.contactIds !== undefined) {
      await this.prisma.client.contactListMember.deleteMany({
        where: { listId: input.listId },
      });
      if (input.contactIds.length > 0) {
        await this.prisma.client.contactListMember.createMany({
          data: input.contactIds.map((contactId) => ({
            listId: input.listId,
            contactId,
          })),
          skipDuplicates: true,
        });
      }
    }

    return this.prisma.client.contactList.update({
      where: { id: input.listId },
      data,
    });
  }

  async deleteContactList(input: { businessId: string; listId: string }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');
    return this.prisma.client.contactList.delete({ where: { id: input.listId } });
  }

  async getContactListContacts(input: { businessId: string; listId: string }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');

    if (list.type === 'SMART' && list.filters) {
      const filters = list.filters as Record<string, any>;
      const where: any = { businessId: input.businessId, deletedAt: null };
      if (filters.status && Array.isArray(filters.status) && filters.status.length > 0) {
        where.status = { in: filters.status };
      }
      if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
        where.tags = { hasSome: filters.tags };
      }
      if (filters.source && Array.isArray(filters.source) && filters.source.length > 0) {
        where.source = { in: filters.source };
      }
      if (filters.lifecycleStage && Array.isArray(filters.lifecycleStage) && filters.lifecycleStage.length > 0) {
        where.lifecycleStage = { in: filters.lifecycleStage };
      }
      return this.prisma.client.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    }

    const members = await this.prisma.client.contactListMember.findMany({
      where: { listId: input.listId },
      include: { contact: true },
      orderBy: { addedAt: 'desc' },
    });

    return members
      .filter((m) => m.contact.deletedAt === null && m.contact.businessId === input.businessId)
      .map((m) => m.contact);
  }

  async addContactsToList(input: { businessId: string; listId: string; contactIds: string[] }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');
    if (list.type !== 'MANUAL') throw new BadRequestException('Can only add contacts to MANUAL lists');

    await this.prisma.client.contactListMember.createMany({
      data: input.contactIds.map((contactId) => ({
        listId: input.listId,
        contactId,
      })),
      skipDuplicates: true,
    });

    return this.prisma.client.contactList.findUnique({
      where: { id: input.listId },
      include: { _count: { select: { members: true } } },
    });
  }

  async removeContactFromList(input: { businessId: string; listId: string; contactId: string }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');
    if (list.type !== 'MANUAL') throw new BadRequestException('Can only remove contacts from MANUAL lists');

    await this.prisma.client.contactListMember.deleteMany({
      where: { listId: input.listId, contactId: input.contactId },
    });

    return this.prisma.client.contactList.findUnique({
      where: { id: input.listId },
      include: { _count: { select: { members: true } } },
    });
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmListsService {
  constructor(private readonly prisma: PrismaService) {}

  private async cleanContactListIds(list: { id: string; businessId: string; contactIds: string[] }) {
    if (!list.contactIds || list.contactIds.length === 0) return list;
    const validContacts = await this.prisma.client.contact.findMany({
      where: {
        id: { in: list.contactIds },
        businessId: list.businessId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = new Set(validContacts.map((c) => c.id));
    const cleaned = list.contactIds.filter((id) => validIds.has(id));
    if (cleaned.length !== list.contactIds.length) {
      await this.prisma.client.contactList.update({
        where: { id: list.id },
        data: { contactIds: cleaned },
      }).catch(() => {});
      return { ...list, contactIds: cleaned };
    }
    return list;
  }

  async listContactLists(businessId: string) {
    const lists = await this.prisma.client.contactList.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    const cleaned = await Promise.all(
      lists.map((l) => l.type === 'MANUAL' ? this.cleanContactListIds(l) : l),
    );
    return cleaned;
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
    return this.prisma.client.contactList.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        type: input.type ?? 'MANUAL',
        filters: input.filters ?? null,
        contactIds: input.contactIds ?? [],
      },
    });
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
    if (input.contactIds !== undefined) data.contactIds = input.contactIds;
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
    let list = await this.prisma.client.contactList.findFirst({
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

    list = await this.cleanContactListIds(list) as typeof list;

    if (list.contactIds.length === 0) return [];
    return this.prisma.client.contact.findMany({
      where: {
        id: { in: list.contactIds },
        businessId: input.businessId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addContactsToList(input: { businessId: string; listId: string; contactIds: string[] }) {
    let list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');
    if (list.type !== 'MANUAL') throw new BadRequestException('Can only add contacts to MANUAL lists');
    list = await this.cleanContactListIds(list) as typeof list;
    const merged = Array.from(new Set([...list.contactIds, ...input.contactIds]));
    return this.prisma.client.contactList.update({
      where: { id: input.listId },
      data: { contactIds: merged },
    });
  }

  async removeContactFromList(input: { businessId: string; listId: string; contactId: string }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');
    if (list.type !== 'MANUAL') throw new BadRequestException('Can only remove contacts from MANUAL lists');
    const filtered = list.contactIds.filter((id) => id !== input.contactId);
    return this.prisma.client.contactList.update({
      where: { id: input.listId },
      data: { contactIds: filtered },
    });
  }
}

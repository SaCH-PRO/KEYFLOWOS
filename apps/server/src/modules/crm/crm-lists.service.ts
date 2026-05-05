import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { buildContactWhere, type ContactFilterPrimitives } from './contact-filters.helper';

const SMART_LIST_MAX_RESULTS = 1000;

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
    rules?: any;
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
        rules: input.rules ?? null,
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
    rules?: any;
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
    if (input.rules !== undefined) data.rules = input.rules;

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

  async getContactListContacts(input: { businessId: string; listId: string; limit?: number; offset?: number }) {
    const list = await this.prisma.client.contactList.findFirst({
      where: { id: input.listId, businessId: input.businessId },
    });
    if (!list) throw new NotFoundException('Contact list not found');

    const requestedLimit = Math.max(1, Math.min(input.limit ?? SMART_LIST_MAX_RESULTS, SMART_LIST_MAX_RESULTS));
    const offset = Math.max(0, input.offset ?? 0);

    if (list.type === 'SMART') {
      // Smart segments evaluate `rules` (preferred) or fall back to `filters`
      // for backward compatibility, using the shared filter primitives.
      const source = (list.rules ?? list.filters) as Record<string, unknown> | null;
      if (!source) return { contacts: [], total: 0, truncated: false, limit: SMART_LIST_MAX_RESULTS };

      const where = buildContactWhere(input.businessId, source as ContactFilterPrimitives);

      const minRevenue = typeof source.minRevenue === 'number' ? source.minRevenue : 0;
      if (minRevenue > 0) {
        const highRevContacts = await this.prisma.client.$queryRaw<Array<{ contact_id: string }>>`
          SELECT i.contact_id
          FROM invoices i
          WHERE i.business_id = ${input.businessId}
            AND i.status = 'PAID'
            AND i.deleted_at IS NULL
          GROUP BY i.contact_id
          HAVING SUM(i.total) >= ${minRevenue}
        `;
        const revenueIds = highRevContacts.map((r) => r.contact_id);
        if (revenueIds.length === 0) return { contacts: [], total: 0, truncated: false, limit: SMART_LIST_MAX_RESULTS };
        (where as Prisma.ContactWhereInput).id = { in: revenueIds };
      }

      const [contacts, total] = await Promise.all([
        this.prisma.client.contact.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: requestedLimit,
        }),
        this.prisma.client.contact.count({ where }),
      ]);

      return {
        contacts,
        total,
        truncated: offset + contacts.length < total,
        limit: requestedLimit,
        offset,
      };
    }

    const members = await this.prisma.client.contactListMember.findMany({
      where: { listId: input.listId },
      include: { contact: true },
      orderBy: { addedAt: 'desc' },
    });

    const all = members
      .filter((m) => m.contact.deletedAt === null && m.contact.businessId === input.businessId)
      .map((m) => m.contact);

    const page = all.slice(offset, offset + requestedLimit);
    return {
      contacts: page,
      total: all.length,
      truncated: offset + page.length < all.length,
      limit: requestedLimit,
      offset,
    };
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

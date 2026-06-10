import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ContactCustomFieldValueInput {
  contactId: string;
  definitionId: string;
  value?: unknown | null;
}

@Injectable()
export class ContactCustomFieldValueService {
  constructor(private readonly prisma: PrismaService) {}

  async getValuesForContact(contactId: string) {
    return this.prisma.client.contactCustomFieldValue.findMany({
      where: { contactId },
      include: { definition: true },
    });
  }

  async getValuesForContacts(contactIds: string[]) {
    if (contactIds.length === 0) return [];
    return this.prisma.client.contactCustomFieldValue.findMany({
      where: { contactId: { in: contactIds } },
      include: { definition: true },
    });
  }

  async setValue(input: ContactCustomFieldValueInput) {
    const { contactId, definitionId, value } = input;
    const existing = await this.prisma.client.contactCustomFieldValue.findUnique({
      where: { contactId_definitionId: { contactId, definitionId } },
    });

    if (existing) {
      if (value === null || value === undefined) {
        await this.prisma.client.contactCustomFieldValue.delete({
          where: { id: existing.id },
        });
        return null;
      }
      return this.prisma.client.contactCustomFieldValue.update({
        where: { id: existing.id },
        data: { value: value as any },
      });
    }

    if (value === null || value === undefined) return null;

    return this.prisma.client.contactCustomFieldValue.create({
      data: {
        contactId,
        definitionId,
        value: value as any,
      },
    });
  }

  async setValuesForContact(contactId: string, values: Record<string, unknown>) {
    const definitions = await this.prisma.client.customFieldDefinition.findMany({
      where: { name: { in: Object.keys(values) }, archivedAt: null },
    });

    const results: Array<{ definitionId: string; name: string; value: unknown }> = [];
    for (const [name, value] of Object.entries(values)) {
      const def = definitions.find((d: { name: string }) => d.name === name);
      if (!def) continue;
      await this.setValue({ contactId, definitionId: def.id, value });
      results.push({ definitionId: def.id, name, value });
    }
    return results;
  }

  async deleteValuesForContact(contactId: string) {
    await this.prisma.client.contactCustomFieldValue.deleteMany({
      where: { contactId },
    });
  }

  async copyValues(fromContactId: string, toContactId: string) {
    const values = await this.prisma.client.contactCustomFieldValue.findMany({
      where: { contactId: fromContactId },
    });
    if (values.length === 0) return;

    await this.prisma.client.contactCustomFieldValue.createMany({
      data: values.map((v: { definitionId: string; value: unknown }) => ({
        contactId: toContactId,
        definitionId: v.definitionId,
        value: v.value as any,
      })),
      skipDuplicates: true,
    });
  }
}

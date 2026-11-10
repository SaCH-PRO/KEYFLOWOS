import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereWithId } from './crm.helpers';
import { resolveCrmAccess, visibilityClause } from './crm-permissions.helper';

export interface ContactCustomFieldValueInput {
  contactId: string;
  definitionId: string;
  value?: unknown | null;
}

@Injectable()
export class ContactCustomFieldValueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Values of one contact, read through the path tenant and the actor's CRM
   * visibility. ContactCustomFieldValue carries no businessId, so both are
   * bound through the contact, with the same predicate the contact detail
   * route applies (CrmStatsService.assertContact): the tenant row, ANDed with
   * `visibilityClause(resolveCrmAccess(...))`. A contact of another tenant, or
   * one the actor may not see (another member's PRIVATE contact; another
   * member's TEAM contact for a crm_view=owned member), answers exactly like an
   * absent one (404), before any value is read.
   *
   * Only values whose definition is the contact's own business's are served
   * (SEC-R015c-3 review SF-1, W9-CUSTOM-FIELDS-TENANT): the tenant extension
   * never reaches an `include`d relation, so a row that binds this contact to
   * another business's definition (left by the business-blind name lookup)
   * would otherwise serve that business's label, description and options.
   */
  async getValuesForContact(businessId: string, contactId: string, actorUserId: string) {
    const where: Prisma.ContactWhereInput = { ...contactWhereWithId(businessId, contactId) };
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const visClause = visibilityClause(access, actorUserId);
    if (visClause) {
      where.AND = [visClause];
    }
    const contact = await this.prisma.client.contact.findFirst({
      where,
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    return this.prisma.client.contactCustomFieldValue.findMany({
      where: { contactId, definition: { businessId } },
      include: { definition: true },
    });
  }

  /**
   * Values of several contacts of `businessId`: only rows whose contact and
   * definition are both that business's (SF-1, W9-CUSTOM-FIELDS-TENANT).
   * No visibility check; a caller serving a member applies its own.
   */
  async getValuesForContacts(businessId: string, contactIds: string[]) {
    if (contactIds.length === 0) return [];
    return this.prisma.client.contactCustomFieldValue.findMany({
      where: { contactId: { in: contactIds }, contact: { businessId }, definition: { businessId } },
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

  /**
   * Bind a contact's typed values, keyed by definition NAME, to its own
   * business's live definitions (SEC-R015c-3, W9-CUSTOM-FIELDS-TENANT).
   *
   * A definition name is unique only per business (@@unique([businessId,
   * name])) and ContactCustomFieldValue carries no businessId, so a lookup by
   * name alone bound a contact of A to B's definition (a name only B defines,
   * a name both define, or a name A archived while B's is live), and A's
   * contact detail then served B's label, description and options. The
   * business is the one on the contact row, whoever the caller is; a name the
   * contact's business does not define (live) binds nothing.
   *
   * Through HTTP the ambient tenant (TenantInterceptor, CustomFieldDefinition
   * in BUSINESS_ID_MODELS) already scoped this lookup to the path business, so
   * this scoping is defence in depth for a caller with no ambient tenant
   * (review CR-W9CF-1). Rows bound to another business's definition that such
   * a caller, or HTTP before the tenant provider was installed, already wrote
   * cannot be addressed by name any more, so every write here first removes
   * them from this contact (review SF-1).
   */
  async setValuesForContact(contactId: string, values: Record<string, unknown>) {
    const names = Object.keys(values);
    if (names.length === 0) return [];
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId },
      select: { businessId: true },
    });
    if (!contact) return [];
    await this.prisma.client.contactCustomFieldValue.deleteMany({
      where: { contactId, definition: { businessId: { not: contact.businessId } } },
    });
    const definitions = await this.prisma.client.customFieldDefinition.findMany({
      where: { businessId: contact.businessId, name: { in: names }, archivedAt: null },
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

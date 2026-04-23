import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LeadFormCreatedPayload, LeadFormSubmittedPayload } from '../../core/event-bus/events.types';

@Injectable()
export class LeadFormsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async listForms(businessId: string) {
    return this.prisma.client.leadForm.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { submissions: true } },
      },
    });
  }

  async getForm(businessId: string, id: string) {
    return this.prisma.client.leadForm.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        submissions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  async createForm(input: {
    businessId: string;
    name: string;
    description?: string;
    fields: any;
    settings?: any;
  }) {
    const form = await this.prisma.client.leadForm.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        fields: input.fields,
        settings: input.settings ?? null,
      },
    });
    this.events.emit('lead_form.created', { form, businessId: input.businessId } as LeadFormCreatedPayload);
    return form;
  }

  async updateForm(input: {
    businessId: string;
    id: string;
    name?: string;
    description?: string;
    fields?: any;
    settings?: any;
  }) {
    return this.prisma.client.leadForm.update({
      where: { id: input.id, businessId: input.businessId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.fields !== undefined && { fields: input.fields }),
        ...(input.settings !== undefined && { settings: input.settings }),
      },
    });
  }

  async deleteForm(businessId: string, id: string) {
    return this.prisma.client.leadForm.update({
      where: { id, businessId },
      data: { deletedAt: new Date() },
    });
  }

  async toggleActive(businessId: string, id: string) {
    const form = await this.prisma.client.leadForm.findFirst({
      where: { id, businessId, deletedAt: null },
    });

    if (!form) {
      throw new NotFoundException('Form not found');
    }

    return this.prisma.client.leadForm.update({
      where: { id, businessId },
      data: { isActive: !form.isActive },
    });
  }

  async submitForm(formId: string, data: Record<string, any>, source?: string, ipAddress?: string) {
    const form = await this.prisma.client.leadForm.findFirst({
      where: { id: formId, deletedAt: null, isActive: true },
    });

    if (!form) {
      throw new NotFoundException('Form not found or inactive');
    }

    const fields = form.fields as any[];
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (field.required && !data[field.name]) {
          throw new BadRequestException(`Field "${field.label || field.name}" is required`);
        }
      }
    }

    const email = data.email || data.Email;
    const firstName = data.firstName || data.first_name || data.name || data.Name;
    const lastName = data.lastName || data.last_name;
    const phone = data.phone || data.Phone;

    const result = await this.prisma.client.$transaction(async (tx) => {
      let contactId: string | null = null;

      if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        try {
          const existing = await tx.contact.findFirst({
            where: { businessId: form.businessId, emailNormalized: normalizedEmail, deletedAt: null },
          });

          if (existing) {
            contactId = existing.id;
          } else {
            const contact = await tx.contact.create({
              data: {
                businessId: form.businessId,
                email,
                emailNormalized: normalizedEmail,
                firstName: firstName ?? null,
                lastName: lastName ?? null,
                phone: phone ?? null,
                source: 'LEAD_FORM',
                sourceDetail: form.name,
                status: 'LEAD',
              },
            });
            contactId = contact.id;
          }
        } catch (err: any) {
          if (err?.code === 'P2002') {
            const existing = await tx.contact.findFirst({
              where: { businessId: form.businessId, emailNormalized: email.toLowerCase().trim(), deletedAt: null },
            });
            contactId = existing?.id ?? null;
          } else {
            throw err;
          }
        }
      }

      const submission = await tx.leadFormSubmission.create({
        data: {
          formId,
          businessId: form.businessId,
          data,
          contactId,
          source: source ?? 'web',
          ipAddress: ipAddress ?? null,
        },
      });

      return { submission, contactId };
    });

    this.events.emit('lead_form.submitted', { submission: result.submission, form, businessId: form.businessId, contactId: result.contactId } as LeadFormSubmittedPayload);

    const settings = form.settings as any;
    return {
      success: true,
      message: settings?.thankYouMessage ?? 'Thank you for your submission!',
      redirectUrl: settings?.redirectUrl ?? null,
    };
  }

  async listSubmissions(businessId: string, formId: string) {
    return this.prisma.client.leadFormSubmission.findMany({
      where: { businessId, formId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

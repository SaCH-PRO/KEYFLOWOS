import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmService } from '../crm/crm.service';
import { PublicEventsService } from '../public-events/public-events.service';

@Injectable()
export class IntakeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
  ) {}

  async submitIntake(slug: string, input: {
    name: string;
    email: string;
    phone?: string;
    category: string;
    description: string;
    budget?: string;
    urgency?: string;
    visitorId?: string | null;
    referralCode?: string | null;
  }) {
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    if (!input.email?.trim()) throw new BadRequestException('Email is required');
    if (!input.category?.trim()) throw new BadRequestException('Category is required');
    if (!input.description?.trim()) throw new BadRequestException('Description is required');
    if (input.name.length > 200) throw new BadRequestException('Name too long');
    if (input.email.length > 320) throw new BadRequestException('Email too long');
    if (input.description.length > 5000) throw new BadRequestException('Description too long');

    let business = await this.prisma.client.business.findFirst({
      where: { slug },
      select: { id: true, name: true },
    });
    if (!business) {
      business = await this.prisma.client.business.findFirst({
        where: { id: slug },
        select: { id: true, name: true },
      });
    }

    if (!business) throw new NotFoundException('Store not found');

    const submission = await this.prisma.client.intakeSubmission.create({
      data: {
        businessId: business.id,
        name: input.name.trim().slice(0, 200),
        email: input.email.trim().toLowerCase().slice(0, 320),
        phone: input.phone?.trim().slice(0, 50) || null,
        category: input.category.trim().slice(0, 100),
        description: input.description.trim().slice(0, 5000),
        budget: input.budget?.trim().slice(0, 100) || null,
        urgency: input.urgency || 'normal',
        status: 'new',
      },
    });

    try {
      await this.notifications.create({
        businessId: business.id,
        type: 'intake_submission',
        title: `New intake request from ${input.name.trim()}`,
        body: `Category: ${input.category} — "${input.description.trim().slice(0, 120)}${input.description.length > 120 ? '…' : ''}"`,
        data: {
          submissionId: submission.id,
          name: input.name.trim(),
          email: input.email.trim(),
          category: input.category,
          urgency: input.urgency || 'normal',
        },
      });
    } catch {
    }

    try {
      const nameParts = input.name.trim().split(/\s+/);
      // Route through upsertStorefrontContact so first-touch attribution
      // (firstSource / utmMedium / utmCampaign / firstReferrer / firstLandingPath)
      // recorded against the visitor cookie lands on the new Contact's
      // custom fields. Falls back to a basic findOrCreateContact when no
      // visitorId is available.
      const contact = input.visitorId
        ? await this.publicEvents.upsertStorefrontContact({
            businessId: business.id,
            sourceDetail: `intake:${slug}`,
            referralCode: input.referralCode ?? null,
            visitorId: input.visitorId,
            identity: {
              firstName: nameParts[0] ?? null,
              lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
              email: input.email,
              phone: input.phone ?? null,
            },
          })
        : await this.crm.findOrCreateContact(business.id, {
            firstName: nameParts[0] ?? null,
            lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
            email: input.email,
            phone: input.phone ?? null,
            source: 'storefront',
            sourceDetail: `intake:${slug}`,
            ...(input.referralCode ? { custom: { referralCode: input.referralCode } } : {}),
          });

      if (contact?.id) {
        if (input.visitorId) {
          await this.publicEvents.backstitchVisitor({
            businessId: business.id,
            visitorId: input.visitorId,
            contactId: contact.id,
            sourceDetail: `intake:${slug}`,
          }).catch(() => undefined);
        }
        await this.publicEvents.logStorefrontEvent({
          businessId: business.id,
          contactId: contact.id,
          type: 'lead_form.submitted',
          sourceDetail: `intake:${slug}`,
          data: {
            submissionId: submission.id,
            category: input.category,
            urgency: input.urgency || 'normal',
            referralCode: input.referralCode ?? null,
          },
        });
      }
    } catch {
      // Public-flow CRM hook is best-effort; intake submission must still succeed.
    }

    return { id: submission.id, message: 'Request submitted successfully' };
  }

  async listForBusiness(businessId: string, opts?: {
    status?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { businessId };
    if (opts?.status) where.status = opts.status;
    if (opts?.category) where.category = opts.category;

    const [items, total] = await Promise.all([
      this.prisma.client.intakeSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts?.limit ?? 50,
        skip: opts?.offset ?? 0,
      }),
      this.prisma.client.intakeSubmission.count({ where }),
    ]);

    return { items, total };
  }

  async updateStatus(id: string, businessId: string, status: string, notes?: string) {
    const validStatuses = ['new', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    return this.prisma.client.intakeSubmission.updateMany({
      where: { id, businessId },
      data: { status, ...(notes !== undefined ? { notes } : {}) },
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NetworkActivityService } from './network-activity.service';

const businessSelect = {
  id: true, name: true, logoUrl: true, headline: true, industry: true,
  acceptingWork: true, currentCapacity: true, slug: true, city: true, country: true,
};

@Injectable()
export class OpportunityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(NetworkActivityService) private readonly activity: NetworkActivityService,
  ) {}

  async create(posterBusinessId: string, input: {
    type?: string;
    title: string;
    description: string;
    category?: string;
    skillsRequired?: string[];
    budgetMin?: number;
    budgetMax?: number;
    currency?: string;
    timeline?: string;
    location?: string;
    remoteOk?: boolean;
    attachments?: string[];
    expiresAt?: string;
  }) {
    const opp = await this.prisma.client.opportunity.create({
      data: {
        posterBusinessId,
        type: input.type ?? 'PROJECT',
        title: input.title,
        description: input.description,
        category: input.category ?? null,
        skillsRequired: input.skillsRequired ?? [],
        budgetMin: input.budgetMin ?? null,
        budgetMax: input.budgetMax ?? null,
        currency: input.currency ?? 'TTD',
        timeline: input.timeline ?? null,
        location: input.location ?? null,
        remoteOk: input.remoteOk ?? true,
        attachments: input.attachments ?? [],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
      include: { poster: { select: businessSelect } },
    });

    await this.activity.log({
      actorBusinessId: posterBusinessId,
      type: 'OPPORTUNITY_POSTED',
      refType: 'opportunity',
      refId: opp.id,
      title: `New opportunity: ${opp.title}`,
      body: opp.description.slice(0, 240),
      metadata: { type: opp.type, budgetMin: opp.budgetMin, budgetMax: opp.budgetMax, currency: opp.currency },
    }).catch(() => {});

    return opp;
  }

  async list(filters?: {
    type?: string;
    status?: string;
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const where: any = { deletedAt: null };
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;
    else where.status = { in: ['OPEN', 'IN_REVIEW'] };
    if (filters?.category) where.category = filters.category;
    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.client.opportunity.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          poster: { select: businessSelect },
          _count: { select: { applications: true } },
        },
        skip,
        take: limit,
      }),
      this.prisma.client.opportunity.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getById(opportunityId: string, requesterBusinessIds: string[] = []) {
    const opp = await this.prisma.client.opportunity.findFirst({
      where: { id: opportunityId, deletedAt: null },
      include: {
        poster: { select: businessSelect },
      },
    });
    if (!opp) return null;

    const isPoster = requesterBusinessIds.includes(opp.posterBusinessId);

    let applications: any[] = [];
    let myApplication: any = null;
    let applicationCount = 0;

    if (isPoster) {
      applications = await this.prisma.client.opportunityApplication.findMany({
        where: { opportunityId },
        include: { applicant: { select: businessSelect } },
        orderBy: { createdAt: 'desc' },
      });
      applicationCount = applications.length;
    } else {
      applicationCount = await this.prisma.client.opportunityApplication.count({
        where: { opportunityId },
      });
      if (requesterBusinessIds.length > 0) {
        myApplication = await this.prisma.client.opportunityApplication.findFirst({
          where: { opportunityId, applicantBusinessId: { in: requesterBusinessIds } },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    return {
      ...opp,
      applications,
      myApplication,
      _count: { applications: applicationCount },
      viewerIsPoster: isPoster,
    };
  }

  async listMine(businessId: string) {
    return this.prisma.client.opportunity.findMany({
      where: { posterBusinessId: businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { applications: true } },
      },
    });
  }

  async update(businessId: string, opportunityId: string, input: any) {
    const opp = await this.prisma.client.opportunity.findFirst({
      where: { id: opportunityId, posterBusinessId: businessId, deletedAt: null },
    });
    if (!opp) return { error: 'Opportunity not found' };

    return this.prisma.client.opportunity.update({
      where: { id: opportunityId },
      data: {
        title: input.title ?? undefined,
        description: input.description ?? undefined,
        status: input.status ?? undefined,
        category: input.category ?? undefined,
        skillsRequired: input.skillsRequired ?? undefined,
        budgetMin: input.budgetMin ?? undefined,
        budgetMax: input.budgetMax ?? undefined,
        timeline: input.timeline ?? undefined,
        location: input.location ?? undefined,
        remoteOk: input.remoteOk ?? undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      },
    });
  }

  async close(businessId: string, opportunityId: string) {
    const opp = await this.prisma.client.opportunity.findFirst({
      where: { id: opportunityId, posterBusinessId: businessId, deletedAt: null },
    });
    if (!opp) return { error: 'Opportunity not found' };
    return this.prisma.client.opportunity.update({
      where: { id: opportunityId },
      data: { status: 'CLOSED' },
    });
  }

  async delete(businessId: string, opportunityId: string) {
    const opp = await this.prisma.client.opportunity.findFirst({
      where: { id: opportunityId, posterBusinessId: businessId, deletedAt: null },
    });
    if (!opp) return { error: 'Opportunity not found' };
    return this.prisma.client.opportunity.update({
      where: { id: opportunityId },
      data: { deletedAt: new Date(), status: 'CLOSED' },
    });
  }

  // ---------------- APPLICATIONS ----------------

  async apply(applicantBusinessId: string, opportunityId: string, input: {
    message: string;
    proposedBudget?: number;
    proposedTimeline?: string;
    attachments?: string[];
  }) {
    const opp = await this.prisma.client.opportunity.findFirst({
      where: { id: opportunityId, deletedAt: null },
      include: { poster: { select: { id: true, name: true } } },
    });
    if (!opp) return { error: 'Opportunity not found' };
    if (opp.posterBusinessId === applicantBusinessId) {
      return { error: 'Cannot apply to your own opportunity' };
    }
    if (opp.status !== 'OPEN' && opp.status !== 'IN_REVIEW') {
      return { error: 'Opportunity is no longer accepting applications' };
    }

    const existing = await this.prisma.client.opportunityApplication.findUnique({
      where: { opportunityId_applicantBusinessId: { opportunityId, applicantBusinessId } },
    });
    if (existing) return { error: 'You have already applied to this opportunity' };

    const application = await this.prisma.client.opportunityApplication.create({
      data: {
        opportunityId,
        applicantBusinessId,
        message: input.message,
        proposedBudget: input.proposedBudget ?? null,
        proposedTimeline: input.proposedTimeline ?? null,
        attachments: input.attachments ?? [],
      },
      include: {
        applicant: { select: businessSelect },
        opportunity: { select: { id: true, title: true, posterBusinessId: true } },
      },
    });

    await this.notifications.create({
      businessId: opp.posterBusinessId,
      type: 'community_opportunity_application',
      title: 'New application',
      body: `${application.applicant.name} applied to "${opp.title}"`,
      data: { opportunityId, applicationId: application.id, applicantBusinessId },
    }).catch(() => {});

    return application;
  }

  async listMyApplications(applicantBusinessId: string) {
    return this.prisma.client.opportunityApplication.findMany({
      where: { applicantBusinessId },
      orderBy: { createdAt: 'desc' },
      include: {
        opportunity: {
          include: { poster: { select: businessSelect } },
        },
      },
    });
  }

  async respondToApplication(businessId: string, applicationId: string, input: {
    status: 'SHORTLISTED' | 'AWARDED' | 'DECLINED';
    responseNote?: string;
  }) {
    const application = await this.prisma.client.opportunityApplication.findUnique({
      where: { id: applicationId },
      include: {
        opportunity: true,
        applicant: { select: businessSelect },
      },
    });
    if (!application || application.opportunity.posterBusinessId !== businessId) {
      return { error: 'Application not found' };
    }

    const updated = await this.prisma.client.opportunityApplication.update({
      where: { id: applicationId },
      data: {
        status: input.status,
        responseNote: input.responseNote ?? null,
        respondedAt: new Date(),
      },
    });

    if (input.status === 'AWARDED') {
      await this.prisma.client.opportunity.update({
        where: { id: application.opportunityId },
        data: { status: 'AWARDED', awardedToBusinessId: application.applicantBusinessId },
      });

      await this.activity.log({
        actorBusinessId: businessId,
        type: 'OPPORTUNITY_AWARDED',
        refType: 'opportunity',
        refId: application.opportunityId,
        title: `Opportunity awarded: ${application.opportunity.title}`,
        body: `Awarded to ${application.applicant.name}`,
        metadata: { awardedTo: application.applicantBusinessId },
      }).catch(() => {});
    }

    await this.notifications.create({
      businessId: application.applicantBusinessId,
      type: 'community_opportunity_response',
      title: `Application ${input.status.toLowerCase()}`,
      body: `Your application for "${application.opportunity.title}" was ${input.status.toLowerCase()}.`,
      data: { opportunityId: application.opportunityId, applicationId, status: input.status },
    }).catch(() => {});

    return updated;
  }

  async withdrawApplication(applicantBusinessId: string, applicationId: string) {
    const application = await this.prisma.client.opportunityApplication.findFirst({
      where: { id: applicationId, applicantBusinessId },
    });
    if (!application) return { error: 'Application not found' };
    return this.prisma.client.opportunityApplication.update({
      where: { id: applicationId },
      data: { status: 'WITHDRAWN', respondedAt: new Date() },
    });
  }
}

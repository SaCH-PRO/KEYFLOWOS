import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from './reputation.service';
import { NetworkActivityService } from './network-activity.service';

const businessSelect = {
  id: true, name: true, logoUrl: true, headline: true, industry: true, slug: true,
};

@Injectable()
export class PartnerProgramService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ReputationService) private readonly reputation: ReputationService,
    @Inject(NetworkActivityService) private readonly activity: NetworkActivityService,
  ) {}

  async propose(initiatorBusinessId: string, input: {
    partnerBusinessId: string;
    programType?: string;
    name: string;
    description: string;
    terms?: any;
    commissionRate?: number;
    startDate?: string;
    endDate?: string;
    visibility?: 'PUBLIC' | 'PRIVATE';
  }) {
    if (initiatorBusinessId === input.partnerBusinessId) {
      return { error: 'Cannot partner with yourself' };
    }

    const program = await this.prisma.client.partnerProgram.create({
      data: {
        initiatorBusinessId,
        partnerBusinessId: input.partnerBusinessId,
        programType: input.programType ?? 'REFERRAL',
        name: input.name,
        description: input.description,
        terms: input.terms ?? undefined,
        commissionRate: input.commissionRate ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        visibility: input.visibility ?? 'PUBLIC',
      },
      include: {
        initiator: { select: businessSelect },
        partner: { select: businessSelect },
      },
    });

    await this.notifications.create({
      businessId: input.partnerBusinessId,
      type: 'community_partner_program_proposal',
      title: 'New partner program proposal',
      body: `${program.initiator.name} proposed a ${program.programType.toLowerCase()} partnership: "${program.name}"`,
      data: { programId: program.id, initiatorBusinessId },
    }).catch(() => {});

    return program;
  }

  async respond(businessId: string, programId: string, input: {
    status: 'ACTIVE' | 'DECLINED';
    responseNote?: string;
  }) {
    const program = await this.prisma.client.partnerProgram.findFirst({
      where: { id: programId, partnerBusinessId: businessId },
      include: { initiator: { select: businessSelect }, partner: { select: businessSelect } },
    });
    if (!program) return { error: 'Partner program not found' };

    const updated = await this.prisma.client.partnerProgram.update({
      where: { id: programId },
      data: {
        status: input.status,
        responseNote: input.responseNote ?? null,
        acceptedAt: input.status === 'ACTIVE' ? new Date() : null,
      },
    });

    if (input.status === 'ACTIVE') {
      await this.activity.log({
        actorBusinessId: program.initiatorBusinessId,
        type: 'PARTNERSHIP_FORMED',
        refType: 'partner_program',
        refId: program.id,
        title: `New partnership: ${program.name}`,
        body: `${program.initiator.name} ↔ ${program.partner.name}`,
        metadata: {
          programType: program.programType,
          partnerBusinessId: program.partnerBusinessId,
          initiatorBusinessId: program.initiatorBusinessId,
        },
      }).catch(() => {});

      await Promise.all([
        this.reputation.recalculate(program.initiatorBusinessId).catch(() => {}),
        this.reputation.recalculate(program.partnerBusinessId).catch(() => {}),
      ]);
    }

    await this.notifications.create({
      businessId: program.initiatorBusinessId,
      type: 'community_partner_program_response',
      title: `Partnership ${input.status === 'ACTIVE' ? 'accepted' : 'declined'}`,
      body: `${program.partner.name} ${input.status === 'ACTIVE' ? 'accepted' : 'declined'} your "${program.name}" proposal.`,
      data: { programId },
    }).catch(() => {});

    return updated;
  }

  async terminate(businessId: string, programId: string, note?: string) {
    const program = await this.prisma.client.partnerProgram.findFirst({
      where: {
        id: programId,
        OR: [{ initiatorBusinessId: businessId }, { partnerBusinessId: businessId }],
      },
    });
    if (!program) return { error: 'Partner program not found' };

    return this.prisma.client.partnerProgram.update({
      where: { id: programId },
      data: { status: 'ENDED', endedAt: new Date(), responseNote: note ?? program.responseNote },
    });
  }

  async listForBusiness(businessId: string, filter?: { status?: string }) {
    const where: any = {
      OR: [{ initiatorBusinessId: businessId }, { partnerBusinessId: businessId }],
    };
    if (filter?.status) where.status = filter.status;
    return this.prisma.client.partnerProgram.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        initiator: { select: businessSelect },
        partner: { select: businessSelect },
      },
    });
  }

  async listPublicForProfile(businessId: string) {
    return this.prisma.client.partnerProgram.findMany({
      where: {
        visibility: 'PUBLIC',
        status: 'ACTIVE',
        OR: [{ initiatorBusinessId: businessId }, { partnerBusinessId: businessId }],
      },
      orderBy: { acceptedAt: 'desc' },
      include: {
        initiator: { select: businessSelect },
        partner: { select: businessSelect },
      },
    });
  }

  async getById(programId: string) {
    return this.prisma.client.partnerProgram.findUnique({
      where: { id: programId },
      include: {
        initiator: { select: businessSelect },
        partner: { select: businessSelect },
      },
    });
  }

  async countActiveForBusiness(businessId: string) {
    return this.prisma.client.partnerProgram.count({
      where: {
        status: 'ACTIVE',
        OR: [{ initiatorBusinessId: businessId }, { partnerBusinessId: businessId }],
      },
    });
  }
}

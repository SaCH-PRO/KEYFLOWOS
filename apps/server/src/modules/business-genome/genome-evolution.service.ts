import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { DNA_SECTION_KEYS, type DnaSectionKey } from '../blueprint/blueprint.types';
import type {
  GenomeEvolutionProposalData,
  GenomeEvolutionProposalInput,
  GenomeEvolutionProposalStatus,
} from './genome-evolution.types';

function isDnaSectionKey(value: string): value is DnaSectionKey {
  return (DNA_SECTION_KEYS as string[]).includes(value);
}

function asStringArray(raw: Prisma.JsonValue | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  return [];
}

function asRecord(raw: Prisma.JsonValue | undefined): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function asNumber(raw: Prisma.JsonValue | undefined): number {
  if (typeof raw === 'number') return raw;
  return 0;
}

@Injectable()
export class GenomeEvolutionService {
  private readonly logger = new Logger(GenomeEvolutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
  ) {}

  async list(
    businessId: string,
    filters: { status?: string; section?: string } = {},
  ): Promise<GenomeEvolutionProposalData[]> {
    const where: Record<string, unknown> = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.section) where.section = filters.section;

    const rows = await this.prisma.client.genomeEvolutionProposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.serialize(row));
  }

  async create(
    businessId: string,
    input: GenomeEvolutionProposalInput,
  ): Promise<GenomeEvolutionProposalData> {
    const row = await this.prisma.client.genomeEvolutionProposal.create({
      data: {
        businessId,
        section: input.section,
        proposedPatch: input.proposedPatch as Prisma.InputJsonValue,
        reason: input.reason,
        evidence: (input.evidence ?? []) as Prisma.InputJsonValue,
        confidence: input.confidence ?? 0.5,
        createdBy: input.createdBy ?? null,
        sourceEventIds: input.sourceEventIds ?? [],
        status: 'PENDING',
      },
    });

    return this.serialize(row);
  }

  async generateFromTemporalFlow(
    businessId: string,
    createdBy?: string,
  ): Promise<GenomeEvolutionProposalData[]> {
    const candidates = await this.temporal.findGenomeSignals(businessId);
    if (!candidates.length) return [];

    const existingPending = await this.prisma.client.genomeEvolutionProposal.findMany({
      where: { businessId, status: 'PENDING' },
      select: { section: true },
    });
    const pendingSections = new Set(existingPending.map((p) => p.section));

    const created: GenomeEvolutionProposalData[] = [];
    for (const candidate of candidates) {
      if (!isDnaSectionKey(candidate.section)) continue;
      if (pendingSections.has(candidate.section)) continue;

      const proposal = await this.create(businessId, {
        section: candidate.section,
        proposedPatch: this.buildPatchForSection(candidate.section, candidate.evidence),
        reason: candidate.reason,
        evidence: candidate.evidence,
        confidence: 0.6,
        createdBy: createdBy ?? 'KEY',
      });
      created.push(proposal);
      pendingSections.add(candidate.section);
    }

    return created;
  }

  async approve(
    businessId: string,
    proposalId: string,
    approvedBy?: string,
  ): Promise<{ proposal: GenomeEvolutionProposalData; genome: Awaited<ReturnType<BlueprintService['calculateGenomeIntegrity']>> }> {
    const proposal = await this.findOrThrow(businessId, proposalId);

    if (proposal.status === 'APPROVED') {
      throw new BadRequestException('Proposal is already approved');
    }
    if (proposal.status === 'REJECTED') {
      throw new BadRequestException('Cannot approve a rejected proposal');
    }

    await this.blueprint.updateDnaSection(businessId, proposal.section, proposal.proposedPatch);
    const genome = await this.blueprint.calculateGenomeIntegrity(businessId);

    const updated = await this.prisma.client.genomeEvolutionProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPROVED',
        approvedBy: approvedBy ?? null,
        approvedAt: new Date(),
        rejectedAt: null,
      },
    });

    this.emitDecisionEvent(businessId, updated, 'genome_evolution.proposal_approved', 'Genome evolution proposal approved');

    return { proposal: this.serialize(updated), genome };
  }

  async reject(
    businessId: string,
    proposalId: string,
    rejectedBy?: string,
  ): Promise<GenomeEvolutionProposalData> {
    const proposal = await this.findOrThrow(businessId, proposalId);

    if (proposal.status === 'APPROVED') {
      throw new BadRequestException('Cannot reject an approved proposal');
    }
    if (proposal.status === 'REJECTED') {
      throw new BadRequestException('Proposal is already rejected');
    }

    const updated = await this.prisma.client.genomeEvolutionProposal.update({
      where: { id: proposalId },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
      },
    });

    this.emitDecisionEvent(businessId, updated, 'genome_evolution.proposal_rejected', 'Genome evolution proposal rejected');

    return this.serialize(updated);
  }

  async edit(
    businessId: string,
    proposalId: string,
    dto: Partial<GenomeEvolutionProposalInput>,
  ): Promise<GenomeEvolutionProposalData> {
    const proposal = await this.findOrThrow(businessId, proposalId);

    if (proposal.status === 'APPROVED' || proposal.status === 'REJECTED') {
      throw new BadRequestException('Cannot edit a finalized proposal');
    }

    const updateData: Prisma.GenomeEvolutionProposalUpdateInput = {
      status: 'EDITED',
    };
    if (dto.proposedPatch !== undefined) {
      updateData.proposedPatch = dto.proposedPatch as Prisma.InputJsonValue;
    }
    if (dto.reason !== undefined) updateData.reason = dto.reason;
    if (dto.evidence !== undefined) updateData.evidence = dto.evidence as Prisma.InputJsonValue;
    if (dto.confidence !== undefined) updateData.confidence = dto.confidence;

    const updated = await this.prisma.client.genomeEvolutionProposal.update({
      where: { id: proposalId },
      data: updateData,
    });

    this.emitDecisionEvent(businessId, updated, 'genome_evolution.proposal_edited', 'Genome evolution proposal edited');

    return this.serialize(updated);
  }

  private async findOrThrow(
    businessId: string,
    proposalId: string,
  ): Promise<GenomeEvolutionProposalData> {
    const row = await this.prisma.client.genomeEvolutionProposal.findFirst({
      where: { id: proposalId, businessId },
    });
    if (!row) throw new NotFoundException('Genome evolution proposal not found');
    return this.serialize(row);
  }

  private emitDecisionEvent(
    businessId: string,
    row: {
      id: string;
      section: string;
      status: string;
      reason: string;
      proposedPatch: Prisma.JsonValue;
    },
    type: string,
    title: string,
  ) {
    this.temporal
      .emit({
        businessId,
        source: 'KEY',
        type,
        module: 'business-genome',
        entityType: 'genome_evolution_proposal',
        entityId: row.id,
        title,
        summary: `${row.section} proposal ${row.status.toLowerCase()}: ${row.reason}`,
        importance: 'HIGH',
        genomeImpactPotential: true,
        payload: {
          proposalId: row.id,
          section: row.section,
          status: row.status,
          proposedPatch: asRecord(row.proposedPatch),
        },
      })
      .catch((err) => this.logger.warn(`Temporal emit failed: ${(err as Error).message}`));
  }

  private buildPatchForSection(section: DnaSectionKey, evidence: string[]): Record<string, unknown> {
    switch (section) {
      case 'marketing':
        return {
          channels: ['WhatsApp'],
        };
      case 'operations':
        return {
          coreWorkflows: ['appointment-booking'],
        };
      case 'sales':
        return {
          salesChannels: ['direct-invoice'],
        };
      case 'risk':
        return {
          operationalRisks: ['Asset expiry reminders detected'],
        };
      default:
        return {};
    }
  }

  private serialize(row: {
    id: string;
    businessId: string;
    section: string;
    proposedPatch: Prisma.JsonValue;
    reason: string;
    evidence: Prisma.JsonValue;
    confidence: number | null;
    status: string;
    createdBy: string | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    sourceEventIds: string[];
    createdAt: Date;
    updatedAt: Date;
  }): GenomeEvolutionProposalData {
    return {
      id: row.id,
      businessId: row.businessId,
      section: row.section as DnaSectionKey,
      proposedPatch: asRecord(row.proposedPatch),
      reason: row.reason,
      evidence: asStringArray(row.evidence),
      confidence: row.confidence ?? 0,
      status: row.status as GenomeEvolutionProposalStatus,
      createdBy: row.createdBy ?? null,
      approvedBy: row.approvedBy ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      sourceEventIds: row.sourceEventIds,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

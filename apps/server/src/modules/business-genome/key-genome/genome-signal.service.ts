import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeFactService } from './genome-fact.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import type {
  CreateGenomeSignalInput,
  GenomeEvidenceData,
  GenomeSignalData,
  ListGenomeSignalsQuery,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function evidenceFromRow(rowEvidence: unknown, businessId: string, createdAt: string): GenomeEvidenceData[] {
  const items = Array.isArray(rowEvidence) ? rowEvidence : [];
  return items.map((item: any) => ({
    id: item?.id ?? '',
    businessId: item?.businessId ?? businessId,
    factId: item?.factId ?? null,
    sourceModule: item?.sourceModule ?? '',
    sourceEntityType: item?.sourceEntityType ?? '',
    sourceEntityId: item?.sourceEntityId ?? null,
    summary: item?.summary ?? '',
    evidenceStrength: typeof item?.evidenceStrength === 'number' ? item.evidenceStrength : 0.5,
    occurredAt: item?.occurredAt ?? null,
    createdAt: item?.createdAt ?? createdAt,
  }));
}

function toDomain(row: {
  id: string;
  businessId: string;
  sourceModule: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  signalType: string;
  section: string;
  domain: string;
  field: string | null;
  proposedValue: unknown;
  reason: string;
  evidence: unknown;
  confidence: number;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
}): GenomeSignalData {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    businessId: row.businessId,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    signalType: row.signalType,
    section: row.section,
    domain: row.domain,
    field: row.field,
    proposedValue: row.proposedValue === null ? null : (row.proposedValue as unknown),
    reason: row.reason,
    evidence: evidenceFromRow(row.evidence, row.businessId, createdAt),
    confidence: row.confidence,
    status: row.status as GenomeSignalData['status'],
    createdAt,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class GenomeSignalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factService: GenomeFactService,
    private readonly evidenceService: GenomeEvidenceService,
    private readonly scoring: GenomeScoringService,
    private readonly readiness: GenomeModuleReadinessService,
    private readonly events: EventEmitter2,
  ) {}

  async createSignal(input: CreateGenomeSignalInput): Promise<GenomeSignalData> {
    const confidence = input.confidence ?? 0.5;
    const evidence = input.evidence ?? [];

    const existing = await this.prisma.client.genomeSignal.findFirst({
      where: {
        businessId: input.businessId,
        sourceModule: input.sourceModule,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        signalType: input.signalType,
        section: input.section,
        domain: input.domain,
        field: input.field ?? null,
        status: { in: ['NEW', 'REVIEWED', 'ACCEPTED'] },
      },
    });

    if (existing) {
      if (confidence > existing.confidence) {
        const updated = await this.prisma.client.genomeSignal.update({
          where: { id: existing.id },
          data: {
            confidence,
            reason: input.reason,
            evidence: asJsonValue(evidence),
            proposedValue:
              input.proposedValue === undefined
                ? existing.proposedValue ?? Prisma.JsonNull
                : (input.proposedValue === null ? Prisma.JsonNull : asJsonValue(input.proposedValue)),
          },
        });
        return toDomain(updated);
      }
      return toDomain(existing);
    }

    const created = await this.prisma.client.genomeSignal.create({
      data: {
        businessId: input.businessId,
        sourceModule: input.sourceModule,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        signalType: input.signalType,
        section: input.section,
        domain: input.domain,
        field: input.field ?? null,
        reason: input.reason,
        evidence: asJsonValue(evidence),
        confidence,
        proposedValue:
          input.proposedValue === undefined || input.proposedValue === null
            ? Prisma.JsonNull
            : asJsonValue(input.proposedValue),
        status: 'NEW',
      },
    });

    return toDomain(created);
  }

  async createSignals(inputs: CreateGenomeSignalInput[]): Promise<GenomeSignalData[]> {
    return Promise.all(inputs.map((input) => this.createSignal(input)));
  }

  async listSignals(businessId: string, filters: ListGenomeSignalsQuery = {}): Promise<GenomeSignalData[]> {
    const rows = await this.prisma.client.genomeSignal.findMany({
      where: {
        businessId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.sourceModule ? { sourceModule: filters.sourceModule } : {}),
        ...(filters.section ? { section: filters.section } : {}),
        ...(filters.signalType ? { signalType: filters.signalType } : {}),
        ...(filters.minConfidence !== undefined ? { confidence: { gte: filters.minConfidence } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async getSignal(businessId: string, signalId: string): Promise<GenomeSignalData> {
    const row = await this.prisma.client.genomeSignal.findUnique({
      where: { id: signalId },
    });

    if (!row || row.businessId !== businessId) {
      throw new NotFoundException('Genome signal not found');
    }

    return toDomain(row);
  }

  async reviewSignal(businessId: string, signalId: string): Promise<GenomeSignalData> {
    const signal = await this.getSignal(businessId, signalId);
    if (signal.status === 'MERGED' || signal.status === 'REJECTED') {
      throw new BadRequestException(`Cannot review a ${signal.status.toLowerCase()} signal`);
    }

    const updated = await this.prisma.client.genomeSignal.update({
      where: { id: signalId },
      data: { status: 'REVIEWED', reviewedAt: new Date() },
    });

    return toDomain(updated);
  }

  async acceptSignal(businessId: string, signalId: string): Promise<GenomeSignalData> {
    const signal = await this.getSignal(businessId, signalId);
    if (signal.status === 'MERGED' || signal.status === 'REJECTED') {
      throw new BadRequestException(`Cannot accept a ${signal.status.toLowerCase()} signal`);
    }

    const updated = await this.prisma.client.genomeSignal.update({
      where: { id: signalId },
      data: { status: 'ACCEPTED', reviewedAt: new Date() },
    });

    return toDomain(updated);
  }

  async rejectSignal(businessId: string, signalId: string, reason?: string): Promise<GenomeSignalData> {
    const signal = await this.getSignal(businessId, signalId);
    if (signal.status === 'MERGED') {
      throw new BadRequestException('Cannot reject a merged signal');
    }

    const updatedReason = reason ? `${signal.reason} [rejected: ${reason}]` : signal.reason;
    const updated = await this.prisma.client.genomeSignal.update({
      where: { id: signalId },
      data: { status: 'REJECTED', reviewedAt: new Date(), reason: updatedReason },
    });

    return toDomain(updated);
  }

  async mergeSignal(
    businessId: string,
    signalId: string,
  ): Promise<{ signal: GenomeSignalData; fact: Awaited<ReturnType<GenomeFactService['upsertFact']>> }> {
    const signal = await this.getSignal(businessId, signalId);
    if (signal.status !== 'ACCEPTED') {
      throw new BadRequestException('Only ACCEPTED signals can be merged');
    }

    const field = signal.field ?? 'value';

    const fact = await this.factService.upsertFact({
      businessId,
      section: signal.section,
      domain: signal.domain,
      field,
      value: { raw: signal.proposedValue ?? null, type: 'JSON' as const },
      sourceModule: signal.sourceModule,
      sourceType: 'GENOME_SIGNAL',
      sourceEntityType: 'GenomeSignal',
      sourceEntityId: signal.id,
    });

    for (const evidence of signal.evidence) {
      await this.evidenceService.attachEvidence({
        businessId,
        factId: fact.id,
        sourceModule: evidence.sourceModule ?? signal.sourceModule,
        sourceEntityType: evidence.sourceEntityType ?? 'GenomeSignal',
        sourceEntityId: evidence.sourceEntityId ?? undefined,
        summary: evidence.summary,
        evidenceStrength: evidence.evidenceStrength,
        occurredAt: evidence.occurredAt ?? undefined,
      });
    }

    const updated = await this.prisma.client.genomeSignal.update({
      where: { id: signalId },
      data: { status: 'MERGED', reviewedAt: new Date() },
    });

    const facts = await this.scoring.computeFactScores(businessId);
    await this.readiness.computeReadiness(businessId, facts);

    this.events.emit('key.genome.signal_merged', {
      businessId,
      signalId: signal.id,
      section: signal.section,
      domain: signal.domain,
      field,
    });

    return { signal: toDomain(updated), fact };
  }

  // --- Ingestion helpers ---

  async createFromTemporalEvent(input: {
    businessId: string;
    eventId: string;
    title: string;
    summary?: string;
    module?: string;
    inferredSection: string;
    inferredDomain: string;
    inferredField?: string;
    proposedValue?: unknown;
    confidence: number;
  }): Promise<GenomeSignalData> {
    return this.createSignal({
      businessId: input.businessId,
      sourceModule: 'temporal_flow',
      sourceEntityType: 'TemporalEvent',
      sourceEntityId: input.eventId,
      signalType: 'OPERATIONS_PATTERN',
      section: input.inferredSection,
      domain: input.inferredDomain,
      field: input.inferredField,
      proposedValue: input.proposedValue,
      reason: input.title,
      evidence: [
        {
          sourceModule: input.module ?? 'temporal_flow',
          sourceEntityType: 'TemporalEvent',
          sourceEntityId: input.eventId,
          summary: input.summary ?? input.title,
          evidenceStrength: input.confidence,
        },
      ],
      confidence: input.confidence,
    });
  }

  async createFromInboxThread(input: {
    businessId: string;
    threadId: string;
    customerText: string;
    inferredSignalType: string;
    section: string;
    domain: string;
    field?: string;
    proposedValue?: unknown;
    confidence: number;
  }): Promise<GenomeSignalData> {
    return this.createSignal({
      businessId: input.businessId,
      sourceModule: 'key_inbox',
      sourceEntityType: 'KeyInboxThread',
      sourceEntityId: input.threadId,
      signalType: input.inferredSignalType,
      section: input.section,
      domain: input.domain,
      field: input.field,
      proposedValue: input.proposedValue,
      reason: input.customerText.slice(0, 200),
      evidence: [
        {
          sourceModule: 'key_inbox',
          sourceEntityType: 'KeyInboxThread',
          sourceEntityId: input.threadId,
          summary: input.customerText.slice(0, 500),
          evidenceStrength: input.confidence,
        },
      ],
      confidence: input.confidence,
    });
  }

  async createFromExecutiveFinding(input: {
    businessId: string;
    mode: string;
    findingId?: string;
    title: string;
    finding: string;
    evidence: string[];
    section: string;
    domain: string;
    field?: string;
    signalType: string;
    proposedValue?: unknown;
    confidence: number;
  }): Promise<GenomeSignalData> {
    return this.createSignal({
      businessId: input.businessId,
      sourceModule: 'executive_mode',
      sourceEntityType: input.mode,
      sourceEntityId: input.findingId,
      signalType: input.signalType,
      section: input.section,
      domain: input.domain,
      field: input.field,
      proposedValue: input.proposedValue,
      reason: input.title,
      evidence: input.evidence.map((summary, index) => ({
        sourceModule: 'executive_mode',
        sourceEntityType: input.mode,
        sourceEntityId: input.findingId ? `${input.findingId}-${index}` : `finding-${index}`,
        summary,
        evidenceStrength: input.confidence,
      })),
      confidence: input.confidence,
    });
  }
}

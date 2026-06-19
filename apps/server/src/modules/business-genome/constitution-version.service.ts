import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import type { GenomeIntegrityResult } from '../blueprint/blueprint.types';
import type {
  ConstitutionStaleness,
  ConstitutionVersionData,
  ConstitutionVersionStatus,
  GenerateConstitutionVersionInput,
} from './constitution-version.types';

@Injectable()
export class ConstitutionVersionService {
  private readonly logger = new Logger(ConstitutionVersionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
  ) {}

  async latest(businessId: string): Promise<ConstitutionVersionData | null> {
    const row = await this.prisma.client.businessConstitutionVersion.findFirst({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return row ? this.serialize(row) : null;
  }

  async list(businessId: string): Promise<ConstitutionVersionData[]> {
    const rows = await this.prisma.client.businessConstitutionVersion.findMany({
      where: { businessId },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async getVersion(businessId: string, version: number): Promise<ConstitutionVersionData> {
    const row = await this.prisma.client.businessConstitutionVersion.findUnique({
      where: { businessId_version: { businessId, version } },
    });
    if (!row) throw new NotFoundException('Constitution version not found');
    return this.serialize(row);
  }

  async generate(
    businessId: string,
    input: GenerateConstitutionVersionInput = {},
    generatedBy?: string,
  ): Promise<ConstitutionVersionData> {
    const [content, genome] = await Promise.all([
      this.blueprint.generateConstitution(businessId),
      this.blueprint.calculateGenomeIntegrity(businessId),
    ]);

    const latest = await this.prisma.client.businessConstitutionVersion.findFirst({
      where: { businessId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const version = (latest?.version ?? 0) + 1;

    await this.prisma.client.businessConstitutionVersion.updateMany({
      where: { businessId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });

    const row = await this.prisma.client.businessConstitutionVersion.create({
      data: {
        businessId,
        version,
        title: 'Business Constitution',
        status: input.status ?? 'ACTIVE',
        content: content as unknown as Prisma.InputJsonValue,
        summary: this.buildSummary(genome),
        changeNotes: input.changeNotes ?? null,
        sourceGenomeIntegrity: genome.genomeIntegrity,
        sourceExecutiveReadiness: genome.executiveReadinessScore,
        sourceGenomeStage: genome.genomeStage,
        sourceDnaScores: genome.genomeDnaScores as unknown as Prisma.InputJsonValue,
        sourceDnaConfidence: genome.genomeDnaConfidence as unknown as Prisma.InputJsonValue,
        generatedBy: generatedBy ?? null,
      },
    });

    await this.temporal
      .emit({
        businessId,
        userId: generatedBy,
        source: 'KEY',
        type: 'constitution.version_generated',
        module: 'business-genome',
        entityType: 'business_constitution_version',
        entityId: row.id,
        title: `Business Constitution v${version} generated`,
        summary: input.changeNotes || `Version ${version} generated from Business Genome.`,
        importance: 'HIGH',
        genomeImpactPotential: false,
        payload: {
          version,
          genomeIntegrity: genome.genomeIntegrity,
          executiveReadinessScore: genome.executiveReadinessScore,
          genomeStage: genome.genomeStage,
        },
      })
      .catch((err) => this.logger.warn(`Temporal emit failed: ${(err as Error).message}`));

    return this.serialize(row);
  }

  async archive(businessId: string, version: number): Promise<ConstitutionVersionData> {
    const existing = await this.prisma.client.businessConstitutionVersion.findUnique({
      where: { businessId_version: { businessId, version } },
    });
    if (!existing) throw new NotFoundException('Constitution version not found');

    const row = await this.prisma.client.businessConstitutionVersion.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' },
    });

    await this.temporal
      .emit({
        businessId,
        source: 'KEY',
        type: 'constitution.version_archived',
        module: 'business-genome',
        entityType: 'business_constitution_version',
        entityId: row.id,
        title: `Business Constitution v${version} archived`,
        summary: `Version ${version} was archived.`,
        importance: 'NORMAL',
        payload: { version },
      })
      .catch((err) => this.logger.warn(`Temporal emit failed: ${(err as Error).message}`));

    return this.serialize(row);
  }

  async staleness(businessId: string): Promise<ConstitutionStaleness> {
    const [latest, currentGenome] = await Promise.all([
      this.latest(businessId),
      this.blueprint.calculateGenomeIntegrity(businessId),
    ]);

    if (!latest) {
      return {
        stale: true,
        reason: 'No Constitution version has been generated yet.',
        currentGenomeIntegrity: currentGenome.genomeIntegrity,
        constitutionGenomeIntegrity: null,
        currentExecutiveReadiness: currentGenome.executiveReadinessScore,
        constitutionExecutiveReadiness: null,
        currentGenomeStage: currentGenome.genomeStage,
        constitutionGenomeStage: null,
      };
    }

    const changedIntegrity = latest.sourceGenomeIntegrity !== currentGenome.genomeIntegrity;
    const changedReadiness = latest.sourceExecutiveReadiness !== currentGenome.executiveReadinessScore;
    const changedStage = latest.sourceGenomeStage !== currentGenome.genomeStage;
    const stale = changedIntegrity || changedReadiness || changedStage;

    return {
      stale,
      reason: stale
        ? 'The Business Genome has changed since this Constitution version was generated.'
        : 'The active Constitution matches the current Genome summary state.',
      currentGenomeIntegrity: currentGenome.genomeIntegrity,
      constitutionGenomeIntegrity: latest.sourceGenomeIntegrity ?? null,
      currentExecutiveReadiness: currentGenome.executiveReadinessScore,
      constitutionExecutiveReadiness: latest.sourceExecutiveReadiness ?? null,
      currentGenomeStage: currentGenome.genomeStage,
      constitutionGenomeStage: latest.sourceGenomeStage ?? null,
    };
  }

  private buildSummary(genome: GenomeIntegrityResult): string {
    return `Generated from Genome Integrity ${genome.genomeIntegrity}%, Executive Readiness ${genome.executiveReadinessScore}%, Stage ${genome.genomeStage}.`;
  }

  private serialize(row: any): ConstitutionVersionData {
    return {
      id: row.id,
      businessId: row.businessId,
      version: row.version,
      title: row.title,
      status: row.status as ConstitutionVersionStatus,
      content: (row.content ?? {}) as Record<string, unknown>,
      summary: row.summary,
      changeNotes: row.changeNotes,
      sourceGenomeIntegrity: row.sourceGenomeIntegrity,
      sourceExecutiveReadiness: row.sourceExecutiveReadiness,
      sourceGenomeStage: row.sourceGenomeStage,
      sourceDnaScores: (row.sourceDnaScores ?? null) as Record<string, number> | null,
      sourceDnaConfidence: (row.sourceDnaConfidence ?? null) as Record<string, number> | null,
      generatedBy: row.generatedBy,
      generatedAt: row.generatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

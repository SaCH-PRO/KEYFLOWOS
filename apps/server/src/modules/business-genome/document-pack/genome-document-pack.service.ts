import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BusinessIntelligenceService } from '../../intelligence/business-intelligence.service';
import { BlueprintService } from '../../blueprint/blueprint.service';
import { ConstitutionVersionService } from '../constitution-version.service';
import type { ConstitutionVersionData } from '../constitution-version.types';
import type { BusinessExecutiveBrief } from '../../intelligence/business-intelligence.types';
import type { GenomeIntegrityResult } from '../../blueprint/blueprint.types';
import type { GenomeReader } from '../key-genome/genome-finance-scope';
import {
  constitutionVersionForReader,
  genomeIntegrityForReader,
  readsRevenueFor,
  type ProjectedGenome,
} from '../key-genome/genome-composites-for-reader';
import type { DocumentSection, ExportFormat, ExportResult } from './genome-document-pack.types';
import { buildFilename, renderDocx, renderPdf } from './genome-document-pack.formatters';

@Injectable()
export class GenomeDocumentPackService {
  constructor(
    @Inject(BusinessIntelligenceService) private readonly intelligence: BusinessIntelligenceService,
    @Inject(ConstitutionVersionService) private readonly constitution: ConstitutionVersionService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async exportExecutiveBrief(
    businessId: string,
    format: ExportFormat,
    reader?: GenomeReader | null,
  ): Promise<ExportResult> {
    const brief = await this.intelligence.generateExecutiveBrief(businessId, reader);
    const sections = this.mapExecutiveBrief(brief);
    const filename = buildFilename('executive-brief', format);
    return this.render(format, 'Executive Brief', this.meta(brief.generatedAt), sections, filename);
  }

  async exportConstitution(
    businessId: string,
    version: number | undefined,
    format: ExportFormat,
    reader?: GenomeReader | null,
  ): Promise<ExportResult> {
    const [rawConstitution, readsRevenue] = await Promise.all([
      version === undefined
        ? this.constitution.latest(businessId)
        : this.constitution.getVersion(businessId, version),
      readsRevenueFor(this.prisma, businessId, reader),
    ]);

    if (!rawConstitution) {
      throw new NotFoundException('No Constitution version found for this business.');
    }

    const constitution = constitutionVersionForReader(rawConstitution, readsRevenue)!;
    const sections = this.mapConstitution(constitution);
    const filename = buildFilename('constitution', format, `v${constitution.version}`);
    return this.render(format, 'Business Constitution', this.meta(constitution.generatedAt), sections, filename);
  }

  async exportDnaReport(
    businessId: string,
    format: ExportFormat,
    reader?: GenomeReader | null,
  ): Promise<ExportResult> {
    const [rawGenome, readsRevenue] = await Promise.all([
      this.blueprint.calculateGenomeIntegrity(businessId),
      readsRevenueFor(this.prisma, businessId, reader),
    ]);
    const genome = genomeIntegrityForReader(rawGenome, readsRevenue);
    const sections = this.mapDnaReport(genome);
    const filename = buildFilename('dna-report', format);
    return this.render(format, 'Business DNA Report', this.meta(new Date().toISOString()), sections, filename);
  }

  private meta(generatedAt: string): string {
    return `Generated ${new Date(generatedAt).toLocaleString()}`;
  }

  private async render(
    format: ExportFormat,
    title: string,
    meta: string,
    sections: DocumentSection[],
    filename: string,
  ): Promise<ExportResult> {
    return format === 'docx'
      ? renderDocx(title, meta, sections, filename)
      : renderPdf(title, meta, sections, filename);
  }

  private mapExecutiveBrief(brief: BusinessExecutiveBrief): DocumentSection[] {
    const sections: DocumentSection[] = [
      {
        heading: 'Summary',
        rows: [{ label: '', value: brief.summary }],
      },
    ];

    const healthRows: DocumentSection['rows'] = [];
    if (brief.genomeIntegrity !== null && brief.genomeIntegrity !== undefined) {
      healthRows.push({ label: 'Genome Integrity', value: `${brief.genomeIntegrity}%` });
    }
    if (brief.executiveReadinessScore !== null && brief.executiveReadinessScore !== undefined) {
      healthRows.push({ label: 'Executive Readiness', value: `${brief.executiveReadinessScore}%` });
    }
    if (brief.genomeStage) {
      healthRows.push({ label: 'Genome Stage', value: brief.genomeStage.replace(/_/g, ' ') });
    }
    if (healthRows.length > 0) {
      sections.push({ heading: 'Business Health', rows: healthRows });
    }

    if (brief.topPriorities.length > 0) {
      sections.push({
        heading: `Top Priorities (${brief.topPriorities.length})`,
        rows: brief.topPriorities.map((priority, index) => ({
          label: `${index + 1}. ${priority.title} (${priority.priority})`,
          value: [priority.finding, ...(priority.evidence ?? [])].join(' '),
        })),
      });
    }

    if (brief.insights.length > 0) {
      sections.push({
        heading: `Insights (${brief.insights.length})`,
        rows: brief.insights.map((insight) => ({
          label: `${insight.title} (${insight.priority})`,
          value: [insight.finding, ...(insight.evidence ?? [])].join(' '),
        })),
      });
    }

    return sections;
  }

  private mapConstitution(constitution: ConstitutionVersionData): DocumentSection[] {
    const content = (constitution.content ?? {}) as Record<string, unknown>;
    const integrity = constitution.sourceGenomeIntegrity ?? (content.genomeIntegrity as number | null | undefined);
    const readiness =
      constitution.sourceExecutiveReadiness ?? (content.executiveReadinessScore as number | null | undefined);
    const stage = constitution.sourceGenomeStage ?? (content.genomeStage as string | null | undefined);

    const metadataRows: DocumentSection['rows'] = [
      { label: 'Version', value: `v${constitution.version}` },
      { label: 'Status', value: constitution.status },
      { label: 'Generated', value: new Date(constitution.generatedAt).toLocaleString() },
    ];
    if (typeof integrity === 'number') {
      metadataRows.push({ label: 'Genome Integrity', value: `${integrity}%` });
    }
    if (typeof readiness === 'number') {
      metadataRows.push({ label: 'Executive Readiness', value: `${readiness}%` });
    }
    if (typeof stage === 'string' && stage.length > 0) {
      metadataRows.push({ label: 'Genome Stage', value: stage.replace(/_/g, ' ') });
    }
    if (constitution.changeNotes) {
      metadataRows.push({ label: 'Change Notes', value: constitution.changeNotes });
    }

    const sections: DocumentSection[] = [{ heading: 'Document Metadata', rows: metadataRows }];

    const sectionEntries = Object.entries((content.sections as Record<string, unknown>) ?? {});
    for (const [key, raw] of sectionEntries) {
      if (!raw || typeof raw !== 'object') continue;
      const section = raw as Record<string, unknown>;
      const rows: DocumentSection['rows'] = [
        { label: 'Content', value: String(section.content ?? '') },
      ];

      const sourceDna = section.sourceDna;
      if (Array.isArray(sourceDna) && sourceDna.length > 0) {
        rows.push({ label: 'Source DNA', value: sourceDna.join(', ') });
      }

      if (typeof section.strength === 'number') {
        rows.push({ label: 'Strength', value: `${section.strength}%` });
      }

      const clauses = section.clauses;
      if (Array.isArray(clauses) && clauses.length > 0) {
        rows.push({ label: 'Clauses', value: clauses.map(String).join('\n') });
      }

      sections.push({
        heading: String(section.title ?? key),
        rows,
      });
    }

    return sections;
  }

  private mapDnaReport(genome: GenomeIntegrityResult | ProjectedGenome<GenomeIntegrityResult>): DocumentSection[] {
    const summaryRows: DocumentSection['rows'] = [];
    if (genome.genomeIntegrity !== null && genome.genomeIntegrity !== undefined) {
      summaryRows.push({ label: 'Genome Integrity', value: `${genome.genomeIntegrity}%` });
    }
    if (genome.executiveReadinessScore !== null && genome.executiveReadinessScore !== undefined) {
      summaryRows.push({ label: 'Executive Readiness', value: `${genome.executiveReadinessScore}%` });
    }
    if (genome.genomeStage) {
      summaryRows.push({ label: 'Genome Stage', value: genome.genomeStage.replace(/_/g, ' ') });
    }
    summaryRows.push({
      label: 'Three-Pillar Minimum Met',
      value: genome.threePillarMinimumMet ? 'Yes' : 'No',
    });

    const sections: DocumentSection[] = [{ heading: 'Genome Summary', rows: summaryRows }];

    for (const dna of genome.dnaSections) {
      const rows: DocumentSection['rows'] = [
        { label: 'Integrity', value: `${dna.integrity}%` },
        { label: 'Confidence', value: `${dna.confidence}%` },
        { label: 'Fields Captured', value: `${dna.fieldsCaptured} / ${dna.fieldsTotal}` },
        { label: 'Summary', value: dna.summary },
      ];

      if (dna.missingFields.length > 0) {
        rows.push({ label: 'Missing Fields', value: dna.missingFields.join(', ') });
      }

      rows.push({ label: 'Recommendation', value: dna.recommendation });

      sections.push({ heading: dna.label, rows });
    }

    return sections;
  }
}

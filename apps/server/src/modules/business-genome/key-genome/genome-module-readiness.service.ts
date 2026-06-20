import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  KEY_GENOME_MODULE_NAMES,
  KEY_GENOME_SECTION_CONFIG,
  type GenomeFactRequirement,
  type KeyGenomeModuleName,
} from './key-genome.ontology';
import type { GenomeFactData, MissingGenomeFact, ModuleReadinessData, RiskLevel } from './key-genome.types';

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[_\s.]/g, '');
}

function requirementKey(req: GenomeFactRequirement): string {
  return `${req.section}:${req.domain}:${req.field}`;
}

function factMatchesRequirement(fact: GenomeFactData, req: GenomeFactRequirement): boolean {
  if (fact.section !== req.section) return false;

  const reqDomain = normalizeToken(req.domain);
  const reqField = normalizeToken(req.field);
  const factDomain = normalizeToken(fact.domain);
  let factField = normalizeToken(fact.field);

  // Backfill stores primitive leaf values under field "value" and puts the
  // actual key at the end of the domain path (e.g. "identity.businessName").
  if (factField === 'value') {
    const parts = factDomain.split('.');
    factField = parts[parts.length - 1] ?? '';
  }

  const domainMatch =
    factDomain === reqDomain || factDomain.includes(reqDomain) || reqDomain.includes(factDomain);
  const fieldMatch =
    factField === reqField || factField.includes(reqField) || reqField.includes(factField);

  return domainMatch && fieldMatch;
}

function findBestMatchingFact(
  req: GenomeFactRequirement,
  facts: GenomeFactData[],
): GenomeFactData | undefined {
  const matches = facts.filter((f) => factMatchesRequirement(f, req));
  if (matches.length === 0) return undefined;
  return matches.reduce((best, current) => (current.score.overall >= best.score.overall ? current : best));
}

function toMissingFact(req: GenomeFactRequirement): MissingGenomeFact {
  return {
    section: req.section,
    domain: req.domain,
    field: req.field,
    reason: `Missing ${req.impact.toLowerCase()} fact: ${req.label}`,
    impact: req.impact,
  };
}

@Injectable()
export class GenomeModuleReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async computeReadiness(businessId: string, facts?: GenomeFactData[]): Promise<ModuleReadinessData[]> {
    const sourceFacts = facts ?? (await this.loadFacts(businessId));
    const results: ModuleReadinessData[] = [];

    for (const module of KEY_GENOME_MODULE_NAMES) {
      const readiness = this.computeModuleReadiness(businessId, module, sourceFacts);
      await this.persistReadiness(readiness);
      results.push(readiness);
    }

    return results;
  }

  async getReadiness(businessId: string, module?: KeyGenomeModuleName): Promise<ModuleReadinessData | ModuleReadinessData[] | null> {
    if (module) {
      const row = await this.prisma.client.genomeModuleReadiness.findUnique({
        where: { businessId_module: { businessId, module } },
      });
      return row ? this.rowToDomain(row) : null;
    }

    const rows = await this.prisma.client.genomeModuleReadiness.findMany({
      where: { businessId },
      orderBy: { readinessScore: 'desc' },
    });
    return rows.map((r) => this.rowToDomain(r));
  }

  private computeModuleReadiness(
    businessId: string,
    module: KeyGenomeModuleName,
    facts: GenomeFactData[],
  ): ModuleReadinessData {
    const requiredFacts: MissingGenomeFact[] = [];
    const optionalFacts: MissingGenomeFact[] = [];
    const missingFacts: MissingGenomeFact[] = [];

    for (const config of Object.values(KEY_GENOME_SECTION_CONFIG)) {
      if (!config.moduleImpact.includes(module)) continue;

      for (const req of config.requiredFacts) {
        requiredFacts.push(toMissingFact(req));
        if (!findBestMatchingFact(req, facts)) {
          missingFacts.push(toMissingFact(req));
        }
      }

      for (const req of config.optionalFacts) {
        optionalFacts.push(toMissingFact(req));
      }
    }

    const presentRequiredCount = requiredFacts.length - missingFacts.length;
    const readinessScore =
      requiredFacts.length === 0 ? 100 : Math.round((presentRequiredCount / requiredFacts.length) * 100);

    const blockingMissing = missingFacts.filter((m) => m.impact === 'BLOCKING');
    const degradedMissing = missingFacts.filter((m) => m.impact === 'DEGRADED');

    const blockedReasons: string[] = [];
    for (const missing of missingFacts) {
      blockedReasons.push(`Missing ${missing.impact.toLowerCase()} fact: ${missing.domain}.${missing.field}`);
    }

    const automationAllowed = blockingMissing.length === 0;

    let riskLevel: RiskLevel = 'LOW';
    if (blockingMissing.length > 0) {
      riskLevel = 'HIGH';
    } else if (degradedMissing.length > 0) {
      riskLevel = 'MEDIUM';
    }

    const recommendedSetupActions: string[] = missingFacts.map(
      (m) => `Provide ${m.impact.toLowerCase()} fact: ${m.domain}.${m.field}`,
    );

    return {
      businessId,
      module,
      readinessScore,
      requiredFacts,
      missingFacts,
      optionalFacts,
      blockedReasons,
      recommendedSetupActions,
      automationAllowed,
      riskLevel,
      lastComputedAt: new Date().toISOString(),
    };
  }

  private async persistReadiness(data: ModuleReadinessData): Promise<void> {
    await this.prisma.client.genomeModuleReadiness.upsert({
      where: { businessId_module: { businessId: data.businessId, module: data.module } },
      update: {
        readinessScore: data.readinessScore,
        requiredFacts: asJsonValue(data.requiredFacts),
        missingFacts: asJsonValue(data.missingFacts),
        optionalFacts: asJsonValue(data.optionalFacts),
        blockedReasons: asJsonValue(data.blockedReasons),
        recommendedSetupActions: asJsonValue(data.recommendedSetupActions),
        automationAllowed: data.automationAllowed,
        riskLevel: data.riskLevel,
        lastComputedAt: new Date(data.lastComputedAt),
      },
      create: {
        businessId: data.businessId,
        module: data.module,
        readinessScore: data.readinessScore,
        requiredFacts: asJsonValue(data.requiredFacts),
        missingFacts: asJsonValue(data.missingFacts),
        optionalFacts: asJsonValue(data.optionalFacts),
        blockedReasons: asJsonValue(data.blockedReasons),
        recommendedSetupActions: asJsonValue(data.recommendedSetupActions),
        automationAllowed: data.automationAllowed,
        riskLevel: data.riskLevel,
        lastComputedAt: new Date(data.lastComputedAt),
      },
    });
  }

  private async loadFacts(businessId: string): Promise<GenomeFactData[]> {
    const rows = await this.prisma.client.genomeFact.findMany({ where: { businessId } });
    return rows.map((row) => this.factRowToDomain(row));
  }

  private factRowToDomain(row: {
    id: string;
    businessId: string;
    section: string;
    domain: string;
    field: string;
    value: unknown;
    valueType: string;
    sourceModule: string | null;
    sourceType: string;
    sourceEntityType: string | null;
    sourceEntityId: string | null;
    completenessScore: number;
    qualityScore: number;
    confidenceScore: number;
    freshnessScore: number;
    operationalReadinessScore: number;
    verificationStatus: string;
    riskIfWrong: string;
    lastVerifiedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): GenomeFactData {
    return {
      id: row.id,
      businessId: row.businessId,
      section: row.section,
      domain: row.domain,
      field: row.field,
      value: { raw: row.value, type: row.valueType as GenomeFactData['value']['type'] },
      sourceModule: row.sourceModule,
      sourceType: row.sourceType,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      score: {
        completeness: row.completenessScore,
        quality: row.qualityScore,
        confidence: row.confidenceScore,
        freshness: row.freshnessScore,
        operationalReadiness: row.operationalReadinessScore,
        riskPenalty: 0,
        overall: 0,
      },
      verificationStatus: row.verificationStatus as GenomeFactData['verificationStatus'],
      riskIfWrong: row.riskIfWrong as GenomeFactData['riskIfWrong'],
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private rowToDomain(row: {
    id: string;
    businessId: string;
    module: string;
    readinessScore: number;
    requiredFacts: unknown;
    missingFacts: unknown;
    optionalFacts: unknown;
    blockedReasons: unknown;
    recommendedSetupActions: unknown;
    automationAllowed: boolean;
    riskLevel: string;
    lastComputedAt: Date;
  }): ModuleReadinessData {
    return {
      businessId: row.businessId,
      module: row.module,
      readinessScore: row.readinessScore,
      requiredFacts: (row.requiredFacts ?? []) as MissingGenomeFact[],
      missingFacts: (row.missingFacts ?? []) as MissingGenomeFact[],
      optionalFacts: (row.optionalFacts ?? []) as MissingGenomeFact[],
      blockedReasons: (row.blockedReasons ?? []) as string[],
      recommendedSetupActions: (row.recommendedSetupActions ?? []) as string[],
      automationAllowed: row.automationAllowed,
      riskLevel: row.riskLevel as RiskLevel,
      lastComputedAt: row.lastComputedAt.toISOString(),
    };
  }
}

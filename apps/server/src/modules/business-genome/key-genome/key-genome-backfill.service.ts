import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeFactService } from './genome-fact.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import type { KeyGenomeSection } from './key-genome.ontology';
import type { GenomeFactValue } from './key-genome.types';

const BLUEPRINT_SECTION_MAP: Record<string, KeyGenomeSection> = {
  identity: 'VISION_IDENTITY',
  operatingModel: 'BUSINESS_MODEL',
  goals: 'VISION_IDENTITY',
  constraints: 'RISK_RESILIENCE',
  brand: 'VISION_IDENTITY',
  customerModel: 'CUSTOMER_MARKET',
  financials: 'FINANCIAL',
  workflowModel: 'OPERATIONS_DELIVERY',
  aiPreferences: 'TECH_DATA_INTELLIGENCE',
  founderProfile: 'FOUNDER_LEADERSHIP',
  legalProfile: 'LEGAL_GOVERNANCE_COMPLIANCE',
  registrationProfile: 'LEGAL_GOVERNANCE_COMPLIANCE',
  taxProfile: 'LEGAL_GOVERNANCE_COMPLIANCE',
  ownershipProfile: 'LEGAL_GOVERNANCE_COMPLIANCE',
  marketProfile: 'CUSTOMER_MARKET',
  offerArchitecture: 'OFFER_PRODUCT',
  salesSystem: 'SALES',
  marketingSystem: 'MARKETING_GROWTH',
  operationsSystem: 'OPERATIONS_DELIVERY',
  projectionProfile: 'FINANCIAL',
  riskProfile: 'RISK_RESILIENCE',
  complianceProfile: 'LEGAL_GOVERNANCE_COMPLIANCE',
};

interface FlattenedFact {
  domain: string;
  field: string;
  value: GenomeFactValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function flattenValue(prefix: string, value: unknown, acc: FlattenedFact[]): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    acc.push({ domain: prefix, field: 'values', value: { raw: value, type: 'LIST' } });
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const fieldPrefix = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(nested) || Array.isArray(nested)) {
        flattenValue(fieldPrefix, nested, acc);
      } else {
        acc.push({ domain: prefix, field: key, value: { raw: nested, type: inferType(nested) } });
      }
    }
    return;
  }

  acc.push({ domain: prefix, field: 'value', value: { raw: value, type: inferType(value) } });
}

function inferType(raw: unknown): GenomeFactValue['type'] {
  if (typeof raw === 'boolean') return 'BOOLEAN';
  if (typeof raw === 'number') return 'NUMBER';
  if (raw instanceof Date) return 'DATE';
  if (typeof raw === 'string') {
    const iso = /^\d{4}-\d{2}-\d{2}/;
    return iso.test(raw) && !Number.isNaN(Date.parse(raw)) ? 'DATE' : 'STRING';
  }
  return 'JSON';
}

function flattenBlueprintColumn(column: string, data: unknown): FlattenedFact[] {
  const facts: FlattenedFact[] = [];
  if (!isPlainObject(data)) return facts;

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;

    if (isPlainObject(value) || Array.isArray(value)) {
      flattenValue(key, value, facts);
    } else {
      facts.push({ domain: key, field: 'value', value: { raw: value, type: inferType(value) } });
    }
  }

  return facts.map((f) => ({ ...f, domain: `${column}.${f.domain}` }));
}

@Injectable()
export class KeyGenomeBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factService: GenomeFactService,
    private readonly evidenceService: GenomeEvidenceService,
  ) {}

  async backfill(
    businessId: string,
    columns?: string[],
  ): Promise<{ factsUpserted: number; evidenceAttached: number }> {
    const blueprint = await this.prisma.client.businessBlueprint.findUnique({
      where: { businessId },
    });

    if (!blueprint) {
      throw new NotFoundException(`BusinessBlueprint not found for business ${businessId}`);
    }

    let factsUpserted = 0;
    let evidenceAttached = 0;

    for (const [column, section] of Object.entries(BLUEPRINT_SECTION_MAP)) {
      // When scoped, only reconcile the columns that actually changed.
      if (columns && !columns.includes(column)) continue;
      const data = (blueprint as Record<string, unknown>)[column];
      if (!data || !isPlainObject(data)) continue;

      const facts = flattenBlueprintColumn(column, data);
      for (const fact of facts) {
        const upserted = await this.factService.upsertFact({
          businessId,
          section,
          domain: fact.domain,
          field: fact.field,
          value: fact.value,
          sourceModule: 'blueprint',
          sourceType: 'BLUEPRINT_BACKFILL',
          sourceEntityType: 'BusinessBlueprint',
          sourceEntityId: blueprint.id,
        });
        factsUpserted++;

        await this.evidenceService.attachEvidence({
          businessId,
          factId: upserted.id,
          sourceModule: 'blueprint',
          sourceEntityType: 'BusinessBlueprint',
          sourceEntityId: blueprint.id,
          summary: 'Backfilled from existing Business Genome / Blueprint data',
          evidenceStrength: 0.7,
        });
        evidenceAttached++;
      }
    }

    await this.prisma.client.businessBlueprint.update({
      where: { businessId },
      data: { lastGenomeSyncAt: new Date() },
    });

    return { factsUpserted, evidenceAttached };
  }
}

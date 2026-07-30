import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BusinessRisk } from '@prisma/client';
import { BlueprintService } from '../blueprint/blueprint.service';
import type { BlueprintData, BlueprintRiskItem, BlueprintRiskProfile } from '../blueprint/blueprint.types';
import { GovernanceService } from '../governance/governance.service';

const RISK_CATEGORIES: {
  key: keyof BlueprintRiskProfile;
  category: string;
}[] = [
  { key: 'financialRisks', category: 'FINANCIAL' },
  { key: 'legalRisks', category: 'LEGAL' },
  { key: 'marketRisks', category: 'MARKET' },
  { key: 'operationalRisks', category: 'OPERATIONAL' },
  { key: 'founderRisks', category: 'FOUNDER' },
];

@Injectable()
export class GenesisRiskRegisterService {
  private readonly logger = new Logger(GenesisRiskRegisterService.name);

  constructor(
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
  ) {}

  async generateRisks(businessId: string): Promise<BusinessRisk[]> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const existingRisks = await this.governance.findRisks(businessId, {});
    const existingKeys = new Set(
      existingRisks.map((r) => `${r.category}|${r.title.trim().toLowerCase()}`),
    );

    const created: BusinessRisk[] = [];

    for (const { key, category } of RISK_CATEGORIES) {
      const risks = (blueprint.riskProfile?.[key] as BlueprintRiskItem[] | undefined) || [];
      for (const risk of risks) {
        const newRisk = await this.ensureRisk(businessId, category, risk, existingKeys);
        if (newRisk) {
          created.push(newRisk);
        }
      }
    }

    if (typeof blueprint.riskProfile?.riskScore !== 'number') {
      const score = this.calculateRiskScore(blueprint);
      await this.blueprint.updateBlueprint(businessId, { riskProfile: { riskScore: score } });
    }

    return created;
  }

  private async ensureRisk(
    businessId: string,
    category: string,
    risk: BlueprintRiskItem,
    existingKeys: Set<string>,
  ): Promise<BusinessRisk | null> {
    const title = (risk.description || '').trim();
    if (!title) return null;

    const key = `${category}|${title.toLowerCase()}`;
    if (existingKeys.has(key)) {
      return null;
    }

    try {
      const created = await this.governance.createRisk(businessId, {
        title,
        description: title,
        category,
        severity: this.mapImpactToSeverity(risk.impact),
        likelihood: this.mapLikelihood(risk.likelihood),
        status: 'OPEN',
        mitigation: risk.mitigation,
        sourceType: 'business-genesis',
        sourceId: businessId,
      });
      existingKeys.add(key);
      return created;
    } catch (err: any) {
      this.logger.warn(
        `Failed to create ${category} risk "${title}" for ${businessId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private mapImpactToSeverity(impact: string | undefined): string {
    switch (impact) {
      case 'HIGH':
        return 'HIGH';
      case 'LOW':
        return 'LOW';
      case 'MEDIUM':
      default:
        return 'MEDIUM';
    }
  }

  private mapLikelihood(likelihood: string | undefined): string | undefined {
    switch (likelihood) {
      case 'HIGH':
        return 'ALMOST_CERTAIN';
      case 'MEDIUM':
        return 'POSSIBLE';
      case 'LOW':
        return 'RARE';
      default:
        return undefined;
    }
  }

  private calculateRiskScore(blueprint: BlueprintData): number {
    const allRisks = RISK_CATEGORIES.flatMap(
      ({ key }) => (blueprint.riskProfile?.[key] as BlueprintRiskItem[] | undefined) || [],
    );
    if (allRisks.length === 0) return 0;

    const high = allRisks.filter((r: BlueprintRiskItem) => r.impact === 'HIGH').length;
    const medium = allRisks.filter((r: BlueprintRiskItem) => r.impact === 'MEDIUM').length;
    const low = allRisks.filter((r: BlueprintRiskItem) => r.impact === 'LOW').length;

    const raw = high * 20 + medium * 10 + low * 3 + 5;
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
}

import { Injectable } from '@nestjs/common';
import type { BlueprintData, ComplianceItem } from '../blueprint/blueprint.types';
import type { GenesisReadinessScore } from './business-genesis.types';

@Injectable()
export class GenesisReadinessScorer {
  calculate(blueprint: BlueprintData): GenesisReadinessScore {
    const legal = this.scoreLegal(blueprint);
    const finance = this.scoreFinance(blueprint);
    const market = this.scoreMarket(blueprint);
    const operations = this.scoreOperations(blueprint);
    const compliance = this.scoreCompliance(blueprint);

    const overall = Math.round(
      legal * 0.25 + finance * 0.25 + market * 0.2 + operations * 0.15 + compliance * 0.15,
    );

    const blockers = this.buildBlockers({ legal, finance, market, operations, compliance });

    return {
      overall,
      legal,
      finance,
      market,
      operations,
      compliance,
      blockers,
    };
  }

  calculateComplianceScore(items: ComplianceItem[] | undefined): number {
    if (!items || items.length === 0) return 0;
    const complete = items.filter(
      (item) => item.status === 'DONE' || item.status === 'NOT_APPLICABLE',
    ).length;
    return Math.round((complete / items.length) * 100);
  }

  private scoreLegal(blueprint: BlueprintData): number {
    let score = 0;
    const legal = blueprint.legalProfile || {};
    const registration = blueprint.registrationProfile || {};

    if (legal.recommendedEntityType && legal.recommendedEntityType !== 'UNKNOWN') {
      score += 40;
    }
    if (legal.disclaimerAcceptedAt) {
      score += 30;
    }

    const registrationFields: (keyof typeof registration)[] = [
      'businessNameStatus',
      'companiesRegistryStatus',
      'birStatus',
      'nisEmployerStatus',
      'vatStatus',
      'businessBankStatus',
    ];
    const completed = registrationFields.filter((field) =>
      this.isRegistrationStepComplete(registration[field]),
    ).length;
    score += Math.round((completed / 6) * 30);

    return Math.min(100, score);
  }

  private scoreFinance(blueprint: BlueprintData): number {
    let score = 0;
    const projection = blueprint.projectionProfile || {};

    if (
      typeof projection.startupCapital === 'number' &&
      typeof projection.monthlyFixedCosts === 'number'
    ) {
      score += 40;
    }
    if (typeof projection.breakEvenRevenue === 'number') {
      score += 30;
    }
    if (typeof projection.runwayMonths === 'number') {
      score += 30;
    }

    return Math.min(100, score);
  }

  private scoreMarket(blueprint: BlueprintData): number {
    const marketProfile = blueprint.marketProfile || {};
    const customer = blueprint.customerModel || {};
    const offer = blueprint.offerArchitecture || {};
    const marketing = blueprint.marketingSystem || {};

    // Legacy signals (preserved so existing businesses are not penalized)
    let baseScore = 0;
    if (customer.idealCustomer && customer.idealCustomer.trim().length > 0) {
      baseScore += 40;
    }
    if (offer.coreOffer && Object.keys(offer.coreOffer).length > 0) {
      baseScore += 30;
    }
    if (marketing.channels && marketing.channels.length > 0) {
      baseScore += 30;
    }

    // New strategy signals (bonuses)
    const opportunityScore = typeof marketProfile.marketOpportunityScore === 'number'
      ? Math.max(0, Math.min(100, marketProfile.marketOpportunityScore))
      : 0;
    const generatedBonus = marketProfile.marketStrategyGeneratedAt ? 10 : 0;
    const competitorBonus = Math.min((marketProfile.competitorCount || 0) * 5, 10);

    return Math.min(100, Math.round(baseScore + opportunityScore * 0.1 + generatedBonus + competitorBonus));
  }

  private scoreOperations(blueprint: BlueprintData): number {
    let score = 0;
    const ops = blueprint.operationsSystem || {};
    const workflow = blueprint.workflowModel || {};
    const ai = blueprint.aiPreferences || {};

    if (ops.coreWorkflows && ops.coreWorkflows.length > 0) {
      score += 50;
    }
    if (workflow.primaryWorkflow && workflow.primaryWorkflow.trim().length > 0) {
      score += 30;
    }
    if (typeof ai.autonomyLevel === 'number') {
      score += 20;
    }

    return Math.min(100, score);
  }

  private scoreCompliance(blueprint: BlueprintData): number {
    const items = blueprint.complianceProfile?.complianceItems;
    return this.calculateComplianceScore(items);
  }

  private isRegistrationStepComplete(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') {
      const incomplete = ['NOT_STARTED', 'PENDING', 'IN_PROGRESS', ''];
      return !incomplete.includes(value.trim().toUpperCase());
    }
    return true;
  }

  private buildBlockers(scores: {
    legal: number;
    finance: number;
    market: number;
    operations: number;
    compliance: number;
  }): string[] {
    const blockers: string[] = [];
    const actions: Record<keyof typeof scores, string> = {
      legal: 'confirm your entity type, register the business name, and complete tax/BIR registration',
      finance: 'finalise startup costs, set pricing, and confirm your break-even and runway projections',
      market: 'define your ideal customer, validate your core offer, and choose launch channels',
      operations: 'document your core workflow, set up CRM/payments, and define your support process',
      compliance: 'complete the critical compliance checklist items and schedule any licence reviews',
    };

    for (const [domain, score] of Object.entries(scores)) {
      if (score < 60) {
        const label = domain.charAt(0).toUpperCase() + domain.slice(1);
        blockers.push(`${label} readiness is low — next: ${actions[domain as keyof typeof scores]}.`);
      }
    }

    return blockers;
  }
}

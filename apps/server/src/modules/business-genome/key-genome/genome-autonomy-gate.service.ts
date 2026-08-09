import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { GenomeCrossDomainService } from './genome-cross-domain.service';
import { GenomeFactService } from './genome-fact.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import type {
  CheckGenomeAutonomyGateInput,
  GenomeAutonomyGateDecision,
  GenomeAutonomyGateResult,
  GenomeCrossDomainDomainKey,
  GenomeCrossDomainRiskLevel,
  GenomeCrossDomainSnapshotData,
  GenomeFactData,
  ModuleReadinessData,
} from './key-genome.types';

const ALL_DOMAIN_KEYS: GenomeCrossDomainDomainKey[] = [
  'finance',
  'customer_sales_revenue',
  'operations_delivery',
  'marketing_growth',
];

const RISK_RANK: Record<GenomeCrossDomainRiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
  UNKNOWN: 0,
};

function maxRisk(
  a: GenomeCrossDomainRiskLevel,
  b: GenomeCrossDomainRiskLevel,
): GenomeCrossDomainRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

function sectionToDomain(
  section: string,
): GenomeCrossDomainDomainKey | null {
  const s = section.toUpperCase();
  if (s.includes('FINANCIAL')) return 'finance';
  if (s.includes('CUSTOMER') || s.includes('SALES')) return 'customer_sales_revenue';
  if (s.includes('OPERATIONS') || s.includes('DELIVERY')) return 'operations_delivery';
  if (s.includes('MARKETING') || s.includes('GROWTH')) return 'marketing_growth';
  return null;
}

function inferAffectedDomains(actionType: string): GenomeCrossDomainDomainKey[] {
  const t = actionType.toUpperCase();

  const domains: GenomeCrossDomainDomainKey[] = [];

  if (
    t.includes('FINANCE') ||
    t.includes('SPEND') ||
    t.includes('BUDGET') ||
    t.includes('PRICE') ||
    t.includes('INVOICE') ||
    t.includes('EXPENSE')
  ) {
    domains.push('finance');
  }

  if (
    t.includes('MARKETING') ||
    t.includes('AD') ||
    t.includes('CAMPAIGN') ||
    t.includes('CHANNEL') ||
    t.includes('CONTENT')
  ) {
    domains.push('marketing_growth');
  }

  if (
    t.includes('SALES') ||
    t.includes('CUSTOMER') ||
    t.includes('LEAD') ||
    t.includes('CRM') ||
    t.includes('INBOX') ||
    t.includes('FOLLOW') ||
    t.includes('ESCALATE')
  ) {
    domains.push('customer_sales_revenue');
  }

  if (
    t.includes('OPERATIONS') ||
    t.includes('DELIVERY') ||
    t.includes('FULFILL') ||
    t.includes('TASK') ||
    t.includes('SOP') ||
    t.includes('DOCUMENT')
  ) {
    domains.push('operations_delivery');
  }

  return domains.length > 0 ? domains : [...ALL_DOMAIN_KEYS];
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

@Injectable()
export class GenomeAutonomyGateService {
  constructor(
    @Inject(forwardRef(() => GenomeCrossDomainService))
    private readonly crossDomain: GenomeCrossDomainService,
    private readonly readiness: GenomeModuleReadinessService,
    private readonly facts: GenomeFactService,
    private readonly memory: GenomeMemoryService,
  ) {}

  async checkGate(
    input: CheckGenomeAutonomyGateInput,
  ): Promise<GenomeAutonomyGateResult> {
    const affectedDomains =
      input.affectedDomains && input.affectedDomains.length > 0
        ? input.affectedDomains
        : inferAffectedDomains(input.actionType);

    const snapshot = await this.ensureSnapshot(input.businessId);
    const readinessList = await this.readiness.getReadiness(input.businessId);
    const facts = await this.facts.listFacts(input.businessId);

    const evaluation = this.evaluate({
      input,
      affectedDomains,
      snapshot,
      readinessList: Array.isArray(readinessList) ? readinessList : [],
      facts,
    });

    await this.memory.createMemoryEvent({
      businessId: input.businessId,
      sourceType: 'CROSS_DOMAIN_GENOME',
      sourceEntityId: input.proposedBy ?? null,
      eventType: 'AUTONOMY_GATE_DECISION_RECORDED',
      domain: 'CROSS_DOMAIN',
      section: 'CROSS_DOMAIN',
      title: `Autonomy gate ${evaluation.decision} for ${input.actionType}`,
      summary: `Decision: ${evaluation.decision}. Risk ${evaluation.riskLevel}, readiness ${evaluation.readinessScore}, confidence ${evaluation.confidenceScore}.`,
      outcome:
        evaluation.decision === 'ALLOW'
          ? 'SUCCESS'
          : evaluation.decision === 'BLOCK'
            ? 'FAILURE'
            : 'MIXED',
      impactScore: evaluation.readinessScore / 100,
      confidenceDelta: 0,
      evidence: [
        {
          actionType: input.actionType,
          affectedDomains,
          decision: evaluation.decision,
          riskLevel: evaluation.riskLevel,
          blockingReasons: evaluation.blockingReasons,
          approvalReasons: evaluation.approvalReasons,
        },
      ],
      metadata: {
        actionType: input.actionType,
        affectedDomains,
        decision: evaluation.decision,
        riskLevel: evaluation.riskLevel,
        payload: input.payload ?? {},
      },
      occurredAt: new Date().toISOString(),
    });

    return evaluation;
  }

  private evaluate(context: {
    input: CheckGenomeAutonomyGateInput;
    affectedDomains: GenomeCrossDomainDomainKey[];
    snapshot: GenomeCrossDomainSnapshotData | null;
    readinessList: ModuleReadinessData[];
    facts: GenomeFactData[];
  }): GenomeAutonomyGateResult {
    const { input, affectedDomains, snapshot, readinessList, facts } = context;

    const blockingReasons: string[] = [];
    const approvalReasons: string[] = [];
    const evidenceWarnings: string[] = [];

    // Overall cross-domain risk
    let overallRisk: GenomeCrossDomainRiskLevel = snapshot?.overallRiskLevel ?? 'UNKNOWN';
    if (overallRisk === 'CRITICAL') {
      blockingReasons.push('Cross-domain risk is CRITICAL.');
    } else if (overallRisk === 'HIGH') {
      approvalReasons.push('Cross-domain risk is HIGH.');
    }

    // Domain-level risk and readiness
    const domainScores = affectedDomains.map((domain) => {
      const score = snapshot?.domainScores.find((d) => d.domain === domain);
      return { domain, score };
    });

    for (const { domain, score } of domainScores) {
      if (!score) {
        blockingReasons.push(`No cross-domain snapshot data for ${domain}.`);
        overallRisk = maxRisk(overallRisk, 'UNKNOWN');
        continue;
      }

      if (score.riskLevel === 'CRITICAL') {
        blockingReasons.push(`${domain} risk is CRITICAL.`);
      } else if (score.riskLevel === 'HIGH') {
        approvalReasons.push(`${domain} risk is HIGH.`);
      }

      if (score.healthScore < 40) {
        blockingReasons.push(
          `${domain} readiness is critically low (${score.healthScore}/100).`,
        );
      } else if (score.healthScore < 70) {
        approvalReasons.push(
          `${domain} readiness is borderline (${score.healthScore}/100).`,
        );
      }

      overallRisk = maxRisk(overallRisk, score.riskLevel);
    }

    const readinessScore =
      domainScores.length > 0
        ? Math.round(
            domainScores.reduce(
              (sum, { score }) => sum + (score?.healthScore ?? 0),
              0,
            ) / domainScores.length,
          )
        : snapshot?.overallHealthScore ?? 0;

    // Capacity / finance constraints from snapshot
    if (snapshot) {
      const opsRisk = snapshot.domainRisks.operations_delivery;
      const financeRisk = snapshot.domainRisks.finance;

      if (opsRisk === 'CRITICAL') {
        blockingReasons.push(
          'Operations capacity is critically constrained; execution may overload delivery.',
        );
      } else if (opsRisk === 'HIGH') {
        approvalReasons.push(
          'Operations capacity is constrained; execution may overload delivery.',
        );
      }

      if (financeRisk === 'CRITICAL') {
        blockingReasons.push(
          'Finance risk is CRITICAL; new spend or commitments are blocked.',
        );
      } else if (financeRisk === 'HIGH') {
        approvalReasons.push(
          'Finance risk is HIGH; financial approval is recommended.',
        );
      }
    }

    // Fact confidence and evidence strength for affected domains
    const relevantFacts = facts.filter((f) => {
      const factDomain = sectionToDomain(f.section);
      return factDomain && affectedDomains.includes(factDomain);
    });

    const confidenceScore =
      relevantFacts.length > 0
        ? Math.round(
            (relevantFacts.reduce(
              (sum, f) => sum + clamp(f.score.confidence, 0, 1),
              0,
            ) /
              relevantFacts.length) *
              100,
          )
        : 0;

    if (relevantFacts.length === 0) {
      evidenceWarnings.push(
        'No Genome facts found for the affected domains.',
      );
    } else {
      const lowConfidenceFacts = relevantFacts.filter(
        (f) => clamp(f.score.confidence, 0, 1) < 0.5,
      );
      if (lowConfidenceFacts.length > 0) {
        evidenceWarnings.push(
          `${lowConfidenceFacts.length} fact(s) in affected domains have low confidence (< 50%).`,
        );
      }

      const unverifiedFacts = relevantFacts.filter(
        (f) =>
          (f.verificationStatus === 'UNVERIFIED_IMPORTED' ||
            f.verificationStatus === 'INFERRED') &&
          clamp(f.score.confidence, 0, 1) < 0.6,
      );
      if (unverifiedFacts.length > 0) {
        evidenceWarnings.push(
          `${unverifiedFacts.length} fact(s) are unverified or inferred with weak confidence.`,
        );
      }
    }

    if (confidenceScore < 40) {
      evidenceWarnings.push(
        `Average fact confidence is low (${confidenceScore}/100).`,
      );
    }

    // Module readiness blockers
    for (const moduleReadiness of readinessList) {
      if (moduleReadiness.riskLevel === 'CRITICAL') {
        blockingReasons.push(
          `${moduleReadiness.module} module readiness risk is CRITICAL.`,
        );
      } else if (moduleReadiness.riskLevel === 'HIGH') {
        approvalReasons.push(
          `${moduleReadiness.module} module readiness risk is HIGH.`,
        );
      }

      if (moduleReadiness.readinessScore < 40) {
        blockingReasons.push(
          `${moduleReadiness.module} readiness is critically low (${moduleReadiness.readinessScore}%).`,
        );
      }
    }

    // Decide
    const decision = this.decide({
      overallRisk,
      readinessScore,
      confidenceScore,
      hasBlockingReasons: blockingReasons.length > 0,
      hasApprovalReasons: approvalReasons.length > 0,
      hasEvidenceWarnings: evidenceWarnings.length > 0,
    });

    const recommendedNextStep = this.recommendedNextStep(
      decision,
      affectedDomains,
      blockingReasons,
      evidenceWarnings,
    );

    return {
      businessId: input.businessId,
      actionType: input.actionType,
      affectedDomains,
      decision,
      riskLevel: overallRisk,
      readinessScore,
      confidenceScore,
      blockingReasons,
      approvalReasons,
      evidenceWarnings,
      recommendedNextStep,
      checkedAt: new Date().toISOString(),
    };
  }

  private decide(context: {
    overallRisk: GenomeCrossDomainRiskLevel;
    readinessScore: number;
    confidenceScore: number;
    hasBlockingReasons: boolean;
    hasApprovalReasons: boolean;
    hasEvidenceWarnings: boolean;
  }): GenomeAutonomyGateDecision {
    const {
      overallRisk,
      readinessScore,
      confidenceScore,
      hasBlockingReasons,
      hasApprovalReasons,
    } = context;

    if (overallRisk === 'CRITICAL' || hasBlockingReasons) {
      return 'BLOCK';
    }

    if (confidenceScore < 40 || readinessScore < 40) {
      return 'NEEDS_MORE_EVIDENCE';
    }

    if (
      overallRisk === 'HIGH' ||
      readinessScore < 70 ||
      confidenceScore < 65 ||
      hasApprovalReasons
    ) {
      return 'ALLOW_WITH_APPROVAL';
    }

    return 'ALLOW';
  }

  private recommendedNextStep(
    decision: GenomeAutonomyGateDecision,
    affectedDomains: GenomeCrossDomainDomainKey[],
    blockingReasons: string[],
    evidenceWarnings: string[],
  ): string {
    switch (decision) {
      case 'BLOCK':
        return `Resolve the following before proceeding: ${blockingReasons.join(' ')}`;
      case 'NEEDS_MORE_EVIDENCE':
        return `Strengthen Genome facts and evidence for ${affectedDomains.join(', ')} before retrying.`;
      case 'ALLOW_WITH_APPROVAL':
        return `Escalate to a human approver; action is safe only with explicit approval.`;
      case 'ALLOW':
      default:
        if (evidenceWarnings.length > 0) {
          return `Action is cleared, but monitor ${evidenceWarnings.join(' ')}`;
        }
        return 'Action is cleared for autonomous execution.';
    }
  }

  private async ensureSnapshot(
    businessId: string,
  ): Promise<GenomeCrossDomainSnapshotData | null> {
    const latest = await this.crossDomain.getLatestCrossDomainSnapshot(businessId);
    if (latest) return latest;
    try {
      return await this.crossDomain.computeCrossDomainSnapshot(businessId);
    } catch {
      return null;
    }
  }
}

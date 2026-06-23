import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GenomeDepartmentService } from './genome-department.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeMemoryService } from './genome-memory.service';
import {
  getDepartmentDefinition,
  KEY_GENOME_DEPARTMENTS,
  type GenomeDepartmentDefinition,
} from './key-genome-departments';
import {
  KEY_GENOME_SECTION_CONFIG,
  type GenomeFactRequirement,
  type KeyGenomeModuleName,
  type KeyGenomeSection,
} from './key-genome.ontology';
import type {
  GenomeDepartmentData,
  GenomeDepartmentGap,
  GenomeDepartmentRecommendedAction,
  GenomeFactData,
  GenomeMemoryEventData,
  GenomeRecommendationData,
  GenomeSignalData,
  ModuleReadinessData,
  RiskLevel,
  SectionGenomeScore,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[_\s.]/g, '');
}

function factMatchesRequirement(fact: GenomeFactData, req: GenomeFactRequirement): boolean {
  if (fact.section !== req.section) return false;

  const reqDomain = normalizeToken(req.domain);
  const reqField = normalizeToken(req.field);
  const factDomain = normalizeToken(fact.domain);
  let factField = normalizeToken(fact.field);

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

function findMatchingFact(
  req: GenomeFactRequirement,
  facts: GenomeFactData[],
): GenomeFactData | undefined {
  return facts.find((f) => factMatchesRequirement(f, req));
}

interface ComputationContext {
  facts: GenomeFactData[];
  sectionMap: Map<string, SectionGenomeScore>;
  moduleMap: Map<string, ModuleReadinessData>;
  signals: GenomeSignalData[];
  recommendations: GenomeRecommendationData[];
  memoryEvents: GenomeMemoryEventData[];
}

@Injectable()
export class DepartmentReadinessService {
  constructor(
    private readonly departments: GenomeDepartmentService,
    private readonly scoring: GenomeScoringService,
    private readonly readiness: GenomeModuleReadinessService,
    private readonly signals: GenomeSignalService,
    private readonly recommendations: GenomeRecommendationService,
    private readonly memory: GenomeMemoryService,
  ) {}

  async computeDepartmentReadiness(businessId: string): Promise<GenomeDepartmentData[]> {
    const seeded = await this.departments.seedDepartments(businessId);
    const context = await this.loadContext(businessId);

    const computed: GenomeDepartmentData[] = [];
    for (const dept of seeded) {
      const computedDept = await this.computeOneDepartmentWithContext(businessId, dept.code, context);
      computed.push(computedDept);
    }

    return computed;
  }

  async computeOneDepartment(
    businessId: string,
    code: GenomeDepartmentData['code'],
  ): Promise<GenomeDepartmentData> {
    await this.departments.seedDepartments(businessId);
    const context = await this.loadContext(businessId);
    return this.computeOneDepartmentWithContext(businessId, code, context);
  }

  private async loadContext(businessId: string): Promise<ComputationContext> {
    const facts = await this.scoring.computeFactScores(businessId);
    const score = this.scoring.computeBusinessScore(businessId, facts);
    const sectionMap = new Map(score.sections.map((s) => [s.section, s]));
    const moduleReadiness = await this.readiness.computeReadiness(businessId, facts);
    const moduleMap = new Map(moduleReadiness.map((r) => [r.module, r]));

    const [signals, recommendations, memoryEvents] = await Promise.all([
      this.signals.listSignals(businessId, { status: 'NEW', minConfidence: 0.7, limit: 100 }),
      this.recommendations.listRecommendations(businessId, { status: 'ACTIVE', limit: 100 }),
      this.memory.listMemoryEvents(businessId, { limit: 200 }),
    ]);

    return { facts, sectionMap, moduleMap, signals, recommendations, memoryEvents };
  }

  private async computeOneDepartmentWithContext(
    businessId: string,
    code: GenomeDepartmentData['code'],
    context: ComputationContext,
  ): Promise<GenomeDepartmentData> {
    const definition = getDepartmentDefinition(code);
    if (!definition) {
      throw new Error(`Unknown department code: ${code}`);
    }

    const maturityScore = this.computeMaturityScore(definition, context.sectionMap);
    const readinessScore = this.computeReadinessScore(definition, context.moduleMap);
    const confidenceScore = this.computeConfidenceScore(
      definition,
      context.sectionMap,
      context.memoryEvents,
    );
    const gaps = this.buildDepartmentGaps(definition, context);
    const recommendedActions = this.buildRecommendedActions(definition, gaps, context);
    const riskLevel = this.computeRiskLevel(
      definition,
      maturityScore,
      readinessScore,
      context.moduleMap,
      context.sectionMap,
    );
    const automationAllowed = this.computeAutomationAllowed(
      definition,
      maturityScore,
      readinessScore,
      riskLevel,
    );

    return this.departments.upsertDepartmentSnapshot(businessId, {
      code,
      maturityScore,
      readinessScore,
      confidenceScore,
      riskLevel,
      automationAllowed,
      gapSummary: asJsonValue(gaps) as unknown as GenomeDepartmentData['gapSummary'],
      recommendedActions: asJsonValue(recommendedActions) as unknown as GenomeDepartmentData['recommendedActions'],
    });
  }

  private computeMaturityScore(
    definition: GenomeDepartmentDefinition,
    sectionMap: Map<string, SectionGenomeScore>,
  ): number {
    const primaryScores = definition.primarySections.map(
      (section) => (sectionMap.get(section)?.score.overall ?? 0) * 100,
    );
    const supportingScores = definition.supportingSections.map(
      (section) => (sectionMap.get(section)?.score.overall ?? 0) * 100,
    );

    const primaryAverage =
      primaryScores.length === 0 ? 0 : primaryScores.reduce((a, b) => a + b, 0) / primaryScores.length;
    const supportingAverage =
      supportingScores.length === 0
        ? 0
        : supportingScores.reduce((a, b) => a + b, 0) / supportingScores.length;

    return clamp(primaryAverage * 0.7 + supportingAverage * 0.3);
  }

  private computeReadinessScore(
    definition: GenomeDepartmentDefinition,
    moduleMap: Map<string, ModuleReadinessData>,
  ): number {
    const scores = definition.impactedModules.map((module) => moduleMap.get(module)?.readinessScore ?? 0);
    if (scores.length === 0) return 0;
    return clamp(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  private computeConfidenceScore(
    definition: GenomeDepartmentDefinition,
    sectionMap: Map<string, SectionGenomeScore>,
    memoryEvents: ComputationContext['memoryEvents'],
  ): number {
    const scores = definition.primarySections.map(
      (section) => (sectionMap.get(section)?.score.confidence ?? 0) * 100,
    );
    if (scores.length === 0) return 0;
    const baseConfidence = scores.reduce((a, b) => a + b, 0) / scores.length;

    const relatedMemory = memoryEvents.filter(
      (m) =>
        (m.section &&
          (definition.primarySections.includes(m.section as KeyGenomeSection) ||
            definition.supportingSections.includes(m.section as KeyGenomeSection))) ||
        (m.domain &&
          definition.impactedModules.includes(m.domain as KeyGenomeModuleName)),
    );

    const positiveMemory = relatedMemory.filter((m) => m.outcome === 'SUCCESS').length;
    const failedMemory = relatedMemory.filter((m) => m.outcome === 'FAILURE').length;
    const memoryAdjustment = (positiveMemory - failedMemory) * 5;

    return clamp(baseConfidence + memoryAdjustment);
  }

  private computeRiskLevel(
    definition: GenomeDepartmentDefinition,
    maturityScore: number,
    readinessScore: number,
    moduleMap: Map<string, ModuleReadinessData>,
    sectionMap: Map<string, SectionGenomeScore>,
  ): RiskLevel {
    const hasBlockedModule = definition.impactedModules.some(
      (module) => moduleMap.get(module)?.automationAllowed === false,
    );

    const anyPrimarySectionVeryWeak = definition.primarySections.some(
      (section) => (sectionMap.get(section)?.score.overall ?? 0) < 0.35,
    );

    if (definition.autonomySensitive && readinessScore < 40 && anyPrimarySectionVeryWeak) {
      return 'CRITICAL';
    }

    if (readinessScore < 40) {
      return 'CRITICAL';
    }

    if (readinessScore < 60 || maturityScore < 50 || hasBlockedModule) {
      return 'HIGH';
    }

    if (readinessScore < 75 || maturityScore < 70) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private computeAutomationAllowed(
    definition: GenomeDepartmentDefinition,
    maturityScore: number,
    readinessScore: number,
    riskLevel: RiskLevel,
  ): boolean {
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') return false;

    if (definition.autonomySensitive) {
      return readinessScore >= 85 && maturityScore >= 80 && riskLevel === 'LOW';
    }

    return readinessScore >= 75 && maturityScore >= 70;
  }

  buildDepartmentGaps(
    definition: GenomeDepartmentDefinition,
    context: ComputationContext,
  ): GenomeDepartmentGap[] {
    const gaps: GenomeDepartmentGap[] = [];

    // Missing facts from section requirements.
    for (const section of [...definition.primarySections, ...definition.supportingSections]) {
      const config = KEY_GENOME_SECTION_CONFIG[section as KeyGenomeSection];
      if (!config) continue;

      for (const req of config.requiredFacts) {
        const fact = findMatchingFact(req, context.facts);
        if (!fact) {
          gaps.push({
            type: 'MISSING_FACT',
            section,
            domain: req.domain,
            field: req.field,
            reason: `${definition.name} needs ${req.label.toLowerCase()} before ${section} can be trusted.`,
            impact: req.impact,
          });
        } else if (fact.score.confidence < 0.35) {
          gaps.push({
            type: 'LOW_CONFIDENCE',
            section,
            domain: req.domain,
            field: req.field,
            reason: `${definition.name} has weak confidence in ${req.label.toLowerCase()} (${Math.round(fact.score.confidence * 100)}%).`,
            impact: req.impact === 'BLOCKING' ? 'DEGRADED' : 'OPTIONAL',
          });
        }
      }
    }

    // Low section scores.
    for (const section of definition.primarySections) {
      const sectionScore = context.sectionMap.get(section)?.score;
      if (sectionScore && sectionScore.overall < 0.45) {
        gaps.push({
          type: 'WEAK_SECTION',
          section,
          reason: `${definition.name} primary section ${section} is at ${Math.round(sectionScore.overall * 100)}% maturity.`,
          impact: 'DEGRADED',
        });
      }
    }

    // Impacted modules with automation blocked.
    for (const module of definition.impactedModules) {
      const moduleReadiness = context.moduleMap.get(module);
      if (moduleReadiness && !moduleReadiness.automationAllowed) {
        const blockingFact = moduleReadiness.missingFacts.find((m) => m.impact === 'BLOCKING');
        gaps.push({
          type: 'READINESS_BLOCKER',
          domain: module,
          reason: `${definition.name} is blocked because ${module} readiness is ${moduleReadiness.readinessScore}% and automation is not allowed.${blockingFact ? ` Missing: ${blockingFact.domain}.${blockingFact.field}.` : ''}`,
          impact: 'BLOCKING',
        });
      }
    }

    // High-confidence signals in related sections.
    for (const signal of context.signals) {
      if (
        definition.primarySections.includes(signal.section as KeyGenomeSection) ||
        definition.supportingSections.includes(signal.section as KeyGenomeSection)
      ) {
        const impact =
          signal.signalType === 'READINESS_BLOCKER' || signal.signalType === 'FACT_CONFLICT'
            ? 'BLOCKING'
            : signal.signalType === 'MISSING_FACT' || signal.signalType === 'STALE_FACT'
              ? 'DEGRADED'
              : 'OPTIONAL';
        gaps.push({
          type: 'RISK',
          section: signal.section,
          domain: signal.domain,
          field: signal.field ?? undefined,
          reason: `${definition.name} has an active ${signal.signalType} signal in ${signal.domain}${signal.field ? `.${signal.field}` : ''} (${Math.round(signal.confidence * 100)}% confidence).`,
          impact,
        });
      }
    }

    // Failed memory events in related domains.
    for (const event of context.memoryEvents) {
      if (event.outcome !== 'FAILURE') continue;

      const sectionMatch =
        event.section &&
        (definition.primarySections.includes(event.section as KeyGenomeSection) ||
          definition.supportingSections.includes(event.section as KeyGenomeSection));
      const moduleMatch =
        event.domain && definition.impactedModules.includes(event.domain as KeyGenomeModuleName);

      if (sectionMatch || moduleMatch) {
        gaps.push({
          type: 'RISK',
          section: event.section ?? undefined,
          domain: event.domain ?? undefined,
          reason: `${definition.name} has a failed memory event: ${event.title ?? event.domain ?? event.section}.`,
          impact: 'DEGRADED',
        });
      }
    }

    // Active recommendations in related domains.
    for (const recommendation of context.recommendations) {
      const domainMatchesSection =
        definition.primarySections.includes(recommendation.domain as KeyGenomeSection) ||
        definition.supportingSections.includes(recommendation.domain as KeyGenomeSection);
      const domainMatchesModule = definition.impactedModules.includes(
        recommendation.domain as KeyGenomeModuleName,
      );

      if (domainMatchesSection || domainMatchesModule) {
        gaps.push({
          type: 'RISK',
          section: domainMatchesSection ? recommendation.domain : undefined,
          domain: recommendation.domain,
          reason: `${definition.name} has an active recommendation: ${recommendation.title}`,
          impact: recommendation.riskLevel === 'HIGH' || recommendation.riskLevel === 'CRITICAL' ? 'BLOCKING' : 'DEGRADED',
        });
      }
    }

    return gaps;
  }

  buildRecommendedActions(
    definition: GenomeDepartmentDefinition,
    gaps: GenomeDepartmentGap[],
    _context: ComputationContext,
  ): GenomeDepartmentRecommendedAction[] {
    const actions: GenomeDepartmentRecommendedAction[] = [];

    const missingFactGaps = gaps.filter((g) => g.type === 'MISSING_FACT');
    const lowConfidenceGaps = gaps.filter((g) => g.type === 'LOW_CONFIDENCE');
    const readinessBlockers = gaps.filter((g) => g.type === 'READINESS_BLOCKER');
    const weakSections = gaps.filter((g) => g.type === 'WEAK_SECTION');
    const signalGaps = gaps.filter((g) => g.type === 'RISK');

    if (missingFactGaps.length > 0) {
      const blocking = missingFactGaps.filter((g) => g.impact === 'BLOCKING');
      actions.push({
        label: `Complete ${missingFactGaps.length} missing fact${missingFactGaps.length === 1 ? '' : 's'} for ${definition.name}`,
        reason: `Missing facts prevent ${definition.name} from reaching readiness.${blocking.length > 0 ? ` ${blocking.length} are blocking.` : ''}`,
        priority: blocking.length > 0 ? 'CRITICAL' : 'HIGH',
      });
    }

    if (lowConfidenceGaps.length > 0) {
      actions.push({
        label: `Verify evidence for ${definition.name}`,
        reason: `${lowConfidenceGaps.length} fact${lowConfidenceGaps.length === 1 ? '' : 's'} in ${definition.name} have low confidence.`,
        priority: 'MEDIUM',
      });
    }

    if (readinessBlockers.length > 0) {
      actions.push({
        label: `Resolve ${readinessBlockers.length} readiness blocker${readinessBlockers.length === 1 ? '' : 's'} for ${definition.name}`,
        reason: `Impacted modules are not ready for autonomous operation.`,
        priority: 'HIGH',
      });
    }

    if (weakSections.length > 0) {
      const sections = weakSections.map((g) => g.section).filter(Boolean);
      actions.push({
        label: `Strengthen ${definition.name} primary section${sections.length === 1 ? '' : 's'}`,
        reason: `Sections ${sections.join(', ')} are below maturity threshold.`,
        priority: 'MEDIUM',
      });
    }

    if (signalGaps.length > 0) {
      actions.push({
        label: `Review ${signalGaps.length} active signal${signalGaps.length === 1 ? '' : 's'} for ${definition.name}`,
        reason: `High-confidence signals may change ${definition.name} facts or readiness.`,
        priority: signalGaps.some((g) => g.impact === 'BLOCKING') ? 'HIGH' : 'MEDIUM',
      });
    }

    if (actions.length === 0) {
      actions.push({
        label: `Run readiness recompute for ${definition.name}`,
        reason: `${definition.name} appears healthy. Recompute after fact updates to confirm.`,
        priority: 'LOW',
      });
    }

    return actions.slice(0, 7);
  }
}

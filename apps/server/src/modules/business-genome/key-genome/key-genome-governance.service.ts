import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeExperimentService } from './genome-experiment.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeDepartmentService } from './genome-department.service';
import type {
  GenomeExperimentData,
  GenomeRecommendationData,
  GenomeSignalData,
  KeyGenomeGovernanceItem,
  KeyGenomeGovernanceItemAction,
  KeyGenomeGovernanceSummary,
  ModuleReadinessData,
} from './key-genome.types';

function titleCase(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function signalTypeLabel(type: string | undefined | null): string {
  return titleCase(type);
}

function priorityRank(priority: KeyGenomeGovernanceItem['priority']): number {
  switch (priority) {
    case 'CRITICAL':
      return 4;
    case 'HIGH':
      return 3;
    case 'MEDIUM':
      return 2;
    default:
      return 1;
  }
}

function sortByPriorityAndDate(a: KeyGenomeGovernanceItem, b: KeyGenomeGovernanceItem): number {
  const rankDiff = priorityRank(b.priority) - priorityRank(a.priority);
  if (rankDiff !== 0) return rankDiff;
  const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bDate - aDate;
}

@Injectable()
export class KeyGenomeGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: GenomeSignalService,
    private readonly recommendations: GenomeRecommendationService,
    private readonly experiments: GenomeExperimentService,
    private readonly readiness: GenomeModuleReadinessService,
    private readonly scoring: GenomeScoringService,
    private readonly departments: GenomeDepartmentService,
  ) {}

  async summary(businessId: string): Promise<KeyGenomeGovernanceSummary> {
    const [
      newSignals,
      acceptedSignals,
      activeRecommendations,
      acceptedRecommendations,
      experiments,
      readinessList,
      departments,
    ] = await Promise.all([
      this.signals.listSignals(businessId, { status: 'NEW', limit: 25 }),
      this.signals.listSignals(businessId, { status: 'ACCEPTED', limit: 25 }),
      this.recommendations.listRecommendations(businessId, { status: 'ACTIVE', limit: 25 }),
      this.recommendations.listRecommendations(businessId, { status: 'ACCEPTED', limit: 25 }),
      this.experiments.listExperiments(businessId, { limit: 25 }),
      this.readiness.getReadiness(businessId) as Promise<ModuleReadinessData[]>,
      this.departments.listDepartments(businessId),
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [memoryEventsLast7Days, failedOutcomesLast30Days] = await Promise.all([
      this.prisma.client.genomeMemoryEvent.count({
        where: { businessId, createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.client.genomeMemoryEvent.count({
        where: { businessId, outcome: 'FAILURE', createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const [autonomyBlocks, facts] = await Promise.all([
      this.loadAutonomyBlocks(businessId),
      this.scoring.computeFactScores(businessId),
    ]);
    const score = this.scoring.computeBusinessScore(businessId, facts);

    const signalItems = [
      ...newSignals.map((s) => this.signalToGovernanceItem(s)),
      ...acceptedSignals.map((s) => this.signalToGovernanceItem(s)),
    ];

    const recommendationItems = [
      ...activeRecommendations.map((r) => this.recommendationToGovernanceItem(r)),
      ...acceptedRecommendations.map((r) => this.recommendationToGovernanceItem(r)),
    ];

    const experimentItems = experiments.map((e) => this.experimentToGovernanceItem(e));

    const readinessItems = readinessList
      .filter((r) => !r.automationAllowed || r.readinessScore < 70)
      .map((r) => this.readinessToGovernanceItem(r));

    const autonomyItems = autonomyBlocks.map((b) => this.autonomyBlockToGovernanceItem(b));

    const weakSectionItems = score.sections
      .filter((s) => s.score.overall < 0.75)
      .map((s) => this.weakSectionToGovernanceItem(s));

    const allQueues = [
      ...signalItems,
      ...recommendationItems,
      ...experimentItems,
      ...readinessItems,
      ...autonomyItems,
      ...weakSectionItems,
    ];

    const urgentReviewItems = [...allQueues]
      .filter((i) => i.priority === 'CRITICAL' || i.priority === 'HIGH')
      .sort(sortByPriorityAndDate)
      .slice(0, 10);

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      counts: {
        newSignals: newSignals.length,
        acceptedSignals: acceptedSignals.length,
        activeRecommendations: activeRecommendations.length,
        acceptedRecommendations: acceptedRecommendations.length,
        runningExperiments: experiments.filter((e) => e.status === 'RUNNING').length,
        proposedExperiments: experiments.filter((e) => e.status === 'PROPOSED').length,
        blockedModules: readinessList.filter((r) => !r.automationAllowed).length,
        lowReadinessModules: readinessList.filter((r) => r.readinessScore < 70).length,
        autonomyBlockedActions: autonomyBlocks.length,
        memoryEventsLast7Days,
        failedOutcomesLast30Days,
        blockedDepartments: departments.filter((d) => !d.automationAllowed).length,
        weakDepartments: departments.filter((d) => d.maturityScore < 70).length,
      },
      urgentReviewItems,
      signalReviewQueue: signalItems.sort(sortByPriorityAndDate),
      recommendationQueue: recommendationItems.sort(sortByPriorityAndDate),
      experimentQueue: experimentItems.sort(sortByPriorityAndDate),
      readinessBlockers: readinessItems.sort(sortByPriorityAndDate),
      autonomyBlocks: autonomyItems.sort(sortByPriorityAndDate),
      departmentBlockers: departments
        .filter((d) => !d.automationAllowed || d.riskLevel === 'HIGH' || d.riskLevel === 'CRITICAL')
        .map((d) => this.departmentToGovernanceItem(d))
        .sort(sortByPriorityAndDate),
      genomeHealth: {
        overall: Math.round(score.overall * 100),
        confidence: Math.round(score.confidence * 100),
        readiness: Math.round(score.readiness * 100),
        weakestSections: [...score.sections]
          .sort((a, b) => a.score.overall - b.score.overall)
          .slice(0, 5)
          .map((s) => ({
            section: s.section,
            overall: Math.round(s.score.overall * 100),
            confidence: Math.round(s.score.confidence * 100),
            freshness: Math.round(s.score.freshness * 100),
          })),
      },
    };
  }

  async queue(businessId: string): Promise<KeyGenomeGovernanceItem[]> {
    const summary = await this.summary(businessId);
    return summary.urgentReviewItems;
  }

  private async loadAutonomyBlocks(
    businessId: string,
  ): Promise<Array<{ id: string; title: string; summary?: string | null; riskLevel: string; createdAt: Date }>> {
    const rows = await this.prisma.client.keyActionProposal.findMany({
      where: {
        businessId,
        status: 'PENDING',
        requiresApproval: true,
      },
      select: {
        id: true,
        title: true,
        summary: true,
        riskLevel: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return rows;
  }

  private signalToGovernanceItem(signal: GenomeSignalData): KeyGenomeGovernanceItem {
    const criticalTypes = new Set(['FACT_CONFLICT', 'READINESS_BLOCKER']);
    let priority: KeyGenomeGovernanceItem['priority'] = 'MEDIUM';
    if (criticalTypes.has(signal.signalType)) {
      priority = 'CRITICAL';
    } else if (signal.status === 'ACCEPTED') {
      priority = 'HIGH';
    } else if (signal.confidence >= 0.8) {
      priority = 'HIGH';
    }

    const actions: KeyGenomeGovernanceItemAction[] = [];
    if (signal.status === 'NEW') {
      actions.push(
        { label: 'Review', actionType: 'REVIEW' },
        { label: 'Accept', actionType: 'ACCEPT' },
        { label: 'Reject', actionType: 'REJECT' },
      );
    } else if (signal.status === 'REVIEWED') {
      actions.push(
        { label: 'Accept', actionType: 'ACCEPT' },
        { label: 'Reject', actionType: 'REJECT' },
      );
    } else if (signal.status === 'ACCEPTED') {
      actions.push(
        { label: 'Merge', actionType: 'MERGE' },
        { label: 'Reject', actionType: 'REJECT' },
      );
    } else {
      actions.push({ label: 'Open', actionType: 'OPEN' });
    }

    return {
      id: `signal-${signal.id}`,
      type: 'SIGNAL',
      priority,
      title: `${signalTypeLabel(signal.signalType)} in ${signal.domain ?? 'unknown'}`,
      summary: signal.reason ?? 'No summary provided.',
      source: signal.sourceModule,
      sourceId: signal.id,
      createdAt: signal.createdAt,
      actions,
    };
  }

  private recommendationToGovernanceItem(
    recommendation: GenomeRecommendationData,
  ): KeyGenomeGovernanceItem {
    let priority: KeyGenomeGovernanceItem['priority'] = 'MEDIUM';
    if (recommendation.riskLevel === 'CRITICAL' || recommendation.riskLevel === 'HIGH') {
      priority = 'HIGH';
    }
    if (recommendation.status === 'ACCEPTED') {
      priority = 'HIGH';
    }

    const actions: KeyGenomeGovernanceItemAction[] = [];
    if (recommendation.status === 'ACTIVE') {
      actions.push(
        { label: 'Accept', actionType: 'ACCEPT' },
        { label: 'Dismiss', actionType: 'DISMISS' },
      );
    } else if (recommendation.status === 'ACCEPTED') {
      actions.push(
        { label: 'Create action plan', actionType: 'BRIDGE' },
        { label: 'Dismiss', actionType: 'DISMISS' },
      );
    } else {
      actions.push({ label: 'Open', actionType: 'OPEN' });
    }

    return {
      id: `recommendation-${recommendation.id}`,
      type: 'RECOMMENDATION',
      priority,
      title: recommendation.title,
      summary: recommendation.insight,
      source: 'KEY Genome',
      sourceId: recommendation.id,
      createdAt: recommendation.createdAt,
      actions,
    };
  }

  private experimentToGovernanceItem(experiment: GenomeExperimentData): KeyGenomeGovernanceItem {
    let priority: KeyGenomeGovernanceItem['priority'] = 'LOW';
    if (experiment.status === 'PROPOSED') {
      priority = 'MEDIUM';
    } else if (experiment.status === 'RUNNING') {
      priority = this.isExperimentOverdue(experiment) ? 'HIGH' : 'MEDIUM';
    }

    const actions: KeyGenomeGovernanceItemAction[] = [];
    if (experiment.status === 'PROPOSED') {
      actions.push(
        { label: 'Start', actionType: 'START' },
        { label: 'Cancel', actionType: 'CANCEL' },
      );
    } else if (experiment.status === 'RUNNING') {
      actions.push(
        { label: 'Complete', actionType: 'COMPLETE' },
        { label: 'Cancel', actionType: 'CANCEL' },
      );
    } else {
      actions.push({ label: 'Open', actionType: 'OPEN' });
    }

    return {
      id: `experiment-${experiment.id}`,
      type: 'EXPERIMENT',
      priority,
      title: experiment.hypothesis,
      summary: experiment.action,
      source: 'KEY Genome',
      sourceId: experiment.id,
      createdAt: experiment.createdAt,
      actions,
    };
  }

  private isExperimentOverdue(experiment: GenomeExperimentData): boolean {
    if (!experiment.startedAt || experiment.status !== 'RUNNING') return false;
    const started = new Date(experiment.startedAt).getTime();
    const deadline = started + experiment.durationDays * 24 * 60 * 60 * 1000;
    return Date.now() > deadline;
  }

  private readinessToGovernanceItem(readiness: ModuleReadinessData): KeyGenomeGovernanceItem {
    const blockingCount = readiness.missingFacts.filter((m) => m.impact === 'BLOCKING').length;
    let priority: KeyGenomeGovernanceItem['priority'] = 'MEDIUM';
    if (!readiness.automationAllowed && readiness.readinessScore < 50) {
      priority = 'CRITICAL';
    } else if (!readiness.automationAllowed) {
      priority = 'HIGH';
    } else if (readiness.readinessScore < 70) {
      priority = 'MEDIUM';
    }

    return {
      id: `readiness-${readiness.module}`,
      type: 'READINESS_BLOCKER',
      priority,
      title: `${titleCase(readiness.module)} readiness is ${readiness.readinessScore}%`,
      summary:
        readiness.blockedReasons[0] ??
        `${blockingCount} blocking fact(s) prevent ${readiness.module} automation.`,
      source: 'KEY Genome',
      sourceId: readiness.module,
      createdAt: readiness.lastComputedAt,
      actions: [{ label: 'Open', actionType: 'OPEN' }],
    };
  }

  private autonomyBlockToGovernanceItem(block: {
    id: string;
    title: string;
    summary?: string | null;
    riskLevel: string;
    createdAt: Date;
  }): KeyGenomeGovernanceItem {
    const priority: KeyGenomeGovernanceItem['priority'] =
      block.riskLevel === 'CRITICAL' || block.riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM';

    return {
      id: `autonomy-${block.id}`,
      type: 'AUTONOMY_BLOCK',
      priority,
      title: block.title,
      summary: block.summary ?? 'Autonomy action awaiting approval.',
      source: 'KEY Autonomy',
      sourceId: block.id,
      createdAt: block.createdAt.toISOString(),
      actions: [{ label: 'Open', actionType: 'OPEN', href: '/app/key-autonomy' }],
    };
  }

  private departmentToGovernanceItem(department: {
    code: string;
    name: string;
    maturityScore: number;
    readinessScore: number;
    riskLevel: string;
    automationAllowed: boolean;
    gapSummary: Array<{ reason: string; impact: string }>;
    lastComputedAt?: string | null;
  }): KeyGenomeGovernanceItem {
    const priority: KeyGenomeGovernanceItem['priority'] =
      department.riskLevel === 'CRITICAL' || department.readinessScore < 40
        ? 'CRITICAL'
        : department.riskLevel === 'HIGH' || department.readinessScore < 60
          ? 'HIGH'
          : 'MEDIUM';

    const topGap = department.gapSummary[0];

    return {
      id: `department-${department.code}`,
      type: 'READINESS_BLOCKER',
      priority,
      title: `${department.name} department is not ready`,
      summary:
        topGap?.reason ??
        `${department.name} readiness is ${Math.round(department.readinessScore)}%. Automation is ${department.automationAllowed ? 'allowed' : 'blocked'}.`,
      source: 'KEY Genome',
      sourceId: department.code,
      createdAt: department.lastComputedAt ?? null,
      actions: [{ label: 'Open', actionType: 'OPEN', href: '/app/profile?tab=business-genome&section=departments' }],
    };
  }

  private weakSectionToGovernanceItem(section: {
    section: string;
    score: { overall: number; confidence: number; freshness: number };
  }): KeyGenomeGovernanceItem {
    const priority: KeyGenomeGovernanceItem['priority'] =
      section.score.overall < 0.55 ? 'HIGH' : 'MEDIUM';

    return {
      id: `weak-section-${section.section}`,
      type: 'WEAK_SECTION',
      priority,
      title: `${titleCase(section.section)} Genome section needs strengthening`,
      summary: `Overall ${Math.round(section.score.overall * 100)}%, confidence ${Math.round(
        section.score.confidence * 100,
      )}%, freshness ${Math.round(section.score.freshness * 100)}%.`,
      source: 'KEY Genome',
      sourceId: section.section,
      createdAt: null,
      actions: [{ label: 'Open', actionType: 'OPEN' }],
    };
  }
}

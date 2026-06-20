import { Inject, Injectable } from '@nestjs/common';
import { BusinessIntelligenceService } from '../intelligence/business-intelligence.service';
import { KeyExecutiveModeService } from '../intelligence/key-executive-mode.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { BusinessAssetsService } from '../business-assets/business-assets.service';
import { ConstitutionVersionService } from '../business-genome/constitution-version.service';
import { GenomeScoringService } from '../business-genome/key-genome/genome-scoring.service';
import { GenomeModuleReadinessService } from '../business-genome/key-genome/genome-module-readiness.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import { GenomeRecommendationService } from '../business-genome/key-genome/genome-recommendation.service';
import type { BusinessAsset } from '@prisma/client';
import type { KeyGenomeScore, ModuleReadinessData } from '../business-genome/key-genome/key-genome.types';
import type { KeyExecutiveMode } from '../intelligence/key-executive-mode.types';
import type {
  BusinessCommandCenterSnapshot,
  CommandCenterAction,
  CommandCenterConstitution,
  CommandCenterExecutiveMode,
  CommandCenterGenome,
  CommandCenterHealth,
  CommandCenterItem,
  CommandCenterKeyGenome,
  CommandCenterModuleReadiness,
  CommandCenterPriority,
} from './business-command-center.types';

const MODES: KeyExecutiveMode[] = [
  'STRATEGIST',
  'CFO',
  'CMO',
  'COO',
  'LEGAL_GUIDE',
  'GROWTH_ADVISOR',
  'RISK_OFFICER',
  'EXECUTIVE_ASSISTANT',
];

const MODE_LABELS: Record<KeyExecutiveMode, string> = {
  STRATEGIST: 'KEY Strategist',
  CFO: 'KEY CFO',
  CMO: 'KEY CMO',
  COO: 'KEY COO',
  LEGAL_GUIDE: 'KEY Legal Guide',
  GROWTH_ADVISOR: 'KEY Growth Advisor',
  RISK_OFFICER: 'KEY Risk Officer',
  EXECUTIVE_ASSISTANT: 'KEY Executive Assistant',
};

const TYPE_WEIGHT: Record<CommandCenterItem['type'], number> = {
  KEY_APPROVAL: 100,
  KEY_APPROVED: 95,
  TEMPORAL_URGENT: 90,
  MODULE_READINESS: 85,
  MISSING_FACT: 83,
  KEY_GENOME_GAP: 82,
  RISK: 80,
  ASSET_RISK: 75,
  GENOME_PROPOSAL: 65,
  GENOME_SIGNAL: 60,
  GENOME_RECOMMENDATION: 78,
  CONSTITUTION: 60,
  EXECUTIVE_MODE: 45,
  OPPORTUNITY: 40,
  DOCUMENT: 25,
};

@Injectable()
export class BusinessCommandCenterService {
  constructor(
    @Inject(BusinessIntelligenceService)
    private readonly intelligence: BusinessIntelligenceService,
    @Inject(KeyExecutiveModeService)
    private readonly keyModes: KeyExecutiveModeService,
    @Inject(KeyActionProposalService)
    private readonly keyAutonomy: KeyActionProposalService,
    @Inject(TemporalFlowService)
    private readonly temporal: TemporalFlowService,
    @Inject(GenomeEvolutionService)
    private readonly genomeEvolution: GenomeEvolutionService,
    @Inject(BlueprintService)
    private readonly blueprint: BlueprintService,
    @Inject(BusinessAssetsService)
    private readonly assets: BusinessAssetsService,
    @Inject(ConstitutionVersionService)
    private readonly constitution: ConstitutionVersionService,
    @Inject(GenomeScoringService)
    private readonly genomeScoring: GenomeScoringService,
    @Inject(GenomeModuleReadinessService)
    private readonly genomeReadiness: GenomeModuleReadinessService,
    @Inject(GenomeSignalService)
    private readonly genomeSignal: GenomeSignalService,
    @Inject(GenomeRecommendationService)
    private readonly genomeRecommendation: GenomeRecommendationService,
  ) {}

  async snapshot(businessId: string): Promise<BusinessCommandCenterSnapshot> {
    const [
      executiveBrief,
      modeBriefs,
      pendingApprovals,
      approvedAwaitingExecution,
      temporalAnalysis,
      genomeProposals,
      genome,
      rawAssets,
      latestConstitution,
      constitutionStaleness,
    ] = await Promise.all([
      this.intelligence.generateExecutiveBrief(businessId),
      Promise.all(MODES.map((mode) => this.keyModes.generateModeBrief(businessId, mode))),
      this.keyAutonomy.list(businessId, { status: 'PENDING' }),
      this.keyAutonomy.list(businessId, { status: 'APPROVED' }),
      this.temporal.analyze(businessId),
      this.genomeEvolution.list(businessId, { status: 'PENDING' }),
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.assets.list(businessId),
      this.constitution.latest(businessId),
      this.constitution.staleness(businessId),
    ]);

    const modeMap = new Map(modeBriefs.map((brief) => [brief.mode, brief]));

    // Compute KEY Genome scores and module readiness after the parallel block
    // so readiness uses freshly-scored facts rather than stale DB values.
    const keyGenomeFacts = await this.genomeScoring.computeFactScores(businessId);
    const keyGenomeScore = this.genomeScoring.computeBusinessScore(businessId, keyGenomeFacts);
    const moduleReadiness = await this.genomeReadiness.computeReadiness(businessId, keyGenomeFacts);
    const keyGenome = this.buildKeyGenome(keyGenomeScore);

    const approvalItems = this.mapPendingApprovals(pendingApprovals);
    const approvedItems = this.mapApprovedAwaitingExecution(approvedAwaitingExecution);
    const temporalUrgentItems = this.mapTemporalUrgent(temporalAnalysis.urgentItems);
    const riskItems = this.mapRisks(executiveBrief, temporalAnalysis, modeMap);
    const opportunityItems = this.mapOpportunities(temporalAnalysis, modeMap);
    const genomeProposalItems = this.mapGenomeProposals(genomeProposals);
    const assetRiskItems = this.mapAssetRisks(rawAssets);
    const constitutionItems = this.mapConstitutionItem(latestConstitution, constitutionStaleness);
    const moduleReadinessItems = this.mapModuleReadinessItems(moduleReadiness);
    const missingFactItems = this.mapMissingFactItems(moduleReadiness);
    const weakSectionItems = this.mapWeakSectionItems(keyGenomeScore);
    const genomeSignalItems = await this.mapGenomeSignalItems(businessId);
    const genomeRecommendationItems = await this.mapGenomeRecommendationItems(businessId);

    const allItems: CommandCenterItem[] = [
      ...approvalItems,
      ...approvedItems,
      ...temporalUrgentItems,
      ...moduleReadinessItems,
      ...missingFactItems,
      ...weakSectionItems,
      ...genomeRecommendationItems,
      ...genomeSignalItems,
      ...riskItems,
      ...opportunityItems,
      ...genomeProposalItems,
      ...assetRiskItems,
      ...constitutionItems,
    ];

    const ranked = this.rankItems(allItems);
    const health = this.buildHealth(
      executiveBrief,
      ranked,
      pendingApprovals.length,
      approvedAwaitingExecution.length,
      temporalAnalysis.urgentItems.length,
      genomeProposals.length,
      assetRiskItems.length,
      constitutionStaleness.stale,
      keyGenome,
      moduleReadiness,
    );

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      health,
      summary: this.buildSummary(health, executiveBrief.summary, keyGenome, moduleReadiness),
      topPriorities: ranked.slice(0, 7),
      pendingApprovals: approvalItems,
      approvedAwaitingExecution: approvedItems,
      urgentItems: temporalUrgentItems,
      risks: this.deduplicateItems([...riskItems, ...assetRiskItems]),
      opportunities: opportunityItems,
      genome: this.buildGenome(genome, genomeProposalItems),
      keyGenome,
      moduleReadiness: moduleReadiness.map((r) => this.mapModuleReadiness(r)),
      constitution: this.buildConstitution(latestConstitution, constitutionStaleness),
      executiveModes: this.mapExecutiveModes(modeBriefs),
      recommendedActions: this.buildRecommendedActions(ranked),
    };
  }

  private mapPendingApprovals(proposals: Awaited<ReturnType<KeyActionProposalService['list']>>): CommandCenterItem[] {
    return proposals.map((proposal) => ({
      id: `approval-${proposal.id}`,
      type: 'KEY_APPROVAL' as const,
      priority: this.mapRiskLevel(proposal.riskLevel),
      title: proposal.title,
      summary: proposal.summary || proposal.rationale || `KEY requests approval for ${proposal.actionType}.`,
      evidence: proposal.evidence,
      source: proposal.sourceMode ? `KEY ${proposal.sourceMode}` : proposal.sourceType,
      sourceId: proposal.id,
      href: '/app/key-autonomy?tab=pending',
      actions: [{ label: 'Review approval', actionType: 'REVIEW' as const, href: '/app/key-autonomy?tab=pending' }],
      createdAt: proposal.createdAt,
    }));
  }

  private mapApprovedAwaitingExecution(
    proposals: Awaited<ReturnType<KeyActionProposalService['list']>>,
  ): CommandCenterItem[] {
    return proposals.map((proposal) => ({
      id: `approved-${proposal.id}`,
      type: 'KEY_APPROVED' as const,
      priority: 'HIGH' as const,
      title: `Execute approved: ${proposal.title}`,
      summary: `Approved and ready to execute (${proposal.actionType}).`,
      evidence: proposal.evidence,
      source: proposal.sourceMode ? `KEY ${proposal.sourceMode}` : proposal.sourceType,
      sourceId: proposal.id,
      href: '/app/key-autonomy?tab=approved',
      actions: [{ label: 'Execute', actionType: 'EXECUTE' as const, href: '/app/key-autonomy?tab=approved' }],
      createdAt: proposal.approvedAt ?? proposal.createdAt,
    }));
  }

  private mapTemporalUrgent(items: { title: string; reason?: string | null; eventId?: string | null }[]): CommandCenterItem[] {
    return items.map((item) => ({
      id: `temporal-${this.slug(item.title)}`,
      type: 'TEMPORAL_URGENT' as const,
      priority: 'HIGH' as const,
      title: item.title,
      summary: item.reason ?? item.title,
      evidence: item.reason ? [item.reason] : [],
      source: 'Temporal Flow',
      sourceId: item.eventId ?? undefined,
      href: item.eventId ? `/app/temporal-flow?eventId=${item.eventId}` : '/app/temporal-flow',
      actions: [{ label: 'Open Temporal Flow', actionType: 'OPEN' as const, href: '/app/temporal-flow' }],
    }));
  }

  private mapRisks(
    brief: Awaited<ReturnType<BusinessIntelligenceService['generateExecutiveBrief']>>,
    temporal: Awaited<ReturnType<TemporalFlowService['analyze']>>,
    modeMap: Map<KeyExecutiveMode, Awaited<ReturnType<KeyExecutiveModeService['generateModeBrief']>>>,
  ): CommandCenterItem[] {
    const items: CommandCenterItem[] = [];

    for (const insight of brief.insights) {
      if (insight.priority === 'HIGH' || insight.priority === 'CRITICAL') {
        items.push({
          id: `brief-risk-${insight.id}`,
          type: 'RISK' as const,
          priority: insight.priority,
          title: insight.title,
          summary: insight.finding,
          evidence: insight.evidence,
          source: 'Executive Brief',
          actions: this.actionsFromRecommendedAction(insight.recommendedAction),
        });
      }
    }

    for (const risk of temporal.risks) {
      items.push({
        id: `temporal-risk-${this.slug(risk.title)}`,
        type: 'RISK' as const,
        priority: this.mapSeverity(risk.severity),
        title: risk.title,
        summary: risk.evidence.join(' '),
        evidence: risk.evidence,
        source: 'Temporal Flow',
        href: '/app/temporal-flow',
        actions: [{ label: 'Open Temporal Flow', actionType: 'OPEN' as const, href: '/app/temporal-flow' }],
      });
    }

    const riskOfficer = modeMap.get('RISK_OFFICER');
    if (riskOfficer) {
      for (const finding of riskOfficer.risks) {
        const key = `mode-risk-${finding.id}`;
        if (items.some((i) => i.id === key)) continue;
        items.push({
          id: key,
          type: 'RISK' as const,
          priority: finding.priority,
          title: finding.title,
          summary: finding.finding,
          evidence: finding.evidence,
          source: 'KEY Risk Officer',
          actions: finding.actions.map((a) => ({ label: a.label, actionType: 'OPEN' as const, href: a.href })),
        });
      }
    }

    return this.deduplicateItems(items);
  }

  private mapOpportunities(
    temporal: Awaited<ReturnType<TemporalFlowService['analyze']>>,
    modeMap: Map<KeyExecutiveMode, Awaited<ReturnType<KeyExecutiveModeService['generateModeBrief']>>>,
  ): CommandCenterItem[] {
    const items: CommandCenterItem[] = [];

    for (const opp of temporal.opportunities) {
      items.push({
        id: `temporal-opp-${this.slug(opp.title)}`,
        type: 'OPPORTUNITY' as const,
        priority: 'MEDIUM' as const,
        title: opp.title,
        summary: opp.title,
        evidence: opp.evidence,
        source: 'Temporal Flow',
        href: '/app/temporal-flow',
        actions: [{ label: 'Open Temporal Flow', actionType: 'OPEN' as const, href: '/app/temporal-flow' }],
      });
    }

    for (const mode of ['CMO', 'GROWTH_ADVISOR', 'STRATEGIST'] as KeyExecutiveMode[]) {
      const brief = modeMap.get(mode);
      if (!brief) continue;
      for (const finding of brief.opportunities) {
        const key = `mode-opp-${mode}-${finding.id}`;
        if (items.some((i) => i.id === key)) continue;
        items.push({
          id: key,
          type: 'OPPORTUNITY' as const,
          priority: finding.priority,
          title: finding.title,
          summary: finding.finding,
          evidence: finding.evidence,
          source: `KEY ${MODE_LABELS[mode]}`,
          actions: finding.actions.map((a) => ({ label: a.label, actionType: 'OPEN' as const, href: a.href })),
        });
      }
    }

    return this.deduplicateItems(items);
  }

  private mapGenomeProposals(
    proposals: Awaited<ReturnType<GenomeEvolutionService['list']>>,
  ): CommandCenterItem[] {
    return proposals.map((proposal) => ({
      id: `genome-proposal-${proposal.id}`,
      type: 'GENOME_PROPOSAL' as const,
      priority: 'MEDIUM' as const,
      title: `Review ${proposal.section} Genome proposal`,
      summary: proposal.reason,
      evidence: proposal.evidence,
      source: 'Genome Evolution',
      sourceId: proposal.id,
      href: '/app/profile?tab=business-genome&section=evolution-proposals',
      actions: [
        {
          label: 'Review proposal',
          actionType: 'REVIEW' as const,
          href: '/app/profile?tab=business-genome&section=evolution-proposals',
        },
      ],
      createdAt: proposal.createdAt,
    }));
  }

  private mapAssetRisks(assets: BusinessAsset[]): CommandCenterItem[] {
    const now = Date.now();
    return assets
      .filter((a) => a.expiresAt)
      .map((a) => {
        const days = Math.ceil((new Date(a.expiresAt!).getTime() - now) / (1000 * 60 * 60 * 24));
        return { asset: a, days };
      })
      .filter((item) => item.days <= 30)
      .map(({ asset, days }) => ({
        id: `asset-${asset.id}`,
        type: 'ASSET_RISK' as const,
        priority: days < 0 ? 'CRITICAL' : days <= 7 ? 'HIGH' : 'MEDIUM',
        title: days < 0 ? `Expired: ${asset.name}` : `${asset.name} expires in ${days} day(s)`,
        summary: `${asset.type} asset ${asset.name} requires renewal or replacement.`,
        evidence: [`Expires in ${days} day(s)`],
        source: 'Business Assets',
        sourceId: asset.id,
        href: '/app/profile?tab=business-genome&section=assets',
        actions: [
          { label: 'Review assets', actionType: 'REVIEW' as const, href: '/app/profile?tab=business-genome&section=assets' },
        ],
        dueAt: asset.expiresAt?.toISOString(),
      }));
  }

  private mapConstitutionItem(
    latest: Awaited<ReturnType<ConstitutionVersionService['latest']>>,
    staleness: Awaited<ReturnType<ConstitutionVersionService['staleness']>>,
  ): CommandCenterItem[] {
    if (!staleness.stale) return [];
    const priority: CommandCenterPriority = latest ? 'MEDIUM' : 'HIGH';
    return [
      {
        id: 'constitution-stale',
        type: 'CONSTITUTION' as const,
        priority,
        title: latest ? 'Constitution is stale' : 'No Constitution generated',
        summary: staleness.reason || 'The Business Constitution should be refreshed.',
        evidence: [],
        source: 'Business Constitution',
        href: '/app/profile?tab=business-genome&section=constitution',
        actions: [
          {
            label: 'Open Constitution',
            actionType: 'OPEN' as const,
            href: '/app/profile?tab=business-genome&section=constitution',
          },
          {
            label: 'Request new version',
            actionType: 'REQUEST_APPROVAL' as const,
            href: '/app/key-modes?mode=STRATEGIST',
          },
        ],
      },
    ];
  }

  private buildGenome(
    genome: Awaited<ReturnType<BlueprintService['calculateGenomeIntegrity']>>,
    pendingProposals: CommandCenterItem[],
  ): CommandCenterGenome {
    const weakest = (genome.dnaSections ?? [])
      .filter((section) => section.integrity < 50)
      .sort((a, b) => a.integrity - b.integrity)
      .slice(0, 3)
      .map((section) => ({
        id: `dna-${section.key}`,
        type: 'RISK' as const,
        priority: (section.integrity < 30 ? 'HIGH' : 'MEDIUM') as CommandCenterPriority,
        title: `${section.label} DNA is underdeveloped`,
        summary: `The ${section.label} section scores ${section.integrity}%, limiting executive reasoning.`,
        evidence: [`Score: ${section.integrity}%`, `Confidence: ${Math.round(section.confidence * 100)}%`],
        source: 'Business Genome',
        href: '/app/profile?tab=business-genome&section=dna-sections',
        actions: [
          {
            label: 'Open Genome',
            actionType: 'OPEN' as const,
            href: '/app/profile?tab=business-genome&section=dna-sections',
          },
        ],
      }));

    return {
      integrity: genome.genomeIntegrity,
      readiness: genome.executiveReadinessScore,
      stage: genome.genomeStage,
      pendingProposals,
      weakestSections: weakest,
    };
  }

  private buildConstitution(
    latest: Awaited<ReturnType<ConstitutionVersionService['latest']>>,
    staleness: Awaited<ReturnType<ConstitutionVersionService['staleness']>>,
  ): CommandCenterConstitution {
    return {
      latestVersion: latest?.version ?? null,
      stale: staleness.stale,
      reason: staleness.reason ?? null,
      href: '/app/profile?tab=business-genome&section=constitution',
    };
  }

  private mapExecutiveModes(
    briefs: Awaited<ReturnType<KeyExecutiveModeService['generateModeBrief']>>[],
  ): CommandCenterExecutiveMode[] {
    return briefs.map((brief) => ({
      mode: brief.mode,
      label: MODE_LABELS[brief.mode],
      summary: brief.summary,
      riskCount: brief.risks.length,
      opportunityCount: brief.opportunities.length,
      href: `/app/key-modes?mode=${brief.mode}`,
    }));
  }

  private buildHealth(
    brief: Awaited<ReturnType<BusinessIntelligenceService['generateExecutiveBrief']>>,
    rankedItems: CommandCenterItem[],
    pendingApprovalCount: number,
    approvedAwaitingExecutionCount: number,
    urgentTemporalCount: number,
    pendingGenomeProposalCount: number,
    assetRiskCount: number,
    constitutionStale: boolean,
    keyGenome: CommandCenterKeyGenome,
    moduleReadiness: ModuleReadinessData[],
  ): CommandCenterHealth {
    return {
      genomeIntegrity: brief.genomeIntegrity,
      executiveReadinessScore: brief.executiveReadinessScore,
      genomeStage: brief.genomeStage,
      criticalCount: rankedItems.filter((i) => i.priority === 'CRITICAL').length,
      highPriorityCount: rankedItems.filter((i) => i.priority === 'HIGH').length,
      pendingApprovalCount,
      approvedAwaitingExecutionCount,
      urgentTemporalCount,
      pendingGenomeProposalCount,
      assetRiskCount,
      constitutionStale,
      keyGenomeOverall: keyGenome.overall,
      keyGenomeReadiness: keyGenome.readiness,
      keyGenomeConfidence: keyGenome.confidence,
      blockedModuleCount: moduleReadiness.filter((m) => !m.automationAllowed).length,
      lowReadinessModuleCount: moduleReadiness.filter((m) => m.readinessScore < 70).length,
      missingBlockingFactCount: moduleReadiness
        .flatMap((m) => m.missingFacts)
        .filter((f) => f.impact === 'BLOCKING').length,
    };
  }

  private buildSummary(
    health: CommandCenterHealth,
    briefSummary: string,
    keyGenome: CommandCenterKeyGenome,
    moduleReadiness: ModuleReadinessData[],
  ): string {
    const parts: string[] = [briefSummary];

    const hasFacts = keyGenome.sections.length > 0;
    if (hasFacts) {
      parts.push(
        `KEY Genome is ${keyGenome.overall}% ready with ${keyGenome.confidence}% confidence.`,
      );
      if (health.blockedModuleCount > 0) {
        parts.push(`${health.blockedModuleCount} module(s) are blocked by missing facts.`);
      }
    } else {
      parts.push('KEY Genome has not been populated yet. Run Blueprint backfill to unlock readiness intelligence.');
    }

    if (health.criticalCount > 0) {
      parts.push(`${health.criticalCount} critical item(s) need immediate attention.`);
    }
    if (health.pendingApprovalCount > 0) {
      parts.push(`${health.pendingApprovalCount} KEY action(s) awaiting approval.`);
    }
    if (health.urgentTemporalCount > 0) {
      parts.push(`${health.urgentTemporalCount} urgent Temporal Flow item(s).`);
    }
    if (health.constitutionStale) {
      parts.push('Business Constitution is stale.');
    }
    return parts.join(' ');
  }

  private buildRecommendedActions(rankedItems: CommandCenterItem[]): CommandCenterAction[] {
    const actions: CommandCenterAction[] = [];
    const seen = new Set<string>();
    for (const item of rankedItems.slice(0, 5)) {
      for (const action of item.actions) {
        const key = `${action.label}-${action.href ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        actions.push(action);
        if (actions.length >= 5) return actions;
      }
    }
    return actions;
  }

  private rankItems(items: CommandCenterItem[]): CommandCenterItem[] {
    return [...items].sort((a, b) => {
      const rankDiff = this.priorityRank(b.priority) - this.priorityRank(a.priority);
      if (rankDiff !== 0) return rankDiff;
      const typeDiff = (TYPE_WEIGHT[b.type] ?? 0) - (TYPE_WEIGHT[a.type] ?? 0);
      if (typeDiff !== 0) return typeDiff;
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
  }

  private priorityRank(priority: CommandCenterPriority): number {
    switch (priority) {
      case 'CRITICAL':
        return 4;
      case 'HIGH':
        return 3;
      case 'MEDIUM':
        return 2;
      case 'LOW':
      default:
        return 1;
    }
  }

  private mapRiskLevel(level: string): CommandCenterPriority {
    switch (level) {
      case 'CRITICAL':
      case 'HIGH':
      case 'MEDIUM':
      case 'LOW':
        return level;
      default:
        return 'LOW';
    }
  }

  private mapSeverity(severity: string): CommandCenterPriority {
    switch (severity) {
      case 'CRITICAL':
        return 'CRITICAL';
      case 'HIGH':
        return 'HIGH';
      case 'MEDIUM':
        return 'MEDIUM';
      case 'LOW':
      default:
        return 'LOW';
    }
  }

  private actionsFromRecommendedAction(
    action?: { label: string; href?: string; actionType?: string } | null,
  ): CommandCenterAction[] {
    if (!action) return [];
    return [{ label: action.label, actionType: 'OPEN' as const, href: action.href }];
  }

  private deduplicateItems(items: CommandCenterItem[]): CommandCenterItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  private slug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }

  private titleCase(value: string): string {
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private mapModuleReadiness(readiness: ModuleReadinessData): CommandCenterModuleReadiness {
    return {
      module: readiness.module,
      readinessScore: readiness.readinessScore,
      automationAllowed: readiness.automationAllowed,
      riskLevel: readiness.riskLevel,
      missingFacts: readiness.missingFacts,
      blockedReasons: readiness.blockedReasons,
      recommendedSetupActions: readiness.recommendedSetupActions,
      lastComputedAt: readiness.lastComputedAt,
    };
  }

  private buildKeyGenome(score: KeyGenomeScore): CommandCenterKeyGenome {
    const weakest = [...score.sections]
      .sort((a, b) => a.score.overall - b.score.overall)
      .slice(0, 5)
      .map((s) => ({
        section: s.section,
        overall: Math.round(s.score.overall * 100),
        confidence: Math.round(s.score.confidence * 100),
        freshness: Math.round(s.score.freshness * 100),
        readiness: Math.round(s.score.operationalReadiness * 100),
      }));

    return {
      overall: Math.round(score.overall * 100),
      integrity: Math.round(score.integrity * 100),
      readiness: Math.round(score.readiness * 100),
      confidence: Math.round(score.confidence * 100),
      computedAt: score.computedAt,
      sections: score.sections,
      weakestSections: weakest,
    };
  }

  private mapModuleReadinessItems(readiness: ModuleReadinessData[]): CommandCenterItem[] {
    return readiness
      .filter((r) => r.readinessScore < 90 || !r.automationAllowed)
      .map((r) => ({
        id: `module-readiness-${r.module}`,
        type: 'MODULE_READINESS' as const,
        priority:
          r.readinessScore < 40 || !r.automationAllowed
            ? 'HIGH'
            : r.readinessScore < 70
              ? 'MEDIUM'
              : 'LOW',
        title: `${this.titleCase(r.module)} readiness is ${r.readinessScore}%`,
        summary:
          r.blockedReasons[0] ??
          `${this.titleCase(r.module)} needs more Genome context before KEY can operate confidently.`,
        evidence: r.blockedReasons,
        source: 'KEY Genome',
        href: '/app/profile?tab=business-genome',
        actions: [
          {
            label: 'Review missing facts',
            actionType: 'REVIEW' as const,
            href: '/app/profile?tab=business-genome',
          },
        ],
      }));
  }

  private mapMissingFactItems(readiness: ModuleReadinessData[]): CommandCenterItem[] {
    const seen = new Set<string>();
    const items: CommandCenterItem[] = [];

    for (const module of readiness) {
      for (const missing of module.missingFacts) {
        if (missing.impact === 'OPTIONAL') continue;

        const key = `${missing.section}:${missing.domain}:${missing.field}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
          id: `missing-fact-${this.slug(key)}`,
          type: 'MISSING_FACT' as const,
          priority: missing.impact === 'BLOCKING' ? 'HIGH' : 'MEDIUM',
          title: `Missing ${missing.domain}.${missing.field}`,
          summary: missing.reason,
          evidence: [`Blocks or degrades module readiness for ${module.module}.`],
          source: 'KEY Genome',
          href: '/app/profile?tab=business-genome',
          actions: [
            {
              label: 'Update Business Genome',
              actionType: 'REVIEW' as const,
              href: '/app/profile?tab=business-genome',
            },
          ],
        });
      }
    }

    return items.slice(0, 7);
  }

  private mapWeakSectionItems(score: KeyGenomeScore): CommandCenterItem[] {
    return score.sections
      .filter((s) => s.score.overall < 0.7 || s.score.confidence < 0.4 || s.score.freshness < 0.3)
      .map((s) => ({
        id: `key-genome-section-${this.slug(s.section)}`,
        type: 'KEY_GENOME_GAP' as const,
        priority: s.score.overall < 0.4 ? 'HIGH' : 'MEDIUM',
        title: `${this.titleCase(s.section)} Genome section needs strengthening`,
        summary: `Overall ${Math.round(s.score.overall * 100)}%, confidence ${Math.round(
          s.score.confidence * 100,
        )}%, freshness ${Math.round(s.score.freshness * 100)}%.`,
        evidence: [
          `Completeness: ${Math.round(s.score.completeness * 100)}%`,
          `Operational readiness: ${Math.round(s.score.operationalReadiness * 100)}%`,
        ],
        source: 'KEY Genome',
        href: '/app/profile?tab=business-genome',
        actions: [
          {
            label: 'Improve Genome section',
            actionType: 'REVIEW' as const,
            href: '/app/profile?tab=business-genome',
          },
        ],
      }));
  }

  private async mapGenomeSignalItems(businessId: string): Promise<CommandCenterItem[]> {
    const signals = await this.genomeSignal.listSignals(businessId, {
      status: 'NEW',
      minConfidence: 0.7,
      limit: 5,
    });

    return signals.map((signal) => {
      const criticalTypes = new Set(['FACT_CONFLICT', 'READINESS_BLOCKER']);
      const highTypes = new Set(['MISSING_FACT', 'STALE_FACT', 'LOW_CONFIDENCE_FACT']);
      const priority: CommandCenterPriority = criticalTypes.has(signal.signalType)
        ? 'CRITICAL'
        : highTypes.has(signal.signalType)
          ? 'HIGH'
          : 'MEDIUM';

      return {
        id: `genome-signal-${signal.id}`,
        type: 'GENOME_SIGNAL' as const,
        priority,
        title: `Genome signal: ${this.titleCase(signal.signalType)}`,
        summary: signal.reason,
        evidence: signal.evidence.map((e) => e.summary),
        source: 'KEY Genome',
        sourceId: signal.id,
        href: '/app/profile?tab=business-genome&section=signals',
        actions: [
          {
            label: 'Review signal',
            actionType: 'REVIEW' as const,
            href: '/app/profile?tab=business-genome&section=signals',
          },
          {
            label: 'Open Governance Console',
            actionType: 'OPEN' as const,
            href: '/app/profile?tab=business-genome&section=governance',
          },
        ],
        createdAt: signal.createdAt,
      };
    });
  }

  private async mapGenomeRecommendationItems(businessId: string): Promise<CommandCenterItem[]> {
    const recommendations = await this.genomeRecommendation.listRecommendations(businessId, {
      status: 'ACTIVE',
      limit: 5,
    });

    return recommendations.map((rec) => {
      const priority: CommandCenterPriority =
        rec.riskLevel === 'CRITICAL' || rec.riskLevel === 'HIGH'
          ? 'HIGH'
          : rec.riskLevel === 'MEDIUM'
            ? 'MEDIUM'
            : 'LOW';

      return {
        id: `genome-recommendation-${rec.id}`,
        type: 'GENOME_RECOMMENDATION' as const,
        priority,
        title: rec.title,
        summary: rec.insight,
        evidence: [rec.diagnosis, rec.recommendation].filter(Boolean),
        source: 'KEY Genome',
        sourceId: rec.id,
        href: '/app/profile?tab=business-genome&section=recommendations',
        actions: [
          {
            label: 'Review recommendation',
            actionType: 'REVIEW' as const,
            href: '/app/profile?tab=business-genome&section=recommendations',
          },
          {
            label: 'Open Governance Console',
            actionType: 'OPEN' as const,
            href: '/app/profile?tab=business-genome&section=governance',
          },
        ],
        createdAt: rec.createdAt,
      };
    });
  }
}

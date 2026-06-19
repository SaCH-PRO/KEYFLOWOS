import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { BusinessAsset } from '@prisma/client';
import { BusinessIntelligenceService } from './business-intelligence.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { BusinessAssetsService } from '../business-assets/business-assets.service';
import type {
  KeyExecutiveMode,
  KeyExecutiveModeBrief,
  KeyModeAction,
  KeyModeActionType,
  KeyModeFinding,
  KeyModePriority,
} from './key-executive-mode.types';
import { KEY_EXECUTIVE_MODE_CONFIG, KEY_EXECUTIVE_MODE_LIST } from './key-executive-mode.config';
import type {
  BusinessExecutiveBrief,
  BusinessIntelligenceRecommendedAction,
  IntelligencePriority,
} from './business-intelligence.types';
import type { BlueprintData, DnaSectionKey } from '../blueprint/blueprint.types';
import type { TemporalFlowAnalysis } from '../temporal-flow/temporal-flow.types';
import type { GenomeEvolutionProposalData } from '../business-genome/genome-evolution.types';

const MODE_VALUES = new Set<string>([
  'STRATEGIST',
  'CFO',
  'CMO',
  'COO',
  'LEGAL_GUIDE',
  'GROWTH_ADVISOR',
  'RISK_OFFICER',
  'EXECUTIVE_ASSISTANT',
]);

const FINANCIAL_KEYWORDS = ['invoice', 'cash', 'payment', 'revenue', 'expense', 'paid', 'overdue', 'financial', 'pricing', 'tax'];
const MARKETING_KEYWORDS = ['whatsapp', 'instagram', 'meta', 'lead', 'campaign', 'content', 'audience', 'marketing', 'channel', 'dm'];
const OPERATIONS_KEYWORDS = ['booking', 'asset', 'workflow', 'delivery', 'fulfillment', 'operations', 'appointment', 'task'];
const LEGAL_KEYWORDS = ['compliance', 'license', 'legal', 'contract', 'entity', 'registration', 'governance'];

@Injectable()
export class KeyExecutiveModeService {
  constructor(
    @Inject(BusinessIntelligenceService) private readonly intelligence: BusinessIntelligenceService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
    @Inject(GenomeEvolutionService) private readonly genomeEvolution: GenomeEvolutionService,
    @Inject(BusinessAssetsService) private readonly businessAssets: BusinessAssetsService,
  ) {}

  listModes() {
    return KEY_EXECUTIVE_MODE_LIST;
  }

  async generateModeBrief(businessId: string, mode: string): Promise<KeyExecutiveModeBrief> {
    if (!MODE_VALUES.has(mode)) {
      throw new BadRequestException(
        `Invalid executive mode. Must be one of: ${Array.from(MODE_VALUES).join(', ')}`,
      );
    }
    const keyMode = mode as KeyExecutiveMode;
    const config = KEY_EXECUTIVE_MODE_CONFIG[keyMode];

    const [executiveBrief, blueprint, temporalAnalysis, proposals, assets] = await Promise.all([
      this.intelligence.generateExecutiveBrief(businessId),
      this.blueprint.getBlueprint(businessId),
      this.temporal.analyze(businessId),
      this.genomeEvolution.list(businessId, { status: 'PENDING' }),
      this.businessAssets.list(businessId),
    ]);

    const findings: KeyModeFinding[] = [
      ...this.fromExecutiveBrief(keyMode, config.focusDomains, executiveBrief),
      ...this.fromDnaScores(keyMode, config.dnaSections, blueprint),
      ...this.fromTemporal(keyMode, temporalAnalysis),
      ...this.fromProposals(keyMode, config.dnaSections, proposals),
      ...this.fromAssets(keyMode, assets),
    ];

    const ranked = this.rankFindings(findings);

    return {
      businessId,
      mode: keyMode,
      generatedAt: new Date().toISOString(),
      title: config.label,
      summary: this.buildSummary(keyMode, config, ranked, executiveBrief),
      diagnosis: this.buildDiagnosis(keyMode, config, ranked, executiveBrief),
      findings: ranked,
      recommendedActions: this.buildRecommendedActions(config, ranked),
      risks: ranked.filter((f) => f.priority === 'HIGH' || f.priority === 'CRITICAL'),
      opportunities: ranked.filter((f) => f.id.includes('opportunity')),
    };
  }

  private fromExecutiveBrief(
    mode: KeyExecutiveMode,
    focusDomains: string[],
    brief: BusinessExecutiveBrief,
  ): KeyModeFinding[] {
    const domainSet = new Set(focusDomains);
    return brief.insights
      .filter((insight) => domainSet.has(insight.domain))
      .map((insight) => {
        const actions: KeyModeAction[] = [];
        if (insight.recommendedAction) {
          actions.push(this.mapRecommendedAction(insight.recommendedAction));
        }
        return {
          id: `${mode.toLowerCase()}-${insight.id}`,
          priority: this.mapPriority(insight.priority),
          title: insight.title,
          finding: insight.finding,
          evidence: insight.evidence ?? [],
          confidence: insight.confidence,
          actions: actions.length > 0 ? actions : [this.defaultAction(mode)],
        };
      });
  }

  private fromDnaScores(mode: KeyExecutiveMode, dnaSections: DnaSectionKey[], blueprint: BlueprintData): KeyModeFinding[] {
    const scores = (blueprint.genomeDnaScores ?? {}) as Record<DnaSectionKey, number>;
    const findings: KeyModeFinding[] = [];

    for (const key of dnaSections) {
      const score = scores[key] ?? 0;
      if (score < 50) {
        const label = this.titleCase(key);
        findings.push({
          id: `${mode.toLowerCase()}-dna-${key}`,
          priority: score < 30 ? 'HIGH' : 'MEDIUM',
          title: `${label} DNA is underdeveloped`,
          finding: `The ${label} DNA section scores ${score}%, which limits how well KEY can reason in ${KEY_EXECUTIVE_MODE_CONFIG[mode].label} mode.`,
          evidence: [`${label} DNA score: ${score}%`],
          confidence: 0.9,
          actions: [
            {
              label: `Complete ${label} DNA`,
              actionType: 'OPEN_GENOME',
              href: '/app/profile?tab=business-genome&section=dna-sections',
            },
          ],
        });
      }
    }

    return findings;
  }

  private fromTemporal(mode: KeyExecutiveMode, temporal: TemporalFlowAnalysis): KeyModeFinding[] {
    const findings: KeyModeFinding[] = [];
    const textMatches = (text: string, keywords: string[]) =>
      keywords.some((keyword) => text.toLowerCase().includes(keyword));

    for (const risk of temporal.risks) {
      const text = `${risk.title} ${risk.evidence.join(' ')}`;
      if (
        mode === 'RISK_OFFICER' ||
        (mode === 'CFO' && textMatches(text, FINANCIAL_KEYWORDS)) ||
        (mode === 'LEGAL_GUIDE' && textMatches(text, LEGAL_KEYWORDS)) ||
        (mode === 'COO' && textMatches(text, OPERATIONS_KEYWORDS))
      ) {
        findings.push({
          id: `${mode.toLowerCase()}-risk-${this.slug(risk.title)}`,
          priority: this.mapSeverity(risk.severity),
          title: risk.title,
          finding: risk.title,
          evidence: risk.evidence,
          confidence: 0.8,
          actions: [
            {
              label: 'View Temporal Flow',
              actionType: 'OPEN_TEMPORAL_FLOW',
              href: '/app/temporal-flow',
            },
          ],
        });
      }
    }

    for (const item of temporal.urgentItems) {
      const text = `${item.title} ${item.reason ?? ''}`;
      if (
        mode === 'EXECUTIVE_ASSISTANT' ||
        mode === 'RISK_OFFICER' ||
        (mode === 'CFO' && textMatches(text, FINANCIAL_KEYWORDS)) ||
        (mode === 'CMO' && textMatches(text, MARKETING_KEYWORDS)) ||
        (mode === 'COO' && textMatches(text, OPERATIONS_KEYWORDS)) ||
        (mode === 'LEGAL_GUIDE' && textMatches(text, LEGAL_KEYWORDS))
      ) {
        findings.push({
          id: `${mode.toLowerCase()}-urgent-${this.slug(item.title)}`,
          priority: 'HIGH',
          title: item.title,
          finding: item.reason ?? item.title,
          evidence: item.reason ? [item.reason] : [],
          confidence: 0.85,
          actions: [
            {
              label: 'View Temporal Flow',
              actionType: 'OPEN_TEMPORAL_FLOW',
              href: item.eventId ? `/app/temporal-flow?eventId=${item.eventId}` : '/app/temporal-flow',
            },
          ],
        });
      }
    }

    for (const opp of temporal.opportunities) {
      const text = `${opp.title} ${opp.evidence.join(' ')}`;
      if (
        mode === 'CMO' ||
        mode === 'GROWTH_ADVISOR' ||
        (mode === 'STRATEGIST' && textMatches(text, ['growth', 'scale', 'opportunity', 'expand'])) ||
        (mode === 'COO' && textMatches(text, OPERATIONS_KEYWORDS))
      ) {
        findings.push({
          id: `${mode.toLowerCase()}-opportunity-${this.slug(opp.title)}`,
          priority: 'MEDIUM',
          title: opp.title,
          finding: opp.title,
          evidence: opp.evidence,
          confidence: 0.75,
          actions: [
            {
              label: 'View Temporal Flow',
              actionType: 'OPEN_TEMPORAL_FLOW',
              href: '/app/temporal-flow',
            },
          ],
        });
      }
    }

    for (const candidate of temporal.genomeProposalCandidates) {
      if (mode === 'STRATEGIST' || mode === 'GROWTH_ADVISOR' || mode === 'EXECUTIVE_ASSISTANT') {
        findings.push({
          id: `${mode.toLowerCase()}-candidate-${candidate.section}`,
          priority: 'MEDIUM',
          title: `Genome update candidate: ${this.titleCase(candidate.section)}`,
          finding: candidate.reason,
          evidence: candidate.evidence,
          confidence: 0.75,
          actions: [
            {
              label: 'Review Evolution Proposals',
              actionType: 'REVIEW_EVOLUTION_PROPOSALS',
              href: '/app/profile?tab=business-genome&section=evolution-proposals',
            },
          ],
        });
      }
    }

    return findings;
  }

  private fromProposals(
    mode: KeyExecutiveMode,
    dnaSections: DnaSectionKey[],
    proposals: GenomeEvolutionProposalData[],
  ): KeyModeFinding[] {
    if (
      ![
        'STRATEGIST',
        'GROWTH_ADVISOR',
        'CMO',
        'EXECUTIVE_ASSISTANT',
        'LEGAL_GUIDE',
      ].includes(mode)
    ) {
      return [];
    }

    const sectionSet = new Set(dnaSections);
    const relevant = proposals.filter((p) => sectionSet.has(p.section));
    if (relevant.length === 0) return [];

    return [
      {
        id: `${mode.toLowerCase()}-pending-proposals`,
        priority: relevant.length > 3 ? 'HIGH' : 'MEDIUM',
        title: `${relevant.length} pending Genome Evolution proposal${relevant.length === 1 ? '' : 's'}`,
        finding: `Temporal Flow generated ${relevant.length} proposal${relevant.length === 1 ? '' : 's'} relevant to ${KEY_EXECUTIVE_MODE_CONFIG[mode].label}.`,
        evidence: relevant.slice(0, 5).map((p) => `${this.titleCase(p.section)}: ${p.reason}`),
        confidence: Math.max(0.5, Math.min(0.95, 0.5 + relevant.length * 0.05)),
        actions: [
          {
            label: 'Review Proposals',
            actionType: 'REVIEW_EVOLUTION_PROPOSALS',
            href: '/app/profile?tab=business-genome&section=evolution-proposals',
          },
        ],
      },
    ];
  }

  private fromAssets(mode: KeyExecutiveMode, assets: BusinessAsset[]): KeyModeFinding[] {
    if (!['CFO', 'COO', 'LEGAL_GUIDE', 'RISK_OFFICER', 'EXECUTIVE_ASSISTANT'].includes(mode)) {
      return [];
    }

    const now = Date.now();
    const risky = assets
      .filter((a) => a.expiresAt)
      .map((a) => ({
        asset: a,
        days: Math.ceil((new Date(a.expiresAt!).getTime() - now) / (1000 * 60 * 60 * 24)),
      }))
      .filter((item) => item.days <= 30);

    if (risky.length === 0) return [];

    const expired = risky.filter((item) => item.days < 0);
    const expiringSoon = risky.filter((item) => item.days >= 0);
    let priority: KeyModePriority = 'MEDIUM';
    if (expired.length > 0) priority = 'CRITICAL';
    else if (expiringSoon.some((item) => item.days <= 7)) priority = 'HIGH';

    return [
      {
        id: `${mode.toLowerCase()}-asset-expiry`,
        priority,
        title: expired.length > 0 ? `${expired.length} asset(s) expired` : `${expiringSoon.length} asset(s) expiring within 30 days`,
        finding: 'Business assets with expiry dates require renewal or replacement to avoid operational/legal interruption.',
        evidence: risky.slice(0, 5).map((item) => `${item.asset.name} expires in ${item.days} day(s)`),
        confidence: 0.95,
        actions: [
          {
            label: 'Review Assets',
            actionType: 'REVIEW_ASSETS',
            href: '/app/profile?tab=business-genome&section=assets',
          },
        ],
      },
    ];
  }

  private rankFindings(findings: KeyModeFinding[]): KeyModeFinding[] {
    return [...findings].sort((a, b) => {
      const rankDiff = this.priorityRank(b.priority) - this.priorityRank(a.priority);
      if (rankDiff !== 0) return rankDiff;
      return b.confidence - a.confidence;
    });
  }

  private buildSummary(
    mode: KeyExecutiveMode,
    config: (typeof KEY_EXECUTIVE_MODE_CONFIG)[KeyExecutiveMode],
    findings: KeyModeFinding[],
    brief: BusinessExecutiveBrief,
  ): string {
    const high = findings.filter((f) => f.priority === 'HIGH' || f.priority === 'CRITICAL').length;
    const opportunities = findings.filter((f) => f.id.includes('opportunity')).length;
    const weakDna = findings.filter((f) => f.id.includes('-dna-')).length;

    const parts: string[] = [];
    parts.push(`${config.label} sees Executive Readiness ${brief.executiveReadinessScore}% and Genome Integrity ${brief.genomeIntegrity}%.`);

    if (high > 0) {
      parts.push(`${high} high-priority issue${high === 1 ? '' : 's'} need${high === 1 ? 's' : ''} attention.`);
    }
    if (opportunities > 0) {
      parts.push(`${opportunities} opportunity${opportunities === 1 ? '' : 'ies'} detected.`);
    }
    if (weakDna > 0) {
      parts.push(`${weakDna} relevant DNA section${weakDna === 1 ? '' : 's'} need${weakDna === 1 ? 's' : ''} strengthening.`);
    }
    if (high === 0 && opportunities === 0 && weakDna === 0) {
      parts.push('No urgent issues. Continue monitoring Temporal Flow and Genome Evolution.');
    }

    return parts.join(' ');
  }

  private buildDiagnosis(
    mode: KeyExecutiveMode,
    config: (typeof KEY_EXECUTIVE_MODE_CONFIG)[KeyExecutiveMode],
    findings: KeyModeFinding[],
    brief: BusinessExecutiveBrief,
  ): string {
    const top = findings[0];
    if (!top) {
      return `${config.label} finds no immediate concerns for this business at this time.`;
    }

    const weakDna = findings.filter((f) => f.id.includes('-dna-'));
    const risks = findings.filter((f) => f.priority === 'HIGH' || f.priority === 'CRITICAL');

    if (mode === 'STRATEGIST') {
      return `The business is at the ${brief.genomeStage.replace(/_/g, ' ')} stage. ${weakDna.length > 0 ? `Strategic clarity is limited by ${weakDna.length} underdeveloped DNA section(s).` : 'Strategic DNA is well-formed.'} ${risks.length > 0 ? `Address ${risks.length} priority risk(s) before major commitments.` : ''}`;
    }

    if (mode === 'CFO') {
      return `Financial activity exists, but ${weakDna.length > 0 ? 'financial infrastructure is underdeveloped' : 'cash flow and invoice discipline need monitoring'}. ${risks.length > 0 ? `${risks.length} financial/operational risk(s) require review.` : ''}`;
    }

    if (mode === 'CMO') {
      return `Marketing signals are visible; ${weakDna.length > 0 ? 'audience and channel DNA need strengthening' : 'focus on converting signals into repeatable acquisition'}.`;
    }

    if (mode === 'COO') {
      return `Operations are active; ${risks.length > 0 ? `${risks.length} execution risk(s) need attention` : 'execution reliability looks stable'}.`;
    }

    if (mode === 'LEGAL_GUIDE') {
      return `Legal readiness ${weakDna.length > 0 ? 'has gaps that should be closed before scaling' : 'is reasonably covered'}; ${risks.length > 0 ? `${risks.length} risk item(s) need legal review.` : 'no active legal risks flagged.'}`;
    }

    if (mode === 'GROWTH_ADVISOR') {
      return brief.executiveReadinessScore >= 60
        ? `Executive Readiness is ${brief.executiveReadinessScore}%. The business may be ready to scale if growth DNA and conversion signals are addressed.`
        : `Executive Readiness is ${brief.executiveReadinessScore}%. Strengthen core DNA before aggressive growth.`;
    }

    if (mode === 'RISK_OFFICER') {
      return risks.length > 0
        ? `${risks.length} priority risk(s) are active across operations, finance, legal, or assets.`
        : 'No critical risks are active. Continue monitoring Temporal Flow and asset expiries.';
    }

    if (mode === 'EXECUTIVE_ASSISTANT') {
      return findings.length > 0
        ? `There are ${findings.length} item(s) requiring follow-up today, including urgent Temporal Flow events and pending proposals.`
        : 'No urgent follow-ups. Your day looks clear.';
    }

    return top.finding;
  }

  private buildRecommendedActions(config: (typeof KEY_EXECUTIVE_MODE_CONFIG)[KeyExecutiveMode], findings: KeyModeFinding[]): KeyModeAction[] {
    const actions: KeyModeAction[] = [];
    const seen = new Set<string>();

    for (const finding of findings) {
      for (const action of finding.actions) {
        const key = `${action.actionType}-${action.href ?? action.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        actions.push(action);
        if (actions.length >= 5) return actions;
      }
    }

    if (actions.length === 0) {
      actions.push({
        label: config.defaultActionLabel,
        actionType: config.defaultActionType,
        href: config.defaultHref,
      });
    }

    return actions;
  }

  private mapRecommendedAction(action: BusinessIntelligenceRecommendedAction): KeyModeAction {
    const validActionTypes: KeyModeActionType[] = [
      'OPEN_GENOME',
      'OPEN_TEMPORAL_FLOW',
      'OPEN_INTELLIGENCE',
      'REVIEW_EVOLUTION_PROPOSALS',
      'REVIEW_ASSETS',
      'OPEN_CONSTITUTION',
      'CREATE_TASK',
      'CREATE_DOCUMENT',
      'OPEN_KEY_INBOX',
      'REQUEST_APPROVAL',
      'GENERATE_CONSTITUTION_VERSION',
      'GENERATE_DOCUMENT_EXPORT',
      'CREATE_GENOME_EVOLUTION_PROPOSAL',
      'SCHEDULE_FOLLOWUP',
      'ESCALATE_THREAD',
    ];
    let actionType = validActionTypes.includes(action.actionType as KeyModeActionType)
      ? (action.actionType as KeyModeActionType)
      : 'OPEN_INTELLIGENCE';
    if (actionType === 'GENERATE_DOCUMENT') {
      actionType = 'CREATE_DOCUMENT';
    }

    const executableActionTypes: KeyModeActionType[] = [
      'CREATE_TASK',
      'CREATE_DOCUMENT',
      'GENERATE_CONSTITUTION_VERSION',
      'GENERATE_DOCUMENT_EXPORT',
      'CREATE_GENOME_EVOLUTION_PROPOSAL',
      'SCHEDULE_FOLLOWUP',
      'ESCALATE_THREAD',
      'REQUEST_APPROVAL',
    ];

    return {
      label: action.label,
      actionType,
      href: action.href,
      payload: action.payload,
      requiresApproval: executableActionTypes.includes(actionType),
    };
  }

  private defaultAction(mode: KeyExecutiveMode): KeyModeAction {
    const config = KEY_EXECUTIVE_MODE_CONFIG[mode];
    return {
      label: config.defaultActionLabel,
      actionType: config.defaultActionType,
      href: config.defaultHref,
    };
  }

  private mapPriority(priority: IntelligencePriority): KeyModePriority {
    return priority;
  }

  private mapSeverity(severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): KeyModePriority {
    return severity;
  }

  private priorityRank(priority: KeyModePriority): number {
    switch (priority) {
      case 'CRITICAL':
        return 4;
      case 'HIGH':
        return 3;
      case 'MEDIUM':
        return 2;
      case 'LOW':
        return 1;
    }
  }

  private titleCase(value: string): string {
    return value
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private slug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RECOMMENDATION_TEMPLATES, RecommendationTemplate } from './recommendation-templates';
import { resolveStageContext, resolveBusinessType, BUSINESS_TYPE_EMPHASIS } from './stage-context';

export interface GuidanceScores {
  offerClarity?: number;
  customerClarity?: number;
  valueProposition?: number;
  basicViability?: number;
  pricingScore?: number;
  costEfficiency?: number;
  legalCompliance?: number;
  taxSetup?: number;
  financialSetup?: number;
  onboardingProcess?: number;
  workflowMaturity?: number;
  leadGeneration?: number;
  salesProcess?: number;
  retentionScore?: number;
  dataPrivacy?: number;
  founderDependency?: number;
  contractFormality?: number;
  operationalVisibility?: number;
  profitability?: number;
  businessModel?: number;
  initialAcquisition?: number;
  customerFeedback?: number;
  systemization?: number;
  delegation?: number;
  capacity?: number;
  marginImprovement?: number;
  scalingStrategy?: number;
  riskReduction?: number;
  strategicExpansion?: number;
  [key: string]: number | undefined;
}

export interface GuidanceFlag {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  scoreArea?: string;
}

export interface GeneratedRecommendation {
  templateId: string;
  title: string;
  description: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  impactLevel: string;
  urgency: 'immediate' | 'soon' | 'planned' | 'optional';
  rationale: string;
  suggestedAction: string;
  estimatedDifficulty: string;
  scoreValue?: number;
  triggerScoreKey: string;
}

@Injectable()
export class GuidanceRecommendationService {
  private readonly logger = new Logger(GuidanceRecommendationService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getRecommendations(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      return { recommendations: [] };
    }

    const recommendations = await this.prisma.client.guidanceRecommendation.findMany({
      where: { guidanceProfileId: profile.id },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return { recommendations };
  }

  generateRecommendations(
    scores: GuidanceScores,
    flags: GuidanceFlag[],
    businessStage?: string | null,
    businessType?: string | null,
  ): GeneratedRecommendation[] {
    const stageContext = resolveStageContext(businessStage);
    const type = resolveBusinessType(businessType);
    const typeEmphasis = BUSINESS_TYPE_EMPHASIS[type];

    const recommendations: GeneratedRecommendation[] = [];

    for (const template of RECOMMENDATION_TEMPLATES) {
      const scoreValue = scores[template.triggerScoreKey];

      if (scoreValue === undefined || scoreValue === null) continue;
      if (scoreValue >= template.triggerThreshold) continue;

      if (!template.businessTypeRelevance.includes(type)) continue;
      if (!template.stageRelevance.includes(stageContext.stage)) continue;

      const priority = this.determinePriority(template, scoreValue, flags, stageContext.priorityCategories, typeEmphasis);
      const urgency = this.determineUrgency(priority, flags, template);

      recommendations.push({
        templateId: template.id,
        title: template.title,
        description: template.description,
        category: template.category,
        priority,
        impactLevel: template.impactLevel,
        urgency,
        rationale: template.rationale,
        suggestedAction: template.suggestedAction,
        estimatedDifficulty: template.estimatedDifficulty,
        scoreValue,
        triggerScoreKey: template.triggerScoreKey,
      });
    }

    recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;

      const urgencyOrder = { immediate: 0, soon: 1, planned: 2, optional: 3 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });

    return recommendations;
  }

  private determinePriority(
    template: RecommendationTemplate,
    scoreValue: number,
    flags: GuidanceFlag[],
    stagePriorityCategories: string[],
    typeEmphasis?: { focusAreas: string[] },
  ): 'critical' | 'high' | 'medium' | 'low' {
    const relatedFlags = flags.filter((f) => f.scoreArea === template.triggerScoreKey);
    const hasCriticalFlag = relatedFlags.some((f) => f.severity === 'critical');
    const hasWarningFlag = relatedFlags.some((f) => f.severity === 'warning');

    if (hasCriticalFlag || scoreValue < 20) return 'critical';

    const isStageRelevant = stagePriorityCategories.includes(template.category);
    const isTypeRelevant = typeEmphasis?.focusAreas.some(
      (area) => template.triggerScoreKey.toLowerCase().includes(area.toLowerCase()) ||
        template.category.toLowerCase().includes(area.toLowerCase()),
    );

    if (hasWarningFlag && scoreValue < 40) return 'critical';
    if (scoreValue < 30) return 'high';
    if (hasWarningFlag || (isStageRelevant && scoreValue < 50)) return 'high';
    if (isTypeRelevant && scoreValue < 50) return 'high';
    if (scoreValue < 50) return 'medium';

    return 'low';
  }

  private determineUrgency(
    priority: string,
    flags: GuidanceFlag[],
    template: RecommendationTemplate,
  ): 'immediate' | 'soon' | 'planned' | 'optional' {
    if (priority === 'critical') return 'immediate';

    const hasRelatedFlag = flags.some((f) => f.scoreArea === template.triggerScoreKey);
    if (priority === 'high' && hasRelatedFlag) return 'immediate';
    if (priority === 'high') return 'soon';
    if (priority === 'medium') return 'planned';

    return 'optional';
  }
}

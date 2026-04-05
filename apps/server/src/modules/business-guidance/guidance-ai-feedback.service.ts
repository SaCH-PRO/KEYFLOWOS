import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { GuidanceScores, GuidanceFlag, GeneratedRecommendation } from './guidance-recommendation.service';
import { resolveStageContext, resolveBusinessType, BUSINESS_TYPE_EMPHASIS } from './stage-context';

export interface AiStrategicSummary {
  characterization: string;
  strongestArea: string;
  weakestArea: string;
  highestLeverageMove: string;
  profitabilityInsight: string;
  riskInsight: string;
  isAiGenerated: boolean;
}

export interface AiFeedbackInput {
  businessId: string;
  businessName?: string;
  businessStage?: string | null;
  businessType?: string | null;
  scores: GuidanceScores;
  flags: GuidanceFlag[];
  recommendations: GeneratedRecommendation[];
  financialHighlights?: {
    revenue?: number;
    expenses?: number;
    profit?: number;
    breakEvenMonths?: number;
  };
}

@Injectable()
export class GuidanceAiFeedbackService {
  private readonly logger = new Logger(GuidanceAiFeedbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('AI_USAGE_SERVICE') private readonly aiUsageService: AiUsageService,
  ) {}

  async generateStrategicSummary(input: AiFeedbackInput): Promise<AiStrategicSummary> {
    try {
      return await this.generateAiSummary(input);
    } catch (error) {
      this.logger.warn(`AI summary generation failed, falling back to template: ${(error as Error).message}`);
      return this.generateTemplateSummary(input);
    }
  }

  private async generateAiSummary(input: AiFeedbackInput): Promise<AiStrategicSummary> {
    const stageContext = resolveStageContext(input.businessStage);
    const businessType = resolveBusinessType(input.businessType);
    const typeEmphasis = BUSINESS_TYPE_EMPHASIS[businessType];

    const topFlags = input.flags.slice(0, 3);
    const topRecs = input.recommendations.slice(0, 3);

    const weakestArea = this.findWeakestArea(input.scores);
    const strongestArea = this.findStrongestArea(input.scores);

    const scoresSummary = Object.entries(input.scores)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}/100`)
      .join(', ');

    const prompt = `You are a strategic business advisor. Analyze this business profile and provide a concise strategic summary.

BUSINESS PROFILE:
- Name: ${input.businessName || 'Unknown Business'}
- Stage: ${stageContext.label} — ${stageContext.description}
- Type: ${businessType} — ${typeEmphasis?.description || ''}

SCORES: ${scoresSummary}

TOP FLAGS:
${topFlags.length > 0 ? topFlags.map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`).join('\n') : '- No critical flags'}

TOP RECOMMENDATIONS:
${topRecs.map((r) => `- [${r.priority.toUpperCase()}] ${r.title}: ${r.description}`).join('\n')}

FINANCIAL HIGHLIGHTS:
${input.financialHighlights ? `- Revenue: $${input.financialHighlights.revenue ?? 0}\n- Expenses: $${input.financialHighlights.expenses ?? 0}\n- Profit: $${input.financialHighlights.profit ?? 0}\n- Break-even timeline: ${input.financialHighlights.breakEvenMonths ?? 'Unknown'} months` : 'No financial data available'}

WEAKEST AREA: ${weakestArea.key} (score: ${weakestArea.value}/100)
STRONGEST AREA: ${strongestArea.key} (score: ${strongestArea.value}/100)

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{"characterization":"One-line characterization of where this business stands","strongestArea":"Analysis of their strongest area and how to leverage it","weakestArea":"Analysis of their weakest area and why it matters","highestLeverageMove":"The single highest-impact action they should take next","profitabilityInsight":"Insight about their path to or improvement of profitability","riskInsight":"Key risk they should be aware of and how to mitigate it"}`;

    const result = await this.aiUsageService.callAi({
      businessId: input.businessId,
      feature: 'guidance_summary',
      messages: [
        {
          role: 'system',
          content: 'You are a strategic business advisor that provides concise, actionable assessments. Always respond with valid JSON only. Be direct and specific — reference actual data points provided.',
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: 800,
      temperature: 0.6,
    });

    try {
      const parsed = JSON.parse(result.content);
      return {
        characterization: parsed.characterization || this.fallbackCharacterization(input),
        strongestArea: parsed.strongestArea || `Your strongest area is ${strongestArea.key}.`,
        weakestArea: parsed.weakestArea || `Your weakest area is ${weakestArea.key}.`,
        highestLeverageMove: parsed.highestLeverageMove || 'Focus on your top recommendation.',
        profitabilityInsight: parsed.profitabilityInsight || 'Review your pricing and cost structure.',
        riskInsight: parsed.riskInsight || 'Address critical flags to reduce risk.',
        isAiGenerated: true,
      };
    } catch {
      this.logger.warn('Failed to parse AI response, using template fallback');
      return this.generateTemplateSummary(input);
    }
  }

  generateTemplateSummary(input: AiFeedbackInput): AiStrategicSummary {
    const stageContext = resolveStageContext(input.businessStage);
    const businessType = resolveBusinessType(input.businessType);
    const weakest = this.findWeakestArea(input.scores);
    const strongest = this.findStrongestArea(input.scores);
    const criticalFlags = input.flags.filter((f) => f.severity === 'critical');
    const topRec = input.recommendations[0];

    const characterization = this.fallbackCharacterization(input);

    const strongestArea = `Your strongest area is ${this.humanizeScoreKey(strongest.key)} with a score of ${strongest.value}/100. This is a solid foundation to build on — leverage this strength in your marketing and positioning.`;

    const weakestArea = `Your weakest area is ${this.humanizeScoreKey(weakest.key)} at ${weakest.value}/100. ${
      weakest.value < 30
        ? 'This is critically low and is likely holding your business back.'
        : 'Improving this area will have a significant positive impact on your overall business health.'
    }`;

    const highestLeverageMove = topRec
      ? `${topRec.title} — ${topRec.suggestedAction}`
      : `Focus on improving ${this.humanizeScoreKey(weakest.key)}, as it is your biggest opportunity for growth.`;

    const profitabilityInsight = input.financialHighlights
      ? this.buildProfitabilityInsight(input.financialHighlights)
      : `As a ${stageContext.label.toLowerCase()} ${businessType} business, focus on establishing clear pricing that reflects your value and tracking costs diligently to understand your true margins.`;

    const riskInsight = criticalFlags.length > 0
      ? `You have ${criticalFlags.length} critical issue${criticalFlags.length > 1 ? 's' : ''} that need immediate attention: ${criticalFlags.map((f) => f.message).join('; ')}. Addressing these should be your top priority.`
      : `No critical risks identified, but continue monitoring ${this.humanizeScoreKey(weakest.key)} to prevent it from becoming a blocker.`;

    return {
      characterization,
      strongestArea,
      weakestArea,
      highestLeverageMove,
      profitabilityInsight,
      riskInsight,
      isAiGenerated: false,
    };
  }

  private fallbackCharacterization(input: AiFeedbackInput): string {
    const stageContext = resolveStageContext(input.businessStage);
    const businessType = resolveBusinessType(input.businessType);
    const avgScore = this.averageScore(input.scores);
    const health = avgScore >= 70 ? 'healthy' : avgScore >= 50 ? 'developing' : avgScore >= 30 ? 'early-stage' : 'needs foundation work';

    return `${input.businessName || 'This business'} is a ${health} ${businessType} business at the ${stageContext.label.toLowerCase()} with an average health score of ${avgScore}/100.`;
  }

  private buildProfitabilityInsight(financials: NonNullable<AiFeedbackInput['financialHighlights']>): string {
    const { revenue = 0, expenses = 0, profit, breakEvenMonths } = financials;
    const margin = revenue > 0 ? Math.round(((revenue - expenses) / revenue) * 100) : 0;

    if (revenue === 0) {
      return 'No revenue recorded yet. Focus on generating your first sales before optimizing for profitability.';
    }

    if (margin < 0) {
      return `Your business is currently operating at a loss with a ${Math.abs(margin)}% negative margin. ${
        breakEvenMonths ? `At the current trajectory, break-even is estimated at ${breakEvenMonths} months.` : 'Reducing costs or increasing prices should be an immediate priority.'
      }`;
    }

    if (margin < 20) {
      return `Your profit margin is ${margin}%, which is thin. Aim for at least 30-40% to build a sustainable business. Consider raising prices or reducing variable costs.`;
    }

    return `Your profit margin is ${margin}%, which is ${margin >= 40 ? 'strong' : 'reasonable'}. ${
      profit !== undefined ? `You are generating $${profit.toLocaleString()} in profit.` : ''
    } Continue monitoring costs as you scale to maintain healthy margins.`;
  }

  private findWeakestArea(scores: GuidanceScores): { key: string; value: number } {
    let weakest = { key: 'overall', value: 100 };
    for (const [key, value] of Object.entries(scores)) {
      if (value !== undefined && value !== null && value < weakest.value) {
        weakest = { key, value };
      }
    }
    return weakest;
  }

  private findStrongestArea(scores: GuidanceScores): { key: string; value: number } {
    let strongest = { key: 'overall', value: 0 };
    for (const [key, value] of Object.entries(scores)) {
      if (value !== undefined && value !== null && value > strongest.value) {
        strongest = { key, value };
      }
    }
    return strongest;
  }

  private averageScore(scores: GuidanceScores): number {
    const values = Object.values(scores).filter((v): v is number => v !== undefined && v !== null);
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }

  private humanizeScoreKey(key: string): string {
    const map: Record<string, string> = {
      offerClarity: 'offer clarity',
      customerClarity: 'customer clarity',
      valueProposition: 'value proposition',
      basicViability: 'basic viability',
      pricingScore: 'pricing',
      costEfficiency: 'cost efficiency',
      legalCompliance: 'legal compliance',
      taxSetup: 'tax setup',
      financialSetup: 'financial setup',
      onboardingProcess: 'onboarding process',
      workflowMaturity: 'workflow maturity',
      leadGeneration: 'lead generation',
      salesProcess: 'sales process',
      retentionScore: 'customer retention',
      dataPrivacy: 'data privacy',
      founderDependency: 'founder dependency',
      contractFormality: 'contract formality',
      operationalVisibility: 'operational visibility',
      profitability: 'profitability',
      businessModel: 'business model',
      initialAcquisition: 'initial acquisition',
      customerFeedback: 'customer feedback',
      systemization: 'systemization',
      delegation: 'delegation',
      capacity: 'capacity',
      marginImprovement: 'margin improvement',
      scalingStrategy: 'scaling strategy',
      riskReduction: 'risk reduction',
      strategicExpansion: 'strategic expansion',
    };
    return map[key] || key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  }
}

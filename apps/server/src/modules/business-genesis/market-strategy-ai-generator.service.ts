import { Injectable, Inject, Logger } from '@nestjs/common';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { coerceToContract } from '../ai/ai-output-contracts';
import type {
  GenesisSwotPestlePositioningResult,
  GenesisCompetitorResult,
  GenesisLaunchPlanResult,
} from '../ai/ai-output-contracts';

const SWOT_FALLBACK: GenesisSwotPestlePositioningResult = {
  swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
  pestle: { political: '', economic: '', social: '', technological: '', legal: '', environmental: '' },
  positioning: { tagline: '', valueProposition: '', keyMessages: [], differentiators: [], targetSegments: [] },
  analysisSummary: { marketOpportunityScore: 0, keyInsight: '' },
};

const COMPETITORS_FALLBACK: GenesisCompetitorResult[] = [];

const LAUNCH_PLAN_FALLBACK: GenesisLaunchPlanResult = {
  launchPlan: { summary: '', phases: [] },
};

@Injectable()
export class MarketStrategyAiGenerator {
  private readonly logger = new Logger(MarketStrategyAiGenerator.name);

  constructor(
    @Inject(ModelGatewayService) private readonly modelGateway: ModelGatewayService,
  ) {}

  async generateSwotPestlePositioning(businessId: string, context: string): Promise<GenesisSwotPestlePositioningResult> {
    const systemPrompt = `You are the KEYFLOWOS Market Strategy engine. Produce structured strategy content for a small business based on its blueprint.

Rules:
- Be specific to the business context. Do not limit yourself to the Caribbean; adapt to the stated country and region.
- Use concise, actionable language.
- For SWOT, list 3–5 bullet points per quadrant.
- For PESTLE, write 1–2 sentences per factor.
- For positioning, produce a tagline, value proposition, 3 key messages, 3 differentiators, and 2 target segments.
- For analysisSummary, score market opportunity from 0–100 and write a one-sentence key insight.

Return ONLY valid JSON matching this schema:
{
  "swot": { "strengths": string[], "weaknesses": string[], "opportunities": string[], "threats": string[] },
  "pestle": { "political": string, "economic": string, "social": string, "technological": string, "legal": string, "environmental": string },
  "positioning": { "tagline": string, "valueProposition": string, "keyMessages": string[], "differentiators": string[], "targetSegments": string[] },
  "analysisSummary": { "marketOpportunityScore": number, "keyInsight": string }
}`;

    const response = await this.safeComplete(businessId, 'swot-pestle-positioning', {
      taskCategory: 'analysis',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate a SWOT analysis, PESTLE analysis, and positioning statement for this business.\n\n${context}` },
      ],
      maxTokens: 2500,
      temperature: 0.4,
    });

    return this.parseAndCoerce<GenesisSwotPestlePositioningResult>(
      response,
      'genesis_swot_pestle_positioning',
      SWOT_FALLBACK,
    );
  }

  async generateCompetitors(businessId: string, context: string): Promise<GenesisCompetitorResult[]> {
    const systemPrompt = `You are the KEYFLOWOS Market Strategy engine. Identify 3–5 plausible competitor archetypes for the business described.

Rules:
- Do not invent real company names unless you are certain.
- Use plausible competitor archetypes (e.g., "established local bakery", "national ecommerce marketplace") when uncertain.
- Adhere to the business's country and region.
- threatLevel must be one of LOW, MEDIUM, or HIGH.

Return ONLY valid JSON matching this schema:
{
  "competitors": [
    { "name": string, "threatLevel": "LOW" | "MEDIUM" | "HIGH", "strengths": string[], "weaknesses": string[], "positioning": string }
  ]
}`;

    const response = await this.safeComplete(businessId, 'competitors', {
      taskCategory: 'analysis',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate competitor profiles for this business.\n\n${context}` },
      ],
      maxTokens: 1500,
      temperature: 0.4,
    });

    const parsed = this.parseAndCoerce<{ competitors: unknown[] }>(
      response,
      'genesis_competitors',
      { competitors: [] },
    );

    const rawCompetitors = Array.isArray(parsed.competitors) ? parsed.competitors : [];
    const normalized = rawCompetitors.slice(0, 5).map((c): GenesisCompetitorResult => {
      const record = c as Record<string, unknown>;
      const threatLevel = this.normalizeThreatLevel(record.threatLevel);
      return {
        name: typeof record.name === 'string' ? record.name : 'Unknown competitor',
        threatLevel,
        strengths: Array.isArray(record.strengths) ? record.strengths.filter((s): s is string => typeof s === 'string') : [],
        weaknesses: Array.isArray(record.weaknesses) ? record.weaknesses.filter((s): s is string => typeof s === 'string') : [],
        positioning: typeof record.positioning === 'string' ? record.positioning : null,
      };
    });

    if (rawCompetitors.length > 5) {
      this.logger.warn(`Received ${rawCompetitors.length} competitors; truncated to 5`);
    }

    return normalized.length > 0 ? normalized : COMPETITORS_FALLBACK;
  }

  async generateLaunchPlan(businessId: string, context: string): Promise<GenesisLaunchPlanResult> {
    const systemPrompt = `You are the KEYFLOWOS Market Strategy engine. Create a 90-day marketing launch plan for the business.

Rules:
- Phases should be realistic for a small business with limited budget/time.
- Each phase must have a name, duration (e.g., "Weeks 1–4"), and 3–5 concrete actions.
- Include a one-paragraph summary.

Return ONLY valid JSON matching this schema:
{
  "launchPlan": {
    "summary": string,
    "phases": [
      { "name": string, "duration": string, "actions": string[] }
    ]
  }
}`;

    const response = await this.safeComplete(businessId, 'launch-plan', {
      taskCategory: 'analysis',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate a 90-day marketing launch plan for this business.\n\n${context}` },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    return this.parseAndCoerce<GenesisLaunchPlanResult>(
      response,
      'genesis_launch_plan',
      LAUNCH_PLAN_FALLBACK,
    );
  }

  private async safeComplete(
    businessId: string,
    label: string,
    params: Omit<Parameters<ModelGatewayService['complete']>[0], 'businessId'>,
  ): Promise<string | null> {
    try {
      const response = await this.modelGateway.complete({ businessId, ...params });
      return response.content ?? null;
    } catch (err: any) {
      this.logger.warn(`Model gateway call failed for ${label}: ${(err as Error).message}; using fallback`);
      return null;
    }
  }

  private parseAndCoerce<T>(
    raw: string | null,
    contract: 'genesis_swot_pestle_positioning' | 'genesis_competitors' | 'genesis_launch_plan',
    fallback: T,
  ): T {
    if (!raw) {
      this.logger.warn(`Empty model response for ${contract}; using fallback`);
      return fallback;
    }
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return coerceToContract<T>(parsed, contract, fallback);
    } catch (err: any) {
      this.logger.warn(`Failed to parse/coerce ${contract}: ${(err as Error).message}; using fallback`);
      return fallback;
    }
  }

  private normalizeThreatLevel(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' | null {
    if (typeof value !== 'string') return null;
    const upper = value.toUpperCase();
    if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH') return upper;
    return null;
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GeneratedRecommendation } from './guidance-recommendation.service';

export interface RoadmapItemData {
  orderIndex: number;
  actionTitle: string;
  whyItMatters: string;
  expectedOutcome: string;
  linkedScoreArea: string;
  category: string;
  priority: string;
}

const CATEGORY_ORDER: Record<string, number> = {
  legal: 0,
  compliance: 1,
  clarity: 2,
  pricing: 3,
  operations: 4,
  sales: 5,
  retention: 6,
  growth: 7,
};

@Injectable()
export class GuidanceRoadmapService {
  private readonly logger = new Logger(GuidanceRoadmapService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getRoadmap(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      return { items: [] };
    }

    const items = await this.prisma.client.roadmapItem.findMany({
      where: { guidanceProfileId: profile.id },
      orderBy: { sequenceOrder: 'asc' },
    });

    return { items };
  }

  buildRoadmap(recommendations: GeneratedRecommendation[]): RoadmapItemData[] {
    const sorted = [...recommendations].sort((a, b) => {
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const catOrderA = CATEGORY_ORDER[a.category] ?? 99;
      const catOrderB = CATEGORY_ORDER[b.category] ?? 99;

      if (catOrderA !== catOrderB) return catOrderA - catOrderB;

      const aPriority = priorityOrder[a.priority] ?? 3;
      const bPriority = priorityOrder[b.priority] ?? 3;
      if (aPriority !== bPriority) return aPriority - bPriority;

      const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (impactOrder[a.impactLevel] ?? 2) - (impactOrder[b.impactLevel] ?? 2);
    });

    const top = sorted.slice(0, 10);

    return top.map((rec, index) => ({
      orderIndex: index + 1,
      actionTitle: rec.title,
      whyItMatters: rec.rationale,
      expectedOutcome: this.generateExpectedOutcome(rec),
      linkedScoreArea: rec.triggerScoreKey,
      category: rec.category,
      priority: rec.priority,
    }));
  }

  async persistRoadmap(
    assessmentId: string,
    roadmapItems: RoadmapItemData[],
  ): Promise<void> {
    await this.prisma.client.roadmapItem.deleteMany({
      where: { assessmentId },
    });

    for (const item of roadmapItems) {
      await this.prisma.client.roadmapItem.create({
        data: {
          assessmentId,
          orderIndex: item.orderIndex,
          actionTitle: item.actionTitle,
          whyItMatters: item.whyItMatters,
          expectedOutcome: item.expectedOutcome,
          linkedScoreArea: item.linkedScoreArea,
        },
      });
    }
  }

  private generateExpectedOutcome(rec: GeneratedRecommendation): string {
    const outcomeMap: Record<string, string> = {
      clarify_offer: 'Clear, compelling offer statement that converts interest into action.',
      narrow_customer_segment: 'Focused ICP enabling higher conversion rates and more efficient marketing.',
      revise_pricing: 'Pricing aligned to value delivered, improving margins and cash flow.',
      reduce_costs: 'Leaner cost structure with improved profitability and longer runway.',
      formalize_registration: 'Legally compliant business structure with formal protections in place.',
      improve_tax_setup: 'Organized tax and accounting systems reducing compliance risk.',
      open_bank_account: 'Separated business finances enabling accurate bookkeeping and cash flow tracking.',
      build_onboarding_process: 'Consistent client experience reducing churn and increasing satisfaction.',
      create_workflow_documentation: 'Documented processes enabling delegation and quality consistency.',
      define_lead_generation_channel: 'Predictable lead flow from at least one reliable channel.',
      build_sales_pipeline: 'Visible sales pipeline with measurable conversion rates and revenue forecasting.',
      create_retention_strategy: 'Higher customer lifetime value through repeat business and referrals.',
      improve_data_privacy_compliance: 'Compliant data handling practices building customer trust.',
      reduce_founder_dependency: 'Business can operate independently, reducing burnout risk and enabling scale.',
      formalize_contracts: 'Protected business relationships with clear terms and expectations.',
    };

    return outcomeMap[rec.templateId] || `Improved ${rec.triggerScoreKey} score and stronger business foundation.`;
  }
}

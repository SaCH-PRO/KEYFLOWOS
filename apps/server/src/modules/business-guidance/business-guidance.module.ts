import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BusinessGuidanceController } from './business-guidance.controller';
import { GuidanceProfileService } from './guidance-profile.service';
import { GuidanceScoringService } from './guidance-scoring.service';
import { GuidanceFinancialService } from './guidance-financial.service';
import { GuidanceFlagsService } from './guidance-flags.service';
import { GuidanceRecommendationService } from './guidance-recommendation.service';
import { GuidanceRoadmapService } from './guidance-roadmap.service';
import { GuidanceAiFeedbackService } from './guidance-ai-feedback.service';
import { GuidanceAssessmentService } from './guidance-assessment.service';
import { AiModule } from '../ai/ai.module';
import { AiUsageService } from '../ai/ai-usage.service';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [BusinessGuidanceController],
  providers: [
    GuidanceProfileService,
    GuidanceScoringService,
    GuidanceFinancialService,
    GuidanceFlagsService,
    GuidanceRecommendationService,
    GuidanceRoadmapService,
    GuidanceAiFeedbackService,
    GuidanceAssessmentService,
    {
      provide: 'AI_USAGE_SERVICE',
      useExisting: AiUsageService,
    },
  ],
  exports: [
    GuidanceProfileService,
    GuidanceScoringService,
    GuidanceFinancialService,
    GuidanceFlagsService,
    GuidanceRecommendationService,
    GuidanceRoadmapService,
    GuidanceAiFeedbackService,
    GuidanceAssessmentService,
  ],
})
export class BusinessGuidanceModule {}

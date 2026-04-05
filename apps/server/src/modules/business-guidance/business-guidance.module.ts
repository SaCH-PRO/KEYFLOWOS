import { Module } from '@nestjs/common';
import { BusinessGuidanceController } from './business-guidance.controller';
import { GuidanceProfileService } from './guidance-profile.service';
import { GuidanceScoringService } from './guidance-scoring.service';
import { GuidanceFinancialService } from './guidance-financial.service';
import { GuidanceRecommendationService } from './guidance-recommendation.service';
import { GuidanceRoadmapService } from './guidance-roadmap.service';
import { GuidanceAiFeedbackService } from './guidance-ai-feedback.service';
import { GuidanceAssessmentService } from './guidance-assessment.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [BusinessGuidanceController],
  providers: [
    GuidanceProfileService,
    GuidanceScoringService,
    GuidanceFinancialService,
    GuidanceRecommendationService,
    GuidanceRoadmapService,
    GuidanceAiFeedbackService,
    GuidanceAssessmentService,
  ],
  exports: [
    GuidanceProfileService,
    GuidanceScoringService,
    GuidanceFinancialService,
    GuidanceRecommendationService,
    GuidanceRoadmapService,
    GuidanceAiFeedbackService,
    GuidanceAssessmentService,
  ],
})
export class BusinessGuidanceModule {}

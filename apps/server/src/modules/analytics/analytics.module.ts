import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEngineService } from './analytics-engine.service';
import { ProjectionService } from './projection.service';
import { GrowthIntelligenceService } from './growth-intelligence.service';
import { MaturityAssessmentService } from './maturity-assessment.service';
import { AnalyticsSchedulerService } from './analytics-scheduler.service';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsEngineService,
    ProjectionService,
    GrowthIntelligenceService,
    MaturityAssessmentService,
    AnalyticsSchedulerService,
  ],
  exports: [
    AnalyticsEngineService,
    ProjectionService,
    GrowthIntelligenceService,
    MaturityAssessmentService,
  ],
})
export class AnalyticsModule {}

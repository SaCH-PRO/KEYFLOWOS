import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnalyticsEngineService } from './analytics-engine.service';
import { ProjectionService } from './projection.service';
import { GrowthInsightGeneratorService } from './growth-insight-generator.service';
import { MaturityAssessmentService } from './maturity-assessment.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class AnalyticsSchedulerService {
  private readonly logger = new Logger(AnalyticsSchedulerService.name);

  constructor(
    @Inject(AnalyticsEngineService) private readonly engine: AnalyticsEngineService,
    @Inject(ProjectionService) private readonly projection: ProjectionService,
    @Inject(GrowthInsightGeneratorService) private readonly intelligence: GrowthInsightGeneratorService,
    @Inject(MaturityAssessmentService) private readonly maturity: MaturityAssessmentService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async generateDailySnapshots() {
    this.logger.log('Starting daily snapshot generation');
    try {
      const result = await this.engine.generateDailySnapshots();
      this.logger.log(`Generated ${result.count} daily snapshots`);
    } catch (error: any) {
      this.logger.error('Daily snapshot generation failed', error);
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async generateWeeklySnapshots() {
    this.logger.log('Starting weekly snapshot generation');
    try {
      const result = await this.engine.generateWeeklySnapshots();
      this.logger.log(`Generated ${result.count} weekly snapshots`);
    } catch (error: any) {
      this.logger.error('Weekly snapshot generation failed', error);
    }
  }

  @Cron('0 2 1 * *') // 1st of each month at 2 AM
  async generateMonthlySnapshots() {
    this.logger.log('Starting monthly snapshot generation');
    try {
      const result = await this.engine.generateMonthlySnapshots();
      this.logger.log(`Generated ${result.count} monthly snapshots`);
    } catch (error: any) {
      this.logger.error('Monthly snapshot generation failed', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async generateProjections() {
    this.logger.log('Starting projection generation');
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true },
      });
      let count = 0;
      for (const business of businesses) {
        try {
          await this.projection.generateRevenueProjection(business.id);
          count++;
        } catch (error: any) {
          this.logger.error(`Failed projection for ${business.id}`, error);
        }
      }
      this.logger.log(`Generated ${count} projections`);
    } catch (error: any) {
      this.logger.error('Projection generation failed', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async generateInsights() {
    this.logger.log('Starting insight generation');
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true },
      });
      let count = 0;
      for (const business of businesses) {
        try {
          const result = await this.intelligence.generateInsights(business.id);
          count += result.generated;
        } catch (error: any) {
          this.logger.error(`Failed insights for ${business.id}`, error);
        }
      }
      this.logger.log(`Generated ${count} insights`);
    } catch (error: any) {
      this.logger.error('Insight generation failed', error);
    }
  }

  @Cron('0 5 1 * *') // 1st of each month at 5 AM
  async assessMaturity() {
    this.logger.log('Starting maturity assessment');
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true },
      });
      let count = 0;
      for (const business of businesses) {
        try {
          await this.maturity.assessBusiness(business.id);
          count++;
        } catch (error: any) {
          this.logger.error(`Failed maturity for ${business.id}`, error);
        }
      }
      this.logger.log(`Assessed ${count} businesses`);
    } catch (error: any) {
      this.logger.error('Maturity assessment failed', error);
    }
  }
}

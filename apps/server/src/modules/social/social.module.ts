import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { SocialConnectionsService } from './social-connections.service';
import { SocialPublishingService } from './social-publishing.service';
import { SocialAnalyticsService } from './social-analytics.service';
import { SocialSchedulerService } from './social-scheduler.service';
import { SocialGapDetectorService } from './social-gap-detector.service';
import { MetaSocialIngestionService } from './meta-social-ingestion.service';
import { KeyInboxModule } from '../key-inbox/key-inbox.module';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Module({
  imports: [KeyInboxModule],
  controllers: [SocialController],
  providers: [
    SocialService,
    SocialConnectionsService,
    SocialPublishingService,
    SocialAnalyticsService,
    SocialSchedulerService,
    SocialGapDetectorService,
    MetaSocialIngestionService,
    EntityResolutionService,
    PrismaService,
  ],
  exports: [
    SocialService,
    SocialConnectionsService,
    SocialPublishingService,
    SocialAnalyticsService,
    SocialSchedulerService,
    SocialGapDetectorService,
    MetaSocialIngestionService,
  ],
})
export class SocialModule {}

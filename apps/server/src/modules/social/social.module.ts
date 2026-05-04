import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { SocialConnectionsService } from './social-connections.service';
import { SocialPublishingService } from './social-publishing.service';
import { SocialAnalyticsService } from './social-analytics.service';
import { SocialSchedulerService } from './social-scheduler.service';

@Module({
  controllers: [SocialController],
  providers: [SocialService, SocialConnectionsService, SocialPublishingService, SocialAnalyticsService, SocialSchedulerService],
  exports: [SocialService, SocialConnectionsService, SocialPublishingService, SocialAnalyticsService, SocialSchedulerService],
})
export class SocialModule {}

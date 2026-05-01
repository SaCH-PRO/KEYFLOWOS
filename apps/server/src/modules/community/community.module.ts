import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { ReputationService } from './reputation.service';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [CommunityController],
  providers: [CommunityService, ReputationService],
  exports: [CommunityService, ReputationService],
})
export class CommunityModule {}

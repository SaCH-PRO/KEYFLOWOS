import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { SocialConnectionsService } from './social-connections.service';
import { SocialPublishingService } from './social-publishing.service';

@Module({
  controllers: [SocialController],
  providers: [SocialService, SocialConnectionsService, SocialPublishingService],
  exports: [SocialService, SocialConnectionsService, SocialPublishingService],
})
export class SocialModule {}

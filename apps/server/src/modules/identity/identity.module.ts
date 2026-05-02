import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { IdentitySignupService } from './identity-signup.service';
import { BusinessContextService } from './business-context.service';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [IdentityController],
  providers: [IdentityService, IdentitySignupService, BusinessContextService],
  exports: [IdentityService, IdentitySignupService, BusinessContextService],
})
export class IdentityModule {}

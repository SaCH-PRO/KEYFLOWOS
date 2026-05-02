import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { IdentitySignupService } from './identity-signup.service';
import { BusinessContextService } from './business-context.service';
import { AuthSecurityService } from './auth-security.service';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [AiModule, NotificationsModule, PrismaModule],
  controllers: [IdentityController],
  providers: [IdentityService, IdentitySignupService, BusinessContextService, AuthSecurityService],
  exports: [IdentityService, IdentitySignupService, BusinessContextService, AuthSecurityService],
})
export class IdentityModule {}

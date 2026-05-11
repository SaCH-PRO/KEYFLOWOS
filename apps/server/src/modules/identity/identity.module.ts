import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { IdentitySignupService } from './identity-signup.service';
import { BusinessContextService } from './business-context.service';
import { AuthSecurityService } from './auth-security.service';
import { PasswordPolicyService } from './password-policy.service';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [AiModule, NotificationsModule, BlueprintModule, PrismaModule],
  controllers: [IdentityController],
  providers: [IdentityService, IdentitySignupService, BusinessContextService, AuthSecurityService, PasswordPolicyService],
  exports: [IdentityService, IdentitySignupService, BusinessContextService, AuthSecurityService, PasswordPolicyService],
})
export class IdentityModule {}

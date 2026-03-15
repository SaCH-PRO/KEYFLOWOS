import { Module } from '@nestjs/common';
import { OnboardingConciergeController } from './onboarding-concierge.controller';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [OnboardingConciergeController],
  providers: [OnboardingConciergeService],
  exports: [OnboardingConciergeService],
})
export class OnboardingConciergeModule {}

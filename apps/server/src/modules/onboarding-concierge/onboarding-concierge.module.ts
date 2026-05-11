import { Module } from '@nestjs/common';
import { OnboardingConciergeController } from './onboarding-concierge.controller';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BlueprintModule } from '../blueprint/blueprint.module';

@Module({
  imports: [PrismaModule, AiModule, BlueprintModule],
  controllers: [OnboardingConciergeController],
  providers: [OnboardingConciergeService],
  exports: [OnboardingConciergeService],
})
export class OnboardingConciergeModule {}

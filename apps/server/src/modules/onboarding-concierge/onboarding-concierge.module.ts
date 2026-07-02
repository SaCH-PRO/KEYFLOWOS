import { Module } from '@nestjs/common';
import { OnboardingConciergeController } from './onboarding-concierge.controller';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { OnboardingStateService } from './onboarding-state.service';
import { DemoDataSeederService } from './demo-data-seeder.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [PrismaModule, AiModule, BlueprintModule, CatalogModule],
  controllers: [OnboardingConciergeController],
  providers: [OnboardingConciergeService, OnboardingStateService, DemoDataSeederService],
  exports: [OnboardingConciergeService, OnboardingStateService, DemoDataSeederService],
})
export class OnboardingConciergeModule {}

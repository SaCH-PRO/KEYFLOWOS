import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BlueprintOnboardingService, OnboardingMessage } from './blueprint-onboarding.service';

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintOnboardingController {
  constructor(
    @Inject(BlueprintOnboardingService) private readonly onboarding: BlueprintOnboardingService,
  ) {}

  @Post('onboarding-chat')
  async onboardingChat(
    @Param('businessId') businessId: string,
    @Body() body: { message: string; history?: OnboardingMessage[] },
  ) {
    return this.onboarding.chat(businessId, body.message, body.history || []);
  }

  @Post('onboarding-reset')
  async onboardingReset(@Param('businessId') businessId: string) {
    this.onboarding.reset(businessId);
    return { ok: true };
  }
}

import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BlueprintOnboardingService, OnboardingMessage } from './blueprint-onboarding.service';

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintOnboardingController {
  constructor(
    @Inject(BlueprintOnboardingService) private readonly onboarding: BlueprintOnboardingService,
  ) {}

  /**
   * PR196-GENOME: the Business Genome interview transcript of THIS business
   * (the tenant BusinessGuard verified), as the server cache holds it, with
   * progress derived from the saved blueprint. Any member may read it: the
   * genome lives in business_blueprints, which every blueprint route serves to
   * any member (GET/PATCH /blueprint/businesses/:businessId, POST
   * onboarding-chat); owner ruling D-11 makes the Business row's profile
   * fields owner-only, not the blueprint. A non-member gets BusinessGuard's 403.
   */
  @Get('onboarding-history')
  async onboardingHistory(@Param('businessId') businessId: string) {
    return this.onboarding.getHistory(businessId);
  }

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

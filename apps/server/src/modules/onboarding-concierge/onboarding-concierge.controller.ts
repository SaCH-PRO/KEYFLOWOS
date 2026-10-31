import { Controller, Get, Post, Param, Body, UseGuards, Inject } from '@nestjs/common';
import { OnboardingConciergeService, AutoConfigureResult } from './onboarding-concierge.service';
import { OnboardingStateService } from './onboarding-state.service';
import {
  SaveOnboardingStepDto,
  ChatDto,
  AutoConfigureDto,
  DetectBusinessTypeDto,
  SnoozeNudgeDto,
} from './dto';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';

@Controller('onboarding-concierge/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class OnboardingConciergeController {
  constructor(
    @Inject(OnboardingConciergeService)
    private readonly concierge: OnboardingConciergeService,
    @Inject(OnboardingStateService)
    private readonly state: OnboardingStateService,
  ) {}

  @Get('status')
  async getSetupStatus(@Param('businessId') businessId: string) {
    return this.concierge.getSetupStatus(businessId);
  }

  @Get('state')
  async getConciergeState(@Param('businessId') businessId: string) {
    return this.concierge.getConciergeState(businessId);
  }

  @Get('onboarding-state')
  async getOnboardingState(@Param('businessId') businessId: string) {
    return this.state.getState(businessId);
  }

  @Post('onboarding-step')
  async saveOnboardingStep(
    @Param('businessId') businessId: string,
    @Body() body: SaveOnboardingStepDto,
  ) {
    return this.state.saveStep(businessId, body.step);
  }

  @Post('seed-demo')
  async seedDemoData(@Param('businessId') businessId: string) {
    return this.concierge.seedDemoData(businessId);
  }

  @Get('welcome')
  async getWelcomeMessage(@Param('businessId') businessId: string) {
    return this.concierge.getWelcomeMessage(businessId);
  }

  @Get('templates')
  async getTemplates() {
    return this.concierge.getAvailableTemplates();
  }

  @Get('templates/:templateId')
  async getTemplatePreview(@Param('templateId') templateId: string) {
    return this.concierge.getTemplatePreview(templateId);
  }

  @Post('chat')
  async chat(
    @Param('businessId') businessId: string,
    @Body() body: ChatDto,
  ) {
    return this.concierge.generateConciergeResponse(
      businessId,
      body.message,
      body.history || [],
    );
  }

  /**
   * R0-09b (owner ruling D-11, review R09-ST-3): auto-configure rewrites the
   * business profile (name, businessHours, store settings, slug, metaData), so
   * it is OWNER only; the check runs before the template or the body is used.
   */
  @Post('auto-configure')
  async autoConfigure(
    @Param('businessId') businessId: string,
    @Body() body: AutoConfigureDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<AutoConfigureResult> {
    await this.concierge.assertProfileOwner(businessId, user);
    return this.concierge.autoConfigureFromTemplate(businessId, body.templateId, body);
  }

  @Post('detect-type')
  async detectBusinessType(
    @Param('businessId') businessId: string,
    @Body() body: DetectBusinessTypeDto,
  ) {
    return this.concierge.detectBusinessType(businessId, body.description);
  }

  @Get('nudges')
  async getNudges(@Param('businessId') businessId: string) {
    return this.concierge.checkAndGenerateNudges(businessId);
  }

  @Post('nudges/:nudgeId/snooze')
  async snoozeNudge(
    @Param('businessId') businessId: string,
    @Param('nudgeId') nudgeId: string,
    @Body() body: SnoozeNudgeDto,
  ) {
    return this.concierge.snoozeNudge(businessId, nudgeId, body.days);
  }

  @Post('dismiss')
  async dismiss(@Param('businessId') businessId: string) {
    return this.concierge.dismissConcierge(businessId);
  }

  @Post('resume')
  async resume(@Param('businessId') businessId: string) {
    return this.concierge.resumeConcierge(businessId);
  }

  @Post('complete')
  async markComplete(@Param('businessId') businessId: string) {
    return this.concierge.markOnboardingComplete(businessId);
  }
}

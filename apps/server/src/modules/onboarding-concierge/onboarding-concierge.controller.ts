import { Controller, Get, Post, Patch, Param, Body, UseGuards, Inject, Query } from '@nestjs/common';
import { OnboardingConciergeService, AutoConfigureResult } from './onboarding-concierge.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('onboarding-concierge/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class OnboardingConciergeController {
  constructor(
    @Inject(OnboardingConciergeService)
    private readonly concierge: OnboardingConciergeService,
  ) {}

  @Get('status')
  async getSetupStatus(@Param('businessId') businessId: string) {
    return this.concierge.getSetupStatus(businessId);
  }

  @Get('state')
  async getConciergeState(@Param('businessId') businessId: string) {
    return this.concierge.getConciergeState(businessId);
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
    @Body() body: {
      message: string;
      history?: Array<{ role: string; content: string }>;
    },
  ) {
    return this.concierge.generateConciergeResponse(
      businessId,
      body.message,
      body.history || [],
    );
  }

  @Post('auto-configure')
  async autoConfigure(
    @Param('businessId') businessId: string,
    @Body() body: {
      templateId: string;
      createProducts?: boolean;
      setBusinessHours?: boolean;
      setPaymentMethods?: boolean;
      customBusinessName?: string;
    },
  ): Promise<AutoConfigureResult> {
    return this.concierge.autoConfigureFromTemplate(businessId, body.templateId, body);
  }

  @Post('detect-type')
  async detectBusinessType(
    @Body() body: { description: string },
  ) {
    return this.concierge.detectBusinessType(body.description);
  }

  @Get('nudges')
  async getNudges(@Param('businessId') businessId: string) {
    return this.concierge.checkAndGenerateNudges(businessId);
  }

  @Post('nudges/:nudgeId/snooze')
  async snoozeNudge(
    @Param('businessId') businessId: string,
    @Param('nudgeId') nudgeId: string,
    @Body() body: { days?: number },
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

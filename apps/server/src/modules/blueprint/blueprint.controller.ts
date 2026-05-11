import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BlueprintService } from './blueprint.service';
import { BlueprintPatch } from './blueprint.types';

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintController {
  constructor(@Inject(BlueprintService) private readonly blueprint: BlueprintService) {}

  @Get()
  async get(@Param('businessId') businessId: string) {
    return this.blueprint.getBlueprint(businessId);
  }

  @Patch()
  async update(
    @Param('businessId') businessId: string,
    @Body() body: BlueprintPatch,
  ) {
    return this.blueprint.updateBlueprint(businessId, body);
  }

  @Post('infer/onboarding')
  async inferFromOnboarding(
    @Param('businessId') businessId: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.blueprint.inferFromOnboarding(businessId, body.answers || {});
  }

  @Post('infer/events')
  async inferFromEvents(@Param('businessId') businessId: string) {
    return this.blueprint.inferFromEvents(businessId);
  }

  @Get('recommendations')
  async recommendations(@Param('businessId') businessId: string) {
    const steps = await this.blueprint.getRecommendedSetupSteps(businessId);
    return { steps };
  }
}

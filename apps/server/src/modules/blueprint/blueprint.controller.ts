import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BlueprintPatch, BlueprintService } from './blueprint.service';

// KEY-1 BusinessBlueprint REST surface. All endpoints are scoped to a
// businessId path param + protected by membership via BusinessGuard.

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintController {
  constructor(@Inject(BlueprintService) private readonly service: BlueprintService) {}

  @Get()
  async get(@Param('businessId') businessId: string) {
    const blueprint = await this.service.getBlueprint(businessId);
    return { blueprint };
  }

  @Patch()
  async update(@Param('businessId') businessId: string, @Body() body: BlueprintPatch) {
    const blueprint = await this.service.updateBlueprint(businessId, body ?? {});
    return { blueprint };
  }

  @Get('setup-steps')
  async setupSteps(@Param('businessId') businessId: string) {
    const steps = await this.service.getRecommendedSetupSteps(businessId);
    return { steps };
  }

  @Get('context')
  async context(@Param('businessId') businessId: string) {
    const context = await this.service.getBlueprintContext(businessId);
    return { context };
  }

  @Post('infer-from-events')
  async inferFromEvents(@Param('businessId') businessId: string) {
    const blueprint = await this.service.inferFromEvents(businessId);
    return { blueprint };
  }
}

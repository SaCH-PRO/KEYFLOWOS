import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { BusinessIntelligenceService } from './business-intelligence.service';

@Controller('intelligence/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class BusinessIntelligenceController {
  constructor(
    @Inject(BusinessIntelligenceService) private readonly intelligence: BusinessIntelligenceService,
  ) {}

  @Get('executive-brief')
  executiveBrief(@Param('businessId') businessId: string) {
    return this.intelligence.generateExecutiveBrief(businessId);
  }
}

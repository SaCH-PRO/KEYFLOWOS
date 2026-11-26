import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
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
  executiveBrief(
    @Param('businessId') businessId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    const reader = req?.user?.id ? { id: req.user.id, role: req.user.role } : null;
    return this.intelligence.generateExecutiveBrief(businessId, reader);
  }
}

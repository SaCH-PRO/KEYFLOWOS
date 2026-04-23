import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { FinancialCopilotService } from './financial-copilot.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';

@Controller('commerce')
@UseGuards(CrmRateLimitGuard)
export class FinancialCopilotController {
  constructor(
    @Inject(FinancialCopilotService) private readonly copilot: FinancialCopilotService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/financial-pulse')
  getFinancialPulse(@Param('businessId') businessId: string) {
    return this.copilot.getFinancialPulse(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/financial-alerts')
  async getFinancialAlerts(@Param('businessId') businessId: string) {
    const pulse = await this.copilot.getFinancialPulse(businessId);
    return { alerts: pulse.alerts };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(20, 60_000)
  @Get('businesses/:businessId/cash-flow-forecast')
  getCashFlowForecast(@Param('businessId') businessId: string) {
    return this.copilot.getCashFlowForecast(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/weekly-briefing')
  generateWeeklyBriefing(@Param('businessId') businessId: string) {
    return this.copilot.generateWeeklyBriefing(businessId);
  }
}

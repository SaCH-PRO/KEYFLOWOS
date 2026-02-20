import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('ai')
export class AiController {
  constructor(
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'ai' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/chat')
  async chat(
    @Param('businessId') businessId: string,
    @Body() body: { message: string; history?: Array<{ role: string; content: string }> },
  ) {
    return this.advisor.chat(businessId, body.message, body.history);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/briefing')
  async briefing(@Param('businessId') businessId: string) {
    return this.advisor.generateDailyBriefing(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/cash-flow-forecast')
  async cashFlowForecast(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.advisor.predictCashFlow(businessId, days ? parseInt(days, 10) : 30);
  }
}

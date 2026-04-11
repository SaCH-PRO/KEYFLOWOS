import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('ai')
export class AiController {
  constructor(
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/simulate')
  async simulate(
    @Param('businessId') businessId: string,
    @Body() body: { scenario: string; variables?: Record<string, any> },
  ) {
    return this.advisor.simulateScenario(businessId, body.scenario, body.variables);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/business-model')
  async generateBusinessModel(
    @Param('businessId') businessId: string,
    @Body() body: {
      businessIdea: string;
      targetMarket?: string;
      valueProposition?: string;
      revenueModel?: string;
      goals?: string;
      stage?: string;
      challenges?: string;
    },
  ) {
    return this.advisor.generateBusinessModel(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/seo-score')
  async seoScore(
    @Param('businessId') businessId: string,
    @Body() body: { title?: string; description?: string; content?: string; url?: string },
  ) {
    return this.advisor.scoreSEO(body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/usage')
  async getUsageSummary(@Param('businessId') businessId: string) {
    return this.aiUsage.getUsageSummary(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/usage/history')
  async getUsageHistory(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.aiUsage.getUsageHistory(
      businessId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/credits')
  async getCredits(@Param('businessId') businessId: string) {
    return this.aiUsage.checkCredits(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/billing')
  async getBilling(@Param('businessId') businessId: string) {
    return this.aiUsage.getBillingSummary(businessId);
  }
}

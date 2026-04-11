import { Body, Controller, Get, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('ai')
export class AiController {
  constructor(
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
      budget?: string;
      timeline?: string;
      teamSize?: string;
      location?: string;
      legalStructure?: string;
      industry?: string;
      problemSolved?: string;
      assets?: string;
      competitiveContext?: string;
      interactionMode?: string;
    },
  ) {
    const result = await this.advisor.generateBusinessModel(businessId, body);
    if (result.success && result.model) {
      const existing = await this.prisma.client.businessPlan.findFirst({
        where: { businessId },
        orderBy: { version: 'desc' },
      });
      await this.prisma.client.businessPlan.create({
        data: {
          businessId,
          version: existing ? existing.version + 1 : 1,
          name: `Business Plan v${existing ? existing.version + 1 : 1}`,
          status: 'ACTIVE',
          intake: body as any,
          model: result.model as any,
        },
      });
      if (existing) {
        await this.prisma.client.businessPlan.update({
          where: { id: existing.id },
          data: { status: 'SUPERSEDED' },
        });
      }
    }
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/business-plan')
  async getBusinessPlan(@Param('businessId') businessId: string) {
    const plan = await this.prisma.client.businessPlan.findFirst({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return { plan };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/business-plan/history')
  async getBusinessPlanHistory(@Param('businessId') businessId: string) {
    const plans = await this.prisma.client.businessPlan.findMany({
      where: { businessId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, name: true, status: true, createdAt: true },
    });
    return { plans };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/business-plan/:planId')
  async updateBusinessPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Body() body: { model?: Record<string, unknown>; name?: string },
  ) {
    const plan = await this.prisma.client.businessPlan.findFirst({
      where: { id: planId, businessId },
    });
    if (!plan) return { error: 'Plan not found' };
    const updated = await this.prisma.client.businessPlan.update({
      where: { id: planId },
      data: {
        ...(body.model ? { model: body.model as any } : {}),
        ...(body.name ? { name: body.name } : {}),
      },
    });
    return { plan: updated };
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

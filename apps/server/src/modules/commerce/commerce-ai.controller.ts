import { BadRequestException, Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CommerceAiService } from './commerce-ai.service';
import { CommerceStatsService } from './commerce-stats.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from '../crm/guards/feature-flag.guard';
import { checkAiRateLimit } from '../crm/ai-rate-limit.util';

@Controller('commerce')
@UseGuards(CrmRateLimitGuard)
export class CommerceAiController {
  private readonly startTime = Date.now();

  constructor(
    @Inject(CommerceAiService) private readonly commerceAi: CommerceAiService,
    @Inject(CommerceStatsService) private readonly stats: CommerceStatsService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/stats')
  getStats(@Param('businessId') businessId: string) {
    return this.stats.getCommerceStats(businessId);
  }

  @Get('health')
  async healthCheck() {
    const start = Date.now();
    const dbOk = await this.stats.healthPing();
    const cache = this.stats.getCacheMetrics();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk,
      cache,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      responseMs: Date.now() - start,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-analyze')
  analyzeRevenue(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.analyzeRevenue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/invoices/:invoiceId/ai-reminder')
  generateInvoiceReminder(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.commerceAi.generateInvoiceReminder(businessId, invoiceId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/products/:productId/ai-pricing')
  suggestPricing(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.commerceAi.suggestPricing(businessId, productId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-cashflow')
  cashFlowForecast(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.cashFlowForecast(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-search')
  aiSearch(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.commerceAi.naturalLanguageSearch(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-product-health')
  aiProductHealth(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.productHealthScan(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-client-intelligence')
  aiClientIntelligence(
    @Param('businessId') businessId: string,
    @Body() body: { contactId: string },
  ) {
    if (!body.contactId || typeof body.contactId !== 'string') {
      throw new BadRequestException('contactId is required');
    }
    checkAiRateLimit(businessId);
    return this.commerceAi.clientPaymentIntelligence(businessId, body.contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-quote-analysis')
  aiQuoteAnalysis(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.quoteWinAnalysis(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-command')
  aiCommand(
    @Param('businessId') businessId: string,
    @Body() body: { command: string },
  ) {
    if (!body.command || typeof body.command !== 'string') {
      throw new BadRequestException('command is required');
    }
    if (body.command.length > 500) {
      throw new BadRequestException('command must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.commerceAi.interpretCommand(businessId, body.command);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-execute')
  aiExecute(
    @Param('businessId') businessId: string,
    @Body() body: { action: string; params?: Record<string, any> },
  ) {
    if (!body.action || typeof body.action !== 'string') {
      throw new BadRequestException('action is required');
    }
    checkAiRateLimit(businessId);
    return this.commerceAi.executeCommand(businessId, body.action, body.params ?? {});
  }
}

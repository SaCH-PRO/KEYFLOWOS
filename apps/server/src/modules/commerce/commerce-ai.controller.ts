import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CommerceAiService } from './commerce-ai.service';
import { CommerceStatsService } from './commerce-stats.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from '../crm/guards/feature-flag.guard';
import { checkAiRateLimit } from '../crm/ai-rate-limit.util';

/**
 * V1-37b (V1-37 review ST-V37-2): every business-scoped route here reads
 * revenue data (invoices, quotes, payments, products, revenue figures), so each
 * requires revenue:read through ModuleScopeGuard, and ai-execute, which writes,
 * revenue:write. A member whose revenue scope is none is refused with 403
 * before CommerceAiService or CommerceStatsService is reached. The health
 * route reads no tenant data.
 */
@Controller('commerce')
@UseGuards(CrmRateLimitGuard)
export class CommerceAiController {
  private readonly startTime = Date.now();

  constructor(
    @Inject(CommerceAiService) private readonly commerceAi: CommerceAiService,
    @Inject(CommerceStatsService) private readonly stats: CommerceStatsService,
  ) {}

  /**
   * V1-37b (V1-37 review ST-V37-2): revenue figures, so revenue:read like every
   * other revenue read. It carried AuthGuard and BusinessGuard only, so a
   * member whose revenue scope is none read every invoice total.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-analyze')
  analyzeRevenue(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.analyzeRevenue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-cashflow')
  cashFlowForecast(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.cashFlowForecast(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-product-health')
  aiProductHealth(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.productHealthScan(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-quote-analysis')
  aiQuoteAnalysis(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.quoteWinAnalysis(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
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

  // V1-QUOTE-CHAIN-finish (review SEC-3 / SEC-V50-4): this route ran AuthGuard,
  // BusinessGuard and FeatureFlagGuard only (FeatureFlagGuard allows by
  // default), so any member, revenue:none included, could run its write
  // actions: send_quote and convert_quote wrote Quote.status around the
  // transition table (a customer-REJECTED quote marked ACCEPTED and then
  // invoiced, a converted quote re-opened to SENT), and mark_paid / void_invoice
  // write invoice status. Every action it executes is a revenue write (the
  // navigation and AI-tool actions write nothing and have no web caller), so
  // the route needs revenue:write like every other revenue write; the quote
  // actions run as the authenticated member through CommerceService.
  /**
   * V1-42-DM-LIFECYCLE-OWNER-CAS: executes revenue writes (mark an invoice
   * paid, void it, products, quotes), so it requires revenue:write like every
   * other revenue write route. It carried AuthGuard and BusinessGuard only, so
   * a member whose revenue scope is none could mark an invoice paid. The
   * caller is the actor the payment and the status change are recorded
   * against.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'write')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-execute')
  aiExecute(
    @Param('businessId') businessId: string,
    @Body() body: { action: string; params?: Record<string, any> },
    @Req() req: { user?: { id?: string } },
  ) {
    if (!body.action || typeof body.action !== 'string') {
      throw new BadRequestException('action is required');
    }
    checkAiRateLimit(businessId);
    return this.commerceAi.executeCommand(businessId, body.action, body.params ?? {}, req?.user?.id ?? null);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-collections-score')
  aiCollectionsScore(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.predictiveCollectionsScore(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/invoices/:invoiceId/ai-payment-plan')
  aiPaymentPlan(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.commerceAi.suggestPaymentPlan(businessId, invoiceId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/quotes/:quoteId/ai-follow-up')
  aiQuoteFollowUp(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.commerceAi.smartQuoteFollowUp(businessId, quoteId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-churn-risk')
  aiChurnRisk(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.churnRiskAlerts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-revenue-journey')
  aiRevenueJourney(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.commerceAi.revenueJourney(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('revenue', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/ai-quote-from-conversation')
  aiQuoteFromConversation(
    @Param('businessId') businessId: string,
    @Body() body: { conversationText: string },
  ) {
    if (!body.conversationText || typeof body.conversationText !== 'string') {
      throw new BadRequestException('conversationText is required');
    }
    if (body.conversationText.length > 10000) {
      throw new BadRequestException('conversationText must be 10000 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.commerceAi.quoteFromConversation(businessId, body.conversationText);
  }
}

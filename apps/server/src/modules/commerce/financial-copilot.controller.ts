import { Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { FinancialCopilotService, FinancialPulse, FinancialAlert, WeeklyBriefing } from './financial-copilot.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';
import { resolveTimelineViewer } from '../timeline/timeline-visibility';
import { briefingContactRule } from './revenue-intelligence.controller';

@Controller('commerce')
@UseGuards(CrmRateLimitGuard)
export class FinancialCopilotController {
  constructor(
    @Inject(FinancialCopilotService) private readonly copilot: FinancialCopilotService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/financial-pulse')
  getFinancialPulse(@Param('businessId') businessId: string): Promise<FinancialPulse> {
    return this.copilot.getFinancialPulse(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/financial-alerts')
  async getFinancialAlerts(@Param('businessId') businessId: string): Promise<{ alerts: FinancialAlert[] }> {
    const pulse = await this.copilot.getFinancialPulse(businessId);
    return { alerts: pulse.alerts };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(20, 60_000)
  @Get('businesses/:businessId/cash-flow-forecast')
  getCashFlowForecast(@Param('businessId') businessId: string) {
    return this.copilot.getCashFlowForecast(businessId);
  }

  /**
   * W7-BRIEFINGS-REST (review SEC-W6BS-1; owner ruling D-63): the weekly financial briefing is wholly
   * revenue (last week's and this week's revenue, expenses and net, receivables, the cash position, the
   * open finance queue) and was served to every member (AuthGuard + BusinessGuard only). It now needs
   * revenue read (ModuleScopeGuard, refused before any figure is read or the model is called). Its
   * prose is written by the model from the finance queue, whose slow-payer items name contacts
   * ('Slow payer: <name>', entityType 'contact'), so a line that names one the member may not open is
   * withheld (briefingContactRule, D-63: contact-bearing items only for contacts the member may open):
   * dropped from highlights and concerns, and a summary, recommendation or outlook that names one is
   * replaced by a neutral line.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/weekly-briefing')
  async generateWeeklyBriefing(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }): Promise<WeeklyBriefing> {
    const briefing = await this.copilot.generateWeeklyBriefing(businessId);
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    const queued = await this.prisma.client.financeActionItem.findMany({
      where: { businessId, status: 'OPEN', entityType: { equals: 'contact', mode: 'insensitive' } },
      select: { entityId: true },
    });
    const rule = await briefingContactRule(this.prisma, viewer, { id: { in: queued.map((item) => item.entityId) } });
    const shown = (text: string) => !rule.namesHidden(text);
    const line = (text: string, neutral: string) => (typeof text === 'string' && !shown(text) ? neutral : text);
    return {
      ...briefing,
      summary: line(briefing.summary, 'Your weekly financial briefing is ready.'),
      highlights: Array.isArray(briefing.highlights) ? briefing.highlights.filter(shown) : briefing.highlights,
      concerns: Array.isArray(briefing.concerns) ? briefing.concerns.filter(shown) : briefing.concerns,
      recommendation: line(briefing.recommendation, 'Follow up on outstanding invoices to maintain healthy cash flow.'),
      outlook: line(briefing.outlook, 'Focus on collections and controlling expenses this week.'),
    };
  }
}

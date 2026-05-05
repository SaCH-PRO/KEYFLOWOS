import {
  Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevenueForecastService } from './revenue-forecast.service';
import { SlowPayerDetector } from './slow-payer-detector.service';
import { PricingSignalsService } from './pricing-signals.service';
import { RevenueBriefingService, RevenueBriefingChase } from './revenue-briefing.service';

@Controller('commerce/businesses/:businessId/revenue-intelligence')
@UseGuards(AuthGuard, BusinessGuard)
export class RevenueIntelligenceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RevenueForecastService) private readonly forecast: RevenueForecastService,
    @Inject(SlowPayerDetector) private readonly slowPayer: SlowPayerDetector,
    @Inject(PricingSignalsService) private readonly pricing: PricingSignalsService,
    @Inject(RevenueBriefingService) private readonly briefing: RevenueBriefingService,
  ) {}

  private async ensureAccess(userId: string, businessId: string) {
    const biz = await this.prisma.client.business.findFirst({
      where: { id: businessId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    });
    if (!biz) throw new ForbiddenException('No access to this business');
  }

  @Get('forecast')
  async getForecast(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.forecast.compute(businessId);
  }

  @Get('slow-payers')
  async getSlowPayers(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const report = await this.slowPayer.detect(businessId);
    // Best-effort sync (don't block the response on it).
    void this.slowPayer.syncContactTags(businessId, report).catch(() => {});
    void this.slowPayer.syncRevenueActions(businessId, report).catch(() => {});
    return report;
  }

  @Get('pricing-signals')
  async getPricingSignals(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.pricing.detect(businessId);
  }

  @Get('briefing')
  async getBriefing(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.briefing.getOrGenerate(businessId);
  }

  @Post('briefing/regenerate')
  async regenerateBriefing(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    this.briefing.invalidate(businessId);
    return this.briefing.generate(businessId);
  }

  @Post('briefing/delegate-chase')
  async delegateChase(
    @Param('businessId') businessId: string,
    @Body() body: { chase: RevenueBriefingChase },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    if (!body?.chase?.title) {
      return { created: false, error: 'Missing chase' };
    }
    return this.briefing.delegateChase(businessId, body.chase);
  }
}

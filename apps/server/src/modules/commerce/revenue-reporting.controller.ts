import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RevenueReportPreset, RevenueReportingService } from './revenue-reporting.service';

const VALID_PRESETS: RevenueReportPreset[] = [
  'by-source',
  'by-contact',
  'by-product',
  'quote-conversion',
  'days-to-pay',
  'aging-buckets',
  'collected-vs-expected',
  'recurring-expected',
];

@Controller('commerce')
export class RevenueReportingController {
  constructor(@Inject(RevenueReportingService) private readonly reporting: RevenueReportingService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/revenue-reports/:preset')
  async getPreset(
    @Param('businessId') businessId: string,
    @Param('preset') preset: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!VALID_PRESETS.includes(preset as RevenueReportPreset)) {
      throw new Error(`Unknown revenue report preset: ${preset}`);
    }
    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;
    return this.reporting.generate(businessId, preset as RevenueReportPreset, { start, end });
  }
}

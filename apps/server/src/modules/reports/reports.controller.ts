import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/reports/generate')
  async generateReport(
    @Param('businessId') businessId: string,
    @Query('type') type: string = 'executive',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reports.generateReport(businessId, type, startDate, endDate);
  }
}

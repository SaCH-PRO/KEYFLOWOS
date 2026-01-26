import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/summary')
  summary(@Param('businessId') businessId: string) {
    return this.reports.summary(businessId);
  }
}

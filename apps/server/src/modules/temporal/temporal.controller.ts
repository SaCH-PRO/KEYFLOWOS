import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { TemporalOverviewService } from './temporal-overview.service';

@Controller('temporal/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class TemporalController {
  constructor(
    @Inject(TemporalOverviewService) private readonly overview: TemporalOverviewService,
  ) {}

  @Get('overview')
  async overview(@Param('businessId') businessId: string) {
    return this.overview.getOverview(businessId);
  }
}

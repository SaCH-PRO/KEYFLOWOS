import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PeopleOverviewService } from './people-overview.service';

@Controller('people-flow/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class PeopleFlowController {
  constructor(
    @Inject(PeopleOverviewService) private readonly overview: PeopleOverviewService,
  ) {}

  @Get('overview')
  async overview(@Param('businessId') businessId: string) {
    return this.overview.getOverview(businessId);
  }
}

import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PeopleOverviewService } from './people-overview.service';
import { RelationshipHealthService } from './relationship-health.service';

@Controller('people-flow/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class PeopleFlowController {
  constructor(
    @Inject(PeopleOverviewService) private readonly overview: PeopleOverviewService,
    @Inject(RelationshipHealthService) private readonly health: RelationshipHealthService,
  ) {}

  @Get('overview')
  async getOverview(@Param('businessId') businessId: string) {
    return this.overview.getOverview(businessId);
  }

  @Get('contacts/:contactId/health')
  async getContactHealth(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.health.computeHealth(businessId, contactId);
  }

  @Get('segments')
  async getSegments(@Param('businessId') businessId: string) {
    return this.health.listSegments(businessId);
  }
}

import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertContactVisible } from '../crm/crm-permissions.helper';
import { PeopleOverviewService } from './people-overview.service';
import { RelationshipHealthService } from './relationship-health.service';

@Controller('people-flow/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class PeopleFlowController {
  constructor(
    @Inject(PeopleOverviewService) private readonly overview: PeopleOverviewService,
    @Inject(RelationshipHealthService) private readonly health: RelationshipHealthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('overview')
  async getOverview(@Param('businessId') businessId: string) {
    return this.overview.getOverview(businessId);
  }

  // V1-84 (FOLLOW3-D5): a contact-keyed route answers only for a contact the
  // caller may open by the GET crm contacts/:contactId rule (V1-08
  // assertContactVisible): a hidden contact gets the same 404 'Contact not
  // found' as an unknown id, before the service runs.
  @Get('contacts/:contactId/health')
  async getContactHealth(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    return this.health.computeHealth(businessId, contactId);
  }

  @Get('segments')
  async getSegments(@Param('businessId') businessId: string) {
    return this.health.listSegments(businessId);
  }
}

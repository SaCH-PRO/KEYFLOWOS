import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertContactVisible, contactVisibilityFilter, resolveCrmAccess } from '../crm/crm-permissions.helper';
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

  /**
   * V1-84 review (FOLLOW3-D5 ST-5): a segment's `contacts` name contacts (id,
   * name, email, health score), so a member is shown only the ones they may
   * open (V1-08 rule, contactVisibilityFilter); OWNER and SUPER_ADMIN get
   * exactly today's answer. A segment's `count` stays the tenant-wide figure,
   * like the segment counts GET overview already gives every member: it names
   * no contact.
   */
  @Get('segments')
  async getSegments(
    @Param('businessId') businessId: string,
    @Req() req: { user: { id: string } },
  ) {
    const access = await resolveCrmAccess(this.prisma, businessId, req.user.id);
    const segments = await this.health.listSegments(businessId);
    const canOpen = await contactVisibilityFilter(
      this.prisma, businessId, access, req.user.id, segments.flatMap((s) => s.contacts.map((c) => c.id)),
    );
    if (!canOpen) return segments;
    return segments.map((s) => ({ ...s, contacts: s.contacts.filter((c) => canOpen(c.id)) }));
  }
}

import { Controller, Get, Post, Param, Body, Query, Req, UseGuards, Inject, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClientMomentumService } from './client-momentum.service';
import { MomentumAiService } from './momentum-ai.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  assertContactVisible,
  contactVisibilityFilter,
  resolveCrmAccess,
  visibilityClause,
} from '../crm/crm-permissions.helper';
import { contactWhereBase } from '../crm/crm.helpers';

/** The most recommendations GET recommendations answers (its `limit` cap). */
const MAX_RECOMMENDATIONS = 50;

@Controller('momentum/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class MomentumController {
  constructor(
    @Inject(ClientMomentumService) private readonly momentumService: ClientMomentumService,
    @Inject(MomentumAiService) private readonly momentumAi: MomentumAiService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * V1-84 review (FOLLOW3-D5 ST-3): a recommendation is about one contact
   * (its name, email, phone and momentum score ride on it), so a member sees
   * only the recommendations of contacts they may open (V1-08 rule,
   * contactVisibilityFilter). OWNER and SUPER_ADMIN get exactly today's list.
   * A restricted member's list is drawn from the widest pool the route allows
   * (MAX_RECOMMENDATIONS) and cut to `limit` after the filter, so hidden
   * recommendations do not crowd out the ones they may see.
   */
  @Get('recommendations')
  async getDailyRecommendations(
    @Param('businessId') businessId: string,
    @Req() req: { user: { id: string } },
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 5;
    const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_RECOMMENDATIONS) : 5;
    const access = await resolveCrmAccess(this.prisma, businessId, req.user.id);
    if (!visibilityClause(access, req.user.id)) {
      return this.momentumService.getDailyRecommendations(businessId, take);
    }
    const recs = await this.momentumService.getDailyRecommendations(businessId, MAX_RECOMMENDATIONS);
    const canOpen = await contactVisibilityFilter(
      this.prisma, businessId, access, req.user.id, recs.map((r) => r.contactId),
    );
    return (canOpen ? recs.filter((r) => canOpen(r.contactId)) : recs).slice(0, take);
  }

  /**
   * V1-84 review (FOLLOW3-D5 ST-1, ST-3): a recommendation-keyed route acts
   * only on a recommendation whose contact the caller may open (V1-08 rule:
   * the tenant predicate, deletedAt null and visibilityClause). Any other id,
   * hidden or unknown, answers the same 404 'Recommendation not found' before
   * the service runs. OWNER and SUPER_ADMIN are not restricted and reach the
   * service exactly as before.
   */
  private async assertRecommendationVisible(businessId: string, recommendationId: string, actorUserId: string) {
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const visClause = visibilityClause(access, actorUserId);
    if (!visClause) return;
    const visible = await this.prisma.client.momentumRecommendation.findFirst({
      where: {
        id: recommendationId,
        businessId,
        contact: { is: { ...contactWhereBase(businessId), AND: [visClause as Prisma.ContactWhereInput] } },
      },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException('Recommendation not found');
  }

  @Post('recommendations/:id/action')
  async actionRecommendation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
  ) {
    await this.assertRecommendationVisible(businessId, id, req.user.id);
    return this.momentumService.actionRecommendation(businessId, id);
  }

  @Post('recommendations/:id/snooze')
  async snoozeRecommendation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { days?: number },
    @Req() req: { user: { id: string } },
  ) {
    await this.assertRecommendationVisible(businessId, id, req.user.id);
    return this.momentumService.snoozeRecommendation(businessId, id, body.days ?? 7);
  }

  @Post('recommendations/:id/dismiss')
  async dismissRecommendation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
  ) {
    await this.assertRecommendationVisible(businessId, id, req.user.id);
    return this.momentumService.dismissRecommendation(businessId, id);
  }

  /**
   * V1-84 review (FOLLOW3-D5 ST-1): the draft reads body.contactId's name,
   * company, status, industry and last notes into the AI prompt and the reply,
   * and writes the draft onto recommendation :id. Both must be ones the caller
   * may open: the recommendation by assertRecommendationVisible, the contact
   * by assertContactVisible (V1-08). A missing or non-string contactId answers
   * the 404 'Contact not found' of an unknown id (an absent id would otherwise
   * match any contact of the tenant).
   */
  @Post('recommendations/:id/draft')
  async generateDraft(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      contactId: string;
      contactName: string;
      type: string;
      description: string;
      momentumScore?: number;
    },
    @Req() req: { user: { id: string } },
  ) {
    await this.assertRecommendationVisible(businessId, id, req.user.id);
    if (typeof body?.contactId !== 'string' || body.contactId.length === 0) {
      throw new NotFoundException('Contact not found');
    }
    await assertContactVisible(this.prisma, businessId, body.contactId, req.user.id);
    return this.momentumAi.generateDraft(businessId, {
      recommendationId: id,
      contactId: body.contactId,
      contactName: body.contactName,
      type: body.type,
      description: body.description,
      momentumScore: body.momentumScore,
    });
  }

  // V1-84 (FOLLOW3-D5): a contact-keyed route answers only for a contact the
  // caller may open by the GET crm contacts/:contactId rule (V1-08
  // assertContactVisible): a hidden contact gets the same 404 'Contact not
  // found' as an unknown id, before the service runs.
  @Get('contacts/:contactId')
  async getContactMomentum(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    return this.momentumService.getContactMomentum(businessId, contactId);
  }

  @Get('contacts/:contactId/history')
  async getContactMomentumHistory(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
    @Query('days') days?: string,
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    const parsedDays = days ? parseInt(days, 10) : 30;
    return this.momentumService.getContactMomentumHistory(
      businessId,
      contactId,
      Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : 30,
    );
  }

  @Get('summary')
  async getMomentumSummary(
    @Param('businessId') businessId: string,
  ) {
    return this.momentumService.getMomentumSummary(businessId);
  }

  @Post('sweep')
  async runDailySweep(
    @Param('businessId') businessId: string,
  ) {
    return this.momentumService.runDailySweep(businessId);
  }
}

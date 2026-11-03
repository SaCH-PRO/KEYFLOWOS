import { Controller, Get, Post, Param, Body, Query, Req, UseGuards, Inject } from '@nestjs/common';
import { ClientMomentumService } from './client-momentum.service';
import { MomentumAiService } from './momentum-ai.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertContactVisible } from '../crm/crm-permissions.helper';

@Controller('momentum/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class MomentumController {
  constructor(
    @Inject(ClientMomentumService) private readonly momentumService: ClientMomentumService,
    @Inject(MomentumAiService) private readonly momentumAi: MomentumAiService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('recommendations')
  async getDailyRecommendations(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 5;
    return this.momentumService.getDailyRecommendations(
      businessId,
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 5,
    );
  }

  @Post('recommendations/:id/action')
  async actionRecommendation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.momentumService.actionRecommendation(businessId, id);
  }

  @Post('recommendations/:id/snooze')
  async snoozeRecommendation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { days?: number },
  ) {
    return this.momentumService.snoozeRecommendation(businessId, id, body.days ?? 7);
  }

  @Post('recommendations/:id/dismiss')
  async dismissRecommendation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.momentumService.dismissRecommendation(businessId, id);
  }

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
  ) {
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

import { Controller, Get, Post, Param, Body, Query, UseGuards, Inject } from '@nestjs/common';
import { ClientMomentumService } from './client-momentum.service';
import { MomentumAiService } from './momentum-ai.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('momentum/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class MomentumController {
  constructor(
    @Inject(ClientMomentumService) private readonly momentumService: ClientMomentumService,
    @Inject(MomentumAiService) private readonly momentumAi: MomentumAiService,
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

  @Get('contacts/:contactId')
  async getContactMomentum(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.momentumService.getContactMomentum(businessId, contactId);
  }

  @Get('contacts/:contactId/history')
  async getContactMomentumHistory(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('days') days?: string,
  ) {
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

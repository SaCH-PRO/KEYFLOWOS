import { Controller, Get, Post, Patch, Delete, Inject, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MarketingCampaignService } from './marketing-campaign.service';

@Controller('marketing/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class MarketingController {
  constructor(@Inject(MarketingCampaignService) private readonly campaigns: MarketingCampaignService) {}

  @Get('campaigns')
  async listCampaigns(@Param('businessId') businessId: string) {
    return this.campaigns.list(businessId);
  }

  @Post('campaigns')
  async createCampaign(@Param('businessId') businessId: string, @Body() body: { name: string; goal?: string; audience?: string; offer?: string; channel?: string; budget?: number; expectedRevenue?: number; startsAt?: string; endsAt?: string }) {
    return this.campaigns.create(businessId, body);
  }

  @Patch('campaigns/:id')
  async updateCampaign(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: Partial<{ name: string; goal: string; audience: string; offer: string; channel: string; status: string; budget: number; expectedRevenue: number; startsAt: string; endsAt: string }>) {
    return this.campaigns.update(businessId, id, body);
  }

  @Delete('campaigns/:id')
  async deleteCampaign(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.campaigns.delete(businessId, id);
  }
}

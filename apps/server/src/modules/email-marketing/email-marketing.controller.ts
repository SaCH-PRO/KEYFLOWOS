import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EmailMarketingService } from './email-marketing.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller()
export class EmailMarketingController {
  constructor(
    @Inject(EmailMarketingService) private readonly emailMarketing: EmailMarketingService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/campaigns')
  listCampaigns(@Param('businessId') businessId: string) {
    return this.emailMarketing.listCampaigns(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/campaigns/:id')
  getCampaign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.emailMarketing.getCampaign(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/campaigns')
  createCampaign(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      subject: string;
      body: string;
      segmentFilter?: any;
      scheduledAt?: string;
    },
  ) {
    return this.emailMarketing.createCampaign({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/campaigns/:id')
  updateCampaign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      subject?: string;
      body?: string;
      segmentFilter?: any;
      scheduledAt?: string;
    },
  ) {
    return this.emailMarketing.updateCampaign({ businessId, id, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/campaigns/:id')
  deleteCampaign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.emailMarketing.deleteCampaign(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/campaigns/:id/send')
  sendCampaign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.emailMarketing.sendCampaign(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/campaigns/:id/stats')
  getCampaignStats(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.emailMarketing.getCampaignStats(businessId, id);
  }
}

import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
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
  @Post('businesses/:businessId/campaigns/:id/schedule')
  scheduleCampaign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { scheduledAt: string },
  ) {
    return this.emailMarketing.scheduleCampaign(businessId, id, body.scheduledAt);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/campaigns/:id/cancel-schedule')
  cancelSchedule(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.emailMarketing.cancelSchedule(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/campaigns/:id/stats')
  getCampaignStats(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.emailMarketing.getCampaignStats(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('marketing/businesses/:businessId/unsubscribe/:contactId')
  async unsubscribeContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    await this.emailMarketing.unsubscribeContact(businessId, contactId);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/suppression-count')
  getSuppressionCount(@Param('businessId') businessId: string) {
    return this.emailMarketing.getSuppressionCount(businessId);
  }

  @Get('marketing/unsubscribe/:token')
  async handlePublicUnsubscribe(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const result = await this.emailMarketing.handleUnsubscribeToken(token);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
    .card { background: #1e293b; border-radius: 16px; padding: 48px; text-align: center; max-width: 400px; border: 1px solid #334155; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${result.success ? '✅' : '⚠️'}</div>
    <h1>${result.success ? 'Unsubscribed' : 'Error'}</h1>
    <p>${result.message}</p>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}

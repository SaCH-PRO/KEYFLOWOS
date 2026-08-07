import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { LeadFormsService } from './lead-forms.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';
import { HoneypotGuard, Honeypot } from '../../core/guards/honeypot.guard';
import { sanitizeObject } from '../../core/utils/sanitize';

@Controller()
export class LeadFormsController {
  constructor(
    @Inject(LeadFormsService) private readonly leadForms: LeadFormsService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/lead-forms')
  listForms(@Param('businessId') businessId: string) {
    return this.leadForms.listForms(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/lead-forms/:id')
  getForm(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.leadForms.getForm(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/lead-forms')
  createForm(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      description?: string;
      fields: any;
      settings?: any;
    },
  ) {
    return this.leadForms.createForm({ ...body, businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/lead-forms/:id')
  updateForm(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      description?: string;
      fields?: any;
      settings?: any;
    },
  ) {
    return this.leadForms.updateForm({ ...body, businessId, id });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/lead-forms/:id')
  deleteForm(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.leadForms.deleteForm(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/lead-forms/:id/toggle')
  toggleActive(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.leadForms.toggleActive(businessId, id);
  }

  @UseGuards(PublicRateLimitGuard, HoneypotGuard)
  @PublicRateLimit(5, 60_000)
  @Honeypot('_hp', 'website_url', 'company_url')
  @Post('public/lead-forms/:formId/submit')
  submitForm(
    @Param('formId') formId: string,
    @Body() body: { data: Record<string, any>; source?: string; _hp?: string; _t?: number },
    @Req() req: any,
  ) {
    const ipAddress = req.headers['x-forwarded-for'] || req.ip;
    const cleanData = sanitizeObject(body.data ?? {}, 5000);
    const cleanSource = body.source ? String(body.source).slice(0, 200) : undefined;
    return this.leadForms.submitForm(formId, cleanData, cleanSource, ipAddress);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/lead-forms/:formId/submissions')
  listSubmissions(
    @Param('businessId') businessId: string,
    @Param('formId') formId: string,
  ) {
    return this.leadForms.listSubmissions(businessId, formId);
  }
}

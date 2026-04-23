import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller()
export class TemplatesController {
  constructor(
    @Inject(TemplatesService) private readonly templates: TemplatesService,
  ) {}

  @Get('templates')
  listTemplates() {
    return this.templates.listTemplates();
  }

  @Get('templates/:id')
  getTemplate(@Param('id') id: string) {
    return this.templates.getTemplate(id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/templates/:templateId/apply')
  applyTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.templates.applyTemplate(businessId, templateId);
  }
}

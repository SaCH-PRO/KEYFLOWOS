import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { OutputTemplateService, CreateOutputTemplateDto, UpdateOutputTemplateDto } from './output-template.service';
import { OutputCategory } from './ai-quality';

@Controller('api/ai')
export class OutputTemplateController {
  constructor(
    @Inject(OutputTemplateService) private readonly service: OutputTemplateService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/output-templates')
  async list(@Param('businessId') businessId: string) {
    return this.service.listTemplates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/output-templates/options')
  getOptions() {
    return this.service.getValidOptions();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/output-templates/:id')
  async getOne(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.service.getTemplate(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/output-templates')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateOutputTemplateDto,
  ) {
    return this.service.createTemplate(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/output-templates/:id')
  async update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateOutputTemplateDto,
  ) {
    return this.service.updateTemplate(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/output-templates/:id')
  async remove(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteTemplate(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/output-templates/:id/set-default')
  async setDefault(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.service.setDefault(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/output-templates/reset/:category')
  async resetCategory(
    @Param('businessId') businessId: string,
    @Param('category') category: OutputCategory,
  ) {
    return this.service.resetToDefault(businessId, category);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/output-templates/preview')
  async preview(
    @Param('businessId') businessId: string,
    @Body() body: {
      tone: string;
      formality: string;
      targetLength: string;
      requiredSections: string[];
      customInstructions?: string;
      category: OutputCategory;
    },
  ) {
    return this.service.previewTemplate(body);
  }
}

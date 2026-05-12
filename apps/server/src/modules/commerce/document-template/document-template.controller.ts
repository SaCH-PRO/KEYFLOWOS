import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { CrmRateLimit, CrmRateLimitGuard } from '../../crm/guards/rate-limit.guard';
import { DocumentTemplateService } from './document-template.service';
import { CreateDocumentTemplateDto } from './dto/create-document-template.dto';
import { UpdateDocumentTemplateDto } from './dto/update-document-template.dto';

@Controller('commerce/document-templates')
@UseGuards(AuthGuard, CrmRateLimitGuard)
export class DocumentTemplateController {
  constructor(private readonly service: DocumentTemplateService) {}

  @Get('businesses/:businessId')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async list(@Param('businessId') businessId: string, @Query('type') type?: string) {
    return this.service.list(businessId, type);
  }

  @Post('businesses/:businessId')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async create(@Param('businessId') businessId: string, @Body() dto: CreateDocumentTemplateDto) {
    return this.service.create(businessId, dto);
  }

  @Patch('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateDocumentTemplateDto) {
    return this.service.update(businessId, id, dto);
  }

  @Delete('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async delete(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.delete(businessId, id);
  }

  @Post('businesses/:businessId/:id/set-default')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async setDefault(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.setDefault(businessId, id);
  }
}

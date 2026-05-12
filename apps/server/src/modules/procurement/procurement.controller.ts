import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { ProcurementService } from './procurement.service';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';
import { UpdateProcurementRequestDto } from './dto/update-procurement-request.dto';

@Controller('procurement')
@UseGuards(AuthGuard, CrmRateLimitGuard)
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  @Get('businesses/:businessId')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async list(@Param('businessId') businessId: string) {
    return this.service.list(businessId);
  }

  @Post('businesses/:businessId')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async create(@Param('businessId') businessId: string, @Req() req: any, @Body() dto: CreateProcurementRequestDto) {
    return this.service.create(businessId, dto, req.user?.id);
  }

  @Get('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.get(businessId, id);
  }

  @Patch('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateProcurementRequestDto) {
    return this.service.update(businessId, id, dto);
  }

  @Post('businesses/:businessId/:id/submit')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async submit(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.submitForReview(businessId, id);
  }
}

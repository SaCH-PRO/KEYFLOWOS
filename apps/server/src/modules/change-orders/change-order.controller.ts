import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { ChangeOrderService } from './change-order.service';
import { IsNumber, IsOptional, IsString } from 'class-validator';

/*
 * Required for these bodies to survive the global ValidationPipe
 * (whitelist:true strips anything without validator metadata).
 *
 * projectId is the ONLY tenancy anchor this model has — ChangeOrder carries no
 * businessId column. ChangeOrderService.create proves the project belongs to
 * the caller's business before writing.
 */

class CreateChangeOrderDto {
  @IsString()
  projectId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  originalScope?: string;

  @IsOptional()
  @IsString()
  newScope?: string;

  @IsOptional()
  @IsNumber()
  additionalAmount?: number;

  @IsOptional()
  @IsNumber()
  additionalHours?: number;
}

class UpdateChangeOrderDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  originalScope?: string;

  @IsOptional()
  @IsString()
  newScope?: string;

  @IsOptional()
  @IsNumber()
  additionalAmount?: number;

  @IsOptional()
  @IsNumber()
  additionalHours?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  approvedBy?: string;

  @IsOptional()
  @IsString()
  approvedAt?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;
}

@Controller('change-orders')
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
export class ChangeOrderController {
  constructor(
    @Inject(ChangeOrderService) private readonly service: ChangeOrderService,
  ) {}

  @Post('businesses/:businessId')
  @RateLimit(20, 60_000)
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateChangeOrderDto,
  ) {
    // businessId is passed through, not discarded: ChangeOrder has no
    // businessId column, so the service proves ownership via project.businessId.
    return this.service.create(body, businessId);
  }

  @Get('businesses/:businessId')
  @RateLimit(60, 60_000)
  async listByBusiness(@Param('businessId') businessId: string) {
    return this.service.listByBusiness(businessId);
  }

  @Get('businesses/:businessId/projects/:projectId')
  @RateLimit(60, 60_000)
  async listByProject(
    @Param('projectId') projectId: string,
    @Param('businessId') businessId: string,
  ) {
    return this.service.listByProject(projectId, businessId);
  }

  @Get('businesses/:businessId/:id')
  @RateLimit(60, 60_000)
  async findById(
    @Param('id') id: string,
    @Param('businessId') businessId: string,
  ) {
    return this.service.findById(id, businessId);
  }

  @Patch('businesses/:businessId/:id')
  @RateLimit(20, 60_000)
  async update(
    @Param('id') id: string,
    @Param('businessId') businessId: string,
    @Body() body: UpdateChangeOrderDto,
  ) {
    return this.service.update(id, {
      ...body,
      approvedAt: body.approvedAt ? new Date(body.approvedAt) : undefined,
    }, businessId);
  }

  @Delete('businesses/:businessId/:id')
  @RateLimit(20, 60_000)
  async delete(
    @Param('id') id: string,
    @Param('businessId') businessId: string,
  ) {
    return this.service.delete(id, businessId);
  }
}

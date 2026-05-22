import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { ChangeOrderService } from './change-order.service';

class CreateChangeOrderDto {
  projectId!: string;
  title!: string;
  description?: string;
  originalScope?: string;
  newScope?: string;
  additionalAmount?: number;
  additionalHours?: number;
}

class UpdateChangeOrderDto {
  title?: string;
  description?: string;
  originalScope?: string;
  newScope?: string;
  additionalAmount?: number;
  additionalHours?: number;
  status?: string;
  approvedBy?: string;
  approvedAt?: string;
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
    @Param('businessId') _businessId: string,
    @Body() body: CreateChangeOrderDto,
  ) {
    return this.service.create(body);
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

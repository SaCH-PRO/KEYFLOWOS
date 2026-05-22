import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { RetainerService } from './retainer.service';

class CreateRetainerDto {
  contactId!: string;
  name!: string;
  monthlyAmount!: number;
  startDate!: string;
  endDate?: string;
  includedHours?: number;
  rolloverHours?: boolean;
  rolloverCap?: number;
}

class UpdateRetainerDto {
  name?: string;
  monthlyAmount?: number;
  startDate?: string;
  endDate?: string | null;
  includedHours?: number | null;
  rolloverHours?: boolean;
  rolloverCap?: number | null;
  status?: string;
}

class CreatePeriodDto {
  periodStart!: string;
  periodEnd!: string;
  hoursUsed?: number;
  amountBilled?: number;
}

class UpdatePeriodDto {
  hoursUsed?: number;
  status?: string;
  invoiceId?: string;
}

@Controller('retainers')
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
export class RetainerController {
  constructor(
    @Inject(RetainerService) private readonly service: RetainerService,
  ) {}

  @Post('businesses/:businessId')
  @RateLimit(20, 60_000)
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateRetainerDto,
  ) {
    return this.service.create({
      businessId,
      contactId: body.contactId,
      name: body.name,
      monthlyAmount: body.monthlyAmount,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      includedHours: body.includedHours,
      rolloverHours: body.rolloverHours,
      rolloverCap: body.rolloverCap,
    });
  }

  @Get('businesses/:businessId')
  @RateLimit(60, 60_000)
  async list(@Param('businessId') businessId: string) {
    return this.service.list(businessId);
  }

  @Get('businesses/:businessId/summary')
  @RateLimit(60, 60_000)
  async summary(@Param('businessId') businessId: string) {
    return this.service.getSummary(businessId);
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
    @Body() body: UpdateRetainerDto,
  ) {
    return this.service.update(id, businessId, {
      ...body,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate !== undefined ? (body.endDate ? new Date(body.endDate) : null) : undefined,
    });
  }

  @Delete('businesses/:businessId/:id')
  @RateLimit(20, 60_000)
  async delete(
    @Param('id') id: string,
    @Param('businessId') businessId: string,
  ) {
    return this.service.delete(id, businessId);
  }

  @Post('businesses/:businessId/:id/periods')
  @RateLimit(20, 60_000)
  async createPeriod(
    @Param('id') retainerId: string,
    @Param('businessId') businessId: string,
    @Body() body: CreatePeriodDto,
  ) {
    return this.service.createPeriod(retainerId, businessId, {
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      hoursUsed: body.hoursUsed,
      amountBilled: body.amountBilled,
    });
  }

  @Patch('businesses/:businessId/:retainerId/periods/:periodId')
  @RateLimit(20, 60_000)
  async updatePeriod(
    @Param('periodId') periodId: string,
    @Param('retainerId') retainerId: string,
    @Param('businessId') businessId: string,
    @Body() body: UpdatePeriodDto,
  ) {
    return this.service.updatePeriod(periodId, retainerId, businessId, body);
  }
}

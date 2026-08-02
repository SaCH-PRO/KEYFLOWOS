import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { RetainerService } from './retainer.service';
import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

/*
 * Required for these bodies to survive the global ValidationPipe, which runs
 * with whitelist:true and deletes any property lacking validator metadata.
 *
 * contactId and invoiceId are foreign keys. RetainerService proves they belong
 * to the caller's business before writing — shape validation here does not
 * establish ownership. RetainerAgreement.contactId is a bare String with no
 * Prisma relation, so there is not even database-level FK enforcement to fall
 * back on.
 */

class CreateRetainerDto {
  @IsString()
  contactId!: string;

  @IsString()
  name!: string;

  @IsNumber()
  monthlyAmount!: number;

  @IsISO8601()
  startDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  includedHours?: number;

  @IsOptional()
  @IsBoolean()
  rolloverHours?: boolean;

  @IsOptional()
  @IsNumber()
  rolloverCap?: number;
}

class UpdateRetainerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  monthlyAmount?: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @IsOptional()
  @IsNumber()
  includedHours?: number | null;

  @IsOptional()
  @IsBoolean()
  rolloverHours?: boolean;

  @IsOptional()
  @IsNumber()
  rolloverCap?: number | null;

  @IsOptional()
  @IsString()
  status?: string;
}

class CreatePeriodDto {
  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  @IsOptional()
  @IsNumber()
  hoursUsed?: number;

  @IsOptional()
  @IsNumber()
  amountBilled?: number;
}

class UpdatePeriodDto {
  @IsOptional()
  @IsNumber()
  hoursUsed?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
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

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { TimeEntryService } from './time-entry.service';
import { PrismaService } from '../../core/prisma/prisma.service';

class StartTimerDto {
  description?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  hourlyRate?: number;
}

class CreateTimeEntryDto {
  description?: string;
  startTime!: string;
  endTime?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  hourlyRate?: number;
}

class UpdateTimeEntryDto {
  description?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  hourlyRate?: number;
}

class BillTimeEntriesDto {
  timeEntryIds!: string[];
  invoiceId!: string;
}

@Controller('time-entries')
@UseGuards(AuthGuard)
export class TimeEntryController {
  constructor(
    @Inject(TimeEntryService) private readonly service: TimeEntryService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('businesses/:businessId/start')
  @UseGuards(BusinessGuard)
  async startTimer(
    @Param('businessId') businessId: string,
    @Body() body: StartTimerDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.startTimer({
      businessId,
      userId: user.id,
      description: body.description,
      projectId: body.projectId,
      taskId: body.taskId,
      billable: body.billable,
      hourlyRate: body.hourlyRate,
    });
  }

  @Post('businesses/:businessId/stop/:id')
  @UseGuards(BusinessGuard)
  async stopTimer(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.stopTimer(id, businessId, user.id);
  }

  @Get('businesses/:businessId/running')
  @UseGuards(BusinessGuard)
  async getRunningTimer(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.getRunningTimer(businessId, user.id);
  }

  @Post('businesses/:businessId')
  @UseGuards(BusinessGuard)
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateTimeEntryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create({
      businessId,
      userId: user.id,
      description: body.description,
      startTime: new Date(body.startTime),
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      projectId: body.projectId,
      taskId: body.taskId,
      billable: body.billable,
      hourlyRate: body.hourlyRate,
    });
  }

  @Get('businesses/:businessId')
  @UseGuards(BusinessGuard)
  async list(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { id: string },
    @Query('projectId') projectId?: string,
    @Query('taskId') taskId?: string,
    @Query('billable') billable?: string,
    @Query('billed') billed?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.list({
      businessId,
      userId: user.id,
      projectId,
      taskId,
      billable: billable !== undefined ? billable === 'true' : undefined,
      billed: billed !== undefined ? billed === 'true' : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate + 'T23:59:59.999Z') : undefined,
    });
  }

  @Get('businesses/:businessId/summary')
  @UseGuards(BusinessGuard)
  async getSummary(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { id: string },
    @Query('projectId') projectId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getSummary({
      businessId,
      userId: user.id,
      projectId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate + 'T23:59:59.999Z') : undefined,
    });
  }

  @Get('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  async findById(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.service.findById(id, businessId);
  }

  @Patch('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  async update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateTimeEntryDto,
  ) {
    return this.service.update(id, businessId, {
      description: body.description,
      startTime: body.startTime ? new Date(body.startTime) : undefined,
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      durationMinutes: body.durationMinutes,
      projectId: body.projectId,
      taskId: body.taskId,
      billable: body.billable,
      hourlyRate: body.hourlyRate,
    });
  }

  @Delete('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  async delete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(id, businessId);
  }

  @Post('businesses/:businessId/bill')
  @UseGuards(BusinessGuard)
  async billTimeEntries(
    @Param('businessId') businessId: string,
    @Body() body: BillTimeEntriesDto,
  ) {
    const count = await this.service.markAsBilled(
      body.timeEntryIds,
      businessId,
      body.invoiceId,
    );
    return { billed: count.count };
  }

  @Get('businesses/:businessId/projects/:projectId/total-time')
  @UseGuards(BusinessGuard)
  async getProjectTotalTime(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    const summary = await this.service.getSummary({
      businessId,
      projectId,
    });
    return summary;
  }
}

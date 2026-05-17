import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import {
  ModuleScopeGuard,
  RequireModuleScope,
} from '../../core/auth/module-scope.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { CallLogService } from './call-log.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { UpdateCallLogDto } from './dto/update-call-log.dto';
import { CompleteCallDto } from './dto/complete-call.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListCallsQueryDto } from './dto/list-calls-query.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard, ModuleScopeGuard)
export class CallTaskController {
  constructor(private readonly callLogs: CallLogService) {}

  @Post('businesses/:businessId/calls')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateCallLogDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.callLogs.createCallLog({
      ...body,
      businessId,
      callerId: body.callerId ?? req.user?.id ?? 'system',
    });
  }

  @Get('businesses/:businessId/calls')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListCallsQueryDto,
  ) {
    return this.callLogs.listCalls(businessId, {
      callerId: query.callerId,
      contactId: query.contactId,
      status: query.status,
      fromDate: query.fromDate,
      toDate: query.toDate,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('businesses/:businessId/calls/:callId')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async getById(@Param('callId') callId: string) {
    return this.callLogs.getCallLog(callId);
  }

  @Patch('businesses/:businessId/calls/:callId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async update(
    @Param('callId') callId: string,
    @Body() body: UpdateCallLogDto,
  ) {
    return this.callLogs.updateCallLog(callId, body);
  }

  @Post('businesses/:businessId/calls/:callId/complete')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async complete(
    @Param('callId') callId: string,
    @Body() body: CompleteCallDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.callLogs.completeCall(
      callId,
      body,
      req.user?.id ?? 'system',
    );
  }

  @Post('businesses/:businessId/calls/:callId/follow-up')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async createFollowUp(
    @Param('callId') callId: string,
    @Body() body: CreateFollowUpDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.callLogs.createFollowUpTask(
      callId,
      body,
      req.user?.id ?? 'system',
    );
  }

  @Delete('businesses/:businessId/calls/:callId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async delete(@Param('callId') callId: string) {
    return this.callLogs.deleteCallLog(callId);
  }

  @Get('businesses/:businessId/calls/scheduled/today')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async getScheduledToday(
    @Param('businessId') businessId: string,
    @Query('callerId') callerId: string,
  ) {
    return this.callLogs.getScheduledCalls(businessId, callerId, new Date());
  }

  @Post('businesses/:businessId/contacts/:contactId/calls/from-next-action')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async createFromNextAction(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { callerId?: string; script?: string },
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.callLogs.createFromContactNextAction(
      contactId,
      body.callerId ?? req.user?.id ?? 'system',
      body.script,
    );
  }
}

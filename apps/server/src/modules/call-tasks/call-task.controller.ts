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
  BadRequestException,
  UnauthorizedException,
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
import { CallScriptService } from './call-script.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { UpdateCallLogDto } from './dto/update-call-log.dto';
import { CompleteCallDto } from './dto/complete-call.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListCallsQueryDto } from './dto/list-calls-query.dto';

/**
 * The session member: the caller of a call log this controller writes and the
 * actor of every call-log mutation (V1-54). A call log used to take
 * `body.callerId ?? req.user.id ?? 'system'`, so any member could log a call as
 * another member, and complete/follow-up named 'system' when no user was
 * attached. The guards already refuse a request without a user; this keeps
 * such a request from being recorded as someone else or as SYSTEM if they ever
 * do not. CallLog is under the tenant extension and the guards bind the
 * business, so this is attribution, not tenant isolation.
 */
function sessionCallerId(req: { user?: { id?: string } } | undefined): string {
  const callerId = req?.user?.id;
  if (!callerId) {
    throw new UnauthorizedException('Authentication required');
  }
  return callerId;
}

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard, ModuleScopeGuard)
export class CallTaskController {
  constructor(
    private readonly callLogs: CallLogService,
    private readonly callScripts: CallScriptService,
  ) {}

  @Post('businesses/:businessId/calls')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateCallLogDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    // The caller is the session member; a body callerId is ignored.
    // CreateCallLogDto still declares it, and the DTO is outside V1-54's write set.
    const callerId = sessionCallerId(req);
    return this.callLogs.createCallLog({
      ...body,
      businessId,
      callerId,
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
  async getById(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
  ) {
    return this.callLogs.getCallLog(businessId, callId);
  }

  @Patch('businesses/:businessId/calls/:callId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async update(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Body() body: UpdateCallLogDto,
  ) {
    return this.callLogs.updateCallLog(businessId, callId, body);
  }

  @Post('businesses/:businessId/calls/:callId/complete')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async complete(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Body() body: CompleteCallDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    const completedBy = sessionCallerId(req);
    return this.callLogs.completeCall(businessId, callId, body, completedBy);
  }

  @Post('businesses/:businessId/calls/:callId/follow-up')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async createFollowUp(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Body() body: CreateFollowUpDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    const createdBy = sessionCallerId(req);
    return this.callLogs.createFollowUpTask(businessId, callId, body, createdBy);
  }

  @Delete('businesses/:businessId/calls/:callId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async delete(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
  ) {
    return this.callLogs.deleteCallLog(businessId, callId);
  }

  @Get('businesses/:businessId/calls/scheduled/today')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async getScheduledToday(
    @Param('businessId') businessId: string,
    @Query('callerId') callerId: string | undefined,
  ) {
    // callerId is an optional read filter, as on GET calls. Without one this is
    // every member's open calls today in the business: the Operations dashboard
    // ("Calls Today") and the call-tasks page ("Scheduled Today") send none and
    // show the team's calls. Narrowing it to the session member would change what
    // they show, which is outside V1-54's write-attribution scope (review CR-1).
    return this.callLogs.getScheduledCalls(businessId, callerId || undefined, new Date());
  }

  @Post('businesses/:businessId/calls/:callId/generate-script')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async generateScript(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    const callLog = await this.callLogs.getCallLog(businessId, callId);
    if (!callLog.contactId) {
      throw new BadRequestException('Call log has no contact');
    }
    return this.callScripts.generateScript(
      businessId,
      callId,
      callLog.contactId,
    );
  }

  @Post('businesses/:businessId/contacts/:contactId/calls/from-next-action')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async createFromNextAction(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { callerId?: string; script?: string; autoGenerateScript?: boolean },
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    // The caller is the session member; a body callerId is ignored. The contact
    // is looked up within the path business (review ST-3).
    const callerId = sessionCallerId(req);
    const callLog = await this.callLogs.createFromContactNextAction(
      businessId,
      contactId,
      callerId,
      body.script,
    );

    if (body.autoGenerateScript && callLog.contactId) {
      try {
        await this.callScripts.generateScript(
          businessId,
          callLog.id,
          callLog.contactId,
        );
        const updated = await this.callLogs.getCallLog(businessId, callLog.id);
        return updated;
      } catch {
        // Auto-generation failed, return the call log without script
      }
    }

    return callLog;
  }
}

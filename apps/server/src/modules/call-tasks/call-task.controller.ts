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
import { CallLogService, type CallLogViewer } from './call-log.service';
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

/**
 * The session member as the viewer of a call log (V1-84): every route here applies the CRM
 * record visibility of GET contacts/:contactId (V1-08) through the call log's contact, so a
 * member reads, lists, writes and scripts only the call logs on contacts they may open, and
 * creates call logs only on such contacts. The guards check the business and the crm module
 * level, not the record; a request without a member is 401 here as for sessionCallerId.
 */
function sessionViewer(req: { user?: { id?: string; role?: string } } | undefined): CallLogViewer {
  return { userId: sessionCallerId(req), role: req?.user?.role ?? null };
}

type SessionRequest = ExpressRequest & { user?: { id: string; role?: string } };

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
    @Request() req: SessionRequest,
  ) {
    // The caller is the session member; a body callerId is ignored.
    // CreateCallLogDto still declares it, and the DTO is outside V1-54's write set.
    // The service checks the session member as the caller (V1-84 review ST-1, CR-1): a
    // SUPER_ADMIN who is not a member is refused 403, a contact they may not open 404.
    const viewer = sessionViewer(req);
    const callerId = viewer.userId;
    return this.callLogs.createCallLog(
      {
        ...body,
        businessId,
        callerId,
      },
      viewer,
    );
  }

  @Get('businesses/:businessId/calls')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListCallsQueryDto,
    @Request() req: SessionRequest,
  ) {
    const viewer = sessionViewer(req);
    return this.callLogs.listCalls(businessId, {
      callerId: query.callerId,
      contactId: query.contactId,
      status: query.status,
      fromDate: query.fromDate,
      toDate: query.toDate,
      limit: query.limit,
      offset: query.offset,
      viewer,
    });
  }

  @Get('businesses/:businessId/calls/:callId')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async getById(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Request() req: SessionRequest,
  ) {
    return this.callLogs.getVisibleCallLog(businessId, callId, sessionViewer(req));
  }

  @Patch('businesses/:businessId/calls/:callId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async update(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Body() body: UpdateCallLogDto,
    @Request() req: SessionRequest,
  ) {
    // The call log as it is, and the contact a PATCH moves it to, must both be ones the member may open.
    const viewer = sessionViewer(req);
    await this.callLogs.getVisibleCallLog(businessId, callId, viewer);
    await this.callLogs.assertContactVisibleTo(businessId, body.contactId, viewer);
    return this.callLogs.updateCallLog(businessId, callId, body);
  }

  @Post('businesses/:businessId/calls/:callId/complete')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async complete(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Body() body: CompleteCallDto,
    @Request() req: SessionRequest,
  ) {
    const viewer = sessionViewer(req);
    const completedBy = viewer.userId;
    await this.callLogs.getVisibleCallLog(businessId, callId, viewer);
    return this.callLogs.completeCall(businessId, callId, body, completedBy);
  }

  @Post('businesses/:businessId/calls/:callId/follow-up')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async createFollowUp(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Body() body: CreateFollowUpDto,
    @Request() req: SessionRequest,
  ) {
    const viewer = sessionViewer(req);
    const createdBy = viewer.userId;
    await this.callLogs.getVisibleCallLog(businessId, callId, viewer);
    return this.callLogs.createFollowUpTask(businessId, callId, body, createdBy);
  }

  @Delete('businesses/:businessId/calls/:callId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async delete(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Request() req: SessionRequest,
  ) {
    await this.callLogs.getVisibleCallLog(businessId, callId, sessionViewer(req));
    return this.callLogs.deleteCallLog(businessId, callId);
  }

  @Get('businesses/:businessId/calls/scheduled/today')
  @RateLimit(60, 60_000)
  @RequireModuleScope('crm', 'read')
  async getScheduledToday(
    @Param('businessId') businessId: string,
    @Query('callerId') callerId: string | undefined,
    @Request() req: SessionRequest,
  ) {
    // callerId is an optional read filter, as on GET calls. Without one this is
    // every member's open calls today in the business: the Operations dashboard
    // ("Calls Today") and the call-tasks page ("Scheduled Today") send none and
    // show the team's calls. Narrowing it to the session member would change what
    // they show, which is outside V1-54's write-attribution scope (review CR-1). Either way the
    // day holds only the calls whose contact the session member may open (V1-84).
    const viewer = sessionViewer(req);
    return this.callLogs.getScheduledCalls(businessId, callerId || undefined, new Date(), viewer);
  }

  @Post('businesses/:businessId/calls/:callId/generate-script')
  @RateLimit(20, 60_000)
  @RequireModuleScope('crm', 'write')
  async generateScript(
    @Param('businessId') businessId: string,
    @Param('callId') callId: string,
    @Request() req: SessionRequest,
  ) {
    const callLog = await this.callLogs.getVisibleCallLog(businessId, callId, sessionViewer(req));
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
    @Request() req: SessionRequest,
  ) {
    // The caller is the session member; a body callerId is ignored. The contact
    // is looked up within the path business (review ST-3), and the service checks
    // the session member as its caller as on POST calls: a member of the business
    // who may open the contact (V1-84, review ST-1).
    const viewer = sessionViewer(req);
    const callerId = viewer.userId;
    const callLog = await this.callLogs.createFromContactNextAction(
      businessId,
      contactId,
      callerId,
      body.script,
      viewer,
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

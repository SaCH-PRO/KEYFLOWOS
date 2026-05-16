import {
  Controller,
  Post,
  Get,
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
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { ApprovalRequestService } from './approval-request.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { DecideApprovalStepDto } from './dto/decide-approval-step.dto';
import { DelegateApprovalStepDto } from './dto/delegate-approval-step.dto';
import { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
export class ApprovalController {
  constructor(private readonly approvals: ApprovalRequestService) {}

  @Post('businesses/:businessId/approvals')
  @RateLimit(20, 60_000)
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateApprovalRequestDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.createRequest({
      businessId,
      requesterId: req.user?.id ?? 'system',
      requestType: body.requestType,
      title: body.title,
      description: body.description,
      payload: body.payload,
      threshold: body.threshold,
      steps: body.steps,
    });
  }

  @Get('businesses/:businessId/approvals')
  @RateLimit(60, 60_000)
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListApprovalsQueryDto,
  ) {
    return this.approvals.listForBusiness(businessId, {
      status: query.status,
      requestType: query.requestType,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  }

  @Get('businesses/:businessId/approvals/:approvalId')
  @RateLimit(60, 60_000)
  async getById(@Param('approvalId') approvalId: string) {
    return this.approvals.getById(approvalId);
  }

  @Post('businesses/:businessId/approvals/:approvalId/approve')
  @RateLimit(20, 60_000)
  async approve(
    @Param('approvalId') approvalId: string,
    @Body() body: DecideApprovalStepDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.decideStep({
      approvalRequestId: approvalId,
      approverId: req.user?.id ?? 'system',
      decision: 'approve',
      comment: body.comment,
    });
  }

  @Post('businesses/:businessId/approvals/:approvalId/reject')
  @RateLimit(20, 60_000)
  async reject(
    @Param('approvalId') approvalId: string,
    @Body() body: DecideApprovalStepDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.decideStep({
      approvalRequestId: approvalId,
      approverId: req.user?.id ?? 'system',
      decision: 'reject',
      comment: body.comment,
    });
  }

  @Post('businesses/:businessId/approvals/:approvalId/delegate')
  @RateLimit(20, 60_000)
  async delegate(
    @Param('approvalId') approvalId: string,
    @Body() body: DelegateApprovalStepDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.delegateStep({
      approvalRequestId: approvalId,
      approverId: req.user?.id ?? 'system',
      delegatedTo: body.delegatedTo,
      comment: body.comment,
    });
  }

  @Delete('businesses/:businessId/approvals/:approvalId')
  @RateLimit(20, 60_000)
  async cancel(
    @Param('approvalId') approvalId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.cancelRequest(approvalId, req.user?.id ?? 'system');
  }

  @Get('businesses/:businessId/approvals/pending-for-me')
  @RateLimit(60, 60_000)
  async pendingForMe(
    @Param('businessId') businessId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.getPendingForUser(businessId, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/approvals/:approvalId/escalate')
  @RateLimit(10, 60_000)
  async escalate(
    @Param('approvalId') approvalId: string,
    @Body() body: { reason?: string },
  ) {
    return this.approvals.escalateRequest(approvalId, body.reason);
  }
}

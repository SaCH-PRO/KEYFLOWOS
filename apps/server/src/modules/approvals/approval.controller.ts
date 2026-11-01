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
  NotFoundException,
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

  /**
   * The requests whose current step waits on the caller, in the path business
   * only (getPendingForUser filters on businessId and the caller's id).
   *
   * Declared BEFORE `approvals/:approvalId` (R0-13f): Express answers with the
   * first matching route, and below it this route was answered by getById as
   * approval 'pending-for-me' (404), so the approvals and operations screens
   * always showed an empty "waiting on me" list. route-shadowing.spec.ts keeps
   * the order.
   */
  @Get('businesses/:businessId/approvals/pending-for-me')
  @RateLimit(60, 60_000)
  async pendingForMe(
    @Param('businessId') businessId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.approvals.getPendingForUser(businessId, req.user?.id ?? 'system');
  }

  /**
   * The request `approvalId` when it belongs to the path business, else the
   * not-found an unknown id gets (R0-13f review). ApprovalRequestService's
   * per-request methods look a request up by id alone, and BusinessGuard proves
   * only that the caller belongs to the path business, so without this a
   * member of any business could read, decide, delegate, cancel or escalate
   * another tenant's request through their own business's path. Every
   * per-request handler below calls it first; the request's businessId never
   * changes, so the check holds for the call that follows.
   */
  private async requestInBusiness(businessId: string, approvalId: string) {
    const request = await this.approvals.getById(approvalId);
    if (request.businessId !== businessId) throw new NotFoundException('Approval request not found');
    return request;
  }

  @Get('businesses/:businessId/approvals/:approvalId')
  @RateLimit(60, 60_000)
  async getById(
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
  ) {
    return this.requestInBusiness(businessId, approvalId);
  }

  @Post('businesses/:businessId/approvals/:approvalId/approve')
  @RateLimit(20, 60_000)
  async approve(
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: DecideApprovalStepDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    await this.requestInBusiness(businessId, approvalId);
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
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: DecideApprovalStepDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    await this.requestInBusiness(businessId, approvalId);
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
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: DelegateApprovalStepDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    await this.requestInBusiness(businessId, approvalId);
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
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    await this.requestInBusiness(businessId, approvalId);
    return this.approvals.cancelRequest(approvalId, req.user?.id ?? 'system');
  }

  @Post('businesses/:businessId/approvals/:approvalId/escalate')
  @RateLimit(10, 60_000)
  async escalate(
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: { reason?: string },
  ) {
    await this.requestInBusiness(businessId, approvalId);
    return this.approvals.escalateRequest(approvalId, body.reason);
  }
}

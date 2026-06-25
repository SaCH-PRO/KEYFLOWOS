import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { ApprovalQueue } from './services/approval-queue.service';

interface AuthenticatedRequest {
  user?: { id?: string };
}

@Controller('key-autonomy/businesses/:businessId/approvals')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class ApprovalQueueController {
  constructor(private readonly approvalQueue: ApprovalQueue) {}

  private getUserId(req: AuthenticatedRequest): string {
    return req.user?.id ?? 'system';
  }

  /**
   * GET /api/v1/key-autonomy/businesses/:businessId/approvals
   * List pending approval tickets with optional filtering.
   */
  @Get()
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const validStatus =
      status === 'pending' ||
      status === 'approved' ||
      status === 'rejected' ||
      status === 'expired'
        ? status
        : 'pending';

    const validRiskLevel =
      riskLevel === 'low' ||
      riskLevel === 'medium' ||
      riskLevel === 'high' ||
      riskLevel === 'critical'
        ? riskLevel
        : undefined;

    return this.approvalQueue.getPending({
      businessId,
      status: validStatus,
      riskLevel: validRiskLevel,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * GET /api/v1/key-autonomy/businesses/:businessId/approvals/stats
   * Get approval statistics for the business.
   */
  @Get('stats')
  async stats(@Param('businessId') businessId: string) {
    return this.approvalQueue.getStats(businessId);
  }

  /**
   * GET /api/v1/key-autonomy/businesses/:businessId/approvals/:id
   * Get a single approval ticket by ID.
   */
  @Get(':id')
  async getById(
    @Param('businessId') _businessId: string,
    @Param('id') id: string,
  ) {
    const ticket = await this.approvalQueue.getTicket(id);
    if (!ticket) {
      throw new NotFoundException(`Approval ticket ${id} not found`);
    }
    return ticket;
  }

  /**
   * POST /api/v1/key-autonomy/businesses/:businessId/approvals/:id/approve
   * Approve an action — triggers execution via ActionDispatcher.
   */
  @Post(':id/approve')
  async approve(
    @Param('businessId') _businessId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.approvalQueue.approve(id, this.getUserId(req));
    return { success: true, message: 'Action approved and executed' };
  }

  /**
   * POST /api/v1/key-autonomy/businesses/:businessId/approvals/:id/reject
   * Reject an action with optional reason.
   */
  @Post(':id/reject')
  async reject(
    @Param('businessId') _businessId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.approvalQueue.reject(id, this.getUserId(req), body?.reason);
    return { success: true, message: 'Action rejected' };
  }
}

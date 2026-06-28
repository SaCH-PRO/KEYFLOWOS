import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { KeyActionProposalService } from './key-action-proposal.service';
import {
  KeyCortexApprovalOrchestratorService,
} from '../key-cortex/key-cortex-approval-orchestrator.service';
import { CreateKeyActionProposalDto } from './dto/create-key-action-proposal.dto';
import { RejectKeyActionProposalDto } from './dto/reject-key-action-proposal.dto';
import { ExecuteKeyActionProposalDto } from './dto/execute-key-action-proposal.dto';

@Controller('key-autonomy/businesses/:businessId/actions')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class KeyActionProposalController {
  constructor(
    @Inject(KeyActionProposalService) private readonly proposals: KeyActionProposalService,
    @Inject(KeyCortexApprovalOrchestratorService) private readonly orchestrator: KeyCortexApprovalOrchestratorService,
  ) {}

  private userId(req: { user?: { id?: string } }): string | undefined {
    return req.user?.id;
  }

  @Get('proposals')
  list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
    @Query('actionType') actionType?: string,
  ) {
    return this.proposals.list(businessId, { status, sourceType, actionType });
  }

  @Post('proposals')
  create(
    @Param('businessId') businessId: string,
    @Body() body: CreateKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.orchestrator.propose({
      businessId,
      userId: this.userId(req),
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      sourceMode: body.sourceMode,
      actionType: body.actionType,
      title: body.title,
      summary: body.summary,
      rationale: body.rationale,
      evidence: body.evidence,
      parameters: body.payload,
    });
  }

  @Get('proposals/:proposalId')
  get(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.proposals.get(businessId, proposalId);
  }

  @Post('proposals/:proposalId/approve')
  approve(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const userId = this.userId(req);
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required to approve proposals');
    }
    return this.orchestrator.approve({ businessId, proposalId, userId });
  }

  @Post('proposals/:proposalId/reject')
  reject(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: RejectKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    const userId = this.userId(req);
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required to reject proposals');
    }
    return this.orchestrator.reject({ businessId, proposalId, userId, reason: body.reason });
  }

  @Post('proposals/:proposalId/cancel')
  cancel(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.proposals.cancel(businessId, proposalId);
  }

  @Post('proposals/:proposalId/execute')
  execute(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Body() _body: ExecuteKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.orchestrator.executeApproved({
      businessId,
      proposalId,
      userId: this.userId(req),
    });
  }
}

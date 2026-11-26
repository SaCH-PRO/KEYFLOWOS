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
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
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

  /** D-238: the request's reader ({ id, role } as AuthMiddleware attaches it), or null. */
  private reader(req?: { user?: { id?: string; role?: string } }) {
    return req?.user?.id ? { id: req.user.id, role: req.user.role } : null;
  }

  @Get('proposals')
  list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
    @Query('actionType') actionType?: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    return this.proposals.listForReader(businessId, { status, sourceType, actionType }, this.reader(req));
  }

  @Post('proposals')
  @RequireModuleScope('operations', 'write')
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
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    return this.proposals.getForReader(businessId, proposalId, this.reader(req));
  }

  @Post('proposals/:proposalId/approve')
  @RequireModuleScope('operations', 'write')
  async approve(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const userId = this.userId(req);
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required to approve proposals');
    }
    // D-238 (round 3): the action keeps its own authority; only its answer is redacted for the reader.
    return this.proposals.viewForReader(businessId, await this.orchestrator.approve({ businessId, proposalId, userId }), this.reader(req));
  }

  @Post('proposals/:proposalId/reject')
  @RequireModuleScope('operations', 'write')
  async reject(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: RejectKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    const userId = this.userId(req);
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required to reject proposals');
    }
    return this.proposals.viewForReader(businessId, await this.orchestrator.reject({ businessId, proposalId, userId, reason: body.reason }), this.reader(req));
  }

  @Post('proposals/:proposalId/cancel')
  @RequireModuleScope('operations', 'write')
  async cancel(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    return this.proposals.viewForReader(businessId, await this.proposals.cancel(businessId, proposalId), this.reader(req));
  }

  @Post('proposals/:proposalId/execute')
  @RequireModuleScope('operations', 'write')
  async execute(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Body() _body: ExecuteKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    const executed = await this.orchestrator.executeApproved({
      businessId,
      proposalId,
      userId: this.userId(req),
    });
    return this.proposals.viewForReader(businessId, executed, this.reader(req));
  }
}

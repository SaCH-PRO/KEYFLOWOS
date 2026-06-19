import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { KeyActionProposalService } from './key-action-proposal.service';
import { CreateKeyActionProposalDto } from './dto/create-key-action-proposal.dto';
import { RejectKeyActionProposalDto } from './dto/reject-key-action-proposal.dto';
import { ExecuteKeyActionProposalDto } from './dto/execute-key-action-proposal.dto';

@Controller('key-autonomy/businesses/:businessId/actions')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class KeyActionProposalController {
  constructor(
    @Inject(KeyActionProposalService) private readonly proposals: KeyActionProposalService,
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
    return this.proposals.create(businessId, body, this.userId(req));
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
    return this.proposals.approve(businessId, proposalId, this.userId(req));
  }

  @Post('proposals/:proposalId/reject')
  reject(
    @Param('businessId') businessId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: RejectKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.proposals.reject(businessId, proposalId, this.userId(req), body.reason);
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
    @Body() body: ExecuteKeyActionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.proposals.execute(businessId, proposalId, this.userId(req), body.confirm);
  }
}

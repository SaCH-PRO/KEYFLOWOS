import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { genomeReaderReadsRevenue } from './key-genome/genome-finance-scope';
import {
  isFinancialGenomeEvolution,
  requireRevenueLevel,
  type GenomeEvolutionFields,
} from '../key-autonomy/key-action-genome-projection';

import { GenomeEvolutionService } from './genome-evolution.service';
import { CreateGenomeEvolutionProposalDto } from './dto/create-genome-evolution-proposal.dto';
import { UpdateGenomeEvolutionProposalDto } from './dto/update-genome-evolution-proposal.dto';

/** The request fields these handlers read (attached by AuthMiddleware; AuthGuard has passed). */
type EvolutionRequest = { user?: { id?: string; role?: string } };

/**
 * FU-GENOME-EVOLUTION-SURFACES (D-128, D-233, D-238): a reader without revenue read (ModuleScopeGuard's reading:
 * SUPER_ADMIN passes; no membership reads none) is served only the non-financial proposals (isFinancialGenomeEvolution),
 * and is answered approve without the genome integrity result (its DNA scores include finance and sales). Approving,
 * rejecting or editing a financial proposal, or an edit that would make one financial, needs revenue write.
 */
@Controller('business-genome/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class GenomeEvolutionController {
  constructor(
    @Inject(GenomeEvolutionService) private readonly service: GenomeEvolutionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private userId(req: { user?: { id?: string } }): string | undefined {
    return req.user?.id;
  }

  private reader(req?: EvolutionRequest) {
    return req?.user?.id ? { id: req.user.id, role: req.user.role } : null;
  }

  /** D-128: acting on a financial proposal (or making one) needs revenue write. */
  private async requireActingAuthority(businessId: string, req: EvolutionRequest | undefined, ...rows: GenomeEvolutionFields[]): Promise<void> {
    if (rows.some((row) => isFinancialGenomeEvolution(row))) {
      await requireRevenueLevel(this.prisma, businessId, this.reader(req) ?? undefined, 'write');
    }
  }

  @Get('evolution-proposals')
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('section') section?: string,
    @Req() req?: EvolutionRequest,
  ) {
    return this.service.listForReader(businessId, { status, section }, this.reader(req));
  }

  @Post('evolution-proposals')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateGenomeEvolutionProposalDto,
    @Req() req: EvolutionRequest,
  ) {
    // Round 2 (D-128): writing a financial proposal needs revenue write.
    await this.requireActingAuthority(businessId, req, {
      section: body?.section, reason: body?.reason, proposedPatch: body?.proposedPatch, evidence: body?.evidence,
    });
    return this.service.create(businessId, {
      ...body,
      createdBy: this.userId(req),
    });
  }

  @Post('evolution-proposals/generate-from-temporal-flow')
  @UseGuards(GenomeGateGuard)
  async generateFromTemporalFlow(
    @Param('businessId') businessId: string,
    @Req() req: EvolutionRequest,
  ) {
    // Round 2 (D-128): a member without revenue write does not make financial proposals.
    const writesRevenue = await requireRevenueLevel(this.prisma, businessId, this.reader(req) ?? undefined, 'write').then(() => true, () => false);
    const created = await this.service.generateFromTemporalFlow(businessId, this.userId(req), writesRevenue ? {} : { moneySections: false });
    return this.service.visibleTo(businessId, created, this.reader(req));
  }

  @Post('evolution-proposals/:id/approve')
  @UseGuards(GenomeGateGuard)
  async approve(
    @Param('businessId') businessId: string,
    @Param('id') proposalId: string,
    @Req() req: EvolutionRequest,
  ) {
    // Round 4 (security F2): checked on the row the approval reads and applies.
    const result = await this.service.approve(businessId, proposalId, this.userId(req), (row) => this.requireActingAuthority(businessId, req, row));
    // D-233: the genome integrity result carries the finance and sales DNA scores and the composites that weight them.
    if (await genomeReaderReadsRevenue(this.prisma, businessId, this.reader(req) ?? undefined).catch(() => false)) return result;
    return { proposal: result.proposal };
  }

  @Post('evolution-proposals/:id/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('id') proposalId: string,
    @Req() req: EvolutionRequest,
  ) {
    return this.service.reject(businessId, proposalId, this.userId(req), (row) => this.requireActingAuthority(businessId, req, row));
  }

  @Patch('evolution-proposals/:id')
  async edit(
    @Param('businessId') businessId: string,
    @Param('id') proposalId: string,
    @Body() body: UpdateGenomeEvolutionProposalDto,
    @Req() req?: EvolutionRequest,
  ) {
    // The proposal as the edit would leave it (an edit changes reason, patch, evidence and confidence, not the section),
    // judged with the row the edit reads (round 4, security F2).
    return this.service.edit(businessId, proposalId, body, (existing) => {
      const edited: GenomeEvolutionFields = {
        section: existing.section,
        reason: body.reason !== undefined ? body.reason : existing.reason,
        proposedPatch: body.proposedPatch !== undefined ? body.proposedPatch : existing.proposedPatch,
        evidence: body.evidence !== undefined ? body.evidence : existing.evidence,
      };
      return this.requireActingAuthority(businessId, req, existing, edited);
    });
  }
}

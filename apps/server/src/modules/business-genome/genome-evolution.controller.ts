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

import { GenomeEvolutionService } from './genome-evolution.service';
import { CreateGenomeEvolutionProposalDto } from './dto/create-genome-evolution-proposal.dto';
import { UpdateGenomeEvolutionProposalDto } from './dto/update-genome-evolution-proposal.dto';

@Controller('business-genome/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class GenomeEvolutionController {
  constructor(
    @Inject(GenomeEvolutionService) private readonly service: GenomeEvolutionService,
  ) {}

  private userId(req: { user?: { id?: string } }): string | undefined {
    return req.user?.id;
  }

  @Get('evolution-proposals')
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('section') section?: string,
  ) {
    return this.service.list(businessId, { status, section });
  }

  @Post('evolution-proposals')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateGenomeEvolutionProposalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.service.create(businessId, {
      ...body,
      createdBy: this.userId(req),
    });
  }

  @Post('evolution-proposals/generate-from-temporal-flow')
  @UseGuards(GenomeGateGuard)
  async generateFromTemporalFlow(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.service.generateFromTemporalFlow(businessId, this.userId(req));
  }

  @Post('evolution-proposals/:id/approve')
  @UseGuards(GenomeGateGuard)
  async approve(
    @Param('businessId') businessId: string,
    @Param('id') proposalId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.service.approve(businessId, proposalId, this.userId(req));
  }

  @Post('evolution-proposals/:id/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('id') proposalId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.service.reject(businessId, proposalId, this.userId(req));
  }

  @Patch('evolution-proposals/:id')
  async edit(
    @Param('businessId') businessId: string,
    @Param('id') proposalId: string,
    @Body() body: UpdateGenomeEvolutionProposalDto,
  ) {
    return this.service.edit(businessId, proposalId, body);
  }
}

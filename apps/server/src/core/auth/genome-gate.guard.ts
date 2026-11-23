import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { BlueprintService } from '../../modules/blueprint/blueprint.service';
import { PrismaService } from '../prisma/prisma.service';
import { genomeReaderReadsRevenue } from '../../modules/business-genome/key-genome/genome-finance-scope';
import type { DnaSectionKey } from '../../modules/blueprint/blueprint.types';

@Injectable()
export class GenomeGateGuard implements CanActivate {
  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    // FU-GENOME-EVOLUTION-SURFACES (D-233): to name the integrity only to a revenue reader. Optional so every existing
    // construction keeps working; without it the integrity is left out (fail closed).
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const businessId = request.params.businessId ?? request.params.business_id;

    if (!businessId) {
      throw new ForbiddenException('Missing businessId');
    }

    const result = await this.blueprint.calculateGenomeIntegrity(businessId);
    if (result.threePillarMinimumMet) {
      return true;
    }

    const pillarKeys: DnaSectionKey[] = ['founder', 'business', 'market'];
    const missingPillars = pillarKeys.filter((key) => result.genomeDnaScores[key] < 50);

    // FU-GENOME-EVOLUTION-SURFACES (D-233): the integrity is a composite that weights the financial and sales DNA; the
    // refusal names it only to a reader with revenue read (ModuleScopeGuard's reading). The missing pillars (founder,
    // business, market) are not money sections and stay.
    const user = request.user as { id?: string; role?: string } | undefined;
    const readsRevenue = this.prisma && user?.id
      ? await genomeReaderReadsRevenue(this.prisma, businessId, { id: user.id, role: user.role }).catch(() => false)
      : false;
    throw new ForbiddenException({
      code: 'GENOME_GATE_BLOCKED',
      message: 'Three-Pillar Minimum not met. Complete Founder, Business, and Market DNA to unlock this action.',
      ...(readsRevenue ? { genomeIntegrity: result.genomeIntegrity } : {}),
      missingPillars,
    });
  }
}

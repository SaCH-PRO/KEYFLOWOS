import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { BlueprintService } from '../../modules/blueprint/blueprint.service';
import type { DnaSectionKey } from '../../modules/blueprint/blueprint.types';

@Injectable()
export class GenomeGateGuard implements CanActivate {
  constructor(@Inject(BlueprintService) private readonly blueprint: BlueprintService) {}

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

    throw new ForbiddenException({
      code: 'GENOME_GATE_BLOCKED',
      message: 'Three-Pillar Minimum not met. Complete Founder, Business, and Market DNA to unlock this action.',
      genomeIntegrity: result.genomeIntegrity,
      missingPillars,
    });
  }
}

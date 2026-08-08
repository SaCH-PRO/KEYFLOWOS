import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { CapabilityContractService } from './capability-contract.service';

/**
 * Capability discovery API — how UI buttons, automations, external apps and
 * KEY itself learn which business actions exist, their schemas, risk and
 * permission requirements (convergence plan §Stage 3).
 */
@Controller('capabilities')
@UseGuards(AuthGuard)
export class CapabilitiesController {
  constructor(private readonly contract: CapabilityContractService) {}

  @Get()
  list(
    @Query('ownerModule') ownerModule?: string,
    @Query('family') family?: string,
    @Query('riskTier') riskTier?: string,
  ) {
    return this.contract.list({
      ownerModule,
      family,
      riskTier: riskTier ? Number(riskTier) : undefined,
    });
  }

  @Get('stats')
  stats() {
    return this.contract.stats();
  }

  @Get(':name')
  get(@Param('name') name: string) {
    const definition = this.contract.get(name);
    if (!definition) throw new NotFoundException(`Capability '${name}' is not registered`);
    return definition;
  }
}

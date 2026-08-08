import { Module } from '@nestjs/common';
import { CapabilitiesController } from './capabilities.controller';
import { CapabilityContractService } from './capability-contract.service';

@Module({
  controllers: [CapabilitiesController],
  providers: [CapabilityContractService],
  exports: [CapabilityContractService],
})
export class CapabilitiesModule {}

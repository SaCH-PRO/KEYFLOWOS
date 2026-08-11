import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractClauseService } from './contract-clause.service';
import { ContractRenewalSweep } from './contract-renewal.sweep';

@Module({
  imports: [forwardRef(() => AiModule)],
  controllers: [ContractsController],
  providers: [ContractsService, ContractClauseService, ContractRenewalSweep],
  exports: [ContractsService, ContractClauseService],
})
export class ContractsModule {}

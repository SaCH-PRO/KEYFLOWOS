import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractClauseService } from './contract-clause.service';

@Module({
  imports: [forwardRef(() => AiModule)],
  controllers: [ContractsController],
  providers: [ContractsService, ContractClauseService],
  exports: [ContractsService, ContractClauseService],
})
export class ContractsModule {}

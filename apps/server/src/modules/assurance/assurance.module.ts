import { Module } from '@nestjs/common';
import { AssuranceController } from './assurance.controller';
import { ProofObligationService } from './proof-obligation.service';

@Module({
  controllers: [AssuranceController],
  providers: [ProofObligationService],
  exports: [ProofObligationService],
})
export class AssuranceModule {}

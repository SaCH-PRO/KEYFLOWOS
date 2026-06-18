import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { GenomeEvolutionController } from './genome-evolution.controller';
import { GenomeEvolutionService } from './genome-evolution.service';

@Module({
  imports: [PrismaModule, BlueprintModule, TemporalFlowModule],
  controllers: [GenomeEvolutionController],
  providers: [GenomeEvolutionService],
  exports: [GenomeEvolutionService],
})
export class BusinessGenomeModule {}

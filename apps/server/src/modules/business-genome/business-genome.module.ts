import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { KeyGenomeModule } from './key-genome/key-genome.module';
import { GenomeEvolutionController } from './genome-evolution.controller';
import { GenomeEvolutionService } from './genome-evolution.service';
import { ConstitutionVersionController } from './constitution-version.controller';
import { ConstitutionVersionService } from './constitution-version.service';
import { KeyGenomeController } from './key-genome/key-genome.controller';

@Module({
  imports: [PrismaModule, BlueprintModule, TemporalFlowModule, KeyGenomeModule],
  controllers: [GenomeEvolutionController, ConstitutionVersionController, KeyGenomeController],
  providers: [GenomeEvolutionService, ConstitutionVersionService],
  exports: [GenomeEvolutionService, ConstitutionVersionService],
})
export class BusinessGenomeModule {}

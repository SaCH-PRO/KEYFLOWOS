import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { BlueprintController } from './blueprint.controller';
import { BlueprintService } from './blueprint.service';

@Module({
  imports: [PrismaModule, TemporalFlowModule, KeyGenomeModule],
  controllers: [BlueprintController],
  providers: [BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}

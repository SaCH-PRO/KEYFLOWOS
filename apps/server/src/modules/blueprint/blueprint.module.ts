import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BlueprintController } from './blueprint.controller';
import { BlueprintService } from './blueprint.service';

@Module({
  imports: [PrismaModule, TemporalFlowModule],
  controllers: [BlueprintController],
  providers: [BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}

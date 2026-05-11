import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BlueprintController } from './blueprint.controller';
import { BlueprintService } from './blueprint.service';

@Module({
  imports: [PrismaModule],
  providers: [BlueprintService],
  controllers: [BlueprintController],
  exports: [BlueprintService],
})
export class BlueprintModule {}

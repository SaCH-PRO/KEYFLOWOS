import { Module } from '@nestjs/common';
import { StructureService } from './structure.service';
import { StructureController } from './structure.controller';

@Module({
  controllers: [StructureController],
  providers: [StructureService],
  exports: [StructureService],
})
export class StructureModule {}

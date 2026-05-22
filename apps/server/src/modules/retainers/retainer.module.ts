import { Module } from '@nestjs/common';
import { RetainerService } from './retainer.service';
import { RetainerController } from './retainer.controller';

@Module({
  providers: [RetainerService],
  controllers: [RetainerController],
  exports: [RetainerService],
})
export class RetainerModule {}

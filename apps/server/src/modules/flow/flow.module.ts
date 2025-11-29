import { Module } from '@nestjs/common';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';

@Module({
  controllers: [FlowController],
  providers: [FlowListener],
})
export class FlowModule {}

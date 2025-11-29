import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';

@Module({
  controllers: [AiController],
  providers: [AiListener],
})
export class AiModule {}

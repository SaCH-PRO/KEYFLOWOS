import { Module } from '@nestjs/common';
import { GamificationController } from './gamification.controller';
import { GamificationListener } from './gamification.listener';

@Module({
  controllers: [GamificationController],
  providers: [GamificationListener],
})
export class GamificationModule {}

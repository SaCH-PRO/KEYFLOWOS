import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';

@Module({
  controllers: [AutomationController],
})
export class AutomationModule {}

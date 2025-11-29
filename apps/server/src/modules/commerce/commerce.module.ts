import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';

@Module({
  controllers: [CommerceController],
})
export class CommerceModule {}

import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';

@Module({
  controllers: [SocialController],
})
export class SocialModule {}

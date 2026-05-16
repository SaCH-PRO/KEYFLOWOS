import { Module } from '@nestjs/common';
import { DirectoryController } from './directory.controller';

@Module({
  controllers: [DirectoryController],
})
export class DirectoryModule {}

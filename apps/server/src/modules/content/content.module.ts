import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { ContentService } from './content.service';

@Module({
  imports: [PrismaModule],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}

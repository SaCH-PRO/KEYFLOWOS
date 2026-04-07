import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BusinessContextService } from '../identity/business-context.service';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, BusinessContextService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

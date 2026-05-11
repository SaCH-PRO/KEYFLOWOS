// @keyflow:dormant — UI surface gated by featureFlags (KEY-9 cleanup target).
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BusinessContextService } from '../identity/business-context.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { GoogleDriveModule } from '../google-drive/google-drive.module';

@Module({
  imports: [PrismaModule, AiModule, NotificationsModule, GoogleDriveModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, BusinessContextService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

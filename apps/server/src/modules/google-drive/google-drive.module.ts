import { Module } from '@nestjs/common';
import { GoogleDriveController } from './google-drive.controller';
import { GoogleDriveService } from './google-drive.service';
import { GeneratedDocumentService } from './generated-document.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService, GeneratedDocumentService],
  exports: [GoogleDriveService, GeneratedDocumentService],
})
export class GoogleDriveModule {}

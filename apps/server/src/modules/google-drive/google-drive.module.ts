import { Module } from '@nestjs/common';
import { GoogleDriveController } from './google-drive.controller';
import { GoogleDriveService } from './google-drive.service';

@Module({
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}

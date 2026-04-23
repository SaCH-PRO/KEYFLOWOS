import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { StorageController } from './storage.controller';
import { SupabaseAdminService } from '../../core/supabase/supabase-admin.service';

@Module({
  controllers: [UploadsController, StorageController],
  providers: [UploadsService, SupabaseAdminService],
  exports: [UploadsService],
})
export class UploadsModule {}

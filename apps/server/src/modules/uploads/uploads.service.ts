import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from '../../replit_integrations/object_storage';
import { SupabaseAdminService } from '../../core/supabase/supabase-admin.service';

@Injectable()
export class UploadsService {
  private objectStorage: ObjectStorageService;
  private readonly supabaseStorage: SupabaseAdminService;

  constructor(supabaseAdmin: SupabaseAdminService) {
    this.objectStorage = new ObjectStorageService();
    this.supabaseStorage = supabaseAdmin;
  }

  async getUploadUrl(): Promise<{ uploadURL: string; objectPath: string }> {
    const uploadURL = await this.objectStorage.getObjectEntityUploadURL();
    const objectPath = this.objectStorage.normalizeObjectEntityPath(uploadURL);
    return { uploadURL, objectPath };
  }

  async getSignedDownloadUrl(path: string, bucket?: string): Promise<string> {
    const storageBucket = bucket || process.env.SUPABASE_STORAGE_BUCKET || 'app-uploads';
    const signed = await this.supabaseStorage.createSignedDownloadUrl(storageBucket, path, 3600);
    return signed.signedUrl;
  }
}

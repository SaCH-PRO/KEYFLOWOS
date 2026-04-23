import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { SupabaseAdminService } from '../../core/supabase/supabase-admin.service';
import { AuthGuard } from '../../core/auth/auth.guard';

@Controller('storage')
export class StorageController {
  constructor(@Inject(SupabaseAdminService) private readonly supabaseAdmin: SupabaseAdminService) {}

  @UseGuards(AuthGuard)
  @Post('sign-upload')
  async signUpload(
    @Body() body: { bucket?: string; path?: string; expiresIn?: number },
  ) {
    const bucket = body.bucket || process.env.SUPABASE_STORAGE_BUCKET || 'app-uploads'; // TODO: create bucket in Supabase dashboard
    const path = body.path || `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
    const expiresIn = body.expiresIn ?? 3600;
    return this.supabaseAdmin.createSignedUploadUrl(bucket, path, expiresIn);
  }

  @UseGuards(AuthGuard)
  @Post('sign-download')
  async signDownload(
    @Body() body: { bucket?: string; path: string; expiresIn?: number },
  ) {
    const bucket = body.bucket || process.env.SUPABASE_STORAGE_BUCKET || 'app-uploads'; // TODO: create bucket in Supabase dashboard
    return this.supabaseAdmin.createSignedDownloadUrl(bucket, body.path, body.expiresIn ?? 3600);
  }
}

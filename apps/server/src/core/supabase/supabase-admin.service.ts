import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private client: SupabaseClient | null = null;

  getClient(): SupabaseClient {
    if (this.client) return this.client;

    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) {
      throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for server/admin Supabase client');
    }

    this.client = createClient(url, secret, { auth: { persistSession: false } });
    return this.client;
  }

  async createSignedUploadUrl(
    bucket: string,
    path: string,
    expiresIn = 60,
  ) {
    const { data, error } = await this.getClient().storage.from(bucket).createSignedUploadUrl(path, {
      upsert: true,
    });
    if (error) throw error;
    return { bucket, path, token: data.token, signedUrl: data.signedUrl, expiresIn };
  }

  async createSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresIn = 60,
  ) {
    const { data, error } = await this.getClient().storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return { bucket, path, signedUrl: data.signedUrl, expiresIn };
  }
}

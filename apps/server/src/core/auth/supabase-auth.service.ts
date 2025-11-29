import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);
  private client: SupabaseClient | null = null;

  private get supabase(): SupabaseClient | null {
    if (this.client) return this.client;

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      this.logger.warn('Supabase env vars missing; auth will be treated as optional.');
      return null;
    }

    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
    return this.client;
  }

  async getUserFromToken(token?: string): Promise<User | null> {
    if (!token) return null;
    const supabase = this.supabase;
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      this.logger.debug(`Supabase auth error: ${error.message}`);
      return null;
    }
    return data.user ?? null;
  }
}

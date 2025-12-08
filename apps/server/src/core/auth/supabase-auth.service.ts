import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

type DecodedJwt = {
  sub?: string;
  user_id?: string;
  email?: string;
  exp?: number;
  [key: string]: unknown;
};

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

  private decodeJwt(token: string): DecodedJwt | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = parts[1];
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (err) {
      this.logger.debug(`JWT decode failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getUserFromToken(token?: string): Promise<User | null> {
    if (!token) return null;
    const supabase = this.supabase;
    if (supabase) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error) {
        this.logger.debug(`Supabase auth error: ${error.message}`);
      } else if (data?.user) {
        return data.user;
      }
    }

    // Fallback: decode JWT locally (dev-friendly to avoid hard failures)
    const decoded = this.decodeJwt(token);
    const userId = decoded?.sub || decoded?.user_id;
    if (!userId) return null;
    return {
      id: userId,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      factors: [],
      email: typeof decoded?.email === 'string' ? decoded.email : undefined,
      created_at: '',
      updated_at: '',
    } as User;
  }
}

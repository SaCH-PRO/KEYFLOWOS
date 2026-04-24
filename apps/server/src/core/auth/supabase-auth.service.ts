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

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      this.logger.debug(`Supabase auth error: ${error.message}`);
      return null;
    }
    return data?.user ?? null;
  }

  async updatePassword(token: string, password: string): Promise<void> {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error('Supabase auth is not configured.');
    }
    const res = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string; error_description?: string } | null;
      throw new Error(data?.message || data?.error_description || 'Failed to update password');
    }
  }
}

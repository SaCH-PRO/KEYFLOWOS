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
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
      this.logger.warn('Supabase server auth env vars missing; auth will be treated as optional.');
      return null;
    }

    this.client = createClient(url, publishableKey, { auth: { persistSession: false } });
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
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error) {
          this.logger.debug(`Supabase auth error: ${error.message}`);
        } else if (data?.user) {
          return data.user;
        }
      } catch (err) {
        this.logger.debug(`Supabase auth request threw: ${(err as Error).message}`);
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

  async updatePassword(token: string, password: string): Promise<void> {
    const url = process.env.SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) {
      throw new Error('Supabase auth is not configured.');
    }
    const res = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string; error_description?: string } | null;
      throw new Error(data?.message || data?.error_description || 'Failed to update password');
    }
  }

  async inspectToken(token?: string): Promise<{
    hasToken: boolean;
    supabaseConfigured: boolean;
    supabaseVerified: boolean;
    fallbackDecoded: boolean;
    userId?: string;
    email?: string;
    reason?: string;
  }> {
    if (!token) {
      return {
        hasToken: false,
        supabaseConfigured: !!this.supabase,
        supabaseVerified: false,
        fallbackDecoded: false,
        reason: 'no_token',
      };
    }

    const supabase = this.supabase;
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user?.id) {
          return {
            hasToken: true,
            supabaseConfigured: true,
            supabaseVerified: true,
            fallbackDecoded: false,
            userId: data.user.id,
            email: data.user.email ?? undefined,
          };
        }
        if (error) {
          this.logger.debug(`inspectToken supabase error: ${error.message}`);
        }
      } catch (err) {
        this.logger.debug(`inspectToken supabase throw: ${(err as Error).message}`);
      }
    }

    const decoded = this.decodeJwt(token);
    const userId = decoded?.sub || decoded?.user_id;
    if (!userId) {
      return {
        hasToken: true,
        supabaseConfigured: !!supabase,
        supabaseVerified: false,
        fallbackDecoded: false,
        reason: 'token_decode_failed_or_missing_sub',
      };
    }

    return {
      hasToken: true,
      supabaseConfigured: !!supabase,
      supabaseVerified: false,
      fallbackDecoded: true,
      userId,
      email: typeof decoded?.email === 'string' ? decoded.email : undefined,
    };
  }

  async inspectAuthEnv(): Promise<{ hasSupabaseUrl: boolean; hasSupabasePublishableKey: boolean }> {
    const url = process.env.SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    return {
      hasSupabaseUrl: !!url,
      hasSupabasePublishableKey: !!publishableKey,
    };
  }
}

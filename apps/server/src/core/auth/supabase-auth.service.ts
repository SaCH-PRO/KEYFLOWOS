import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { jwtVerify, errors as JoseErrors } from 'jose';

interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

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

  private getJwtSecret(): Uint8Array | null {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) return null;
    return new TextEncoder().encode(secret);
  }

  private async verifyLocal(token: string): Promise<JwtPayload | null> {
    const secret = this.getJwtSecret();
    if (!secret) return null;
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        clockTolerance: 60,
      });
      return payload as JwtPayload;
    } catch (err: any) {
      if (err instanceof JoseErrors.JWSSignatureVerificationFailed) {
        this.logger.debug('Local JWT verification: signature invalid');
      } else if (err instanceof JoseErrors.JWTExpired) {
        this.logger.debug('Local JWT verification: token expired');
      } else {
        this.logger.debug(`Local JWT verification failed: ${(err as Error).message}`);
      }
      return null;
    }
  }

  private buildUserFromPayload(payload: JwtPayload): User {
    return {
      id: payload.sub ?? '',
      email: payload.email ?? '',
      role: payload.role ?? '',
      user_metadata: payload.user_metadata ?? {},
      app_metadata: {},
      aud: 'authenticated',
      created_at: '',
    } as User;
  }

  /**
   * Resolve a Supabase access token to a verified user.
   *
   * When SUPABASE_JWT_SECRET is configured, tokens are verified locally
   * using HMAC-SHA256 signature validation (faster, works offline).
   * Otherwise we round-trip to Supabase auth.getUser() (requires network).
   *
   * SECURITY: local verification uses the exact same secret Supabase uses
   * to sign tokens, so a forged signature is cryptographically infeasible.
   */
  async getUserFromToken(token?: string): Promise<User | null> {
    if (!token) return null;

    // Primary path: local verification with SUPABASE_JWT_SECRET
    const localPayload = await this.verifyLocal(token);
    if (localPayload?.sub) {
      return this.buildUserFromPayload(localPayload);
    }

    // Fallback: round-trip to Supabase (when JWT secret is not configured)
    const supabase = this.supabase;
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      this.logger.debug(`Supabase auth error: ${error.message}`);
      return null;
    }
    return data?.user ?? null;
  }
}

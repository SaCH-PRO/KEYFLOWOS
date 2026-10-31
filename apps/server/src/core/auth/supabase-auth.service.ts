import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
  exp?: number;
  iat?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
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

  private getJwtSecret(): string | null {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) return null;
    return secret;
  }

  /**
   * R0-SEC-02: the only issuer a hosted project puts on its access tokens is
   * its GoTrue URL, `${SUPABASE_URL}/auth/v1` (supabase-js builds the same URL:
   * `new URL('auth/v1', baseUrl)` in SupabaseClient; claim reference
   * https://supabase.com/docs/guides/auth/jwt-fields). A token with no `iss`,
   * or with `iss = SUPABASE_URL`, is a shape no hosted project issues, so it is
   * refused.
   *
   * With no Supabase URL there is nothing to compare against. The one shape
   * still accepted then is a token with NO `iss`, and only under
   * NODE_ENV=test: the real-database harnesses (release0-journey,
   * identity-boundary, onboarding-manual-complete, identity-local-auth) mint
   * that shape against a server with SUPABASE_URL empty. Production,
   * development and an unset NODE_ENV refuse it.
   */
  private issuerAccepted(iss: unknown): boolean {
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    if (url) {
      return typeof iss === 'string' && iss === `${url.replace(/\/+$/, '')}/auth/v1`;
    }
    return process.env.NODE_ENV === 'test' && iss === undefined;
  }

  private verifyLocal(token: string): JwtPayload | null {
    const secret = this.getJwtSecret();
    if (!secret) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;

    try {
      const headerJson = JSON.parse(
        Buffer.from(header, 'base64url').toString('utf8'),
      ) as { alg?: string };
      if (headerJson.alg !== 'HS256') {
        this.logger.debug('Local JWT verification: unsupported algorithm');
        return null;
      }

      const expectedSignature = createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');

      if (
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
      ) {
        this.logger.debug('Local JWT verification: signature invalid');
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as JwtPayload;

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== 'number') {
        this.logger.debug('Local JWT verification: exp missing');
        return null;
      }
      if (payload.exp < nowSeconds) {
        this.logger.debug('Local JWT verification: token expired');
        return null;
      }
      if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
        this.logger.debug('Local JWT verification: token not yet valid');
        return null;
      }
      if (typeof payload.iat === 'number' && payload.iat > nowSeconds + 60) {
        this.logger.debug('Local JWT verification: issued-at in the future');
        return null;
      }

      if (!this.issuerAccepted(payload.iss)) {
        this.logger.debug('Local JWT verification: issuer mismatch');
        return null;
      }

      const expectedAud = 'authenticated';
      if (payload.aud !== expectedAud) {
        this.logger.debug('Local JWT verification: audience mismatch');
        return null;
      }

      return payload;
    } catch (err: unknown) {
      this.logger.debug(`Local JWT verification failed: ${(err as Error).message}`);
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
   * It accepts only the hosted token shape (`iss` = `${SUPABASE_URL}/auth/v1`,
   * `aud` = `authenticated`, a live `exp`); see issuerAccepted (R0-SEC-02).
   */
  async getUserFromToken(token?: string): Promise<User | null> {
    if (!token) return null;

    // Primary path: local verification with SUPABASE_JWT_SECRET
    const localPayload = this.verifyLocal(token);
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
    const user = data?.user;
    if (!user) return null;

    // Reject tokens for banned or disabled accounts even when Supabase returns
    // a valid user object. The `banned_at` field is set by Supabase when an
    // account is disabled in the auth dashboard.
    if ((user as User & { banned_at?: string | null }).banned_at) {
      this.logger.debug('Supabase auth: user is banned');
      return null;
    }

    return user;
  }
}

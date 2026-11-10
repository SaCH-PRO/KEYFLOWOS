import { Injectable, Logger } from '@nestjs/common';
import { AuthError, createClient, SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

/**
 * W7-RISC-REVOKE (D-39): how long the user JWT revokeAllSessions mints for
 * POST /logout lives, in seconds. It is used once, at once; the margin only
 * covers clock skew between this server and GoTrue.
 */
const REVOKE_ALL_SESSIONS_JWT_TTL_SECONDS = 60;

function statusOf(error: unknown): number | null {
  if (error instanceof AuthError) {
    return typeof error.status === 'number' ? error.status : null;
  }
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

/**
 * Server-side privileged Supabase client.
 *
 * Uses the service-role key to perform operations the anon-key client
 * cannot — creating users, generating verification links, fetching users
 * by email, etc. NEVER expose the service-role key to the browser.
 *
 * The companion `SupabaseAuthService` (which uses the anon key) remains
 * the path used to verify end-user JWTs on incoming requests.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private client: SupabaseClient | null = null;

  isConfigured(): boolean {
    return Boolean(this.getUrl() && this.getServiceRoleKey());
  }

  describeMissingConfig(): string | null {
    const missing: string[] = [];
    if (!this.getUrl()) missing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
    if (!this.getServiceRoleKey()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    return missing.length ? missing.join(', ') : null;
  }

  private getUrl(): string | null {
    const v = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    return v.length > 0 ? v : null;
  }

  private getServiceRoleKey(): string | null {
    const v = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    return v.length > 0 ? v : null;
  }

  getClient(): SupabaseClient {
    if (this.client) return this.client;
    const url = this.getUrl();
    const key = this.getServiceRoleKey();
    if (!url || !key) {
      throw new Error(
        'Supabase admin client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this.client;
  }

  /**
   * Create a Supabase auth user. When `emailConfirm` is true the user is
   * created already-confirmed (used in dev / when verification is off);
   * otherwise the user is created unconfirmed and the caller is expected
   * to generate + send a verification link.
   */
  async createUser(args: {
    email: string;
    password: string;
    emailConfirm: boolean;
    userMetadata?: Record<string, unknown>;
  }) {
    const client = this.getClient();
    const { data, error } = await client.auth.admin.createUser({
      email: args.email,
      password: args.password,
      email_confirm: args.emailConfirm,
      user_metadata: args.userMetadata ?? {},
    });
    if (error) {
      this.logger.debug(`createUser failed for ${args.email}: ${error.message}`);
      throw new SupabaseAdminError(error.message, statusOf(error), error);
    }
    if (!data?.user) {
      throw new SupabaseAdminError('Supabase did not return a user', null);
    }
    return data.user;
  }

  /**
   * Revoke Supabase sessions of the user an access token belongs to.
   *
   * `jwt` is that user's Supabase ACCESS TOKEN, not their id. auth-js
   * (installed 2.94.0) declares `GoTrueAdminApi.signOut(jwt, scope)` and sends
   * the first argument as the bearer of `POST /logout?scope=<scope>`; GoTrue
   * then revokes the refresh tokens of the sessions the scope names — 'global':
   * every session of that user, 'others': all but the token's own session,
   * 'local': only the token's own. The installed admin API has no call that
   * revokes by user id. Until R0-ID-F4 (CR-2) this method was handed the user
   * id, which GoTrue refused as a bearer, so nothing was ever revoked.
   *
   * Access tokens already issued stay valid until their exp (Supabase cannot
   * recall a JWT): POST /identity/logout's local marker covers those.
   *
   * Swallows errors and returns whether the call succeeded. The token is never
   * logged. A value that is not JWT-shaped (a user id) is refused without a
   * request.
   */
  async signOut(jwt: string, scope: 'global' | 'local' | 'others' = 'global'): Promise<boolean> {
    const parts = typeof jwt === 'string' ? jwt.split('.') : [];
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
      this.logger.warn(`signOut(${scope}) refused: not a Supabase access token (a user id cannot revoke sessions)`);
      return false;
    }
    try {
      const client = this.getClient();
      const { error } = await client.auth.admin.signOut(jwt, scope);
      if (error) {
        this.logger.warn(`signOut(${scope}) failed: ${error.message}`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.warn(
        `signOut(${scope}) threw: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  /**
   * Revoke EVERY Supabase session of a user, and with them every refresh
   * token, by user id: for a caller that holds no access token of that user
   * (a RISC event carries none). W7-RISC-REVOKE (D-39: the provider global
   * logout), closing R0-ID-F7 review F7-SEC-2.
   *
   * The installed auth-js (2.94.0) admin API has no call that ends sessions by
   * user id: admin.signOut(jwt, scope) sends its first argument as the bearer
   * of POST /logout, and there is no admin sessions API. So this mints that
   * bearer: an HS256 JWT under the project's JWT secret (SUPABASE_JWT_SECRET,
   * the key GoTrue verifies an HS256 token without a kid against), sub = the
   * user, role and aud 'authenticated', iss the project's GoTrue URL, expiring
   * in REVOKE_ALL_SESSIONS_JWT_TTL_SECONDS, and with NO session_id claim.
   * GoTrue's Logout handler, given a user JWT with no session_id, deletes
   * every session of the user (models.Logout), whatever the scope; 'global'
   * is sent anyway, through signOut above.
   *
   * Fails closed: with the admin client or SUPABASE_JWT_SECRET not configured
   * nothing is sent and false is returned, so the caller names the leg as not
   * done. A secret GoTrue does not hold is refused there (bad_jwt): false too.
   * Never throws. The minted token never leaves this method except as that
   * bearer, and is never logged.
   */
  async revokeAllSessions(userId: string): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(`revokeAllSessions(${userId}) not attempted: ${this.describeMissingConfig()} not set`);
      return false;
    }
    const secret = (process.env.SUPABASE_JWT_SECRET || '').trim();
    if (!secret) {
      this.logger.warn(
        `revokeAllSessions(${userId}) not attempted: SUPABASE_JWT_SECRET is not set, so no user JWT can be minted for POST /logout`,
      );
      return false;
    }
    let jwt: string;
    try {
      const now = Math.floor(Date.now() / 1000);
      jwt = await new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setAudience('authenticated')
        .setIssuer(new URL('auth/v1', `${(this.getUrl() ?? '').replace(/\/+$/, '')}/`).toString())
        .setIssuedAt(now)
        .setExpirationTime(now + REVOKE_ALL_SESSIONS_JWT_TTL_SECONDS)
        .sign(new TextEncoder().encode(secret));
    } catch (err: unknown) {
      this.logger.warn(
        `revokeAllSessions(${userId}) could not mint the sign-out JWT: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
    const ok = await this.signOut(jwt, 'global');
    if (!ok) this.logger.warn(`revokeAllSessions(${userId}): GoTrue did not accept the global sign-out`);
    return ok;
  }

  /**
   * Best-effort delete of an auth user. Used to roll back a half-created
   * signup when subsequent steps (link generation, email send) fail, so
   * the user can retry signup cleanly instead of bouncing off `email_taken`.
   * Swallows errors and returns whether deletion succeeded.
   */
  async deleteUser(userId: string): Promise<boolean> {
    try {
      const client = this.getClient();
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) {
        this.logger.warn(`deleteUser(${userId}) failed: ${error.message}`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.warn(
        `deleteUser(${userId}) threw: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  /**
   * Generate the initial Supabase signup confirmation link. This is the
   * `signup` flow, which requires the user's password (Supabase associates
   * the new credentials with the link).
   */
  async generateSignupLink(args: { email: string; password: string; redirectTo: string }) {
    const client = this.getClient();
    const { data, error } = await client.auth.admin.generateLink({
      type: 'signup',
      email: args.email,
      password: args.password,
      options: { redirectTo: args.redirectTo },
    });
    if (error) {
      this.logger.debug(`generateSignupLink failed for ${args.email}: ${error.message}`);
      throw new SupabaseAdminError(error.message, statusOf(error), error);
    }
    const link = data?.properties?.action_link;
    if (!link) {
      throw new SupabaseAdminError('Supabase did not return an action link', null);
    }
    return link;
  }

  /**
   * Re-issue a fresh verification link for an existing (unconfirmed) user.
   * Uses Supabase's `magiclink` flow — clicking the link both confirms the
   * email and signs the user in. Unlike `signup`, this does not require us
   * to know (or pass through) the user's password, which we never store.
   */
  async generateConfirmationLink(args: { email: string; redirectTo: string }) {
    const client = this.getClient();
    const { data, error } = await client.auth.admin.generateLink({
      type: 'magiclink',
      email: args.email,
      options: { redirectTo: args.redirectTo },
    });
    if (error) {
      this.logger.debug(`generateConfirmationLink failed for ${args.email}: ${error.message}`);
      throw new SupabaseAdminError(error.message, statusOf(error), error);
    }
    const link = data?.properties?.action_link;
    if (!link) {
      throw new SupabaseAdminError('Supabase did not return an action link', null);
    }
    return link;
  }

  /**
   * Look up an auth user by email. Returns null if not found.
   * Supabase does not expose a direct `getUserByEmail` admin endpoint, so
   * we paginate through `listUsers` until a match is found or the user
   * directory is exhausted. We cap pagination at `maxPages` as a defensive
   * upper bound (perPage 200 × 50 pages = 10k users) to prevent an
   * unbounded loop if the API misbehaves.
   */
  async findUserByEmail(email: string) {
    const client = this.getClient();
    const normalized = email.trim().toLowerCase();
    const perPage = 200;
    const maxPages = 50;
    for (let page = 1; page <= maxPages; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage });
      if (error) {
        this.logger.debug(`findUserByEmail listUsers failed (page ${page}): ${error.message}`);
        return null;
      }
      const users = data?.users ?? [];
      const match = users.find((u) => (u.email || '').trim().toLowerCase() === normalized);
      if (match) return match;
      if (users.length < perPage) return null;
    }
    this.logger.warn(
      `findUserByEmail exhausted ${maxPages} pages without locating ${normalized}`,
    );
    return null;
  }

  /**
   * Ask Supabase to email a password-recovery link.
   *
   * Delivery stays with Supabase rather than moving to Resend: the recovery
   * template and the token that comes back with it are Supabase's, and routing
   * only the SEND through our own mailer would mean minting our own tokens and
   * owning their expiry, revocation and replay semantics. What this call adds
   * is that the request now passes through the server, where it can be rate
   * limited and audited like every other auth event.
   *
   * Returns void deliberately — the caller must not be able to tell a real
   * address from an unknown one. See resetRequest() in the password service.
   */
  async sendRecoveryEmail(email: string, redirectTo: string): Promise<void> {
    const client = this.getClient();
    const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    if (error) {
      // Logged, not thrown. A failure here is indistinguishable to the caller
      // from success by design; surfacing it would leak whether the address
      // exists.
      this.logger.warn(`sendRecoveryEmail failed: ${error.message}`);
    }
  }

  /**
   * Set a user's password directly.
   *
   * Used to complete a recovery once the new password has cleared the server's
   * policy and breach checks. Doing it through the admin API rather than
   * letting the browser PUT /auth/v1/user is the whole point: the browser path
   * cannot be made to run those checks.
   */
  async updateUserPassword(userId: string, password: string): Promise<void> {
    const client = this.getClient();
    const { error } = await client.auth.admin.updateUserById(userId, { password });
    if (error) {
      throw new SupabaseAdminError(
        `Failed to update password: ${error.message}`,
        statusOf(error),
        error,
      );
    }
  }
}

export class SupabaseAdminError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SupabaseAdminError';
  }
}

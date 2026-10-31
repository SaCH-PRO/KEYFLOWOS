import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyAdminToken } from './admin-token.util';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/** Redis key of the per-user logout revocation marker, written by POST /identity/logout. */
export const logoutRevocationKey = (userId: string): string => `auth:revoked:user:${userId}`;

/**
 * How long POST /identity/logout keeps the marker. It must be at least the
 * longest lifetime of a token issued before the logout, or such a token outlives
 * its revocation: Supabase access tokens live 1h by default, admin tokens 24h.
 */
export const LOGOUT_REVOCATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Below this a stored value is not a revocation time in epoch seconds
 * (2001-09-09). The bare flag '1' the previous release wrote is the case this
 * exists for.
 */
const MIN_REVOCATION_EPOCH_S = 1_000_000_000;

/** The marker value POST /identity/logout writes: the revocation time, in epoch seconds. */
export function logoutRevocationValue(nowMs: number = Date.now()): string {
  return String(Math.floor(nowMs / 1000));
}

/**
 * The cutoff a stored marker stands for, in epoch seconds: a token whose iat is
 * at or before it is refused.
 *
 * A value that is not an epoch-seconds time — the bare flag '1' the previous
 * release wrote — is a revocation at an unknown time, so its cutoff is NOW:
 * every token issued up to this moment is refused, exactly as the bare flag
 * refused every token before. The next POST /identity/logout rewrites it in the
 * new format; otherwise its TTL ends it.
 */
export function logoutRevocationCutoff(stored: string, nowMs: number = Date.now()): number {
  if (/^\d+$/.test(stored)) {
    const at = Number(stored);
    if (Number.isSafeInteger(at) && at >= MIN_REVOCATION_EPOCH_S) return at;
  }
  return Math.floor(nowMs / 1000);
}

/**
 * The `iat` claim (epoch seconds) of a JWT the verifier has ALREADY accepted,
 * or null when it has none. The payload bytes are covered by the signature
 * getUserFromToken checked (locally, or by Supabase), so the claim is
 * authentic; nothing here verifies anything.
 */
function issuedAtOf(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { iat?: unknown } | null;
    const iat = payload?.iat;
    return typeof iat === 'number' && Number.isFinite(iat) ? iat : null;
  } catch {
    return null;
  }
}

/**
 * Server-side authentication gate for every inbound request.
 *
 * Behaviour:
 *   - Extract `Authorization: Bearer <token>` if present.
 *   - Verify the token as a Supabase access token
 *     (`SupabaseAuthService.getUserFromToken`); if that does not verify, as an
 *     admin local-auth token (`verifyAdminToken`: HMAC with ADMIN_JWT_SECRET,
 *     plus its own jti / revokedAt checks).
 *   - EITHER WAY the verified subject then passes the local-user checks
 *     (`resolveLocalUser`): User.deletedAt and User.bannedAt. The role attached
 *     is the one on our Prisma `User` row, never a claim in either token, so
 *     role changes take effect immediately. A Supabase subject with no row yet
 *     is attached as USER (the bootstrap window, see resolveLocalUser); an
 *     admin-token subject with no row is refused — AdminAuthService only
 *     issues those tokens for an existing row.
 *     (Until R0-ID-F2-ADMIN-TOKEN-LOCAL-USER the admin branch attached the
 *     token's own claims and skipped every one of these checks — ST-2.)
 *   - Logout revocation is an issue-time cutoff for both token kinds, each in
 *     its own key. A Supabase token is refused when the per-user marker
 *     `auth:revoked:user:<id>` (POST /identity/logout) holds a revocation time
 *     at or after the token's iat, or when the token has no iat at all; a token
 *     issued after the logout is attached. POST /identity/login no longer
 *     deletes the marker (ST-4, R0-ID-F3-REVOCATION-IAT-CUTOFF: deleting it
 *     re-admitted every pre-logout token, a stolen one included). An admin
 *     token is revoked by its own cutoff (`admin:user:<id>:revokedAt`, in the
 *     admin token's milliseconds, checked in verifyAdminToken), which
 *     POST /api/admin/auth/logout and POST /identity/logout both write — NOT by
 *     the Supabase marker, whose seconds-granularity cutoff would refuse an
 *     admin login made in the same second as the logout.
 *   - On success, attach `req.user = { id, email, role }`.
 *   - On any failure / missing token, leave `req.user` unset. Downstream
 *     guards/controllers decide whether the route requires authentication
 *     and respond with 401 accordingly.
 *
 * No dev bypass exists. The previous `KEYFLOW_DEV_AUTH_BYPASS` escape hatch
 * was removed entirely (Tier 2 auth hardening); see `apps/server/src/main.ts`
 * for the boot-time guard that hard-fails if that env var is still set.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private supabaseAuthInstance: SupabaseAuthService | null = null;

  constructor(
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private getSupabaseAuth(): SupabaseAuthService {
    if (this.supabaseAuth) return this.supabaseAuth;
    // Defensive fallback: NestJS DI sometimes loses constructor metadata
    // under tsx/esbuild. Construct directly as a last resort so middleware
    // doesn't silently no-op.
    if (!this.supabaseAuthInstance) {
      this.supabaseAuthInstance = new SupabaseAuthService();
    }
    return this.supabaseAuthInstance;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.replace('Bearer ', '').trim()
        : undefined;

    if (!token) {
      next();
      return;
    }

    try {
      const user = await this.getSupabaseAuth().getUserFromToken(token);
      if (user?.id) {
        const localUser = await this.resolveLocalUser(user.id, { tokenIssuedAt: issuedAtOf(token) });
        if (!localUser) {
          this.logger.warn(
            { userId: user.id },
            'Token valid but local user is deleted, banned, or revoked — rejecting',
          );
          next();
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express request augmentation; unified user contract elsewhere
        (req as any).user = { id: user.id, email: user.email, role: localUser.role };
        this.logger.debug(
          { userId: user.id },
          'Attached user from supabase',
        );
      } else {
        // Fallback: try admin local-auth token (HMAC-JWT signed with ADMIN_JWT_SECRET).
        // The token establishes WHO the subject is; whether that subject may
        // still be here, and with which role, is the User row's answer — the
        // same resolveLocalUser row checks as the Supabase branch (ST-2). An
        // admin identity has no bootstrap window, so a missing row is refused
        // too. Its logout revocation is verifyAdminToken's own issue-time
        // cutoff (admin:user:<id>:revokedAt, which POST /identity/logout writes
        // too), not the per-user Supabase marker: see the class comment.
        const adminUser = await verifyAdminToken(token, this.redis);
        if (adminUser) {
          const localUser = await this.resolveLocalUser(adminUser.id, {
            requireRow: true,
            honourLogoutMarker: false,
          });
          if (!localUser) {
            this.logger.warn(
              { userId: adminUser.id },
              'Admin token valid but local user is missing, deleted, or banned — rejecting',
            );
            next();
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express request augmentation; unified user contract elsewhere
          (req as any).user = { id: adminUser.id, email: adminUser.email, role: localUser.role };
          this.logger.debug(
            { userId: adminUser.id },
            'Attached user from admin token',
          );
        } else {
          this.logger.warn('Bearer token provided but verification failed');
        }
      }
    } catch (err: any) {
      this.logger.debug(`AuthMiddleware error: ${(err as Error).message}`);
    }

    next();
  }

  /**
   * Decide whether a Supabase-verified token may be attached to the request.
   *
   * NO LOCAL ROW IS NOT THE SAME AS A REVOKED USER, AND CONFLATING THEM BROKE
   * EVERY NEW SIGNUP.
   *
   * The version that shipped in 7d6fd587 rejected on `!dbUser`. That looks
   * right and is not, because of the order things happen in:
   *
   *   1. POST /identity/signup       creates the SUPABASE user, and no local row
   *   2. POST /identity/bootstrap    creates the local row
   *
   * Step 2 needs an attached user to get past AuthGuard, and step 2 is the only
   * thing that creates the row the middleware was demanding. So a brand-new
   * account could never complete: bootstrap answered 401 "Authentication
   * required", the signup page surfaced that error and returned, and the user
   * was stranded on the form with a working account they could not reach.
   *
   * Measured in production: signup logged `success / reason: session` at
   * 17:52:45 while the browser showed "authentication required" — the server
   * and the screen disagreeing, which is the defect class this codebase keeps
   * producing.
   *
   * The predecessor (`attachRole`) got this right by accident: it read the row
   * only to pick up a role and defaulted to USER when there was none.
   *
   * So the three states are now distinguished:
   *
   *   row absent          -> a user who has not bootstrapped yet. ATTACH, role
   *                          USER. They can reach bootstrap and nothing else
   *                          meaningful, since every business-scoped route
   *                          needs a membership they do not have yet.
   *   row deleted/banned  -> REJECT.
   *   revocation marker   -> REJECT a token issued at or before the marker's
   *                          revocation time (`opts.tokenIssuedAt`, or no iat
   *                          at all), whether or not a row exists — checked
   *                          first, so a purged-then-revoked user cannot slip
   *                          through the absent-row branch. A token issued
   *                          after the logout goes on to the row checks.
   *
   * `requireRow` turns "row absent" into REJECT. The admin-token branch passes
   * it: an admin identity is only ever issued for an existing User row
   * (AdminAuthService.validateCredentials), so it has no bootstrap window, and
   * defaulting a vanished admin to USER would keep a deleted account attached.
   *
   * `honourLogoutMarker: false` skips the revocation marker. The admin-token
   * branch passes it. When the marker was a per-user flag with no issue time
   * (before R0-ID-F3), honouring it there refused every token a later
   * POST /api/admin/auth/login issued, for 24h. Admin tokens are revoked by
   * their own issue-time cutoff instead (`admin:user:<id>:revokedAt`, in the
   * admin token's milliseconds, checked in verifyAdminToken; POST
   * /identity/logout writes it too).
   *
   * `tokenIssuedAt` is the Supabase token's iat (epoch seconds), null when it
   * has none. It only matters when a marker exists.
   */
  private async resolveLocalUser(
    userId: string,
    opts: { requireRow?: boolean; honourLogoutMarker?: boolean; tokenIssuedAt?: number | null } = {},
  ): Promise<{ role: string } | null> {
    if (!this.prisma?.client) {
      return null;
    }
    const honourLogoutMarker = opts.honourLogoutMarker ?? true;

    // Revocation is checked BEFORE the row lookup on purpose: it must apply to
    // the no-row case too, or logging out would stop protecting a user whose
    // row was later hard-deleted.
    //
    // A REDIS OUTAGE IS NOT A REVOKED USER, AND CONFLATING THEM TOOK THE WHOLE
    // PRODUCT DOWN. Both lookups used to share one try/catch that returned null
    // — "reject" — for any error. Measured by stopping the container: the same
    // valid token went from 200 to 401, and a brand-new signup got its token
    // and then 401'd on bootstrap. Every user logged out, no new account able
    // to complete, from a cache being unavailable.
    //
    // That is the same failure the long comment above describes, arriving by a
    // different route: the fix for "no local row" is bypassed entirely when the
    // step before it throws.
    //
    // So the two are now separated, because they are not the same question:
    //
    //   Redis unavailable  -> we cannot tell whether this token was revoked.
    //                         The authoritative checks (deleted, banned) live in
    //                         Postgres and still run. The exposure is bounded:
    //                         a user who logged out keeps a working access token
    //                         until it expires on its own, about an hour. We
    //                         accept that rather than deny everyone.
    //   Postgres unavailable -> we cannot tell whether the user is deleted or
    //                         banned, and that IS the authoritative control.
    //                         Still fail closed. The app cannot serve anything
    //                         meaningful without the database anyway.
    if (honourLogoutMarker) {
      let marker: string | null = null;
      try {
        marker = await this.redis.get(logoutRevocationKey(userId));
      } catch (redisErr) {
        // warn, not debug: this is a real security degradation and should be
        // visible without turning on verbose logging.
        this.logger.warn(
          `Revocation check unavailable (${(redisErr as Error).message}) — proceeding on the database checks alone. Logged-out tokens stay valid until expiry while this persists.`,
        );
      }
      // The marker is the logout time (ST-4): a token issued at or before it —
      // or one with no iat to compare — is refused; a token issued after the
      // logout, e.g. by the next login, is not.
      if (marker != null) {
        const issuedAt = opts.tokenIssuedAt ?? null;
        if (issuedAt === null || issuedAt <= logoutRevocationCutoff(marker)) {
          return null;
        }
      }
    }

    try {
      const dbUser = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { role: true, deletedAt: true, bannedAt: true },
      });

      if (dbUser && (dbUser.deletedAt || dbUser.bannedAt)) {
        return null;
      }

      if (!dbUser && opts.requireRow) {
        return null;
      }

      // No row yet — the bootstrap case. Default role, exactly as attachRole did.
      return { role: dbUser?.role ?? 'USER' };
    } catch (lookupErr) {
      // Fail closed: without the database we cannot establish that this user is
      // still allowed to be here.
      this.logger.warn(`Local user lookup failed: ${(lookupErr as Error).message}`);
      return null;
    }
  }
}

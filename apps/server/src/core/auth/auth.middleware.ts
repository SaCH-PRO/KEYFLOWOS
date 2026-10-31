import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyAdminToken } from './admin-token.util';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

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
 *   - Logout revocation differs by token kind. A Supabase token is refused
 *     while the per-user marker `auth:revoked:user:<id>` (POST /identity/logout)
 *     is set. An admin token is revoked by its own issue-time cutoff
 *     (`admin:user:<id>:revokedAt`, POST /api/admin/auth/logout, checked in
 *     verifyAdminToken), NOT by that marker: the marker carries no issue time
 *     and only POST /identity/login clears it, so honouring it refused every
 *     token a later POST /api/admin/auth/login issued, for 24h. Making
 *     POST /identity/logout revoke admin tokens by issue time is the ST-4 fix
 *     (identity.controller.ts), outside this middleware.
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
        const localUser = await this.resolveLocalUser(user.id);
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
        // too. Its logout revocation is verifyAdminToken's issue-time cutoff,
        // not the per-user marker: see the class comment (nothing on the admin
        // login path clears that marker, so honouring it locked the admin out).
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
   *   revocation marker   -> REJECT, whether or not a row exists — checked
   *                          first, so a purged-then-revoked user cannot slip
   *                          through the absent-row branch.
   *
   * `requireRow` turns "row absent" into REJECT. The admin-token branch passes
   * it: an admin identity is only ever issued for an existing User row
   * (AdminAuthService.validateCredentials), so it has no bootstrap window, and
   * defaulting a vanished admin to USER would keep a deleted account attached.
   *
   * `honourLogoutMarker: false` skips the revocation marker. The admin-token
   * branch passes it. The marker is a per-user flag with no issue time, and only
   * POST /identity/login clears it. When the admin branch honoured it, an admin
   * who logged out through POST /identity/logout was refused on every token
   * POST /api/admin/auth/login issued afterwards, for 24h. Admin tokens are
   * revoked by issue time instead (`admin:user:<id>:revokedAt`, checked in
   * verifyAdminToken).
   */
  private async resolveLocalUser(
    userId: string,
    opts: { requireRow?: boolean; honourLogoutMarker?: boolean } = {},
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
      let revoked: string | null = null;
      try {
        revoked = await this.redis.get(`auth:revoked:user:${userId}`);
      } catch (redisErr) {
        // warn, not debug: this is a real security degradation and should be
        // visible without turning on verbose logging.
        this.logger.warn(
          `Revocation check unavailable (${(redisErr as Error).message}) — proceeding on the database checks alone. Logged-out tokens stay valid until expiry while this persists.`,
        );
      }
      if (revoked) {
        return null;
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

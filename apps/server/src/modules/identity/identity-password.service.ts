import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { LEGACY_LOGOUT_MARKER, logoutRevocationCutoff, logoutRevocationKey } from '../../core/auth/auth.middleware';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { PasswordPolicyService } from './password-policy.service';

/**
 * The amr method GoTrue stamps on a session it opened by verifying a recovery
 * link or recovery OTP (models.Recovery). auth-js types the claim as
 * JWTPayload.amr: AMREntry[] ({ method, timestamp }) or RFC-8176 string[], and
 * leaves AMRMethod open, so both shapes are read.
 */
const RECOVERY_AMR_METHOD = 'recovery';

const INVALID_RESET_LINK = 'This password reset link is invalid or has expired';

/**
 * What a reset token's (already verified) payload says about its session:
 * whether the recovery verification authenticated it, and when the session was
 * authenticated (epoch seconds) or null when the token cannot say.
 *
 * The session start follows AuthMiddleware's sessionAuthenticatedAt exactly
 * (that function is module-private there): the earliest amr timestamp, never
 * later than iat; null for a session token (session_id) whose amr is not fully
 * timestamped; iat for a token with neither. A refresh carries amr over with a
 * new iat, so a pre-logout session refreshed after the logout still reads as
 * pre-logout.
 */
function readResetSession(token: string): { recovery: boolean; authenticatedAt: number | null } {
  const none = { recovery: false, authenticatedAt: null };
  const parts = token.split('.');
  if (parts.length !== 3) return none;
  let payload: { iat?: unknown; amr?: unknown; session_id?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return none;
  }
  const amr = Array.isArray(payload?.amr) ? (payload.amr as unknown[]) : [];
  const recovery = amr.some(
    (entry) =>
      entry === RECOVERY_AMR_METHOD ||
      (typeof entry === 'object' && entry !== null && (entry as { method?: unknown }).method === RECOVERY_AMR_METHOD),
  );

  const iat = payload?.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return { recovery, authenticatedAt: null };
  if (amr.length > 0) {
    const stamps = amr.map((entry) => (entry as { timestamp?: unknown } | null)?.timestamp);
    if (stamps.every((t): t is number => typeof t === 'number' && Number.isFinite(t))) {
      return { recovery, authenticatedAt: Math.min(iat, ...stamps) };
    }
  }
  const sessionId = payload?.session_id;
  if (sessionId !== undefined && sessionId !== null && sessionId !== '') return { recovery, authenticatedAt: null };
  return { recovery, authenticatedAt: iat };
}

/**
 * Server-owned password recovery.
 *
 * The browser used to do both halves of this itself: POST to Supabase
 * `/auth/v1/recover` to request the mail, then PUT `/auth/v1/user` with the
 * recovery session to set the new password. Supabase handles that correctly,
 * so nothing was broken — but it meant recovery was the one auth flow that
 * never crossed this server, and it therefore skipped every control the others
 * have:
 *
 *   rate limiting   login, signup and resend are metered per IP and per email.
 *                   Recovery was metered only by Supabase, so address
 *                   enumeration and mail-bombing ran against their budget
 *                   rather than ours.
 *   audit           auth_audit_log records signup, login and logout. A password
 *                   change — the most security-relevant act an account has —
 *                   left no row at all.
 *   password policy signup runs PasswordPolicyService: length, composition, and
 *                   a Pwned Passwords k-anonymity lookup. Recovery ran a
 *                   12-character check IN THE BROWSER. A password rejected at
 *                   signup as breached could be set by resetting to it, and a
 *                   direct API call skipped even the length check.
 *
 * That last one is the substantive hole. A policy enforced on one door and not
 * the other is not a policy.
 */
@Injectable()
export class IdentityPasswordService {
  private readonly logger = new Logger(IdentityPasswordService.name);

  constructor(
    @Inject(SupabaseAdminService) private readonly admin: SupabaseAdminService,
    @Inject(SupabaseAuthService) private readonly auth: SupabaseAuthService,
    @Inject(PasswordPolicyService) private readonly policy: PasswordPolicyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Request a recovery email.
   *
   * ALWAYS resolves the same way, whether or not the address has an account.
   * The caller returns a fixed response built from this, so the endpoint cannot
   * be used to test whether an email is registered. That is why nothing here
   * returns a boolean and why a Supabase failure is logged rather than thrown —
   * an error response would itself be the signal.
   */
  async requestReset(email: string, redirectTo: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    try {
      await this.admin.sendRecoveryEmail(normalized, redirectTo);
    } catch (err) {
      this.logger.warn(
        `Recovery request failed for a supplied address: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Complete a recovery: verify the token, vet the password, then set it.
   *
   * `accessToken` is the session Supabase puts in the recovery link's fragment.
   * Verifying it here is what proves the caller actually received the mail —
   * without that check this endpoint would let anyone set anyone's password.
   *
   * A verified signature is not enough (R0-ID-F5: R0-ID-F4 review F4-B,
   * R0-ID-F3 review ST4-R2). Any access token verifies, so this endpoint used
   * to let a stolen ordinary session token — even a pre-logout one that
   * AuthMiddleware refuses — set a new password without the current one,
   * which is the re-authentication changePassword exists to demand. See
   * assertResetSessionAllowed: the session must be a recovery session, opened
   * after the user's last logout, of a user who is not deleted or banned.
   *
   * Order matters: the token is verified BEFORE the policy runs. Validating
   * first would let an unauthenticated caller use the endpoint as an oracle for
   * which passwords the policy accepts, and the HIBP lookup it performs is a
   * network call an anonymous caller should not be able to trigger.
   */
  async completeReset(
    accessToken: string,
    newPassword: string,
  ): Promise<{ userId: string; email: string; providerSignedOut: boolean }> {
    const user = await this.auth.getUserFromToken(accessToken);
    if (!user?.id) {
      throw new UnauthorizedException(INVALID_RESET_LINK);
    }

    await this.assertResetSessionAllowed(accessToken, user.id);

    // Same policy object signup uses. Passing the email lets it reject a
    // password that merely restates the address.
    await this.policy.validate({ password: newPassword, email: user.email ?? undefined });

    // Every session is dropped. Recovery is the flow someone uses when they
    // believe their account is compromised, so leaving the attacker's existing
    // sessions alive would defeat the point of the reset.
    //
    // auth-js admin.signOut takes the user's access JWT, not their id (CR-2,
    // R0-ID-F4): the recovery link's access token, verified above, is that JWT,
    // and 'global' revokes every session of its user, its own included.
    //
    // BEFORE the password update, not after (R0-ID-F4 review F4-A / CR-1).
    // GoTrue's admin user update with a password itself ends every session of
    // the user (UpdatePassword(tx, nil) -> Logout), the recovery session
    // included; a sign-out sent after it bears a JWT whose session is gone, is
    // refused 403 session_not_found, and would report a failed sweep on every
    // successful reset. Sent first, it revokes what is there and reports
    // whether that held. A failure is not thrown and does not stop the update
    // (the reset must still be possible with the provider's logout endpoint
    // down); it is reported, so the caller's audit row can name it.
    const providerSignedOut = await this.revokeProviderSessions(accessToken, 'global', user.id, 'Password reset');

    await this.admin.updateUserPassword(user.id, newPassword);

    return { userId: user.id, email: user.email ?? '', providerSignedOut };
  }

  /**
   * May the (already verified) reset token's session set the password? Throws
   * when not. Runs before the policy and before any provider call.
   *
   *   recovery     its amr includes 'recovery': GoTrue opened the session by
   *                verifying a recovery link. An ordinary session (password,
   *                otp, magiclink, oauth ...) is refused: holding its token is
   *                not proof of receiving the mail.
   *   logout       refused when the user's logout cutoff
   *                (auth:revoked:user:<id>, epoch seconds, R0-ID-F3) is at or
   *                after the session was authenticated, or when a cutoff exists
   *                and the token cannot say when that was — the rule
   *                AuthMiddleware applies to every other request.
   *   local user   refused when the User row is deleted or banned. No row yet
   *                (signed up, not bootstrapped) is not a revoked user, as in
   *                AuthMiddleware.
   *
   * Every refusal is the reset link's generic 401, so the endpoint does not
   * say which account state it found; the reason is logged. Unlike
   * AuthMiddleware, which proceeds on the database checks alone while Redis is
   * down rather than lock every request out, a reset FAILS CLOSED when the
   * cutoff or the row cannot be read (503): it is the act that hands the
   * account over, and it can be retried.
   */
  private async assertResetSessionAllowed(accessToken: string, userId: string): Promise<void> {
    const session = readResetSession(accessToken);
    if (!session.recovery) {
      this.logger.warn(`Password reset refused for ${userId}: the token's session is not a recovery session`);
      throw new UnauthorizedException(INVALID_RESET_LINK);
    }

    let marker: string | null;
    try {
      marker = await this.redis.get(logoutRevocationKey(userId));
    } catch (err) {
      this.logger.warn(
        `Password reset refused for ${userId}: the logout revocation marker could not be read (${err instanceof Error ? err.message : String(err)})`,
      );
      throw new ServiceUnavailableException('Password reset is temporarily unavailable. Please try again shortly.');
    }
    if (marker != null) {
      const cutoff = await this.logoutCutoff(userId, marker);
      if (session.authenticatedAt === null || session.authenticatedAt <= cutoff) {
        this.logger.warn(`Password reset refused for ${userId}: the recovery session does not post-date the user's last logout`);
        throw new UnauthorizedException(INVALID_RESET_LINK);
      }
    }

    let row: { deletedAt: Date | null; bannedAt: Date | null } | null;
    try {
      row = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true, bannedAt: true },
      });
    } catch (err) {
      this.logger.warn(
        `Password reset refused for ${userId}: the local user could not be read (${err instanceof Error ? err.message : String(err)})`,
      );
      throw new ServiceUnavailableException('Password reset is temporarily unavailable. Please try again shortly.');
    }
    if (row && (row.deletedAt || row.bannedAt)) {
      this.logger.warn(`Password reset refused for ${userId}: the local user is deleted or banned`);
      throw new UnauthorizedException(INVALID_RESET_LINK);
    }
  }

  /**
   * The cutoff a stored logout marker stands for (logoutRevocationCutoff), as
   * AuthMiddleware reads it: only the previous release's bare '1' needs the
   * key's PTTL to recover when it was written, and an unreadable PTTL makes it
   * "revoked now" (fail closed).
   */
  private async logoutCutoff(userId: string, stored: string): Promise<number> {
    if (stored !== LEGACY_LOGOUT_MARKER) return logoutRevocationCutoff(stored);
    let remainingTtlMs: number | null = null;
    try {
      remainingTtlMs = await this.redis.pttl(logoutRevocationKey(userId));
    } catch (err) {
      this.logger.warn(
        `Legacy revocation marker TTL unavailable for ${userId} (${err instanceof Error ? err.message : String(err)}) — treating it as revoked now`,
      );
    }
    return logoutRevocationCutoff(stored, Date.now(), remainingTtlMs);
  }

  /**
   * Ask Supabase to revoke sessions with the user's access JWT. Called just
   * before the password update (see completeReset). Never throws; returns
   * whether the provider confirmed it (SupabaseAdminService.signOut reports
   * failure by resolving false, and a throw is a failure too).
   */
  private async revokeProviderSessions(
    accessToken: string | null | undefined,
    scope: 'global' | 'others',
    userId: string,
    what: string,
  ): Promise<boolean> {
    if (!accessToken) {
      this.logger.warn(`${what}: no Supabase access token was presented; ${scope} sign-out not attempted for ${userId}`);
      return false;
    }
    try {
      const ok = (await this.admin.signOut(accessToken, scope)) === true;
      if (!ok) this.logger.warn(`${what}: the ${scope} sign-out failed for ${userId}`);
      return ok;
    } catch (err) {
      this.logger.warn(
        `${what}: the ${scope} sign-out failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Change the password of a signed-in user.
   *
   * WHY THE CURRENT PASSWORD IS REQUIRED even though AuthGuard already ran.
   * An access token is a bearer token: whoever holds it is the user for as long
   * as it lives. Without re-authentication, a token that leaks once — XSS, a
   * shared machine, a log line — becomes PERMANENT account takeover, because
   * the holder can set a new password and lock the owner out. Demanding the
   * current password means a stolen token alone is not enough.
   *
   * Until now the only way to change a password was to trigger a recovery
   * email, which is a poor experience for someone already signed in and, worse,
   * trains people to expect password changes to arrive by email.
   */
  async changePassword(args: {
    userId: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    /** The caller's own Supabase access token (the request's bearer): the
     *  session named by it is the one 'others' keeps. Null when the caller
     *  authenticated with something else (an admin local-auth token). */
    accessToken: string | null;
    /** Verifies the current password. Injected so this service does not depend
     *  on the signup service, which would be a cycle. */
    verifyCurrent: (email: string, password: string) => Promise<unknown>;
  }): Promise<{ providerSignedOut: boolean }> {
    if (args.currentPassword === args.newPassword) {
      throw new BadRequestException('The new password must be different from the current one');
    }

    // Re-authenticate FIRST. Running the policy before this would let a caller
    // holding only a stolen token probe which passwords are acceptable, and
    // would fire the outbound HIBP lookup on their behalf — the same ordering
    // mistake the reset flow guards against.
    try {
      await args.verifyCurrent(args.email, args.currentPassword);
    } catch {
      // Deliberately not the upstream error. Distinguishing "wrong password"
      // from "account locked" or "unverified" here tells an attacker holding a
      // session token something about the account they do not already know.
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.policy.validate({ password: args.newPassword, email: args.email });

    // 'others', NOT 'global'. A global sign-out would invalidate the session of
    // the person who just changed their password, bouncing them to the login
    // screen as a reward for good hygiene. Recovery uses 'global' because there
    // the current session is the one under suspicion; here it is the trusted one.
    // 'others' keeps the session named by the JWT auth-js admin.signOut is
    // given, so that JWT must be the caller's own access token (CR-2,
    // R0-ID-F4: the user id named no session and revoked nothing).
    //
    // BEFORE the password update, not after (R0-ID-F4 review F4-A / CR-1):
    // GoTrue's admin user update with a password ends every session of the
    // user (UpdatePassword(tx, nil) -> Logout), so a sign-out sent after it
    // bears a JWT whose session is gone, is refused 403 session_not_found, and
    // would report a failed sweep on every successful change. Note the same
    // GoTrue behaviour also ends the CALLER's session at Supabase: its current
    // access token keeps working until exp, but its refresh token does not
    // survive the update. Keeping it would need a user-scoped update (PUT /user
    // with the caller's session), which this service does not make.
    // A failed sweep is not thrown and does not stop the update; it is reported.
    const providerSignedOut = await this.revokeProviderSessions(args.accessToken, 'others', args.userId, 'Password change');

    await this.admin.updateUserPassword(args.userId, args.newPassword);
    return { providerSignedOut };
  }

  /** Reject a redirect that would send a recovery link off-site. */
  assertSafeRedirect(redirectTo: string, allowedOrigins: string[]): void {
    let url: URL;
    try {
      url = new URL(redirectTo);
    } catch {
      throw new BadRequestException('Invalid redirect target');
    }
    // An open redirect here is not cosmetic: the recovery link carries a
    // session in its fragment, so a redirect to an attacker's host hands them
    // the account.
    if (!allowedOrigins.includes(url.origin)) {
      throw new BadRequestException('Redirect target is not an allowed origin');
    }
  }
}

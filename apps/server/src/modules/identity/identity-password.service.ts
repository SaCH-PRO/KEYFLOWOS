import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import {
  LEGACY_LOGOUT_MARKER,
  LOGOUT_REVOCATION_TTL_SECONDS,
  logoutRevocationCutoff,
  logoutRevocationKey,
  logoutRevocationValue,
  recordPasswordResetAfterCutoff,
  recordSignInCutoffCleared,
  signInCutoffOf,
} from '../../core/auth/auth.middleware';
import { sessionSignedInWithGoogleOrEmailLink } from '../../core/auth/sign-in-cutoff';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { PasswordPolicyService } from './password-policy.service';

/**
 * The amr methods a recovery-link session carries. auth-js types the claim as
 * JWTPayload.amr: AMREntry[] ({ method, timestamp }) or RFC-8176 string[], and
 * leaves AMRMethod open, so both shapes are read.
 *
 *   'recovery'  PKCE flow: verifyGet issues an auth code with the flow state's
 *               method (models.Recovery), and the code exchange stamps it.
 *               Only a recovery verification produces it.
 *   'otp'       implicit flow, which is what this app ships (the admin client
 *               sets no flowType and auth-js defaults to 'implicit'; the web
 *               reads #access_token&type=recovery): verifyGet and verifyPost
 *               issue the session with issueRefreshToken(..., models.OTP, ...)
 *               (supabase/auth internal/api/verify.go). A signup-confirmation
 *               or magic-link session carries the same method, and those are
 *               the ordinary sessions the web callback keeps, so an 'otp'
 *               session is accepted only when it was opened inside the
 *               lifetime of a recovery link this server sent (see
 *               recoveryRequestKey). R0-ID-F5 review F5-CR-1.
 */
const RECOVERY_AMR_METHOD = 'recovery';
const OTP_AMR_METHOD = 'otp';

/**
 * The oldest recovery session that may set a password, from its recovery
 * authentication (the amr entry's timestamp), not its token's iat: a refresh
 * carries amr over with a new iat, so without this bound a refresh token taken
 * from a recovery-link fragment would mint reset-capable tokens until the user
 * logged out (R0-ID-F5 review F5-SEC-2). One hour is the default access-token
 * lifetime: the web posts the fragment's own access token straight away, so
 * the bound costs the real flow nothing.
 */
export const RECOVERY_SESSION_MAX_AGE_SECONDS = 60 * 60;

/** How long a recovery link stays valid at the provider (GoTrue MAILER_OTP_EXP default). */
export const RECOVERY_LINK_LIFETIME_SECONDS = 60 * 60;

/** Tolerance between this server's clock and the provider's, as verifyLocal allows for iat. */
const CLOCK_SKEW_SECONDS = 60;

/**
 * Redis key recording when this server last asked the provider to mail a
 * recovery link to an address (epoch seconds), keyed by a hash of the
 * normalised address so no address is stored in a key name. Written for every
 * request, whether or not the address has an account, so it is not an
 * enumeration signal. Kept for the link lifetime plus the session age bound,
 * the latest a session the link opened may still reset. The provider keeps one
 * recovery token per user, so a newer request supersedes an older link, and
 * only the latest request time matters.
 */
export const recoveryRequestKey = (email: string): string =>
  `auth:recovery:requested:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
const RECOVERY_REQUEST_TTL_SECONDS = RECOVERY_LINK_LIFETIME_SECONDS + RECOVERY_SESSION_MAX_AGE_SECONDS;

/**
 * Redis key claiming a recovery session for one password reset (single use,
 * R0-ID-F5 review F5-SEC-1). Keyed by the session (session_id), so a refresh of
 * the same session is the same claim. Held until the session is past the age
 * bound, after which the age check refuses it anyway.
 */
export const recoveryUseKey = (sessionKey: string): string => `auth:recovery:used:${sessionKey}`;
const RECOVERY_USE_TTL_SECONDS = RECOVERY_SESSION_MAX_AGE_SECONDS + 2 * CLOCK_SKEW_SECONDS;

const INVALID_RESET_LINK = 'This password reset link is invalid or has expired';

/** Why a reset was refused. Carried on PasswordResetRefusedException, never in the response body. */
export type PasswordResetRefusal =
  | 'not_recovery_session'
  | 'recovery_time_unknown'
  | 'recovery_session_expired'
  | 'no_recovery_request'
  | 'outside_recovery_link_window'
  | 'pre_logout_session'
  | 'user_deleted_or_banned'
  | 'recovery_session_used';

/**
 * The reset link's generic 401, carrying the verified user and the refusal
 * reason for the caller's audit row (R0-ID-F5 review F5-SEC-3). They are
 * instance fields, not part of getResponse(), so the response body the global
 * filter writes stays the one generic message for every account state.
 */
export class PasswordResetRefusedException extends UnauthorizedException {
  constructor(
    readonly userId: string,
    readonly reasonCode: PasswordResetRefusal,
  ) {
    super(INVALID_RESET_LINK);
  }
}

interface ResetSession {
  /** The recovery method the session carries ('recovery' preferred), or null. */
  method: typeof RECOVERY_AMR_METHOD | typeof OTP_AMR_METHOD | null;
  /** When that method authenticated the session (epoch seconds), or null when the token cannot say. */
  recoveredAt: number | null;
  /** When the session was authenticated, by AuthMiddleware's rule (for the logout cutoff), or null. */
  authenticatedAt: number | null;
  /** Names the session for the single-use claim: its session_id, else a hash of the token. */
  sessionKey: string;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * What a reset token's (already verified) payload says about its session.
 *
 * recoveredAt is the timestamp of the recovery method's own amr entry, so an
 * MFA step-up later in the session does not move it and a refresh (new iat)
 * does not renew it. An RFC-8176 string entry has no timestamp: then iat stands
 * in only for a token with no session_id (nothing to refresh, so its mint time
 * is its start), and otherwise it is null and the session is refused.
 *
 * authenticatedAt follows AuthMiddleware's sessionAuthenticatedAt exactly
 * (that function is module-private there): the earliest amr timestamp, never
 * later than iat; null for a session token (session_id) whose amr is not fully
 * timestamped; iat for a token with neither.
 */
function readResetSession(token: string): ResetSession {
  const tokenKey = () => `token:${createHash('sha256').update(token).digest('hex')}`;
  const none: ResetSession = { method: null, recoveredAt: null, authenticatedAt: null, sessionKey: tokenKey() };
  const parts = token.split('.');
  if (parts.length !== 3) return none;
  let payload: { iat?: unknown; amr?: unknown; session_id?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return none;
  }
  const sessionId = payload?.session_id;
  const hasSession = sessionId !== undefined && sessionId !== null && sessionId !== '';
  const sessionKey = typeof sessionId === 'string' && sessionId !== '' ? `session:${sessionId}` : tokenKey();
  const iat = isFiniteNumber(payload?.iat) ? payload.iat : null;
  const amr = Array.isArray(payload?.amr) ? (payload.amr as unknown[]) : [];

  const entries = amr.map((entry) =>
    typeof entry === 'string'
      ? { method: entry, timestamp: undefined as unknown }
      : typeof entry === 'object' && entry !== null
        ? { method: (entry as { method?: unknown }).method, timestamp: (entry as { timestamp?: unknown }).timestamp }
        : { method: undefined, timestamp: undefined as unknown },
  );
  const picked =
    entries.find((e) => e.method === RECOVERY_AMR_METHOD) ?? entries.find((e) => e.method === OTP_AMR_METHOD);
  const method = picked ? (picked.method as ResetSession['method']) : null;
  let recoveredAt: number | null = null;
  if (picked) {
    if (isFiniteNumber(picked.timestamp)) recoveredAt = picked.timestamp;
    else if (!hasSession) recoveredAt = iat;
  }

  let authenticatedAt: number | null;
  if (iat === null) authenticatedAt = null;
  else if (amr.length > 0 && entries.every((e) => isFiniteNumber(e.timestamp))) {
    authenticatedAt = Math.min(iat, ...entries.map((e) => e.timestamp as number));
  } else authenticatedAt = hasSession ? null : iat;

  return { method, recoveredAt, authenticatedAt, sessionKey };
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
    // Recorded BEFORE the mail goes out, for every address alike, so a session
    // the link opens always post-dates it (see recoveryRequestKey). A failure
    // is logged, not thrown, for the same reason a send failure is: the
    // response must not differ. Its only effect is that an implicit-flow link
    // from this request is refused and the user asks again (fail closed).
    try {
      await this.redis.setex(
        recoveryRequestKey(normalized),
        RECOVERY_REQUEST_TTL_SECONDS,
        String(Math.floor(Date.now() / 1000)),
      );
    } catch (err) {
      this.logger.warn(
        `Recovery request could not be recorded for a supplied address: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
   * assertResetSessionAllowed: the session must be a recent recovery-link
   * session, opened after the user's last logout, of a user who is not deleted
   * or banned, and not already used for a reset.
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
    const userId = user.id;
    const email = user.email ?? '';

    const session = await this.assertResetSessionAllowed(accessToken, userId, email);

    // Same policy object signup uses. Passing the email lets it reject a
    // password that merely restates the address.
    await this.policy.validate({ password: newPassword, email: user.email ?? undefined });

    // Single use (R0-ID-F5 review F5-SEC-1): claim the session atomically
    // before any provider call, so a replay, or a second submission racing
    // this one, is refused. After the policy, so a rejected password leaves
    // the link usable for a better one.
    await this.claimRecoverySession(userId, session.sessionKey);

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
    const providerSignedOut = await this.revokeProviderSessions(accessToken, 'global', userId, 'Password reset');

    try {
      await this.admin.updateUserPassword(userId, newPassword);
    } catch (err) {
      // The password did not change: release the claim so the same link can
      // be retried rather than forcing a new mail.
      await this.bestEffort(userId, 'release the recovery claim', () => this.redis.del(recoveryUseKey(session.sessionKey)));
      throw err;
    }

    // Locally, too (F5-SEC-1). The provider ends the sessions, but their access
    // tokens still verify here until they expire: the logout cutoff POST
    // /identity/logout writes makes AuthMiddleware refuse every token of a
    // session authenticated up to now, the recovery session's included, and
    // makes this check refuse the recovery token if it is presented again.
    // The request record is consumed so the same mail cannot admit another
    // session. The password is already set, so a failure here is logged, not
    // thrown; the claim above still refuses a replay.
    await this.bestEffort(userId, 'write the logout cutoff', () =>
      this.redis.setex(logoutRevocationKey(userId), LOGOUT_REVOCATION_TTL_SECONDS, logoutRevocationValue(Date.now())),
    );
    if (email) {
      await this.bestEffort(userId, 'consume the recovery request', () => this.redis.del(recoveryRequestKey(email)));
    }

    // D-113 (W10-RISC-RESET; closes D-101 review SEC-W9RPC-1 / CR-W9RPC-1):
    // after a RISC sign-in cutoff a password session stays refused until the
    // user completes a password reset through KEYFLOW after the cutoff. This
    // is that reset, so once GoTrue holds the new password (and has ended
    // every session of the user, the hijacker's pre-event one included) it is
    // recorded, under the User row lock, as passwordResetAfterCutoffAt, and the
    // recovery-link session, an emailed link, clears the rest of the
    // restriction (recordSignInCutoffCleared), as AuthMiddleware would had it
    // arrived as a bearer. Both re-read the row under the lock and write only
    // when it holds a cutoff the recovery session was authenticated after;
    // the unlocked read first spares every other reset the lock. The password
    // is already set, so a failure is logged, not thrown: password sign-ins
    // then stay refused (fail closed) and the user can reset again.
    //
    // Only for a recovery session AuthMiddleware itself would count as an
    // emailed link (sessionSignedInWithGoogleOrEmailLink, the rule
    // recordSignInCutoffCleared's callers must apply; W10-RISC-RESET review
    // SEC-W10RR-1 / CR-W10RR-1, D-113 and D-101). The reset accepts an
    // implicit-flow 'otp' session bound to a recovery request for the email,
    // and anyone can make that request; GoTrue stamps an SMS-code sign-in
    // 'otp' too, so for a user with a phone identity such a session may be a
    // text, not the mail. Recorded for it, whoever held a phone identity on
    // the account (added through the pre-event GoTrue session) would get
    // their own password, and every other method, admitted after the cutoff.
    // Such a reset still sets the password (as before D-113) but records
    // nothing: password sign-ins stay refused, and the user clears with Google
    // or a PKCE recovery link ('recovery'), which GoTrue mails only to the
    // account's address.
    await this.bestEffort(userId, 'record the password reset after the sign-in cutoff (D-113)', async () => {
      const row = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { metaData: true } });
      if (signInCutoffOf(row?.metaData) === null) return;
      if (!sessionSignedInWithGoogleOrEmailLink(accessToken)) {
        this.logger.warn(
          `D-113: password reset for ${userId} after the sign-in cutoff recorded nothing: its recovery session is not an emailed link by AuthMiddleware's rule (an implicit-flow otp of a user with a phone identity may be an SMS code); password sign-ins stay refused (SEC-W10RR-1)`,
        );
        return;
      }
      const recorded = await recordPasswordResetAfterCutoff(this.prisma.client, userId, session.authenticatedAt);
      const cleared =
        session.authenticatedAt === null
          ? 'not_after_cutoff'
          : await recordSignInCutoffCleared(this.prisma.client, userId, session.authenticatedAt);
      this.logger.log(`D-113: password reset for ${userId} after the sign-in cutoff: reset ${recorded}, clearing ${cleared}`);
    });

    return { userId, email, providerSignedOut };
  }

  /**
   * May the (already verified) reset token's session set the password? Throws
   * when not, and returns what it read when so. Runs before the policy and
   * before any provider call.
   *
   *   recovery     its amr has a recovery-link method: 'recovery' (PKCE) or
   *                'otp' (the implicit flow this app ships). An ordinary
   *                session (password, magiclink, oauth ...) is refused:
   *                holding its token is not proof of receiving the mail.
   *   age          that method authenticated the session at most
   *                RECOVERY_SESSION_MAX_AGE_SECONDS ago (F5-SEC-2); a token
   *                that cannot say when is refused.
   *   otp binding  an 'otp' session must have been opened within the lifetime
   *                of the latest recovery link this server requested for the
   *                token's email (recoveryRequestKey, F5-CR-1): the same method
   *                marks signup-confirmation and magic-link sessions, which the
   *                web keeps as ordinary sessions.
   *   logout       refused when the user's logout cutoff
   *                (auth:revoked:user:<id>, epoch seconds, R0-ID-F3) is at or
   *                after the session was authenticated, or when a cutoff exists
   *                and the token cannot say when that was — the rule
   *                AuthMiddleware applies to every other request. A completed
   *                reset writes that cutoff too.
   *   local user   refused when the User row is deleted or banned. No row yet
   *                (signed up, not bootstrapped) is not a revoked user, as in
   *                AuthMiddleware.
   *
   * Every refusal is the reset link's generic 401, so the endpoint does not
   * say which account state it found; the reason is logged and carried on the
   * exception (PasswordResetRefusedException). Unlike AuthMiddleware, which
   * proceeds on the database checks alone while Redis is down rather than lock
   * every request out, a reset FAILS CLOSED when the cutoff, the request record
   * or the row cannot be read (503): it is the act that hands the account over,
   * and it can be retried.
   */
  private async assertResetSessionAllowed(accessToken: string, userId: string, email: string): Promise<ResetSession> {
    const session = readResetSession(accessToken);
    const refuse = (reason: PasswordResetRefusal, why: string): never => {
      this.logger.warn(`Password reset refused for ${userId} (${reason}): ${why}`);
      throw new PasswordResetRefusedException(userId, reason);
    };
    if (session.method === null) return refuse('not_recovery_session', "the token's session is not a recovery-link session");
    const recoveredAt = session.recoveredAt;
    if (recoveredAt === null) return refuse('recovery_time_unknown', 'the token does not say when its recovery was verified');
    const nowS = Math.floor(Date.now() / 1000);
    if (recoveredAt > nowS + CLOCK_SKEW_SECONDS) return refuse('recovery_time_unknown', 'the recovery time is in the future');
    if (nowS - recoveredAt > RECOVERY_SESSION_MAX_AGE_SECONDS) {
      return refuse('recovery_session_expired', `the recovery was verified more than ${RECOVERY_SESSION_MAX_AGE_SECONDS}s ago`);
    }

    if (session.method === OTP_AMR_METHOD) {
      const requested = email
        ? await this.readOrFailClosed(userId, 'the recovery request record', () => this.redis.get(recoveryRequestKey(email)))
        : null;
      const requestedAt = requested != null && /^\d+$/.test(requested) ? Number(requested) : null;
      if (requestedAt === null) {
        return refuse('no_recovery_request', 'an otp session, and no recovery link was requested for its email');
      }
      if (
        recoveredAt < requestedAt - CLOCK_SKEW_SECONDS ||
        recoveredAt > requestedAt + RECOVERY_LINK_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS
      ) {
        return refuse('outside_recovery_link_window', 'an otp session not opened within the latest recovery link lifetime');
      }
    }

    const marker = await this.readOrFailClosed(userId, 'the logout revocation marker', () =>
      this.redis.get(logoutRevocationKey(userId)),
    );
    if (marker != null) {
      const cutoff = await this.logoutCutoff(userId, marker);
      if (session.authenticatedAt === null || session.authenticatedAt <= cutoff) {
        return refuse('pre_logout_session', "the recovery session does not post-date the user's last logout or reset");
      }
    }

    const row = await this.readOrFailClosed(userId, 'the local user', () =>
      this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true, bannedAt: true },
      }),
    );
    if (row && (row.deletedAt || row.bannedAt)) return refuse('user_deleted_or_banned', 'the local user is deleted or banned');
    return session;
  }

  /** A read the reset depends on: an error is a 503, never a pass (fail closed). */
  private async readOrFailClosed<T>(userId: string, what: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      this.logger.warn(
        `Password reset refused for ${userId}: ${what} could not be read (${err instanceof Error ? err.message : String(err)})`,
      );
      throw new ServiceUnavailableException('Password reset is temporarily unavailable. Please try again shortly.');
    }
  }

  /** Claim the recovery session for this reset (SET NX): taken means used, an error is a 503. */
  private async claimRecoverySession(userId: string, sessionKey: string): Promise<void> {
    let claimed: unknown;
    try {
      claimed = await this.redis.set(
        recoveryUseKey(sessionKey),
        String(Math.floor(Date.now() / 1000)),
        'EX',
        RECOVERY_USE_TTL_SECONDS,
        'NX',
      );
    } catch (err) {
      this.logger.warn(
        `Password reset refused for ${userId}: the recovery session could not be claimed (${err instanceof Error ? err.message : String(err)})`,
      );
      throw new ServiceUnavailableException('Password reset is temporarily unavailable. Please try again shortly.');
    }
    if (claimed !== 'OK') {
      this.logger.warn(`Password reset refused for ${userId} (recovery_session_used): the recovery session already reset the password`);
      throw new PasswordResetRefusedException(userId, 'recovery_session_used');
    }
  }

  /** A write after the password is set: logged on failure, never thrown. */
  private async bestEffort(userId: string, what: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (err) {
      this.logger.error(
        `Password reset for ${userId}: could not ${what} (${err instanceof Error ? err.message : String(err)})`,
      );
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

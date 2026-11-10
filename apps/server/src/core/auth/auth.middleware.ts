import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyAdminToken } from './admin-token.util';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  SIGN_IN_CUTOFF_CLEARED_META_KEY,
  sessionSignedInWithGoogleOrEmailLink,
  signInCutoffClearedAtOf,
  updateUserMetaLocked,
} from './sign-in-cutoff';

/** Redis key of the per-user logout revocation marker, written by POST /identity/logout. */
export const logoutRevocationKey = (userId: string): string => `auth:revoked:user:${userId}`;

/**
 * How long POST /identity/logout keeps the marker. It must be at least the
 * longest lifetime of a token issued before the logout, or such a token outlives
 * its revocation: Supabase access tokens live 1h by default, admin tokens 24h.
 * It is also how long a session authenticated before the logout stays refused
 * when the provider sign-out did not revoke its refresh token (CR-2): the same
 * 24h the previous release's bare flag refused it for at most.
 */
export const LOGOUT_REVOCATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Below this a stored value is not a revocation time in epoch seconds
 * (2001-09-09). The bare flag '1' the previous release wrote is the case this
 * exists for.
 */
const MIN_REVOCATION_EPOCH_S = 1_000_000_000;

/**
 * What the previous release wrote, and how: until R0-ID-F3 the only writer of
 * the marker was POST /identity/logout, with `setex(key, 86400, '1')`. So the
 * remaining TTL of a '1' still says when it was written.
 */
export const LEGACY_LOGOUT_MARKER = '1';
export const LEGACY_LOGOUT_MARKER_TTL_MS = 86_400_000;

/** The marker value POST /identity/logout writes: the revocation time, in epoch seconds. */
export function logoutRevocationValue(nowMs: number = Date.now()): string {
  return String(Math.floor(nowMs / 1000));
}

/** The revocation time a stored marker holds (epoch seconds), or null when it holds none (the legacy flag). */
function storedRevocationTime(stored: string): number | null {
  if (!/^\d+$/.test(stored)) return null;
  const at = Number(stored);
  return Number.isSafeInteger(at) && at >= MIN_REVOCATION_EPOCH_S ? at : null;
}

/**
 * The cutoff a stored marker stands for, in epoch seconds: a token whose
 * session was authenticated at or before it is refused.
 *
 * The bare flag '1' the previous release wrote carries no time. Its write time
 * is recovered from `remainingTtlMs` (the key's PTTL): it was always written
 * with a 24h TTL, so it was written 24h-minus-what-is-left ago. One second of
 * margin keeps the recovered time from landing before the real one. Reading
 * it as "revoked now" instead (R0-ID-F3 as first landed) locked out a user who
 * logged out in the 24h before the deploy: POST /identity/login answered
 * 'authenticated', every token it issued got a 401, and logout — which would
 * rewrite the marker — is behind AuthGuard (review finding F2).
 *
 * Any other value, or a '1' whose TTL is unreadable or is not a remainder of
 * 24h, is a revocation at an unknown time: its cutoff is NOW, so every token
 * issued up to this moment is refused (fail closed). The next
 * POST /identity/logout rewrites it in the new format; otherwise its TTL ends it.
 */
export function logoutRevocationCutoff(
  stored: string,
  nowMs: number = Date.now(),
  remainingTtlMs: number | null = null,
): number {
  const at = storedRevocationTime(stored);
  if (at !== null) return at;
  if (
    stored === LEGACY_LOGOUT_MARKER &&
    typeof remainingTtlMs === 'number' &&
    Number.isFinite(remainingTtlMs) &&
    remainingTtlMs > 0 &&
    remainingTtlMs <= LEGACY_LOGOUT_MARKER_TTL_MS
  ) {
    return Math.floor((nowMs - (LEGACY_LOGOUT_MARKER_TTL_MS - remainingTtlMs)) / 1000) + 1;
  }
  return Math.floor(nowMs / 1000);
}

/**
 * D-97 (W8-RISC-SIGNIN-CUTOFF; owner ruling, resolves D-39): the User.metaData
 * key holding a user's DURABLE sign-in cutoff, in epoch seconds. A Google RISC
 * session-ending event (account-disabled/hijacking, sessions-revoked,
 * tokens-revoked, token-revoked) records it (RiscService, never lowered); a
 * Supabase token whose session signed in at or before it is refused for good,
 * a refreshed one included (sessionAuthenticatedAt), and the real user signs
 * in again. Unlike the logout marker it has no TTL: GoTrue keeps the pre-event
 * refresh tokens (no provider global logout: R0-SEC-02 keeps
 * SUPABASE_JWT_SECRET empty), so a 24h cutoff would let them back in.
 *
 * D-101 (W9-RISC-PASSWORD-CUTOFF): signing in again after the cutoff means a
 * Google or emailed-link sign-in until one has cleared the restriction
 * (signInCutoffClearedAt, core/auth/sign-in-cutoff.ts). D-113
 * (W10-RISC-RESET): a password sign-in also needs a password reset completed
 * through KEYFLOW after the cutoff (passwordResetAfterCutoffAt). See
 * signInCutoffVerdict.
 */
export const SIGN_IN_CUTOFF_META_KEY = 'signInCutoffAt';

/**
 * The durable sign-in cutoff a User.metaData value holds (epoch seconds), or
 * null when it holds none. Only RiscService writes it, as a whole number; any
 * other shape is read as no cutoff rather than as a lock-out the user could
 * never sign in past.
 */
export function signInCutoffOf(metaData: unknown): number | null {
  if (!metaData || typeof metaData !== 'object' || Array.isArray(metaData)) return null;
  const at = (metaData as Record<string, unknown>)[SIGN_IN_CUTOFF_META_KEY];
  return typeof at === 'number' && Number.isSafeInteger(at) && at >= MIN_REVOCATION_EPOCH_S ? at : null;
}

/**
 * D-101 (W9-RISC-PASSWORD-CUTOFF): what recordSignInCutoffCleared found under
 * the User row lock. 'cleared' wrote the marker; 'already_cleared',
 * 'no_cutoff' and 'no_user' wrote nothing; 'not_after_cutoff' wrote nothing
 * because the cutoff (a RISC event that committed meanwhile) is at or after
 * the sign-in, which D-97 then refuses.
 */
export type SignInCutoffClearing = 'cleared' | 'already_cleared' | 'no_cutoff' | 'not_after_cutoff' | 'no_user';

/**
 * D-101 (W9-RISC-PASSWORD-CUTOFF): record that a Google or emailed-link
 * sign-in authenticated at `authenticatedAt` (epoch seconds) cleared the
 * user's sign-in cutoff (User.metaData.signInCutoffClearedAt). The caller has
 * established that the sign-in qualifies. Two callers: AuthMiddleware (a
 * qualifying bearer) and, D-113 (W10-RISC-RESET, closing D-101 review
 * SEC-W9RPC-1 / CR-W9RPC-1), IdentityPasswordService.completeReset with the
 * recovery-link session POST /identity/reset-password receives in its body,
 * never as a bearer, once the new password is set.
 *
 * The marker is dated when it is recorded (`nowMs`), or at the sign-in when
 * that is later (a provider clock ahead of this one), never at the sign-in
 * alone (D-101 review CR-W9RPC-3): a password session opened after the real
 * user's Google sign-in at GoTrue, but before that Google session first
 * reached this API, was refused while nothing had cleared the cutoff, and a
 * marker dated at the Google sign-in would admit it from then on. Dated this
 * way, every session opened before the clearing was recorded still has to be
 * a Google or emailed-link sign-in.
 *
 * Written once, under the User row lock RiscService takes for the same bag
 * (updateUserMetaLocked): the bag is read again under the lock, so a second
 * request that read no marker before the first committed finds it and writes
 * nothing, and a RISC event that committed in between is seen. A database
 * error throws.
 */
export async function recordSignInCutoffCleared(
  client: PrismaService['client'],
  userId: string,
  authenticatedAt: number,
  nowMs: number = Date.now(),
): Promise<SignInCutoffClearing> {
  let outcome: SignInCutoffClearing = 'no_user';
  const found = await updateUserMetaLocked(client, userId, (meta) => {
    const cutoff = signInCutoffOf(meta);
    if (cutoff === null) {
      outcome = 'no_cutoff';
      return null;
    }
    if (authenticatedAt <= cutoff) {
      outcome = 'not_after_cutoff';
      return null;
    }
    if (signInCutoffClearedAtOf(meta, cutoff) !== null) {
      outcome = 'already_cleared';
      return null;
    }
    outcome = 'cleared';
    return { ...meta, [SIGN_IN_CUTOFF_CLEARED_META_KEY]: Math.max(authenticatedAt, Math.floor(nowMs / 1000)) };
  });
  return found ? outcome : 'no_user';
}

/**
 * D-113 (W10-RISC-RESET; owner ruling, extends D-101: reviews SEC-W9RPC-1/2,
 * CR-W9RPC-2): the User.metaData key recording, in epoch seconds, that the
 * user completed a password reset through KEYFLOW after the sign-in cutoff
 * (IdentityPasswordService.completeReset, recordPasswordResetAfterCutoff).
 * After a cutoff a PASSWORD session is admitted only when it was
 * authenticated after this time: a Google or emailed-link sign-in clears the
 * rest of the restriction (signInCutoffClearedAt), not the password, which
 * whoever set it through the pre-event GoTrue session still knows. The
 * reset's GoTrue password update ends every session of the user, that
 * pre-event one included, so a password set during the hijack never signs in.
 * A value that is not a whole number after the current cutoff (left by an
 * earlier cutoff, or written by hand) is read as none (fail closed), so a
 * later session-ending event re-arms the requirement without removing it.
 */
export const PASSWORD_RESET_AFTER_CUTOFF_META_KEY = 'passwordResetAfterCutoffAt';

/** D-113: the reset time a User.metaData value holds for the cutoff `cutoff`, or null when it holds none. */
export function passwordResetAfterCutoffAtOf(metaData: unknown, cutoff: number): number | null {
  if (!metaData || typeof metaData !== 'object' || Array.isArray(metaData)) return null;
  const at = (metaData as Record<string, unknown>)[PASSWORD_RESET_AFTER_CUTOFF_META_KEY];
  return typeof at === 'number' && Number.isSafeInteger(at) && at > cutoff ? at : null;
}

/**
 * D-113: what recordPasswordResetAfterCutoff found under the User row lock.
 * 'recorded' wrote the time; 'no_cutoff' and 'no_user' wrote nothing;
 * 'not_after_cutoff' wrote nothing because the recovery session was not
 * authenticated after the cutoff (or cannot say when it was).
 */
export type PasswordResetAfterCutoffRecord = 'recorded' | 'no_cutoff' | 'not_after_cutoff' | 'no_user';

/**
 * D-113 (W10-RISC-RESET): record that the user completed a password reset
 * through KEYFLOW after the sign-in cutoff, with a recovery session
 * authenticated at `authenticatedAt` (epoch seconds). Called by
 * IdentityPasswordService.completeReset once GoTrue has set the new password,
 * so a password session authenticated after the recorded time signed in with
 * that password. Dated when it is recorded, or at the recovery session's
 * authentication when the provider dates that later (as the clearing is,
 * CR-W9RPC-3); never lowered. Written under the User row lock
 * (updateUserMetaLocked), so a RISC event that committed meanwhile is seen. A
 * database error throws.
 */
export async function recordPasswordResetAfterCutoff(
  client: PrismaService['client'],
  userId: string,
  authenticatedAt: number | null,
  nowMs: number = Date.now(),
): Promise<PasswordResetAfterCutoffRecord> {
  let outcome: PasswordResetAfterCutoffRecord = 'no_user';
  const found = await updateUserMetaLocked(client, userId, (meta) => {
    const cutoff = signInCutoffOf(meta);
    if (cutoff === null) {
      outcome = 'no_cutoff';
      return null;
    }
    if (authenticatedAt === null || authenticatedAt <= cutoff) {
      outcome = 'not_after_cutoff';
      return null;
    }
    const at = Math.max(authenticatedAt, Math.floor(nowMs / 1000), passwordResetAfterCutoffAtOf(meta, cutoff) ?? 0);
    outcome = 'recorded';
    return { ...meta, [PASSWORD_RESET_AFTER_CUTOFF_META_KEY]: at };
  });
  return found ? outcome : 'no_user';
}

/** GoTrue's amr method for a password sign-in (supabase/auth internal/models/factor.go). */
const PASSWORD_AMR_METHOD = 'password';

/**
 * D-113: whether a (verified) token's session may have SIGNED IN with a
 * password: its original sign-in (the entries at its earliest amr timestamp,
 * the one sessionSignedInWithGoogleOrEmailLink and sessionAuthenticatedAt
 * read; a later MFA step-up does not change it) names 'password', or its amr
 * cannot be read (no amr, a string amr, an entry without a numeric
 * timestamp), which counts as a password sign-in (fail closed).
 */
function sessionMayHaveSignedInWithPassword(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return true;
  let payload: { amr?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return true;
  }
  const amr = payload?.amr;
  if (!Array.isArray(amr) || amr.length === 0) return true;
  const entries = amr.map((entry) =>
    entry && typeof entry === 'object'
      ? { method: (entry as { method?: unknown }).method, timestamp: (entry as { timestamp?: unknown }).timestamp }
      : { method: undefined, timestamp: undefined },
  );
  if (!entries.every((e) => typeof e.timestamp === 'number' && Number.isFinite(e.timestamp))) return true;
  const signedInAt = Math.min(...entries.map((e) => e.timestamp as number));
  return entries.some((e) => e.timestamp === signedInAt && e.method === PASSWORD_AMR_METHOD);
}

/**
 * D-97 / D-101 / D-113: why a session is refused after a sign-in cutoff.
 * 'signed_in_before_cutoff' (D-97: at or before it, or it cannot say when),
 * 'password_reset_required' (D-113: a password sign-in not after a password
 * reset completed through KEYFLOW after the cutoff),
 * 'google_or_email_link_required' (D-101: any other method before a Google or
 * emailed-link sign-in cleared the rest of the restriction). POST
 * /identity/login and /identity/refresh answer it as the response code
 * (CR-W9RPC-2).
 */
export type SignInCutoffRefusal = 'signed_in_before_cutoff' | 'password_reset_required' | 'google_or_email_link_required';

/**
 * The verdict on a session after a cutoff: refused with the reason, or
 * admitted; `clearingAt` is the authentication time of a Google or
 * emailed-link session admitted while nothing has cleared the cutoff, which
 * the caller records (recordSignInCutoffCleared), else null.
 */
export type SignInCutoffVerdict =
  | { admitted: true; clearingAt: number | null }
  | { admitted: false; refusal: SignInCutoffRefusal };

/**
 * D-97, D-101 and D-113 (W10-RISC-RESET) in one place: the verdict on the
 * session behind a token (one the verifier has ALREADY accepted, or one GoTrue
 * itself just issued to this server) for a user whose User.metaData is
 * `metaData`, or null when that holds no sign-in cutoff. AuthMiddleware
 * enforces it on every request; POST /identity/login and /identity/refresh
 * name its refusal instead of answering a session the API would refuse
 * (CR-W9RPC-2).
 *
 *   signed in at or before the cutoff, or cannot say    -> refused (D-97)
 *   Google or an emailed link                          -> admitted; clears the
 *                                                         rest if nothing has
 *   a password, or a sign-in method it cannot read     -> admitted only when
 *                                                         authenticated after
 *                                                         passwordResetAfterCutoffAt
 *                                                         (D-113)
 *   any other method                                   -> admitted only when
 *                                                         authenticated after
 *                                                         signInCutoffClearedAt
 *                                                         (D-101)
 */
export function signInCutoffVerdict(metaData: unknown, token: string): SignInCutoffVerdict | null {
  const cutoff = signInCutoffOf(metaData);
  if (cutoff === null) return null;
  const authenticatedAt = sessionAuthenticatedAt(token);
  if (authenticatedAt === null || authenticatedAt <= cutoff) return { admitted: false, refusal: 'signed_in_before_cutoff' };
  const clearedAt = signInCutoffClearedAtOf(metaData, cutoff);
  if (sessionSignedInWithGoogleOrEmailLink(token)) {
    return { admitted: true, clearingAt: clearedAt === null ? authenticatedAt : null };
  }
  if (sessionMayHaveSignedInWithPassword(token)) {
    const resetAt = passwordResetAfterCutoffAtOf(metaData, cutoff);
    return resetAt !== null && authenticatedAt > resetAt
      ? { admitted: true, clearingAt: null }
      : { admitted: false, refusal: 'password_reset_required' };
  }
  return clearedAt !== null && authenticatedAt > clearedAt
    ? { admitted: true, clearingAt: null }
    : { admitted: false, refusal: 'google_or_email_link_required' };
}

/**
 * D-113 / CR-W9RPC-2: the sign-in cutoff refusal for a session GoTrue has
 * just issued to this server (POST /identity/login's password grant, POST
 * /identity/refresh's refresh grant), or null when AuthMiddleware would not
 * refuse it for the cutoff. The token came from GoTrue over this server's own
 * call, not from the client, so its subject names the User row; it is not
 * verified here. A token with no subject is judged by nothing (null). A
 * database error throws.
 */
export async function signInCutoffRefusalOfIssuedSession(
  client: PrismaService['client'],
  token: string,
): Promise<SignInCutoffRefusal | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let sub: unknown;
  try {
    sub = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: unknown } | null)?.sub;
  } catch {
    return null;
  }
  if (typeof sub !== 'string' || sub === '') return null;
  const row = await client.user.findUnique({ where: { id: sub }, select: { metaData: true } });
  const verdict = row ? signInCutoffVerdict(row.metaData, token) : null;
  return verdict && !verdict.admitted ? verdict.refusal : null;
}

/**
 * When the SESSION behind a token the verifier has ALREADY accepted was
 * authenticated, in epoch seconds — what a logout cutoff is compared against —
 * or null when the token cannot say. The payload bytes are covered by the
 * signature getUserFromToken checked (locally, or by Supabase), so the claims
 * are authentic; nothing here verifies anything.
 *
 * NOT the token's iat alone. Supabase mints a new access token, with a new iat,
 * every time the session's refresh token is used, so iat says when THIS token
 * was minted, not when its session signed in. A logout whose provider sign-out
 * left the refresh tokens alive — CR-2: SupabaseAdminService.signOut passes the
 * user id where auth-js expects the access JWT, so today it never revokes
 * anything — would be undone by the next refresh, on another device or by
 * whoever holds a stolen refresh token, with no login in between (review
 * findings ST4-R1, F1).
 *
 * GoTrue stamps a session's access tokens with `amr`: one { method, timestamp }
 * entry per way the session was authenticated (password, otp, oauth, totp ...),
 * and a refresh carries them over unchanged. The earliest is when the session
 * began.
 *
 *   amr, every entry timestamped    -> min(iat, ...timestamps)
 *   a session_id but no usable amr  -> null: a refreshable session that does
 *                                      not say when it began. Refused while a
 *                                      marker exists (fail closed).
 *   neither                         -> iat: there is no session behind it to
 *                                      refresh, so its mint time is its start.
 *   no numeric iat                  -> null
 */
function sessionAuthenticatedAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let payload: { iat?: unknown; amr?: unknown; session_id?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return null;
  }
  const iat = payload?.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  const amr = payload?.amr;
  if (Array.isArray(amr) && amr.length > 0) {
    const stamps = amr.map((entry) => (entry as { timestamp?: unknown } | null)?.timestamp);
    if (stamps.every((t): t is number => typeof t === 'number' && Number.isFinite(t))) {
      return Math.min(iat, ...stamps);
    }
  }
  const sessionId = payload?.session_id;
  if (sessionId !== undefined && sessionId !== null && sessionId !== '') return null;
  return iat;
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
 *   - Logout revocation is a time cutoff for both token kinds, each in its own
 *     key. A Supabase token is refused when the per-user marker
 *     `auth:revoked:user:<id>` (POST /identity/logout) holds a revocation time
 *     at or after the moment the token's SESSION was authenticated (its amr
 *     timestamps, see sessionAuthenticatedAt — not its iat, which a refresh
 *     renews), or when the token cannot say when that was; a token of a session
 *     authenticated after the logout is attached. POST /identity/login no longer
 *     deletes the marker (ST-4, R0-ID-F3-REVOCATION-IAT-CUTOFF: deleting it
 *     re-admitted every pre-logout token, a stolen one included). An admin
 *     token is revoked by its own cutoff (`admin:user:<id>:revokedAt`, in the
 *     admin token's milliseconds, checked in verifyAdminToken), which
 *     POST /api/admin/auth/logout and POST /identity/logout both write — NOT by
 *     the Supabase marker, whose seconds-granularity cutoff would refuse an
 *     admin login made in the same second as the logout.
 *   - D-97 (W8-RISC-SIGNIN-CUTOFF): a Supabase token is also refused when the
 *     User row holds a durable sign-in cutoff (User.metaData.signInCutoffAt,
 *     written by a Google RISC session-ending event) at or after the moment
 *     its session was authenticated, or when the token cannot say when that
 *     was. It has no TTL, so a pre-event session stays refused after the 24h
 *     marker lapses, however often its refresh token is used.
 *   - D-101 (W9-RISC-PASSWORD-CUTOFF): after that cutoff a session is admitted
 *     only when it signed in with Google or an emailed link, until one such
 *     session has cleared the restriction (User.metaData.signInCutoffClearedAt,
 *     which this middleware writes once under the User row lock, dated when
 *     it records it or at that session's sign-in if later: CR-W9RPC-3); then
 *     a session of another method authenticated after the clearing is
 *     admitted. D-113 (W10-RISC-RESET, closing SEC-W9RPC-2): a PASSWORD
 *     session opened after the cutoff, by whoever knows (or, through the
 *     pre-event GoTrue session, set) the password, is refused until the user
 *     completes a password reset through KEYFLOW after the cutoff
 *     (User.metaData.passwordResetAfterCutoffAt, which
 *     IdentityPasswordService.completeReset records under the same lock), the
 *     clearing notwithstanding; one authenticated after the reset is admitted.
 *     signInCutoffVerdict holds the rule; POST /identity/login and /refresh
 *     name its refusal (CR-W9RPC-2).
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
        const localUser = await this.resolveLocalUser(user.id, {
          sessionAuthenticatedAt: sessionAuthenticatedAt(token),
          // D-97 / D-101 / D-113: judged only when the row holds a sign-in cutoff.
          supabaseToken: token,
        });
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
   *   sign-in cutoff      -> (D-97, Supabase tokens only) REJECT a token whose
   *                          session was authenticated at or before the row's
   *                          durable RISC cutoff (User.metaData.signInCutoffAt),
   *                          or that cannot say when. D-101: a session
   *                          authenticated after it is admitted only when it
   *                          signed in with Google or an emailed link
   *                          (`opts.signedInWithGoogleOrEmailLink`), and the
   *                          first such session records the clearing
   *                          (signInCutoffClearedAt, dated when recorded:
   *                          CR-W9RPC-3); after the clearing, a session of
   *                          another method authenticated later is admitted.
   *                          D-113: a password session only once authenticated
   *                          after passwordResetAfterCutoffAt (a reset through
   *                          KEYFLOW after the cutoff). signInCutoffVerdict.
   *   revocation marker   -> REJECT a token whose session was authenticated at
   *                          or before the marker's revocation time
   *                          (`opts.sessionAuthenticatedAt`, or null: it cannot
   *                          say), whether or not a row exists — checked
   *                          first, so a purged-then-revoked user cannot slip
   *                          through the absent-row branch. A token of a session
   *                          authenticated after the logout goes on to the row
   *                          checks.
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
   * `sessionAuthenticatedAt` is when the Supabase token's session was
   * authenticated (epoch seconds, sessionAuthenticatedAt), null when the token
   * cannot say. It only matters when a marker exists.
   */
  private async resolveLocalUser(
    userId: string,
    opts: {
      requireRow?: boolean;
      honourLogoutMarker?: boolean;
      sessionAuthenticatedAt?: number | null;
      /** The Supabase token itself, judged by signInCutoffVerdict when the row holds a cutoff. */
      supabaseToken?: string;
    } = {},
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
      // The marker is the logout time (ST-4): a token whose session was
      // authenticated at or before it — including one minted after the logout
      // by refreshing that session — or one that cannot say when its session
      // was authenticated is refused; a token of a later session, e.g. the next
      // login's, is not.
      if (marker != null) {
        const authenticatedAt = opts.sessionAuthenticatedAt ?? null;
        if (authenticatedAt === null || authenticatedAt <= (await this.logoutCutoff(userId, marker))) {
          return null;
        }
      }
    }

    try {
      // D-97: the Supabase branch also reads metaData, where a RISC event
      // records the user's durable sign-in cutoff. The admin-token branch does
      // not: an admin token cannot be refreshed and lives 24h, the TTL of its
      // own admin:user:<id>:revokedAt cutoff, which the same event writes.
      const dbUser: { role: string; deletedAt: Date | null; bannedAt: Date | null; metaData?: unknown } | null =
        await this.prisma.client.user.findUnique({
          where: { id: userId },
          select: honourLogoutMarker
            ? { role: true, deletedAt: true, bannedAt: true, metaData: true }
            : { role: true, deletedAt: true, bannedAt: true },
        });

      if (dbUser && (dbUser.deletedAt || dbUser.bannedAt)) {
        return null;
      }

      // D-97: a session that signed in at or before the durable cutoff is
      // refused, whatever its iat (a refresh renews iat, not amr), and so is a
      // session token that cannot say when it signed in (fail closed, as for
      // the logout marker). A session opened after the cutoff is judged by how
      // it signed in (signInCutoffVerdict):
      //   D-101 (W9-RISC-PASSWORD-CUTOFF): a Google or emailed-link sign-in is
      //   admitted, and the first one clears the rest of the restriction; any
      //   other method is admitted only when authenticated after that clearing.
      //   D-113 (W10-RISC-RESET): a PASSWORD sign-in (or one whose method
      //   cannot be read: fail closed) is admitted only when authenticated
      //   after a password reset the user completed through KEYFLOW after the
      //   cutoff (passwordResetAfterCutoffAt), clearing or not, so a password
      //   set during the hijack never signs in.
      // A Supabase-branch caller with no token to judge is refused while a
      // cutoff exists ('' cannot say when it signed in).
      const verdict = honourLogoutMarker && dbUser ? signInCutoffVerdict(dbUser.metaData, opts.supabaseToken ?? '') : null;
      if (verdict !== null) {
        if (!verdict.admitted) {
          return null;
        }
        if (verdict.clearingAt !== null && !(await this.clearSignInCutoff(userId, verdict.clearingAt))) {
          return null;
        }
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

  /**
   * D-101 (W9-RISC-PASSWORD-CUTOFF): record, through recordSignInCutoffCleared
   * (once, under the User row lock, dated when it is recorded: CR-W9RPC-3),
   * that a Google or emailed-link session authenticated at `authenticatedAt`
   * cleared the user's sign-in cutoff. Only a qualifying token reaches here,
   * and only while the row holds no clearing for its cutoff.
   *
   * When a RISC event that committed meanwhile raised the cutoff to or past
   * this session, nothing is written and the session is refused (false), as
   * D-97 would refuse it. Otherwise returns true: the session is admitted by
   * the rule, whether or not the write held. A failed write is logged and the
   * next qualifying request retries it; until it holds, a session that is not
   * a Google or emailed-link sign-in stays refused.
   */
  private async clearSignInCutoff(userId: string, authenticatedAt: number): Promise<boolean> {
    let outcome: SignInCutoffClearing;
    try {
      outcome = await recordSignInCutoffCleared(this.prisma.client, userId, authenticatedAt);
    } catch (err) {
      this.logger.warn(
        `D-101: sign-in cutoff clearing for ${userId} not recorded (${(err as Error).message}); the session is admitted and the next request retries`,
      );
      return true;
    }
    if (outcome === 'cleared') {
      this.logger.log(`D-101: sign-in cutoff cleared for ${userId} by a Google or emailed-link sign-in at ${authenticatedAt}`);
    }
    return outcome !== 'not_after_cutoff';
  }

  /**
   * The cutoff a stored marker stands for (logoutRevocationCutoff). Only the
   * previous release's bare flag needs the key's PTTL to recover when it was
   * written; when that read fails the flag reads as "revoked now" (fail
   * closed). `now` is taken after the PTTL answer, so the recovered write time
   * is never earlier than the real one.
   */
  private async logoutCutoff(userId: string, stored: string): Promise<number> {
    if (stored !== LEGACY_LOGOUT_MARKER) return logoutRevocationCutoff(stored);
    let remainingTtlMs: number | null = null;
    try {
      remainingTtlMs = await this.redis.pttl(logoutRevocationKey(userId));
    } catch (redisErr) {
      this.logger.warn(
        `Legacy revocation marker TTL unavailable (${(redisErr as Error).message}) — treating it as revoked now.`,
      );
    }
    return logoutRevocationCutoff(stored, Date.now(), remainingTtlMs);
  }
}

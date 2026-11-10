import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * D-101 (W9-RISC-PASSWORD-CUTOFF; owner ruling, narrows D-97 review
 * SEC-W8RSC-4): after a D-97 sign-in cutoff (User.metaData.signInCutoffAt,
 * written by RiscService on a session-ending RISC event) the account accepts
 * only a NEW sign-in made with Google or an emailed link, methods an attacker
 * cannot produce from a stolen refresh token or a password they know or set.
 * The first such session after the cutoff CLEARS the restriction: AuthMiddleware
 * records the clearing here (epoch seconds), once, under the User row lock,
 * dated when it is recorded or at that session's sign-in if later (review
 * CR-W9RPC-3, recordSignInCutoffCleared in auth.middleware.ts). From then on
 * a session authenticated after this time is admitted by any method; one
 * authenticated between the cutoff and this time is admitted only when it is
 * itself a Google or emailed-link sign-in. A later session-ending event
 * removes it with the new cutoff (RiscService), so the restriction holds
 * again. After the clearing a password the hijacker set through the pre-event
 * GoTrue session works again: D-101 narrows SEC-W8RSC-4, it does not close it
 * (review SEC-W9RPC-2, docs/auth-pathway.md).
 */
export const SIGN_IN_CUTOFF_CLEARED_META_KEY = 'signInCutoffClearedAt';

/**
 * The clearing time a User.metaData value holds for the cutoff `cutoff`, or
 * null when it holds none. A value that is not a whole number after the cutoff
 * belongs to no sign-in after it (a marker left by an earlier cutoff, or one
 * written by hand) and is read as none: the restriction holds (fail closed).
 */
export function signInCutoffClearedAtOf(metaData: unknown, cutoff: number): number | null {
  if (!metaData || typeof metaData !== 'object' || Array.isArray(metaData)) return null;
  const at = (metaData as Record<string, unknown>)[SIGN_IN_CUTOFF_CLEARED_META_KEY];
  return typeof at === 'number' && Number.isSafeInteger(at) && at > cutoff ? at : null;
}

/**
 * GoTrue's amr method for an OAuth sign-in (supabase/auth
 * internal/models/factor.go). Its entry never names the provider (GoTrue sets
 * `provider` on an entry only for sso/saml), so the provider is read from the
 * token's server-set app_metadata: see namesGoogleOnly.
 */
const OAUTH_AMR_METHOD = 'oauth';

/**
 * GoTrue's method for the implicit flow's verification of an emailed link or
 * code: verifyGet and verifyPost issue every session with models.OTP (signup,
 * invite, magic link, recovery, email OTP, email change), and the same for an
 * SMS code (sms, phone_change). So it is an emailed link only for a user with
 * no phone identity: see emailOtpOnly.
 */
const OTP_AMR_METHOD = 'otp';

/**
 * GoTrue's methods for the PKCE flow's emailed links: the auth code carries
 * the verification type (models.ParseAuthenticationMethod). A password-recovery
 * link counts: GoTrue sends it only to the account's email, and marks its
 * session 'recovery' here or 'otp' in the implicit flow, the same as a magic
 * link. 'email_change' does not: its link goes to the NEW address, which may
 * be the attacker's.
 *
 * Only a session presented to this API as a bearer is judged here. The shipped
 * password reset posts its recovery session in the BODY of POST
 * /identity/reset-password (apps/web reset-password page) and completeReset
 * records no clearing, so today a reset clears nothing and the password
 * sign-in that follows stays refused (D-101 review SEC-W9RPC-1 / CR-W9RPC-1,
 * outside W9-RISC-PASSWORD-CUTOFF's write set: the follow-up calls
 * recordSignInCutoffCleared from completeReset; see docs/auth-pathway.md).
 */
const EMAILED_LINK_AMR_METHODS: ReadonlySet<string> = new Set(['magiclink', 'email/signup', 'recovery', 'invite']);

/** Providers GoTrue lists in app_metadata that are not an external (OAuth/SSO) identity. */
const NON_EXTERNAL_PROVIDERS: ReadonlySet<string> = new Set(['email', 'phone']);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The providers GoTrue's server-set app_metadata names (provider and providers), or null when it is not an object. */
function providersNamed(appMetadata: unknown): string[] | null {
  if (!appMetadata || typeof appMetadata !== 'object' || Array.isArray(appMetadata)) return null;
  const meta = appMetadata as { provider?: unknown; providers?: unknown };
  const named = [...(Array.isArray(meta.providers) ? meta.providers : []), meta.provider];
  return named.filter((p): p is string => typeof p === 'string' && p !== '');
}

/**
 * Whether an 'oauth' sign-in was Google's: the user's only external identity,
 * by GoTrue's app_metadata, is Google. A user with another OAuth identity too
 * cannot say which one signed in, and is refused (fail closed); the emailed
 * link still clears the restriction for that user.
 */
function namesGoogleOnly(appMetadata: unknown): boolean {
  const named = providersNamed(appMetadata);
  if (named === null) return false;
  const external = named.filter((p) => !NON_EXTERNAL_PROVIDERS.has(p));
  return external.length > 0 && external.every((p) => p === 'google');
}

/** Whether an 'otp' sign-in was an emailed one: the user has no phone identity GoTrue could have texted a code to. */
function emailOtpOnly(appMetadata: unknown): boolean {
  const named = providersNamed(appMetadata);
  return named !== null && !named.includes('phone');
}

/**
 * D-101: whether the token (one the verifier has ALREADY accepted, so its
 * claims are authentic) belongs to a session that SIGNED IN with Google or an
 * emailed link, the only sign-ins that clear a sign-in cutoff.
 *
 * The session's original sign-in is its earliest amr entry, the entry D-97's
 * sessionAuthenticatedAt dates it by; a later MFA step-up (totp, mfa/phone)
 * does not change how it signed in. Every entry at that earliest time must
 * qualify. Anything else is refused (fail closed): no amr, an RFC-8176 string
 * amr (no timestamps), an entry without a numeric timestamp, a method not in
 * the allow list (password, totp, sso/saml, anonymous, web3, passkey,
 * token_refresh, email_change, or one GoTrue adds later), an 'oauth' sign-in
 * that cannot be shown to be Google, or an 'otp' one that may have been a text.
 */
export function sessionSignedInWithGoogleOrEmailLink(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  let payload: { amr?: unknown; app_metadata?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return false;
  }
  const amr = payload?.amr;
  if (!Array.isArray(amr) || amr.length === 0) return false;
  const entries: Array<{ method: unknown; timestamp: unknown; provider: unknown }> = amr.map((entry) =>
    entry && typeof entry === 'object'
      ? {
          method: (entry as { method?: unknown }).method,
          timestamp: (entry as { timestamp?: unknown }).timestamp,
          provider: (entry as { provider?: unknown }).provider,
        }
      : { method: undefined, timestamp: undefined, provider: undefined },
  );
  if (!entries.every((e) => isFiniteNumber(e.timestamp))) return false;
  const signedInAt = Math.min(...entries.map((e) => e.timestamp as number));
  const original = entries.filter((e) => e.timestamp === signedInAt);
  const appMetadata = payload?.app_metadata;
  return original.every((e) => {
    if (e.method === OAUTH_AMR_METHOD) {
      return (e.provider === undefined || e.provider === 'google') && namesGoogleOnly(appMetadata);
    }
    if (e.method === OTP_AMR_METHOD) return emailOtpOnly(appMetadata);
    return typeof e.method === 'string' && EMAILED_LINK_AMR_METHODS.has(e.method);
  });
}

/**
 * The one door through which the server changes User.metaData after the row
 * is created: RiscService (the D-97 cutoff, the googleSignInDisabled flag) and,
 * D-101, AuthMiddleware (the cleared marker). Each reads the bag, changes its
 * own key and writes the whole bag back; unlocked, two writers for the same
 * user both read the same bag and the last one erased the other's key (D-97
 * review SEC-W8RSC-1 / CR-W8RSC-1). So, as lockBusinessMeta does for
 * Business.metaData (core/prisma/business-meta.ts), the read and the write run
 * in one transaction that first takes the row lock (SELECT ... FOR NO KEY
 * UPDATE, the lock the UPDATE takes anyway; it does not block inserts that
 * reference the user): a concurrent writer waits for this one to commit and
 * then reads its result. The lock is held for three statements.
 *
 * `change` gets the stored bag (a plain object; anything else reads as {}) and
 * returns the bag to write, or null to write nothing. Returns false when there
 * is no such user (nothing is written then); a database error throws.
 */
export async function updateUserMetaLocked(
  client: PrismaService['client'],
  userId: string,
  change: (meta: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { metaData: true } });
    if (!user) return false;
    const raw = user.metaData;
    const meta = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const next = change(meta);
    if (next) {
      await tx.user.update({ where: { id: userId }, data: { metaData: next as Prisma.InputJsonValue } });
    }
    return true;
  });
}

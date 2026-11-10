import { Inject, Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { createPublicKey, KeyObject } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { jwtVerify } from 'jose';
import { Redis } from 'ioredis';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import {
  LOGOUT_REVOCATION_TTL_SECONDS,
  logoutRevocationKey,
  logoutRevocationValue,
  SIGN_IN_CUTOFF_META_KEY,
  signInCutoffOf,
} from '../../core/auth/auth.middleware';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { AuthSecurityService } from '../identity/auth-security.service';
import {
  RiscDiscoveryDocument,
  RiscEventPayload,
  RiscSubject,
  RISC_DISABLED_REASON,
  RISC_EVENT_TYPES,
} from './risc.types';

const RISC_CONFIG_URL = 'https://accounts.google.com/.well-known/risc-configuration';

/**
 * How long an account-disabled/hijacking RISC event bans the user at Supabase,
 * in seconds. No other event bans (R0-ID-F7 review F7-CR-1): Google also sends
 * sessions-revoked, tokens-revoked and token-revoked for ordinary account
 * actions, and a ban refuses the user's own sign-in by every method (password,
 * OAuth, refresh) while it lasts.
 *
 * A RISC event carries no user JWT, and the installed auth-js (2.94.0) admin
 * API has no call that ends sessions by user id: admin.signOut(jwt, scope)
 * takes the user's ACCESS JWT as the bearer of POST /logout (handing it the
 * user id is the CR-2 defect), and there is no admin sessions API. The call it
 * has that takes a user id is admin.updateUserById, whose
 * AdminUserAttributes.ban_duration bans the user for a Go duration.
 *
 * The ban PAUSES the provider sessions; it does not revoke them (F7-SEC-2).
 * GoTrue refuses a refresh while the user is banned but keeps the refresh
 * token, and a ban does not log the user out. So once the ban lapsed a
 * pre-event refresh token (the hijacker's) worked at Supabase again, and, once
 * the 24h local cutoff lapsed too, at this API. D-97 (W8-RISC-SIGNIN-CUTOFF;
 * owner ruling, resolves D-39) closes that at this API: every session-ending
 * event records a DURABLE sign-in cutoff on the User row
 * (recordSignInCutoff), and AuthMiddleware refuses every token of a session
 * that signed in at or before it, a refreshed one included, for good; the real
 * user signs in again. The provider global logout W7-RISC-REVOKE added (a
 * POST /logout under a user JWT minted with SUPABASE_JWT_SECRET) is not used:
 * R0-SEC-02 keeps that secret empty.
 *
 * Long enough that every live client meets it: a default Supabase access token
 * lives 1h, so a client holding one issued just before the event must refresh
 * within the ban, is refused, and auth-js drops that session. Not longer than
 * that plus a margin: the legitimate user is locked out of sign-in too, and the
 * local cutoff already lets a session authenticated after the event through. A
 * longer lock is the operator's (the Supabase dashboard ban), and this handler
 * never shortens one (F7-SEC-1, see banAtProvider).
 */
const RISC_PROVIDER_BAN_SECONDS = 60 * 60 + 5 * 60;

/**
 * A revocation leg of a session-ending event that can fail, named as
 * POST /identity/logout names its legs in the audit reason.
 */
type RevocationLeg = 'revocation_marker' | 'admin_cutoff' | 'signin_cutoff' | 'local_sessions' | 'provider_ban';

/** Whether handleEvent ends the user's sessions (terminateUserSessions) for this event. */
function endsSessions(eventType: string, reason: string | undefined): boolean {
  return (
    eventType === RISC_EVENT_TYPES.SESSIONS_REVOKED ||
    eventType === RISC_EVENT_TYPES.TOKENS_REVOKED ||
    eventType === RISC_EVENT_TYPES.TOKEN_REVOKED ||
    (eventType === RISC_EVENT_TYPES.ACCOUNT_DISABLED && reason === RISC_DISABLED_REASON.HIJACKING)
  );
}

/**
 * D-97 review SEC-W8RSC-2: whether a stored RiscEvent.actionTaken names the
 * durable sign-in cutoff among the legs that did not hold. Such a delivery was
 * answered 503, so its redelivery is processed again, not deduplicated.
 */
function signInCutoffIncomplete(actionTaken: string | null | undefined): boolean {
  const legs = typeof actionTaken === 'string' ? actionTaken.split(':revocation_incomplete:')[1] : undefined;
  return legs !== undefined && legs.split(',').includes('signin_cutoff');
}

interface HandledEvent {
  /** What the event did; persisted on RiscEvent.actionTaken. */
  action: string;
  /** Every revocation leg that did not hold, in the order they ran. */
  failed: RevocationLeg[];
  /**
   * D-97 review SEC-W8RSC-2: the durable sign-in cutoff was not recorded
   * because the write failed (not because the user row is gone), so a
   * redelivery of the event can still record it: answer 503.
   */
  redeliver: boolean;
}

/** What terminateUserSessions reports: the legs that did not hold, and whether a redelivery can repair them. */
type RevocationOutcome = Pick<HandledEvent, 'failed' | 'redeliver'>;

type VerificationKey = KeyObject | CryptoKey;

interface CachedJwks {
  keys: Map<string, VerificationKey>;
  fetchedAt: number;
}

interface CachedDiscovery {
  document: RiscDiscoveryDocument;
  fetchedAt: number;
}

@Injectable()
export class RiscService {
  private readonly logger = new Logger(RiscService.name);
  private discoveryCache: CachedDiscovery | null = null;
  private jwksCache: CachedJwks | null = null;
  private readonly cacheTtlMs = 5 * 60_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupabaseAdminService) private readonly supabaseAdmin: SupabaseAdminService,
    @Inject(AuthSecurityService) private readonly authSecurity: AuthSecurityService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    // Listen for true user deletion events so RISC security logs are erased
    // automatically as part of GDPR right-to-erasure flows.
    this.events.on('user.deleted', async (payload: { userId: string }) => {
      if (!payload?.userId) return;
      try {
        await this.eraseForUser(payload.userId);
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to erase RISC events for deleted user ${payload.userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /**
   * Receive, validate, deduplicate, and act on a Google RISC security event token.
   *
   * Returns HTTP status guidance: 202 for accepted (valid, possibly duplicate),
   * 400 for malformed or unverifiable tokens. Throws ServiceUnavailableException
   * (503) when a session-ending event's durable sign-in cutoff was not recorded
   * (D-97 review SEC-W8RSC-2), so that Google delivers it again.
   */
  async receiveEvent(token: string): Promise<{ status: 202 | 400; processed: boolean }> {
    let payload: RiscEventPayload;
    try {
      payload = await this.validateToken(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`RISC token validation failed: ${message}`);
      return { status: 400, processed: false };
    }

    const eventType = Object.keys(payload.events)[0];
    const eventDetails = payload.events[eventType];
    const subject = eventDetails?.subject;
    if (!eventType || !subject?.sub) {
      this.logger.warn('RISC token missing event type or subject.sub');
      return { status: 400, processed: false };
    }

    // Idempotency: RISC may redeliver events. Accept duplicates with 202 —
    // except a delivery whose durable sign-in cutoff did not hold (D-97 review
    // SEC-W8RSC-2): that one was answered 503 so that Google delivers it again,
    // and the redelivery is processed again rather than dropped as a duplicate.
    const existing = await this.prisma.client.riscEvent.findUnique({
      where: { jti: payload.jti },
    });
    if (existing && !signInCutoffIncomplete(existing.actionTaken)) {
      this.logger.debug(`RISC event ${payload.jti} already processed; accepting duplicate`);
      return { status: 202, processed: false };
    }

    const userId = await this.resolveUser(subject);
    if (!userId && endsSessions(eventType, eventDetails?.reason)) {
      // D-97 review SEC-W8RSC-3 (a documented residual, docs/auth-pathway.md):
      // a Google sub with no UserIdentity row ends nobody's session. Since
      // W8-RISC-SIGNIN-CUTOFF bootstrap writes that row at every Google
      // sign-in, but an account last signed in before then has none until its
      // owner signs in again; named here so the operator can find the account
      // in GoTrue and act on it by hand.
      this.logger.warn(
        `SECURITY: RISC ${eventType} for Google sub ${subject.sub} matched no user (no UserIdentity row); no session was ended`,
      );
    }
    const { action, failed, redeliver } = await this.handleEvent(eventType, eventDetails, userId);
    // A revocation that did not fully happen is not recorded as one that did
    // (R0-ID-F7 review F7-SEC-3): every failed leg is named on the row and in
    // the audit, as POST /identity/logout names its failed legs.
    const actionTaken = failed.length > 0 ? `${action}:revocation_incomplete:${failed.join(',')}` : action;
    // D-97 review SEC-W8RSC-2: the durable sign-in cutoff is the one leg that
    // nothing else makes up for (the Redis cutoffs lapse after 24h, the ban
    // after 65 minutes), so when its write failed (`redeliver`) the event is
    // not answered as handled: the row and the audit name the failed leg, and
    // the 503 below asks Google to deliver the event again, which then runs
    // every leg again (each is idempotent; the cutoff is never lowered). A
    // user row that is gone is named too but answered 202: no redelivery can
    // write a cutoff on it.

    const record = {
      eventType,
      providerSubject: subject.sub,
      userId,
      actionTaken,
      payload: {
        reason: eventDetails?.reason ?? null,
        state: eventDetails?.state ?? null,
      },
      processedAt: new Date(),
    };
    await (existing
      ? this.prisma.client.riscEvent.update({ where: { jti: payload.jti }, data: record })
      : this.prisma.client.riscEvent.create({ data: { jti: payload.jti, ...record } })
    ).catch((err: unknown) => {
      // Logging failure must not return 500 to Google; the event was handled.
      this.logger.warn(`Failed to persist RISC event ${payload.jti}: ${err instanceof Error ? err.message : String(err)}`);
    });

    await this.authSecurity
      .audit({
        event: 'login_failure',
        // As for POST /identity/logout: 'success' means the server-side
        // revocation (the logout cutoff and, D-97, the durable sign-in cutoff)
        // holds, when the event writes one; the reason names every leg that
        // did not.
        outcome: failed.includes('revocation_marker') || failed.includes('signin_cutoff') ? 'error' : 'success',
        userId: userId ?? undefined,
        reason: failed.length > 0 ? `risc:${eventType}; revocation_incomplete: ${failed.join(', ')}` : `risc:${eventType}`,
        metadata: {
          jti: payload.jti,
          providerSubject: subject.sub,
          actionTaken,
          eventReason: eventDetails?.reason ?? null,
          ...(failed.length > 0 ? { revocationIncomplete: failed } : {}),
          ...(redeliver ? { redeliveryRequested: true } : {}),
          ...(existing ? { redelivery: true } : {}),
        },
      })
      .catch(() => undefined);

    if (redeliver) {
      // Not a 2xx: a push transmitter delivers again what was not accepted
      // (RFC 8935). RiscController lets the exception through as 503.
      throw new ServiceUnavailableException('RISC event not fully applied; deliver it again');
    }
    return { status: 202, processed: true };
  }

  /**
   * Validate a RISC security event token per Google spec:
   *   - Fetch discovery document and signing keys from Google.
   *   - Verify signature with the key matching the JWT `kid`.
   *   - Verify `aud` is one of our configured Google client IDs.
   *   - Verify `iss` matches the discovery document issuer.
   *   - Do NOT verify `exp` (RISC tokens represent historical events).
   */
  private async validateToken(token: string): Promise<RiscEventPayload> {
    const discovery = await this.getDiscoveryDocument();
    const jwks = await this.getJwks(discovery.jwks_uri);

    const unprotectedHeader = this.unsafeDecodeHeader(token);
    const kid = unprotectedHeader?.kid;
    if (!kid) {
      throw new Error('RISC token missing kid header');
    }

    const publicKey = jwks.keys.get(kid);
    if (!publicKey) {
      throw new Error(`RISC signing key ${kid} not found`);
    }

    const allowedAudiences = this.allowedAudiences();
    if (allowedAudiences.length === 0) {
      throw new Error('RISC validation misconfigured: no GOOGLE_CLIENT_ID(s) set');
    }

    const { payload } = await jwtVerify(token, publicKey, {
      issuer: discovery.issuer,
      audience: allowedAudiences,
      clockTolerance: Number.MAX_SAFE_INTEGER, // Don't verify exp.
    });

    if (!payload.jti || typeof payload.jti !== 'string') {
      throw new Error('RISC token missing jti claim');
    }

    const events = payload.events;
    if (!events || typeof events !== 'object' || Array.isArray(events)) {
      throw new Error('RISC token missing events claim');
    }

    return payload as unknown as RiscEventPayload;
  }

  private async getDiscoveryDocument(): Promise<RiscDiscoveryDocument> {
    if (this.discoveryCache && Date.now() - this.discoveryCache.fetchedAt < this.cacheTtlMs) {
      return this.discoveryCache.document;
    }

    const res = await fetch(RISC_CONFIG_URL);
    if (!res.ok) {
      throw new Error(`RISC discovery request failed: ${res.status}`);
    }
    const document = (await res.json()) as RiscDiscoveryDocument;
    if (!document.issuer || !document.jwks_uri) {
      throw new Error('RISC discovery document missing issuer or jwks_uri');
    }
    this.discoveryCache = { document, fetchedAt: Date.now() };
    return document;
  }

  private async getJwks(uri: string): Promise<CachedJwks> {
    if (this.jwksCache && Date.now() - this.jwksCache.fetchedAt < this.cacheTtlMs) {
      return this.jwksCache;
    }

    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error(`Google certs request failed: ${res.status}`);
    }
    const data = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    const keys = new Map<string, VerificationKey>();

    for (const jwk of data.keys ?? []) {
      const kid = jwk.kid;
      if (typeof kid !== 'string') continue;
      try {
        // jose's importJWK can import directly, but we already have the JWK shape.
        // Convert x5c / n,e to SPKI where needed. For Google's RSA keys we use
        // importSPKI if a PEM form is present, otherwise importJWK.
        const key = await importJwkKey(jwk);
        if (key) keys.set(kid, key);
      } catch (err: unknown) {
        this.logger.debug(`Skipping unusable Google cert ${kid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.jwksCache = { keys, fetchedAt: Date.now() };
    return this.jwksCache;
  }

  private unsafeDecodeHeader(token: string): { kid?: string } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      return header ?? null;
    } catch {
      return null;
    }
  }

  private allowedAudiences(): string[] {
    const primary = (process.env.GOOGLE_CLIENT_ID || '').trim();
    const extra = (process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const all = new Set<string>();
    if (primary) all.add(primary);
    extra.forEach((id) => all.add(id));
    return Array.from(all);
  }

  /**
   * Map a RISC subject to a KeyFlowOS user via the `UserIdentity` table.
   *
   * Its writer is POST /identity/bootstrap (IdentityService.persistUserIdentities),
   * which since W8-RISC-SIGNIN-CUTOFF (D-97, W7-RISC-REVOKE review SEC-W7RR-1)
   * persists the identities of the VERIFIED provider record (GoTrue's admin
   * user record for the token's own subject), never the request body's.
   *
   * Residual (D-97 review SEC-W8RSC-3, docs/auth-pathway.md): nothing wrote
   * UserIdentity before that packet and there is no backfill, so an account
   * last signed in with Google before it resolves no user here until its owner
   * signs in again; receiveEvent logs such a session-ending event for the
   * operator. user_metadata (user-editable at GoTrue) is never used to match.
   */
  private async resolveUser(subject: RiscSubject): Promise<string | null> {
    if (!subject.sub) return null;
    const identity = await this.prisma.client.userIdentity.findUnique({
      where: { provider_providerSubject: { provider: 'google', providerSubject: subject.sub } },
    });
    return identity?.userId ?? null;
  }

  /**
   * Execute the security action requested by the event type.
   * Returns a short action string persisted for observability, and every
   * revocation leg that did not hold.
   */
  private async handleEvent(
    eventType: string,
    eventDetails: { subject: RiscSubject; reason?: string; state?: string },
    userId: string | null,
  ): Promise<HandledEvent> {
    const done = (action: string, outcome: RevocationOutcome = { failed: [], redeliver: false }): HandledEvent => ({
      action,
      ...outcome,
    });
    if (!userId) {
      return done('no_matching_user');
    }

    switch (eventType) {
      // Google also sends these for ordinary account actions (a password
      // change, revoking the app's access), so they end the sessions here but
      // do not ban at the provider (R0-ID-F7 review F7-CR-1).
      case RISC_EVENT_TYPES.SESSIONS_REVOKED:
      case RISC_EVENT_TYPES.TOKENS_REVOKED:
        return done('sessions_terminated', await this.terminateUserSessions(userId, { providerBan: false }));

      case RISC_EVENT_TYPES.TOKEN_REVOKED:
        // We don't store OAuth refresh tokens for Google Sign-in itself;
        // Supabase manages those. Treat as a session revocation.
        return done('token_revoked_sessions_terminated', await this.terminateUserSessions(userId, { providerBan: false }));

      case RISC_EVENT_TYPES.ACCOUNT_DISABLED:
        if (eventDetails.reason === RISC_DISABLED_REASON.HIJACKING) {
          const outcome = await this.terminateUserSessions(userId, { providerBan: true });
          await this.flagGoogleSignInDisabled(userId, true);
          await this.notifyAdmins(userId, eventType, eventDetails.reason);
          return done('account_disabled_hijacking', outcome);
        }
        // bulk-account or unknown reason: flag for review but don't lock the user out.
        await this.flagGoogleSignInDisabled(userId, true);
        await this.notifyAdmins(userId, eventType, eventDetails.reason ?? 'unspecified');
        return done('account_disabled_flagged');

      case RISC_EVENT_TYPES.ACCOUNT_ENABLED:
        await this.flagGoogleSignInDisabled(userId, false);
        return done('account_enabled');

      case RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED:
        await this.notifyAdmins(userId, eventType, 'credential_change');
        return done('credential_change_logged');

      case RISC_EVENT_TYPES.VERIFICATION:
        return done('verification_logged');

      default:
        return done('unhandled_event');
    }
  }

  /**
   * Revoke the user's sessions at this API and in the local Session rows, and,
   * for account-disabled/hijacking (`providerBan`), pause them at Supabase.
   * Returns every leg that did not hold, and whether a redelivery of the event
   * can repair the durable cutoff (its write failed: SEC-W8RSC-2).
   *
   * A RISC event carries no user JWT, so the handler cannot hand the provider
   * one (admin.signOut takes the user's ACCESS JWT as the bearer of
   * POST /logout; until R0-ID-F7 this passed the user id and GoTrue refused it:
   * R0-ID-F4 review F4-C, the CR-2 shape). In this order:
   *
   *   1. The logout cutoff POST /identity/logout writes
   *      (auth:revoked:user:<id>, the revocation time in epoch seconds, for
   *      LOGOUT_REVOCATION_TTL_SECONDS): AuthMiddleware refuses every token of
   *      a session authenticated up to now, including one a refresh mints
   *      later, and attaches a session authenticated after it. Written FIRST,
   *      so nothing the provider does (fail, throw, hang) stands in its way.
   *   2. The admin-token cutoff the same logout writes
   *      (admin:user:<id>:revokedAt, ms, same TTL), so the user's admin
   *      local-auth tokens issued up to now are refused too: a hijacking event
   *      revokes no less than a voluntary logout (review F7-SEC-4).
   *   3. D-97 (W8-RISC-SIGNIN-CUTOFF): the DURABLE sign-in cutoff on the User
   *      row (recordSignInCutoff), the same time as 1 but with no TTL:
   *      AuthMiddleware refuses every token of a session that signed in at or
   *      before it for good, so the pre-event refresh tokens GoTrue keeps mint
   *      nothing this API accepts once 1 lapses (F7-SEC-2, SEC-W7RR-2).
   *      Written under the User row lock (updateUserMeta: SEC-W8RSC-1); when
   *      it does not hold, receiveEvent answers 503 so that Google delivers
   *      the event again (SEC-W8RSC-2).
   *   4. The local Session rows.
   *   5. With `providerBan` only: the ban at Supabase (banAtProvider), which
   *      refuses to renew the user's sessions while it lasts (see
   *      RISC_PROVIDER_BAN_SECONDS). No provider global logout (D-97,
   *      R0-SEC-02).
   *
   * The other session-ending events (sessions-revoked, tokens-revoked,
   * token-revoked) send nothing to the provider (F7-CR-1): only the local legs,
   * the durable cutoff included.
   *
   * Each leg's failure is logged, named in the result, and does not skip the
   * next.
   */
  private async terminateUserSessions(userId: string, opts: { providerBan: boolean }): Promise<RevocationOutcome> {
    const failed: RevocationLeg[] = [];
    const now = Date.now();
    const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

    try {
      await this.redis.setex(logoutRevocationKey(userId), LOGOUT_REVOCATION_TTL_SECONDS, logoutRevocationValue(now));
    } catch (err: unknown) {
      this.logger.warn(`Failed to write the logout cutoff for ${userId}: ${reason(err)}`);
      failed.push('revocation_marker');
    }

    try {
      await this.redis.set(`admin:user:${userId}:revokedAt`, String(now), 'EX', LOGOUT_REVOCATION_TTL_SECONDS);
    } catch (err: unknown) {
      this.logger.warn(`Failed to write the admin-token cutoff for ${userId}: ${reason(err)}`);
      failed.push('admin_cutoff');
    }

    const cutoff = await this.recordSignInCutoff(userId, Math.floor(now / 1000));
    if (cutoff !== 'held') failed.push('signin_cutoff');

    try {
      await this.prisma.client.session.deleteMany({ where: { userId } });
    } catch (err: unknown) {
      this.logger.warn(`Failed to delete local sessions for ${userId}: ${reason(err)}`);
      failed.push('local_sessions');
    }

    if (opts.providerBan) {
      if (!(await this.banAtProvider(userId))) failed.push('provider_ban');
    }
    return { failed, redeliver: cutoff === 'failed' };
  }

  /**
   * D-97 (W8-RISC-SIGNIN-CUTOFF; owner ruling, resolves D-39): record the
   * user's DURABLE sign-in cutoff, User.metaData.signInCutoffAt (epoch
   * seconds), merged into the metaData already there and never lowered (a
   * later cutoff already recorded stays). AuthMiddleware refuses every
   * Supabase token whose session signed in at or before it. No schema change
   * and no new secret: the same User.metaData bag flagGoogleSignInDisabled
   * writes. Returns whether the cutoff holds when it returns ('held'), the
   * user row is gone ('no_user'), or the write failed ('failed', which a
   * redelivery of the event can repair: SEC-W8RSC-2); every failure is
   * logged with the user id. Nothing clears it: account-enabled restores a
   * recovered user, whose sign-in after the event passes it.
   *
   * Through updateUserMeta (D-97 review SEC-W8RSC-1 / CR-W8RSC-1): two events
   * for the same user handled together no longer write back each other's
   * stale copy, so a concurrent flag write cannot erase the cutoff.
   */
  private async recordSignInCutoff(userId: string, cutoff: number): Promise<'held' | 'no_user' | 'failed'> {
    try {
      const found = await this.updateUserMeta(userId, (meta) => {
        const recorded = signInCutoffOf(meta);
        if (recorded !== null && recorded >= cutoff) return null;
        return { ...meta, [SIGN_IN_CUTOFF_META_KEY]: cutoff };
      });
      if (!found) {
        this.logger.warn(`Sign-in cutoff not recorded for ${userId}: no User row`);
        return 'no_user';
      }
      return 'held';
    } catch (err: unknown) {
      this.logger.warn(`Failed to record the sign-in cutoff for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return 'failed';
    }
  }

  /**
   * D-97 review SEC-W8RSC-1 / CR-W8RSC-1: the one door through which
   * RiscService changes User.metaData (the durable sign-in cutoff and the
   * googleSignInDisabled flag; nothing else in the server writes that column
   * after the row is created).
   *
   * Both writers read the bag, change their own key and write the whole bag
   * back. Unlocked, two RISC events for the same user handled together (say
   * account-disabled/bulk-account and sessions-revoked) both read the same
   * bag, and whichever wrote last erased the other's key: the flag write
   * dropped signInCutoffAt while the event row still said
   * sessions_terminated, and once the 24h Redis cutoff lapsed the pre-event
   * sessions were admitted again (F7-SEC-2 reopened). So, as lockBusinessMeta
   * does for Business.metaData (core/prisma/business-meta.ts), the read and
   * the write run in one transaction that first takes the row lock
   * (SELECT ... FOR NO KEY UPDATE, the lock the UPDATE takes anyway; it does
   * not block inserts that reference the user): a concurrent writer waits for
   * this one to commit and then reads its result. The lock is held for three
   * statements; this route is public but reaches here only with a SET that
   * Google signed, so no anonymous burst can queue on it.
   *
   * `change` gets the stored bag (a plain object; anything else reads as {})
   * and returns the bag to write, or null to write nothing. Returns false when
   * there is no such user (nothing is written then); a database error throws.
   */
  private async updateUserMeta(
    userId: string,
    change: (meta: Record<string, unknown>) => Record<string, unknown> | null,
  ): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
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

  /**
   * Ban the user at Supabase for RISC_PROVIDER_BAN_SECONDS, unless a ban that
   * lasts at least that long is already on the account. Returns whether such a
   * ban holds when it returns; every failure is logged.
   *
   * GoTrue's ban overwrites: ban_duration sets banned_until = now + duration,
   * whatever was there. Written blind, it would cut a longer ban, such as an
   * operator's indefinite one from the Supabase dashboard (the only
   * provider-level lock this repository has), down to
   * RISC_PROVIDER_BAN_SECONDS, after which the attacker could sign in again
   * (review F7-SEC-1, F7-CR-2). So the current ban is read first, and when it
   * cannot be read, or its end cannot be parsed, nothing is written: a ban
   * written over one we could not read may shorten it. auth-js has no
   * conditional update, so a ban set between the read and the write is still
   * overwritten.
   */
  private async banAtProvider(userId: string): Promise<boolean> {
    if (!this.supabaseAdmin.isConfigured()) {
      this.logger.warn(`Supabase session ban not attempted for ${userId}: Supabase admin client not configured`);
      return false;
    }
    try {
      const admin = this.supabaseAdmin.getClient().auth.admin;
      const { data, error: readError } = await admin.getUserById(userId);
      if (readError || !data?.user) {
        this.logger.warn(
          `Supabase session ban not written for ${userId}: its current ban could not be read (${readError?.message ?? 'no user returned'})`,
        );
        return false;
      }

      const bannedUntil = data.user.banned_until;
      if (bannedUntil) {
        const endsAt = Date.parse(bannedUntil);
        if (Number.isNaN(endsAt)) {
          this.logger.warn(`Supabase session ban not written for ${userId}: its current ban end is unreadable (${bannedUntil})`);
          return false;
        }
        if (endsAt >= Date.now() + RISC_PROVIDER_BAN_SECONDS * 1000) {
          this.logger.log(`Supabase ban for ${userId} already lasts until ${bannedUntil}; left as it is`);
          return true;
        }
      }

      const { error } = await admin.updateUserById(userId, { ban_duration: `${RISC_PROVIDER_BAN_SECONDS}s` });
      if (error) {
        this.logger.warn(`Supabase session ban failed for ${userId}: ${error.message}`);
        return false;
      }
      return true;
    } catch (err: unknown) {
      this.logger.warn(`Supabase session ban threw for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Soft-disable Google Sign-In for the affected user. The flag is stored on
   * the User row as metadata until a permanent schema field is justified.
   * Through updateUserMeta (D-97 review SEC-W8RSC-1 / CR-W8RSC-1), so this
   * write never carries a stale copy of the durable sign-in cutoff back.
   */
  private async flagGoogleSignInDisabled(userId: string, disabled: boolean): Promise<void> {
    try {
      await this.updateUserMeta(userId, (meta) => ({ ...meta, googleSignInDisabled: disabled }));
    } catch (err: unknown) {
      this.logger.warn(`Failed to update googleSignInDisabled for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async notifyAdmins(userId: string, eventType: string, reason: string): Promise<void> {
    // Best-effort admin alert via audit log. A future iteration can emit a
    // Notification row for the admin security UI.
    this.logger.warn(`SECURITY: RISC event ${eventType} for user ${userId}, reason=${reason}`);
  }

  /**
   * Erase all RISC events associated with a user.
   *
   * Call this when a user exercises their GDPR right to erasure. Events
   * received before we could resolve a userId (e.g. the account never signed in
   * via Google) are not affected because they contain no link to the user.
   */
  async eraseForUser(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.client.riscEvent.deleteMany({
      where: { userId },
    });
    const deleted = (result as unknown as { count?: number }).count ?? 0;
    this.logger.log(`Erased ${deleted} RISC event(s) for user ${userId}`);
    return { deleted };
  }
}

async function importJwkKey(jwk: Record<string, unknown>): Promise<VerificationKey | null> {
  // Prefer x5c chain -> SPKI PEM.
  const x5c = Array.isArray(jwk.x5c) ? jwk.x5c : [];
  if (x5c.length > 0 && typeof x5c[0] === 'string') {
    const cert = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`;
    return createPublicKey(cert);
  }

  // Fallback to jose's importJWK for RSA/EC keys.
  //
  // jwk arrives as Record<string, unknown> from the fetched JWKS. jose 5 types
  // importJWK's first parameter as JWK, where jose 6 accepted the looser shape.
  // The runtime contract is unchanged — jose validates the members itself and
  // throws on anything malformed — so this asserts the shape we already fetched
  // rather than widening what is accepted.
  const { importJWK } = await import('jose');
  const key = await importJWK(jwk as unknown as import('jose').JWK, jwk.alg as string);
  if (key instanceof KeyObject || key instanceof CryptoKey) return key;
  return null;
}

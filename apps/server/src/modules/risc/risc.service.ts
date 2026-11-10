import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createPublicKey, KeyObject } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { jwtVerify } from 'jose';
import { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import {
  LOGOUT_REVOCATION_TTL_SECONDS,
  logoutRevocationKey,
  logoutRevocationValue,
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
 * pre-event refresh token (the hijacker's) worked at Supabase again. Closed by
 * W7-RISC-REVOKE (D-39, the provider global logout): before the ban the
 * handler revokes every Supabase session of the user, and with them every
 * refresh token, through SupabaseAdminService.revokeAllSessions (see
 * terminateUserSessions). The ban stays as the fallback when that sign-out
 * fails; access tokens already issued, which GoTrue cannot recall, are refused
 * at this API by the local logout cutoff.
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
type RevocationLeg = 'revocation_marker' | 'admin_cutoff' | 'local_sessions' | 'provider_signout' | 'provider_ban';

interface HandledEvent {
  /** What the event did; persisted on RiscEvent.actionTaken. */
  action: string;
  /** Every revocation leg that did not hold, in the order they ran. */
  failed: RevocationLeg[];
}

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
   * 400 for malformed or unverifiable tokens.
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

    // Idempotency: RISC may redeliver events. Accept duplicates with 202.
    const existing = await this.prisma.client.riscEvent.findUnique({
      where: { jti: payload.jti },
    });
    if (existing) {
      this.logger.debug(`RISC event ${payload.jti} already processed; accepting duplicate`);
      return { status: 202, processed: false };
    }

    const userId = await this.resolveUser(subject);
    const { action, failed } = await this.handleEvent(eventType, eventDetails, userId);
    // A revocation that did not fully happen is not recorded as one that did
    // (R0-ID-F7 review F7-SEC-3): every failed leg is named on the row and in
    // the audit, as POST /identity/logout names its failed legs.
    const actionTaken = failed.length > 0 ? `${action}:revocation_incomplete:${failed.join(',')}` : action;

    await this.prisma.client.riscEvent
      .create({
        data: {
          jti: payload.jti,
          eventType,
          providerSubject: subject.sub,
          userId,
          actionTaken,
          payload: {
            reason: eventDetails?.reason ?? null,
            state: eventDetails?.state ?? null,
          },
          processedAt: new Date(),
        },
      })
      .catch((err: unknown) => {
        // Logging failure must not return 500 to Google; the event was handled.
        this.logger.warn(`Failed to persist RISC event ${payload.jti}: ${err instanceof Error ? err.message : String(err)}`);
      });

    await this.authSecurity
      .audit({
        event: 'login_failure',
        // As for POST /identity/logout: 'success' means the server-side
        // revocation (the logout cutoff) holds, when the event writes one; the
        // reason names every leg that did not.
        outcome: failed.includes('revocation_marker') ? 'error' : 'success',
        userId: userId ?? undefined,
        reason: failed.length > 0 ? `risc:${eventType}; revocation_incomplete: ${failed.join(', ')}` : `risc:${eventType}`,
        metadata: {
          jti: payload.jti,
          providerSubject: subject.sub,
          actionTaken,
          eventReason: eventDetails?.reason ?? null,
          ...(failed.length > 0 ? { revocationIncomplete: failed } : {}),
        },
      })
      .catch(() => undefined);

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
    const done = (action: string, failed: RevocationLeg[] = []): HandledEvent => ({ action, failed });
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
          const failed = await this.terminateUserSessions(userId, { providerBan: true });
          await this.flagGoogleSignInDisabled(userId, true);
          await this.notifyAdmins(userId, eventType, eventDetails.reason);
          return done('account_disabled_hijacking', failed);
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
   * for account-disabled/hijacking (`providerBan`), revoke them at Supabase and
   * pause them there. Returns every leg that did not hold.
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
   *   3. The local Session rows.
   *   4. With `providerBan` only: the provider global logout (W7-RISC-REVOKE,
   *      D-39; review F7-SEC-2): SupabaseAdminService.revokeAllSessions(userId)
   *      mints the short-lived user JWT POST /logout needs (no session_id
   *      claim), and GoTrue deletes every session of the user and so every
   *      refresh token: a pre-event refresh token (the hijacker's) mints
   *      nothing once the ban below lapses. Sent before the ban is read, so a
   *      ban already on the account (an operator's) cannot stand in its way.
   *   5. With `providerBan` only: the ban at Supabase (banAtProvider), which
   *      refuses to renew the user's sessions while it lasts: the fallback
   *      when the sign-out above fails (see RISC_PROVIDER_BAN_SECONDS).
   *
   * The other session-ending events (sessions-revoked, tokens-revoked,
   * token-revoked) send nothing to the provider (F7-CR-1): only the local legs.
   *
   * Each leg's failure is logged, named in the result, and does not skip the
   * next.
   */
  private async terminateUserSessions(userId: string, opts: { providerBan: boolean }): Promise<RevocationLeg[]> {
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

    try {
      await this.prisma.client.session.deleteMany({ where: { userId } });
    } catch (err: unknown) {
      this.logger.warn(`Failed to delete local sessions for ${userId}: ${reason(err)}`);
      failed.push('local_sessions');
    }

    if (opts.providerBan) {
      if (!(await this.revokeAtProvider(userId))) failed.push('provider_signout');
      if (!(await this.banAtProvider(userId))) failed.push('provider_ban');
    }
    return failed;
  }

  /**
   * W7-RISC-REVOKE (D-39): revoke every Supabase session of the user, and with
   * them every refresh token, by user id. Returns whether GoTrue accepted the
   * global sign-out; every failure is logged with the user id.
   */
  private async revokeAtProvider(userId: string): Promise<boolean> {
    try {
      if (await this.supabaseAdmin.revokeAllSessions(userId)) return true;
      this.logger.warn(`Supabase global sign-out not done for ${userId}: its refresh tokens are not revoked`);
      return false;
    } catch (err: unknown) {
      this.logger.warn(`Supabase global sign-out threw for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
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
   */
  private async flagGoogleSignInDisabled(userId: string, disabled: boolean): Promise<void> {
    try {
      const user = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { metaData: true },
      });
      if (!user) return;

      const meta = (user.metaData ?? {}) as Record<string, unknown>;
      await this.prisma.client.user.update({
        where: { id: userId },
        data: { metaData: { ...meta, googleSignInDisabled: disabled } },
      });
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

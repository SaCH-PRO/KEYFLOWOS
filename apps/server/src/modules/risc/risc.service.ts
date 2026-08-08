import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createPublicKey, KeyObject } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { jwtVerify } from 'jose';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { AuthSecurityService } from '../identity/auth-security.service';
import {
  RiscDiscoveryDocument,
  RiscEventPayload,
  RiscSubject,
  RISC_DISABLED_REASON,
  RISC_EVENT_TYPES,
} from './risc.types';

const RISC_CONFIG_URL = 'https://accounts.google.com/.well-known/risc-configuration';

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
    const actionTaken = await this.handleEvent(eventType, eventDetails, userId);

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
        outcome: 'success',
        userId: userId ?? undefined,
        reason: `risc:${eventType}`,
        metadata: {
          jti: payload.jti,
          providerSubject: subject.sub,
          actionTaken,
          eventReason: eventDetails?.reason ?? null,
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
   * Returns a short `actionTaken` string persisted for observability.
   */
  private async handleEvent(
    eventType: string,
    eventDetails: { subject: RiscSubject; reason?: string; state?: string },
    userId: string | null,
  ): Promise<string> {
    if (!userId) {
      return 'no_matching_user';
    }

    switch (eventType) {
      case RISC_EVENT_TYPES.SESSIONS_REVOKED:
      case RISC_EVENT_TYPES.TOKENS_REVOKED:
        await this.terminateUserSessions(userId);
        return 'sessions_terminated';

      case RISC_EVENT_TYPES.TOKEN_REVOKED:
        // We don't store OAuth refresh tokens for Google Sign-in itself;
        // Supabase manages those. Treat as a session revocation.
        await this.terminateUserSessions(userId);
        return 'token_revoked_sessions_terminated';

      case RISC_EVENT_TYPES.ACCOUNT_DISABLED:
        if (eventDetails.reason === RISC_DISABLED_REASON.HIJACKING) {
          await this.terminateUserSessions(userId);
          await this.flagGoogleSignInDisabled(userId, true);
          await this.notifyAdmins(userId, eventType, eventDetails.reason);
          return 'account_disabled_hijacking';
        }
        // bulk-account or unknown reason: flag for review but don't lock the user out.
        await this.flagGoogleSignInDisabled(userId, true);
        await this.notifyAdmins(userId, eventType, eventDetails.reason ?? 'unspecified');
        return 'account_disabled_flagged';

      case RISC_EVENT_TYPES.ACCOUNT_ENABLED:
        await this.flagGoogleSignInDisabled(userId, false);
        return 'account_enabled';

      case RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED:
        await this.notifyAdmins(userId, eventType, 'credential_change');
        return 'credential_change_logged';

      case RISC_EVENT_TYPES.VERIFICATION:
        return 'verification_logged';

      default:
        return 'unhandled_event';
    }
  }

  /**
   * End all local sessions and revoke Supabase sessions for the user.
   */
  private async terminateUserSessions(userId: string): Promise<void> {
    try {
      await this.prisma.client.session.deleteMany({ where: { userId } });
    } catch (err: unknown) {
      this.logger.warn(`Failed to delete local sessions for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (this.supabaseAdmin.isConfigured()) {
      try {
        const client = this.supabaseAdmin.getClient();
        const { error } = await client.auth.admin.signOut(userId, 'global');
        if (error) {
          this.logger.warn(`Supabase global sign-out failed for ${userId}: ${error.message}`);
        }
      } catch (err: unknown) {
        this.logger.warn(`Supabase sign-out threw for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeStringEqual } from '../../core/security/timing-safe-equal';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GmailConnector } from '../../core/connectors/implementations/gmail.connector';
import { decryptToken, encryptToken } from '../../core/crypto/token-crypto';
import { getCurrentBusinessId } from '../../core/tenant/tenant-context';
import type { Prisma } from '@prisma/client';

/**
 * R0-CMF5-GMAIL-CONNECT-BINDING (COST-LEDGER-001 section 7 items 4 and 5;
 * R0-07 review ST-2, ST-3). The mailbox invoices, reminders, receipts and
 * quotes are sent from is business configuration, so connecting, replacing and
 * disconnecting it is OWNER only (owner ruling D-11).
 */
export const GMAIL_OWNER_ONLY = 'GMAIL_OWNER_ONLY';
const GMAIL_OWNER_ONLY_MESSAGE = 'Only the business owner can connect, replace or disconnect the business mailbox';
export const GMAIL_PENDING_NOT_FOUND = 'GMAIL_PENDING_NOT_FOUND';
/**
 * R0-CMF5 review ST-CMF5-2: the confirmation names the mailbox the owner was
 * shown (GET .../gmail/pending/:id), and it must be the staged one.
 */
export const GMAIL_PENDING_EMAIL_MISMATCH = 'GMAIL_PENDING_EMAIL_MISMATCH';
/**
 * R0-CMF5 review ST-CMF5-3: the request's tenant (TenantInterceptor) is not the
 * business the verified OAuth state names, so nothing is staged.
 */
export const GMAIL_STATE_TENANT_MISMATCH = 'GMAIL_STATE_TENANT_MISMATCH';
/**
 * R0-CMF5 review 2 SEC-CMF5-R3: the consent returned no refresh token, so the
 * staged mailbox could never send once its hour-long access token expires, and
 * the business's stored refresh token belongs to another mailbox (or there is
 * none). Nothing is linked; the stored mailbox stays whole.
 */
export const GMAIL_PENDING_NO_REFRESH_TOKEN = 'GMAIL_PENDING_NO_REFRESH_TOKEN';

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/** Why the actor passed the owner rule; recorded on the audit row. */
type ConnectStanding = 'OWNER' | 'SUPER_ADMIN';

/**
 * How long a Gmail connection the callback staged waits for its confirmation.
 * The OAuth state itself lives 10 minutes; this covers the consent screen and
 * the confirmation that follows it.
 */
const PENDING_WINDOW_MS = 15 * 60 * 1000;

/**
 * Where a staged connection lives: an existing connector_accounts row (no
 * schema change). Its token columns are ciphertext by contract
 * (token-encryption-coverage.integration.test.ts, HANDLED_ELSEWHERE), so the
 * tokens are written through encryptToken here. No other code reads
 * ConnectorAccount, so a PENDING row is never taken for a live connection:
 * sendEmail and every inbox read use Business.gmail* only.
 */
const PENDING_ROW = { provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING' } as const;

/** The live Gmail check the Google Suite callback made with the fresh access token (no token in it). */
export interface GmailLiveCheck {
  ok: boolean;
  account: string | null;
  error: string | null;
}

/**
 * R0-CMF5 review 2 CMF5R-1: where a staged connection came from. The Google
 * Suite sign-in recorded the mailbox as the gmail connector (connector_statuses,
 * which the nightly sync reads, and a connector activity row) when it linked it
 * directly; now that it only stages, the confirmation records it, with the live
 * check the callback made. The commerce callback never recorded it, and still
 * does not.
 */
export interface PendingGmailOrigin {
  source: 'google-suite';
  verification: GmailLiveCheck;
}

/** What a staged connection is bound to (connector_accounts.settings). */
interface PendingBinding {
  purpose: 'gmail-connect';
  userId: string;
  nonce: string;
  pendingExpiresAt: string;
  origin?: 'google-suite';
  verification?: GmailLiveCheck;
}

export interface GmailConnectActor {
  id: string;
  role?: string;
}

/** Who and what a staged connection is for: the verified OAuth state's business, user and nonce. */
export interface PendingGmailBinding {
  businessId: string;
  userId: string;
  nonce: string;
}

/** The tokens a Google consent returned, as the token endpoint answers them. */
export interface StagedGmailTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** A pending row is expired once its window has passed, by either clock it carries. */
function isPendingExpired(row: { createdAt: Date | null; settings: unknown }, now: number): boolean {
  const created = row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
  if (!(created > now - PENDING_WINDOW_MS)) return true;
  const binding = (row.settings ?? {}) as Partial<PendingBinding>;
  const expiresAt = typeof binding.pendingExpiresAt === 'string' ? Date.parse(binding.pendingExpiresAt) : NaN;
  return !(expiresAt > now);
}

function gmailPendingNotFound(): NotFoundException {
  return new NotFoundException({
    code: GMAIL_PENDING_NOT_FOUND,
    message: 'No pending Gmail connection of yours with this id for this business; start the connection again',
  });
}

/**
 * R0-07: Gmail is an optional service, and it fails visibly. When it is not set
 * up for this request - the business never connected a mailbox, or this
 * deployment has no Google OAuth client (or state secret) to connect or refresh
 * one - every Gmail path refuses with this 503 before any outbound call. The
 * global filter renders it as { statusCode: 503, code: 'provider_not_configured',
 * message, details: { service: 'gmail' } }, so a client can tell "connect Gmail"
 * apart from a bad request, and the controllers that send invoice, reminder and
 * receipt emails need no mapping of their own. The message keeps its old text
 * ("Gmail not connected", "Google OAuth not configured") for log readers and
 * message matchers.
 *
 * A send that reaches Google and fails is not "not configured"; it keeps its
 * existing error.
 */
function gmailNotConfigured(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'provider_not_configured',
    service: 'gmail',
    message,
    error: 'Service Unavailable',
  });
}

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface OAuthState {
  businessId: string;
  /**
   * R0-CMF5: the user who asked for the auth URL. Only this user can confirm
   * the connection the callback stages; a state without one (the pre-CMF5
   * shape) stages nothing.
   */
  userId?: string;
  nonce: string;
  exp: number;
  purpose: 'gmail';
}

interface UserInfo {
  email: string;
  name?: string;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly redirectUri = process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI?.replace('/api/crm/google/callback', '/api/commerce/gmail/callback');
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;
  /**
   * Nonces of OAuth states this process has accepted, with their expiry (R0-07
   * review ST-2): a signed state is good for one callback, so a captured or
   * forwarded auth URL cannot be completed again within its 10 minutes. Entries
   * leave when their state would have expired anyway. This is per process. The
   * binding to the user who asked for it (R0-CMF5) is the state's userId plus
   * the confirmation step: the callback only stages a PENDING connection, which
   * confirmPendingConnection activates for that user alone.
   */
  private readonly acceptedStateNonces = new Map<string, number>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(GmailConnector) private readonly gmailConnector?: GmailConnector,
  ) {
    if (!this.stateSecret) {
      this.logger.warn('GOOGLE_STATE_SECRET not configured - Gmail OAuth will not be secure');
    }
  }

  private ensureStateSecret(): string {
    if (!this.stateSecret) {
      throw gmailNotConfigured('Gmail OAuth state secret not configured');
    }
    return this.stateSecret;
  }

  private signState(state: OAuthState): string {
    const secret = this.ensureStateSecret();
    const payload = JSON.stringify(state);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64');
  }

  verifyState(signedState: string): OAuthState | null {
    try {
      if (!this.stateSecret) {
        this.logger.error('Cannot verify state: GOOGLE_STATE_SECRET not configured');
        return null;
      }
      
      const decoded = Buffer.from(signedState, 'base64').toString('utf-8');
      const lastDotIndex = decoded.lastIndexOf('.');
      if (lastDotIndex === -1) return null;
      
      const payload = decoded.substring(0, lastDotIndex);
      const signature = decoded.substring(lastDotIndex + 1);
      
      const expectedSignature = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
      if (!timingSafeStringEqual(signature, expectedSignature)) {
        this.logger.warn('Invalid OAuth state signature');
        return null;
      }
      
      const state: OAuthState = JSON.parse(payload);
      const now = Date.now();
      if (state.exp < now) {
        this.logger.warn('OAuth state expired');
        return null;
      }
      // R0-CMF5 review 2 SEC-CMF5-R2: the Google Suite (and other Google) flows
      // sign their states with the same secret and format, and the suite's now
      // names a user too. Only a state minted by getAuthUrl is good here, so a
      // member's calendar-only suite state cannot stage a Gmail connection.
      if (state.purpose !== 'gmail') {
        this.logger.warn('OAuth state was not issued for the Gmail callback');
        return null;
      }

      for (const [nonce, exp] of this.acceptedStateNonces) {
        if (exp < now) this.acceptedStateNonces.delete(nonce);
      }
      if (typeof state.nonce !== 'string' || state.nonce.length === 0) {
        this.logger.warn('OAuth state has no nonce');
        return null;
      }
      if (this.acceptedStateNonces.has(state.nonce)) {
        this.logger.warn('OAuth state already used');
        return null;
      }
      this.acceptedStateNonces.set(state.nonce, state.exp);

      return state;
    } catch {
      this.logger.warn('Failed to verify OAuth state');
      return null;
    }
  }

  /**
   * R0-CMF5 / D-11: who may connect, replace or disconnect the business mailbox.
   * The owner is the OWNER membership or the distinguished owner
   * (Business.ownerId), the two arms IdentityService.assertBusinessOwner and
   * BusinessGuard admit an owner by; SUPER_ADMIN keeps the platform bypass
   * BusinessGuard already grants. Restated rather than imported, as
   * SubscriptionsService.assertPlanChangeAuthority does: CommerceModule does not
   * import IdentityModule. The same rule guards the Google Suite connect and
   * the connector disconnect/reconnect routes for gmail (R0-CMF5 review
   * ST-CMF5-1), which resolve this service rather than restate it again.
   */
  async assertConnectAuthority(businessId: string, actor: GmailConnectActor | undefined): Promise<void> {
    await this.connectStanding(businessId, actor);
  }

  /** The owner rule, answering why the actor passed it (for the audit row). */
  private async connectStanding(businessId: string, actor: GmailConnectActor | undefined): Promise<ConnectStanding> {
    if (!actor?.id) throw new UnauthorizedException('Authentication required');
    if (actor.role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return 'OWNER';
    const owned = await this.prisma.client.business.findFirst({
      where: { id: businessId, ownerId: actor.id },
      select: { id: true },
    });
    if (owned) return 'OWNER';
    throw new ForbiddenException({ code: GMAIL_OWNER_ONLY, message: GMAIL_OWNER_ONLY_MESSAGE });
  }

  /**
   * R0-CMF5 review ST-CMF5-3. The callbacks are public, but the global
   * TenantInterceptor still installs a tenant when a request carries a session
   * and names a business it may access (`?businessId=`), and the Prisma tenant
   * extension then rewrites every scoped write's businessId to that tenant: a
   * state minted for business A would stage into B. The verified state is the
   * only authority on which business a connection is for, so a request whose
   * ambient tenant is any other business stages nothing.
   */
  private assertStateTenant(businessId: string): void {
    const ambient = getCurrentBusinessId();
    if (ambient !== undefined && ambient !== businessId) {
      throw new BadRequestException({
        code: GMAIL_STATE_TENANT_MISMATCH,
        message: 'This request is scoped to another business than the one the Gmail connection was started for',
      });
    }
  }

  /**
   * R0-CMF5 review ST-CMF5-4: one team_activity_logs row per mailbox change,
   * naming the acting user, written in the change's own transaction (the
   * mechanism SubscriptionsService.auditPlanChange uses).
   */
  private async auditMailboxChange(
    tx: PrismaTx,
    businessId: string,
    actorId: string,
    standing: ConnectStanding,
    change: { action: string; title: string; meta: Record<string, unknown> },
  ): Promise<void> {
    await tx.teamActivityLog.create({
      data: {
        businessId,
        userId: actorId,
        module: 'commerce',
        action: change.action,
        entityType: 'gmail_mailbox',
        entityId: businessId,
        title: change.title,
        meta: { ...change.meta, actorStanding: standing } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * R0-CMF5 review 2 SEC-CMF5-R4: the first statement of every transaction that
   * changes the business mailbox. Confirm used to claim the pending row and then
   * update the business, while disconnect updated the business and then deleted
   * the pending rows; sent together they deadlocked (40P01) and the loser
   * answered 500, a lost disconnect leaving the mailbox linked. Both now take
   * this row lock first, so they queue instead. FOR NO KEY UPDATE is the lock
   * the mailbox UPDATE takes anyway; it does not block inserts that reference
   * the business.
   */
  private async lockBusinessRow(tx: PrismaTx, businessId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;
  }

  /**
   * R0-CMF5 review 2 CMF5R-1: a mailbox staged by the Google Suite sign-in is
   * recorded as the gmail connector when the owner confirms it, as that sign-in
   * did when it linked the mailbox itself: connector_statuses connected (intake
   * on, GmailConnector being a Key Inbox 'communication' connector) or error
   * with the live check's message, and one connector activity row. In the
   * confirmation's transaction; no token is written to either.
   */
  private async recordSuiteGmailConnector(
    tx: PrismaTx,
    businessId: string,
    email: string,
    verification: Partial<GmailLiveCheck> | undefined,
  ): Promise<void> {
    const ok = verification?.ok === true;
    const error = ok
      ? null
      : (typeof verification?.error === 'string' && verification.error.length > 0 ? verification.error : 'The live Gmail check did not complete');
    const account = typeof verification?.account === 'string' && verification.account.length > 0 ? verification.account : email;
    const now = new Date();
    await tx.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
      create: {
        businessId,
        connectorType: 'gmail',
        status: ok ? 'connected' : 'error',
        connectedAt: now,
        connectedAccount: account,
        intakeEnabled: true,
        lastError: error,
        lastErrorAt: ok ? null : now,
        errorCount: ok ? 0 : 1,
      },
      update: {
        status: ok ? 'connected' : 'error',
        connectedAt: now,
        connectedAccount: account,
        lastError: error,
        lastErrorAt: ok ? null : now,
        ...(ok ? { errorCount: 0 } : {}),
      },
    });
    await tx.connectorActivityLog.create({
      data: {
        businessId,
        connectorType: 'gmail',
        action: 'connect',
        status: ok ? 'success' : 'failure',
        message: ok
          ? `Connected via unified Google sign-in (${email}) — live verification OK`
          : `OAuth granted but live verification failed: ${error}`,
      },
    });
  }

  /**
   * R0-CMF5 review ST-CMF5-5: pending rows past their window are removed
   * whenever this business's connection is staged, previewed, confirmed,
   * read or disconnected, so an unconfirmed consent's refresh token does not
   * outlive its window by more than the business's next Gmail call.
   */
  private async sweepExpiredPending(businessId: string, now = Date.now()): Promise<void> {
    const db = this.prisma.client;
    const rows = await db.connectorAccount.findMany({
      where: { businessId, ...PENDING_ROW },
      select: { id: true, createdAt: true, settings: true },
    });
    const expired = rows.filter((row) => isPendingExpired(row, now)).map((row) => row.id);
    if (expired.length === 0) return;
    await db.connectorAccount.deleteMany({ where: { businessId, ...PENDING_ROW, id: { in: expired } } });
  }

  /**
   * The Google consent URL. Its state names the business and the user who
   * asked (R0-CMF5), with a nonce and a 10-minute expiry, HMAC-signed with
   * GOOGLE_STATE_SECRET. The caller has already passed assertConnectAuthority.
   */
  getAuthUrl(businessId: string, userId: string): string {
    if (!this.clientId) {
      throw gmailNotConfigured('Google OAuth not configured');
    }

    const state: OAuthState = {
      businessId,
      userId,
      nonce: randomBytes(16).toString('hex'),
      exp: Date.now() + 10 * 60 * 1000,
      purpose: 'gmail',
    };
    
    const signedState = this.signState(state);
    
    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri ?? '',
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: signedState,
    });
    
    return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleToken> {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw gmailNotConfigured('Google OAuth not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Token exchange failed: ${error}`);
      throw new BadRequestException('Failed to exchange authorization code');
    }

    return response.json();
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleToken> {
    if (!this.clientId || !this.clientSecret) {
      throw gmailNotConfigured('Google OAuth not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to refresh access token');
    }

    return response.json();
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to get user info');
    }

    return response.json();
  }

  /**
   * R0-CMF5: the OAuth callback's half. GET /commerce/gmail/callback needs no
   * login (Google redirects the browser, and the web proxy forwards no
   * session), so it cannot tell who completed consent and must not link
   * anything. It exchanges the code and stores the tokens as a PENDING
   * connection bound to the user and business the verified state names, then
   * hands back the pending id; Business.gmail* is not touched. A state with no
   * user, or a request whose tenant is another business (ST-CMF5-3), stages
   * nothing and calls no Google endpoint.
   */
  async stagePendingConnection(state: OAuthState, code: string): Promise<{ pendingId: string }> {
    if (typeof state?.userId !== 'string' || state.userId.length === 0) {
      throw new BadRequestException('OAuth state names no user');
    }
    if (typeof code !== 'string' || code.length === 0) {
      throw new BadRequestException('Authorization code is required');
    }
    this.assertStateTenant(state.businessId);
    const tokens = await this.exchangeCodeForTokens(code);
    const userInfo = await this.getUserInfo(tokens.access_token);
    return this.stagePendingTokens(
      { businessId: state.businessId, userId: state.userId, nonce: state.nonce },
      userInfo.email,
      tokens,
    );
  }

  /**
   * Store tokens a verified consent returned as a PENDING Gmail connection.
   * Shared by the commerce callback and the Google Suite callback (R0-CMF5
   * review ST-CMF5-1), so both link nothing until the user the state names
   * confirms.
   *
   * One pending connection per (business, user): a newer consent replaces an
   * unconfirmed older one, and this business's pending rows past their window
   * are removed on the way.
   *
   * `origin` (review 2 CMF5R-1) is the Google Suite callback's: it is kept on
   * the row (no token in it) so the confirmation records the gmail connector.
   */
  async stagePendingTokens(
    binding: PendingGmailBinding,
    accountEmail: string,
    tokens: StagedGmailTokens,
    origin?: PendingGmailOrigin,
  ): Promise<{ pendingId: string }> {
    if (typeof binding?.userId !== 'string' || binding.userId.length === 0) {
      throw new BadRequestException('OAuth state names no user');
    }
    if (typeof accountEmail !== 'string' || accountEmail.length === 0) {
      throw new BadRequestException('Google returned no mailbox address for this consent');
    }
    if (typeof tokens?.access_token !== 'string' || tokens.access_token.length === 0) {
      throw new BadRequestException('Google returned no access token for this consent');
    }
    this.assertStateTenant(binding.businessId);

    const now = Date.now();
    const db = this.prisma.client;
    await this.sweepExpiredPending(binding.businessId, now);
    await db.connectorAccount.deleteMany({
      where: {
        businessId: binding.businessId,
        ...PENDING_ROW,
        OR: [
          { settings: { path: ['userId'], equals: binding.userId } },
          { createdAt: { lt: new Date(now - PENDING_WINDOW_MS) } },
        ],
      },
    });

    const pendingId = `gmc_${randomBytes(24).toString('base64url')}`;
    const settings: PendingBinding = {
      purpose: 'gmail-connect',
      userId: binding.userId,
      nonce: binding.nonce,
      pendingExpiresAt: new Date(now + PENDING_WINDOW_MS).toISOString(),
      ...(origin?.source === 'google-suite'
        ? {
            origin: 'google-suite' as const,
            verification: {
              ok: origin.verification?.ok === true,
              account: typeof origin.verification?.account === 'string' ? origin.verification.account : null,
              error: typeof origin.verification?.error === 'string' ? origin.verification.error : null,
            },
          }
        : {}),
    };
    await db.connectorAccount.create({
      data: {
        id: pendingId,
        businessId: binding.businessId,
        ...PENDING_ROW,
        accountEmail,
        accessTokenEncrypted: encryptToken(tokens.access_token),
        refreshTokenEncrypted: encryptToken(tokens.refresh_token ?? null),
        tokenExpiresAt: tokens.expires_in ? new Date(now + tokens.expires_in * 1000) : null,
        settings: { ...settings },
      },
    });

    this.logger.log(`Gmail connection staged for business ${binding.businessId} by user ${binding.userId}; awaiting confirmation`);
    return { pendingId };
  }

  /**
   * The pending row `pendingId` of this business, staged for `actorId` and
   * inside its window; anything else is GMAIL_PENDING_NOT_FOUND. Expired rows
   * of the business are swept first.
   */
  private async findOwnPending(businessId: string, actorId: string, pendingId: string) {
    const now = Date.now();
    await this.sweepExpiredPending(businessId, now);
    const row = await this.prisma.client.connectorAccount.findFirst({
      where: { id: pendingId, businessId, ...PENDING_ROW },
    });
    if (!row) throw gmailPendingNotFound();
    const binding = (row.settings ?? {}) as Partial<PendingBinding>;
    if (binding.purpose !== 'gmail-connect' || binding.userId !== actorId) throw gmailPendingNotFound();
    if (isPendingExpired(row, now) || typeof row.accountEmail !== 'string' || row.accountEmail.length === 0) {
      throw gmailPendingNotFound();
    }
    return { row, email: row.accountEmail, expiresAt: binding.pendingExpiresAt as string };
  }

  /**
   * R0-CMF5 review ST-CMF5-2: what the owner is about to confirm. Same rule and
   * binding as the confirmation (owner first; this business's row, staged for
   * this user, inside its window); it reads, and consumes nothing.
   */
  async previewPendingConnection(
    businessId: string,
    actor: GmailConnectActor | undefined,
    pendingId: string,
  ): Promise<{ pendingId: string; email: string; expiresAt: string }> {
    await this.assertConnectAuthority(businessId, actor);
    const { row, email, expiresAt } = await this.findOwnPending(businessId, (actor as GmailConnectActor).id, pendingId);
    return { pendingId: row.id, email, expiresAt };
  }

  /**
   * R0-CMF5: the confirmation, from an authenticated request. The owner rule is
   * checked first (a refused member reads no pending row), then the pending
   * connection must be this business's, staged for this user and inside its
   * window; anything else is GMAIL_PENDING_NOT_FOUND. The confirmation names
   * the mailbox the owner was shown (ST-CMF5-2); another one is 409
   * GMAIL_PENDING_EMAIL_MISMATCH and the row stays. The row is claimed (deleted
   * while still PENDING) before Business.gmail* is written, in one transaction
   * with the audit row naming the actor (ST-CMF5-4), so a pending id activates
   * at most once even when two confirmations race.
   *
   * Review 2: the transaction locks the business row first, as disconnect does
   * (SEC-CMF5-R4); a consent with no refresh token links only as a re-consent
   * of the stored mailbox, else 409 GMAIL_PENDING_NO_REFRESH_TOKEN and nothing
   * changes (SEC-CMF5-R3); a Google Suite staging also records the gmail
   * connector (CMF5R-1).
   */
  async confirmPendingConnection(
    businessId: string,
    actor: GmailConnectActor | undefined,
    pendingId: string,
    expectedEmail: unknown,
  ): Promise<{ connected: true; email: string }> {
    const standing = await this.connectStanding(businessId, actor);
    const actorId = (actor as GmailConnectActor).id;
    const { row, email } = await this.findOwnPending(businessId, actorId, pendingId);
    if (typeof expectedEmail !== 'string' || expectedEmail.trim().toLowerCase() !== email.toLowerCase()) {
      throw new ConflictException({
        code: GMAIL_PENDING_EMAIL_MISMATCH,
        message: 'This pending connection is for another mailbox than the one you confirmed; review it and confirm again',
      });
    }

    const accessToken = decryptToken(row.accessTokenEncrypted);
    const refreshToken = decryptToken(row.refreshTokenEncrypted);
    const staged = (row.settings ?? {}) as Partial<PendingBinding>;
    await this.prisma.client.$transaction(async (tx) => {
      await this.lockBusinessRow(tx, businessId);
      const previous = await tx.business.findUnique({ where: { id: businessId }, select: { gmailEmail: true, gmailRefreshToken: true } });
      const previousEmail = previous?.gmailEmail ?? null;
      // Review 2 SEC-CMF5-R3: a stored refresh token stays only with its own
      // mailbox. A consent with none, for another mailbox (or with no mailbox
      // stored), would pair the new address and access token with the replaced
      // mailbox's refresh token, or with none at all, so it links nothing.
      const sameMailbox = typeof previousEmail === 'string' && previousEmail.toLowerCase() === email.toLowerCase();
      if (!refreshToken && !(sameMailbox && previous?.gmailRefreshToken)) {
        throw new ConflictException({
          code: GMAIL_PENDING_NO_REFRESH_TOKEN,
          message: `Google did not grant lasting access to ${email}, so it cannot send for the business and was not connected; nothing was changed. Connect Gmail again and allow offline access.`,
        });
      }
      const claimed = await tx.connectorAccount.deleteMany({ where: { id: row.id, businessId, status: PENDING_ROW.status } });
      if (claimed.count !== 1) throw gmailPendingNotFound();
      await tx.business.update({
        where: { id: businessId },
        data: {
          gmailEmail: email,
          gmailAccessToken: accessToken,
          // No refresh token in this consent: only a re-consent of the stored mailbox gets here, and it keeps its own.
          ...(refreshToken ? { gmailRefreshToken: refreshToken } : {}),
          gmailTokenExpiry: row.tokenExpiresAt,
        },
      });
      await this.auditMailboxChange(tx, businessId, actorId, standing, {
        action: previousEmail ? 'gmail_replaced' : 'gmail_connected',
        title: previousEmail ? `Replaced the business mailbox ${previousEmail} with ${email}` : `Connected the business mailbox ${email}`,
        meta: { email, previousEmail, pendingId: row.id },
      });
      if (staged.origin === 'google-suite') {
        await this.recordSuiteGmailConnector(tx, businessId, email, staged.verification);
      }
    });

    this.logger.log(`Gmail connected for business ${businessId} by user ${actorId}: ${email}`);
    return { connected: true, email };
  }

  /**
   * R0-CMF5 / D-11: OWNER only (the rule is applied here, so every route that
   * disconnects goes through it). Clears Business.gmail*, removes every PENDING
   * Gmail connection of the business (ST-CMF5-5: a consent staged before the
   * disconnect cannot be confirmed after it), and writes the audit row naming
   * the actor (ST-CMF5-4), in one transaction.
   */
  async disconnectGmail(businessId: string, actor: GmailConnectActor | undefined): Promise<void> {
    const standing = await this.connectStanding(businessId, actor);
    const actorId = (actor as GmailConnectActor).id;
    await this.prisma.client.$transaction(async (tx) => {
      // Review 2 SEC-CMF5-R4: the same first lock as confirmPendingConnection.
      await this.lockBusinessRow(tx, businessId);
      const previous = await tx.business.findUnique({ where: { id: businessId }, select: { gmailEmail: true } });
      await tx.business.update({
        where: { id: businessId },
        data: {
          gmailEmail: null,
          gmailAccessToken: null,
          gmailRefreshToken: null,
          gmailTokenExpiry: null,
        },
      });
      const removed = await tx.connectorAccount.deleteMany({ where: { businessId, ...PENDING_ROW } });
      const previousEmail = previous?.gmailEmail ?? null;
      await this.auditMailboxChange(tx, businessId, actorId, standing, {
        action: 'gmail_disconnected',
        title: previousEmail ? `Disconnected the business mailbox ${previousEmail}` : 'Disconnected the business mailbox',
        meta: { previousEmail, pendingRemoved: removed.count },
      });
    });
    this.logger.log(`Gmail disconnected for business ${businessId} by user ${actorId}`);
  }

  async getGmailStatus(businessId: string): Promise<{ connected: boolean; email: string | null }> {
    // ST-CMF5-5: the lazy sweep. A failure here never blocks the status read.
    try {
      await this.sweepExpiredPending(businessId);
    } catch (err) {
      this.logger.warn(`Pending Gmail sweep failed for business ${businessId}: ${err instanceof Error ? err.message : err}`);
    }
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailEmail: true, gmailRefreshToken: true },
    });

    return {
      connected: !!(business?.gmailEmail && business?.gmailRefreshToken),
      email: business?.gmailEmail ?? null,
    };
  }

  private async getValidAccessToken(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        gmailAccessToken: true,
        gmailRefreshToken: true,
        gmailTokenExpiry: true,
      },
    });

    if (!business?.gmailRefreshToken) {
      throw gmailNotConfigured('Gmail not connected');
    }

    const now = new Date();
    const expiry = business.gmailTokenExpiry ? new Date(business.gmailTokenExpiry) : null;
    const isExpired = !expiry || now >= new Date(expiry.getTime() - 5 * 60 * 1000);

    if (!isExpired && business.gmailAccessToken) {
      return business.gmailAccessToken;
    }

    const tokens = await this.refreshAccessToken(business.gmailRefreshToken);
    
    const newExpiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        gmailAccessToken: tokens.access_token,
        gmailTokenExpiry: newExpiry,
      },
    });

    return tokens.access_token;
  }

  private createMimeMessage(params: {
    from: string;
    to: string;
    subject: string;
    htmlBody: string;
  }): string {
    const boundary = 'boundary_' + Date.now();
    
    const message = [
      `From: ${params.from}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(params.htmlBody).toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async sendEmail(params: {
    businessId: string;
    to: string;
    subject: string;
    htmlBody: string;
  }): Promise<{ messageId: string }> {
    const accessToken = await this.getValidAccessToken(params.businessId);
    
    const business = await this.prisma.client.business.findUnique({
      where: { id: params.businessId },
      select: { gmailEmail: true, name: true },
    });

    if (!business?.gmailEmail) {
      throw gmailNotConfigured('Gmail not connected');
    }

    const from = business.name
      ? `${business.name} <${business.gmailEmail}>`
      : business.gmailEmail;

    const raw = this.createMimeMessage({
      from,
      to: params.to,
      subject: params.subject,
      htmlBody: params.htmlBody,
    });

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to send email: ${error}`);
      throw new BadRequestException('Failed to send email');
    }

    const result = await response.json();
    this.logger.log(`Email sent: ${result.id}`);

    this.gmailConnector?.emitMessageSent(params.businessId, {
      to: params.to,
      subject: params.subject,
      externalId: result.id,
    }).catch((e) => this.logger.warn(`Gmail connector event emission failed: ${e.message}`));

    return { messageId: result.id };
  }

  // ----- Full inbox CRUD -----

  async listThreads(
    businessId: string,
    opts: { q?: string; labelIds?: string[]; maxResults?: number; pageToken?: string } = {},
  ) {
    const accessToken = await this.getValidAccessToken(businessId);
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.labelIds) for (const l of opts.labelIds) params.append('labelIds', l);
    params.set('maxResults', String(opts.maxResults ?? 25));
    if (opts.pageToken) params.set('pageToken', opts.pageToken);

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException(`Gmail API error ${res.status}`);
    return res.json();
  }

  async getThread(businessId: string, threadId: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException(`Gmail API error ${res.status}`);
    return res.json();
  }

  async modifyMessageLabels(
    businessId: string,
    messageId: string,
    add: string[] = [],
    remove: string[] = [],
  ) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Gmail API error ${res.status}`);
    return res.json();
  }

  markRead(businessId: string, messageId: string) {
    return this.modifyMessageLabels(businessId, messageId, [], ['UNREAD']);
  }

  markUnread(businessId: string, messageId: string) {
    return this.modifyMessageLabels(businessId, messageId, ['UNREAD'], []);
  }

  star(businessId: string, messageId: string) {
    return this.modifyMessageLabels(businessId, messageId, ['STARRED'], []);
  }

  unstar(businessId: string, messageId: string) {
    return this.modifyMessageLabels(businessId, messageId, [], ['STARRED']);
  }

  archive(businessId: string, messageId: string) {
    return this.modifyMessageLabels(businessId, messageId, [], ['INBOX']);
  }

  async trash(businessId: string, messageId: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException(`Gmail API error ${res.status}`);
    return res.json();
  }

  async untrash(businessId: string, messageId: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/untrash`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException(`Gmail API error ${res.status}`);
    return res.json();
  }

  async sendReply(params: {
    businessId: string;
    threadId: string;
    inReplyTo: string;
    to: string;
    subject: string;
    htmlBody: string;
  }): Promise<{ messageId: string; threadId: string }> {
    const accessToken = await this.getValidAccessToken(params.businessId);
    const business = await this.prisma.client.business.findUnique({
      where: { id: params.businessId },
      select: { gmailEmail: true, name: true },
    });
    if (!business?.gmailEmail) throw gmailNotConfigured('Gmail not connected');

    const from = business.name ? `${business.name} <${business.gmailEmail}>` : business.gmailEmail;
    const boundary = 'boundary_' + Date.now();
    const headers = [
      `From: ${from}`,
      `To: ${params.to}`,
      `Subject: ${params.subject.startsWith('Re:') ? params.subject : 'Re: ' + params.subject}`,
      `In-Reply-To: ${params.inReplyTo}`,
      `References: ${params.inReplyTo}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    const body = [
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(params.htmlBody).toString('base64'),
      '',
      `--${boundary}--`,
    ];
    const raw = Buffer.from([...headers, ...body].join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, threadId: params.threadId }),
    });
    if (!res.ok) {
      const error = await res.text();
      this.logger.error(`Reply failed: ${error}`);
      throw new BadRequestException('Failed to send reply');
    }
    const result = (await res.json()) as { id: string; threadId: string };
    return { messageId: result.id, threadId: result.threadId };
  }

  async listLabels(businessId: string) {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new BadRequestException(`Gmail API error ${res.status}`);
    return res.json();
  }

  /* ══ READ ═══════════════════════════════════════════════════════════════
   *
   * This service was send-only. Reading needed no new OAuth flow and no new
   * consent screen: `gmail.modify` is already among the scopes requested at
   * :104-109, and it includes read. Existing connections work unchanged.
   *
   * Deliberately kept on GmailService rather than a second Gmail client —
   * token refresh, expiry skew and the "Gmail not connected" contract all live
   * in getValidAccessToken, and a parallel client would drift from it.
   */

  /**
   * Search the mailbox. `query` is Gmail search syntax, the same string a user
   * would type into the box — `has:attachment from:republicbank.com newer_than:30d`.
   */
  async searchMessages(
    businessId: string,
    query: string,
    maxResults = 25,
  ): Promise<Array<{ id: string; threadId: string }>> {
    const accessToken = await this.getValidAccessToken(businessId);
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(maxResults, 100)));

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new BadRequestException(`Gmail search failed (${res.status})`);
    const body = (await res.json()) as { messages?: Array<{ id: string; threadId: string }> };
    return body.messages ?? [];
  }

  /**
   * Message metadata plus a flat list of its attachments.
   *
   * Gmail nests parts arbitrarily deep — an attachment on a forwarded message
   * with an inline signature image can sit three levels down — so the walk is
   * recursive rather than a scan of `payload.parts`.
   */
  async getMessageWithAttachments(
    businessId: string,
    messageId: string,
  ): Promise<{
    id: string;
    subject: string;
    from: string;
    date: Date | null;
    attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>;
  }> {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException(`Gmail message fetch failed (${res.status})`);

    const msg = (await res.json()) as {
      id: string;
      internalDate?: string;
      payload?: GmailPart;
    };

    const headers = msg.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> = [];
    const walk = (part?: GmailPart) => {
      if (!part) return;
      if (part.body?.attachmentId && part.filename) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType ?? 'application/octet-stream',
          size: part.body.size ?? 0,
        });
      }
      (part.parts ?? []).forEach(walk);
    };
    walk(msg.payload);

    return {
      id: msg.id,
      subject: header('Subject'),
      from: header('From'),
      date: msg.internalDate ? new Date(Number(msg.internalDate)) : null,
      attachments,
    };
  }

  /** Fetch one attachment's bytes. Gmail returns base64url, not base64. */
  async getAttachment(
    businessId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const accessToken = await this.getValidAccessToken(businessId);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException(`Gmail attachment fetch failed (${res.status})`);
    const body = (await res.json()) as { data?: string };
    // base64url: '-' and '_' replace '+' and '/'. Decoding as plain base64
    // silently corrupts any attachment whose bytes happen to produce them.
    return Buffer.from((body.data ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }
}

/** Minimal shape of a Gmail MIME part — only the fields the walk above reads. */
interface GmailPart {
  filename?: string;
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

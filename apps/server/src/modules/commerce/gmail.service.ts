import {
  BadRequestException,
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

/** What a staged connection is bound to (connector_accounts.settings). */
interface PendingBinding {
  purpose: 'gmail-connect';
  userId: string;
  nonce: string;
  pendingExpiresAt: string;
}

export interface GmailConnectActor {
  id: string;
  role?: string;
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
   * import IdentityModule.
   */
  async assertConnectAuthority(businessId: string, actor: GmailConnectActor | undefined): Promise<void> {
    if (!actor?.id) throw new UnauthorizedException('Authentication required');
    if (actor.role === 'SUPER_ADMIN') return;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return;
    const owned = await this.prisma.client.business.findFirst({
      where: { id: businessId, ownerId: actor.id },
      select: { id: true },
    });
    if (owned) return;
    throw new ForbiddenException({ code: GMAIL_OWNER_ONLY, message: GMAIL_OWNER_ONLY_MESSAGE });
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
   * user stages nothing and calls no Google endpoint.
   *
   * One pending connection per (business, user): a newer consent replaces an
   * unconfirmed older one, and this business's pending rows past their window
   * are removed on the way.
   */
  async stagePendingConnection(state: OAuthState, code: string): Promise<{ pendingId: string }> {
    if (typeof state?.userId !== 'string' || state.userId.length === 0) {
      throw new BadRequestException('OAuth state names no user');
    }
    if (typeof code !== 'string' || code.length === 0) {
      throw new BadRequestException('Authorization code is required');
    }
    const tokens = await this.exchangeCodeForTokens(code);
    const userInfo = await this.getUserInfo(tokens.access_token);

    const now = Date.now();
    const db = this.prisma.client;
    await db.connectorAccount.deleteMany({
      where: {
        businessId: state.businessId,
        ...PENDING_ROW,
        OR: [
          { settings: { path: ['userId'], equals: state.userId } },
          { createdAt: { lt: new Date(now - PENDING_WINDOW_MS) } },
        ],
      },
    });

    const pendingId = `gmc_${randomBytes(24).toString('base64url')}`;
    const binding: PendingBinding = {
      purpose: 'gmail-connect',
      userId: state.userId,
      nonce: state.nonce,
      pendingExpiresAt: new Date(now + PENDING_WINDOW_MS).toISOString(),
    };
    await db.connectorAccount.create({
      data: {
        id: pendingId,
        businessId: state.businessId,
        ...PENDING_ROW,
        accountEmail: userInfo.email,
        accessTokenEncrypted: encryptToken(tokens.access_token),
        refreshTokenEncrypted: encryptToken(tokens.refresh_token ?? null),
        tokenExpiresAt: tokens.expires_in ? new Date(now + tokens.expires_in * 1000) : null,
        settings: { ...binding },
      },
    });

    this.logger.log(`Gmail connection staged for business ${state.businessId} by user ${state.userId}; awaiting confirmation`);
    return { pendingId };
  }

  /**
   * R0-CMF5: the confirmation, from an authenticated request. The owner rule is
   * checked first (a refused member reads no pending row), then the pending
   * connection must be this business's, staged for this user and inside its
   * window; anything else is GMAIL_PENDING_NOT_FOUND. The row is claimed
   * (deleted while still PENDING) before Business.gmail* is written, so a
   * pending id activates at most once even when two confirmations race.
   */
  async confirmPendingConnection(
    businessId: string,
    actor: GmailConnectActor | undefined,
    pendingId: string,
  ): Promise<{ connected: true; email: string }> {
    await this.assertConnectAuthority(businessId, actor);
    const actorId = (actor as GmailConnectActor).id;
    const db = this.prisma.client;

    const row = await db.connectorAccount.findFirst({
      where: { id: pendingId, businessId, ...PENDING_ROW },
    });
    if (!row) throw gmailPendingNotFound();

    const binding = (row.settings ?? {}) as Partial<PendingBinding>;
    if (binding.purpose !== 'gmail-connect' || binding.userId !== actorId) throw gmailPendingNotFound();
    const expiresAt = typeof binding.pendingExpiresAt === 'string' ? Date.parse(binding.pendingExpiresAt) : NaN;
    if (!(expiresAt > Date.now())) {
      await db.connectorAccount.deleteMany({ where: { id: row.id, businessId, status: PENDING_ROW.status } });
      throw gmailPendingNotFound();
    }

    const claimed = await db.connectorAccount.deleteMany({ where: { id: row.id, businessId, status: PENDING_ROW.status } });
    if (claimed.count !== 1) throw gmailPendingNotFound();

    const email = row.accountEmail as string;
    const refreshToken = decryptToken(row.refreshTokenEncrypted);
    await db.business.update({
      where: { id: businessId },
      data: {
        gmailEmail: email,
        gmailAccessToken: decryptToken(row.accessTokenEncrypted),
        // As before R0-CMF5: a consent that returned no refresh token keeps the stored one.
        gmailRefreshToken: refreshToken ?? undefined,
        gmailTokenExpiry: row.tokenExpiresAt,
      },
    });

    this.logger.log(`Gmail connected for business ${businessId} by user ${actorId}: ${email}`);
    return { connected: true, email };
  }

  async disconnectGmail(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        gmailEmail: null,
        gmailAccessToken: null,
        gmailRefreshToken: null,
        gmailTokenExpiry: null,
      },
    });
    this.logger.log(`Gmail disconnected for business ${businessId}`);
  }

  async getGmailStatus(businessId: string): Promise<{ connected: boolean; email: string | null }> {
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

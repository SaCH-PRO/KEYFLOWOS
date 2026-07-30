import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { timingSafeStringEqual } from '../../core/security/timing-safe-equal';
import { createHmac } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ConnectorActivityService } from '../../core/connectors/connector-activity.service';

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
}

const SCOPES = ['Contacts.ReadWrite', 'User.Read', 'offline_access'];

/**
 * Microsoft (Outlook) OAuth flow for the Outlook Contacts connector. Mirrors the
 * shape of GoogleSuiteService but is single-service: Outlook Contacts only.
 */
@Injectable()
export class MicrosoftOAuthService {
  private readonly logger = new Logger(MicrosoftOAuthService.name);
  private readonly clientId = process.env.MICROSOFT_CLIENT_ID;
  private readonly clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  private readonly tenant = process.env.MICROSOFT_TENANT || 'common';
  private readonly stateSecret = process.env.MICROSOFT_STATE_SECRET || process.env.GOOGLE_STATE_SECRET || '';
  private readonly redirectUri = process.env.MICROSOFT_REDIRECT_URI || '';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorActivityService) private readonly activity: ConnectorActivityService,
  ) {}

  buildAuthUrl(businessId: string): string {
    if (!this.clientId) {
      throw new BadRequestException('Microsoft OAuth not configured (MICROSOFT_CLIENT_ID missing)');
    }
    if (!this.redirectUri) {
      throw new BadRequestException('MICROSOFT_REDIRECT_URI not configured');
    }
    if (!this.stateSecret) {
      throw new BadRequestException('MICROSOFT_STATE_SECRET (or GOOGLE_STATE_SECRET) not configured');
    }
    const state: OAuthState = {
      businessId,
      nonce: Math.random().toString(36).slice(2),
      exp: Date.now() + 10 * 60 * 1000,
    };
    const signed = this.signState(state);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      response_mode: 'query',
      prompt: 'consent',
      state: signed,
    });
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, signedState: string) {
    const state = this.verifyState(signedState);
    if (!state) throw new BadRequestException('Invalid or expired OAuth state');
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Microsoft OAuth not configured');
    }

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
          code,
          scope: SCOPES.join(' '),
        }),
      },
    );
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      this.logger.error(`MS token exchange failed: ${err}`);
      throw new BadRequestException('Failed to exchange code for tokens');
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    let email = '';
    try {
      const ur = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (ur.ok) {
        const ui = (await ur.json()) as { mail?: string; userPrincipalName?: string };
        email = ui.mail || ui.userPrincipalName || '';
      }
    } catch (e) {
      this.logger.warn(`Failed to fetch MS userinfo: ${e instanceof Error ? e.message : e}`);
    }

    const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    await this.prisma.client.business.update({
      where: { id: state.businessId },
      data: {
        msContactsEmail: email || null,
        msContactsAccessToken: tokens.access_token,
        ...(tokens.refresh_token ? { msContactsRefreshToken: tokens.refresh_token } : {}),
        msContactsTokenExpiry: expiry,
      },
    });

    // Verify scope works with a cheap probe
    let ok = true;
    let error: string | null = null;
    try {
      const probe = await fetch('https://graph.microsoft.com/v1.0/me/contacts?$top=1', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!probe.ok) {
        ok = false;
        error = `Graph API ${probe.status}`;
      }
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : 'network error';
    }

    await this.prisma.client.connectorStatus.upsert({
      where: {
        businessId_connectorType: {
          businessId: state.businessId,
          connectorType: 'outlook_contacts',
        },
      },
      create: {
        businessId: state.businessId,
        connectorType: 'outlook_contacts',
        status: ok ? 'connected' : 'error',
        connectedAt: new Date(),
        connectedAccount: email || null,
        lastError: ok ? null : error,
        lastErrorAt: ok ? null : new Date(),
        errorCount: ok ? 0 : 1,
      },
      update: {
        status: ok ? 'connected' : 'error',
        connectedAt: new Date(),
        connectedAccount: email || null,
        lastError: ok ? null : error,
        lastErrorAt: ok ? null : new Date(),
        ...(ok ? { errorCount: 0 } : {}),
      },
    });
    await this.activity.record({
      businessId: state.businessId,
      connectorType: 'outlook_contacts',
      action: 'connect',
      status: ok ? 'success' : 'failure',
      message: ok
        ? `Connected Outlook Contacts (${email})`
        : `OAuth granted but live verification failed: ${error ?? 'unknown'}`,
    });
    return { businessId: state.businessId, email, ok, error };
  }

  private signState(state: OAuthState): string {
    const payload = JSON.stringify(state);
    const sig = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${sig}`).toString('base64');
  }

  private verifyState(signed: string): OAuthState | null {
    if (!this.stateSecret) return null;
    try {
      const decoded = Buffer.from(signed, 'base64').toString('utf-8');
      const i = decoded.lastIndexOf('.');
      if (i === -1) return null;
      const payload = decoded.slice(0, i);
      const sig = decoded.slice(i + 1);
      const expected = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
      if (!timingSafeStringEqual(sig, expected)) return null;
      const state: OAuthState = JSON.parse(payload);
      if (state.exp < Date.now()) return null;
      return state;
    } catch {
      return null;
    }
  }
}

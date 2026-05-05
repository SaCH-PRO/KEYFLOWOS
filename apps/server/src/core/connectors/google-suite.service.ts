import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import type { ConnectorType } from './connector.interface';

interface OAuthState {
  businessId: string;
  services: GoogleService[];
  nonce: string;
  exp: number;
}

export type GoogleService =
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'forms'
  | 'contacts'
  | 'business_profile';

const SERVICE_TO_CONNECTOR: Record<GoogleService, ConnectorType> = {
  gmail: 'gmail',
  calendar: 'google_calendar',
  drive: 'google_drive',
  forms: 'google_forms',
  contacts: 'google_contacts',
  business_profile: 'google_business_profile',
};

const SERVICE_SCOPES: Record<GoogleService, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  drive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
  ],
  forms: [
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.responses.readonly',
  ],
  contacts: ['https://www.googleapis.com/auth/contacts'],
  business_profile: ['https://www.googleapis.com/auth/business.manage'],
};

const COMMON_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

const ALL_SERVICES: GoogleService[] = [
  'gmail',
  'calendar',
  'drive',
  'forms',
  'contacts',
  'business_profile',
];

/**
 * Unified Google account OAuth flow that grants the union of scopes for all
 * requested services in a single consent screen and provisions all matching
 * connector tables.
 */
@Injectable()
export class GoogleSuiteService {
  private readonly logger = new Logger(GoogleSuiteService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly stateSecret = process.env.GOOGLE_STATE_SECRET;
  private readonly redirectUri =
    process.env.GOOGLE_SUITE_REDIRECT_URI ||
    process.env.GOOGLE_REDIRECT_URI?.replace(/\/[^/]+\/callback$/, '/google-suite/callback') ||
    '';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(ConnectorActivityService) private readonly activity: ConnectorActivityService,
  ) {}

  buildAuthUrl(businessId: string, services: GoogleService[] = ALL_SERVICES): string {
    if (!this.clientId) {
      throw new BadRequestException('Google OAuth not configured (GOOGLE_CLIENT_ID missing)');
    }
    if (!this.redirectUri) {
      throw new BadRequestException(
        'GOOGLE_SUITE_REDIRECT_URI not configured (and GOOGLE_REDIRECT_URI cannot be derived)',
      );
    }
    if (!this.stateSecret) {
      throw new BadRequestException('GOOGLE_STATE_SECRET not configured');
    }
    if (!services.length) services = ALL_SERVICES;

    const scopeSet = new Set<string>(COMMON_SCOPES);
    for (const s of services) {
      for (const sc of SERVICE_SCOPES[s]) scopeSet.add(sc);
    }

    const state: OAuthState = {
      businessId,
      services,
      nonce: Math.random().toString(36).slice(2),
      exp: Date.now() + 10 * 60 * 1000,
    };
    const signed = this.signState(state);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: Array.from(scopeSet).join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: signed,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleCallback(code: string, signedState: string) {
    const state = this.verifyState(signedState);
    if (!state) throw new BadRequestException('Invalid or expired OAuth state');
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Google OAuth not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      this.logger.error(`Token exchange failed: ${err}`);
      throw new BadRequestException('Failed to exchange code for tokens');
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    // Resolve user email
    let email = '';
    try {
      const ur = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (ur.ok) {
        const ui = (await ur.json()) as { email?: string };
        email = ui.email ?? '';
      }
    } catch (e) {
      this.logger.warn(`Failed to fetch userinfo: ${e instanceof Error ? e.message : e}`);
    }

    const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    const grantedScopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);

    // Provision per-service token columns. We always write to the columns whose
    // corresponding scope was actually granted (so partial grants work too).
    const data: Record<string, unknown> = { googleSuiteEmail: email || null };
    const enabledServices: GoogleService[] = [];

    for (const svc of state.services) {
      const required = SERVICE_SCOPES[svc];
      const allGranted = required.every((s) => grantedScopes.includes(s));
      if (!allGranted) {
        this.logger.warn(
          `Skipping ${svc}: required scopes not granted (got: ${grantedScopes.join(',')})`,
        );
        continue;
      }
      enabledServices.push(svc);
      const fields = this.fieldsForService(svc);
      data[fields.email] = email || null;
      data[fields.access] = tokens.access_token;
      if (tokens.refresh_token) data[fields.refresh] = tokens.refresh_token;
      data[fields.expiry] = expiry;
    }

    await this.prisma.client.business.update({ where: { id: state.businessId }, data });

    // Ironclad verification: for each provisioned service, do a cheap live API
    // call with the freshly-issued access token. Only mark `connected` if the
    // call succeeds; otherwise persist `error` with the upstream message so the
    // user immediately sees that the scope was granted but the API rejected us
    // (disabled API, no Business Profile account, sandbox mode, etc).
    const verified = await Promise.all(
      enabledServices.map(async (svc) => ({
        svc,
        ...(await this.verifyServiceLive(svc, tokens.access_token)),
      })),
    );

    for (const { svc, ok, account, error } of verified) {
      const ct = SERVICE_TO_CONNECTOR[svc];
      const displayAccount = account || email || null;
      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId: state.businessId, connectorType: ct } },
        create: {
          businessId: state.businessId,
          connectorType: ct,
          status: ok ? 'connected' : 'error',
          connectedAt: new Date(),
          connectedAccount: displayAccount,
          lastError: ok ? null : error,
          lastErrorAt: ok ? null : new Date(),
          errorCount: ok ? 0 : 1,
        },
        update: {
          status: ok ? 'connected' : 'error',
          connectedAt: new Date(),
          connectedAccount: displayAccount,
          lastError: ok ? null : error,
          lastErrorAt: ok ? null : new Date(),
          ...(ok ? { errorCount: 0 } : {}),
        },
      });
      await this.activity.record({
        businessId: state.businessId,
        connectorType: ct,
        action: 'connect',
        status: ok ? 'success' : 'failure',
        message: ok
          ? `Connected via unified Google sign-in (${email}) — live verification OK`
          : `OAuth granted but live verification failed: ${error ?? 'unknown error'}`,
      });
    }

    return {
      businessId: state.businessId,
      email,
      enabledServices,
      verification: verified.map((v) => ({ service: v.svc, ok: v.ok, error: v.error })),
    };
  }

  /**
   * Per-service live ping using a freshly-issued access token. Returns success
   * (and an optional account label) or an error message. Network failures are
   * treated as errors so the connector is not falsely marked Connected.
   */
  private async verifyServiceLive(
    svc: GoogleService,
    accessToken: string,
  ): Promise<{ ok: boolean; account: string | null; error: string | null }> {
    const auth = { Authorization: `Bearer ${accessToken}` };
    try {
      switch (svc) {
        case 'gmail': {
          const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth });
          if (!r.ok) return { ok: false, account: null, error: await this.errMsg(r, 'Gmail') };
          const j = (await r.json()) as { emailAddress?: string };
          return { ok: true, account: j.emailAddress ?? null, error: null };
        }
        case 'calendar': {
          // We only request the `calendar.events` scope, which does NOT cover
          // `calendarList`. Probe the primary calendar's events list instead —
          // that endpoint is authorized by `calendar.events` alone.
          const r = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=items(id)',
            { headers: auth },
          );
          if (!r.ok) return { ok: false, account: null, error: await this.errMsg(r, 'Calendar') };
          return { ok: true, account: null, error: null };
        }
        case 'drive': {
          const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: auth });
          if (!r.ok) return { ok: false, account: null, error: await this.errMsg(r, 'Drive') };
          const j = (await r.json()) as { user?: { emailAddress?: string } };
          return { ok: true, account: j.user?.emailAddress ?? null, error: null };
        }
        case 'forms': {
          // Google Forms API has no list/me endpoint covered by the
          // forms.body / forms.responses.readonly scopes — every read needs a
          // formId. Falling back to Drive would require Drive scopes which a
          // Forms-only consent does NOT grant. We've already validated above
          // that all required Forms scopes were granted, so trust the grant
          // here. Per-form access errors will surface on first real read.
          return { ok: true, account: null, error: null };
        }
        case 'contacts': {
          const r = await fetch(
            'https://people.googleapis.com/v1/people/me?personFields=emailAddresses',
            { headers: auth },
          );
          if (!r.ok) return { ok: false, account: null, error: await this.errMsg(r, 'Contacts') };
          return { ok: true, account: null, error: null };
        }
        case 'business_profile': {
          // Account Management v1 is the cheapest GBP probe. We treat ANY
          // failure (403 = API not enabled, 404 = no account, 5xx) as a hard
          // error so the connector card honestly reports it instead of
          // claiming Connected. Common case: the user granted the scope but
          // has no GBP account on this Google identity — handled below.
          const r = await fetch(
            'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
            { headers: auth },
          );
          if (!r.ok) return { ok: false, account: null, error: await this.errMsg(r, 'Business Profile') };
          const j = (await r.json()) as { accounts?: { name?: string; accountName?: string }[] };
          if (!j.accounts?.length) {
            return { ok: false, account: null, error: 'No Google Business Profile accounts found for this Google user' };
          }
          return { ok: true, account: j.accounts[0]?.accountName ?? null, error: null };
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Live verification network error for ${svc}: ${msg}`);
      return { ok: false, account: null, error: `Network error verifying ${svc}: ${msg}` };
    }
  }

  private async errMsg(r: Response, label: string): Promise<string> {
    let detail = '';
    try {
      const body = (await r.json()) as { error?: { message?: string; status?: string } };
      detail = body?.error?.message ?? body?.error?.status ?? '';
    } catch {
      // ignore parse failure
    }
    return `${label} API ${r.status}${detail ? `: ${detail}` : ''}`;
  }

  private fieldsForService(svc: GoogleService): {
    email: string;
    access: string;
    refresh: string;
    expiry: string;
  } {
    switch (svc) {
      case 'gmail':
        return {
          email: 'gmailEmail',
          access: 'gmailAccessToken',
          refresh: 'gmailRefreshToken',
          expiry: 'gmailTokenExpiry',
        };
      case 'calendar':
        return {
          email: 'calendarEmail',
          access: 'calendarAccessToken',
          refresh: 'calendarRefreshToken',
          expiry: 'calendarTokenExpiry',
        };
      case 'drive':
        return {
          email: 'driveEmail',
          access: 'driveAccessToken',
          refresh: 'driveRefreshToken',
          expiry: 'driveTokenExpiry',
        };
      case 'forms':
        return {
          email: 'formsEmail',
          access: 'formsAccessToken',
          refresh: 'formsRefreshToken',
          expiry: 'formsTokenExpiry',
        };
      case 'contacts':
        return {
          email: 'contactsEmail',
          access: 'contactsAccessToken',
          refresh: 'contactsRefreshToken',
          expiry: 'contactsTokenExpiry',
        };
      case 'business_profile':
        return {
          email: 'bpEmail',
          access: 'bpAccessToken',
          refresh: 'bpRefreshToken',
          expiry: 'bpTokenExpiry',
        };
    }
  }

  private signState(state: OAuthState): string {
    const payload = JSON.stringify(state);
    const sig = createHmac('sha256', this.stateSecret!).update(payload).digest('hex');
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
      if (sig !== expected) return null;
      const state: OAuthState = JSON.parse(payload);
      if (state.exp < Date.now()) return null;
      return state;
    } catch {
      return null;
    }
  }
}

export { ALL_SERVICES };

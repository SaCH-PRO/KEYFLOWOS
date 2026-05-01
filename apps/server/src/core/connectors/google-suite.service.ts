import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { ConnectorType } from './connector.interface';

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
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistryService,
    private readonly activity: ConnectorActivityService,
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

    // Mark connector statuses + record activity for each provisioned service.
    for (const svc of enabledServices) {
      const ct = SERVICE_TO_CONNECTOR[svc];
      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId: state.businessId, connectorType: ct } },
        create: {
          businessId: state.businessId,
          connectorType: ct,
          status: 'connected',
          connectedAt: new Date(),
          connectedAccount: email,
        },
        update: { status: 'connected', connectedAt: new Date(), connectedAccount: email },
      });
      await this.activity.record({
        businessId: state.businessId,
        connectorType: ct,
        action: 'connect',
        status: 'success',
        message: `Connected via unified Google sign-in (${email})`,
      });
    }

    return { businessId: state.businessId, email, enabledServices };
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

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, randomBytes } from 'crypto';
import { ContactImportedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from './crm.service';
import { oauthRedirect } from '../../core/config/runtime-urls';

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface OAuthState {
  businessId: string;
  nonce: string;
  exp: number;
}

interface GooglePerson {
  resourceName: string;
  etag?: string;
  names?: Array<{
    displayName?: string;
    givenName?: string;
    familyName?: string;
  }>;
  emailAddresses?: Array<{
    value?: string;
    type?: string;
  }>;
  phoneNumbers?: Array<{
    value?: string;
    type?: string;
  }>;
  organizations?: Array<{
    name?: string;
    title?: string;
  }>;
  photos?: Array<{
    url?: string;
  }>;
}

interface GoogleContactsResponse {
  connections?: GooglePerson[];
  nextPageToken?: string;
  nextSyncToken?: string;
  totalPeople?: number;
}

@Injectable()
export class CrmGoogleService {
  private readonly logger = new Logger(CrmGoogleService.name);
  private readonly clientId = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly redirectUri = process.env.GOOGLE_REDIRECT_URI
    || oauthRedirect('/api/crm/google/callback');
  private get stateSecret(): string {
    const secret = process.env.GOOGLE_STATE_SECRET;
    if (!secret) throw new BadRequestException('GOOGLE_STATE_SECRET environment variable is required');
    return secret;
  }

  private signState(state: OAuthState): string {
    const payload = JSON.stringify(state);
    const signature = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64');
  }

  verifyState(signedState: string): OAuthState | null {
    try {
      const decoded = Buffer.from(signedState, 'base64').toString('utf-8');
      const lastDotIndex = decoded.lastIndexOf('.');
      if (lastDotIndex === -1) return null;
      
      const payload = decoded.substring(0, lastDotIndex);
      const signature = decoded.substring(lastDotIndex + 1);
      
      const expectedSignature = createHmac('sha256', this.stateSecret).update(payload).digest('hex');
      if (signature !== expectedSignature) {
        this.logger.warn('Invalid OAuth state signature');
        return null;
      }
      
      const state: OAuthState = JSON.parse(payload);
      if (state.exp < Date.now()) {
        this.logger.warn('OAuth state expired');
        return null;
      }
      
      return state;
    } catch (err: any) {
      this.logger.warn('Failed to verify OAuth state');
      return null;
    }
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  getAuthUrl(businessId: string) {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Google OAuth not configured: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI');
    }
    
    const state: OAuthState = {
      businessId,
      nonce: randomBytes(16).toString('hex'),
      exp: Date.now() + 10 * 60 * 1000,
    };
    
    const signedState = this.signState(state);
    
    const scopes = [
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ];
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
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
      throw new BadRequestException('Google OAuth not configured');
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
      throw new BadRequestException('Google OAuth not configured');
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

  async fetchContacts(accessToken: string, pageToken?: string): Promise<GoogleContactsResponse> {
    const params = new URLSearchParams({
      personFields: 'names,emailAddresses,phoneNumbers,organizations,photos',
      pageSize: '1000',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(
      `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to fetch contacts: ${error}`);
      throw new BadRequestException('Failed to fetch Google contacts');
    }

    return response.json();
  }

  async importGoogleContacts(params: {
    businessId: string;
    accessToken: string;
    refreshToken?: string;
  }) {
    const { businessId, accessToken } = params;
    let allContacts: GooglePerson[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.fetchContacts(accessToken, pageToken);
      if (response.connections) {
        allContacts = allContacts.concat(response.connections);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    this.logger.log(`Fetched ${allContacts.length} contacts from Google`);

    let imported = 0;
    let skipped = 0;

    for (const person of allContacts) {
      const name = person.names?.[0];
      const email = person.emailAddresses?.[0]?.value;
      const phone = person.phoneNumbers?.[0]?.value;
      const org = person.organizations?.[0];

      if (!name?.givenName && !email && !phone) {
        skipped++;
        continue;
      }

      try {
        await this.crm.findOrCreateContact(businessId, {
          firstName: name?.givenName ?? undefined,
          lastName: name?.familyName ?? undefined,
          email: email ?? undefined,
          phone: phone ?? undefined,
          companyName: org?.name ?? undefined,
          source: 'google_contacts',
          sourceDetail: person.resourceName,
        });
        imported++;
      } catch (err: any) {
        this.logger.warn(`Failed to import contact: ${(err as Error).message}`);
        skipped++;
      }
    }

    if (imported > 0) {
      const payload: ContactImportedPayload = {
        businessId,
        source: 'google_contacts',
        count: imported,
      };
      this.events.emit('contact.imported', payload);
    }

    return {
      totalFetched: allContacts.length,
      imported,
      skipped,
    };
  }
}

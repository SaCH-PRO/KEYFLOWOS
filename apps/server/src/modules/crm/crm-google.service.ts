import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { timingSafeStringEqual } from '../../core/security/timing-safe-equal';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, randomBytes } from 'crypto';
import { ContactImportedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from './crm.service';
import { oauthRedirect } from '../../core/config/runtime-urls';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { assertGoogleConnectOwner } from '../../core/connectors/google-suite.controller';

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/**
 * W7-GOOGLE-IMPORT-SCOPE review repair (SEC-GIS-1, CR-W7G-1): the flow tag a
 * state minted by getAuthUrl carries. GOOGLE_STATE_SECRET also signs the
 * bookings calendar, Drive, Gmail and Google Suite states in the same
 * base64(payload.hmac) format, and the calendar one has this state's old
 * {businessId, nonce, exp} shape, so only the tag tells a CRM contact-import
 * state apart. The web proxy (apps/web/src/app/api/crm/google/callback) sends
 * every state whose flow is not 'drive' here, so this one still reaches it.
 */
const CRM_GOOGLE_CONTACTS_FLOW = 'crm-google-contacts';

interface OAuthState {
  flow: typeof CRM_GOOGLE_CONTACTS_FLOW;
  businessId: string;
  /** The member who asked for the auth URL: the actor the callback imports as. */
  memberId: string;
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
  /**
   * W7-GOOGLE-IMPORT-SCOPE review repair (SEC-GIS-3): nonces of states this
   * process has accepted, with their expiry; an entry leaves once its state
   * would have expired anyway. Per process, as the commerce Gmail and Google
   * Suite stores are (R0-07 ST-2, R0-CMF5 SEC-CMF5-R1).
   */
  private readonly acceptedStateNonces = new Map<string, number>();
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

  /**
   * The state the OAuth callback may complete, or null. Besides the signature
   * and expiry, W7-GOOGLE-IMPORT-SCOPE review repairs: SEC-GIS-1 / CR-W7G-1,
   * only a state getAuthUrl minted for the CRM contact import (its flow tag)
   * that names the business and the member it was issued to is good here, so a
   * bookings calendar, Drive, Gmail or Google Suite state signed with the same
   * secret is refused; SEC-GIS-3, a state is good for one callback (its nonce
   * is recorded when it is accepted), as the commerce Gmail state is since
   * R0-07, so a captured or logged callback URL cannot run the import again
   * within its 10 minutes.
   */
  verifyState(signedState: string): OAuthState | null {
    try {
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
      
      const state = JSON.parse(payload) as Partial<OAuthState> | null;
      const now = Date.now();
      if (!state || typeof state.exp !== 'number' || state.exp < now) {
        this.logger.warn('OAuth state expired');
        return null;
      }
      if (state.flow !== CRM_GOOGLE_CONTACTS_FLOW) {
        this.logger.warn('OAuth state was not issued for the CRM Google contact import');
        return null;
      }
      if (typeof state.businessId !== 'string' || state.businessId.length === 0
        || typeof state.memberId !== 'string' || state.memberId.length === 0) {
        this.logger.warn('OAuth state names no business or member');
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

      return state as OAuthState;
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

  /**
   * W7-GOOGLE-IMPORT-SCOPE review repair (SEC-GIS-2, CR-W7G-1): the URL is
   * issued only to a member the import would admit (assertCanImport: crm write
   * and allowed to create contacts), and its signed state names that member and
   * the CRM flow, so the OAuth callback imports as them.
   *
   * W8-GOOGLE-CONSENT-OWNER (owner ruling D-99): starting a Google connection,
   * Contacts included, is the business owner's, so the member must then also
   * pass the owner rule (assertGoogleConnectOwner: OWNER membership,
   * Business.ownerId or SUPER_ADMIN, else 403 GOOGLE_CONNECT_OWNER_ONLY). The
   * import door keeps its order (crm write, then create contacts, then the
   * owner) and the state still names the member, so the callback imports as
   * them under the CRM write door (assertCanImport, re-checked when it lands).
   * `memberRole` is the caller's platform role (req.user.role), for the
   * SUPER_ADMIN arm.
   */
  async getAuthUrl(businessId: string, memberId: string, memberRole?: string) {
    await this.assertCanImport(businessId, memberId);
    await assertGoogleConnectOwner(this.prisma, businessId, { id: memberId, role: memberRole });
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException('Google OAuth not configured: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI');
    }
    
    const state: OAuthState = {
      flow: CRM_GOOGLE_CONTACTS_FLOW,
      businessId,
      memberId,
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

  /**
   * Who may run a Google contact import into `businessId`: the door both
   * import routes go through, before Google is called.
   *
   * W7-GOOGLE-IMPORT-SCOPE (review finding ST-1) and its review repairs
   * (SEC-GIS-1, SEC-GIS-2, CR-W7G-1): the member needs crm write, as
   * ModuleScopeGuard grants it on POST google/import (SUPER_ADMIN passes;
   * otherwise the membership's scope map, or its role defaults), and must be
   * allowed to create contacts (CrmService.assertCanCreateContacts: crm_edit
   * 'none' is refused), as the CSV import is since R0-13. The OAuth callback
   * runs under no guard, so this is also where it re-checks the member its
   * state names, as they are when the callback lands rather than when the URL
   * was issued.
   */
  async assertCanImport(businessId: string, actorUserId: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.role !== 'SUPER_ADMIN') {
      const membership = await this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId: actorUserId, businessId } },
        select: { role: true, permissionScopes: true },
      });
      if (!membership) throw new ForbiddenException('Not a member of this business');
      const scopes = membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
      const level = scopes.crm || 'none';
      if (rankOf(level) < LEVEL_RANK.write) {
        throw new ForbiddenException(`Insufficient permissions: crm requires write access (you have ${level})`);
      }
    }
    await this.crm.assertCanCreateContacts(businessId, actorUserId);
  }

  /**
   * W7-GOOGLE-IMPORT-SCOPE (review finding ST-1): `actorUserId` is the
   * importing member: the authenticated caller of POST google/import, or the
   * member the OAuth callback's verified state names (review repairs SEC-GIS-1,
   * SEC-GIS-2, CR-W7G-1). There is no system-context import. A member the
   * import does not admit (assertCanImport: crm write, allowed to create
   * contacts) is refused 403 before Google is called, and every person goes
   * through findOrCreateContact with that actor: it is merged only into a
   * contact the member may edit (visible to them and inside their edit scope,
   * the door W6-CONNECT-TAG-MERGE applies to a sync's existing contacts), a
   * person matching one they may not edit is skipped and that contact left as
   * it was, and every contact write records the member (contact.created event,
   * created and updated audit entries).
   */
  async importGoogleContacts(params: {
    businessId: string;
    accessToken: string;
    refreshToken?: string;
    actorUserId: string;
  }) {
    const { businessId, accessToken, actorUserId } = params;
    if (!actorUserId) throw new ForbiddenException('Authentication required');
    await this.assertCanImport(businessId, actorUserId);
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
        }, actorUserId);
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

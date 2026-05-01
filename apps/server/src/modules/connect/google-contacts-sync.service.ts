import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleTokenHelper } from './google-token.helper';

interface PeopleConnection {
  resourceName: string;
  etag?: string;
  names?: Array<{ givenName?: string; familyName?: string; displayName?: string }>;
  emailAddresses?: Array<{ value: string; type?: string }>;
  phoneNumbers?: Array<{ value: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

@Injectable()
export class GoogleContactsSyncService {
  private readonly logger = new Logger(GoogleContactsSyncService.name);
  private readonly tokens: GoogleTokenHelper;

  constructor(private readonly prisma: PrismaService) {
    this.tokens = new GoogleTokenHelper(prisma);
  }

  private async accessToken(businessId: string): Promise<string> {
    return this.tokens.getValidAccessToken(
      businessId,
      { access: 'contactsAccessToken', refresh: 'contactsRefreshToken', expiry: 'contactsTokenExpiry' },
      'Google Contacts',
    );
  }

  private normalizeEmail(s: string | null | undefined): string | null {
    if (!s) return null;
    return s.trim().toLowerCase() || null;
  }

  private normalizePhone(s: string | null | undefined): string | null {
    if (!s) return null;
    const digits = s.replace(/[^\d+]/g, '');
    return digits || null;
  }

  /**
   * Pulls connections from Google People API, optionally using a previously stored
   * sync token for incremental updates. Upserts each into the Contact table and
   * tracks the Google resource name in ContactExternalMapping.
   */
  async sync(businessId: string): Promise<{ imported: number; updated: number }> {
    const token = await this.accessToken(businessId);
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsSyncToken: true },
    });

    let imported = 0;
    let updated = 0;
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
      const params = new URLSearchParams({
        personFields: 'names,emailAddresses,phoneNumbers,organizations,metadata',
        pageSize: '200',
        requestSyncToken: 'true',
      });
      if (business?.contactsSyncToken) params.set('syncToken', business.contactsSyncToken);
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(
        `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        if (res.status === 410) {
          await this.prisma.client.business.update({
            where: { id: businessId },
            data: { contactsSyncToken: null },
          });
          throw new BadRequestException('Sync token expired; please retry');
        }
        throw new BadRequestException(`People API error ${res.status}`);
      }
      const data = (await res.json()) as {
        connections?: PeopleConnection[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };

      for (const conn of data.connections ?? []) {
        const externalId = conn.resourceName;
        const name = conn.names?.[0];
        const firstName = name?.givenName ?? name?.displayName?.split(' ')[0] ?? null;
        const lastName = name?.familyName ?? null;
        const email = conn.emailAddresses?.[0]?.value ?? null;
        const phone = conn.phoneNumbers?.[0]?.value ?? null;
        const company = conn.organizations?.[0]?.name ?? null;
        const emailNorm = this.normalizeEmail(email);
        const phoneNorm = this.normalizePhone(phone);
        if (!emailNorm && !phoneNorm) continue;

        // Find existing via mapping first, then via normalized email/phone.
        const mapping = await this.prisma.client.contactExternalMapping.findUnique({
          where: {
            businessId_source_externalId: {
              businessId,
              source: 'google_contacts',
              externalId,
            },
          },
        });

        let contactId = mapping?.contactId;
        if (!contactId) {
          const existing = await this.prisma.client.contact.findFirst({
            where: {
              businessId,
              OR: [
                ...(emailNorm ? [{ emailNormalized: emailNorm }] : []),
                ...(phoneNorm ? [{ phoneNormalized: phoneNorm }] : []),
              ],
            },
            select: { id: true },
          });
          contactId = existing?.id;
        }

        if (contactId) {
          await this.prisma.client.contact.update({
            where: { id: contactId },
            data: {
              firstName: firstName ?? undefined,
              lastName: lastName ?? undefined,
              email: email ?? undefined,
              emailNormalized: emailNorm ?? undefined,
              phone: phone ?? undefined,
              phoneNormalized: phoneNorm ?? undefined,
              companyName: company ?? undefined,
            },
          });
          updated += 1;
        } else {
          const created = await this.prisma.client.contact.create({
            data: {
              businessId,
              firstName,
              lastName,
              email,
              emailNormalized: emailNorm,
              phone,
              phoneNormalized: phoneNorm,
              companyName: company,
              source: 'google_contacts',
              status: 'LEAD',
            },
          });
          contactId = created.id;
          imported += 1;
        }

        if (!mapping) {
          await this.prisma.client.contactExternalMapping
            .create({
              data: {
                businessId,
                contactId,
                source: 'google_contacts',
                externalId,
              },
            })
            .catch(() => undefined);
        }
      }

      pageToken = data.nextPageToken;
      if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    } while (pageToken);

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        contactsLastSyncAt: new Date(),
        ...(nextSyncToken ? { contactsSyncToken: nextSyncToken } : {}),
      },
    });

    return { imported, updated };
  }
}

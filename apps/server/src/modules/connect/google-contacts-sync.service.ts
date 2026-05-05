import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
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

export interface ContactMappingRules {
  defaultTags: string[];
  defaultStatus?: string | null;
  defaultOwnerId?: string | null;
  defaultLifecycleStage?: string | null;
}

const EMPTY_RULES: ContactMappingRules = {
  defaultTags: [],
  defaultStatus: null,
  defaultOwnerId: null,
  defaultLifecycleStage: null,
};

function parseRules(raw: unknown): ContactMappingRules {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RULES };
  const obj = raw as Record<string, unknown>;
  return {
    defaultTags: Array.isArray(obj.defaultTags)
      ? (obj.defaultTags as unknown[])
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .map((x) => (x as string).trim())
      : [],
    defaultStatus: typeof obj.defaultStatus === 'string' ? obj.defaultStatus : null,
    defaultOwnerId: typeof obj.defaultOwnerId === 'string' ? obj.defaultOwnerId : null,
    defaultLifecycleStage:
      typeof obj.defaultLifecycleStage === 'string' ? obj.defaultLifecycleStage : null,
  };
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

  /** Read mapping rules stored on the connector_status row metadata. */
  async getMappingRules(businessId: string): Promise<ContactMappingRules> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      select: { metadata: true },
    });
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    return parseRules(meta.mappingRules);
  }

  /** Persist mapping rules on the connector_status row metadata. */
  async saveMappingRules(
    businessId: string,
    rules: Partial<ContactMappingRules>,
  ): Promise<ContactMappingRules> {
    const next = parseRules({ ...(await this.getMappingRules(businessId)), ...rules });
    const existing = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      select: { metadata: true },
    });
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const merged = { ...meta, mappingRules: next };
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      create: {
        businessId,
        connectorType: 'google_contacts',
        status: 'disconnected',
        metadata: merged as unknown as Prisma.InputJsonValue,
      },
      update: { metadata: merged as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** Sync status snapshot for the contacts page header. */
  async getStatus(businessId: string) {
    const [business, status, total, importedCount, lastImported] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { contactsAccessToken: true, contactsEmail: true, contactsLastSyncAt: true },
      }),
      this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({
        where: { businessId, source: 'google_contacts', deletedAt: null },
      }),
      this.prisma.client.contactExternalMapping.findFirst({
        where: { businessId, source: 'google_contacts' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    const meta = (status?.metadata ?? {}) as Record<string, unknown>;
    const rules = parseRules(meta.mappingRules);
    return {
      connected: !!business?.contactsAccessToken,
      account: business?.contactsEmail ?? status?.connectedAccount ?? null,
      lastSyncAt: business?.contactsLastSyncAt ?? status?.lastSyncAt ?? null,
      lastImportAt: lastImported?.updatedAt ?? null,
      lastError: status?.lastError ?? null,
      lastErrorAt: status?.lastErrorAt ?? null,
      syncCount: status?.syncCount ?? 0,
      totalContacts: total,
      googleContacts: importedCount,
      mappingRules: rules,
      syncProgress: (meta.syncProgress as unknown) ?? null,
    };
  }

  /** Recently-touched Google contacts for the dashboard table. */
  async getRecent(businessId: string, limit = 25) {
    const mappings = await this.prisma.client.contactExternalMapping.findMany({
      where: { businessId, source: 'google_contacts' },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
      select: { contactId: true, externalId: true, updatedAt: true, createdAt: true },
    });
    if (mappings.length === 0) return [];
    const contacts = await this.prisma.client.contact.findMany({
      where: {
        id: { in: mappings.map((m) => m.contactId) },
        deletedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        companyName: true,
        status: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return mappings
      .map((m) => {
        const c = byId.get(m.contactId);
        if (!c) return null;
        return {
          ...c,
          externalId: m.externalId,
          syncedAt: m.updatedAt,
          firstSyncedAt: m.createdAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  private async applyDefaultsToNewContact(
    businessId: string,
    contactId: string,
    rules: ContactMappingRules,
  ) {
    const data: Prisma.ContactUpdateInput = {};
    if (rules.defaultTags.length > 0) {
      data.tags = { set: rules.defaultTags };
    }
    if (rules.defaultStatus) data.status = rules.defaultStatus;
    if (rules.defaultLifecycleStage) data.lifecycleStage = rules.defaultLifecycleStage;
    if (rules.defaultOwnerId) data.ownerId = rules.defaultOwnerId;
    if (Object.keys(data).length === 0) return;
    await this.prisma.client.contact
      .update({ where: { id: contactId }, data })
      .catch((e) => this.logger.warn(`Apply defaults failed for ${contactId}: ${(e as Error).message}`));
  }

  /**
   * Pulls connections from Google People API, optionally using a previously stored
   * sync token for incremental updates. Upserts each into the Contact table and
   * tracks the Google resource name in ContactExternalMapping.
   */
  /** Update only `metadata.syncProgress` on the connector status row. */
  private async writeProgress(
    businessId: string,
    progress: { phase: string; pagesFetched: number; processed: number; imported: number; updated: number; startedAt: string; finishedAt?: string },
  ) {
    try {
      const row = await this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
        select: { metadata: true },
      });
      const meta = (row?.metadata ?? {}) as Record<string, unknown>;
      const merged = { ...meta, syncProgress: progress };
      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
        create: {
          businessId,
          connectorType: 'google_contacts',
          status: 'connected',
          metadata: merged as unknown as Prisma.InputJsonValue,
        },
        update: { metadata: merged as unknown as Prisma.InputJsonValue },
      });
    } catch {
      /* progress is best-effort */
    }
  }

  async sync(businessId: string): Promise<{ imported: number; updated: number; matched: number; created: number; skipped: number; appliedRules: boolean }> {
    const token = await this.accessToken(businessId);
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsSyncToken: true },
    });
    const rules = await this.getMappingRules(businessId);
    const hasRules =
      rules.defaultTags.length > 0 ||
      !!rules.defaultStatus ||
      !!rules.defaultOwnerId ||
      !!rules.defaultLifecycleStage;

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let pagesFetched = 0;
    let processed = 0;
    const startedAt = new Date().toISOString();
    await this.writeProgress(businessId, {
      phase: 'starting',
      pagesFetched: 0,
      processed: 0,
      imported: 0,
      updated: 0,
      startedAt,
    });
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
        if (!emailNorm && !phoneNorm) {
          skipped += 1;
          continue;
        }
        processed += 1;

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
        let isNew = false;
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
          isNew = true;
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
        } else {
          await this.prisma.client.contactExternalMapping
            .update({
              where: { id: mapping.id },
              data: { updatedAt: new Date() },
            })
            .catch(() => undefined);
        }

        if (isNew && hasRules && contactId) {
          await this.applyDefaultsToNewContact(businessId, contactId, rules);
        }
      }

      pageToken = data.nextPageToken;
      if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
      pagesFetched += 1;
      await this.writeProgress(businessId, {
        phase: pageToken ? 'fetching' : 'finalizing',
        pagesFetched,
        processed,
        imported,
        updated,
        startedAt,
      });
    } while (pageToken);

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        contactsLastSyncAt: new Date(),
        ...(nextSyncToken ? { contactsSyncToken: nextSyncToken } : {}),
      },
    });
    const totalGoogle = await this.prisma.client.contact.count({
      where: { businessId, source: 'google_contacts', deletedAt: null },
    });
    const existingMeta = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      select: { metadata: true },
    });
    const baseMeta = (existingMeta?.metadata ?? {}) as Record<string, unknown>;
    const mergedMeta = {
      ...baseMeta,
      itemsCount: totalGoogle,
      itemsLabel: 'contacts',
    };

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      create: {
        businessId,
        connectorType: 'google_contacts',
        status: 'connected',
        lastSyncAt: new Date(),
        syncCount: 1,
        metadata: mergedMeta as unknown as Prisma.InputJsonValue,
      },
      update: {
        lastSyncAt: new Date(),
        syncCount: { increment: 1 },
        status: 'connected',
        lastError: null,
        lastErrorAt: null,
        metadata: mergedMeta as unknown as Prisma.InputJsonValue,
      },
    });

    await this.writeProgress(businessId, {
      phase: 'idle',
      pagesFetched,
      processed,
      imported,
      updated,
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    return {
      imported,
      updated,
      created: imported,
      matched: updated,
      skipped,
      appliedRules: hasRules,
    };
  }

  /**
   * Push a local KEYFLOW contact up to Google People API. Mirrors
   * OutlookContactsSyncService.pushContact so ContactSyncService can replicate
   * local edits to Google for any contact mapped via google_contacts.
   * Returns the external resourceName, or null if not mapped / failed.
   */
  async pushContact(businessId: string, contactId: string): Promise<string | null> {
    const token = await this.accessToken(businessId);
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        companyName: true,
        jobTitle: true,
        deletedAt: true,
      },
    });
    if (!contact) return null;
    const mapping = await this.prisma.client.contactExternalMapping.findFirst({
      where: { businessId, contactId, source: 'google_contacts' },
    });

    if (contact.deletedAt && mapping) {
      // People API uses resourceName (e.g. people/c123). DELETE expects
      // /v1/{resourceName}:deleteContact.
      await fetch(
        `https://people.googleapis.com/v1/${encodeURIComponent(mapping.externalId)}:deleteContact`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      ).catch(() => undefined);
      await this.prisma.client.contactExternalMapping
        .delete({ where: { id: mapping.id } })
        .catch(() => undefined);
      return null;
    }

    const body: Record<string, unknown> = {
      names: [
        {
          givenName: contact.firstName ?? undefined,
          familyName: contact.lastName ?? undefined,
        },
      ],
      emailAddresses: contact.email ? [{ value: contact.email }] : [],
      phoneNumbers: contact.phone ? [{ value: contact.phone }] : [],
      organizations:
        contact.companyName || contact.jobTitle
          ? [{ name: contact.companyName ?? undefined, title: contact.jobTitle ?? undefined }]
          : [],
    };

    if (mapping) {
      const updateMask = 'names,emailAddresses,phoneNumbers,organizations';
      // People API requires the latest etag for updates; fetch it first.
      const get = await fetch(
        `https://people.googleapis.com/v1/${encodeURIComponent(mapping.externalId)}?personFields=metadata`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      let etag: string | undefined;
      if (get.ok) {
        const j = (await get.json()) as { etag?: string };
        etag = j.etag;
      }
      const res = await fetch(
        `https://people.googleapis.com/v1/${encodeURIComponent(mapping.externalId)}:updateContact?updatePersonFields=${updateMask}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, ...(etag ? { etag } : {}) }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`PATCH google contact failed: ${res.status}`);
        return null;
      }
      return mapping.externalId;
    }

    const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.warn(`POST google contact failed: ${res.status}`);
      return null;
    }
    const created = (await res.json()) as { resourceName?: string };
    if (!created.resourceName) return null;
    await this.prisma.client.contactExternalMapping
      .create({
        data: {
          businessId,
          contactId,
          source: 'google_contacts',
          externalId: created.resourceName,
        },
      })
      .catch(() => undefined);
    return created.resourceName;
  }

  /** Disconnect Google Contacts: clear tokens and mark connector_status. */
  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        contactsAccessToken: null,
        contactsRefreshToken: null,
        contactsTokenExpiry: null,
        contactsSyncToken: null,
      },
    });
    await this.prisma.client.connectorStatus
      .upsert({
        where: {
          businessId_connectorType: { businessId, connectorType: 'google_contacts' },
        },
        create: { businessId, connectorType: 'google_contacts', status: 'disconnected' },
        update: { status: 'disconnected', connectedAt: null },
      })
      .catch(() => undefined);
  }
}

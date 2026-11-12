import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { canonicalContactStatus } from '../crm/crm.constants';
import { contactWhereWithId } from '../crm/crm.helpers';
import { CrmService } from '../crm/crm.service';
import { ContactAuditService } from '../crm/privacy/contact-audit.service';
import {
  RULES_CONFIGURED_BY,
  configuringMember,
  contactWritableBy,
  memberDefaultOwnerId,
  membersMayCreateContacts,
  settingDefaultContactStatus,
  settingDefaultOwnerId,
  syncAuditActor,
  syncPrincipals,
  syncTokenAdvances,
  syncWritesNothing,
  type SyncPrincipals,
} from './google-contacts-sync.service';
import { MicrosoftTokenHelper } from './microsoft-token.helper';

interface MsContact {
  id: string;
  givenName?: string | null;
  surname?: string | null;
  displayName?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  emailAddresses?: Array<{ address?: string; name?: string }>;
  mobilePhone?: string | null;
  businessPhones?: string[];
  homePhones?: string[];
  lastModifiedDateTime?: string;
  '@removed'?: { reason?: string };
}

export interface OutlookContactMappingRules {
  defaultTags: string[];
  defaultStatus?: string | null;
  defaultOwnerId?: string | null;
  defaultLifecycleStage?: string | null;
}

const EMPTY_RULES: OutlookContactMappingRules = {
  defaultTags: [],
  defaultStatus: null,
  defaultOwnerId: null,
  defaultLifecycleStage: null,
};

/**
 * D-92 (W5-D92-RESIDUALS): a rule is read, and so applied, through
 * canonicalContactStatus, as the Google Contacts rules are: a rule stored
 * before D-92 holding a legacy DORMANT or CUSTOMER reads as CLIENT, and one
 * holding a value with no ContactStatus reads as none.
 */
function parseRules(raw: unknown): OutlookContactMappingRules {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RULES };
  const obj = raw as Record<string, unknown>;
  return {
    defaultTags: Array.isArray(obj.defaultTags)
      ? (obj.defaultTags as unknown[])
          .filter((x) => typeof x === 'string' && (x as string).trim().length > 0)
          .map((x) => (x as string).trim())
      : [],
    defaultStatus: canonicalContactStatus(obj.defaultStatus as string | null | undefined),
    defaultOwnerId: typeof obj.defaultOwnerId === 'string' ? obj.defaultOwnerId : null,
    defaultLifecycleStage:
      typeof obj.defaultLifecycleStage === 'string' ? obj.defaultLifecycleStage : null,
  };
}

@Injectable()
export class OutlookContactsSyncService {
  private readonly logger = new Logger(OutlookContactsSyncService.name);
  private readonly tokens: MicrosoftTokenHelper;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(ContactAuditService) private readonly audit: ContactAuditService,
  ) {
    this.tokens = new MicrosoftTokenHelper(prisma);
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

  async getMappingRules(businessId: string): Promise<OutlookContactMappingRules> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      select: { metadata: true },
    });
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    return parseRules(meta.mappingRules);
  }

  /** W6-CONNECT-TAG-MERGE: the configuring member the stored rules record (saveMappingRules), or none. */
  private async rulesConfiguredBy(businessId: string): Promise<unknown> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      select: { metadata: true },
    });
    return ((row?.metadata ?? {}) as Record<string, unknown>)[RULES_CONFIGURED_BY];
  }

  async saveMappingRules(
    businessId: string,
    rules: Partial<OutlookContactMappingRules>,
    actorUserId?: string,
  ): Promise<OutlookContactMappingRules> {
    // D-92: refuse a status with no ContactStatus (400) before anything is read or written.
    const defaultStatus = settingDefaultContactStatus(rules.defaultStatus);
    const current = await this.getMappingRules(businessId);
    // SEC-D92R-3: a default owner is a member, and naming another needs crm_reassign (as on Google).
    const defaultOwnerId = await settingDefaultOwnerId(
      this.prisma,
      businessId,
      rules.defaultOwnerId,
      current.defaultOwnerId,
      actorUserId,
    );
    const next = parseRules({
      ...current,
      ...rules,
      ...(defaultStatus !== undefined ? { defaultStatus } : {}),
      ...(defaultOwnerId !== undefined ? { defaultOwnerId } : {}),
    });
    const existing = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      select: { metadata: true },
    });
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
    // W6-CONNECT-TAG-MERGE (SEC-D92R-2): the member saving the rules is the
    // member a sync writes existing contacts as, whoever runs it (as on Google).
    const configuredBy = configuringMember(businessId, actorUserId);
    const merged = { ...meta, mappingRules: next, ...(configuredBy ? { [RULES_CONFIGURED_BY]: configuredBy } : {}) };
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      create: {
        businessId,
        connectorType: 'outlook_contacts',
        status: 'disconnected',
        metadata: merged as unknown as Prisma.InputJsonValue,
      },
      update: { metadata: merged as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  async getStatus(businessId: string) {
    const [business, status, total, importedCount, lastImported] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          msContactsAccessToken: true,
          msContactsEmail: true,
          msContactsLastSyncAt: true,
        },
      }),
      this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({
        where: { businessId, source: 'outlook_contacts', deletedAt: null },
      }),
      this.prisma.client.contactExternalMapping.findFirst({
        where: { businessId, source: 'outlook_contacts' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    return {
      connected: !!business?.msContactsAccessToken,
      account: business?.msContactsEmail ?? status?.connectedAccount ?? null,
      lastSyncAt: business?.msContactsLastSyncAt ?? status?.lastSyncAt ?? null,
      lastImportAt: lastImported?.updatedAt ?? null,
      lastError: status?.lastError ?? null,
      lastErrorAt: status?.lastErrorAt ?? null,
      syncCount: status?.syncCount ?? 0,
      totalContacts: total,
      outlookContacts: importedCount,
      mappingRules: parseRules(((status?.metadata ?? {}) as Record<string, unknown>).mappingRules),
    };
  }

  async getRecent(businessId: string, limit = 25) {
    const mappings = await this.prisma.client.contactExternalMapping.findMany({
      where: { businessId, source: 'outlook_contacts' },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
      select: { contactId: true, externalId: true, updatedAt: true, createdAt: true },
    });
    if (mappings.length === 0) return [];
    const contacts = await this.prisma.client.contact.findMany({
      where: { id: { in: mappings.map((m) => m.contactId) }, deletedAt: null },
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
        return { ...c, externalId: m.externalId, syncedAt: m.updatedAt, firstSyncedAt: m.createdAt };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  /**
   * Pulls contacts from Microsoft Graph using delta queries for incremental sync.
   * https://learn.microsoft.com/graph/delta-query-contacts
   */
  async sync(businessId: string): Promise<{
    imported: number;
    updated: number;
    matched: number;
    created: number;
    skipped: number;
    deleted: number;
    appliedRules: boolean;
  }> {
    const token = await this.tokens.getValidAccessToken(businessId);
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { msContactsDeltaLink: true },
    });
    const stored = await this.getMappingRules(businessId);
    // SEC-D92R-3: the default owner is applied only while they are a member of this business.
    const rules: OutlookContactMappingRules = {
      ...stored,
      defaultOwnerId: await memberDefaultOwnerId(this.prisma, businessId, stored.defaultOwnerId),
    };
    const hasRules =
      rules.defaultTags.length > 0 ||
      !!rules.defaultStatus ||
      !!rules.defaultOwnerId ||
      !!rules.defaultLifecycleStage;
    // W6-CONNECT-TAG-MERGE (SEC-D92R-2; D-93; review SEC-W6CTM-2): the member
    // this sync writes as and records on every contact it writes (the member
    // who starts it), and every member each write must be allowed for.
    const principals = await syncPrincipals(this.prisma, businessId, await this.rulesConfiguredBy(businessId));
    const actor = principals.actor;
    // SEC-W6CTM-3: asked once, when the run first needs to create a contact.
    let mayCreate: boolean | undefined;

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let deleted = 0;
    // CR-CTM-3: the people and tombstones skipped because the run's members may not write them.
    let refused = 0;

    let nextUrl: string =
      business?.msContactsDeltaLink ||
      'https://graph.microsoft.com/v1.0/me/contacts/delta?$select=givenName,surname,displayName,emailAddresses,mobilePhone,businessPhones,homePhones,companyName,jobTitle,lastModifiedDateTime';

    let nextDeltaLink: string | undefined;

    do {
      const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 410) {
          // Delta token expired — clear it and force a full re-sync next call
          await this.prisma.client.business.update({
            where: { id: businessId },
            data: { msContactsDeltaLink: null },
          });
          throw new BadRequestException('Outlook delta token expired; please retry');
        }
        const body = await res.text().catch(() => '');
        throw new BadRequestException(`Graph API error ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        value?: MsContact[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      };

      for (const c of data.value ?? []) {
        // Tombstone (deleted contact) → soft-delete locally
        if (c['@removed']) {
          const map = await this.prisma.client.contactExternalMapping.findUnique({
            where: {
              businessId_source_externalId: {
                businessId,
                source: 'outlook_contacts',
                externalId: c.id,
              },
            },
          });
          if (map) {
            // W6-CONNECT-TAG-MERGE (SEC-D92R-2), review SEC-W6CTM-1 / CR-CTM-2:
            // a tombstone deletes the linked contact only through the CRM's own
            // delete door (deleteTombstoned); one the run's members may not
            // delete is left as it is (and stays linked), reported skipped.
            if (!(await this.deleteTombstoned(businessId, map.contactId, principals))) {
              skipped += 1;
              refused += 1;
              continue;
            }
            await this.prisma.client.contactExternalMapping
              .delete({ where: { id: map.id } })
              .catch(() => undefined);
            await this.prisma.client.contactSyncAudit.create({
              data: {
                businessId,
                contactId: map.contactId,
                source: 'outlook_contacts',
                externalId: c.id,
                action: 'deleted',
              },
            }).catch(() => undefined);
            deleted += 1;
          }
          continue;
        }

        const externalId = c.id;
        const firstName = c.givenName ?? c.displayName?.split(' ')[0] ?? null;
        const lastName = c.surname ?? null;
        const email = c.emailAddresses?.[0]?.address ?? null;
        const phone = c.mobilePhone ?? c.businessPhones?.[0] ?? c.homePhones?.[0] ?? null;
        const company = c.companyName ?? null;
        const jobTitle = c.jobTitle ?? null;
        const emailNorm = this.normalizeEmail(email);
        const phoneNorm = this.normalizePhone(phone);
        if (!emailNorm && !phoneNorm) {
          skipped += 1;
          continue;
        }

        const mapping = await this.prisma.client.contactExternalMapping.findUnique({
          where: {
            businessId_source_externalId: {
              businessId,
              source: 'outlook_contacts',
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
            select: { id: true, updatedAt: true },
          });
          contactId = existing?.id;
        }

        if (contactId) {
          // W6-CONNECT-TAG-MERGE (SEC-D92R-2; review SEC-W6CTM-2): an existing
          // contact is written only when every member of the run (the member
          // who starts it and the configuring member) may write it; one they
          // cannot open or edit is left as it is (not linked either) and
          // reported skipped.
          const local = await contactWritableBy(this.prisma, this.crm, businessId, contactId, principals.members);
          if (!local) {
            skipped += 1;
            refused += 1;
            continue;
          }
          // Most-recent-write-wins: only overwrite if Graph's lastModifiedDateTime
          // is newer than our updatedAt.
          const remoteTime = c.lastModifiedDateTime
            ? new Date(c.lastModifiedDateTime).getTime()
            : Date.now();
          const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
          if (remoteTime >= localTime) {
            const data = {
              firstName: firstName ?? undefined,
              lastName: lastName ?? undefined,
              email: email ?? undefined,
              emailNormalized: emailNorm ?? undefined,
              phone: phone ?? undefined,
              phoneNormalized: phoneNorm ?? undefined,
              companyName: company ?? undefined,
              jobTitle: jobTitle ?? undefined,
            };
            updated += 1;
            // CR-CTM-3: a contact read again whose values it already carries is not written.
            if (!syncWritesNothing(local, data)) {
              const after = await this.prisma.client.contact.update({ where: { id: contactId }, data });
              await this.audit.write({
                businessId,
                contactId,
                action: 'updated',
                before: local,
                after,
                actor: syncAuditActor(actor),
                reason: 'outlook_contacts sync',
              });
            }
            await this.prisma.client.contactSyncAudit
              .create({
                data: {
                  businessId,
                  contactId,
                  source: 'outlook_contacts',
                  externalId,
                  action: 'updated',
                  resolution: 'most_recent_write_wins',
                },
              })
              .catch(() => undefined);
          } else {
            await this.prisma.client.contactSyncAudit
              .create({
                data: {
                  businessId,
                  contactId,
                  source: 'outlook_contacts',
                  externalId,
                  action: 'conflict_resolved',
                  resolution: 'local_kept',
                },
              })
              .catch(() => undefined);
          }
        } else {
          // SEC-W6CTM-3: a contact is created only when the CRM create door
          // admits every member of the run; otherwise the person is skipped
          // (not created, not linked), never created in a refused member's name.
          mayCreate ??= await membersMayCreateContacts(this.crm, businessId, principals.members);
          if (!mayCreate) {
            skipped += 1;
            refused += 1;
            continue;
          }
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
              jobTitle,
              source: 'outlook_contacts',
              // D-92: only a ContactStatus; a rule naming none creates a LEAD.
              status: canonicalContactStatus(rules.defaultStatus) ?? 'LEAD',
              ...(rules.defaultLifecycleStage
                ? { lifecycleStage: rules.defaultLifecycleStage }
                : {}),
              ...(rules.defaultOwnerId ? { ownerId: rules.defaultOwnerId } : {}),
              ...(rules.defaultTags.length > 0 ? { tags: rules.defaultTags } : {}),
            },
          });
          contactId = created.id;
          imported += 1;
          // W6-CONNECT-TAG-MERGE: the contact a sync creates records the acting member too.
          await this.audit.write({
            businessId,
            contactId,
            action: 'created',
            after: created,
            actor: syncAuditActor(actor),
            reason: 'outlook_contacts sync',
          });
          await this.prisma.client.contactSyncAudit
            .create({
              data: {
                businessId,
                contactId,
                source: 'outlook_contacts',
                externalId,
                action: 'imported',
              },
            })
            .catch(() => undefined);
        }

        if (!mapping && contactId) {
          await this.prisma.client.contactExternalMapping
            .create({
              data: { businessId, contactId, source: 'outlook_contacts', externalId },
            })
            .catch(() => undefined);
        } else if (mapping) {
          await this.prisma.client.contactExternalMapping
            .update({ where: { id: mapping.id }, data: { updatedAt: new Date() } })
            .catch(() => undefined);
        }

      }

      if (data['@odata.deltaLink']) nextDeltaLink = data['@odata.deltaLink'];
      nextUrl = data['@odata.nextLink'] ?? '';
    } while (nextUrl);

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        msContactsLastSyncAt: new Date(),
        // CR-CTM-3: a run that refused a person or a tombstone keeps the delta link where it was.
        ...(nextDeltaLink && syncTokenAdvances(refused) ? { msContactsDeltaLink: nextDeltaLink } : {}),
      },
    });

    const totalOutlook = await this.prisma.client.contact.count({
      where: { businessId, source: 'outlook_contacts', deletedAt: null },
    });
    const existingMeta = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      select: { metadata: true },
    });
    const baseMeta = (existingMeta?.metadata ?? {}) as Record<string, unknown>;
    const mergedMeta = { ...baseMeta, itemsCount: totalOutlook, itemsLabel: 'contacts' };

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'outlook_contacts' } },
      create: {
        businessId,
        connectorType: 'outlook_contacts',
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

    return {
      imported,
      updated,
      created: imported,
      matched: updated,
      skipped,
      deleted,
      appliedRules: hasRules,
    };
  }

  /**
   * W6-CONNECT-TAG-MERGE review repairs SEC-W6CTM-1 and CR-CTM-2: apply a
   * Graph tombstone to the contact it is linked to. True when the tombstone is
   * applied (the caller then drops the link and counts it deleted), false when
   * the run's members may not delete the contact (it stays live and linked).
   *  - A link to no live contact of this business (a contact already in the
   *    trash) is applied without writing the contact: its trash date stays and
   *    only the link goes, so a contact restored from the trash (D-95) pushes
   *    to Outlook as a new contact instead of PATCHing the removed one. Before
   *    this repair such a tombstone was refused and the link kept.
   *  - A live contact is deleted only through the CRM's own delete door,
   *    CrmService.softDeleteContact, as the member who runs the sync: the rule
   *    DELETE contacts/:contactId applies (visibility, then delete scope:
   *    'none' refuses every contact, 'owned' refuses one someone else owns),
   *    with its contact.deleted ContactEvent and 'deleted' ContactAuditEntry
   *    naming that member. Every other member of the run (the configuring
   *    member) must be able to edit it too: their configuration bounds the run.
   *    Before this repair the sync deleted any contact the member could edit,
   *    so a crm write member (delete scope 'owned' by default) deleted contacts
   *    DELETE contacts/:contactId refuses them.
   */
  private async deleteTombstoned(businessId: string, contactId: string, principals: SyncPrincipals): Promise<boolean> {
    const live = await this.prisma.client.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
      select: { id: true },
    });
    if (!live) return true;
    const { actor, members } = principals;
    if (!actor) return false;
    const others = members.filter((m) => m !== actor);
    if (others.length > 0 && !(await contactWritableBy(this.prisma, this.crm, businessId, contactId, others))) {
      return false;
    }
    try {
      await this.crm.softDeleteContact(
        { businessId, contactId, actorUserId: actor },
        { actor: syncAuditActor(actor), reason: 'outlook_contacts sync' },
      );
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) return false;
      throw err;
    }
  }

  /**
   * Push a local KEYFLOW contact up to Outlook (bidirectional sync). Used by
   * ContactSyncService when a local edit needs to replicate. Returns the
   * external id created by Graph (or the existing one if updating).
   */
  async pushContact(businessId: string, contactId: string): Promise<string | null> {
    const token = await this.tokens.getValidAccessToken(businessId);
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
      where: { businessId, contactId, source: 'outlook_contacts' },
    });

    // Soft-deleted locally → delete remotely
    if (contact.deletedAt && mapping) {
      await fetch(`https://graph.microsoft.com/v1.0/me/contacts/${mapping.externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      await this.prisma.client.contactExternalMapping.delete({ where: { id: mapping.id } });
      return null;
    }

    const body = {
      givenName: contact.firstName ?? undefined,
      surname: contact.lastName ?? undefined,
      companyName: contact.companyName ?? undefined,
      jobTitle: contact.jobTitle ?? undefined,
      emailAddresses: contact.email
        ? [{ address: contact.email, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') }]
        : [],
      mobilePhone: contact.phone ?? undefined,
    };

    if (mapping) {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/contacts/${mapping.externalId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        this.logger.warn(`PATCH outlook contact failed: ${res.status}`);
        return null;
      }
      return mapping.externalId;
    }

    const res = await fetch('https://graph.microsoft.com/v1.0/me/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.warn(`POST outlook contact failed: ${res.status}`);
      return null;
    }
    const created = (await res.json()) as { id?: string };
    if (!created.id) return null;
    await this.prisma.client.contactExternalMapping
      .create({
        data: { businessId, contactId, source: 'outlook_contacts', externalId: created.id },
      })
      .catch(() => undefined);
    return created.id;
  }

  /** Disconnect Outlook Contacts: clear MS tokens and mark connector_status. */
  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        msContactsAccessToken: null,
        msContactsRefreshToken: null,
        msContactsTokenExpiry: null,
        msContactsDeltaLink: null,
      },
    });
    await this.prisma.client.connectorStatus
      .upsert({
        where: {
          businessId_connectorType: { businessId, connectorType: 'outlook_contacts' },
        },
        create: { businessId, connectorType: 'outlook_contacts', status: 'disconnected' },
        update: { status: 'disconnected', connectedAt: null },
      })
      .catch(() => undefined);
  }
}

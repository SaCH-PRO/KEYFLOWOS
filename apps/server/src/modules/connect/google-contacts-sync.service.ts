import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Contact } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { mergeConnectorMetadata } from '../../core/connectors/connector-metadata';
import { getTenantContext } from '../../core/tenant/tenant-context';
import { CONTACT_STATUSES, canonicalContactStatus, type ContactStatus } from '../crm/crm.constants';
import { resolveCrmAccess } from '../crm/crm-permissions.helper';
import { contactPhoneRead, livePhoneKeyHolderIds } from '../crm/crm-duplicate.util';
import { CrmService } from '../crm/crm.service';
import { ContactAuditService, type ContactAuditActor } from '../crm/privacy/contact-audit.service';
import { GoogleTokenHelper } from './google-token.helper';
import { providerFailure, providerUnavailable, readProviderFailureBody } from '../../core/connectors/provider-failure';

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

/**
 * D-92 (W5-D92-RESIDUALS): the default contact status an operator sets on a
 * connector rule (the Google and Outlook contact-sync rules, the connector form
 * mapping). Every stored Contact.status is one of CONTACT_STATUSES, so the
 * setting stores a status only through canonicalContactStatus: the vocabulary
 * in any case or padding as itself, the legacy CUSTOMER and DORMANT as CLIENT.
 * A value with no ContactStatus ('partner', 'churned', ACTIVE, a non-string)
 * is a 400 and nothing is stored. Undefined leaves the stored default as it
 * is; null or a blank clears it. Before D-92 the setting stored the value as
 * given, and every contact a sync or a form submission created took it.
 */
export function settingDefaultContactStatus(value: unknown): ContactStatus | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const status = typeof value === 'string' ? canonicalContactStatus(value) : null;
  if (!status) {
    throw new BadRequestException(
      `"${String(value)}" is not a contact status: use one of ${CONTACT_STATUSES.join(', ')}`,
    );
  }
  return status;
}

/** A user holding a membership of `businessId`: the check CrmService.assertNewOwnerIsMember makes. */
async function isBusinessMember(prisma: PrismaService, businessId: string, userId: string): Promise<boolean> {
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { id: true },
  });
  return !!membership;
}

/**
 * W5-D92-RESIDUALS review SEC-D92R-3: the default owner an operator sets on a
 * contact-sync rule (Google and Outlook) is the owner of every contact a sync
 * creates, so it is an assignment and takes the checks the CRM create, PATCH
 * and reassign paths make (R0-13d): naming a member other than yourself needs
 * crm_reassign (or OWNER / SUPER_ADMIN), 403 otherwise, and the owner must be
 * a member of this business (CrmService.assertNewOwnerIsMember), 400 for
 * another tenant's user, an unknown id or a non-string. Both are checked before
 * anything is written. The setting stored any id as given before.
 *
 * Undefined leaves the stored owner as it is, and null or a blank clears it.
 * The stored owner sent back unchanged (the web settings re-send every field
 * on each save) assigns no one and is kept without the checks; a sync applies
 * it only while it is a member (memberDefaultOwnerId).
 */
export async function settingDefaultOwnerId(
  prisma: PrismaService,
  businessId: string,
  value: unknown,
  storedOwnerId: string | null | undefined,
  actorUserId: string | undefined,
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const ownerId = typeof value === 'string' ? value.trim() : null;
  if (ownerId !== null && ownerId === storedOwnerId) return ownerId;
  if (ownerId !== null && actorUserId && ownerId !== actorUserId) {
    const access = await resolveCrmAccess(prisma, businessId, actorUserId);
    if (!access.isOwner && !access.isSuperAdmin && !access.reassign) {
      throw new ForbiddenException('You do not have permission to assign contacts to another member');
    }
  }
  if (ownerId === null || !(await isBusinessMember(prisma, businessId, ownerId))) {
    throw new BadRequestException('defaultOwnerId must belong to a member of this business');
  }
  return ownerId;
}

/**
 * SEC-D92R-3: the owner a sync gives the contacts it creates: the rule's
 * default owner while they are a member of this business, else none. A rule
 * stored before the setting checked it may name anyone, and a member may have
 * left since it was set.
 */
export async function memberDefaultOwnerId(
  prisma: PrismaService,
  businessId: string,
  ownerId: string | null | undefined,
): Promise<string | null> {
  if (!ownerId) return null;
  return (await isBusinessMember(prisma, businessId, ownerId)) ? ownerId : null;
}

/**
 * W6-CONNECT-TAG-MERGE (W5-D92-RESIDUALS review SEC-D92R-2; owner ruling
 * D-93): the key, in a contact-sync connector_status row's metadata, of the
 * member who last saved its rules (the configuring member). Only the server
 * writes it (saveMappingRules), beside mappingRules, which a client's body is
 * spread into, so a client cannot name it.
 */
export const RULES_CONFIGURED_BY = 'rulesConfiguredBy';

/**
 * W6-CONNECT-TAG-MERGE (SEC-D92R-2): the member a connector configuration save
 * records as its configuring member: the member the caller names (the contact
 * sync rules routes pass their caller), else the member the TenantInterceptor
 * bound to this request for this business (the connector form mapping route
 * does not pass its caller; read as CrmDealsService reads it, V1-89), else
 * none.
 */
export function configuringMember(businessId: string, actorUserId?: string | null): string | null {
  if (actorUserId) return actorUserId;
  const ctx = getTenantContext();
  return ctx?.userId && ctx.businessId === businessId ? ctx.userId : null;
}

/**
 * W6-CONNECT-TAG-MERGE (SEC-D92R-2; D-93), review repair SEC-W6CTM-2: who a
 * contact sync or a connector form backfill run writes contacts as.
 *  - `actor`: the member every CRM write door the run uses checks, and the
 *    member each contact it writes records (ContactAuditEntry, ContactEvent):
 *    the member whose request starts the run (the TenantInterceptor binds them
 *    to the request for this business; the sync, resync, sync-all and backfill
 *    routes are AuthGuard + BusinessGuard only, so any member may start one).
 *    Only a run no member's request starts (a system run) has no such member:
 *    it runs as the configuring member its configuration records, else (a
 *    configuration saved before W6, or never saved) as the business owner,
 *    read when it runs (D-93: a system-run job runs with the business owner as
 *    its member). Before this repair the owner fallback applied to a member's
 *    request too, so a crm 'none' member's sync rewrote the owner's PRIVATE
 *    contacts and the audit named the owner.
 *  - `members`: every member each write must be allowed for: the actor and
 *    the configuring member, whose configuration bounds every run whoever
 *    starts it.
 * A member who has since left the business is refused by every CRM door
 * (resolveCrmAccess refuses a non-member), so such a run writes nothing. No
 * actor and no members only for a business that does not exist.
 */
export interface SyncPrincipals {
  actor: string | null;
  members: string[];
}

export async function syncPrincipals(
  prisma: PrismaService,
  businessId: string,
  configuredBy: unknown,
): Promise<SyncPrincipals> {
  const ctx = getTenantContext();
  const requester = ctx?.userId && ctx.businessId === businessId ? ctx.userId : null;
  const configured = typeof configuredBy === 'string' && configuredBy ? configuredBy : null;
  let actor = requester ?? configured;
  if (!actor) {
    const business = await prisma.client.business.findUnique({
      where: { id: businessId },
      select: { ownerId: true },
    });
    actor = business?.ownerId ?? null;
  }
  const members = Array.from(new Set([actor, configured].filter((m): m is string => !!m)));
  return { actor, members };
}

/**
 * W6-CONNECT-TAG-MERGE (SEC-D92R-2): the existing contact a sync may write for
 * every one of `members`, read through the CRM's own edit check
 * (CrmService.assertCanEditContact, the check PATCH contacts/:contactId and the
 * enrichment route make): a live contact of this business, which a member who
 * is not the owner may write only when they can open it (the GET detail
 * visibility clause) and their edit scope reaches it. Null when one of them
 * may not, or when there is no member: the sync then leaves the contact
 * exactly as it is and reports it skipped. A sync wrote every contact it
 * matched before, the owner's PRIVATE ones and trashed ones included, and
 * recorded no actor.
 */
export async function contactWritableBy(
  prisma: PrismaService,
  crm: CrmService,
  businessId: string,
  contactId: string,
  members: readonly string[],
): Promise<Contact | null> {
  if (members.length === 0) return null;
  try {
    let reachable: Prisma.ContactWhereInput = {};
    for (const member of members) {
      ({ reachableWhere: reachable } = await crm.assertCanEditContact(businessId, contactId, member));
    }
    return await prisma.client.contact.findFirst({ where: reachable });
  } catch (err) {
    if (err instanceof NotFoundException || err instanceof ForbiddenException) return null;
    throw err;
  }
}

/**
 * FU-PHONE-COUNTRY-DUPLICATES (owner ruling D-211): a synced person's phone as
 * the CRM write stores it (contactPhoneRead: E.164 read under the business's
 * country, Business.country; a number typed with '+' as written; one that does
 * not read as typed) and its identity key. The Google and Outlook syncs keyed
 * the spelling ('868-555-0101' was '8685550101'), so a person whose number a
 * live contact holds in another spelling was created again.
 */
export type SyncPhone = ReturnType<typeof contactPhoneRead>;

/**
 * FU-PHONE-COUNTRY-DUPLICATES (D-211): the live contact a person who is not
 * linked yet is: the holder of their email (its key), else the oldest live
 * holder of their number in any spelling under the business's country
 * (livePhoneKeyHolderIds). Undefined when none is.
 */
export async function syncMatchedContactId(
  prisma: PrismaService,
  businessId: string,
  emailNorm: string | null,
  phone: SyncPhone,
  country: string | null,
): Promise<string | undefined> {
  if (emailNorm) {
    const byEmail = await prisma.client.contact.findFirst({
      where: { businessId, emailNormalized: emailNorm, deletedAt: null },
      select: { id: true },
    });
    if (byEmail) return byEmail.id;
  }
  const [holderId] = await livePhoneKeyHolderIds(prisma.client, businessId, phone, country);
  return holderId;
}

/**
 * FU-PHONE-COUNTRY-DUPLICATES (D-211): the phone fields a sync writes onto
 * `contactId`: the person's phone and its key, unless another live contact
 * holds that number (in any spelling, under the business's country); then
 * none, and the number stays with its holder. The sync wrote it before, so a
 * person matched by email took a number another contact holds (a second live
 * holder under another key, or a unique violation that ended the run).
 */
export async function syncPhoneFields(
  prisma: PrismaService,
  businessId: string,
  contactId: string,
  phone: SyncPhone,
  country: string | null,
): Promise<{ phone?: string; phoneNormalized?: string | null }> {
  if (!phone.phone) return {};
  if (phone.phoneNormalized) {
    const others = await livePhoneKeyHolderIds(prisma.client, businessId, phone, country, { exceptId: contactId });
    if (others.length > 0) return {};
  }
  return { phone: phone.phone, phoneNormalized: phone.phoneNormalized };
}

/**
 * W6-CONNECT-TAG-MERGE review repair SEC-W6CTM-3: whether a run may create
 * contacts: every one of `members` passes the CRM create door's own check
 * (CrmService.assertCanCreateContacts: a member, and an edit scope other than
 * 'none'). A run that may not creates nothing and reports the person skipped;
 * before, the sync created the contact and its audit entry named a member the
 * create door refuses. A run with no member (a business that does not exist)
 * is not refused here.
 */
export async function membersMayCreateContacts(
  crm: CrmService,
  businessId: string,
  members: readonly string[],
): Promise<boolean> {
  try {
    for (const member of members) await crm.assertCanCreateContacts(businessId, member);
    return true;
  } catch (err) {
    if (err instanceof ForbiddenException) return false;
    throw err;
  }
}

/**
 * W6-CONNECT-TAG-MERGE review repair CR-CTM-3: true when writing `data` would
 * change none of `row`'s fields (a value left undefined writes nothing). A
 * sync that reads a person again (its provider token held back, see
 * syncTokenAdvances) leaves a contact that already carries the person's
 * values as it is, with no audit entry.
 */
export function syncWritesNothing(row: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.entries(data).every(([key, value]) => value === undefined || row[key] === value);
}

/**
 * W6-CONNECT-TAG-MERGE review repair CR-CTM-3: whether a run stores the
 * provider's new sync token (People API nextSyncToken, Graph deltaLink). A
 * provider sends a person again after that token only when they change
 * remotely, so a run that refused a person (or tombstone) for its members
 * keeps the token where it was: the next run, whoever starts it and whatever
 * rules it runs under, reads them again. Before, the token advanced past them
 * and they were never written or linked, even after an owner took the rules
 * over. A person skipped for having no email or phone is not refused.
 */
export function syncTokenAdvances(refused: number): boolean {
  return refused === 0;
}

/** W6-CONNECT-TAG-MERGE: the ContactAuditEntry actor of a contact a sync writes (SYSTEM only with no acting member). */
export function syncAuditActor(actor: string | null): ContactAuditActor {
  return actor ? { type: 'USER', id: actor } : { type: 'SYSTEM' };
}

/**
 * D-92 (W5-D92-RESIDUALS): a rule is read, and so applied, through
 * canonicalContactStatus, because a rule stored before D-92 may hold any value:
 * a legacy DORMANT or CUSTOMER reads as CLIENT, and a value with no
 * ContactStatus reads as none (no status is written for it).
 */
function parseRules(raw: unknown): ContactMappingRules {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RULES };
  const obj = raw as Record<string, unknown>;
  return {
    defaultTags: Array.isArray(obj.defaultTags)
      ? (obj.defaultTags as unknown[])
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .map((x) => (x as string).trim())
      : [],
    defaultStatus: canonicalContactStatus(obj.defaultStatus as string | null | undefined),
    defaultOwnerId: typeof obj.defaultOwnerId === 'string' ? obj.defaultOwnerId : null,
    defaultLifecycleStage:
      typeof obj.defaultLifecycleStage === 'string' ? obj.defaultLifecycleStage : null,
  };
}

@Injectable()
export class GoogleContactsSyncService {
  private readonly logger = new Logger(GoogleContactsSyncService.name);
  private readonly tokens: GoogleTokenHelper;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(ContactAuditService) private readonly audit: ContactAuditService,
  ) {
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

  /** Read mapping rules stored on the connector_status row metadata. */
  async getMappingRules(businessId: string): Promise<ContactMappingRules> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      select: { metadata: true },
    });
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    return parseRules(meta.mappingRules);
  }

  /** W6-CONNECT-TAG-MERGE: the configuring member the stored rules record (saveMappingRules), or none. */
  private async rulesConfiguredBy(businessId: string): Promise<unknown> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      select: { metadata: true },
    });
    return ((row?.metadata ?? {}) as Record<string, unknown>)[RULES_CONFIGURED_BY];
  }

  /** Persist mapping rules on the connector_status row metadata. */
  async saveMappingRules(
    businessId: string,
    rules: Partial<ContactMappingRules>,
    actorUserId?: string,
  ): Promise<ContactMappingRules> {
    // D-92: refuse a status with no ContactStatus before anything is read or written.
    const defaultStatus = settingDefaultContactStatus(rules.defaultStatus);
    const current = await this.getMappingRules(businessId);
    // SEC-D92R-3: a default owner is a member, and naming another needs crm_reassign.
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
    // W6-CONNECT-TAG-MERGE (SEC-D92R-2): the member saving the rules is the
    // member a sync writes existing contacts as, whoever runs it.
    const configuredBy = configuringMember(businessId, actorUserId);
    // SWEEP-P0-FOLLOWUP (CW3-2 class): only the rules (and who configured them) are written, merged over the row as
    // it stands; the metadata read before is never written back (it holds the binder, boundBy).
    await mergeConnectorMetadata(this.prisma.client, businessId, 'google_contacts', {
      mappingRules: next,
      ...(configuredBy ? { [RULES_CONFIGURED_BY]: configuredBy } : {}),
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
    } catch (err: any) {
        this.logger.warn(`Progress is best-effort: ${err instanceof Error ? err.message : err}`);
      }
  }

  async sync(businessId: string): Promise<{ imported: number; updated: number; matched: number; created: number; skipped: number; appliedRules: boolean }> {
    const token = await this.accessToken(businessId);
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsSyncToken: true, country: true },
    });
    // D-211: a person's phone is read under the business's country, as POST .../contacts reads it.
    const country = business?.country ?? null;
    const stored = await this.getMappingRules(businessId);
    // SEC-D92R-3: the default owner is applied only while they are a member of this business.
    const rules: ContactMappingRules = {
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
    // CR-CTM-3: the people skipped because the run's members may not write them.
    let refused = 0;
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
      // W11-PROVIDER-OUTAGE-CONNECT (R-5 part 3; D-73): People not answering
      // (5xx, 408, 429, a rate-limited 403) is 503 provider_unavailable
      // (google_contacts), a refusal keeps its 400; the message is unchanged.
      if (!res.ok) {
        if (res.status === 410) {
          await this.prisma.client.business.update({
            where: { id: businessId },
            data: { contactsSyncToken: null },
          });
          // The sync token is cleared, so asking again does a full sync: a 503, as the message says.
          throw providerUnavailable('google_contacts', res.status, 'Sync token expired; please retry');
        }
        throw providerFailure('google_contacts', res.status, await readProviderFailureBody(res), `People API error ${res.status}`);
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
        const phoneRead = contactPhoneRead(phone, country);
        if (!emailNorm && !phoneRead.phoneNormalized) {
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
        if (!contactId) {
          // D-211: the holder of the email, else of the number in any spelling.
          contactId = await syncMatchedContactId(this.prisma, businessId, emailNorm, phoneRead, country);
        }

        if (contactId) {
          // W6-CONNECT-TAG-MERGE (SEC-D92R-2; review SEC-W6CTM-2): an existing
          // contact is written only when every member of the run (the member
          // who starts it and the configuring member) may write it; one they
          // cannot open or edit is left as it is (not linked either) and
          // reported skipped.
          const before = await contactWritableBy(this.prisma, this.crm, businessId, contactId, principals.members);
          if (!before) {
            skipped += 1;
            refused += 1;
            continue;
          }
          // D-211: the number as the CRM write stores it, unless another live contact holds it.
          const phoneFields = await syncPhoneFields(this.prisma, businessId, contactId, phoneRead, country);
          const data = {
            firstName: firstName ?? undefined,
            lastName: lastName ?? undefined,
            email: email ?? undefined,
            emailNormalized: emailNorm ?? undefined,
            phone: phoneFields.phone,
            phoneNormalized: phoneFields.phoneNormalized,
            companyName: company ?? undefined,
          };
          // CR-CTM-3: a person read again whose values the contact already carries writes nothing.
          // D-25 (FU-CONTACT-AUDIT-RESIDUAL): contact update and its audit entry commit atomically.
          if (!syncWritesNothing(before, data)) {
            const targetId = contactId;
            await this.prisma.client.$transaction(async (tx) => {
              const after = await tx.contact.update({ where: { id: targetId }, data });
              await this.audit.write(
                {
                  businessId,
                  contactId: targetId,
                  action: 'updated',
                  before,
                  after,
                  actor: syncAuditActor(actor),
                  reason: 'google_contacts sync',
                },
                tx,
              );
            });
          }
          updated += 1;
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
          // D-92 / D-25 (FU-CONTACT-AUDIT-RESIDUAL): contact create (with mapping defaults)
          // and its ContactAuditEntry commit atomically inside one transaction.
          const defaultStatus = hasRules ? canonicalContactStatus(rules.defaultStatus) : null;
          const created = await this.prisma.client.$transaction(async (tx) => {
            const row = await tx.contact.create({
              data: {
                businessId,
                firstName,
                lastName,
                email,
                emailNormalized: emailNorm,
                phone: phoneRead.phone,
                phoneNormalized: phoneRead.phoneNormalized,
                companyName: company,
                source: 'google_contacts',
                status: defaultStatus ?? 'LEAD',
                ...(hasRules && rules.defaultLifecycleStage ? { lifecycleStage: rules.defaultLifecycleStage } : {}),
                ...(hasRules && rules.defaultOwnerId ? { ownerId: rules.defaultOwnerId } : {}),
                ...(hasRules && rules.defaultTags.length > 0 ? { tags: rules.defaultTags } : {}),
              },
            });
            await this.audit.write(
              {
                businessId,
                contactId: row.id,
                action: 'created',
                after: row,
                actor: syncAuditActor(actor),
                reason: 'google_contacts sync',
              },
              tx,
            );
            return row;
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
        } else {
          await this.prisma.client.contactExternalMapping
            .update({
              where: { id: mapping.id },
              data: { updatedAt: new Date() },
            })
            .catch(() => undefined);
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
        // CR-CTM-3: a run that refused a person keeps the token where it was.
        ...(nextSyncToken && syncTokenAdvances(refused) ? { contactsSyncToken: nextSyncToken } : {}),
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

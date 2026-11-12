import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CrmService } from '../crm.service';
import { ApolloEnrichmentProvider } from './apollo-enrichment.provider';
import type { EnrichmentProvider } from './enrichment-provider';

/** Fields an enrichment result may fill. Each maps to a Contact column and is
 *  only ever written when the contact's own value is blank. */
const MAPPABLE_FIELDS = ['companyName', 'jobTitle', 'department', 'industry', 'city', 'state', 'country'] as const;
type MappableField = (typeof MAPPABLE_FIELDS)[number];

/** Don't re-hit a paid provider for the same contact within this window. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export type EnrichmentStatus =
  | 'not_configured'
  | 'skipped_recent'
  | 'provider_error'
  | 'no_match'
  | 'no_new_data'
  | 'enriched';

export interface EnrichmentOutcome {
  status: EnrichmentStatus;
  provider: string;
  /** Which Contact fields were populated (empty unless status === 'enriched'). */
  filled: MappableField[];
}

/**
 * Enriches CRM contacts from a third-party data provider.
 *
 * Two rules define the behaviour:
 *
 * 1. NEVER overwrite. Enrichment fills blanks only — a value the user or an
 *    import already set is authoritative and is left untouched. So enrichment
 *    can only ever add information, never contradict what's on the record.
 * 2. Go through the real write path. Filled fields are applied via
 *    CrmService.updateContact, so normalisation, access control, timeline
 *    events and cache invalidation all fire exactly as they do for a manual
 *    edit — enrichment isn't a side door into the contact table.
 *
 * Dark by default via the provider: with no APOLLO_API_KEY the provider is
 * disabled and every call returns `not_configured` without touching the row.
 * A `custom.enrichment` stamp records the last attempt (even a miss) so the
 * recent-guard can spare a paid lookup on the next call.
 */
@Injectable()
export class ContactEnrichmentService {
  private readonly logger = new Logger(ContactEnrichmentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly apollo: ApolloEnrichmentProvider,
  ) {}

  /** The active provider. A single adapter today; swap-point for a registry. */
  private get provider(): EnrichmentProvider {
    return this.apollo;
  }

  async enrichContact(input: {
    businessId: string;
    contactId: string;
    actorUserId?: string;
    force?: boolean;
  }): Promise<EnrichmentOutcome> {
    const provider = this.provider;
    if (!provider.enabled) {
      return { status: 'not_configured', provider: provider.key, filled: [] };
    }

    // Enforce the SAME contact-level check CrmService.updateContact enforces,
    // up front: before we read the row, spend a paid lookup or stamp any
    // metadata. A contact the caller cannot see answers 404 exactly like an
    // unknown id, so its email and name never reach the provider; a member
    // with crm:write but edit-scope owned/none cannot reach the direct stamp
    // below and mutate another contact's custom (and its cooldown).
    const reachableWhere = await this.assertCanEdit(input.businessId, input.contactId, input.actorUserId);

    const contact = await this.prisma.client.contact.findFirst({ where: reachableWhere });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const custom = (contact.custom as Record<string, unknown> | null) ?? {};
    const meta = custom.enrichment as { lastRunAt?: string } | undefined;
    if (!input.force && meta?.lastRunAt) {
      const age = Date.now() - Date.parse(meta.lastRunAt);
      if (Number.isFinite(age) && age < RECENT_MS) {
        return { status: 'skipped_recent', provider: provider.key, filled: [] };
      }
    }

    const outcome = await provider.enrich({
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.companyName,
      domain: domainFromEmail(contact.email),
    });

    // A transient failure must NOT be cooled down — no stamp, so the next call
    // retries. Only a genuine miss earns the 7-day guard.
    if (outcome.status === 'error') {
      return { status: 'provider_error', provider: provider.key, filled: [] };
    }
    if (outcome.status === 'no_match') {
      await this.stampAttempt(reachableWhere, custom, provider.key, []);
      return { status: 'no_match', provider: provider.key, filled: [] };
    }

    // Re-read immediately before deciding what to write: the provider call took
    // network time, during which a user or import may have filled a field. The
    // patch must be computed from the CURRENT row, not the pre-request snapshot,
    // so enrichment stays strictly additive.
    const fresh = await this.prisma.client.contact.findFirst({ where: reachableWhere });
    if (!fresh) {
      throw new NotFoundException('Contact not found');
    }
    const freshCustom = (fresh.custom as Record<string, unknown> | null) ?? {};

    const patch: Partial<Record<MappableField, string>> = {};
    const filled: MappableField[] = [];
    for (const field of MAPPABLE_FIELDS) {
      const incoming = outcome.result[field];
      if (incoming && isBlank(fresh[field])) {
        patch[field] = incoming;
        filled.push(field);
      }
    }

    if (filled.length === 0) {
      await this.stampAttempt(reachableWhere, freshCustom, provider.key, []);
      return { status: 'no_new_data', provider: provider.key, filled: [] };
    }

    await this.crm.updateContact({
      businessId: input.businessId,
      contactId: input.contactId,
      actorUserId: input.actorUserId,
      ...patch,
      custom: {
        ...freshCustom,
        enrichment: {
          provider: provider.key,
          lastRunAt: new Date().toISOString(),
          filled,
          raw: outcome.result.raw ?? null,
        },
      },
    });

    this.logger.log(
      `Enriched contact ${input.contactId} via ${provider.key}: filled ${filled.join(', ')}`,
    );
    return { status: 'enriched', provider: provider.key, filled };
  }

  /**
   * The contact-level edit check, delegated to CrmService.assertCanEditContact,
   * the very check updateContact applies (no mirror to drift from it, R0-13c
   * review CR-1): the GET visibility clause (a contact the caller cannot see is
   * 404 like an unknown id), then edit-scope 'none' denied and 'owned' limited
   * to contacts the actor owns or has shared; an owner/super-admin may edit
   * anything, and no actor (system/internal call) skips the check. Returns the
   * where clause of the row the caller may reach, which every read and the
   * direct-write stamp below use, so they carry the same guarantee.
   */
  private async assertCanEdit(businessId: string, contactId: string, actorUserId?: string): Promise<Prisma.ContactWhereInput> {
    const { reachableWhere } = await this.crm.assertCanEditContact(businessId, contactId, actorUserId);
    return reachableWhere;
  }

  /**
   * Record that we tried — even on a miss — so the recent-guard can skip a
   * repeat lookup. Written directly (no field change to route through the CRM
   * service) since this is provenance metadata, not contact data. Access is
   * already enforced up front by assertCanEdit, whose reachable row `where`
   * names.
   */
  private async stampAttempt(
    where: Prisma.ContactWhereInput,
    custom: Record<string, unknown>,
    providerKey: string,
    filled: MappableField[],
  ): Promise<void> {
    try {
      await this.prisma.client.contact.updateMany({
        where,
        data: {
          custom: {
            ...custom,
            enrichment: { provider: providerKey, lastRunAt: new Date().toISOString(), filled, raw: null },
          },
        },
      });
    } catch (err: unknown) {
      this.logger.warn(`Failed to stamp enrichment attempt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function domainFromEmail(email?: string | null): string | undefined {
  if (!email || !email.includes('@')) return undefined;
  const domain = email.split('@').pop()?.trim().toLowerCase();
  return domain || undefined;
}

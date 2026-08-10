import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CrmService } from '../crm.service';
import { contactWhereWithId } from '../crm.helpers';
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

    const contact = await this.prisma.client.contact.findFirst({
      where: contactWhereWithId(input.businessId, input.contactId),
    });
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

    const result = await provider.enrich({
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.companyName,
      domain: domainFromEmail(contact.email),
    });

    if (!result) {
      await this.stampAttempt(input.businessId, input.contactId, custom, provider.key, []);
      return { status: 'no_match', provider: provider.key, filled: [] };
    }

    // Fill blanks only.
    const patch: Partial<Record<MappableField, string>> = {};
    const filled: MappableField[] = [];
    for (const field of MAPPABLE_FIELDS) {
      const incoming = result[field];
      if (incoming && isBlank(contact[field])) {
        patch[field] = incoming;
        filled.push(field);
      }
    }

    if (filled.length === 0) {
      await this.stampAttempt(input.businessId, input.contactId, custom, provider.key, []);
      return { status: 'no_new_data', provider: provider.key, filled: [] };
    }

    await this.crm.updateContact({
      businessId: input.businessId,
      contactId: input.contactId,
      actorUserId: input.actorUserId,
      ...patch,
      custom: {
        ...custom,
        enrichment: {
          provider: provider.key,
          lastRunAt: new Date().toISOString(),
          filled,
          raw: result.raw ?? null,
        },
      },
    });

    this.logger.log(
      `Enriched contact ${input.contactId} via ${provider.key}: filled ${filled.join(', ')}`,
    );
    return { status: 'enriched', provider: provider.key, filled };
  }

  /**
   * Record that we tried — even on a miss — so the recent-guard can skip a
   * repeat lookup. Written directly (no field change to route through the CRM
   * service) since this is provenance metadata, not contact data.
   */
  private async stampAttempt(
    businessId: string,
    contactId: string,
    custom: Record<string, unknown>,
    providerKey: string,
    filled: MappableField[],
  ): Promise<void> {
    try {
      await this.prisma.client.contact.updateMany({
        where: contactWhereWithId(businessId, contactId),
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

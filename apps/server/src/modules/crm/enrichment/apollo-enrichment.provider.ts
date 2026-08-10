import { Injectable, Logger } from '@nestjs/common';
import type { EnrichmentProvider, EnrichmentQuery, EnrichmentResult } from './enrichment-provider';

interface ApolloPerson {
  id?: string;
  title?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  organization?: { name?: string | null; industry?: string | null } | null;
}

/**
 * Apollo.io adapter for contact enrichment (https://apolloapi.com).
 *
 * Same dark-by-default contract as the Langfuse and GrowthBook integrations:
 * with no APOLLO_API_KEY the provider reports `enabled = false` and the service
 * never calls it. Every failure path — unconfigured, no match, non-2xx, network
 * error, timeout — resolves to `null`, never a throw, so enrichment can never
 * break a contact write.
 *
 * Recommended first adapter for breadth; Lusha/ZoomInfo would be sibling classes
 * implementing the same EnrichmentProvider interface.
 */
@Injectable()
export class ApolloEnrichmentProvider implements EnrichmentProvider {
  readonly key = 'apollo';

  private readonly logger = new Logger(ApolloEnrichmentProvider.name);
  private readonly apiKey = process.env.APOLLO_API_KEY;
  private readonly baseUrl = (process.env.APOLLO_BASE_URL || 'https://api.apollo.io').replace(/\/+$/, '');
  private readonly timeoutMs = Number(process.env.APOLLO_TIMEOUT_MS) || 8000;

  readonly enabled: boolean;

  constructor() {
    this.enabled = !!this.apiKey;
    if (!this.enabled) {
      this.logger.log('APOLLO_API_KEY not set — contact enrichment disabled (enrich calls return "not_configured")');
    }
  }

  async enrich(query: EnrichmentQuery): Promise<EnrichmentResult | null> {
    if (!this.enabled) return null;

    // Apollo needs something to match on. An email is by far the strongest
    // signal; a bare name with no company would match noise, so require at
    // least one meaningful identifier.
    const hasName = !!(query.firstName || query.lastName);
    if (!query.email && !(hasName && (query.companyName || query.domain))) {
      return null;
    }

    try {
      const res = await fetch(`${this.baseUrl}/v1/people/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': this.apiKey as string,
        },
        body: JSON.stringify({
          email: query.email ?? undefined,
          first_name: query.firstName ?? undefined,
          last_name: query.lastName ?? undefined,
          organization_name: query.companyName ?? undefined,
          domain: query.domain ?? undefined,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        this.logger.warn(`Apollo people/match returned ${res.status}`);
        return null;
      }

      const data = (await res.json()) as { person?: ApolloPerson | null };
      const person = data.person;
      if (!person) return null;

      return {
        jobTitle: person.title ?? undefined,
        companyName: person.organization?.name ?? undefined,
        industry: person.organization?.industry ?? undefined,
        city: person.city ?? undefined,
        state: person.state ?? undefined,
        country: person.country ?? undefined,
        raw: person.id ? { apolloPersonId: person.id } : undefined,
      };
    } catch (err: unknown) {
      this.logger.warn(`Apollo enrich failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

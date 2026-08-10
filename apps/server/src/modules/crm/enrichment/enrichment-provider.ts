/**
 * Contact enrichment provider abstraction.
 *
 * A provider takes what we already know about a contact and returns whatever it
 * can find — company, title, industry, location. The interface is deliberately
 * narrow and provider-agnostic so Apollo today, Lusha or ZoomInfo tomorrow, all
 * plug in behind the same shape and the ContactEnrichmentService never learns
 * which one it's talking to.
 */

export interface EnrichmentQuery {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  /** Derived from the email host when present — the strongest match signal. */
  domain?: string | null;
}

/**
 * Normalised output. Every field maps 1:1 onto a KEYFLOW `Contact` column, so
 * the service never has to know a provider's native schema. All optional — a
 * provider fills only what it actually resolved.
 */
export interface EnrichmentResult {
  companyName?: string;
  jobTitle?: string;
  department?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  /** Opaque provenance kept on the contact for audit/debug (e.g. provider id). */
  raw?: Record<string, unknown>;
}

/**
 * Discriminated so the caller can tell a *genuine* miss (the person isn't in the
 * provider's data) from a *transient* failure (timeout, 429/5xx, bad JSON). That
 * distinction matters: a miss earns a cooldown, an error must not — else one
 * provider outage suppresses enrichment for the whole cooldown window.
 */
export type ProviderOutcome =
  | { status: 'match'; result: EnrichmentResult }
  | { status: 'no_match' }
  | { status: 'error' };

export interface EnrichmentProvider {
  /** Stable identifier stamped into enrichment provenance. */
  readonly key: string;
  /**
   * Dark-by-default: false when the provider has no credentials configured.
   * The service checks this before doing anything, so an unconfigured provider
   * is a clean no-op rather than a failed HTTP call.
   */
  readonly enabled: boolean;
  /**
   * Resolve a contact. MUST NOT throw — every failure is reported as
   * `{ status: 'error' }` so enrichment is best-effort and never breaks the
   * request that triggered it, while still being distinguishable from a miss.
   */
  enrich(query: EnrichmentQuery): Promise<ProviderOutcome>;
}

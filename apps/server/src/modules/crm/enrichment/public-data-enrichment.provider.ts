import { Injectable, Logger } from '@nestjs/common';
import type { EnrichmentProvider, EnrichmentQuery, ProviderOutcome } from './enrichment-provider';

/** Free email hosts carry no company signal — skip them. */
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'pm.me',
]);

/** ccTLD → ISO country, best-effort. Only the unambiguous ones. */
const CCTLD_COUNTRY: Record<string, string> = {
  uk: 'GB', gb: 'GB', us: 'US', ca: 'CA', au: 'AU', nz: 'NZ', ie: 'IE', de: 'DE', fr: 'FR',
  es: 'ES', it: 'IT', nl: 'NL', se: 'SE', no: 'NO', dk: 'DK', fi: 'FI', in: 'IN', sg: 'SG',
  za: 'ZA', br: 'BR', mx: 'MX', jp: 'JP', tt: 'TT',
};

/**
 * Free, in-house contact enrichment from public data only — no paid platform.
 *
 * This is the DEFAULT provider. It answers the enrichment question most small
 * businesses actually have — "what company is this person at?" — from the email
 * domain and that company's own public homepage. No account, no API key, no
 * per-lookup cost.
 *
 * What it deliberately does NOT do is verified person-level data (direct dial,
 * personal LinkedIn, confirmed title). That isn't available from free/public
 * sources at any quality, and pretending otherwise would mean fabricating facts
 * about a real person. That tier is the one legitimate reason to reach for a
 * paid broker (Apollo), which plugs in behind this same interface as an opt-in
 * upgrade — so nobody pays for the baseline.
 *
 * Always `enabled` (there's nothing to configure) and, like every provider,
 * never throws — any failure is reported as `error`, so it can't break a write.
 */
@Injectable()
export class PublicDataEnrichmentProvider implements EnrichmentProvider {
  readonly key = 'public-data';
  readonly enabled = true;

  private readonly logger = new Logger(PublicDataEnrichmentProvider.name);
  private readonly timeoutMs = Number(process.env.PUBLIC_ENRICH_TIMEOUT_MS) || 6000;

  async enrich(query: EnrichmentQuery): Promise<ProviderOutcome> {
    const domain = normalizeDomain(query.domain) ?? domainFromEmail(query.email);
    // No company domain to work from, and nothing else free to resolve → miss.
    if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) {
      return { status: 'no_match' };
    }

    try {
      const page = await this.fetchHomepage(domain);
      const companyName =
        page?.siteName ||
        page?.applicationName ||
        companyNameFromDomain(domain);
      const country = page?.localeCountry ?? countryFromTld(domain);

      // companyNameFromDomain always yields something, so we always have at
      // least the company name — a genuine, free result.
      return {
        status: 'match',
        result: {
          companyName,
          country: country ?? undefined,
          raw: {
            source: 'public-data',
            domain,
            website: `https://${domain}`,
            description: page?.description ?? null,
          },
        },
      };
    } catch (err: unknown) {
      this.logger.warn(`public-data enrich failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 'error' };
    }
  }

  private async fetchHomepage(domain: string): Promise<PageMeta | null> {
    try {
      const res = await fetch(`https://${domain}`, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'KeyflowBot/1.0 (+contact-enrichment)' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      // Cap the read: we only need the <head>. Big pages shouldn't be slurped.
      const html = (await res.text()).slice(0, 200_000);
      return parseHeadMeta(html);
    } catch {
      // A site that won't load is not an error for our purposes — we still fall
      // back to the domain-derived company name.
      return null;
    }
  }
}

interface PageMeta {
  siteName?: string;
  applicationName?: string;
  description?: string;
  localeCountry?: string;
}

function parseHeadMeta(html: string): PageMeta {
  const meta = (attr: 'property' | 'name', key: string): string | undefined => {
    const re = new RegExp(
      `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`,
      'i',
    );
    const m = html.match(re) ?? html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["']`, 'i'),
    );
    return m?.[1]?.trim() || undefined;
  };

  const localeRaw = meta('property', 'og:locale'); // e.g. en_US
  const localeCountry = localeRaw?.includes('_')
    ? localeRaw.split('_')[1]?.toUpperCase()
    : undefined;

  return {
    siteName: meta('property', 'og:site_name'),
    applicationName: meta('name', 'application-name'),
    description: meta('name', 'description') ?? meta('property', 'og:description'),
    localeCountry,
  };
}

function normalizeDomain(domain?: string | null): string | undefined {
  if (!domain) return undefined;
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return d.includes('.') ? d : undefined;
}

function domainFromEmail(email?: string | null): string | undefined {
  if (!email || !email.includes('@')) return undefined;
  return normalizeDomain(email.split('@').pop());
}

/** acme-corp.com → "Acme Corp". Deterministic fallback when the site has no
 *  og:site_name. */
function companyNameFromDomain(domain: string): string {
  const sld = domain.replace(/^www\./, '').split('.')[0] ?? domain;
  return sld
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function countryFromTld(domain: string): string | undefined {
  const tld = domain.split('.').pop()?.toLowerCase();
  return tld ? CCTLD_COUNTRY[tld] : undefined;
}

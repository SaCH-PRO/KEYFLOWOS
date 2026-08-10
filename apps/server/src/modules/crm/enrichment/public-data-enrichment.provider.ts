import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
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

    let page: PageMeta | null;
    try {
      page = await this.fetchHomepage(domain);
    } catch (err: unknown) {
      // A genuine network/timeout failure is transient — report it as error so
      // the service doesn't cool the contact down for a week over a blip.
      this.logger.warn(`public-data enrich failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 'error' };
    }

    // Do NOT fabricate. If we could not reach a public homepage — unreachable
    // host, typo domain (gmial.com), non-2xx, or a blocked private/internal
    // target — we have not confirmed a real company, so it's a miss. The
    // domain-derived name is only trusted once the site itself has answered.
    if (!page) {
      return { status: 'no_match' };
    }

    return {
      status: 'match',
      result: {
        companyName: page.siteName || page.applicationName || companyNameFromDomain(domain),
        country: page.localeCountry ?? countryFromTld(domain) ?? undefined,
        raw: {
          source: 'public-data',
          domain,
          website: `https://${domain}`,
          description: page.description ?? null,
        },
      },
    };
  }

  /**
   * Fetch a homepage safely. The domain comes from a user-controlled contact
   * email, so this is an SSRF surface: every hop's host is DNS-resolved and
   * rejected if it points at a loopback/link-local/private/metadata address,
   * redirects are followed MANUALLY (so each Location is re-validated rather
   * than blindly chased into an internal service), and the body is read with a
   * real streamed byte cap.
   *
   * Returns null for anything that isn't a reachable public homepage — a
   * blocked target, a redirect with no Location, a non-2xx, or too many hops.
   * Throws only on a genuine transport failure (caller maps that to `error`).
   *
   * Residual: classic DNS-rebinding (public at check, private at connect) isn't
   * fully closed — undici doesn't expose connect-IP pinning — but the practical
   * vectors (email at localhost / 169.254.169.254 / a redirect to metadata) are.
   */
  private async fetchHomepage(domain: string): Promise<PageMeta | null> {
    let url = `https://${domain}`;
    for (let hop = 0; hop < 4; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

      // Block internal targets. A failed/blocked check means "not a usable
      // public site" (deterministic) → null, not a thrown error.
      try {
        await assertPublicHost(parsed.hostname);
      } catch {
        return null;
      }

      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'KeyflowBot/1.0 (+contact-enrichment)' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return null;
        url = new URL(location, url).toString(); // re-validated at the top of the next loop
        continue;
      }
      if (!res.ok) return null;

      return parseHeadMeta(await readCapped(res, 200_000));
    }
    return null; // redirect loop / too many hops
  }
}

/** Read at most `maxBytes` from the body, cancelling the stream once reached, so
 *  a hostile domain can't make the process buffer an arbitrarily large body. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8').slice(0, maxBytes);
}

/** Reject hosts that resolve to non-public addresses (SSRF guard). */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`blocked host: ${host}`);
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`blocked ip: ${host}`);
    return;
  }
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0) throw new Error(`no address for ${host}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error(`blocked resolved ip: ${address}`);
  }
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127 || a === 10) return true; // this-host, loopback, private
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice('::ffff:'.length)); // IPv4-mapped
  if (v.startsWith('fe80')) return true; // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local fc00::/7
  return false;
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

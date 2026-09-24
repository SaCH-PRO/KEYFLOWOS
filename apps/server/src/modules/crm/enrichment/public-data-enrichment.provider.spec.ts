import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { lookup } from 'node:dns/promises';
import { PublicDataEnrichmentProvider } from './public-data-enrichment.provider';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

/**
 * The free provider's promises: it never fabricates a person, it only returns a
 * company once a real public homepage has answered (no guessing from an
 * unreachable/typo domain), it refuses to fetch internal/private targets (SSRF),
 * it skips generic email hosts, and it never throws on a bad site.
 */
function publicDns() {
  (lookup as Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
}
function htmlResponse(html: string) {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

describe('PublicDataEnrichmentProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is always enabled and needs no configuration', () => {
    expect(new PublicDataEnrichmentProvider().enabled).toBe(true);
  });

  it('returns no_match for a generic email host without touching DNS or the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await new PublicDataEnrichmentProvider().enrich({ email: 'someone@gmail.com' });

    expect(out.status).toBe('no_match');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reads company name from og:site_name and country from og:locale', async () => {
    publicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      htmlResponse('<head><meta property="og:site_name" content="Acme Corporation"><meta property="og:locale" content="en_US"></head>'),
    );

    const out = await new PublicDataEnrichmentProvider().enrich({ email: 'jane@acme.com' });

    expect(out.status).toBe('match');
    if (out.status !== 'match') throw new Error('unreachable');
    expect(out.result.companyName).toBe('Acme Corporation');
    expect(out.result.country).toBe('US');
  });

  it('falls back to a domain-derived name + ccTLD country for a reachable site with no metadata', async () => {
    publicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html><body>hi</body></html>'));

    const out = await new PublicDataEnrichmentProvider().enrich({ email: 'ceo@bright-widgets.co.uk' });

    expect(out.status).toBe('match');
    if (out.status !== 'match') throw new Error('unreachable');
    expect(out.result.companyName).toBe('Bright Widgets');
    expect(out.result.country).toBe('GB');
  });

  it('does NOT fabricate a company for an unreachable/typo domain', async () => {
    // DNS resolution fails (e.g. gmial.com) → no public source reached → miss.
    (lookup as Mock).mockRejectedValue(new Error('ENOTFOUND'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const out = await new PublicDataEnrichmentProvider().enrich({ email: 'jane@gmial.com' });

    expect(out.status).toBe('no_match');
    expect(fetchSpy).not.toHaveBeenCalled(); // blocked before any request
  });

  it('refuses to fetch a domain that resolves to a private/internal address (SSRF)', async () => {
    (lookup as Mock).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const out = await new PublicDataEnrichmentProvider().enrich({ email: 'admin@internal.example' });

    expect(out.status).toBe('no_match');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a domain resolving to the cloud metadata address', async () => {
    (lookup as Mock).mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const out = await new PublicDataEnrichmentProvider().enrich({ email: 'x@evil.example' });

    expect(out.status).toBe('no_match');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

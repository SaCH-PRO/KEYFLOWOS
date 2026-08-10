import { describe, it, expect, afterEach, vi } from 'vitest';
import { PublicDataEnrichmentProvider } from './public-data-enrichment.provider';

/**
 * The free provider's promises: it never fabricates a person, it always yields
 * at least a company name for a real business domain (falling back to the
 * domain itself when the site gives nothing), it skips generic email hosts, and
 * it never throws. All offline — fetch is mocked.
 */
function htmlResponse(html: string) {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

describe('PublicDataEnrichmentProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is always enabled and needs no configuration', () => {
    expect(new PublicDataEnrichmentProvider().enabled).toBe(true);
  });

  it('returns no_match for a generic email host (no company signal) without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const svc = new PublicDataEnrichmentProvider();

    const out = await svc.enrich({ email: 'someone@gmail.com' });

    expect(out.status).toBe('no_match');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads the company name from og:site_name and country from og:locale', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      htmlResponse('<head><meta property="og:site_name" content="Acme Corporation"><meta property="og:locale" content="en_US"></head>'),
    );
    const svc = new PublicDataEnrichmentProvider();

    const out = await svc.enrich({ email: 'jane@acme.com' });

    expect(out.status).toBe('match');
    if (out.status !== 'match') throw new Error('unreachable');
    expect(out.result.companyName).toBe('Acme Corporation');
    expect(out.result.country).toBe('US');
    expect(out.result.raw?.domain).toBe('acme.com');
  });

  it('falls back to a domain-derived name when the site has no metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html><body>no head meta</body></html>'));
    const svc = new PublicDataEnrichmentProvider();

    const out = await svc.enrich({ email: 'ceo@bright-widgets.com' });

    expect(out.status).toBe('match');
    if (out.status !== 'match') throw new Error('unreachable');
    expect(out.result.companyName).toBe('Bright Widgets');
  });

  it('still returns the domain-derived name (not an error) when the site is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
    const svc = new PublicDataEnrichmentProvider();

    const out = await svc.enrich({ email: 'jane@acme.co.uk' });

    expect(out.status).toBe('match');
    if (out.status !== 'match') throw new Error('unreachable');
    expect(out.result.companyName).toBe('Acme');
    expect(out.result.country).toBe('GB'); // from the .uk ccTLD
  });
});

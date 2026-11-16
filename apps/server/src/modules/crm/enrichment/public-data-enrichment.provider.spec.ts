/**
 * TOF-WEBSITE-ENRICHMENT (V1-63; #63, PRS-M14; owner ruling D-188 'enrichment'):
 * the website source of contact enrichment, written fresh on main's outbound
 * address guard (core/security/outbound-address.ts), not ported from the
 * archived #63 snapshot (whose own guard checked a name and let fetch resolve
 * it again).
 *
 * What is proven here, with no real network traffic:
 * - The source is off unless CONTACT_WEBSITE_ENRICHMENT is on, and counts as
 *   configured for a contact only when the contact has a business website:
 *   the domain of a work email address. A free-mail address, no email or a
 *   domain that is not a public DNS name gives no website, and nothing is
 *   resolved or fetched for it.
 * - Every fetch and every redirect hop goes through the guard: the host is
 *   resolved once (resolvePublicAddress) and refused when any answer is not
 *   public; the request goes through a PinnedDispatcher pinned to the checked
 *   answers (so a rebinding resolver's second answer is never used) with
 *   redirect 'manual'; each redirect target is checked the same way before it
 *   is asked for anything. 127.0.0.1, 10.x, 169.254.169.254, a public host
 *   redirecting to a private one and a rebinding resolver are refused before
 *   any socket: the fetch tap records no request to them and
 *   net.Socket.prototype.connect is never called.
 * - The fetch is bounded: http and https on their default ports only, at most
 *   WEBSITE_MAX_REDIRECTS redirects, html only, at most WEBSITE_MAX_BYTES read,
 *   one deadline for the whole lookup (headers and body).
 * - Parsing is linear and reads only what the site itself declares (its
 *   schema.org Organization data, og:site_name, application-name); nothing is
 *   made up from the domain name.
 *
 * The resolver (node:dns promises lookup, the one the guard calls) is stubbed
 * from a table, fetch is a tap that records each request and answers from a
 * table of pages (it never opens a socket), and net.Socket.prototype.connect is
 * a spy that refuses, so a socket opened by any path would be seen and would
 * not connect. The names end in .invalid, which never resolves for real.
 */
import net from 'node:net';
import { promises as dnsPromises } from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinnedDispatcher, pinnedLookup } from '../../../core/security/outbound-address';
import {
  PublicDataEnrichmentProvider,
  WEBSITE_ENRICHMENT_FLAG,
  WEBSITE_MAX_BYTES,
  WEBSITE_MAX_REDIRECTS,
  readWebsiteFacts,
  websiteFor,
} from './public-data-enrichment.provider';

type Answer = { address: string; family: 4 | 6 };

const PUBLIC_V4 = '93.184.215.14';
const PUBLIC_V4_B = '93.184.215.15';
const PUBLIC_V6 = '2606:4700:4700::1111';

/** The resolver's answers, per host: a list, or a function of how many times the host was asked. */
let answers: Record<string, Answer[] | ((ask: number) => Answer[])> = {};
const asked: Record<string, number> = {};

/** The pages the fetch tap serves, per URL. */
let pages: Record<string, (init: RequestInit & { signal?: AbortSignal }) => Response | Promise<Response>> = {};
const tapped: Array<{ url: string; method: string; redirect: string | undefined; dispatcher: unknown; headers: Record<string, string> }> = [];

let lookupSpy: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let connectSpy: ReturnType<typeof vi.spyOn>;
const savedFlag = process.env[WEBSITE_ENRICHMENT_FLAG];

function html(body: string, init: { status?: number; contentType?: string | null; location?: string } = {}): Response {
  const headers = new Headers();
  if (init.contentType !== null) headers.set('content-type', init.contentType ?? 'text/html; charset=utf-8');
  if (init.location) headers.set('location', init.location);
  return new Response(init.status && init.status >= 300 && init.status < 400 ? null : body, { status: init.status ?? 200, headers });
}

function redirectTo(location: string, status = 302) {
  return () => html('', { status, location });
}

function site(markup: string) {
  return () => html(markup);
}

const ACME_HOME = [
  '<!doctype html><html><head>',
  '<title>Home | Acme</title>',
  '<meta property="og:site_name" content="Acme Bakery &amp; Co">',
  '</head><body>hello</body></html>',
].join('');

function provider() {
  return new PublicDataEnrichmentProvider();
}

function query(email: string | null) {
  return { email, firstName: 'Jane', lastName: 'Doe', companyName: null };
}

beforeEach(() => {
  process.env[WEBSITE_ENRICHMENT_FLAG] = '1';
  answers = {};
  pages = {};
  tapped.length = 0;
  for (const key of Object.keys(asked)) delete asked[key];
  lookupSpy = vi.spyOn(dnsPromises, 'lookup').mockImplementation((async (hostname: string, options?: { all?: boolean }) => {
    asked[hostname] = (asked[hostname] ?? 0) + 1;
    const entry = answers[hostname];
    const list = typeof entry === 'function' ? entry(asked[hostname]) : entry;
    if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return options?.all ? list : list[0];
  }) as any);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init: any = {}) => {
    const url = String(input instanceof URL ? input.href : input);
    tapped.push({
      url,
      method: init.method ?? 'GET',
      redirect: init.redirect,
      dispatcher: init.dispatcher,
      headers: Object.fromEntries(new Headers(init.headers ?? {}).entries()),
    });
    const page = pages[url];
    if (!page) throw new TypeError(`fetch failed: the tap has no page for ${url}`);
    return page(init);
  }) as any);
  connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function refuse(this: net.Socket) {
    throw new Error('a socket was opened: refused by the test');
  } as any);
});

afterEach(() => {
  lookupSpy.mockRestore();
  fetchSpy.mockRestore();
  connectSpy.mockRestore();
  if (savedFlag === undefined) delete process.env[WEBSITE_ENRICHMENT_FLAG];
  else process.env[WEBSITE_ENRICHMENT_FLAG] = savedFlag;
});

describe('TOF-WEBSITE-ENRICHMENT: the website source is off unless the flag is on, and counts as configured for a contact only when it has a business website', () => {
  it.each([undefined, '', '0', 'false', 'off', 'no'])('the flag %j leaves the source off', (value) => {
    if (value === undefined) delete process.env[WEBSITE_ENRICHMENT_FLAG];
    else process.env[WEBSITE_ENRICHMENT_FLAG] = value;
    expect(provider().enabled).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'on', 'yes'])('the flag %j turns the source on', (value) => {
    process.env[WEBSITE_ENRICHMENT_FLAG] = value;
    expect(provider().enabled).toBe(true);
  });

  it('is read on every call, so turning the flag off stops the next lookup', () => {
    const source = provider();
    expect(source.enabled).toBe(true);
    process.env[WEBSITE_ENRICHMENT_FLAG] = '0';
    expect(source.enabled).toBe(false);
  });

  it("a work email's domain is the business website (https, default port, the root page); case and a trailing dot are normalised", () => {
    expect(websiteFor(query('jane@v63l-acme.invalid'))?.href).toBe('https://v63l-acme.invalid/');
    expect(websiteFor(query('Jane@V63L-Acme.Invalid.'))?.href).toBe('https://v63l-acme.invalid/');
    expect(websiteFor({ email: 'jane@shop.v63l-acme.invalid' })?.href).toBe('https://shop.v63l-acme.invalid/');
    expect(provider().appliesTo(query('jane@v63l-acme.invalid'))).toBe(true);
  });

  it.each([
    ['no email', null],
    ['an empty email', ''],
    ['an email with no domain', 'jane'],
    ['a free-mail host (gmail.com)', 'jane@gmail.com'],
    ['a free-mail host (outlook.com)', 'jane@outlook.com'],
    ['a regional free-mail host (yahoo.co.uk)', 'jane@yahoo.co.uk'],
    ['a regional free-mail host (hotmail.fr)', 'jane@hotmail.fr'],
    ['a single-label host', 'jane@intranet'],
    ['localhost', 'jane@localhost'],
    ['a name under localhost', 'jane@api.localhost'],
    ['an IPv4 literal', 'jane@127.0.0.1'],
    ['a bracketed IPv4 literal', 'jane@[10.0.0.1]'],
    ['an IPv6 literal', 'jane@[::1]'],
    ['a domain with a port', 'jane@v63l-acme.invalid:8080'],
    ['a domain with a path', 'jane@v63l-acme.invalid/admin'],
    ['a domain with a query', 'jane@v63l-acme.invalid?x=1'],
    ['a domain with a percent escape', 'jane@v63l%2eacme.invalid'],
    ['a domain with a backslash', 'jane@v63l-acme.invalid\\admin'],
    ['a label with an underscore', 'jane@v63l_acme.invalid'],
    ['a label starting with a hyphen', 'jane@-v63l.invalid'],
  ])('%s gives no business website: the source does not apply and nothing is resolved or fetched', async (_label, email) => {
    expect(websiteFor(query(email))).toBeNull();
    const source = provider();
    expect(source.appliesTo(query(email))).toBe(false);
    expect(await source.enrich(query(email))).toEqual({ status: 'no_match' });
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(tapped).toEqual([]);
  });

  it('with the flag off, enrich asks nothing even for a work email', async () => {
    process.env[WEBSITE_ENRICHMENT_FLAG] = '0';
    answers['v63l-acme.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
    pages['https://v63l-acme.invalid/'] = site(ACME_HOME);
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'error' });
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(tapped).toEqual([]);
  });
});

describe('TOF-WEBSITE-ENRICHMENT: a public website is read through the pinned guard', () => {
  it("one GET of the site's root page through a PinnedDispatcher pinned to the checked answer, redirect 'manual', html asked for; the company name it declares comes back with the website as provenance", async () => {
    answers['v63l-acme.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
    pages['https://v63l-acme.invalid/'] = site(ACME_HOME);

    const out = await provider().enrich(query('jane@v63l-acme.invalid'));

    expect(out).toEqual({
      status: 'match',
      result: { companyName: 'Acme Bakery & Co', raw: { source: 'website', website: 'https://v63l-acme.invalid/' } },
    });
    expect(tapped).toHaveLength(1);
    expect(tapped[0]).toMatchObject({ url: 'https://v63l-acme.invalid/', method: 'GET', redirect: 'manual' });
    expect(tapped[0].headers.accept).toMatch(/text\/html/);
    expect(tapped[0].dispatcher).toBeInstanceOf(PinnedDispatcher);
    expect((tapped[0].dispatcher as PinnedDispatcher).target).toEqual({
      hostname: 'v63l-acme.invalid',
      addresses: [{ address: PUBLIC_V4, family: 4 }],
    });
    expect(asked).toEqual({ 'v63l-acme.invalid': 1 });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('a redirect to another public host is checked and fetched through its own pinned dispatcher; the provenance is the page that answered', async () => {
    answers['v63l-acme.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
    answers['www.v63l-acme.invalid'] = [{ address: PUBLIC_V4_B, family: 4 }];
    pages['https://v63l-acme.invalid/'] = redirectTo('https://www.v63l-acme.invalid/home?ref=1', 301);
    pages['https://www.v63l-acme.invalid/home?ref=1'] = site(ACME_HOME);

    const out = await provider().enrich(query('jane@v63l-acme.invalid'));

    expect(out).toMatchObject({ status: 'match', result: { companyName: 'Acme Bakery & Co', raw: { website: 'https://www.v63l-acme.invalid/' } } });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-acme.invalid/', 'https://www.v63l-acme.invalid/home?ref=1']);
    expect((tapped[1].dispatcher as PinnedDispatcher).target).toEqual({
      hostname: 'www.v63l-acme.invalid',
      addresses: [{ address: PUBLIC_V4_B, family: 4 }],
    });
    expect(tapped[0].dispatcher).not.toBe(tapped[1].dispatcher);
    expect(asked).toEqual({ 'v63l-acme.invalid': 1, 'www.v63l-acme.invalid': 1 });
  });

  it('a dual-stack host is pinned to every checked answer, in the resolver order', async () => {
    answers['v63l-dual.invalid'] = [
      { address: PUBLIC_V6, family: 6 },
      { address: PUBLIC_V4, family: 4 },
    ];
    pages['https://v63l-dual.invalid/'] = site(ACME_HOME);
    expect((await provider().enrich(query('jane@v63l-dual.invalid'))).status).toBe('match');
    expect((tapped[0].dispatcher as PinnedDispatcher).target.addresses).toEqual(answers['v63l-dual.invalid']);
  });
});

describe('TOF-WEBSITE-ENRICHMENT (DoD): 127.0.0.1, 10.x, 169.254.169.254, a public host redirecting to a private one and a rebinding resolver are refused before any socket', () => {
  it.each([
    ['127.0.0.1 (loopback)', [{ address: '127.0.0.1', family: 4 }]],
    ['10.x (private)', [{ address: '10.20.30.40', family: 4 }]],
    ['169.254.169.254 (the cloud metadata address)', [{ address: '169.254.169.254', family: 4 }]],
    ['::1 (IPv6 loopback)', [{ address: '::1', family: 6 }]],
    ['::ffff:169.254.169.254 (IPv4-mapped metadata)', [{ address: '::ffff:169.254.169.254', family: 6 }]],
    ['one public and one private answer', [{ address: PUBLIC_V4, family: 4 }, { address: '10.0.0.1', family: 4 }]],
  ] as Array<[string, Answer[]]>)('a website whose name resolves to %s is refused: no request, no socket, a miss (never a fetch)', async (_label, list) => {
    answers['v63l-inside.invalid'] = list;
    pages['https://v63l-inside.invalid/'] = site(ACME_HOME);

    const out = await provider().enrich(query('jane@v63l-inside.invalid'));

    expect(out).toEqual({ status: 'no_match' });
    expect(asked).toEqual({ 'v63l-inside.invalid': 1 });
    expect(tapped).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1/',
    'https://10.0.0.5/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
    'http://[::1]/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://localhost/',
    'http://api.localhost/',
  ])('a public host redirecting to %s is refused before any request to it and before any socket', async (location) => {
    answers['v63l-hop.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
    answers.localhost = [{ address: '127.0.0.1', family: 4 }];
    answers['api.localhost'] = [{ address: '127.0.0.1', family: 4 }];
    pages['https://v63l-hop.invalid/'] = redirectTo(location);

    const out = await provider().enrich(query('jane@v63l-hop.invalid'));

    expect(out).toEqual({ status: 'no_match' });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-hop.invalid/']);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('a public host redirecting to a name that resolves to the metadata address is refused before any request to it', async () => {
    answers['v63l-hop.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
    answers['v63l-meta.invalid'] = [{ address: '169.254.169.254', family: 4 }];
    pages['https://v63l-hop.invalid/'] = redirectTo('http://v63l-meta.invalid/latest/meta-data/');
    pages['http://v63l-meta.invalid/latest/meta-data/'] = site(ACME_HOME);

    expect(await provider().enrich(query('jane@v63l-hop.invalid'))).toEqual({ status: 'no_match' });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-hop.invalid/']);
    expect(asked).toEqual({ 'v63l-hop.invalid': 1, 'v63l-meta.invalid': 1 });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("a rebinding resolver (public at the check, 127.0.0.1 at every later ask) never reaches 127.0.0.1: the request is pinned to the checked public answer and its connection asks no resolver; a redirect back to the same name is re-checked, now private, and refused before any request", async () => {
    answers['v63l-rebind.invalid'] = (ask) =>
      ask === 1 ? [{ address: PUBLIC_V4, family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    pages['https://v63l-rebind.invalid/'] = redirectTo('https://v63l-rebind.invalid/home');
    pages['https://v63l-rebind.invalid/home'] = site(ACME_HOME);

    const out = await provider().enrich(query('jane@v63l-rebind.invalid'));

    expect(out).toEqual({ status: 'no_match' });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-rebind.invalid/']);
    const dispatcher = tapped[0].dispatcher as PinnedDispatcher;
    expect(dispatcher).toBeInstanceOf(PinnedDispatcher);
    expect(dispatcher.target).toEqual({ hostname: 'v63l-rebind.invalid', addresses: [{ address: PUBLIC_V4, family: 4 }] });
    // The connection's lookup answers the checked address, though the resolver now says 127.0.0.1.
    const viaConnection = await new Promise((resolve) =>
      pinnedLookup(dispatcher.target)('v63l-rebind.invalid', {}, (err, address) => resolve([err, address])),
    );
    expect(viaConnection).toEqual([null, PUBLIC_V4]);
    expect(asked).toEqual({ 'v63l-rebind.invalid': 2 });
    expect(connectSpy).not.toHaveBeenCalled();
  });
});

describe('TOF-WEBSITE-ENRICHMENT: the fetch is bounded (http(s) default ports, redirects, html only, size, time)', () => {
  beforeEach(() => {
    answers['v63l-acme.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
  });

  it.each([
    'https://v63l-acme.invalid:8443/',
    'http://v63l-acme.invalid:8080/',
    'ftp://v63l-acme.invalid/',
    'file:///etc/passwd',
    'data:text/html,<meta property="og:site_name" content="Injected">',
    'javascript:alert(1)',
    `https://member:${'x'.repeat(3)}@v63l-acme.invalid/`,
  ])('a redirect to %s is refused before any request to it', async (location) => {
    pages['https://v63l-acme.invalid/'] = redirectTo(location);
    pages[location] = site(ACME_HOME);
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'no_match' });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-acme.invalid/']);
  });

  it('a redirect with no Location, or one that is not a URL, is a miss', async () => {
    pages['https://v63l-acme.invalid/'] = () => html('', { status: 302 });
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'no_match' });
    pages['https://v63l-acme.invalid/'] = redirectTo('http://exa mple.invalid:99999/');
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'no_match' });
  });

  it(`follows at most ${WEBSITE_MAX_REDIRECTS} redirects, then stops with a miss`, async () => {
    const chain = Array.from({ length: WEBSITE_MAX_REDIRECTS + 3 }, (_, i) => `https://v63l-acme.invalid/${i}`);
    pages['https://v63l-acme.invalid/'] = redirectTo(chain[0]);
    chain.forEach((url, i) => {
      pages[url] = redirectTo(chain[i + 1] ?? 'https://v63l-acme.invalid/end');
    });
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'no_match' });
    expect(tapped).toHaveLength(WEBSITE_MAX_REDIRECTS + 1);
  });

  it.each([
    ['application/json', `{"note":"<meta property='og:site_name' content='Acme'>"}`],
    ['image/png', '<meta property="og:site_name" content="Acme">'],
    ['text/plain', '<meta property="og:site_name" content="Acme">'],
    [null, '<meta property="og:site_name" content="Acme">'],
  ])('only html is read: a %s answer is a miss', async (contentType, body) => {
    pages['https://v63l-acme.invalid/'] = () => html(body, { contentType });
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'no_match' });
  });

  it('xhtml is html', async () => {
    pages['https://v63l-acme.invalid/'] = () => html(ACME_HOME, { contentType: 'application/xhtml+xml' });
    expect((await provider().enrich(query('jane@v63l-acme.invalid'))).status).toBe('match');
  });

  function streamOf(head: string, filler: number, tail: string) {
    const encoder = new TextEncoder();
    const chunk = encoder.encode(`<!-- ${'x'.repeat(16 * 1024 - 9)} -->`);
    let sent = 0;
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) {
          const bytes = encoder.encode(head);
          pulled += bytes.length;
          controller.enqueue(bytes);
        } else if (sent <= filler) {
          pulled += chunk.length;
          controller.enqueue(chunk);
        } else if (sent === filler + 1) {
          const bytes = encoder.encode(tail);
          pulled += bytes.length;
          controller.enqueue(bytes);
        } else {
          controller.close();
        }
        sent += 1;
      },
      cancel() {
        cancelled = true;
      },
    });
    return { stream, state: () => ({ pulled, cancelled }) };
  }

  it(`reads at most ${WEBSITE_MAX_BYTES} bytes of a large page and cancels the rest; a name declared within the bound is read`, async () => {
    const big = streamOf('<html><head><meta property="og:site_name" content="Acme Early"></head><body>', 4 * 64, '</body></html>');
    pages['https://v63l-acme.invalid/'] = () => new Response(big.stream, { headers: { 'content-type': 'text/html' } });
    const out = await provider().enrich(query('jane@v63l-acme.invalid'));
    expect(out).toMatchObject({ status: 'match', result: { companyName: 'Acme Early' } });
    // What was read is the bound plus at most the chunk that crossed it; the stream may queue one more.
    expect(big.state().pulled).toBeLessThanOrEqual(WEBSITE_MAX_BYTES + 2 * 16 * 1024);
    expect(big.state().cancelled).toBe(true);
  });

  it('a name declared only past the bound is never read: a miss', async () => {
    const big = streamOf('<html><body>', 4 * 64, '<meta property="og:site_name" content="Acme Late"></body></html>');
    pages['https://v63l-acme.invalid/'] = () => new Response(big.stream, { headers: { 'content-type': 'text/html' } });
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'no_match' });
    expect(big.state().cancelled).toBe(true);
  });

  class QuickSource extends PublicDataEnrichmentProvider {
    protected override readonly timeoutMs = 60;
  }

  it('one deadline bounds the whole lookup: a site that never answers is a transient error, not a miss', async () => {
    pages['https://v63l-acme.invalid/'] = (init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      });
    const started = Date.now();
    expect(await new QuickSource().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'error' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('the same deadline bounds the body: a page that stalls after its headers is a transient error', async () => {
    pages['https://v63l-acme.invalid/'] = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<html><head>'));
          },
        }),
        { headers: { 'content-type': 'text/html' } },
      );
    const started = Date.now();
    expect(await new QuickSource().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'error' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a resolver that never answers is bounded by the same deadline', async () => {
    lookupSpy.mockImplementation((() => new Promise(() => undefined)) as any);
    const started = Date.now();
    expect(await new QuickSource().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'error' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(tapped).toEqual([]);
  });

  it.each([
    [500, 'error'],
    [503, 'error'],
    [429, 'error'],
    [404, 'no_match'],
    [410, 'no_match'],
    [403, 'no_match'],
  ])('an answer %i is a %s (a server failure is retried later, a refusal is a miss)', async (status, expected) => {
    pages['https://v63l-acme.invalid/'] = () => html(ACME_HOME, { status });
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: expected });
  });

  it('a network failure is a transient error; a name that does not resolve is a miss with no request', async () => {
    pages['https://v63l-acme.invalid/'] = () => {
      throw new TypeError('fetch failed');
    };
    expect(await provider().enrich(query('jane@v63l-acme.invalid'))).toEqual({ status: 'error' });
    tapped.length = 0;
    expect(await provider().enrich(query('jane@v63l-typo.invalid'))).toEqual({ status: 'no_match' });
    expect(tapped).toEqual([]);
  });

  it('never throws, whatever the page does', async () => {
    pages['https://v63l-acme.invalid/'] = () => {
      throw Object.assign(new Error('boom'), { name: 'WeirdError' });
    };
    await expect(provider().enrich(query('jane@v63l-acme.invalid'))).resolves.toEqual({ status: 'error' });
  });
});

describe('TOF-WEBSITE-ENRICHMENT (PRS-M14): the page is parsed linearly and only for what the site itself declares', () => {
  it("og:site_name in either attribute order, either quote, any case; an apostrophe inside double quotes and character references are kept as text", () => {
    expect(readWebsiteFacts(`<meta property="og:site_name" content="Joe's Bakery &amp; Caf&#233; &#x2014; Port of Spain">`)).toEqual({
      companyName: "Joe's Bakery & Café — Port of Spain",
    });
    expect(readWebsiteFacts(`<META CONTENT='Acme "Quoted" Ltd' PROPERTY='og:site_name'/>`)).toEqual({ companyName: 'Acme "Quoted" Ltd' });
    expect(readWebsiteFacts('<meta content=AcmeUnquoted property=og:site_name>')).toEqual({ companyName: 'AcmeUnquoted' });
  });

  it('application-name stands in when there is no og:site_name', () => {
    expect(readWebsiteFacts('<meta name="application-name" content="Acme App">')).toEqual({ companyName: 'Acme App' });
    expect(readWebsiteFacts('<meta name="application-name" content="Acme App"><meta property="og:site_name" content="Acme Site">')).toEqual({
      companyName: 'Acme Site',
    });
  });

  it("schema.org Organization data gives the name and the business's own city, region and country, and outranks og:site_name", () => {
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Acme Website' },
        {
          '@type': ['Bakery', 'LocalBusiness'],
          name: 'Acme Bakery Limited',
          address: { '@type': 'PostalAddress', addressLocality: 'San Fernando', addressRegion: 'South', addressCountry: 'TT' },
        },
      ],
    };
    const markup = `<meta property="og:site_name" content="Acme"><script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(readWebsiteFacts(markup)).toEqual({ companyName: 'Acme Bakery Limited', city: 'San Fernando', state: 'South', country: 'TT' });
  });

  it('addressCountry may be a Country object; an Organization subtype is an Organization', () => {
    const ld = { '@type': 'MedicalOrganization', name: 'Acme Clinic', address: [{ addressCountry: { '@type': 'Country', name: 'Trinidad and Tobago' } }] };
    expect(readWebsiteFacts(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)).toEqual({
      companyName: 'Acme Clinic',
      country: 'Trinidad and Tobago',
    });
  });

  it('a Person, a WebSite or an Event is not the business; malformed JSON is skipped', () => {
    const person = { '@type': 'Person', name: 'Jane Doe', address: { addressLocality: 'Arima' } };
    const markup = [
      `<script type="application/ld+json">${JSON.stringify(person)}</script>`,
      `<script type="application/ld+json">{ "@type": "Organization", "name": </script>`,
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'WebSite', name: 'Acme Website' })}</script>`,
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: 'Acme Fair', location: { address: { addressLocality: 'Arima' } } })}</script>`,
      `<script>var x = '<meta property="og:site_name" content="In A Script">';</script>`,
      `<!-- <meta property="og:site_name" content="In A Comment"> -->`,
    ].join('');
    expect(readWebsiteFacts(markup)).toEqual({});
  });

  it('nothing declared is nothing found: a title alone, or nothing, never becomes a company name made up from the domain', async () => {
    expect(readWebsiteFacts('<html><head><title>Acme Corp | Home</title></head><body>Acme Corp</body></html>')).toEqual({});
    answers['v63l-bright-widgets.invalid'] = [{ address: PUBLIC_V4, family: 4 }];
    pages['https://v63l-bright-widgets.invalid/'] = site('<html><head><title>Bright Widgets</title></head><body>hi</body></html>');
    expect(await provider().enrich(query('ceo@v63l-bright-widgets.invalid'))).toEqual({ status: 'no_match' });
  });

  it('values are cleaned: control characters dropped, whitespace collapsed, at most 200 characters, an empty value ignored', () => {
    expect(readWebsiteFacts('<meta property="og:site_name" content="  Acme\u0000\u0007\n\t  Bakery  ">')).toEqual({ companyName: 'Acme Bakery' });
    const long = readWebsiteFacts(`<meta property="og:site_name" content="${'A'.repeat(500)}">`);
    expect(long.companyName).toHaveLength(200);
    expect(readWebsiteFacts('<meta property="og:site_name" content="   "><meta name="application-name" content="Fallback">')).toEqual({ companyName: 'Fallback' });
    expect(readWebsiteFacts('<meta property="og:site_name" content="&#0;&#xD800;&#1114112;">')).toEqual({});
  });

  it('runs in linear time on hostile markup (unterminated tags, quotes, comments and scripts)', () => {
    const hostile = [
      '<meta property="og:site_name" content="x '.repeat(20_000),
      '<meta '.repeat(20_000),
      '<script type="application/ld+json">'.repeat(5_000),
      '<!--'.repeat(5_000),
      `<meta content='${"'".repeat(20_000)}`,
    ];
    for (const markup of hostile) {
      const started = Date.now();
      readWebsiteFacts(markup);
      expect(Date.now() - started, markup.slice(0, 40)).toBeLessThan(500);
    }
  });
});

/**
 * ST-38c-2 (V1-38c review), W4-IMPORT-SSRF-PIN: the shared outbound-address
 * guard a server-side fetch of a member-given URL goes through.
 *
 * - isNonPublicAddress: loopback, private, shared, link-local (the cloud
 *   metadata address), unique-local, unspecified, NAT64 and IPv4-mapped forms
 *   of them are never public; anything that is not an IP address is never
 *   public either.
 * - resolvePublicAddress: a host name is resolved once, every address asked
 *   for, and refused when any answer is not public or there is none; an IP
 *   literal is checked as itself and never resolved. Every checked address is
 *   given back, in the resolver's order (review CR-PIN-1).
 * - PinnedDispatcher / pinnedLookup: a fetch through the dispatcher connects
 *   only to the addresses that were checked whatever DNS would say now (no
 *   second resolution, so no DNS rebinding), while the URL's name stays the
 *   Host (and the TLS server name, which undici takes from the same host).
 *   Review CR-PIN-1: when the first checked address cannot be reached (an AAAA
 *   answer where IPv6 egress is broken) the connection falls back to the next
 *   checked one, as an unpinned fetch did, and never to any other address.
 *
 * No real network traffic: the resolver (node:dns promises lookup, the one the
 * guard calls) is stubbed, the only server is a local http server on
 * 127.0.0.1, and the names fetched end in .invalid, which never resolves, so a
 * fetch that did not go through the pinned lookup could not connect.
 */
import http from 'node:http';
import { promises as dnsPromises } from 'node:dns';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNonPublicAddress,
  OutboundAddressRefusedError,
  PinnedDispatcher,
  pinnedLookup,
  resolvePublicAddress,
} from './outbound-address';

type Answer = { address: string; family: 4 | 6 };

const PUBLIC_V4 = '93.184.215.14';
const PUBLIC_V6 = '2606:4700:4700::1111';

describe('ST-38c-2 (W4-IMPORT-SSRF-PIN): isNonPublicAddress', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '127.0.0.2',
    '10.20.30.40',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '::',
    '::1',
    'fe80::1',
    'fd00::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '::ffff:10.0.0.1',
    '64:ff9b::a9fe:a9fe',
  ])('ST-38c-2 (W4-IMPORT-SSRF-PIN): %s is not public', (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each([PUBLIC_V4, '8.8.8.8', PUBLIC_V6, '::ffff:8.8.8.8'])('ST-38c-2 (W4-IMPORT-SSRF-PIN): %s is public', (address) => {
    expect(isNonPublicAddress(address)).toBe(false);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): a value that is not an IP address is never treated as public', () => {
    expect(isNonPublicAddress('v90d-name.invalid')).toBe(true);
    expect(isNonPublicAddress('')).toBe(true);
  });
});

describe('ST-38c-2 (W4-IMPORT-SSRF-PIN): resolvePublicAddress resolves a name once and refuses it when any address is not public', () => {
  const ANSWERS: Record<string, Answer[]> = {
    'v90d-loopback.invalid': [{ address: '127.0.0.1', family: 4 }],
    'v90d-private.invalid': [{ address: '10.20.30.40', family: 4 }],
    'v90d-metadata.invalid': [{ address: '169.254.169.254', family: 4 }],
    'v90d-loopback6.invalid': [{ address: '::1', family: 6 }],
    'v90d-mapped.invalid': [{ address: '::ffff:127.0.0.1', family: 6 }],
    'v90d-ula.invalid': [{ address: 'fd00:ec2::254', family: 6 }],
    'v90d-mixed.invalid': [
      { address: PUBLIC_V4, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    'v90d-empty.invalid': [],
    'v90d-public.invalid': [
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ],
    'v90d-public6.invalid': [{ address: PUBLIC_V6, family: 6 }],
    // Review CR-PIN-1: an AAAA answer first, as a verbatim-order resolver gives it.
    'v90d-dual.invalid': [
      { address: PUBLIC_V6, family: 6 },
      { address: PUBLIC_V4, family: 4 },
    ],
  };
  let lookupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lookupSpy = vi.spyOn(dnsPromises, 'lookup').mockImplementation((async (hostname: string, options?: { all?: boolean }) => {
      const answers = ANSWERS[hostname];
      if (!answers) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      return options?.all ? answers : answers[0];
    }) as any);
  });

  afterEach(() => lookupSpy.mockRestore());

  async function refusal(hostname: string): Promise<OutboundAddressRefusedError> {
    const err = await resolvePublicAddress(hostname).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err, `${hostname} must be refused`).toBeInstanceOf(OutboundAddressRefusedError);
    return err as OutboundAddressRefusedError;
  }

  it.each([
    ['127.0.0.1', 'v90d-loopback.invalid'],
    ['10.20.30.40', 'v90d-private.invalid'],
    ['169.254.169.254 (the metadata address)', 'v90d-metadata.invalid'],
    ['::1', 'v90d-loopback6.invalid'],
    ['::ffff:127.0.0.1 (IPv4-mapped loopback)', 'v90d-mapped.invalid'],
    ['fd00:ec2::254 (unique local)', 'v90d-ula.invalid'],
    ['a public and a private address', 'v90d-mixed.invalid'],
  ])('ST-38c-2 (W4-IMPORT-SSRF-PIN): a name resolving to %s is refused as not public, after one lookup asking for every address', async (_answer, hostname) => {
    expect((await refusal(hostname)).reason).toBe('non_public');
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy).toHaveBeenCalledWith(hostname, expect.objectContaining({ all: true }));
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): a name the resolver cannot resolve, or that resolves to no address, is refused as unresolvable', async () => {
    expect((await refusal('v90d-nxdomain.invalid')).reason).toBe('unresolvable');
    expect((await refusal('v90d-empty.invalid')).reason).toBe('unresolvable');
  });

  it("ST-38c-2 (W4-IMPORT-SSRF-PIN, review CR-PIN-1): a name whose every address is public gives every address, in the resolver's order, all of them the fetch is pinned to", async () => {
    await expect(resolvePublicAddress('v90d-public.invalid')).resolves.toEqual({
      hostname: 'v90d-public.invalid',
      addresses: [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ],
    });
    await expect(resolvePublicAddress('v90d-public6.invalid')).resolves.toEqual({
      hostname: 'v90d-public6.invalid',
      addresses: [{ address: PUBLIC_V6, family: 6 }],
    });
    expect(lookupSpy).toHaveBeenCalledTimes(2);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN, review CR-PIN-1): a dual-stack name answering AAAA first keeps its A address too, so the fetch can fall back to it', async () => {
    await expect(resolvePublicAddress('v90d-dual.invalid')).resolves.toEqual({
      hostname: 'v90d-dual.invalid',
      addresses: [
        { address: PUBLIC_V6, family: 6 },
        { address: PUBLIC_V4, family: 4 },
      ],
    });
    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): an IP literal is checked as itself and never resolved', async () => {
    await expect(resolvePublicAddress(PUBLIC_V4)).resolves.toEqual({ hostname: PUBLIC_V4, addresses: [{ address: PUBLIC_V4, family: 4 }] });
    await expect(resolvePublicAddress(PUBLIC_V6)).resolves.toEqual({ hostname: PUBLIC_V6, addresses: [{ address: PUBLIC_V6, family: 6 }] });
    expect((await refusal('169.254.169.254')).reason).toBe('non_public');
    expect((await refusal('::ffff:7f00:1')).reason).toBe('non_public');
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

describe('ST-38c-2 (W4-IMPORT-SSRF-PIN): pinnedLookup answers only with the checked address, and only for the checked name', () => {
  const lookup = pinnedLookup({ hostname: 'v90d-pinned.invalid', addresses: [{ address: PUBLIC_V4, family: 4 }] });
  const dualLookup = pinnedLookup({
    hostname: 'v90d-dual.invalid',
    addresses: [
      { address: PUBLIC_V6, family: 6 },
      { address: PUBLIC_V4, family: 4 },
    ],
  });

  function ask(hostname: string, options: { all?: boolean; family?: number }, using = lookup): Promise<unknown[]> {
    return new Promise((resolve) => {
      using(hostname, options as any, (err: unknown, address: unknown, family?: unknown) => resolve([err, address, family]));
    });
  }

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): the checked address comes back in both lookup forms net.connect uses (one address, or all of them)', async () => {
    expect(await ask('v90d-pinned.invalid', {})).toEqual([null, PUBLIC_V4, 4]);
    expect(await ask('v90d-pinned.invalid', { all: true })).toEqual([null, [{ address: PUBLIC_V4, family: 4 }], undefined]);
    // The URL keeps a trailing dot in its hostname; it names the same host.
    expect(await ask('V90D-PINNED.invalid.', {})).toEqual([null, PUBLIC_V4, 4]);
  });

  it("ST-38c-2 (W4-IMPORT-SSRF-PIN, review CR-PIN-1): every checked address comes back in the all form, in the resolver's order, and the first in the one-address form", async () => {
    expect(await ask('v90d-dual.invalid', { all: true }, dualLookup)).toEqual([
      null,
      [
        { address: PUBLIC_V6, family: 6 },
        { address: PUBLIC_V4, family: 4 },
      ],
      undefined,
    ]);
    expect(await ask('v90d-dual.invalid', {}, dualLookup)).toEqual([null, PUBLIC_V6, 6]);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN, review CR-PIN-1): a family asked for keeps only the checked addresses of that family, and one with none is refused', async () => {
    expect(await ask('v90d-dual.invalid', { family: 4 }, dualLookup)).toEqual([null, PUBLIC_V4, 4]);
    expect(await ask('v90d-dual.invalid', { family: 4, all: true }, dualLookup)).toEqual([null, [{ address: PUBLIC_V4, family: 4 }], undefined]);
    expect(await ask('v90d-dual.invalid', { family: 6 }, dualLookup)).toEqual([null, PUBLIC_V6, 6]);
    const [err, address] = await ask('v90d-pinned.invalid', { family: 6 });
    expect(err).toBeInstanceOf(Error);
    expect(address).toBeUndefined();
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): any other name is refused, so a pinned dispatcher cannot reach a host it was not checked for', async () => {
    const [err, address] = await ask('v90d-other.invalid', { all: true });
    expect(err).toBeInstanceOf(Error);
    expect(address).toBeUndefined();
    const [dualErr, dualAddress] = await ask('v90d-other.invalid', { all: true }, dualLookup);
    expect(dualErr).toBeInstanceOf(Error);
    expect(dualAddress).toBeUndefined();
  });
});

describe('ST-38c-2 (W4-IMPORT-SSRF-PIN): a fetch through a PinnedDispatcher connects to the checked address and keeps the name as Host', () => {
  /** A body larger than one socket read, so closing the dispatcher early is seen to keep it whole. */
  const BODY = `first_name,email\n${Array.from({ length: 6000 }, (_, i) => `V90dPinned${i},v90d_pinned-${i}@test.local`).join('\n')}\n`;
  const seen: Array<{ host: string | undefined; url: string | undefined }> = [];
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ host: req.headers.host, url: req.url });
      if (req.url === '/moved.csv') {
        res.writeHead(302, { location: 'http://v90d-elsewhere.invalid/contacts.csv' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/csv' });
      // Two writes, so the body is still arriving after the headers are read.
      res.write(BODY.slice(0, 1000));
      setTimeout(() => res.end(BODY.slice(1000)), 20);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): a name that never resolves (.invalid) is reached at the pinned address, the request names it as Host, and the whole body is read after the dispatcher is closed', async () => {
    const dispatcher = new PinnedDispatcher({ hostname: 'v90d-pinned.invalid', addresses: [{ address: '127.0.0.1', family: 4 }] });
    expect(dispatcher.target).toEqual({ hostname: 'v90d-pinned.invalid', addresses: [{ address: '127.0.0.1', family: 4 }] });
    const res = await fetch(`http://v90d-pinned.invalid:${port}/contacts.csv`, { redirect: 'manual', dispatcher } as RequestInit);
    const closed = dispatcher.close();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
    await closed;
    expect(seen).toEqual([{ host: `v90d-pinned.invalid:${port}`, url: '/contacts.csv' }]);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): a redirect comes back to the caller (redirect manual) and is not followed through the pinned dispatcher', async () => {
    const dispatcher = new PinnedDispatcher({ hostname: 'v90d-pinned.invalid', addresses: [{ address: '127.0.0.1', family: 4 }] });
    const res = await fetch(`http://v90d-pinned.invalid:${port}/moved.csv`, { redirect: 'manual', dispatcher } as RequestInit);
    await dispatcher.close();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://v90d-elsewhere.invalid/contacts.csv');
    expect(seen).toEqual([{ host: `v90d-pinned.invalid:${port}`, url: '/moved.csv' }]);
  });

  it.each([
    ['an AAAA address (IPv6 egress broken)', { address: '::1', family: 6 as const }],
    ['an A address', { address: '127.0.0.2', family: 4 as const }],
  ])('ST-38c-2 (W4-IMPORT-SSRF-PIN, review CR-PIN-1): when the first checked address, %s, cannot be reached, the fetch falls back to the next checked address and the name stays the Host', async (_first, unreachable) => {
    // Nothing listens on the first address: the server is bound to 127.0.0.1 only.
    const dispatcher = new PinnedDispatcher({
      hostname: 'v90d-dual.invalid',
      addresses: [unreachable, { address: '127.0.0.1', family: 4 }],
    });
    const res = await fetch(`http://v90d-dual.invalid:${port}/contacts.csv`, { redirect: 'manual', dispatcher } as RequestInit);
    const closed = dispatcher.close();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
    await closed;
    expect(seen).toEqual([{ host: `v90d-dual.invalid:${port}`, url: '/contacts.csv' }]);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN, review CR-PIN-1): when no checked address can be reached the fetch fails; it never falls back to DNS or to any other address', async () => {
    const dispatcher = new PinnedDispatcher({
      hostname: 'v90d-dual.invalid',
      addresses: [
        { address: '::1', family: 6 },
        { address: '127.0.0.2', family: 4 },
      ],
    });
    await expect(fetch(`http://v90d-dual.invalid:${port}/contacts.csv`, { redirect: 'manual', dispatcher } as RequestInit)).rejects.toThrow();
    await dispatcher.close();
    expect(seen).toEqual([]);
  });

  it('ST-38c-2 (W4-IMPORT-SSRF-PIN): a dispatcher pinned for one name does not connect for another name, and nothing reaches the server', async () => {
    const dispatcher = new PinnedDispatcher({ hostname: 'v90d-pinned.invalid', addresses: [{ address: '127.0.0.1', family: 4 }] });
    await expect(fetch(`http://v90d-other.invalid:${port}/contacts.csv`, { redirect: 'manual', dispatcher } as RequestInit)).rejects.toThrow();
    await dispatcher.close();
    expect(seen).toEqual([]);
  });
});

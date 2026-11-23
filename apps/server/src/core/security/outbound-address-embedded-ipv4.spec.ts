/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD acceptance review (security MINOR-1; orchestrator-authorized change to
 * core/security/outbound-address.ts outside the packet's write set): an IPv6 address that carries an IPv4
 * address inside it must be refused whenever it can reach a non-public IPv4 address.
 *
 * Before: the IPv4-translated form ::ffff:0:a.b.c.d (RFC 2765 / SIIT, prefix ::ffff:0:0:0/96) was public to
 * the guard, so http://[::ffff:0:7f00:1]/ (127.0.0.1) and [::ffff:0:a9fe:a9fe] (169.254.169.254) passed, and
 * so did a name answering one. Every other embedding form is pinned here too so a later edit of the list
 * cannot drop one: IPv4-mapped (::ffff:0:0/96, checked against the IPv4 ranges), IPv4-compatible (::/96),
 * NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001::/32), each refused whole.
 *
 * The guard is shared: webhooks (checkWebhookUrl), the CRM link import and website enrichment resolve with
 * it, so they refuse these addresses too.
 */
import { promises as dnsPromises } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNonPublicAddress, OutboundAddressRefusedError, resolvePublicAddress } from './outbound-address';
import { checkWebhookUrl, WebhookUrlRefusedError } from '../../modules/webhooks/webhook-url';

afterEach(() => vi.restoreAllMocks());

const EMBEDDED_NON_PUBLIC: Array<[string, string]> = [
  ['::ffff:0:7f00:1', 'IPv4-translated 127.0.0.1'],
  ['::ffff:0:a9fe:a9fe', 'IPv4-translated 169.254.169.254'],
  ['::ffff:0:a00:1', 'IPv4-translated 10.0.0.1'],
  ['::ffff:0:c0a8:101', 'IPv4-translated 192.168.1.1'],
  ['0:0:0:0:ffff:0:7f00:1', 'IPv4-translated 127.0.0.1, written out'],
  ['::ffff:0:127.0.0.1', 'IPv4-translated 127.0.0.1, dotted tail'],
  ['::ffff:7f00:1', 'IPv4-mapped 127.0.0.1'],
  ['::ffff:169.254.169.254', 'IPv4-mapped 169.254.169.254'],
  ['::7f00:1', 'IPv4-compatible 127.0.0.1'],
  ['::a9fe:a9fe', 'IPv4-compatible 169.254.169.254'],
  ['64:ff9b::7f00:1', 'NAT64 127.0.0.1'],
  ['64:ff9b::a9fe:a9fe', 'NAT64 169.254.169.254'],
  ['64:ff9b:1::a9fe:a9fe', 'local-use NAT64 169.254.169.254'],
  ['2002:7f00:1::', '6to4 127.0.0.1'],
  ['2002:a9fe:a9fe::1', '6to4 169.254.169.254'],
  ['2002:a00:1::1', '6to4 10.0.0.1'],
  ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
];

describe('outbound-address: IPv6 addresses that embed an IPv4 address (FU-CONTRACT-FETCH-OUTBOUND-GUARD review)', () => {
  it.each(EMBEDDED_NON_PUBLIC)('%s (%s) is not public', (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it('a public IPv6 address and a public IPv4 address are still public (the list is not refusing everything)', () => {
    for (const address of ['2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '93.184.215.14']) {
      expect(isNonPublicAddress(address), address).toBe(false);
    }
  });

  it('an IPv4-translated literal is refused without a lookup, and a name answering one is refused', async () => {
    const lookup = vi.spyOn(dnsPromises, 'lookup');
    for (const literal of ['::ffff:0:7f00:1', '::ffff:0:a9fe:a9fe']) {
      const err = await resolvePublicAddress(literal).then(() => null, (e: unknown) => e);
      expect(err, literal).toBeInstanceOf(OutboundAddressRefusedError);
      expect((err as OutboundAddressRefusedError).reason, literal).toBe('non_public');
    }
    expect(lookup).not.toHaveBeenCalled();

    lookup.mockResolvedValue([{ address: '::ffff:0:a9fe:a9fe', family: 6 }] as never);
    const err = await resolvePublicAddress('xlat.example.test').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(OutboundAddressRefusedError);
    expect((err as OutboundAddressRefusedError).reason).toBe('non_public');
  });

  it('a webhook URL at an IPv4-translated address is refused (the guard is shared)', async () => {
    const lookup = vi.spyOn(dnsPromises, 'lookup');
    for (const url of ['http://[::ffff:0:7f00:1]/hook', 'https://[::ffff:0:a9fe:a9fe]/latest/meta-data/']) {
      await expect(checkWebhookUrl(url), url).rejects.toBeInstanceOf(WebhookUrlRefusedError);
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});

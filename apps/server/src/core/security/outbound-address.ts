/**
 * ST-38c-2 (V1-38c review), W4-IMPORT-SSRF-PIN: the guard for a server-side
 * fetch of a URL a member gave (the CRM link import).
 *
 * Checking a URL's host name and then letting fetch resolve it again is open
 * to DNS rebinding: the name can answer a public address to the check and a
 * private one to the fetch. So the host is resolved once (resolvePublicAddress,
 * every address asked for), refused when any address is not public or none
 * comes back, and the fetch goes through a dispatcher pinned to the address
 * that was checked (PinnedDispatcher): its connections take their address from
 * pinnedLookup, never from DNS, while the URL's name stays the Host header and
 * the TLS server name (undici derives both from the URL). A caller that
 * follows redirects does it itself (fetch with redirect 'manual'), resolving
 * and checking each target the same way, with a new dispatcher.
 *
 * No new dependency: node's dns and net, and undici's Agent (already a
 * dependency of the server; the global fetch runs on undici and takes it as
 * its dispatcher).
 */
import { promises as dnsPromises } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';

/**
 * The address ranges an outbound fetch of a member-given URL may not reach.
 * BlockList checks an IPv4-mapped IPv6 address (::ffff:a.b.c.d) against the
 * IPv4 ranges. (Moved from crm-import.service.ts, V1-38c review ST-38c-2.)
 */
export const NON_PUBLIC_ADDRESSES: BlockList = (() => {
  const list = new BlockList();
  const ipv4: Array<[string, number]> = [
    ['0.0.0.0', 8], // this network
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // shared address space
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, the cloud metadata address
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15], // benchmarking
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, broadcast
  ];
  const ipv6: Array<[string, number]> = [
    ['::', 96], // unspecified, loopback, IPv4-compatible
    ['64:ff9b::', 96], // NAT64: an IPv4 address behind a translator
    ['64:ff9b:1::', 48], // local-use NAT64
    ['100::', 64], // discard
    ['2001::', 32], // Teredo
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4
    ['fc00::', 7], // unique local (the IPv6 metadata address fd00:ec2::254 too)
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local
    ['ff00::', 8], // multicast
  ];
  for (const [network, prefix] of ipv4) list.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of ipv6) list.addSubnet(network, prefix, 'ipv6');
  return list;
})();

/**
 * ST-38c-2: true when an outbound fetch may not connect to this address: an
 * address in NON_PUBLIC_ADDRESSES, or anything that is not an IP address.
 */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return NON_PUBLIC_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** The address a URL's host was checked at, and the only one its fetch may connect to. */
export interface CheckedAddress {
  /** The URL's host as it was resolved (no IPv6 brackets). Host and SNI stay this name. */
  hostname: string;
  address: string;
  family: 4 | 6;
}

/** ST-38c-2: an outbound host refused because an address is not public, or because it does not resolve. */
export class OutboundAddressRefusedError extends Error {
  constructor(
    readonly reason: 'non_public' | 'unresolvable',
    readonly hostname: string,
  ) {
    super(reason === 'non_public' ? `${hostname} is not a public address` : `${hostname} does not resolve`);
    this.name = 'OutboundAddressRefusedError';
  }
}

const sameHost = (a: string, b: string) => a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '');

/**
 * ST-38c-2 (W4-IMPORT-SSRF-PIN): resolve a host once and give the address its
 * fetch must connect to. An IP literal is checked as itself and never
 * resolved. A name is resolved with every address asked for, and refused when
 * any answer is not public (a name with one public and one private address
 * could be served either) or when there is no answer.
 */
export async function resolvePublicAddress(hostname: string): Promise<CheckedAddress> {
  const literal = isIP(hostname);
  if (literal !== 0) {
    if (isNonPublicAddress(hostname)) throw new OutboundAddressRefusedError('non_public', hostname);
    return { hostname, address: hostname, family: literal === 6 ? 6 : 4 };
  }
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dnsPromises.lookup(hostname, { all: true });
  } catch {
    throw new OutboundAddressRefusedError('unresolvable', hostname);
  }
  if (!Array.isArray(answers) || answers.length === 0) throw new OutboundAddressRefusedError('unresolvable', hostname);
  if (answers.some((answer) => isNonPublicAddress(answer.address))) {
    throw new OutboundAddressRefusedError('non_public', hostname);
  }
  const { address } = answers[0];
  return { hostname, address, family: isIP(address) === 6 ? 6 : 4 };
}

/**
 * ST-38c-2 (W4-IMPORT-SSRF-PIN): a lookup for net.connect / tls.connect that
 * answers the checked name with the checked address, in both forms net uses
 * (one address, or all of them), and refuses any other name. No DNS query is
 * made, so the connection goes to the address that was checked.
 */
export function pinnedLookup(target: CheckedAddress): LookupFunction {
  return (hostname, options, callback) => {
    if (!sameHost(hostname, target.hostname)) {
      const err = Object.assign(new Error(`${hostname} is not the host this connection was checked for`), { code: 'ENOTFOUND' });
      callback(err, undefined as unknown as string, undefined);
      return;
    }
    if (options?.all) {
      callback(null, [{ address: target.address, family: target.family }]);
      return;
    }
    callback(null, target.address, target.family);
  };
}

/**
 * ST-38c-2 (W4-IMPORT-SSRF-PIN): an undici dispatcher for one checked host.
 * Pass it to fetch (`dispatcher`) with redirect 'manual'; close it once the
 * response is in hand (close lets the request in flight finish, body
 * included). `target` names the address its connections are pinned to.
 */
export class PinnedDispatcher extends Agent {
  constructor(readonly target: CheckedAddress) {
    super({ connect: { lookup: pinnedLookup(target) } });
  }
}

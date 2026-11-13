/**
 * SWEEP-P0-SCOPES (browser sweep BUG-001): an outbound webhook URL goes through the repo's
 * outbound-address guard (core/security/outbound-address.ts), the one the CRM link import uses.
 *
 * A webhook makes the server POST signed business events (invoices, contacts, orders) to a URL a
 * member gave. Before this packet the only check was `url.startsWith('http')`, so a webhook could
 * point at the server's own loopback, a private network address or the cloud metadata address,
 * and every delivery (and the test route) went there.
 *
 * checkWebhookUrl is the one rule, used twice: when a webhook is created (refused 400, nothing
 * written) and before every delivery (a row stored before this check, or a name that now resolves
 * to a private address, is never connected to). It parses the URL, takes http and https only,
 * refuses a localhost name, and resolves the host once (resolvePublicAddress: every address asked
 * for, refused when any is not public or none comes back). The addresses it answers are the only
 * ones a delivery may connect to (PinnedDispatcher), so a second DNS answer is never used.
 */
import { isIP } from 'node:net';
import {
  CheckedAddress,
  OutboundAddressRefusedError,
  isNonPublicAddress,
  resolvePublicAddress,
} from '../../core/security/outbound-address';

/** Why a webhook URL was refused; the message is safe to answer to the member who gave the URL. */
export class WebhookUrlRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlRefusedError';
  }
}

/** The message a refused non-public host carries (the delivery log and the 400 both use it). */
export const WEBHOOK_URL_NOT_PUBLIC = 'Webhook URL host is not a public address';

/**
 * The checked URL and the addresses its delivery may connect to; throws WebhookUrlRefusedError for
 * anything a webhook may not reach.
 */
export async function checkWebhookUrl(raw: unknown): Promise<{ url: URL; target: CheckedAddress }> {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new WebhookUrlRefusedError('A valid URL starting with http:// or https:// is required');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookUrlRefusedError('A valid URL starting with http:// or https:// is required');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookUrlRefusedError('A valid URL starting with http:// or https:// is required');
  }
  if (url.username || url.password) {
    throw new WebhookUrlRefusedError('A webhook URL may not carry credentials');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new WebhookUrlRefusedError(WEBHOOK_URL_NOT_PUBLIC);
  }
  if (isIP(hostname) !== 0 && isNonPublicAddress(hostname)) {
    throw new WebhookUrlRefusedError(WEBHOOK_URL_NOT_PUBLIC);
  }
  try {
    return { url, target: await resolvePublicAddress(hostname) };
  } catch (err) {
    if (err instanceof OutboundAddressRefusedError) {
      throw new WebhookUrlRefusedError(err.reason === 'non_public' ? WEBHOOK_URL_NOT_PUBLIC : 'Webhook URL host could not be resolved');
    }
    throw err;
  }
}

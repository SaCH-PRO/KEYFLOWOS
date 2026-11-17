/**
 * TOF-WEBSITE-ENRICHMENT (V1-63; #63, PRS-M14; owner ruling D-188 'enrichment'):
 * contact enrichment from the business website.
 *
 * A contact's work email names their business's domain; that business's own
 * public website often declares its name and where it is (schema.org
 * Organization data, og:site_name, application-name). This source reads that
 * one page and nothing else, with no account and no paid lookup. It never
 * makes a fact up: a name the site does not declare is not guessed from the
 * domain, a free-mail address (webmail, or the mailbox an ISP gives its
 * customers) names no business, and a site that cannot be reached confirms
 * nothing.
 *
 * D-188: it runs only when a member who may edit the contact taps Enrich,
 * never in the background. ContactEnrichmentService is its only caller, after
 * the member's edit check, and only when Apollo is not configured. It is off
 * unless CONTACT_WEBSITE_ENRICHMENT is on, and it counts as configured for a
 * contact only when the contact has a business website (appliesTo), so the
 * Release 0 'not configured is a no-op' rule keeps holding.
 *
 * The domain comes from a contact record, so the fetch is an SSRF surface. It
 * is written on core/security/outbound-address.ts (rather than ported from
 * the archived #63 snapshot, whose own guard checked a name and let fetch
 * resolve it again):
 *   - every hop's host is resolved once (resolvePublicAddress, every answer
 *     asked for) and refused when any answer is not public or none comes back;
 *   - the request goes through a PinnedDispatcher pinned to the checked
 *     answers, so its connection never asks DNS again (no rebinding), with
 *     redirect 'manual'; each redirect target is checked the same way before
 *     it is asked for anything, at most WEBSITE_MAX_REDIRECTS of them;
 *   - a redirect is followed only within the site the email names: that
 *     host, or its www. pair (review SEC-WEB-1); any other host is a miss
 *     before it is resolved, so the facts come from the business's own site;
 *   - http and https on their default ports only, no credentials in the URL,
 *     html only, at most WEBSITE_MAX_BYTES read, one deadline
 *     (WEBSITE_FETCH_TIMEOUT_MS) for the resolver, the headers and the body;
 *   - the page is decoded in the encoding it declares (byte-order mark,
 *     Content-Type, <meta> in its first 1024 bytes, else UTF-8), and a value
 *     that still cannot be spelled is never written (review COR-WEB-2).
 *
 * Outcomes, as EnrichmentProvider defines them (never a throw): a refused
 * address, a name with no address (ENOTFOUND, ENODATA, an empty answer), a
 * 4xx, a page that is not html or declares nothing, a redirect off the site
 * or a redirect loop: 'no_match' (stamped, so the 7-day guard spares the next
 * tap; force asks again). A 5xx, 408 or 429, a network failure, a resolver
 * that cannot answer now (EAI_AGAIN, a timeout, a server failure; review
 * COR-WEB-1) or the deadline: 'error' (not stamped, so the next tap retries).
 */
import { Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import {
  OutboundAddressRefusedError,
  PinnedDispatcher,
  resolvePublicAddress,
  type CheckedAddress,
} from '../../../core/security/outbound-address';
import type { EnrichmentProvider, EnrichmentQuery, EnrichmentResult, ProviderOutcome } from './enrichment-provider';

/** The environment flag that turns the website source on ('1', 'true', 'on' or 'yes'). Off when unset. */
export const WEBSITE_ENRICHMENT_FLAG = 'CONTACT_WEBSITE_ENRICHMENT';
/** One deadline for the whole lookup: the resolver, every hop's headers and the body. */
export const WEBSITE_FETCH_TIMEOUT_MS = 6_000;
/** The most of a page that is read; the rest is cancelled unread. */
export const WEBSITE_MAX_BYTES = 256 * 1024;
/** The redirects followed, each target checked first. */
export const WEBSITE_MAX_REDIRECTS = 3;
/** The longest value written to a contact field. */
const MAX_VALUE_LENGTH = 200;

/**
 * Free-mail hosts: an address there names a person's mailbox, not a business
 * website. TOF-WEBSITE-ENRICHMENT review COR-WEB-3: webmail and the mailboxes
 * ISPs give their customers too (a site there would name the mail provider,
 * never the contact's business).
 */
const FREE_MAIL_HOSTS = new Set([
  // Webmail.
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'live.co.uk', 'msn.com', 'windowslive.com', 'passport.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com',
  'email.com', 'usa.com', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'ya.ru', 'tutanota.com',
  'tuta.io', 'tuta.com', 'tutamail.com', 'fastmail.com', 'fastmail.fm', 'hey.com', 'duck.com', 'posteo.de',
  'posteo.net', 'mailbox.org', 'hushmail.com', 'runbox.com', 'mailfence.com', 'disroot.org', 'skiff.com',
  'inbox.com', 'lycos.com', 'excite.com', 'rediffmail.com', 'naver.com', 'hanmail.net', 'daum.net', 'nate.com',
  'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', '139.com', 'sina.com', 'sina.cn', 'sohu.com',
  'aliyun.com', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru', 'rambler.ru', 'ukr.net', 'i.ua',
  'meta.ua', 'web.de', 'freenet.de', 'seznam.cz', 'email.cz', 'centrum.cz', 'atlas.cz', 'wp.pl', 'o2.pl',
  'onet.pl', 'op.pl', 'interia.pl', 'poczta.fm', 'libero.it', 'virgilio.it', 'email.it', 'inwind.it',
  'iol.it', 'laposte.net', 'mail.bg', 'abv.bg', 'uol.com.br', 'bol.com.br', 'ig.com.br', 'terra.com.br',
  'r7.com',
  // Mailboxes ISPs give their customers.
  't-online.de', 'arcor.de', 'vodafone.de', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr',
  'bbox.fr', 'numericable.fr', 'alice.it', 'tin.it', 'tiscali.it', 'tiscali.co.uk', 'btinternet.com',
  'btopenworld.com', 'sky.com', 'virginmedia.com', 'ntlworld.com', 'blueyonder.co.uk', 'talktalk.net',
  'tiscali.net', 'plus.net', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
  'cox.net', 'charter.net', 'spectrum.net', 'earthlink.net', 'optonline.net', 'frontier.com',
  'frontiernet.net', 'windstream.net', 'centurylink.net', 'q.com', 'juno.com', 'netzero.net', 'roadrunner.com',
  'rr.com', 'twc.com', 'mediacombb.net', 'suddenlink.net', 'rogers.com', 'shaw.ca', 'sympatico.ca',
  'bell.net', 'telus.net', 'videotron.ca', 'cogeco.ca', 'eastlink.ca', 'bigpond.com', 'bigpond.net.au',
  'optusnet.com.au', 'iinet.net.au', 'tpg.com.au', 'internode.on.net', 'westnet.com.au', 'xtra.co.nz',
  'slingshot.co.nz', 'orcon.net.nz', 'telkomsa.net', 'mweb.co.za', 'vodamail.co.za', 'tstt.net.tt',
  'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp', 'nifty.com', 'ocn.ne.jp', 'biglobe.ne.jp',
]);

/**
 * Free-mail brands that also run regional domains (yahoo.co.uk, hotmail.fr,
 * live.com.au, msn.co.uk): a host of the brand's name followed by a
 * country-style suffix only (one or two labels of at most 3 letters).
 */
const FREE_MAIL_BRANDS = new Set([
  'gmail', 'googlemail', 'yahoo', 'ymail', 'hotmail', 'outlook', 'live', 'msn', 'windowslive', 'aol', 'icloud',
  'protonmail', 'gmx', 'yandex', 'tutanota', 'zoho', 'rediffmail', 'rocketmail',
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Characters that would make a domain more than a host name inside a URL. */
const NOT_A_HOST = /[\s/\\?#@:%[\]]/;

function isFreeMail(host: string): boolean {
  if (FREE_MAIL_HOSTS.has(host)) return true;
  const [brand, ...rest] = host.split('.');
  return FREE_MAIL_BRANDS.has(brand) && rest.length >= 1 && rest.length <= 2 && rest.every((label) => label.length <= 3);
}

function emailDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

/**
 * TOF-WEBSITE-ENRICHMENT: the business website a contact's details name, or
 * null when they name none: the root page, over https on its default port, of
 * the domain of the contact's email address (query.domain when there is no
 * email). Null for no address, a free-mail host, an IP literal, a single label,
 * localhost, or anything that is not a plain DNS name (a port, a path, a
 * query, an escape, credentials).
 */
export function websiteFor(query: Pick<EnrichmentQuery, 'email' | 'domain'>): URL | null {
  const raw = emailDomain(query.email) ?? (typeof query.domain === 'string' ? query.domain : null);
  if (!raw) return null;
  const typed = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!typed || typed.length > 253 || NOT_A_HOST.test(typed)) return null;
  let url: URL;
  try {
    url = new URL(`https://${typed}/`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/\.$/, '');
  if (url.port !== '' || url.username || url.password || isIP(host) !== 0) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (isFreeMail(host)) return null;
  return new URL(`https://${host}/`);
}

/** What a business website declares about itself. */
export interface WebsiteFacts {
  companyName?: string;
  city?: string;
  state?: string;
  country?: string;
}

type Hop =
  | { kind: 'page'; html: string; website: string }
  | { kind: 'miss' }
  | { kind: 'transient' };

/**
 * TOF-WEBSITE-ENRICHMENT: the website source of contact enrichment (key
 * 'website'). See the file header for the rules it keeps.
 */
@Injectable()
export class PublicDataEnrichmentProvider implements EnrichmentProvider {
  readonly key = 'website';

  /** The lookup's one deadline; a subclass in a test may shorten it. */
  protected readonly timeoutMs: number = WEBSITE_FETCH_TIMEOUT_MS;

  private readonly logger = new Logger(PublicDataEnrichmentProvider.name);

  /** Read on every call: the flag is deployment configuration, off when unset. */
  get enabled(): boolean {
    return /^(1|true|on|yes)$/i.test((process.env[WEBSITE_ENRICHMENT_FLAG] ?? '').trim());
  }

  /** The source counts as configured for a contact only when the contact has a business website. */
  appliesTo(query: EnrichmentQuery): boolean {
    return websiteFor(query) !== null;
  }

  async enrich(query: EnrichmentQuery): Promise<ProviderOutcome> {
    // Never called while off (the service checks); answering 'error' keeps a stray call uncooled.
    if (!this.enabled) return { status: 'error' };
    const site = websiteFor(query);
    if (!site) return { status: 'no_match' };

    const deadline = AbortSignal.timeout(this.timeoutMs);
    let hop: Hop;
    try {
      hop = await this.readSite(site, deadline);
    } catch (err: unknown) {
      // A network failure, a TLS failure or the deadline: transient, never cooled down.
      this.logger.warn(`Website enrichment could not read the site: ${err instanceof Error ? err.name : 'unknown error'}`);
      return { status: 'error' };
    }
    if (hop.kind === 'transient') return { status: 'error' };
    if (hop.kind === 'miss') return { status: 'no_match' };

    const facts = readWebsiteFacts(hop.html);
    if (Object.keys(facts).length === 0) return { status: 'no_match' };
    const result: EnrichmentResult = { ...facts, raw: { source: 'website', website: hop.website } };
    return { status: 'match', result };
  }

  /**
   * The site's root page, following at most WEBSITE_MAX_REDIRECTS redirects,
   * each within the site (withinSite). Each hop: checked (checkHop), fetched
   * through its own PinnedDispatcher with redirect 'manual', and the
   * dispatcher destroyed once the hop is done.
   */
  private async readSite(start: URL, deadline: AbortSignal): Promise<Hop> {
    let url = start;
    for (let hops = 0; ; hops++) {
      const target = await this.checkHop(url, deadline);
      if (target === 'transient') return { kind: 'transient' };
      if (!target) return { kind: 'miss' };
      const dispatcher = new PinnedDispatcher(target);
      try {
        const response = await fetch(url.href, {
          method: 'GET',
          redirect: 'manual',
          dispatcher,
          signal: deadline,
          headers: {
            accept: 'text/html,application/xhtml+xml;q=0.9',
            'user-agent': 'Mozilla/5.0 (compatible; KEYFLOW-ContactEnrichment/1.0)',
          },
        } as RequestInit);

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await discard(response);
          if (!location || hops >= WEBSITE_MAX_REDIRECTS) return { kind: 'miss' };
          try {
            url = new URL(location, url);
          } catch {
            return { kind: 'miss' };
          }
          // Review SEC-WEB-1: only within the site the contact's email names;
          // any other host is a miss before it is resolved or asked anything.
          if (!withinSite(start, url)) return { kind: 'miss' };
          continue;
        }
        if (response.status >= 500 || response.status === 408 || response.status === 429) {
          await discard(response);
          return { kind: 'transient' };
        }
        if (!response.ok || !isHtml(response.headers.get('content-type'))) {
          await discard(response);
          return { kind: 'miss' };
        }
        const bytes = await readBounded(response, WEBSITE_MAX_BYTES, deadline);
        const html = decodePage(bytes, response.headers.get('content-type'));
        return { kind: 'page', html, website: `${url.protocol}//${url.host}/` };
      } finally {
        void dispatcher.destroy().catch(() => undefined);
      }
    }
  }

  /**
   * The addresses a hop may connect to, or null when the hop is refused: a
   * scheme other than http or https, a port other than the scheme's default
   * (WHATWG URL drops a default port, so any port left is another one),
   * credentials, a localhost name, or a host whose answers are not all public
   * or that has no address (resolvePublicAddress). 'transient' when the
   * resolver could not answer now (review COR-WEB-1: EAI_AGAIN, a timeout, a
   * server failure), which says nothing about the site. The resolver runs
   * under the lookup's deadline.
   */
  private async checkHop(url: URL, deadline: AbortSignal): Promise<CheckedAddress | 'transient' | null> {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.port !== '' || url.username || url.password) return null;
    const hostname = hostOf(url);
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return null;
    try {
      return await underDeadline(resolvePublicAddress(hostname), deadline);
    } catch (err: unknown) {
      if (err instanceof OutboundAddressRefusedError) {
        if (err.reason === 'non_public') this.logger.warn('Website enrichment refused a site that is not at a public address');
        if (err.transient) {
          this.logger.warn(`Website enrichment could not resolve the site now (${err.lookupCode ?? 'unknown'})`);
          return 'transient';
        }
        return null;
      }
      throw err;
    }
  }
}

/** A URL's host as it is resolved: lower case, no IPv6 brackets, no trailing dot. */
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
}

/**
 * TOF-WEBSITE-ENRICHMENT review SEC-WEB-1: true when a redirect target is on
 * the site the contact's email names: that host, or its www. pair (acme.com
 * and www.acme.com, either way round). Any other host, another subdomain or
 * a parent domain included, is not followed: the facts written to the
 * contact come only from the business's own site, and a member who controls
 * a domain cannot point KEYFLOW's requests at an unrelated host. (A
 * registrable-domain rule would need the public suffix list, a dependency;
 * the pair is the redirect sites make in practice.)
 */
function withinSite(start: URL, target: URL): boolean {
  const site = hostOf(start);
  const bare = site.startsWith('www.') && site.slice(4).includes('.') ? site.slice(4) : site;
  const host = hostOf(target);
  return host === bare || host === `www.${bare}`;
}

function isHtml(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** `work`, or the deadline's reason when it passes first. */
function underDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) return Promise.reject(deadline.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(deadline.reason ?? new Error('The website lookup timed out'));
    deadline.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        deadline.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        deadline.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** At most `maxBytes` of the body; the rest is cancelled unread. Each read runs under the deadline. */
async function readBounded(response: Response, maxBytes: number, deadline: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await underDeadline(reader.read(), deadline);
      if (done) break;
      const room = maxBytes - total;
      const bytes = value.byteLength > room ? value.subarray(0, room) : value;
      total += bytes.byteLength;
      chunks.push(bytes);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Decoding (review COR-WEB-2). The page is decoded in the character encoding
// it declares, in the order the HTML standard sniffs it: a byte-order mark,
// then the charset of the Content-Type, then a <meta charset> or
// <meta http-equiv="Content-Type"> within the first 1024 bytes, else UTF-8.
// A label TextDecoder does not know is ignored. A value that still cannot be
// spelled (U+FFFD) is never written (cleanValue).
// ---------------------------------------------------------------------------

/** How far into the page a <meta> charset is looked for (the HTML standard's prescan). */
const META_PRESCAN_BYTES = 1024;

/**
 * Windows-1252 at 0x80-0x9F, where it differs from ISO-8859-1 (WHATWG
 * index-windows-1252). Node's TextDecoder decodes 'windows-1252' (and every
 * label for it: iso-8859-1, latin1, ascii) as ISO-8859-1, so 0x92 would be the
 * control U+0092 rather than the right single quote; these are mapped here.
 */
const WINDOWS_1252_C1 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** The encoding a label names (WHATWG labels, any case), or null for a label TextDecoder does not know. */
function encodingFor(label: string | undefined): string | null {
  const trimmed = (label ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!trimmed) return null;
  try {
    return new TextDecoder(trimmed).encoding;
  } catch {
    return null;
  }
}

/** The charset parameter of a Content-Type (or of a <meta http-equiv> content), unquoted; undefined when none. */
function charsetParameter(contentType: string | null | undefined): string | undefined {
  for (const part of (contentType ?? '').split(';').slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim().toLowerCase() === 'charset') return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The encoding a <meta> in the first META_PRESCAN_BYTES declares, or null. ASCII-compatible read, one linear pass. */
function metaEncoding(bytes: Uint8Array): string | null {
  const head = latin1Text(bytes.subarray(0, META_PRESCAN_BYTES));
  let i = 0;
  while (i < head.length) {
    const open = head.indexOf('<', i);
    if (open < 0) return null;
    if (head.startsWith('<!--', open)) {
      const close = head.indexOf('-->', open + 4);
      if (close < 0) return null;
      i = close + 3;
      continue;
    }
    if (!readsAt(head, open + 1, 'meta') || isTagNameChar(head.charCodeAt(open + 5))) {
      i = open + 1;
      continue;
    }
    const read = readAttributes(head, open + 5);
    if (!read) return null;
    i = read.end;
    const declared = read.attributes.has('charset')
      ? read.attributes.get('charset')
      : (read.attributes.get('http-equiv') ?? '').trim().toLowerCase() === 'content-type'
        ? charsetParameter(`;${read.attributes.get('content') ?? ''}`)
        : undefined;
    const encoding = encodingFor(declared);
    if (encoding) return encoding === 'utf-16le' || encoding === 'utf-16be' ? 'utf-8' : encoding;
  }
  return null;
}

/** Bytes as ISO-8859-1 text (one character per byte), in slices so no call takes too many arguments. */
function latin1Text(bytes: Uint8Array, map?: (byte: number) => number): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    const slice = Array.from(bytes.subarray(start, start + 8192), map ?? ((byte) => byte));
    text += String.fromCharCode(...slice);
  }
  return text;
}

/** TOF-WEBSITE-ENRICHMENT review COR-WEB-2: the page's text, decoded in the encoding it declares. */
function decodePage(bytes: Uint8Array, contentType: string | null): string {
  let encoding: string;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else encoding = encodingFor(charsetParameter(contentType)) ?? metaEncoding(bytes) ?? 'utf-8';
  if (encoding === 'windows-1252') {
    return latin1Text(bytes, (byte) => (byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_C1[byte - 0x80] : byte));
  }
  return new TextDecoder(encoding).decode(bytes);
}

// ---------------------------------------------------------------------------
// Parsing (PRS-M14). One left-to-right pass: every step moves the cursor
// forward, and a construct that is never closed (a tag, a quote, a comment, a
// script) ends the pass, so hostile markup costs linear time. No regular
// expression runs over the page itself.
// ---------------------------------------------------------------------------

const NAMED_REFERENCES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', eacute: '\u00e9',
  egrave: '\u00e8', aacute: '\u00e1', oacute: '\u00f3', uacute: '\u00fa', iacute: '\u00ed', ntilde: '\u00f1', ccedil: '\u00e7', uuml: '\u00fc',
  ouml: '\u00f6', auml: '\u00e4',
};

function decodeReferences(value: string): string {
  return value.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_REFERENCES[body.toLowerCase()] ?? whole;
  });
}

/**
 * A value as written to a contact: control characters dropped, bidi and
 * zero-width marks removed, whitespace collapsed, at most MAX_VALUE_LENGTH
 * characters. Review COR-WEB-2: a value carrying U+FFFD (bytes the page's
 * encoding could not spell, or the reference itself) is no value at all.
 */
function cleanValue(value: string): string | undefined {
  if (value.includes('\ufffd')) return undefined;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return Array.from(cleaned).slice(0, MAX_VALUE_LENGTH).join('').trim() || undefined;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

function isTagNameChar(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39) || code === 0x2d;
}

/** True when `text` at `at` reads `word` (ASCII, any case). */
function readsAt(text: string, at: number, word: string): boolean {
  if (at + word.length > text.length) return false;
  for (let k = 0; k < word.length; k++) {
    let code = text.charCodeAt(at + k);
    if (code >= 0x41 && code <= 0x5a) code += 0x20;
    if (code !== word.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * A tag's attributes, from just after its name to its closing '>', the first
 * of a repeated name kept (as browsers do). Null when the tag or a quoted
 * value is never closed.
 */
function readAttributes(html: string, from: number): { attributes: Map<string, string>; end: number } | null {
  const attributes = new Map<string, string>();
  const length = html.length;
  let i = from;
  while (i < length) {
    while (i < length && (isSpace(html.charCodeAt(i)) || html.charCodeAt(i) === 0x2f)) i++;
    if (i >= length) return null;
    if (html.charCodeAt(i) === 0x3e) return { attributes, end: i + 1 };
    const nameStart = i;
    while (i < length) {
      const code = html.charCodeAt(i);
      if (isSpace(code) || code === 0x3d || code === 0x3e || code === 0x2f) break;
      i++;
    }
    const name = html.slice(nameStart, i).toLowerCase();
    while (i < length && isSpace(html.charCodeAt(i))) i++;
    let value = '';
    if (i < length && html.charCodeAt(i) === 0x3d) {
      i++;
      while (i < length && isSpace(html.charCodeAt(i))) i++;
      if (i >= length) return null;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < length && !isSpace(html.charCodeAt(i)) && html.charCodeAt(i) !== 0x3e) i++;
        value = html.slice(valueStart, i);
      }
    }
    if (name && !attributes.has(name)) attributes.set(name, value);
    if (i === nameStart) i++; // always move forward
  }
  return null;
}

/** Where the script element's text that starts at `from` ends ('</script', any case), or -1. */
function scriptEnd(html: string, from: number): number {
  let at = from;
  for (;;) {
    const close = html.indexOf('</', at);
    if (close < 0) return -1;
    if (readsAt(html, close + 2, 'script')) return close;
    at = close + 2;
  }
}

/** schema.org types that are a business or other organization. */
const ORGANIZATION_TYPES = new Set([
  'Organization', 'Corporation', 'LocalBusiness', 'OnlineBusiness', 'OnlineStore', 'NGO', 'Consortium', 'Cooperative',
  'ProfessionalService', 'FinancialService', 'LegalService', 'AccountingService', 'EmergencyService', 'Restaurant',
  'Bakery', 'CafeOrCoffeeShop', 'BarOrPub', 'Brewery', 'Winery', 'Dentist', 'Physician', 'Pharmacy', 'Optician',
  'Hotel', 'Motel', 'Florist', 'Attorney', 'Notary', 'Plumber', 'Electrician', 'Locksmith', 'HairSalon',
  'BeautySalon', 'NailSalon', 'DaySpa', 'HealthClub', 'AutoRepair', 'AutoDealer', 'TravelAgency', 'RealEstateAgent',
  'InsuranceAgency', 'BankOrCreditUnion', 'Airline', 'School', 'CollegeOrUniversity',
]);
const ORGANIZATION_SUFFIX = /(Organization|Organisation|Business|Store|Agency|Restaurant|Establishment|Contractor|Shop)$/;

function isOrganization(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((entry) => {
    if (typeof entry !== 'string') return false;
    const name = entry.replace(/^(?:https?:\/\/schema\.org\/|schema:)/, '');
    return ORGANIZATION_TYPES.has(name) || ORGANIZATION_SUFFIX.test(name);
  });
}

/** A JSON-LD text value: a string, the first string of a list, or a {'@value'} object. */
function jsonText(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanValue(decodeReferences(value));
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = jsonText(item);
      if (text) return text;
    }
    return undefined;
  }
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)['@value'] === 'string') {
    return jsonText((value as Record<string, unknown>)['@value']);
  }
  return undefined;
}

function organizationFacts(node: Record<string, unknown>): WebsiteFacts {
  const facts: WebsiteFacts = {};
  const name = jsonText(node.name) ?? jsonText(node.legalName);
  if (name) facts.companyName = name;
  const address = Array.isArray(node.address) ? node.address.find((a) => a && typeof a === 'object') : node.address;
  if (address && typeof address === 'object') {
    const postal = address as Record<string, unknown>;
    const city = jsonText(postal.addressLocality);
    const state = jsonText(postal.addressRegion);
    const countryField = postal.addressCountry;
    const country =
      countryField && typeof countryField === 'object' && !Array.isArray(countryField)
        ? jsonText((countryField as Record<string, unknown>).name)
        : jsonText(countryField);
    if (city) facts.city = city;
    if (state) facts.state = state;
    if (country) facts.country = country;
  }
  return facts;
}

/** The organizations a JSON-LD document declares at its top level or in its @graph; bounded in depth and size. */
function collectOrganizations(node: unknown, out: WebsiteFacts[], budget: { nodes: number }, depth = 0): void {
  if (depth > 6 || budget.nodes <= 0 || !node || typeof node !== 'object') return;
  budget.nodes -= 1;
  if (Array.isArray(node)) {
    for (const item of node) collectOrganizations(item, out, budget, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  if (isOrganization(record['@type'])) {
    const facts = organizationFacts(record);
    if (Object.keys(facts).length > 0) out.push(facts);
  }
  if (record['@graph'] !== undefined) collectOrganizations(record['@graph'], out, budget, depth + 1);
}

/**
 * TOF-WEBSITE-ENRICHMENT (PRS-M14): what a page declares about its business,
 * in one linear pass. The name is the first schema.org Organization's (or a
 * subtype's) name, else og:site_name, else application-name; the city, region
 * and country come only from that Organization's own address. A title, the
 * page text, a comment, an ordinary script and the domain name are never read
 * as a name. Values are entity-decoded and cleaned (cleanValue).
 */
export function readWebsiteFacts(html: string): WebsiteFacts {
  const metas = new Map<string, string>();
  const organizations: WebsiteFacts[] = [];
  const budget = { nodes: 500 };
  const length = html.length;
  let i = 0;
  while (i < length) {
    const open = html.indexOf('<', i);
    if (open < 0) break;
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    let nameEnd = open + 1;
    while (nameEnd < length && isTagNameChar(html.charCodeAt(nameEnd))) nameEnd++;
    const tag = html.slice(open + 1, nameEnd).toLowerCase();
    if (tag !== 'meta' && tag !== 'script') {
      i = open + 1;
      continue;
    }
    const read = readAttributes(html, nameEnd);
    if (!read) break;
    i = read.end;
    if (tag === 'meta') {
      const content = read.attributes.get('content');
      if (content === undefined) continue;
      for (const key of [read.attributes.get('property'), read.attributes.get('name')]) {
        const name = key?.trim().toLowerCase();
        if ((name === 'og:site_name' || name === 'application-name') && !metas.has(name)) {
          const value = cleanValue(decodeReferences(content));
          if (value) metas.set(name, value);
        }
      }
      continue;
    }
    // A script: its text is skipped, and read only when it is JSON-LD.
    const end = scriptEnd(html, i);
    if (end < 0) break;
    if ((read.attributes.get('type') ?? '').trim().toLowerCase() === 'application/ld+json') {
      try {
        collectOrganizations(JSON.parse(html.slice(i, end)), organizations, budget);
      } catch {
        // Not JSON: skipped.
      }
    }
    i = end + 2;
  }

  const organization = organizations.find((o) => o.companyName) ?? organizations[0] ?? {};
  const facts: WebsiteFacts = {};
  const companyName = organization.companyName ?? metas.get('og:site_name') ?? metas.get('application-name');
  if (companyName) facts.companyName = companyName;
  if (organization.city) facts.city = organization.city;
  if (organization.state) facts.state = organization.state;
  if (organization.country) facts.country = organization.country;
  return facts;
}

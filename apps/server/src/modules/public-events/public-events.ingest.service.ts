import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PresenceStatsService } from './presence-stats.service';

const ALLOWED_TYPES = new Set([
  'page_view',
  'view',
  'product_view',
  'service_view',
  'booking_start',
  'booking_complete',
  'checkout_start',
  'checkout_complete',
  'form_submit',
  'whatsapp_click',
  'share_click',
  'share',
]);

// Strict allowlist — only these payload keys are persisted on a public
// event. Everything else (form values, free text, anything that might
// contain PII) is dropped on the floor by safePayload(). This is the
// hard guarantee that public-event capture cannot be coerced into a
// PII sink even if a misbehaving client tries.
const PAYLOAD_ALLOWLIST = new Set([
  'itemId', 'productId', 'serviceId', 'categoryId', 'sectionKey',
  'amount', 'currency', 'count', 'quantity', 'durationMs',
  'channel', 'method', 'kind', 'variant', 'status',
  'orderId', 'invoiceId', 'quoteId', 'bookingId', 'paymentLinkId',
]);

export type IngestEventInput = {
  visitorId?: string | null;
  sessionId?: string | null;
  businessId: string;
  type: string;
  path?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  referrer?: string | null;
  payload?: Record<string, unknown> | null;
  ts?: string | number | Date | null;
};

@Injectable()
export class PublicEventsIngestService {
  private readonly logger = new Logger(PublicEventsIngestService.name);
  // Short-lived allowlist cache: businessId -> expiry timestamp. Prevents
  // an unauthenticated client from polluting analytics for businesses
  // that aren't actually publicly addressable.
  private readonly businessAllowCache = new Map<string, number>();
  private static readonly ALLOW_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PresenceStatsService) private readonly stats: PresenceStatsService,
  ) {}

  /**
   * Validate that a businessId is one we want to accept events for.
   * The bar is intentionally low — any non-deleted business with a
   * public surface (storeEnabled, public booking, presence site, or
   * even an active invoice flow) qualifies. Rejected IDs are cached as
   * `0` so a malicious caller can't burn DB cycles probing IDs.
   */
  private async isBusinessIngestable(businessId: string): Promise<boolean> {
    const cached = this.businessAllowCache.get(businessId);
    const now = Date.now();
    if (cached !== undefined) {
      if (cached === 0) return false;
      if (cached > now) return true;
    }
    try {
      const biz = await this.prisma.client.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { id: true },
      });
      const ok = !!biz;
      this.businessAllowCache.set(businessId, ok ? now + PublicEventsIngestService.ALLOW_TTL_MS : 0);
      // Cap cache size to bound memory under attack.
      if (this.businessAllowCache.size > 5000) {
        const firstKey = this.businessAllowCache.keys().next().value;
        if (firstKey) this.businessAllowCache.delete(firstKey);
      }
      return ok;
    } catch {
      return false;
    }
  }

  static newVisitorId(): string {
    return `v_${randomBytes(12).toString('hex')}`;
  }

  static newSessionId(): string {
    return `s_${randomBytes(8).toString('hex')}`;
  }

  private hashIp(ip: string | null | undefined): string | null {
    if (!ip) return null;
    return createHash('sha256').update(ip).digest('hex').slice(0, 16);
  }

  private safePayload(input: Record<string, unknown> | null | undefined): Prisma.InputJsonValue {
    if (!input || typeof input !== 'object') return {} as Prisma.InputJsonValue;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      // Strict allowlist: silently drop anything not analytics-safe.
      if (!PAYLOAD_ALLOWLIST.has(k)) continue;
      if (v === null || v === undefined) continue;
      const t = typeof v;
      if (t === 'string') {
        out[k] = (v as string).slice(0, 200);
      } else if (t === 'number' || t === 'boolean') {
        out[k] = v;
      }
      // arrays + nested objects are intentionally dropped
    }
    return out as Prisma.InputJsonValue;
  }

  /**
   * Resolve the trusted businessId for an ingestion request from the
   * Referer/Origin URL. Public events are only honored for surfaces we
   * can independently look up server-side (slug, public token, invoice
   * id). This binds analytics to a real public surface and prevents an
   * unauthenticated caller from injecting fake KPIs against a known
   * business id.
   */
  async resolveBusinessFromReferer(referer: string | null | undefined): Promise<string | null> {
    if (!referer) return null;
    let path: string;
    try {
      path = new URL(referer).pathname;
    } catch {
      return null;
    }
    const seg = path.split('?')[0].split('#')[0];

    // /book/<slug> | /site/<slug>  → resolve via Business.slug
    let m = /^\/(?:book|site)\/([^/]+)/.exec(seg);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      const biz = await this.prisma.client.business.findFirst({
        where: { slug, deletedAt: null }, select: { id: true },
      });
      return biz?.id ?? null;
    }

    // /quote/<token>  → Quote.viewToken (public-link signed token)
    m = /^\/quote\/([^/]+)/.exec(seg);
    if (m) {
      const token = decodeURIComponent(m[1]);
      const q = await this.prisma.client.quote.findFirst({
        where: { viewToken: token }, select: { businessId: true },
      });
      return q?.businessId ?? null;
    }

    // /pay/link/<token>  → PaymentLink.token
    m = /^\/pay\/link\/([^/]+)/.exec(seg);
    if (m) {
      const token = decodeURIComponent(m[1]);
      const pl = await this.prisma.client.paymentLink.findFirst({
        where: { token }, select: { businessId: true },
      });
      return pl?.businessId ?? null;
    }

    // /pay/<invoiceId>  → Invoice.id
    m = /^\/pay\/([^/]+)/.exec(seg);
    if (m && m[1] !== 'link') {
      const id = decodeURIComponent(m[1]);
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id }, select: { businessId: true },
      });
      return inv?.businessId ?? null;
    }

    // /order/<token>  → MarketplaceOrder.metadata.publicToken (JSON path)
    m = /^\/order\/([^/]+)/.exec(seg);
    if (m) {
      const token = decodeURIComponent(m[1]);
      const o = await this.prisma.client.marketplaceOrder.findFirst({
        where: { metadata: { path: ['publicToken'], equals: token } },
        select: { businessId: true },
      });
      return o?.businessId ?? null;
    }

    return null;
  }

  private parseTs(ts: IngestEventInput['ts']): Date {
    if (!ts) return new Date();
    if (ts instanceof Date) return ts;
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (isNaN(d.getTime())) return new Date();
    // Reject far-future / very old to keep aggregates honest.
    const now = Date.now();
    const diff = Math.abs(d.getTime() - now);
    if (diff > 1000 * 60 * 60 * 24 * 7) return new Date();
    return d;
  }

  private async ensureVisitor(input: {
    businessId: string;
    visitorId: string;
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    referrer?: string | null;
    path?: string | null;
  }) {
    try {
      await this.prisma.client.publicVisitor.upsert({
        where: {
          businessId_visitorId: {
            businessId: input.businessId,
            visitorId: input.visitorId,
          },
        },
        create: {
          businessId: input.businessId,
          visitorId: input.visitorId,
          firstSource: input.source ?? null,
          firstMedium: input.medium ?? null,
          firstCampaign: input.campaign ?? null,
          firstReferrer: input.referrer ?? null,
          firstPath: input.path ?? null,
        },
        update: { lastSeenAt: new Date() },
      });
    } catch (err) {
      this.logger.debug?.(`[public-events] visitor upsert skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Ingest a batch of public events. Each event is validated and stored
   * independently; bad events are silently skipped so a single typo from
   * a public client never poisons the whole batch.
   */
  async ingestBatch(input: {
    events: IngestEventInput[];
    visitorId: string;
    sessionId: string;
    ip?: string | null;
    doNotTrack?: boolean;
    /**
     * BusinessId resolved server-side from the Referer/Origin URL.
     * When present, every event in the batch must either omit
     * businessId (we fill it in) or match this id; otherwise the event
     * is silently dropped. This binds public-event capture to a real
     * public surface (slug, token, invoice id) so an attacker who
     * knows a businessId cannot poison KPIs by spraying /public/events
     * directly.
     */
    refererBusinessId?: string | null;
  }) {
    if (input.doNotTrack) {
      return { tracked: 0, skipped: input.events.length, reason: 'dnt' };
    }

    const ipHash = this.hashIp(input.ip ?? null);
    const accepted: Array<{ id: string; type: string }> = [];
    const refererBiz = input.refererBusinessId ?? null;

    for (const raw of input.events.slice(0, 50)) {
      if (!raw || typeof raw !== 'object') continue;
      const type = (raw.type ?? '').trim();
      if (!type || !ALLOWED_TYPES.has(type)) continue;

      // Trust the Referer-resolved businessId over the client-supplied
      // one. Empty client id is OK as long as the surface resolved.
      const claimed = (raw.businessId ?? '').trim();
      const businessId = refererBiz ?? claimed;
      if (!businessId) continue;
      if (refererBiz && claimed && claimed !== refererBiz) {
        // Caller tried to cross-tag a different business — drop.
        continue;
      }
      if (!refererBiz) {
        // No trusted surface (e.g. server-side curl, intake script):
        // fall back to the existence check so we still don't accept
        // events for unknown/deleted businesses.
        const ok = await this.isBusinessIngestable(businessId);
        if (!ok) continue;
      }

      const ts = this.parseTs(raw.ts);
      const path = raw.path ? String(raw.path).slice(0, 300) : null;
      const source = raw.source ? String(raw.source).slice(0, 100) : null;
      const medium = raw.medium ? String(raw.medium).slice(0, 100) : null;
      const campaign = raw.campaign ? String(raw.campaign).slice(0, 100) : null;
      const referrer = raw.referrer ? String(raw.referrer).slice(0, 300) : null;

      try {
        const stored = await this.prisma.client.publicEvent.create({
          data: {
            businessId,
            visitorId: input.visitorId,
            sessionId: input.sessionId,
            type,
            path,
            source,
            medium,
            campaign,
            referrer,
            payload: this.safePayload(raw.payload ?? null),
            ipHash,
            ts,
          },
        });
        accepted.push({ id: stored.id, type });

        await this.ensureVisitor({
          businessId,
          visitorId: input.visitorId,
          source,
          medium,
          campaign,
          referrer,
          path,
        });

        await this.stats.incrementForEvent({
          businessId,
          visitorId: input.visitorId,
          type,
          path,
          source,
          medium,
          campaign,
          referrer,
          payload: raw.payload as Prisma.JsonValue,
          ts,
        });
      } catch (err) {
        this.logger.debug?.(`[public-events] ingest failed type=${type}: ${(err as Error).message}`);
      }
    }

    return { tracked: accepted.length, skipped: input.events.length - accepted.length, ids: accepted };
  }

  /**
   * First-touch attribution lookup used by storefront flows when a
   * Contact is being created. Always scoped to the calling business so
   * the same visitor cookie cannot leak attribution across tenants.
   */
  async firstTouchFor(businessId: string, visitorId: string | null | undefined) {
    if (!visitorId || !businessId) return null;
    const v = await this.prisma.client.publicVisitor.findUnique({
      where: { businessId_visitorId: { businessId, visitorId } },
      select: { firstSource: true, firstMedium: true, firstCampaign: true, firstReferrer: true, firstPath: true },
    });
    return v ?? null;
  }

  async linkVisitorToContact(businessId: string, visitorId: string | null | undefined, contactId: string) {
    if (!visitorId || !businessId) return;
    try {
      await this.prisma.client.publicVisitor.update({
        where: { businessId_visitorId: { businessId, visitorId } },
        data: { contactId },
      });
    } catch {
      // visitor row may not exist yet — ignore.
    }
  }
}

import { BadRequestException, ForbiddenException, Injectable, Inject, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import * as webpush from 'web-push';
import { PrismaService } from '../../core/prisma/prisma.service';

const MAX_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_PUSH_KEY_LENGTH = 512;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * FU-PUSH-ENDPOINT-ALLOWLIST (P71 / MIN-4): exact hosts and strict subdomain
 * suffixes for standard browser Web Push services (Chrome/Edge/Android FCM,
 * Firefox Mozilla autopush, Safari Apple Web Push, Windows WNS).
 */
const ALLOWED_PUSH_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

const ALLOWED_PUSH_SUBDOMAIN_SUFFIXES = [
  '.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
] as const;

const RAW_HTTPS_AUTHORITY_RE = /^https:\/\/([a-z0-9.-]+)\//i;

function hasForbiddenChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return /[\s\\]/.test(value);
}

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  if (endpoint.length === 0 || endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  if (hasForbiddenChar(endpoint)) return false;

  // Enforce raw `https://<ascii-host>/<path>` syntax so WHATWG `new URL()`
  // and `web-push`'s legacy `url.parse()` can never diverge (blocks `https:/`,
  // `https:`, `https:///`, backslashes, empty/non-empty userinfo `@`, explicit
  // `:port`, and IDN/Unicode dot lookalikes in the authority).
  const authorityMatch = RAW_HTTPS_AUTHORITY_RE.exec(endpoint);
  if (!authorityMatch) return false;
  const rawHost = authorityMatch[1].toLowerCase();

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.port !== '') return false;
  if (!parsed.pathname || parsed.pathname === '/') return false;

  const host = parsed.hostname.toLowerCase();
  if (!host || host !== rawHost || host.startsWith('.') || host.endsWith('.') || host.startsWith('[') || isIP(host) !== 0) {
    return false;
  }

  if (ALLOWED_PUSH_EXACT_HOSTS.has(host)) return true;

  for (const suffix of ALLOWED_PUSH_SUBDOMAIN_SUFFIXES) {
    if (host.endsWith(suffix)) {
      const prefix = host.slice(0, -suffix.length);
      if (!prefix) return false;
      const labels = prefix.split('.');
      if (labels.every((label) => DNS_LABEL_RE.test(label))) {
        return true;
      }
    }
  }
  return false;
}

export function assertAllowedPushEndpoint(endpoint: unknown): string {
  if (!isAllowedPushEndpoint(endpoint)) {
    throw new BadRequestException('Push subscription endpoint must be an HTTPS URL on a supported push service');
  }
  const canonical = new URL(endpoint).href;
  if (!isAllowedPushEndpoint(canonical)) {
    throw new BadRequestException('Push subscription endpoint must be an HTTPS URL on a supported push service');
  }
  return canonical;
}

function assertValidPushKeys(keys: unknown): { p256dh: string; auth: string } {
  const rec = keys as { p256dh?: unknown; auth?: unknown } | null | undefined;
  if (
    typeof rec?.p256dh !== 'string' ||
    typeof rec?.auth !== 'string' ||
    rec.p256dh.trim().length === 0 ||
    rec.auth.trim().length === 0 ||
    rec.p256dh.length > MAX_PUSH_KEY_LENGTH ||
    rec.auth.length > MAX_PUSH_KEY_LENGTH
  ) {
    throw new BadRequestException('Invalid push subscription keys');
  }
  return { p256dh: rec.p256dh, auth: rec.auth };
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private vapidReady = false;
  private appliedVapidTuple: string | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    if (!this.ensureVapidConfigured() && !(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim())) {
      this.logger.warn('VAPID keys not configured. Push notifications will not work.');
    }
  }

  private ensureVapidConfigured(): boolean {
    const vapidPublic = process.env.VAPID_PUBLIC_KEY?.trim() ?? '';
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';
    const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@keyflowos.com';

    if (!vapidPublic || !vapidPrivate) {
      this.vapidReady = false;
      this.appliedVapidTuple = null;
      return false;
    }

    const tuple = `${vapidSubject}\0${vapidPublic}\0${vapidPrivate}`;
    if (this.appliedVapidTuple === tuple) {
      return this.vapidReady;
    }

    try {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      this.vapidReady = true;
    } catch (err: unknown) {
      this.logger.warn(
        `Invalid VAPID keys configured; push notifications disabled: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.vapidReady = false;
    }
    this.appliedVapidTuple = tuple;
    return this.vapidReady;
  }

  private async upsertDeviceSubscription(
    tx: Pick<typeof this.prisma.client, 'pushSubscription'>,
    userId: string,
    businessId: string,
    endpoint: string,
    keys: { p256dh: string; auth: string },
  ) {
    const saved = await tx.pushSubscription.upsert({
      where: { businessId_endpoint: { businessId, endpoint } },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId,
      },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId,
        businessId,
      },
    });
    // Keep rotated browser push keys in sync across every other business this
    // same member already subscribed this device endpoint for.
    await tx.pushSubscription.updateMany({
      where: { userId, endpoint, businessId: { not: businessId } },
      data: {
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });
    return saved;
  }

  async subscribe(userId: string, businessId: string, subscription: webpush.PushSubscription) {
    const endpoint = assertAllowedPushEndpoint(subscription?.endpoint);
    const keys = assertValidPushKeys(subscription?.keys);

    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(18842, hashtext(${endpoint}))`;
      return this.upsertDeviceSubscription(tx, userId, businessId, endpoint, keys);
    });
  }

  /**
   * SWEEP-P0-FOLLOWUP (census owner question 3) + P242 FU-PUSH-MULTI-BUSINESS (D-319 / Q45):
   * A member's own device. An endpoint another member's subscription already holds (in this
   * business or any other) is never taken over; the caller's own device can be subscribed across
   * multiple businesses without overwriting prior businesses, and rotated keys refresh all of
   * that member's rows for the endpoint atomically under a per-endpoint advisory lock.
   */
  async subscribeOwn(userId: string, businessId: string, subscription: webpush.PushSubscription) {
    const endpoint = assertAllowedPushEndpoint(subscription?.endpoint);
    const keys = assertValidPushKeys(subscription?.keys);
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(18842, hashtext(${endpoint}))`;
      const heldByOther = await tx.pushSubscription.findFirst({
        where: { endpoint, userId: { not: userId } },
        select: { userId: true },
      });
      if (heldByOther) {
        throw new ForbiddenException('This device is subscribed by another member');
      }
      return this.upsertDeviceSubscription(tx, userId, businessId, endpoint, keys);
    });
  }

  private endpointMatchCandidates(endpoint: string): string[] {
    if (!isAllowedPushEndpoint(endpoint)) return [endpoint];
    const canonical = new URL(endpoint).href;
    return canonical === endpoint ? [endpoint] : [endpoint, canonical];
  }

  /** SWEEP-P0-FOLLOWUP (census owner question 3): removes the caller's own subscription of that endpoint only. */
  async unsubscribeOwn(userId: string, endpoint: string) {
    const candidates = this.endpointMatchCandidates(endpoint);
    return this.prisma.client.pushSubscription.deleteMany({
      where: { endpoint: { in: candidates }, userId },
    });
  }

  async unsubscribe(endpoint: string) {
    const candidates = this.endpointMatchCandidates(endpoint);
    return this.prisma.client.pushSubscription.deleteMany({
      where: { endpoint: { in: candidates } },
    });
  }

  private dispatchPush(
    subscription: webpush.PushSubscription,
    serializedPayload: string,
  ): Promise<unknown> {
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      this.logger.warn('Blocked outbound push to disallowed endpoint host');
      return Promise.reject(new Error('Disallowed push subscription endpoint'));
    }
    return this.sendPushNotification(subscription, serializedPayload);
  }

  protected sendPushNotification(
    subscription: webpush.PushSubscription,
    serializedPayload: string,
  ): Promise<unknown> {
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      return Promise.reject(new Error('Disallowed push subscription endpoint'));
    }
    const canonicalEndpoint = new URL(subscription.endpoint).href;
    if (!isAllowedPushEndpoint(canonicalEndpoint)) {
      return Promise.reject(new Error('Disallowed push subscription endpoint'));
    }
    return webpush.sendNotification({ ...subscription, endpoint: canonicalEndpoint }, serializedPayload);
  }

  async sendToUser(userId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
    const allSubs = await this.prisma.client.pushSubscription.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    if (allSubs.length === 0 || !this.isConfigured()) {
      return { sent: 0, failed: 0 };
    }

    // Deduplicate by endpoint so a device subscribed to multiple businesses
    // receives a single user-level push (using its most recently updated keys).
    const seenEndpoints = new Set<string>();
    const subs = allSubs.filter((sub) => {
      if (seenEndpoints.has(sub.endpoint)) return false;
      seenEndpoints.add(sub.endpoint);
      return true;
    });

    const serialized = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map((sub) =>
        this.dispatchPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          serialized,
        ),
      ),
    );

    // Clean up expired subscriptions across every business holding the dead endpoint
    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as webpush.WebPushError;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { userId, endpoint: { in: expiredEndpoints } },
      });
    }

    return { sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
  }

  async sendToBusiness(businessId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
    const subs = await this.prisma.client.pushSubscription.findMany({
      where: { businessId },
    });
    if (subs.length === 0 || !this.isConfigured()) {
      return { sent: 0, failed: 0 };
    }

    const serialized = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map((sub) =>
        this.dispatchPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          serialized,
        ),
      ),
    );

    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as webpush.WebPushError;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { businessId, endpoint: { in: expiredEndpoints } },
      });
    }

    return { sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
  }

  /**
   * OWNER-ALERTS-SERVER (V1-65): tenant- and user-scoped web-push delivery for
   * business owners. Only queries PushSubscription rows belonging to both
   * `businessId` and `userIds`; skips delivery cleanly when VAPID keys are not
   * configured so callers can trigger email fallback; prunes 410/404 expired
   * subscriptions strictly within `businessId`.
   */
  async sendToBusinessUsers(
    businessId: string,
    userIds: string[],
    payload: { title: string; body: string; icon?: string; url?: string; tag?: string; data?: Record<string, unknown> },
  ): Promise<{ attempted: number; sent: number; failed: number }> {
    const uniqueUserIds = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
    if (!businessId || uniqueUserIds.length === 0) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const subs = await this.prisma.client.pushSubscription.findMany({
      where: { businessId, userId: { in: uniqueUserIds } },
    });
    if (subs.length === 0) {
      return { attempted: 0, sent: 0, failed: 0 };
    }
    if (!this.isConfigured()) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const serialized = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map((sub) =>
        this.dispatchPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          serialized,
        ),
      ),
    );

    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as webpush.WebPushError;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { businessId, endpoint: { in: expiredEndpoints } },
      });
    }

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { attempted: subs.length, sent, failed };
  }

  isConfigured(): boolean {
    return this.ensureVapidConfigured();
  }
}

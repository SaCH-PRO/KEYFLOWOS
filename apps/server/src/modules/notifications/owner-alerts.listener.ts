import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PushNotificationService } from '../push-notifications/push-notification.service';
import { SystemEmailService } from './system-email.service';
import { ownerAlertTemplate } from './email-templates';
import { appUrl } from '../../core/config/runtime-urls';
import { redactAddresses } from '../../core/security/redaction';
import type { BookingCreatedPayload, InvoicePaidPayload } from '../../core/event-bus/events.types';

export type OwnerAlertCategory = 'bookings' | 'payments' | 'claims';

export const OWNER_ALERT_CLAIM_COALESCE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface InvoicePaymentClaimedPayload {
  businessId: string;
  invoiceId?: string;
  claimId?: string;
  method?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  reference?: string | null;
  customerName?: string | null;
  invoice?: {
    id?: string;
    businessId?: string;
    invoiceNumber?: string | null;
    total?: number | string | null;
    currency?: string | null;
    contact?: { firstName?: string | null; lastName?: string | null } | null;
  } | null;
}

interface OwnerAlertPreferencesResult {
  enabled: boolean;
  push: boolean;
  email: boolean;
}

/**
 * Evaluates Business.notificationPreferences for owner alerts.
 * Defaults to enabled (both push and email fallback) unless explicitly disabled
 * via master (`owner_alerts: false`, `ownerAlerts: false`, `owner_alerts_enabled: false`),
 * per-category (`owner_alerts.<cat>: false`, `ownerAlerts.<cat>: false`,
 * `owner_alert_<cat>: false`), or per-channel (`owner_alerts.push / email: false`).
 * Turning off customer-facing email toggles (e.g. `payment_receipt: false`) never
 * silences owner alerts.
 */
export function resolveOwnerAlertPreferences(
  rawPrefs: unknown,
  category: OwnerAlertCategory,
): OwnerAlertPreferencesResult {
  if (!rawPrefs || typeof rawPrefs !== 'object' || Array.isArray(rawPrefs)) {
    return { enabled: true, push: true, email: true };
  }
  const prefs = rawPrefs as Record<string, unknown>;
  if (prefs.owner_alerts === false || prefs.ownerAlerts === false || prefs.owner_alerts_enabled === false) {
    return { enabled: false, push: false, email: false };
  }

  const flatKey = `owner_alert_${category}`;
  if (prefs[flatKey] === false) {
    return { enabled: false, push: false, email: false };
  }

  const nestedRaw =
    (prefs.owner_alerts && typeof prefs.owner_alerts === 'object' && !Array.isArray(prefs.owner_alerts)
      ? (prefs.owner_alerts as Record<string, unknown>)
      : null) ??
    (prefs.ownerAlerts && typeof prefs.ownerAlerts === 'object' && !Array.isArray(prefs.ownerAlerts)
      ? (prefs.ownerAlerts as Record<string, unknown>)
      : null);

  if (nestedRaw) {
    if (nestedRaw.enabled === false || nestedRaw[category] === false) {
      return { enabled: false, push: false, email: false };
    }
    const push = nestedRaw.push !== false;
    const email = nestedRaw.email !== false;
    return { enabled: push || email, push, email };
  }

  return { enabled: true, push: true, email: true };
}

interface ClaimCoalesceRecord {
  windowStartedAt: string;
  lastAlertCount: number;
  pendingCoalesced: number;
  lastClaimedAt: string;
}

function parseClaimCoalesceRecord(raw: unknown): ClaimCoalesceRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.windowStartedAt !== 'string') return null;
  const startedMs = Date.parse(rec.windowStartedAt);
  if (!Number.isFinite(startedMs)) return null;
  return {
    windowStartedAt: rec.windowStartedAt,
    lastAlertCount: typeof rec.lastAlertCount === 'number' && Number.isFinite(rec.lastAlertCount) ? rec.lastAlertCount : 1,
    pendingCoalesced:
      typeof rec.pendingCoalesced === 'number' && Number.isFinite(rec.pendingCoalesced) && rec.pendingCoalesced >= 0
        ? Math.floor(rec.pendingCoalesced)
        : 0,
    lastClaimedAt: typeof rec.lastClaimedAt === 'string' ? rec.lastClaimedAt : rec.windowStartedAt,
  };
}

function formatAmount(amount: unknown, currency?: string | null): string {
  if (amount == null || (typeof amount === 'string' && amount.trim() === '')) return '';
  const num = Number(amount);
  if (!Number.isFinite(num)) return '';
  const curr = (currency || 'TTD').toUpperCase();
  return `${curr} ${num.toFixed(2)}`;
}

function contactName(contact?: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!contact) return '';
  return [contact.firstName, contact.lastName].filter((s) => typeof s === 'string' && s.trim().length > 0).join(' ').trim();
}

function sanitizeLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function formatMethodLabel(method?: string | null): string {
  const clean = sanitizeLine(method).toLowerCase();
  if (!clean) return 'Offline payment';
  switch (clean) {
    case 'bank_transfer':
      return 'Bank transfer';
    case 'cash':
      return 'Cash';
    case 'check':
      return 'Cheque';
    case 'google_pay':
      return 'Google Pay';
    default:
      return clean.replace(/_/g, ' ');
  }
}

/**
 * OWNER-ALERTS-SERVER (V1-65, P0 launch-track, Journeys E / F / G):
 *
 * Listens to `booking.created`, `invoice.paid` (online and storefront payments),
 * and `invoice.payment_claimed`. Sends web-push to the business owner's devices
 * via PushNotificationService, and when the owner has no live subscription or
 * push delivery fails, sends one platform-to-owner fallback email strictly to
 * the owner via SystemEmailService (D-82 covers business-to-customer mail; this
 * is platform-to-owner and never mails a customer).
 *
 * Durability & abuse control:
 * - Per-event dedupe (`booking.created`, `invoice.paid`) via Postgres
 *   `idempotency_keys` (`@@unique([businessId, idempotencyKey])`).
 * - Per-invoice 6-hour coalescing for `invoice.payment_claimed` via transaction-
 *   scoped Postgres advisory lock + `idempotency_keys.response`: at most one
 *   push or email per invoice per 6-hour window, with the suppressed count
 *   included in the next window's alert.
 */
@Injectable()
export class OwnerAlertsListener {
  private readonly logger = new Logger(OwnerAlertsListener.name);
  private clock: () => Date = () => new Date();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PushNotificationService) private readonly pushNotifications: PushNotificationService,
    @Inject(SystemEmailService) private readonly systemEmail: SystemEmailService,
  ) {}

  /** Deterministic clock hook for integration tests exercising the 6h coalescing window. */
  setClock(fn: () => Date): void {
    this.clock = fn;
  }

  @OnEvent('booking.created', { async: true })
  async onBookingCreated(payload: BookingCreatedPayload): Promise<void> {
    try {
      const businessId = sanitizeLine(payload?.businessId);
      const booking = payload?.booking as
        | (BookingCreatedPayload['booking'] & { service?: { name?: string | null } | null })
        | undefined;
      const bookingId = sanitizeLine(booking?.id);
      if (!businessId || !bookingId) return;
      if (booking?.businessId && booking.businessId !== businessId) return;

      const target = await this.resolveOwnerTarget(businessId, 'bookings');
      if (!target) return;

      const dedupeKey = `owner_alert:booking.created:${bookingId}`;
      const claimed = await this.claimOnce(businessId, dedupeKey, { event: 'booking.created', bookingId });
      if (!claimed) return;

      const customer = contactName(payload.contact) || 'A customer';
      const serviceName = sanitizeLine(booking?.service?.name) || 'Booking';
      const when =
        booking?.startTime != null && !Number.isNaN(new Date(booking.startTime).getTime())
          ? new Date(booking.startTime).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'UTC',
            }) + ' UTC'
          : '';

      const title = `New booking — ${serviceName}`;
      const body = when ? `${customer} booked ${serviceName} (${when}).` : `${customer} booked ${serviceName}.`;
      const path = '/app/bookings';

      await this.deliverToOwner(target, {
        dedupeKey,
        push: { title, body, url: path, tag: `booking-${bookingId}` },
        email: {
          subject: `[${target.businessName}] New booking: ${serviceName}`,
          headline: 'New Booking Received',
          summary: body,
          details: [
            { label: 'Customer', value: customer },
            { label: 'Service', value: serviceName },
            ...(when ? [{ label: 'Scheduled', value: when }] : []),
          ],
          ctaLabel: 'View Bookings',
          ctaUrl: `${appUrl()}${path}`,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(`Owner alert failed for booking.created: ${redactAddresses(err instanceof Error ? err.message : String(err))}`);
    }
  }

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: InvoicePaidPayload): Promise<void> {
    try {
      const businessId = sanitizeLine(payload?.businessId);
      const invoice = payload?.invoice;
      const invoiceId = sanitizeLine(invoice?.id);
      if (!businessId || !invoiceId) return;
      if (invoice?.businessId && invoice.businessId !== businessId) return;

      const target = await this.resolveOwnerTarget(businessId, 'payments');
      if (!target) return;

      const dedupeKey = `owner_alert:invoice.paid:${invoiceId}`;
      const claimed = await this.claimOnce(businessId, dedupeKey, { event: 'invoice.paid', invoiceId });
      if (!claimed) return;

      const invoiceNumber = sanitizeLine(invoice?.invoiceNumber) || invoiceId;
      const formattedTotal = formatAmount(invoice?.total, invoice?.currency);
      const customer = contactName(invoice?.contact);

      const title = formattedTotal ? `Payment received — ${formattedTotal}` : `Payment received`;
      const bodyParts = [`Invoice ${invoiceNumber} was paid`];
      if (formattedTotal) bodyParts[0] = `Invoice ${invoiceNumber} (${formattedTotal}) was paid`;
      if (customer) bodyParts.push(`by ${customer}`);
      const body = `${bodyParts.join(' ')}.`;
      const path = '/app/commerce';

      await this.deliverToOwner(target, {
        dedupeKey,
        push: { title, body, url: path, tag: `invoice-paid-${invoiceId}` },
        email: {
          subject: `[${target.businessName}] Payment received for ${invoiceNumber}`,
          headline: 'Payment Received',
          summary: body,
          details: [
            { label: 'Invoice #', value: invoiceNumber },
            ...(formattedTotal ? [{ label: 'Amount', value: formattedTotal }] : []),
            ...(customer ? [{ label: 'Customer', value: customer }] : []),
          ],
          ctaLabel: 'View Payments',
          ctaUrl: `${appUrl()}${path}`,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(`Owner alert failed for invoice.paid: ${redactAddresses(err instanceof Error ? err.message : String(err))}`);
    }
  }

  @OnEvent('invoice.payment_claimed', { async: true })
  async onInvoicePaymentClaimed(payload: InvoicePaymentClaimedPayload): Promise<void> {
    try {
      const businessId = sanitizeLine(payload?.businessId);
      const invoiceId = sanitizeLine(payload?.invoiceId ?? payload?.invoice?.id);
      if (!businessId || !invoiceId) return;
      if (payload?.invoice?.businessId && payload.invoice.businessId !== businessId) return;

      const target = await this.resolveOwnerTarget(businessId, 'claims');
      if (!target) return;

      const windowResult = await this.claimCoalescedPaymentClaim(businessId, invoiceId);
      if (!windowResult.shouldSend) return;

      let invoiceNumber = sanitizeLine(payload?.invoice?.invoiceNumber);
      let amountValue: unknown = payload?.amount ?? payload?.invoice?.total;
      let currencyValue: string | null | undefined = payload?.currency ?? payload?.invoice?.currency;
      let customer = sanitizeLine(payload?.customerName) || contactName(payload?.invoice?.contact);

      if (!invoiceNumber || amountValue == null) {
        const stored = await this.prisma.client.invoice.findFirst({
          where: { id: invoiceId, businessId },
          select: {
            invoiceNumber: true,
            total: true,
            currency: true,
            contact: { select: { firstName: true, lastName: true } },
          },
        });
        if (stored) {
          if (!invoiceNumber) invoiceNumber = sanitizeLine(stored.invoiceNumber);
          if (amountValue == null) amountValue = stored.total;
          if (!currencyValue) currencyValue = stored.currency;
          if (!customer) customer = contactName(stored.contact);
        }
      }
      if (!invoiceNumber) invoiceNumber = invoiceId;

      const formattedTotal = formatAmount(amountValue, currencyValue);
      const methodLabel = formatMethodLabel(payload?.method);
      const count = windowResult.claimCount;
      const isCoalesced = count > 1;

      const title = isCoalesced
        ? `${count} payment claims — ${invoiceNumber}`
        : `Payment claim — ${invoiceNumber}`;
      const summary = isCoalesced
        ? `${count} ${methodLabel.toLowerCase()} claims were submitted for Invoice ${invoiceNumber}${formattedTotal ? ` (${formattedTotal})` : ''}. Review and confirm in Keyflow.`
        : `${customer || 'A customer'} submitted a ${methodLabel.toLowerCase()} claim for Invoice ${invoiceNumber}${formattedTotal ? ` (${formattedTotal})` : ''}. Review and confirm in Keyflow.`;
      const path = '/app/commerce';

      await this.deliverToOwner(target, {
        dedupeKey: `owner_alert:invoice.payment_claimed:${invoiceId}:${windowResult.windowStartedAt}`,
        push: { title, body: summary, url: path, tag: `invoice-claim-${invoiceId}` },
        email: {
          subject: isCoalesced
            ? `[${target.businessName}] ${count} payment claims on ${invoiceNumber}`
            : `[${target.businessName}] Payment claim on ${invoiceNumber}`,
          headline: isCoalesced ? `${count} Payment Claims Pending Review` : 'Payment Claim Pending Review',
          summary,
          details: [
            { label: 'Invoice #', value: invoiceNumber },
            { label: 'Method', value: methodLabel },
            ...(formattedTotal ? [{ label: 'Amount', value: formattedTotal }] : []),
            ...(customer ? [{ label: 'Customer', value: customer }] : []),
            ...(isCoalesced ? [{ label: 'Claims in window', value: String(count) }] : []),
          ],
          ctaLabel: 'Review Claim',
          ctaUrl: `${appUrl()}${path}`,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Owner alert failed for invoice.payment_claimed: ${redactAddresses(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  /**
   * Resolves the business's OWNER users and owner-only fallback email address.
   * Honours D-104 / D-116 / D-125: only active `Membership` rows with
   * `role === 'OWNER'` are owners. `Business.ownerId` confers nothing by itself
   * (a removed or demoted former owner receives zero pushes and zero emails),
   * and `business.email` is only used as a secondary fallback when at least one
   * active OWNER membership exists without a user email. Never reads any
   * customer / contact address.
   */
  private async resolveOwnerTarget(
    businessId: string,
    category: OwnerAlertCategory,
  ): Promise<{
    businessId: string;
    businessName: string;
    primaryColor?: string;
    secondaryColor?: string;
    ownerUserIds: string[];
    ownerEmail: string | null;
    prefs: OwnerAlertPreferencesResult;
  } | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        email: true,
        notificationPreferences: true,
        primaryColor: true,
        secondaryColor: true,
      },
    });
    if (!business) return null;

    const prefs = resolveOwnerAlertPreferences(business.notificationPreferences, category);
    if (!prefs.enabled) return null;

    const ownerMemberships = await this.prisma.client.membership.findMany({
      where: { businessId, role: 'OWNER' },
      include: { user: { select: { id: true, email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (ownerMemberships.length === 0) return null;

    const ownerUserIds: string[] = [];
    let ownerEmail: string | null = null;
    for (const m of ownerMemberships) {
      ownerUserIds.push(m.userId);
      if (!ownerEmail && m.user?.email?.trim()) {
        ownerEmail = m.user.email.trim();
      }
    }

    if (!ownerEmail && business.email?.trim()) {
      ownerEmail = business.email.trim();
    }

    return {
      businessId: business.id,
      businessName: sanitizeLine(business.name) || 'Your Business',
      primaryColor: business.primaryColor ?? undefined,
      secondaryColor: business.secondaryColor ?? undefined,
      ownerUserIds,
      ownerEmail,
      prefs,
    };
  }

  /**
   * Atomic Postgres per-event dedupe using `idempotency_keys` unique constraint
   * `(businessId, idempotencyKey)`. Returns true only for the first caller.
   */
  private async claimOnce(
    businessId: string,
    idempotencyKey: string,
    meta: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.prisma.client.idempotencyKey.create({
        data: {
          businessId,
          idempotencyKey,
          status: 'completed',
          response: { ...meta, claimedAt: this.clock().toISOString() } as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Race-safe 6-hour per-invoice coalescing window for `invoice.payment_claimed`.
   * Serializes bursts on `(businessId, invoiceId)` with a transaction-scoped
   * advisory lock, allowing at most 1 push or email per invoice per 6-hour window
   * and carrying the suppressed count into the next window's alert.
   */
  private async claimCoalescedPaymentClaim(
    businessId: string,
    invoiceId: string,
  ): Promise<{ shouldSend: boolean; claimCount: number; windowStartedAt: string }> {
    const idempotencyKey = `owner_alert:invoice.payment_claimed:${invoiceId}`;
    const lockScope = `owner-alert:claim:${businessId}:${invoiceId}`;
    const now = this.clock();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockScope}))`;

      const existing = await tx.idempotencyKey.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey } },
      });

      if (!existing) {
        const nextRecord: ClaimCoalesceRecord = {
          windowStartedAt: nowIso,
          lastAlertCount: 1,
          pendingCoalesced: 0,
          lastClaimedAt: nowIso,
        };
        await tx.idempotencyKey.create({
          data: {
            businessId,
            idempotencyKey,
            status: 'completed',
            response: nextRecord as unknown as Prisma.InputJsonValue,
          },
        });
        return { shouldSend: true, claimCount: 1, windowStartedAt: nowIso };
      }

      const prev = parseClaimCoalesceRecord(existing.response);
      const prevStartMs = prev ? Date.parse(prev.windowStartedAt) : 0;

      if (prev && nowMs - prevStartMs < OWNER_ALERT_CLAIM_COALESCE_WINDOW_MS) {
        const updatedRecord: ClaimCoalesceRecord = {
          ...prev,
          pendingCoalesced: prev.pendingCoalesced + 1,
          lastClaimedAt: nowIso,
        };
        await tx.idempotencyKey.update({
          where: { id: existing.id },
          data: { response: updatedRecord as unknown as Prisma.InputJsonValue },
        });
        return { shouldSend: false, claimCount: 0, windowStartedAt: prev.windowStartedAt };
      }

      const claimCount = 1 + (prev?.pendingCoalesced ?? 0);
      const nextRecord: ClaimCoalesceRecord = {
        windowStartedAt: nowIso,
        lastAlertCount: claimCount,
        pendingCoalesced: 0,
        lastClaimedAt: nowIso,
      };
      await tx.idempotencyKey.update({
        where: { id: existing.id },
        data: { response: nextRecord as unknown as Prisma.InputJsonValue },
      });
      return { shouldSend: true, claimCount, windowStartedAt: nowIso };
    });
  }

  private async deliverToOwner(
    target: {
      businessId: string;
      businessName: string;
      primaryColor?: string;
      secondaryColor?: string;
      ownerUserIds: string[];
      ownerEmail: string | null;
      prefs: OwnerAlertPreferencesResult;
    },
    alert: {
      dedupeKey: string;
      push: { title: string; body: string; url?: string; tag?: string };
      email: {
        subject: string;
        headline: string;
        summary: string;
        details: Array<{ label: string; value: string }>;
        ctaLabel?: string;
        ctaUrl?: string;
      };
    },
  ): Promise<void> {
    let pushSent = 0;
    if (target.prefs.push && target.ownerUserIds.length > 0) {
      try {
        const result = await this.pushNotifications.sendToBusinessUsers(
          target.businessId,
          target.ownerUserIds,
          alert.push,
        );
        pushSent = result.sent;
      } catch (err: unknown) {
        this.logger.warn(
          `Owner push delivery errored for business ${target.businessId}; falling back to email: ${redactAddresses(err instanceof Error ? err.message : String(err))}`,
        );
      }
    }

    if (pushSent > 0) return;
    if (!target.prefs.email || !target.ownerEmail) return;
    if (!this.systemEmail.isConfigured()) {
      this.logger.warn(
        `Owner alert email fallback skipped for business ${target.businessId}: SystemEmailService is not configured`,
      );
      return;
    }

    const rendered = ownerAlertTemplate({
      businessName: target.businessName,
      primaryColor: target.primaryColor,
      secondaryColor: target.secondaryColor,
      ...alert.email,
    });

    await this.systemEmail.sendTransactional({
      to: target.ownerEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: alert.dedupeKey,
    });
  }
}

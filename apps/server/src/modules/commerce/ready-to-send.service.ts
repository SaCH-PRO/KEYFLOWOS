import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { invoiceBalanceOfStoredRows } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import { appUrl } from '../../core/config/runtime-urls';
import { normalizeToE164 } from '../crm/crm-data-quality.util';
import { resolveCrmAccess } from '../crm/crm-permissions.helper';

export const INVOICE_READY_TO_SEND_ACTIVITY_TYPE = 'invoice.ready_to_send_marked';

export interface ReadyToSendReader {
  id?: string;
  role?: string;
}

export interface ReadyToSendItem {
  kind: 'invoice' | 'booking';
  id: string;
  contactId: string | null;
  customerName: string;
  customerEmail: string | null;
  e164Phone: string | null;
  link: string | null;
  messageText: string;
  whatsappUrl: string | null;
  willAutoEmail: boolean;
  dueAt: string;
  reference: string;
  amountDue?: number;
  currency?: string;
  serviceName?: string;
}

export interface ReadyToSendResponse {
  asOf: string;
  gmailConnected: boolean;
  counts: {
    invoices: number;
    bookings: number;
    total: number;
  };
  items: ReadyToSendItem[];
}

export interface MarkReadyToSendResult {
  kind: 'invoice' | 'booking';
  id: string;
  markedSentAt: string;
}

const INVOICE_REMINDABLE_STATUSES: ReadonlySet<string> = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID']);
const BOOKING_REMINDABLE_STATUSES: ReadonlySet<string> = new Set(['CONFIRMED', 'PENDING']);
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;
const DEFAULT_BUSINESS_TIMEZONE = 'America/Port_of_Spain';

/** Matches CommerceService.PENDING_SEND_EXPIRY (R0-CMF4 SEC-CMF4-3): link whose send is still in flight. */
const PENDING_SEND_EXPIRY_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
/** Matches CommerceService.LEGACY_LINK_TOKEN (V1-48 ST-V48-1): guessable pre-V1-48 cuid token. */
const LEGACY_LINK_TOKEN = /^c[a-z0-9]{24}$/;

interface NestedContactRow {
  id: string;
  businessId: string;
  deletedAt: Date | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  visibility: string | null;
  ownerId: string | null;
}

function resolveValidTimeZone(raw: string | null | undefined): { timeZone: string; fellBackToUtc: boolean } {
  const candidate = raw?.trim() || DEFAULT_BUSINESS_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return { timeZone: candidate, fellBackToUtc: false };
  } catch {
    return { timeZone: 'UTC', fellBackToUtc: true };
  }
}

function zonedDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Computes midnight (00:00:00) of `now`'s calendar day in `timeZone` as a UTC Date.
 * Uses two offset-refinement iterations to stay accurate across DST transitions.
 */
function startOfTodayInTimeZone(now: Date, timeZone: string): Date {
  const p = zonedDateParts(now, timeZone);
  const targetLocalMs = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0);
  let guess = targetLocalMs;
  for (let i = 0; i < 2; i++) {
    const gp = zonedDateParts(new Date(guess), timeZone);
    const guessLocalMs = Date.UTC(gp.year, gp.month - 1, gp.day, gp.hour, gp.minute, gp.second, 0);
    const diff = targetLocalMs - guessLocalMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function formatBookingTime(startTime: Date, timeZone: string, fellBackToUtc: boolean): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(startTime);
  return fellBackToUtc ? `${formatted} UTC` : formatted;
}

function formatCustomerName(
  contact: { firstName?: string | null; lastName?: string | null; email?: string | null } | null,
): string {
  if (!contact) return 'there';
  const full = [contact.firstName, contact.lastName]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .trim();
  return full || contact.email || 'there';
}

function buildWhatsAppUrl(e164Phone: string | null, messageText: string): string | null {
  if (!e164Phone) return null;
  const digits = e164Phone.replace(/^\+/, '');
  if (!digits || !/^\d+$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`;
}

function resolveContactE164(
  contact: { whatsappNumber?: string | null; phone?: string | null } | null,
  country: string | null | undefined,
): string | null {
  if (!contact) return null;
  for (const candidate of [contact.whatsappNumber, contact.phone]) {
    if (!candidate) continue;
    const parsed = normalizeToE164(candidate, country);
    if (parsed.ok && parsed.e164) return parsed.e164;
  }
  return null;
}

function bookingReminderPrefEnabled(notificationPreferences: unknown): boolean {
  if (!notificationPreferences || typeof notificationPreferences !== 'object' || Array.isArray(notificationPreferences)) {
    return true;
  }
  return (notificationPreferences as Record<string, unknown>).booking_reminder !== false;
}

/**
 * True if a scheduled booking reminder pass (`BookingsService.processBookingReminders`
 * at `[now + (reminderMins-5)m, now + (reminderMins+5)m]` or `FlowListener.handleBookingReminders`
 * at `[now + 23h, now + 25h]`) can still pick up `startTime` in the future.
 */
function bookingCanStillAutoEmail(startTime: Date, now: Date, reminderMins: number): boolean {
  const leadMs = startTime.getTime() - now.getTime();
  const minWindowLeadMs = Math.max(0, reminderMins - 5) * 60_000;
  return leadMs >= minWindowLeadMs || leadMs >= TWENTY_THREE_HOURS_MS;
}

@Injectable()
export class ReadyToSendService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async resolveReaderScopes(
    businessId: string,
    reader: ReadyToSendReader | null,
  ): Promise<{ canReadRevenue: boolean; canReadBookings: boolean }> {
    if (reader?.role === 'SUPER_ADMIN') {
      return { canReadRevenue: true, canReadBookings: true };
    }
    if (!reader?.id) {
      return { canReadRevenue: false, canReadBookings: false };
    }
    if (reader.role === undefined) {
      const user = await this.prisma.client.user
        .findUnique({ where: { id: reader.id }, select: { role: true } })
        .catch(() => null);
      if (user?.role === 'SUPER_ADMIN') {
        return { canReadRevenue: true, canReadBookings: true };
      }
    }
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: reader.id, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) {
      return { canReadRevenue: false, canReadBookings: false };
    }
    return {
      canReadRevenue: rankOf(memberModuleLevel(membership, 'revenue')) >= LEVEL_RANK.read,
      canReadBookings: rankOf(memberModuleLevel(membership, 'bookings')) >= LEVEL_RANK.read,
    };
  }

  /**
   * Filters nested `contact` rows against tenant ownership (`ST-R004-1`),
   * soft-deletion, and `PRIVATE` CRM visibility (`R28-ST-01` / `SEC-CMF1-2`).
   * A soft-deleted, cross-tenant, or unviewable `PRIVATE` contact resolves to `null`.
   */
  private async buildVisibleContactFilter(
    businessId: string,
    reader: ReadyToSendReader | null,
    rawContacts: Array<NestedContactRow | null | undefined>,
  ): Promise<(contact: NestedContactRow | null | undefined) => NestedContactRow | null> {
    const validContacts = rawContacts.filter(
      (c): c is NestedContactRow => Boolean(c && c.businessId === businessId && c.deletedAt === null),
    );
    const privateContacts = validContacts.filter((c) => c.visibility === 'PRIVATE');

    let canViewAllPrivate = reader?.role === 'SUPER_ADMIN';
    let readerUserId = reader?.id ?? null;
    const sharedContactIds = new Set<string>();

    if (!canViewAllPrivate && privateContacts.length > 0 && readerUserId) {
      const crmAccess = await resolveCrmAccess(this.prisma, businessId, readerUserId).catch(() => null);
      if (crmAccess && (crmAccess.isSuperAdmin || crmAccess.isOwner)) {
        canViewAllPrivate = true;
      } else {
        const unownedPrivateIds = privateContacts
          .filter((c) => c.ownerId !== readerUserId)
          .map((c) => c.id);
        if (unownedPrivateIds.length > 0) {
          const shares = await this.prisma.client.contactShare.findMany({
            where: { userId: readerUserId, contactId: { in: unownedPrivateIds } },
            select: { contactId: true },
          });
          for (const s of shares) sharedContactIds.add(s.contactId);
        }
      }
    } else if (!canViewAllPrivate && privateContacts.length > 0) {
      readerUserId = null;
    }

    return (contact: NestedContactRow | null | undefined): NestedContactRow | null => {
      if (!contact || contact.businessId !== businessId || contact.deletedAt !== null) return null;
      if (contact.visibility === 'PRIVATE' && !canViewAllPrivate) {
        if (!readerUserId) return null;
        if (contact.ownerId !== readerUserId && !sharedContactIds.has(contact.id)) return null;
      }
      return contact;
    };
  }

  /**
   * READY-TO-SEND (P0 wedge-first; D-82, D-263):
   * Strictly read-only: returns today's due reminders (OVERDUE invoices not yet
   * marked sent today in the business's timezone, and CONFIRMED/PENDING bookings
   * starting within the next 24h not yet reminded), filtered by the reader's
   * module scopes (`revenue:read` for invoices, `bookings:read` for bookings).
   * Never mints or mutates `PaymentLink` rows and never sends outbound traffic.
   */
  async listDue(
    businessId: string,
    reader: ReadyToSendReader | null,
    options?: { now?: Date },
  ): Promise<ReadyToSendResponse> {
    const now = options?.now ?? new Date();
    const { canReadRevenue, canReadBookings } = await this.resolveReaderScopes(businessId, reader);

    // A member with neither revenue:read nor bookings:read receives an empty queue
    // without touching business settings or exposing gmailConnected.
    if (!canReadRevenue && !canReadBookings) {
      return {
        asOf: now.toISOString(),
        gmailConnected: false,
        counts: { invoices: 0, bookings: 0, total: 0 },
        items: [],
      };
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        slug: true,
        country: true,
        currency: true,
        timezone: true,
        gmailEmail: true,
        gmailRefreshToken: true,
        bookingReminderMins: true,
        notificationPreferences: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');

    const { timeZone, fellBackToUtc } = resolveValidTimeZone(business.timezone);
    const gmailConnected = Boolean(business.gmailEmail?.trim() && business.gmailRefreshToken?.trim());
    const businessName = business.name?.trim() || '';
    const items: ReadyToSendItem[] = [];
    let invoiceCount = 0;
    let bookingCount = 0;

    const contactSelect = {
      id: true,
      businessId: true,
      deletedAt: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      whatsappNumber: true,
      visibility: true,
      ownerId: true,
    } as const;

    const overdueInvoices = canReadRevenue
      ? await this.prisma.client.invoice.findMany({
          where: {
            businessId,
            deletedAt: null,
            status: 'OVERDUE',
          },
          include: {
            contact: { select: contactSelect },
            payments: { where: { businessId }, select: { amount: true, status: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        })
      : [];

    const windowEnd = new Date(now.getTime() + TWENTY_FOUR_HOURS_MS);
    const upcomingBookings = canReadBookings
      ? await this.prisma.client.booking.findMany({
          where: {
            businessId,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'PENDING'] },
            reminderSentAt: null,
            startTime: { gt: now, lte: windowEnd },
          },
          include: {
            contact: { select: contactSelect },
            service: { select: { id: true, name: true, duration: true } },
          },
          orderBy: { startTime: 'asc' },
        })
      : [];

    const visibleContact = await this.buildVisibleContactFilter(businessId, reader, [
      ...overdueInvoices.map((inv) => inv.contact),
      ...upcomingBookings.map((b) => b.contact),
    ]);

    if (canReadRevenue && overdueInvoices.length > 0) {
      const startOfToday = startOfTodayInTimeZone(now, timeZone);
      const overdueIds = overdueInvoices.map((inv) => inv.id);

      const [markedActivities, liveLinks] = await Promise.all([
        this.prisma.client.activity.findMany({
          where: {
            businessId,
            entityType: 'invoice',
            entityId: { in: overdueIds },
            type: INVOICE_READY_TO_SEND_ACTIVITY_TYPE,
            occurredAt: { gte: startOfToday, lte: now },
          },
          select: { entityId: true },
        }),
        // Strictly read-only: read existing active PaymentLink rows without minting
        // or mutating PENDING_SEND_EXPIRY / legacy cuid tokens on GET.
        this.prisma.client.paymentLink.findMany({
          where: {
            businessId,
            invoiceId: { in: overdueIds },
            active: true,
          },
          select: { invoiceId: true, token: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const markedToday = new Set(markedActivities.map((a) => a.entityId).filter((id): id is string => Boolean(id)));
      const liveTokenByInvoice = new Map<string, string>();
      for (const link of liveLinks) {
        if (!link.invoiceId || liveTokenByInvoice.has(link.invoiceId)) continue;
        if (link.expiresAt && link.expiresAt.getTime() === PENDING_SEND_EXPIRY_MS) continue;
        if (link.expiresAt && link.expiresAt <= now) continue;
        if (LEGACY_LINK_TOKEN.test(link.token)) continue;
        liveTokenByInvoice.set(link.invoiceId, link.token);
      }

      const base = appUrl();
      for (const inv of overdueInvoices) {
        if (markedToday.has(inv.id)) continue;
        const { remaining } = invoiceBalanceOfStoredRows(
          Number(inv.total),
          inv.payments ?? [],
          inv.currency ?? business.currency ?? undefined,
        );
        const amountDue = Math.max(0, remaining);
        if (amountDue <= 0) continue;

        const contact = visibleContact(inv.contact);
        const currency = inv.currency || business.currency || 'TTD';
        const customerName = formatCustomerName(contact);
        const e164Phone = resolveContactE164(contact, business.country);
        const token = liveTokenByInvoice.get(inv.id);
        const link = token ? `${base}/public/invoice/${encodeURIComponent(token)}` : null;
        const formattedAmount = amountDue.toFixed(2);
        const linkSentence = link ? ` You can view and pay it here: ${link}` : '';
        const signOff = businessName ? ` — ${businessName}` : '';
        const messageText =
          `Hi ${customerName}, friendly reminder that invoice ${inv.invoiceNumber} (${currency} ${formattedAmount}) is overdue.${linkSentence} Thank you${signOff}.`;

        items.push({
          kind: 'invoice',
          id: inv.id,
          contactId: contact ? contact.id : null,
          customerName,
          customerEmail: contact?.email ?? null,
          e164Phone,
          link,
          messageText,
          whatsappUrl: buildWhatsAppUrl(e164Phone, messageText),
          // Already-OVERDUE invoices have no recurring scheduled auto-emailer
          // (FlowListener.handleInvoiceOverdue fires once at SENT -> OVERDUE transition).
          willAutoEmail: false,
          dueAt: (inv.dueDate ?? inv.createdAt).toISOString(),
          reference: inv.invoiceNumber,
          amountDue,
          currency,
        });
        invoiceCount++;
      }
    }

    if (canReadBookings && upcomingBookings.length > 0) {
      const slug = business.slug?.trim() || '';
      const bookingLink = slug ? `${appUrl()}/book/${encodeURIComponent(slug)}` : null;
      const reminderMins = business.bookingReminderMins ?? 0;
      const autoEmailEnabled =
        gmailConnected &&
        reminderMins > 0 &&
        bookingReminderPrefEnabled(business.notificationPreferences);

      for (const booking of upcomingBookings) {
        const contact = visibleContact(booking.contact);
        const customerName = formatCustomerName(contact);
        const serviceName = booking.service?.name || 'your appointment';
        const e164Phone = resolveContactE164(contact, business.country);
        const whenText = formatBookingTime(booking.startTime, timeZone, fellBackToUtc);
        const linkSentence = bookingLink ? ` Booking details: ${bookingLink}` : '';
        const signOff = businessName ? ` — ${businessName}` : '';
        const messageText =
          `Hi ${customerName}, reminder for ${serviceName} on ${whenText}.${linkSentence} See you soon${signOff}!`;

        items.push({
          kind: 'booking',
          id: booking.id,
          contactId: contact ? contact.id : null,
          customerName,
          customerEmail: contact?.email ?? null,
          e164Phone,
          link: bookingLink,
          messageText,
          whatsappUrl: buildWhatsAppUrl(e164Phone, messageText),
          willAutoEmail:
            autoEmailEnabled &&
            Boolean(contact?.email) &&
            bookingCanStillAutoEmail(booking.startTime, now, reminderMins),
          dueAt: booking.startTime.toISOString(),
          reference: serviceName,
          serviceName,
        });
        bookingCount++;
      }
    }

    return {
      asOf: now.toISOString(),
      gmailConnected,
      counts: {
        invoices: invoiceCount,
        bookings: bookingCount,
        total: invoiceCount + bookingCount,
      },
      items,
    };
  }

  /**
   * Marks an overdue/remindable invoice reminder sent by recording an Activity
   * row (no schema migration). Idempotent within the business's local calendar
   * day. Never makes an outbound provider call.
   */
  async markInvoiceSent(
    businessId: string,
    invoiceId: string,
    actorId: string | null,
    options?: { now?: Date },
  ): Promise<MarkReadyToSendResult> {
    const now = options?.now ?? new Date();
    const [invoice, business] = await Promise.all([
      this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, businessId, deletedAt: null },
        select: { id: true, invoiceNumber: true, status: true, contactId: true },
      }),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { timezone: true },
      }),
    ]);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!INVOICE_REMINDABLE_STATUSES.has(invoice.status)) {
      throw new ConflictException(
        `A reminder can only be marked sent for a SENT, OVERDUE or PARTIALLY_PAID invoice; this invoice is ${invoice.status}`,
      );
    }

    const { timeZone } = resolveValidTimeZone(business?.timezone);
    const startOfToday = startOfTodayInTimeZone(now, timeZone);
    const existingMark = await this.prisma.client.activity.findFirst({
      where: {
        businessId,
        entityType: 'invoice',
        entityId: invoice.id,
        type: INVOICE_READY_TO_SEND_ACTIVITY_TYPE,
        occurredAt: { gte: startOfToday, lte: now },
      },
      select: { occurredAt: true },
      orderBy: { occurredAt: 'desc' },
    });
    if (existingMark) {
      return { kind: 'invoice', id: invoice.id, markedSentAt: existingMark.occurredAt.toISOString() };
    }

    await this.prisma.client.activity.create({
      data: {
        businessId,
        module: 'commerce',
        action: 'reminder_sent',
        type: INVOICE_READY_TO_SEND_ACTIVITY_TYPE,
        entityType: 'invoice',
        entityId: invoice.id,
        contactId: invoice.contactId ?? null,
        category: 'COMMERCE',
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? null,
        title: `Reminder marked sent for invoice ${invoice.invoiceNumber}`,
        detail: 'Marked sent from Ready to Send queue',
        occurredAt: now,
        data: { channel: 'whatsapp', invoiceNumber: invoice.invoiceNumber },
      },
    });

    return { kind: 'invoice', id: invoice.id, markedSentAt: now.toISOString() };
  }

  /**
   * Marks an upcoming booking reminder sent by stamping Booking.reminderSentAt.
   * Idempotent when already marked sent. Never makes an outbound provider call.
   */
  async markBookingSent(
    businessId: string,
    bookingId: string,
    actorId: string | null,
    options?: { now?: Date },
  ): Promise<MarkReadyToSendResult> {
    const now = options?.now ?? new Date();
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
      select: { id: true, status: true, contactId: true, reminderSentAt: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (!BOOKING_REMINDABLE_STATUSES.has(booking.status)) {
      throw new ConflictException(
        `A reminder can only be marked sent for a CONFIRMED or PENDING booking; this booking is ${booking.status}`,
      );
    }
    if (booking.reminderSentAt) {
      return { kind: 'booking', id: booking.id, markedSentAt: booking.reminderSentAt.toISOString() };
    }

    const updated = await this.prisma.client.booking.updateMany({
      where: { id: booking.id, businessId, deletedAt: null, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (updated.count === 0) {
      const current = await this.prisma.client.booking.findFirst({
        where: { id: booking.id, businessId, deletedAt: null },
        select: { reminderSentAt: true },
      });
      if (!current) throw new NotFoundException('Booking not found');
      return { kind: 'booking', id: booking.id, markedSentAt: (current.reminderSentAt ?? now).toISOString() };
    }

    await this.prisma.client.activity
      .create({
        data: {
          businessId,
          module: 'bookings',
          action: 'reminder_sent',
          type: 'booking.ready_to_send_marked',
          entityType: 'booking',
          entityId: booking.id,
          contactId: booking.contactId ?? null,
          category: 'BOOKING',
          actorType: actorId ? 'USER' : 'SYSTEM',
          actorId: actorId ?? null,
          title: 'Booking reminder marked sent',
          detail: 'Marked sent from Ready to Send queue',
          occurredAt: now,
          data: { channel: 'whatsapp' },
        },
      })
      .catch(() => undefined);

    return { kind: 'booking', id: booking.id, markedSentAt: now.toISOString() };
  }
}

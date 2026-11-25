import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { invoiceBalanceOfStoredRows } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import { appUrl } from '../../core/config/runtime-urls';
import { normalizeToE164 } from '../crm/crm-data-quality.util';
import { CommerceService } from './commerce.service';

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

function formatCustomerName(contact: { firstName?: string | null; lastName?: string | null; email?: string | null } | null): string {
  if (!contact) return 'there';
  const full = [contact.firstName, contact.lastName].filter((s): s is string => typeof s === 'string' && s.trim().length > 0).join(' ').trim();
  return full || contact.email || 'there';
}

function buildWhatsAppUrl(e164Phone: string | null, messageText: string): string | null {
  if (!e164Phone) return null;
  const digits = e164Phone.replace(/^\+/, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`;
}

function formatBookingTime(startTime: Date): string {
  return startTime.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
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

@Injectable()
export class ReadyToSendService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

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
   * READY-TO-SEND (P0 wedge-first; D-82, D-263):
   * Returns today's due reminders (OVERDUE invoices not yet marked sent today,
   * and CONFIRMED/PENDING bookings starting within the next 24h not yet
   * reminded), filtered by the reader's module scopes (`revenue:read` for
   * invoices, `bookings:read` for bookings). Never sends outbound email or
   * WhatsApp traffic.
   */
  async listDue(
    businessId: string,
    reader: ReadyToSendReader | null,
    options?: { now?: Date },
  ): Promise<ReadyToSendResponse> {
    const now = options?.now ?? new Date();
    const { canReadRevenue, canReadBookings } = await this.resolveReaderScopes(businessId, reader);

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        slug: true,
        country: true,
        currency: true,
        gmailEmail: true,
        gmailRefreshToken: true,
        bookingReminderMins: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');

    const gmailConnected = Boolean(business.gmailEmail?.trim() && business.gmailRefreshToken?.trim());
    const businessName = business.name?.trim() || '';
    const items: ReadyToSendItem[] = [];
    let invoiceCount = 0;
    let bookingCount = 0;

    if (canReadRevenue) {
      const overdueInvoices = await this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'OVERDUE',
        },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true, whatsappNumber: true },
          },
          payments: { where: { businessId }, select: { amount: true, status: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });

      const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const overdueIds = overdueInvoices.map((inv) => inv.id);
      const markedActivities =
        overdueIds.length > 0
          ? await this.prisma.client.activity.findMany({
              where: {
                businessId,
                entityType: 'invoice',
                entityId: { in: overdueIds },
                type: INVOICE_READY_TO_SEND_ACTIVITY_TYPE,
                occurredAt: { gte: startOfTodayUtc },
              },
              select: { entityId: true },
            })
          : [];
      const markedToday = new Set(markedActivities.map((a) => a.entityId).filter((id): id is string => Boolean(id)));

      for (const inv of overdueInvoices) {
        if (markedToday.has(inv.id)) continue;
        const { remaining } = invoiceBalanceOfStoredRows(
          Number(inv.total),
          inv.payments ?? [],
          inv.currency ?? business.currency ?? undefined,
        );
        const amountDue = Math.max(0, remaining);
        if (amountDue <= 0) continue;

        const currency = inv.currency || business.currency || 'TTD';
        const customerName = formatCustomerName(inv.contact);
        const e164Phone = resolveContactE164(inv.contact, business.country);
        const link = await this.commerce.automatedInvoiceUrl(inv.id, businessId);
        const formattedAmount = amountDue.toFixed(2);
        const linkSentence = link ? ` You can view and pay it here: ${link}` : '';
        const signOff = businessName ? ` — ${businessName}` : '';
        const messageText =
          `Hi ${customerName}, friendly reminder that invoice ${inv.invoiceNumber} (${currency} ${formattedAmount}) is overdue.${linkSentence} Thank you${signOff}.`;

        items.push({
          kind: 'invoice',
          id: inv.id,
          contactId: inv.contactId ?? null,
          customerName,
          customerEmail: inv.contact?.email ?? null,
          e164Phone,
          link,
          messageText,
          whatsappUrl: buildWhatsAppUrl(e164Phone, messageText),
          // Overdue invoices have no scheduled auto-emailer (InvoiceOverdueScheduler only
          // flips SENT -> OVERDUE); keep willAutoEmail truthful so the owner knows to send.
          willAutoEmail: false,
          dueAt: (inv.dueDate ?? inv.createdAt).toISOString(),
          reference: inv.invoiceNumber,
          amountDue,
          currency,
        });
        invoiceCount++;
      }
    }

    if (canReadBookings) {
      const windowEnd = new Date(now.getTime() + TWENTY_FOUR_HOURS_MS);
      const upcomingBookings = await this.prisma.client.booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['CONFIRMED', 'PENDING'] },
          reminderSentAt: null,
          startTime: { gt: now, lte: windowEnd },
        },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true, whatsappNumber: true },
          },
          service: { select: { id: true, name: true, duration: true } },
        },
        orderBy: { startTime: 'asc' },
      });

      const bookingLink = business.slug ? `${appUrl()}/book/${encodeURIComponent(business.slug)}` : null;
      const autoEmailEnabled = gmailConnected && (business.bookingReminderMins ?? 0) > 0;

      for (const booking of upcomingBookings) {
        const customerName = formatCustomerName(booking.contact);
        const serviceName = booking.service?.name || 'your appointment';
        const e164Phone = resolveContactE164(booking.contact, business.country);
        const whenText = formatBookingTime(booking.startTime);
        const linkSentence = bookingLink ? ` Booking details: ${bookingLink}` : '';
        const signOff = businessName ? ` — ${businessName}` : '';
        const messageText =
          `Hi ${customerName}, reminder for ${serviceName} on ${whenText}.${linkSentence} See you soon${signOff}!`;

        items.push({
          kind: 'booking',
          id: booking.id,
          contactId: booking.contactId ?? null,
          customerName,
          customerEmail: booking.contact?.email ?? null,
          e164Phone,
          link: bookingLink,
          messageText,
          whatsappUrl: buildWhatsAppUrl(e164Phone, messageText),
          willAutoEmail: autoEmailEnabled && Boolean(booking.contact?.email),
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
   * row (no schema migration). Never makes an outbound provider call.
   */
  async markInvoiceSent(
    businessId: string,
    invoiceId: string,
    actorId: string | null,
    options?: { now?: Date },
  ): Promise<MarkReadyToSendResult> {
    const now = options?.now ?? new Date();
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      select: { id: true, invoiceNumber: true, status: true, contactId: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!INVOICE_REMINDABLE_STATUSES.has(invoice.status)) {
      throw new ConflictException(
        `A reminder can only be marked sent for a SENT, OVERDUE or PARTIALLY_PAID invoice; this invoice is ${invoice.status}`,
      );
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
   * Never makes an outbound provider call.
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
      select: { id: true, status: true, contactId: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (!BOOKING_REMINDABLE_STATUSES.has(booking.status)) {
      throw new ConflictException(
        `A reminder can only be marked sent for a CONFIRMED or PENDING booking; this booking is ${booking.status}`,
      );
    }

    const updated = await this.prisma.client.booking.updateMany({
      where: { id: booking.id, businessId, deletedAt: null },
      data: { reminderSentAt: now },
    });
    if (updated.count === 0) throw new NotFoundException('Booking not found');

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

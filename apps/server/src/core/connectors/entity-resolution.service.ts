import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { contactPhoneRead, livePhoneKeyHolderIds } from '../../modules/crm/crm-duplicate.util';

export interface ExternalEntity {
  source: string;
  externalId?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolvedEntity {
  contactId: string;
  isNew: boolean;
  merged: boolean;
  matchedOn: string;
}

export interface ResolvedPayment {
  paymentId: string | null;
  contactId: string | null;
  found: boolean;
  matchedOn: string;
}

export interface ResolvedBooking {
  bookingId: string | null;
  contactId: string | null;
  found: boolean;
  matchedOn: string;
}

export interface ResolvedInvoice {
  invoiceId: string | null;
  contactId: string | null;
  found: boolean;
  matchedOn: string;
}

export type MergeFieldPrecedence = 'keep_existing' | 'prefer_newest' | 'prefer_source';

export interface MergeRuleConfig {
  fieldPrecedence: MergeFieldPrecedence;
  matchOrder: Array<'external_id' | 'email' | 'phone'>;
  autoCreateContacts: boolean;
  trustedSources: string[];
}

const DEFAULT_MERGE_RULES: MergeRuleConfig = {
  fieldPrecedence: 'keep_existing',
  matchOrder: ['external_id', 'email', 'phone'],
  autoCreateContacts: true,
  trustedSources: [],
};

/**
 * Sources whose phone is always an international number, delivered without its '+'
 * (FU-PHONE-COUNTRY-DUPLICATES): a WhatsApp sender is its wa_id, the country code and number
 * ('447911123456', Meta), never a local number of the business's country. Twilio's WhatsApp
 * address ('whatsapp:+18685550101') carries its '+' and is read the same way from any source.
 */
const INTERNATIONAL_PHONE_SOURCES: ReadonlySet<string> = new Set(['whatsapp']);

/** A phone as a contact write stores it (contactPhoneRead), with the country it was read under. */
type ReadPhone = ReturnType<typeof contactPhoneRead> & { country: string | null };

/** A unique violation (P2002): another writer took the email or phone key meanwhile. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002';
}

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);
  private mergeRules: MergeRuleConfig = { ...DEFAULT_MERGE_RULES };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  configureMergeRules(rules: Partial<MergeRuleConfig>): void {
    this.mergeRules = { ...this.mergeRules, ...rules };
    this.logger.log(`Merge rules updated: fieldPrecedence=${this.mergeRules.fieldPrecedence}, matchOrder=${this.mergeRules.matchOrder.join(',')}`);
  }

  getMergeRules(): MergeRuleConfig {
    return { ...this.mergeRules };
  }

  /**
   * The phone as a contact write stores it (FU-PHONE-COUNTRY-DUPLICATES, owner ruling D-211): read
   * under the business's country (Business.country; unset is Trinidad and Tobago) by the reading
   * POST .../contacts uses (contactPhoneRead), so a variant spelling of a live contact's number is
   * that contact here too. A WhatsApp sender (INTERNATIONAL_PHONE_SOURCES, or Twilio's
   * 'whatsapp:' address) is an international number written without its '+'. Null with no phone.
   */
  private async readPhone(businessId: string, source: string | null | undefined, phone: string | null | undefined): Promise<ReadPhone | null> {
    let typed = phone?.trim();
    if (!typed) return null;
    let international = !!source && INTERNATIONAL_PHONE_SOURCES.has(source);
    if (/^whatsapp:/i.test(typed)) {
      typed = typed.replace(/^whatsapp:/i, '').trim();
      international = true;
    }
    if (international && /^\d/.test(typed)) typed = `+${typed}`;
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { country: true } });
    const country = business?.country ?? null;
    return { ...contactPhoneRead(typed, country), country };
  }

  /**
   * The live contact holding the phone (the oldest): its E.164 key, or a key stored before E.164
   * that reads as it under the business's country (livePhoneKeyHolderIds); a number that does not
   * read, by exactly its key. A contact this resolver created before D-211 kept no key: it is
   * found by the E.164 number it stored in `phone`.
   */
  private async phoneHolderId(businessId: string, phone: ReadPhone): Promise<string | null> {
    const [holderId] = await livePhoneKeyHolderIds(this.prisma.client, businessId, phone, phone.country);
    if (holderId) return holderId;
    if (!phone.e164) return null;
    const keyless = await this.prisma.client.contact.findFirst({
      where: { businessId, deletedAt: null, phoneNormalized: null, phone: phone.e164 },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return keyless?.id ?? null;
  }

  /** The live contact holding the email (its key, or the address as stored before keys were written). */
  private async emailHolderId(businessId: string, email: string): Promise<string | null> {
    const byEmail = await this.prisma.client.contact.findFirst({
      where: { businessId, deletedAt: null, OR: [{ emailNormalized: email }, { email }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return byEmail?.id ?? null;
  }

  async findContactIdByMatch(
    businessId: string,
    input: { externalId?: string | null; source?: string | null; email?: string | null; phone?: string | null },
  ): Promise<{ contactId: string; matchedOn: 'external_id' | 'email' | 'phone' } | null> {
    const normalizedEmail = input.email ? input.email.trim().toLowerCase() : null;
    let phone: ReadPhone | null | undefined;
    for (const matchType of this.mergeRules.matchOrder) {
      if (matchType === 'external_id' && input.externalId && input.source) {
        const byExternalId = await this.findByExternalId(businessId, input.source, input.externalId);
        if (byExternalId) return { contactId: byExternalId.id, matchedOn: 'external_id' };
      }
      if (matchType === 'email' && normalizedEmail) {
        const byEmail = await this.emailHolderId(businessId, normalizedEmail);
        if (byEmail) return { contactId: byEmail, matchedOn: 'email' };
      }
      if (matchType === 'phone' && input.phone) {
        // D-211: the number read in the business's country, matched against its live holders.
        phone ??= await this.readPhone(businessId, input.source, input.phone);
        const holderId = phone ? await this.phoneHolderId(businessId, phone) : null;
        if (holderId) return { contactId: holderId, matchedOn: 'phone' };
      }
    }
    return null;
  }

  async resolveContact(businessId: string, entity: ExternalEntity): Promise<ResolvedEntity> {
    const normalizedEmail = entity.email?.toLowerCase().trim() || null;
    // FU-PHONE-COUNTRY-DUPLICATES (D-211): the phone as the CRM write stores it, and its key.
    const phone = await this.readPhone(businessId, entity.source, entity.phone);

    const matched = await this.matchExisting(businessId, entity, normalizedEmail, phone);
    if (matched) return matched;

    if (!this.mergeRules.autoCreateContacts) {
      return { contactId: '', isNew: false, merged: false, matchedOn: 'none' };
    }

    let newContact;
    try {
      // The identity keys a contact write stores (emailNormalized, phoneNormalized), so the
      // identity uniques and every later write see this contact (D-211; it kept neither before).
      newContact = await this.prisma.client.contact.create({
        data: {
          businessId,
          email: normalizedEmail,
          emailNormalized: normalizedEmail,
          phone: phone?.phone ?? null,
          phoneNormalized: phone?.phoneNormalized ?? null,
          firstName: entity.firstName || null,
          lastName: entity.lastName || null,
          companyName: entity.companyName || null,
          source: entity.source,
          status: 'LEAD',
        },
      });
    } catch (err: unknown) {
      // Another writer created the holder of this email or number since the match: it is this contact.
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.matchExisting(businessId, entity, normalizedEmail, phone);
      if (raced) return raced;
      throw err;
    }

    if (entity.externalId) {
      await this.storeExternalMapping(businessId, newContact.id, entity.source, entity.externalId);
    }

    this.events.emit('contact.created', {
      contact: newContact,
      businessId,
    });

    this.logger.log(`Created new contact ${newContact.id} from ${entity.source} for business ${businessId}`);

    return { contactId: newContact.id, isNew: true, merged: false, matchedOn: 'none' };
  }

  /**
   * The existing contact `entity` is, in the merge rules' order (external id, email, phone),
   * enriched and linked to the source's external id as before; null when none is.
   */
  private async matchExisting(
    businessId: string,
    entity: ExternalEntity,
    normalizedEmail: string | null,
    phone: ReadPhone | null,
  ): Promise<ResolvedEntity | null> {
    for (const matchType of this.mergeRules.matchOrder) {
      if (matchType === 'external_id' && entity.externalId) {
        const byExternalId = await this.findByExternalId(businessId, entity.source, entity.externalId);
        if (byExternalId) {
          await this.enrichContact(byExternalId.id, entity);
          return { contactId: byExternalId.id, isNew: false, merged: false, matchedOn: 'external_id' };
        }
      }

      if (matchType === 'email' && normalizedEmail) {
        const byEmail = await this.emailHolderId(businessId, normalizedEmail);
        if (byEmail) {
          await this.enrichContact(byEmail, entity);
          if (entity.externalId) {
            await this.storeExternalMapping(businessId, byEmail, entity.source, entity.externalId);
          }
          return { contactId: byEmail, isNew: false, merged: false, matchedOn: 'email' };
        }
      }

      if (matchType === 'phone' && phone) {
        const byPhone = await this.phoneHolderId(businessId, phone);
        if (byPhone) {
          await this.enrichContact(byPhone, entity);
          if (entity.externalId) {
            await this.storeExternalMapping(businessId, byPhone, entity.source, entity.externalId);
          }
          return { contactId: byPhone, isNew: false, merged: false, matchedOn: 'phone' };
        }
      }
    }
    return null;
  }

  async resolvePayment(
    businessId: string,
    opts: { externalId?: string; invoiceId?: string; contactId?: string; payerEmail?: string; amount: number; currency: string; method: string },
  ): Promise<ResolvedPayment> {
    if (opts.externalId) {
      const existing = await this.prisma.client.payment.findFirst({
        where: { businessId, providerPaymentId: opts.externalId },
        include: { invoice: { select: { contactId: true } } },
      });
      if (existing) {
        return { paymentId: existing.id, contactId: existing.invoice?.contactId ?? null, found: true, matchedOn: 'transaction_id' };
      }
    }

    if (opts.invoiceId) {
      const byInvoice = await this.prisma.client.payment.findFirst({
        where: { businessId, invoiceId: opts.invoiceId },
        orderBy: { createdAt: 'desc' },
        include: { invoice: { select: { contactId: true } } },
      });
      if (byInvoice) {
        return { paymentId: byInvoice.id, contactId: byInvoice.invoice?.contactId ?? null, found: true, matchedOn: 'invoice_id' };
      }
    }

    let contactId = opts.contactId ?? null;
    if (!contactId && opts.payerEmail) {
      const resolved = await this.resolveContact(businessId, {
        source: opts.method.toLowerCase(),
        email: opts.payerEmail,
      });
      contactId = resolved.contactId || null;
    }

    return { paymentId: null, contactId, found: false, matchedOn: 'none' };
  }

  async resolveBooking(
    businessId: string,
    opts: { externalId?: string; contactId?: string; clientEmail?: string; clientName?: string },
  ): Promise<ResolvedBooking> {
    if (opts.externalId) {
      const existing = await this.prisma.client.booking.findFirst({
        where: { businessId, calendarEventId: opts.externalId },
      });
      if (existing) {
        return { bookingId: existing.id, contactId: existing.contactId, found: true, matchedOn: 'calendar_event_id' };
      }
    }

    let contactId = opts.contactId ?? null;
    if (!contactId && opts.clientEmail) {
      const resolved = await this.resolveContact(businessId, {
        source: 'booking',
        email: opts.clientEmail,
        firstName: opts.clientName?.split(' ')[0],
        lastName: opts.clientName?.split(' ').slice(1).join(' ') || undefined,
      });
      contactId = resolved.contactId || null;

      if (contactId) {
        const byContact = await this.prisma.client.booking.findFirst({
          where: { businessId, contactId, status: { in: ['CONFIRMED', 'PENDING'] } },
          orderBy: { startTime: 'desc' },
        });
        if (byContact) {
          return { bookingId: byContact.id, contactId, found: true, matchedOn: 'contact_email' };
        }
      }
    }

    return { bookingId: null, contactId, found: false, matchedOn: 'none' };
  }

  async resolveInvoice(
    businessId: string,
    opts: { externalId?: string; invoiceNumber?: string; contactId?: string; clientEmail?: string },
  ): Promise<ResolvedInvoice> {
    if (opts.invoiceNumber) {
      const existing = await this.prisma.client.invoice.findFirst({
        where: { businessId, invoiceNumber: opts.invoiceNumber },
      });
      if (existing) {
        return { invoiceId: existing.id, contactId: existing.contactId, found: true, matchedOn: 'invoice_number' };
      }
    }

    let contactId = opts.contactId ?? null;
    if (!contactId && opts.clientEmail) {
      const resolved = await this.resolveContact(businessId, {
        source: 'invoice',
        email: opts.clientEmail,
      });
      contactId = resolved.contactId || null;

      if (contactId) {
        const byContact = await this.prisma.client.invoice.findFirst({
          where: { businessId, contactId, status: { in: ['DRAFT', 'SENT', 'PARTIAL'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (byContact) {
          return { invoiceId: byContact.id, contactId, found: true, matchedOn: 'contact_email' };
        }
      }
    }

    return { invoiceId: null, contactId, found: false, matchedOn: 'none' };
  }

  async resolveCompany(businessId: string, companyName: string, domain?: string): Promise<{ companyId: string; isNew: boolean }> {
    if (domain) {
      const byDomain = await this.prisma.client.contact.findFirst({
        where: {
          businessId,
          email: { endsWith: `@${domain}` },
          companyName: { not: null },
          deletedAt: null,
        },
        select: { companyName: true },
      });
      if (byDomain?.companyName) {
        return { companyId: byDomain.companyName, isNew: false };
      }
    }

    return { companyId: companyName, isNew: true };
  }

  private async findByExternalId(businessId: string, source: string, externalId: string) {
    const mapping = await this.prisma.client.contactExternalMapping.findUnique({
      where: {
        businessId_source_externalId: { businessId, source, externalId },
      },
      include: { contact: true },
    });
    return mapping?.contact ?? null;
  }

  private async storeExternalMapping(businessId: string, contactId: string, source: string, externalId: string) {
    try {
      await this.prisma.client.contactExternalMapping.upsert({
        where: {
          businessId_source_externalId: { businessId, source, externalId },
        },
        create: { businessId, contactId, source, externalId },
        update: { contactId },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to store external mapping: ${message}`);
    }
  }

  private async enrichContact(contactId: string, entity: ExternalEntity) {
    if (!entity.firstName && !entity.lastName && !entity.companyName) return;

    const existing = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      select: { firstName: true, lastName: true, companyName: true },
    });
    if (!existing) return;

    const data: { firstName?: string; lastName?: string; companyName?: string } = {};

    const isTrusted = this.mergeRules.trustedSources.includes(entity.source);
    const shouldOverwrite = this.mergeRules.fieldPrecedence === 'prefer_newest' ||
      (this.mergeRules.fieldPrecedence === 'prefer_source' && isTrusted);

    if (entity.firstName && (!existing.firstName || shouldOverwrite)) data.firstName = entity.firstName;
    if (entity.lastName && (!existing.lastName || shouldOverwrite)) data.lastName = entity.lastName;
    if (entity.companyName && (!existing.companyName || shouldOverwrite)) data.companyName = entity.companyName;

    if (Object.keys(data).length > 0) {
      await this.prisma.client.contact.update({
        where: { id: contactId },
        data,
      });
    }
  }

}

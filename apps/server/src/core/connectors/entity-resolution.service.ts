import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);
  private mergeRules: MergeRuleConfig = { ...DEFAULT_MERGE_RULES };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  configureMergeRules(rules: Partial<MergeRuleConfig>): void {
    this.mergeRules = { ...this.mergeRules, ...rules };
    this.logger.log(`Merge rules updated: fieldPrecedence=${this.mergeRules.fieldPrecedence}, matchOrder=${this.mergeRules.matchOrder.join(',')}`);
  }

  getMergeRules(): MergeRuleConfig {
    return { ...this.mergeRules };
  }

  async resolveContact(businessId: string, entity: ExternalEntity): Promise<ResolvedEntity> {
    const normalizedEmail = entity.email?.toLowerCase().trim() || null;
    const normalizedPhone = this.normalizePhone(entity.phone);

    for (const matchType of this.mergeRules.matchOrder) {
      if (matchType === 'external_id' && entity.externalId) {
        const byExternalId = await this.findByExternalId(businessId, entity.source, entity.externalId);
        if (byExternalId) {
          await this.enrichContact(byExternalId.id, entity);
          return { contactId: byExternalId.id, isNew: false, merged: false, matchedOn: 'external_id' };
        }
      }

      if (matchType === 'email' && normalizedEmail) {
        const byEmail = await this.prisma.client.contact.findFirst({
          where: { businessId, email: normalizedEmail, deletedAt: null },
        });
        if (byEmail) {
          await this.enrichContact(byEmail.id, entity);
          if (entity.externalId) {
            await this.storeExternalMapping(businessId, byEmail.id, entity.source, entity.externalId);
          }
          return { contactId: byEmail.id, isNew: false, merged: false, matchedOn: 'email' };
        }
      }

      if (matchType === 'phone' && normalizedPhone) {
        const byPhone = await this.prisma.client.contact.findFirst({
          where: { businessId, phone: normalizedPhone, deletedAt: null },
        });
        if (byPhone) {
          await this.enrichContact(byPhone.id, entity);
          if (entity.externalId) {
            await this.storeExternalMapping(businessId, byPhone.id, entity.source, entity.externalId);
          }
          return { contactId: byPhone.id, isNew: false, merged: false, matchedOn: 'phone' };
        }
      }
    }

    if (!this.mergeRules.autoCreateContacts) {
      return { contactId: '', isNew: false, merged: false, matchedOn: 'none' };
    }

    const newContact = await this.prisma.client.contact.create({
      data: {
        businessId,
        email: normalizedEmail,
        phone: normalizedPhone,
        firstName: entity.firstName || null,
        lastName: entity.lastName || null,
        companyName: entity.companyName || null,
        source: entity.source,
        status: 'LEAD',
      },
    });

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

  async resolvePayment(
    businessId: string,
    opts: { externalId?: string; invoiceId?: string; contactId?: string; payerEmail?: string; amount: number; currency: string; method: string },
  ): Promise<ResolvedPayment> {
    if (opts.externalId) {
      const existing = await this.prisma.client.payment.findFirst({
        where: { businessId, transactionId: opts.externalId },
      });
      if (existing) {
        return { paymentId: existing.id, contactId: existing.contactId, found: true, matchedOn: 'transaction_id' };
      }
    }

    if (opts.invoiceId) {
      const byInvoice = await this.prisma.client.payment.findFirst({
        where: { businessId, invoiceId: opts.invoiceId },
        orderBy: { createdAt: 'desc' },
      });
      if (byInvoice) {
        return { paymentId: byInvoice.id, contactId: byInvoice.contactId, found: true, matchedOn: 'invoice_id' };
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

  private normalizePhone(phone?: string): string | null {
    if (!phone) return null;
    const cleaned = phone.replace(/[\s\-().]/g, '');
    if (cleaned.startsWith('+')) {
      const digits = cleaned.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return null;
      return `+${digits}`;
    }
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    if (digits.startsWith('1') && digits.length === 11) {
      return `+${digits}`;
    }
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    return `+${digits}`;
  }
}

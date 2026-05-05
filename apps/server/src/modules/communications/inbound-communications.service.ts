import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';

export interface InboundEmailPayload {
  businessId?: string;
  from: string;
  to?: string;
  subject?: string;
  body?: string;
  externalId?: string;
  senderName?: string;
  receivedAt?: Date;
}

export interface InboundSmsPayload {
  businessId?: string;
  from: string;
  to?: string;
  body?: string;
  externalId?: string;
  senderName?: string;
  receivedAt?: Date;
}

export interface InboundResult {
  ok: boolean;
  businessId: string | null;
  contactId: string | null;
  matchedOn: string | null;
  reason?: string;
}

/**
 * Routes inbound email/SMS webhooks (Gmail, Resend, Twilio, etc.) into the
 * Keyflow event bus. Every accepted payload emits `message.received` with a
 * resolved `contactId`, which the CRM sequence scheduler listens for and uses
 * to call `markReplyForContact()`. That, in turn, attributes the reply to the
 * variant the contact saw and feeds A/B test results in real time.
 *
 * WhatsApp inbound is already wired in WhatsAppService.receiveInbound — this
 * service exists so email and SMS providers can participate using the same
 * event shape without duplicating the resolution + emission logic.
 */
@Injectable()
export class InboundCommunicationsService {
  private readonly logger = new Logger(InboundCommunicationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async receiveEmail(payload: InboundEmailPayload): Promise<InboundResult> {
    const from = (payload.from || '').trim().toLowerCase();
    if (!from) {
      return { ok: false, businessId: null, contactId: null, matchedOn: null, reason: 'missing_from' };
    }

    const businessId =
      payload.businessId ?? (await this.resolveBusinessByDestination('EMAIL', payload.to));
    if (!businessId) {
      this.logger.warn(`Inbound email from ${from} could not be routed to a business`);
      return { ok: false, businessId: null, contactId: null, matchedOn: null, reason: 'unrouted' };
    }

    const match = await this.entityResolution.findContactIdByMatch(businessId, {
      email: from,
      externalId: payload.externalId ?? null,
      source: 'gmail',
    });
    if (!match) {
      this.logger.log(`Inbound email from ${from} (business ${businessId}) had no contact match`);
      return { ok: true, businessId, contactId: null, matchedOn: null, reason: 'no_contact_match' };
    }

    this.events.emit('message.received', {
      connectorType: 'email',
      businessId,
      channel: 'email',
      from,
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      externalId: payload.externalId ?? null,
      contactId: match.contactId,
      timestamp: payload.receivedAt ?? new Date(),
    });

    return { ok: true, businessId, contactId: match.contactId, matchedOn: match.matchedOn };
  }

  async receiveSms(payload: InboundSmsPayload): Promise<InboundResult> {
    const from = (payload.from || '').trim();
    if (!from) {
      return { ok: false, businessId: null, contactId: null, matchedOn: null, reason: 'missing_from' };
    }

    const businessId =
      payload.businessId ?? (await this.resolveBusinessByDestination('SMS', payload.to));
    if (!businessId) {
      this.logger.warn(`Inbound SMS from ${from} could not be routed to a business`);
      return { ok: false, businessId: null, contactId: null, matchedOn: null, reason: 'unrouted' };
    }

    const match = await this.entityResolution.findContactIdByMatch(businessId, {
      phone: from,
      externalId: payload.externalId ?? null,
      source: 'sms',
    });
    if (!match) {
      this.logger.log(`Inbound SMS from ${from} (business ${businessId}) had no contact match`);
      return { ok: true, businessId, contactId: null, matchedOn: null, reason: 'no_contact_match' };
    }

    this.events.emit('message.received', {
      connectorType: 'sms',
      businessId,
      channel: 'sms',
      from,
      to: payload.to,
      body: payload.body,
      externalId: payload.externalId ?? null,
      contactId: match.contactId,
      timestamp: payload.receivedAt ?? new Date(),
    });

    return { ok: true, businessId, contactId: match.contactId, matchedOn: match.matchedOn };
  }

  /**
   * Look up a business by the inbound recipient address. Senders typically
   * arrive with the destination address that received the message (e.g. the
   * mailbox or SMS sender ID we registered as a ChannelDestination), so we
   * can pin the inbound to a single tenant without an explicit body hint.
   */
  private async resolveBusinessByDestination(
    platform: 'EMAIL' | 'SMS',
    rawTo: string | undefined | null,
  ): Promise<string | null> {
    if (!rawTo) return null;
    const normalized =
      platform === 'EMAIL' ? rawTo.trim().toLowerCase() : rawTo.replace(/[^0-9+]/g, '');
    if (!normalized) return null;
    const dest = await (this.prisma.client as any).channelDestination.findFirst({
      where: { platform, platformId: normalized },
      select: { businessId: true },
    });
    return dest?.businessId ?? null;
  }
}

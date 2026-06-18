import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { encryptToken, decryptToken } from '../../core/crypto/token-crypto';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import type { ResolvedEntity } from '../../core/connectors/entity-resolution.service';

export interface WhatsAppMessage {
  to: string;
  body: string;
  templateName?: string;
  templateData?: Record<string, string>;
}

export interface WhatsAppInboundPayload {
  from: string;
  body?: string;
  externalId?: string;
  senderName?: string;
  provider?: 'twilio' | 'meta';
  rawPayload?: Record<string, unknown>;
  receivedAt?: Date;
}

export interface WhatsAppConfig {
  provider: 'twilio' | 'meta' | 'mock';
  accountSid?: string;
  authToken?: string;
  phoneNumberId?: string;
  accessToken?: string;
  fromNumber?: string;
}

/** Fields that should be encrypted at rest */
const SENSITIVE_FIELDS: (keyof WhatsAppConfig)[] = ['authToken', 'accessToken', 'accountSid'];

function encryptConfig(config: WhatsAppConfig): WhatsAppConfig {
  const encrypted = { ...config };
  for (const field of SENSITIVE_FIELDS) {
    const value = encrypted[field];
    if (value && typeof value === 'string') {
      (encrypted as Record<string, string | undefined>)[field] = encryptToken(value) ?? undefined;
    }
  }
  return encrypted;
}

function decryptConfig(config: WhatsAppConfig): WhatsAppConfig {
  const decrypted = { ...config };
  for (const field of SENSITIVE_FIELDS) {
    const value = decrypted[field];
    if (value && typeof value === 'string') {
      (decrypted as Record<string, string | undefined>)[field] = decryptToken(value) ?? undefined;
    }
  }
  return decrypted;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
  ) {}

  async receiveInbound(businessId: string, payload: WhatsAppInboundPayload) {
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'whatsapp',
      phone: payload.from,
      firstName: payload.senderName?.split(' ')[0],
      lastName: payload.senderName?.split(' ').slice(1).join(' ') || undefined,
    });

    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'whatsapp',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { messageIntakeEnabled: true },
    });
    const intakeEnabled = business?.messageIntakeEnabled ?? false;

    if (intakeEnabled) {
      this.events.emit('message.intake.received', {
        businessId,
        connectorType: 'whatsapp',
        sourceChannel: 'whatsapp',
        externalId: payload.externalId ?? null,
        from: payload.from,
        fromName: payload.senderName,
        body: payload.body,
      });
    } else {
      this.events.emit('message.received', {
        connectorType: 'whatsapp',
        externalId: payload.externalId ?? null,
        businessId,
        timestamp: new Date(),
        channel: 'whatsapp',
        from: payload.from,
        body: payload.body,
        contactId: resolved.contactId,
      });
    }

    await this.ingestToKeyInbox(businessId, payload, resolved);

    return resolved;
  }

  private async ingestToKeyInbox(
    businessId: string,
    payload: WhatsAppInboundPayload,
    resolved: ResolvedEntity,
  ): Promise<void> {
    const externalMessageId = payload.externalId;
    if (!externalMessageId) {
      this.logger.warn(`Skipping KEYInbox ingest for WhatsApp message without externalId (business ${businessId})`);
      return;
    }

    try {
      const existing = await this.prisma.client.keyInboxMessage.findFirst({
        where: {
          businessId,
          channel: 'whatsapp',
          externalMessageId,
        },
      });
      if (existing) {
        this.logger.debug(`WhatsApp message ${externalMessageId} already in KEYInbox`);
        return;
      }

      const normalizedFrom = this.normalizePhone(payload.from) ?? payload.from;
      const body = payload.body ?? '';
      const receivedAt = payload.receivedAt ?? new Date();

      const thread = await this.keyInbox.upsertThread({
        businessId,
        channel: 'whatsapp',
        externalThreadId: normalizedFrom,
        contactId: resolved.contactId || null,
        subject: this.truncate(body, 100),
        status: 'OPEN',
        priority: 'NORMAL',
        metadata: {
          provider: payload.provider ?? 'unknown',
          rawPayload: payload.rawPayload ?? {},
        },
      });

      await this.keyInbox.addMessage({
        businessId,
        threadId: thread.id,
        channel: 'whatsapp',
        direction: 'INBOUND',
        senderName: payload.senderName ?? null,
        senderPhone: normalizedFrom,
        senderHandle: normalizedFrom,
        contentText: body,
        externalMessageId,
        receivedAt,
        metadata: {
          provider: payload.provider ?? 'unknown',
          rawPayload: payload.rawPayload ?? {},
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to ingest WhatsApp message to KEYInbox for ${businessId}: ${(err as Error).message}`,
      );
    }
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return 'New message';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  async getConfig(businessId: string): Promise<WhatsAppConfig | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    if (!business?.metaData) return null;
    const meta = business.metaData as Record<string, unknown>;
    const wa = meta.whatsapp as WhatsAppConfig | undefined;
    if (!wa) return null;
    return decryptConfig(wa);
  }

  async saveConfig(businessId: string, config: WhatsAppConfig): Promise<void> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown> | null) ?? {};
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: { ...meta, whatsapp: encryptConfig(config) } },
    });
  }

  async sendMessage(businessId: string, message: WhatsAppMessage): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(businessId);
    if (!config) {
      this.logger.warn(`No WhatsApp config for business ${businessId}`);
      return { success: false, error: 'WhatsApp not configured' };
    }

    // Normalize phone number
    const to = this.normalizePhone(message.to);
    if (!to) {
      return { success: false, error: 'Invalid phone number' };
    }

    try {
      if (config.provider === 'mock') {
        this.logger.log(`[MOCK WhatsApp] To: ${to}, Body: ${message.body.slice(0, 100)}`);
        return { success: true };
      }

      if (config.provider === 'twilio') {
        return this.sendViaTwilio(config, to, message);
      }

      if (config.provider === 'meta') {
        return this.sendViaMeta(config, to, message);
      }

      return { success: false, error: 'Unknown provider' };
    } catch (e) {
      this.logger.error(`Failed to send WhatsApp message: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  }

  private async sendViaTwilio(
    config: WhatsAppConfig,
    to: string,
    message: WhatsAppMessage,
  ): Promise<{ success: boolean; error?: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('From', `whatsapp:${config.fromNumber}`);
    params.append('To', `whatsapp:${to}`);
    params.append('Body', message.body);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return { success: false, error: text };
    }

    return { success: true };
  }

  private async sendViaMeta(
    config: WhatsAppConfig,
    to: string,
    message: WhatsAppMessage,
  ): Promise<{ success: boolean; error?: string }> {
    const url = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`;

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
    };

    if (message.templateName && config.accessToken) {
      body.type = 'template';
      body.template = {
        name: message.templateName,
        language: { code: 'en' },
        components: message.templateData
          ? [{ type: 'body', parameters: Object.entries(message.templateData).map(([_, value]) => ({ type: 'text', text: value })) }]
          : undefined,
      };
    } else {
      body.type = 'text';
      body.text = { body: message.body };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return { success: false, error: text };
    }

    return { success: true };
  }

  private normalizePhone(phone: string): string | null {
    const cleaned = phone.replace(/\s/g, '').replace(/[-()]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('1') && cleaned.length === 11) return `+${cleaned}`;
    if (cleaned.length === 10) return `+1${cleaned}`;
    if (cleaned.length === 7) return null; // Too short
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }

  async sendBookingConfirmation(
    businessId: string,
    contactPhone: string,
    contactName: string,
    serviceName: string,
    date: string,
    time: string,
    bookingUrl?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const body = bookingUrl
      ? `Hi ${contactName}, your booking for *${serviceName}* on ${date} at ${time} is confirmed. View details: ${bookingUrl}`
      : `Hi ${contactName}, your booking for *${serviceName}* on ${date} at ${time} is confirmed. We look forward to seeing you!`;

    return this.sendMessage(businessId, { to: contactPhone, body });
  }

  async sendBookingReminder(
    businessId: string,
    contactPhone: string,
    contactName: string,
    serviceName: string,
    date: string,
    time: string,
  ): Promise<{ success: boolean; error?: string }> {
    const body = `Hi ${contactName}, reminder: you have an appointment for *${serviceName}* tomorrow at ${time}. See you then!`;
    return this.sendMessage(businessId, { to: contactPhone, body });
  }

  async sendInvoiceReminder(
    businessId: string,
    contactPhone: string,
    contactName: string,
    invoiceNumber: string,
    amount: number,
    currency: string,
    payUrl?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const body = payUrl
      ? `Hi ${contactName}, this is a friendly reminder that invoice *${invoiceNumber}* for ${currency} ${amount} is due. Pay here: ${payUrl}`
      : `Hi ${contactName}, this is a friendly reminder that invoice *${invoiceNumber}* for ${currency} ${amount} is due. Please settle at your earliest convenience.`;

    return this.sendMessage(businessId, { to: contactPhone, body });
  }
}

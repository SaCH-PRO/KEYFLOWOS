import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WhatsAppAdapter } from '../communications/adapters/whatsapp-adapter';

interface SendInput {
  toPhone: string;
  contactId?: string;
  body?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  mediaUrls?: string[];
  scheduledAt?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly adapter = new WhatsAppAdapter();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  private normalizePhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
  }

  async getConnectionStatus(businessId: string): Promise<{ connected: boolean; destination?: { id: string; platformId: string; displayName: string | null } }> {
    const dest = await this.findActiveDestination(businessId);
    if (!dest) return { connected: false };
    return {
      connected: true,
      destination: { id: dest.id, platformId: dest.platformId ?? '', displayName: dest.displayName },
    };
  }

  private async findActiveDestination(businessId: string) {
    return this.prisma.client.channelDestination.findFirst({
      where: { businessId, platform: 'WHATSAPP', isActive: true, connection: { provider: 'WHATSAPP' } },
      include: { connection: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listConversations(businessId: string) {
    const contacts = await this.prisma.client.whatsAppContact.findMany({
      where: { businessId },
      include: { contact: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    return contacts.map((c) => ({
      id: c.id,
      phoneNumber: c.phoneNumber,
      displayName: c.displayName ?? this.formatContactName(c.contact) ?? c.phoneNumber,
      contactId: c.contactId,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      lastMessageSnippet: c.lastMessageSnippet ?? null,
    }));
  }

  private formatContactName(c: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null) {
    if (!c) return null;
    if (c.displayName) return c.displayName;
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
    return name || null;
  }

  async getConversation(businessId: string, whatsappContactId: string) {
    const contact = await this.prisma.client.whatsAppContact.findFirst({
      where: { id: whatsappContactId, businessId },
      include: { contact: { select: { id: true, firstName: true, lastName: true, displayName: true, phone: true } } },
    });
    if (!contact) throw new NotFoundException('Conversation not found');

    const messages = await this.prisma.client.whatsAppMessage.findMany({
      where: { businessId, whatsappContactId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const lastInbound = await this.prisma.client.whatsAppMessage.findFirst({
      where: { businessId, whatsappContactId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const withinWindow = lastInbound ? (Date.now() - lastInbound.createdAt.getTime()) < 24 * 60 * 60 * 1000 : false;

    return {
      id: contact.id,
      phoneNumber: contact.phoneNumber,
      displayName: contact.displayName ?? this.formatContactName(contact.contact) ?? contact.phoneNumber,
      contactId: contact.contactId,
      withinWindow,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        templateName: m.templateName,
        templateParams: m.templateParams,
        status: m.status,
        scheduledAt: m.scheduledAt?.toISOString() ?? null,
        sentAt: m.sentAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        wamid: m.wamid,
        errorMessage: m.errorMessage,
        mediaUrls: m.mediaUrls,
      })),
    };
  }

  async upsertContact(businessId: string, phoneRaw: string, opts?: { displayName?: string; contactId?: string }) {
    const phoneNumber = this.normalizePhone(phoneRaw);
    if (!phoneNumber) throw new BadRequestException('Invalid phone number');

    let contactId = opts?.contactId;
    if (!contactId) {
      const crm = await this.prisma.client.contact.findFirst({
        where: { businessId, deletedAt: null, OR: [{ phone: phoneRaw }, { whatsappNumber: phoneRaw }, { phoneNormalized: phoneNumber }] },
        select: { id: true },
      });
      contactId = crm?.id;
    }

    return this.prisma.client.whatsAppContact.upsert({
      where: { businessId_phoneNumber: { businessId, phoneNumber } },
      create: { businessId, phoneNumber, displayName: opts?.displayName, contactId: contactId ?? null },
      update: {
        ...(opts?.displayName ? { displayName: opts.displayName } : {}),
        ...(contactId ? { contactId } : {}),
      },
    });
  }

  async listTemplates(businessId: string) {
    const dest = await this.findActiveDestination(businessId);
    if (!dest) return { templates: [], error: 'WhatsApp not connected' };

    const token = (dest.connection as { token: string | null })?.token;
    const providerMeta = (dest.connection as { providerMeta: unknown })?.providerMeta as Record<string, unknown> | null;
    const wabaId = providerMeta?.wabaId as string | undefined;

    if (!token || !wabaId) return { templates: [], error: 'Missing access token or WABA id' };

    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates?fields=name,status,language,category,components&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        return { templates: [], error: `Graph API ${res.status}: ${t.slice(0, 160)}` };
      }
      const data = (await res.json()) as { data?: Array<{ name: string; status: string; language: string; category?: string; components?: Array<Record<string, unknown>> }> };
      const templates = (data.data ?? [])
        .filter((t) => t.status === 'APPROVED')
        .map((t) => ({
          name: t.name,
          language: t.language,
          category: t.category,
          variableCount: this.extractVariableCount(t.components ?? []),
          components: t.components ?? [],
        }));
      return { templates };
    } catch (err) {
      return { templates: [], error: (err as Error).message };
    }
  }

  private extractVariableCount(components: Array<Record<string, unknown>>): number {
    let max = 0;
    for (const c of components) {
      const text = (c.text as string | undefined) ?? '';
      const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
      for (const m of matches) {
        const n = parseInt(m.replace(/[{}]/g, ''), 10);
        if (n > max) max = n;
      }
    }
    return max;
  }

  async sendMessage(businessId: string, input: SendInput) {
    const dest = await this.findActiveDestination(businessId);
    if (!dest) throw new BadRequestException('WhatsApp is not connected');

    const phoneNumber = this.normalizePhone(input.toPhone);
    if (!phoneNumber) throw new BadRequestException('Recipient phone is required');

    const waContact = await this.upsertContact(businessId, phoneNumber, { contactId: input.contactId });

    const isScheduled = !!input.scheduledAt;
    const scheduledAt = isScheduled ? new Date(input.scheduledAt as string) : null;
    if (isScheduled && (!scheduledAt || isNaN(scheduledAt.getTime()))) {
      throw new BadRequestException('Invalid scheduledAt');
    }
    if (isScheduled && scheduledAt && scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    if (!input.body && !input.templateName) {
      throw new BadRequestException('Either body or templateName is required');
    }

    // 24h window enforcement applies to ALL free-form sends (immediate AND
    // scheduled). For scheduled sends we additionally require the scheduled
    // time to fall within the current open window, since once the 24h window
    // closes only pre-approved templates are allowed.
    if (!input.templateName) {
      const lastInbound = await this.prisma.client.whatsAppMessage.findFirst({
        where: { businessId, whatsappContactId: waContact.id, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const windowOpenUntil = lastInbound ? lastInbound.createdAt.getTime() + 24 * 60 * 60 * 1000 : 0;
      const checkAt = isScheduled && scheduledAt ? scheduledAt.getTime() : Date.now();
      if (checkAt >= windowOpenUntil) {
        throw new BadRequestException(
          isScheduled
            ? 'Scheduled time is outside the 24h messaging window. Use a pre-approved template instead.'
            : 'Outside the 24h messaging window. Use a pre-approved template instead.',
        );
      }
    }

    if (isScheduled) {
      return this.scheduleViaDeliveryQueue(businessId, dest.id, waContact, input, scheduledAt!);
    }

    const message = await this.prisma.client.whatsAppMessage.create({
      data: {
        businessId,
        whatsappContactId: waContact.id,
        direction: 'OUTBOUND',
        body: input.body ?? null,
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? (input.templateName ? 'en' : null),
        templateParams: input.templateParams ? (input.templateParams as unknown as object) : undefined,
        mediaUrls: input.mediaUrls ?? [],
        destinationId: dest.id,
        status: 'SENDING',
      },
    });

    return this.dispatchOne(message.id);
  }

  /**
   * Scheduled WhatsApp sends are routed through the existing OutboundDelivery
   * queue so the central DeliveryQueueService dispatches them on its tick.
   * We mirror the result back onto the WhatsAppMessage row via the
   * `delivery.completed` / `delivery.failed` event listeners below.
   */
  private async scheduleViaDeliveryQueue(
    businessId: string,
    destinationId: string,
    waContact: { id: string; phoneNumber: string },
    input: SendInput,
    scheduledAt: Date,
  ) {
    const variantMeta: Record<string, unknown> = {
      recipientPhone: waContact.phoneNumber,
    };
    if (input.templateName) {
      variantMeta.templateName = input.templateName;
      variantMeta.templateLanguage = input.templateLanguage ?? 'en';
      if (Array.isArray(input.templateParams)) variantMeta.templateParameters = input.templateParams;
    }

    const content = await this.prisma.client.outboundContent.create({
      data: {
        businessId,
        contentType: 'whatsapp_inbox',
        body: input.body ?? null,
        status: 'Scheduled',
        scheduledAt,
        contentMeta: { source: 'whatsapp_inbox', whatsappContactId: waContact.id },
      },
    });

    const variant = await this.prisma.client.outboundVariant.create({
      data: {
        contentId: content.id,
        platform: 'WHATSAPP',
        textBody: input.body ?? null,
        mediaUrls: input.mediaUrls ?? [],
        variantMeta,
      },
    });

    const delivery = await this.prisma.client.outboundDelivery.create({
      data: {
        contentId: content.id,
        variantId: variant.id,
        destinationId,
        businessId,
        status: 'Scheduled',
        scheduledAt,
        recipientPhone: waContact.phoneNumber,
      },
    });

    const message = await this.prisma.client.whatsAppMessage.create({
      data: {
        businessId,
        whatsappContactId: waContact.id,
        direction: 'OUTBOUND',
        body: input.body ?? null,
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? (input.templateName ? 'en' : null),
        templateParams: input.templateParams ? (input.templateParams as unknown as object) : undefined,
        mediaUrls: input.mediaUrls ?? [],
        destinationId,
        deliveryId: delivery.id,
        status: 'SCHEDULED',
        scheduledAt,
      },
    });

    return { id: message.id, status: 'SCHEDULED' as const, scheduledAt: scheduledAt.toISOString(), deliveryId: delivery.id };
  }

  @OnEvent('delivery.completed')
  async onDeliveryCompleted(payload: { deliveryId: string }) {
    const msg = await this.prisma.client.whatsAppMessage.findUnique({ where: { deliveryId: payload.deliveryId } });
    if (!msg) return;
    const delivery = await this.prisma.client.outboundDelivery.findUnique({
      where: { id: payload.deliveryId },
      select: { externalPostId: true, sentAt: true },
    });
    await this.prisma.client.whatsAppMessage.update({
      where: { id: msg.id },
      data: {
        status: 'SENT',
        sentAt: delivery?.sentAt ?? new Date(),
        wamid: delivery?.externalPostId ?? undefined,
        errorMessage: null,
      },
    });
    await this.touchContact(msg.whatsappContactId, msg.body ?? (msg.templateName ? `[Template: ${msg.templateName}]` : ''));
    const wac = await this.prisma.client.whatsAppContact.findUnique({ where: { id: msg.whatsappContactId }, select: { phoneNumber: true, contactId: true } });
    this.events.emit('message.sent', {
      connectorType: 'whatsapp',
      businessId: msg.businessId,
      channel: 'whatsapp',
      to: wac?.phoneNumber,
      externalId: delivery?.externalPostId ?? null,
      contactId: wac?.contactId ?? null,
    });
  }

  @OnEvent('delivery.failed')
  async onDeliveryFailed(payload: { deliveryId: string }) {
    const msg = await this.prisma.client.whatsAppMessage.findUnique({ where: { deliveryId: payload.deliveryId } });
    if (!msg) return;
    const delivery = await this.prisma.client.outboundDelivery.findUnique({
      where: { id: payload.deliveryId },
      select: { errorCode: true, errorMessage: true },
    });
    await this.prisma.client.whatsAppMessage.update({
      where: { id: msg.id },
      data: {
        status: 'FAILED',
        errorMessage: delivery?.errorMessage ?? delivery?.errorCode ?? 'Send failed',
      },
    });
  }

  private async dispatchOne(messageId: string) {
    const message = await this.prisma.client.whatsAppMessage.findUnique({
      where: { id: messageId },
      include: { whatsappContact: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const dest = message.destinationId
      ? await this.prisma.client.channelDestination.findUnique({ where: { id: message.destinationId }, include: { connection: true } })
      : await this.findActiveDestination(message.businessId);

    if (!dest) {
      await this.prisma.client.whatsAppMessage.update({ where: { id: messageId }, data: { status: 'FAILED', errorMessage: 'No active WhatsApp destination' } });
      throw new BadRequestException('No active WhatsApp destination');
    }

    const token = (dest.connection as { token: string | null })?.token;
    const platformId = dest.platformId;

    if (!token || !platformId) {
      await this.prisma.client.whatsAppMessage.update({ where: { id: messageId }, data: { status: 'FAILED', errorMessage: 'Missing credentials' } });
      throw new BadRequestException('WhatsApp credentials missing');
    }

    const meta: Record<string, unknown> = { recipientPhone: message.whatsappContact.phoneNumber };
    if (message.templateName) {
      meta.templateName = message.templateName;
      meta.templateLanguage = message.templateLanguage ?? 'en';
      if (Array.isArray(message.templateParams)) meta.templateParameters = message.templateParams;
    }

    const result = await this.adapter.publish(
      { token } as { token: string },
      { platformId } as { platformId: string },
      { textBody: message.body ?? '', mediaUrls: message.mediaUrls ?? [], meta },
    );

    if (result.success) {
      const updated = await this.prisma.client.whatsAppMessage.update({
        where: { id: messageId },
        data: { status: 'SENT', sentAt: new Date(), wamid: result.externalPostId ?? undefined, errorMessage: null },
      });
      await this.touchContact(message.whatsappContactId, message.body ?? (message.templateName ? `[Template: ${message.templateName}]` : ''));
      this.events.emit('message.sent', { connectorType: 'whatsapp', businessId: message.businessId, channel: 'whatsapp', to: message.whatsappContact.phoneNumber, externalId: result.externalPostId, contactId: message.whatsappContact.contactId });
      return { id: updated.id, status: updated.status, wamid: updated.wamid };
    }

    await this.prisma.client.whatsAppMessage.update({
      where: { id: messageId },
      data: { status: 'FAILED', errorMessage: result.errorMessage ?? result.errorCode ?? 'Send failed' },
    });
    throw new BadRequestException(result.errorMessage ?? 'WhatsApp send failed');
  }

  private async touchContact(whatsappContactId: string, snippet: string) {
    await this.prisma.client.whatsAppContact.update({
      where: { id: whatsappContactId },
      data: { lastMessageAt: new Date(), lastMessageSnippet: snippet.slice(0, 160) },
    }).catch(() => undefined);
  }

  async receiveInbound(opts: { businessId: string; from: string; body?: string; wamid?: string; senderName?: string; timestamp?: Date }) {
    const phoneNumber = this.normalizePhone(opts.from);
    if (!phoneNumber) return null;

    const waContact = await this.upsertContact(opts.businessId, phoneNumber, { displayName: opts.senderName });

    const existing = opts.wamid
      ? await this.prisma.client.whatsAppMessage.findUnique({ where: { wamid: opts.wamid } })
      : null;
    if (existing) return existing;

    const created = await this.prisma.client.whatsAppMessage.create({
      data: {
        businessId: opts.businessId,
        whatsappContactId: waContact.id,
        direction: 'INBOUND',
        body: opts.body ?? null,
        status: 'RECEIVED',
        wamid: opts.wamid ?? null,
        sentAt: opts.timestamp ?? new Date(),
      },
    });

    await this.touchContact(waContact.id, opts.body ?? '');

    this.events.emit('message.received', {
      connectorType: 'whatsapp',
      businessId: opts.businessId,
      channel: 'whatsapp',
      from: opts.from,
      body: opts.body,
      externalId: opts.wamid ?? null,
      contactId: waContact.contactId,
    });

    return created;
  }
}

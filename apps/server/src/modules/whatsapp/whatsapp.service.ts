import { BadRequestException, Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { encryptToken, decryptToken } from '../../core/crypto/token-crypto';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { KEY_INBOX_CHANNELS } from '../key-inbox/key-inbox.constants';
import type { ResolvedEntity } from '../../core/connectors/entity-resolution.service';
import { StaffChatBridgeService } from '../structure/staff-chat-bridge.service';

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

export interface WhatsAppTemplateSummary {
  name: string;
  language: string;
  category?: string;
  variableCount: number;
}

/** Shape of a template as returned by the Meta Graph API. */
interface MetaTemplate {
  name: string;
  language: string;
  category?: string;
  status?: string;
  components?: Array<{ type?: string; text?: string }>;
}

/**
 * How many `{{n}}` placeholders the template body takes.
 *
 * The drawer renders exactly this many inputs, so an undercount silently sends
 * a template with missing variables — which Meta rejects at delivery time.
 * Counting DISTINCT indices matters: `{{1}} … {{1}}` is one variable, not two.
 */
function countTemplateVariables(t: MetaTemplate): number {
  const body = (t.components ?? []).find((c) => (c.type ?? '').toUpperCase() === 'BODY');
  if (!body?.text) return 0;
  const found = new Set<string>();
  for (const m of body.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(m[1]);
  return found.size;
}

/**
 * The drawer sends template variables as a positional array; Meta and Twilio
 * both take them keyed by their 1-based index.
 */
function toTemplateData(params?: unknown): Record<string, string> | undefined {
  // Defensive against a non-array value. templateParams is stored as raw Json
  // and reaches here from a scheduled row, so a malformed one must not throw
  // inside the dispatch cron and strand the whole batch.
  if (!Array.isArray(params) || params.length === 0) return undefined;
  const out: Record<string, string> = {};
  params.forEach((v, i) => {
    out[String(i + 1)] = String(v);
  });
  return out;
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
    @Inject(forwardRef(() => StaffChatBridgeService)) private readonly staffChat: StaffChatBridgeService,
  ) {}

  async receiveInbound(businessId: string, payload: WhatsAppInboundPayload) {
    // Staff members (full account or contact-only) can talk to KEY directly
    // over WhatsApp — check that before treating this as a customer inquiry.
    if (payload.body?.trim()) {
      const staffResult = await this.staffChat.routeInboundMessage(businessId, payload.from, payload.body, 'whatsapp');
      if (staffResult.handled) {
        if (staffResult.reply) {
          await this.sendMessage(businessId, { to: payload.from, body: staffResult.reply });
        }
        return { contactId: null, matchedOn: 'staff_position' as const, isNew: false, merged: false };
      }
    }

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
        channel: KEY_INBOX_CHANNELS.WHATSAPP,
        from: payload.from,
        body: payload.body,
        contactId: resolved.contactId,
      });
    }

    await this.ingestToKeyInbox(businessId, payload, resolved);

    // Conversation history for the manage drawer. Runs after intake so a
    // persistence failure cannot cost us the inbound message itself.
    await this.recordMessage(businessId, payload.from, {
      direction: 'INBOUND',
      body: payload.body ?? null,
      status: 'RECEIVED',
      displayName: payload.senderName ?? null,
      contactId: resolved.contactId,
      wamid: payload.externalId ?? null,
      at: payload.receivedAt,
    });

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
          channel: KEY_INBOX_CHANNELS.WHATSAPP,
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
        channel: KEY_INBOX_CHANNELS.WHATSAPP,
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
        channel: KEY_INBOX_CHANNELS.WHATSAPP,
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
    } catch (err: any) {
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

  // ── Conversation persistence ───────────────────────────────────────────
  //
  // WhatsAppContact and WhatsAppMessage have existed in the schema, and the
  // manage drawer was written against exactly their shape, but nothing ever
  // created a row: inbound went to KeyInbox only, and the sole
  // whatsAppMessage.create in the codebase is guarded by a contact lookup that
  // could never succeed. Both tables were empty. These two writers are the
  // missing link — without them the drawer's endpoints return [] forever.
  //
  // Persistence must never break message handling, so every call is wrapped:
  // a failure here is logged and swallowed, never propagated to the webhook.

  /** Upsert the conversation row for a phone number and return its id. */
  private async upsertConversation(
    businessId: string,
    phoneNumber: string,
    opts: { displayName?: string | null; contactId?: string | null; snippet?: string | null; at?: Date },
  ): Promise<string | null> {
    const phone = this.normalizePhone(phoneNumber);
    if (!phone) return null;
    const at = opts.at ?? new Date();
    const snippet = opts.snippet ? opts.snippet.slice(0, 280) : null;
    try {
      const row = await this.prisma.client.whatsAppContact.upsert({
        where: { businessId_phoneNumber: { businessId, phoneNumber: phone } },
        create: {
          businessId,
          phoneNumber: phone,
          displayName: opts.displayName ?? null,
          contactId: opts.contactId ?? null,
          lastMessageAt: at,
          lastMessageSnippet: snippet,
        },
        update: {
          // Never overwrite a known name or CRM link with null.
          ...(opts.displayName ? { displayName: opts.displayName } : {}),
          ...(opts.contactId ? { contactId: opts.contactId } : {}),
          lastMessageAt: at,
          lastMessageSnippet: snippet,
        },
        select: { id: true },
      });
      return row.id;
    } catch (e) {
      this.logger.error(`Failed to upsert WhatsApp conversation: ${(e as Error).message}`);
      return null;
    }
  }

  /** Record one message against its conversation. */
  private async recordMessage(
    businessId: string,
    phoneNumber: string,
    data: {
      direction: 'INBOUND' | 'OUTBOUND';
      body?: string | null;
      status: string;
      displayName?: string | null;
      contactId?: string | null;
      templateName?: string | null;
      wamid?: string | null;
      errorMessage?: string | null;
      at?: Date;
    },
  ): Promise<void> {
    const at = data.at ?? new Date();
    const conversationId = await this.upsertConversation(businessId, phoneNumber, {
      displayName: data.displayName,
      contactId: data.contactId,
      snippet: data.body ?? data.templateName ?? null,
      at,
    });
    if (!conversationId) return;
    try {
      await this.prisma.client.whatsAppMessage.create({
        data: {
          businessId,
          whatsappContactId: conversationId,
          direction: data.direction,
          body: data.body ?? null,
          templateName: data.templateName ?? null,
          status: data.status,
          sentAt: data.direction === 'OUTBOUND' && data.status === 'SENT' ? at : null,
          wamid: data.wamid ?? null,
          errorMessage: data.errorMessage ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to record WhatsApp message: ${(e as Error).message}`);
    }
  }

  // ── Queries backing the manage drawer ──────────────────────────────────

  /** Whether WhatsApp is configured, and which number it sends from. */
  async getStatus(businessId: string) {
    const config = await this.getConfig(businessId);
    if (!config) return { connected: false as const };
    const platformId = config.phoneNumberId ?? config.fromNumber ?? '';
    return {
      connected: true as const,
      destination: {
        id: `${businessId}:whatsapp`,
        platformId,
        displayName: config.fromNumber ?? config.phoneNumberId ?? null,
      },
    };
  }

  async listConversations(businessId: string, limit = 100) {
    const rows = await this.prisma.client.whatsAppContact.findMany({
      where: { businessId },
      orderBy: { lastMessageAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      phoneNumber: r.phoneNumber,
      displayName: r.displayName ?? r.phoneNumber,
      contactId: r.contactId,
      lastMessageAt: r.lastMessageAt,
      lastMessageSnippet: r.lastMessageSnippet,
    }));
  }

  /**
   * One conversation with its messages.
   *
   * `withinWindow` is WhatsApp's 24-hour customer-service window: outside it
   * Meta rejects anything but an approved template, so the drawer uses this to
   * decide whether free-text reply is allowed.
   */
  async getConversation(businessId: string, conversationId: string) {
    const row = await this.prisma.client.whatsAppContact.findFirst({
      where: { id: conversationId, businessId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
    });
    if (!row) return null;
    const lastInbound = [...row.messages].reverse().find((m) => m.direction === 'INBOUND');
    const withinWindow = lastInbound
      ? Date.now() - new Date(lastInbound.createdAt).getTime() < 24 * 60 * 60 * 1000
      : false;
    return {
      id: row.id,
      phoneNumber: row.phoneNumber,
      displayName: row.displayName ?? row.phoneNumber,
      contactId: row.contactId,
      withinWindow,
      messages: row.messages.map((m) => ({
        id: m.id,
        direction: m.direction as 'INBOUND' | 'OUTBOUND',
        body: m.body,
        templateName: m.templateName,
        status: m.status,
        scheduledAt: m.scheduledAt,
        sentAt: m.sentAt,
        createdAt: m.createdAt,
        errorMessage: m.errorMessage,
      })),
    };
  }

  /**
   * Approved message templates from Meta.
   *
   * Returns `{ templates: [], error }` rather than throwing: the drawer renders
   * the conversation list even when template lookup fails, and templates are
   * unavailable by design on the twilio and mock providers.
   */
  async listTemplates(businessId: string): Promise<{ templates: WhatsAppTemplateSummary[]; error?: string }> {
    const config = await this.getConfig(businessId);
    if (!config) return { templates: [], error: 'WhatsApp not configured' };
    if (config.provider !== 'meta') {
      return { templates: [], error: `Templates are only available on the Meta provider (configured: ${config.provider})` };
    }
    const wabaId = (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
    if (!wabaId) return { templates: [], error: 'WHATSAPP_BUSINESS_ACCOUNT_ID is not set' };
    if (!config.accessToken) return { templates: [], error: 'No access token configured' };

    try {
      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaId)}/message_templates?limit=100`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${config.accessToken}` } });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { templates: [], error: `Meta API ${res.status}: ${detail.slice(0, 200)}` };
      }
      const json = (await res.json()) as { data?: MetaTemplate[] };
      const templates = (json.data ?? [])
        .filter((t) => (t.status ?? 'APPROVED').toUpperCase() === 'APPROVED')
        .map((t) => ({
          name: t.name,
          language: t.language,
          category: t.category,
          variableCount: countTemplateVariables(t),
        }));
      return { templates };
    } catch (e) {
      return { templates: [], error: (e as Error).message };
    }
  }

  async sendMessage(businessId: string, message: WhatsAppMessage): Promise<{ success: boolean; error?: string; messageId?: string }> {
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

    // Result is computed first, then recorded, so the conversation history
    // shows failed sends too — a message that never left is exactly what
    // someone opening the drawer needs to see.
    const result = await this.dispatchToProvider(config, to, message);

    await this.recordMessage(businessId, to, {
      direction: 'OUTBOUND',
      body: message.body ?? null,
      status: result.success ? 'SENT' : 'FAILED',
      templateName: message.templateName ?? null,
      wamid: result.messageId ?? null,
      errorMessage: result.success ? null : (result.error ?? null),
    });

    return result;
  }

  /**
   * The provider call on its own, with no persistence.
   *
   * Split out so `sendMessage` (which writes its own history row) and the
   * drawer's send path (which already created a row to update) can share one
   * dispatch without either double-recording the same message.
   */
  private async dispatchToProvider(
    config: WhatsAppConfig,
    to: string,
    message: WhatsAppMessage,
  ): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      if (config.provider === 'mock') {
        this.logger.log(`[MOCK WhatsApp] To: ${to}, Body: ${message.body.slice(0, 100)}`);
        return { success: true };
      }
      if (config.provider === 'twilio') return await this.sendViaTwilio(config, to, message);
      if (config.provider === 'meta') return await this.sendViaMeta(config, to, message);
      return { success: false, error: 'Unknown provider' };
    } catch (e) {
      this.logger.error(`Failed to send WhatsApp message: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * Send or schedule from the manage drawer.
   *
   * Returns the history row's id and status so the drawer can render the
   * message immediately, including when the send failed.
   */
  async sendFromDrawer(
    businessId: string,
    input: {
      toPhone: string;
      contactId?: string;
      body?: string;
      templateName?: string;
      templateLanguage?: string;
      templateParams?: string[];
      scheduledAt?: string;
    },
  ): Promise<{ id: string; status: string; error?: string }> {
    const to = this.normalizePhone(input.toPhone);
    if (!to) throw new BadRequestException('A valid phone number is required');
    if (!input.body?.trim() && !input.templateName) {
      throw new BadRequestException('Either body or templateName is required');
    }
    // @Body() is inline-typed and never stripped by a validation pipe, so
    // templateParams can arrive as any JSON. A non-array crashes toTemplateData,
    // and for a scheduled row that crash lands inside the dispatch cron — reject
    // it at the door.
    if (input.templateParams !== undefined && !Array.isArray(input.templateParams)) {
      throw new BadRequestException('templateParams must be an array of strings');
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (input.scheduledAt && Number.isNaN(scheduledAt?.getTime())) {
      throw new BadRequestException('scheduledAt is not a valid date');
    }
    const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now();

    // contactId is body-supplied and must be proven to belong to THIS business
    // before it is written onto the conversation. Otherwise a caller can link
    // their conversation to another tenant's Contact (a cross-tenant write), and
    // the 400-vs-200 difference on a foreign id leaks its existence. Drop an
    // unowned or unknown id rather than reject it, so no oracle remains.
    let contactId = input.contactId ?? null;
    if (contactId) {
      const owned = await this.prisma.client.contact.findFirst({
        where: { id: contactId, businessId, deletedAt: null },
        select: { id: true },
      });
      contactId = owned ? contactId : null;
    }

    const conversationId = await this.upsertConversation(businessId, to, {
      contactId,
      snippet: input.body ?? input.templateName ?? null,
      at: new Date(),
    });
    if (!conversationId) throw new BadRequestException('Could not open a conversation for that number');

    const row = await this.prisma.client.whatsAppMessage.create({
      data: {
        businessId,
        whatsappContactId: conversationId,
        direction: 'OUTBOUND',
        body: input.body ?? null,
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? null,
        templateParams: input.templateParams ?? undefined,
        status: isScheduled ? 'SCHEDULED' : 'SENDING',
        scheduledAt: isScheduled ? scheduledAt : null,
      },
      select: { id: true, status: true },
    });

    // Scheduled messages are picked up by dispatchScheduled() below; returning
    // here without sending is the whole point of the SCHEDULED state.
    if (isScheduled) return { id: row.id, status: row.status };

    const result = await this.deliverRow(businessId, row.id, to, {
      to,
      body: input.body ?? '',
      templateName: input.templateName,
      templateData: toTemplateData(input.templateParams),
    });
    return { id: row.id, status: result.status, error: result.error };
  }

  /** Deliver an existing history row and fold the outcome back into it. */
  private async deliverRow(
    businessId: string,
    messageId: string,
    to: string,
    message: WhatsAppMessage,
  ): Promise<{ status: string; error?: string }> {
    const config = await this.getConfig(businessId);
    if (!config) {
      await this.prisma.client.whatsAppMessage.update({
        where: { id: messageId },
        data: { status: 'FAILED', errorMessage: 'WhatsApp not configured' },
      });
      return { status: 'FAILED', error: 'WhatsApp not configured' };
    }
    const result = await this.dispatchToProvider(config, to, message);
    const status = result.success ? 'SENT' : 'FAILED';
    await this.prisma.client.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        status,
        sentAt: result.success ? new Date() : null,
        wamid: result.messageId ?? null,
        errorMessage: result.success ? null : (result.error ?? 'Send failed'),
      },
    });
    return { status, error: result.error };
  }

  /**
   * Send messages whose scheduled time has arrived.
   *
   * Without this the drawer's "schedule" control would write a SCHEDULED row
   * that nothing ever delivers — a button that appears to work and silently
   * does nothing, which is the failure mode this module already had once.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchScheduled(): Promise<void> {
    const due = await this.prisma.client.whatsAppMessage.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      include: { whatsappContact: { select: { phoneNumber: true } } },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
    });
    for (const msg of due) {
      // Claim the row first so a second instance of this cron cannot send the
      // same message twice; the count tells us whether we won the claim.
      const claimed = await this.prisma.client.whatsAppMessage.updateMany({
        where: { id: msg.id, status: 'SCHEDULED' },
        data: { status: 'SENDING' },
      });
      if (claimed.count === 0) continue;
      // One row must never abort the batch or strand itself in SENDING: a throw
      // here (bad stored data, provider error, config lookup) is caught, the row
      // is marked FAILED, and the loop moves on to the other tenants' messages.
      try {
        await this.deliverRow(msg.businessId, msg.id, msg.whatsappContact.phoneNumber, {
          to: msg.whatsappContact.phoneNumber,
          body: msg.body ?? '',
          templateName: msg.templateName ?? undefined,
          templateData: toTemplateData(msg.templateParams as string[] | null),
        });
      } catch (e) {
        this.logger.error(`Scheduled WhatsApp ${msg.id} failed to dispatch: ${(e as Error).message}`);
        await this.prisma.client.whatsAppMessage
          .update({
            where: { id: msg.id },
            data: { status: 'FAILED', errorMessage: ((e as Error).message ?? 'dispatch failed').slice(0, 500) },
          })
          .catch(() => undefined);
      }
    }
  }

  private async sendViaTwilio(
    config: WhatsAppConfig,
    to: string,
    message: WhatsAppMessage,
  ): Promise<{ success: boolean; error?: string; messageId?: string }> {
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

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { success: true, messageId: typeof data.sid === 'string' ? data.sid : undefined };
  }

  private async sendViaMeta(
    config: WhatsAppConfig,
    to: string,
    message: WhatsAppMessage,
  ): Promise<{ success: boolean; error?: string; messageId?: string }> {
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

    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
    return { success: true, messageId: data.messages?.[0]?.id };
  }

  private normalizePhone(phone: string): string | null {
    const cleaned = phone
      .replace(/^whatsapp:/i, '')
      .replace(/\s/g, '')
      .replace(/[-()]/g, '');
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

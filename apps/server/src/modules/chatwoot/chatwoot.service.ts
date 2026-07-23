import { forwardRef, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';

interface ChatwootWebhookPayload {
  event?: string;
  message_type?: string | number;
  private?: boolean;
  content?: string;
  conversation?: { id?: number; account_id?: number; inbox_id?: number; display_id?: number };
  account?: { id?: number };
  sender?: { type?: string; email?: string; name?: string };
  /** Agent-bot shape: the full conversation object with a messages array. */
  id?: number;
  account_id?: number;
  messages?: Array<{
    id?: number;
    content?: string;
    message_type?: number | string;
    private?: boolean;
    conversation_id?: number;
    sender?: { type?: string; email?: string; name?: string };
  }>;
}

/**
 * Chatwoot L1 desk bridge: inbound customer messages from the Chatwoot agent
 * bot webhook are answered by KEY (support persona via the flow orchestrator,
 * per-conversation session continuity), and KEY's reply is posted back into
 * the conversation through the Chatwoot API.
 *
 * Configuration (env):
 *   CHATWOOT_URL             — desk base URL (default http://localhost:3100)
 *   CHATWOOT_API_TOKEN       — agent bot access token
 *   CHATWOOT_ACCOUNT_ID      — Chatwoot account id
 *   CHATWOOT_BUSINESS_ID     — KEYFLOWOS business the desk serves
 *   CHATWOOT_WEBHOOK_SECRET  — shared secret embedded in the webhook path
 */
@Injectable()
export class ChatwootService {
  private readonly logger = new Logger(ChatwootService.name);

  constructor(
    @Inject(forwardRef(() => FlowOrchestratorService))
    private readonly flow: FlowOrchestratorService,
  ) {}

  private get baseUrl() { return (process.env.CHATWOOT_URL ?? 'http://localhost:3100').replace(/\/$/, ''); }
  private get apiToken() { return process.env.CHATWOOT_API_TOKEN; }
  private get accountId() { return process.env.CHATWOOT_ACCOUNT_ID; }
  private get businessId() { return process.env.CHATWOOT_BUSINESS_ID; }
  private get webhookSecret() { return process.env.CHATWOOT_WEBHOOK_SECRET; }

  isConfigured(): boolean {
    return !!(this.apiToken && this.accountId && this.businessId && this.webhookSecret);
  }

  /** Chatwoot sends message_type as 0/1 on some events and 'incoming'/'outgoing' on others. */
  private isInbound(messageType: string | number | undefined): boolean {
    return messageType === 0 || messageType === '0' || messageType === 'incoming';
  }

  assertWebhookSecret(secret: string | undefined) {
    if (!this.webhookSecret || !secret || secret !== this.webhookSecret) {
      throw new UnauthorizedException('Invalid Chatwoot webhook secret');
    }
  }

  async sendMessage(conversationId: number, content: string): Promise<void> {
    if (!this.isConfigured()) return;
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_access_token: this.apiToken! },
      body: JSON.stringify({ content, message_type: 'outgoing' }),
    });
    if (!res.ok) {
      this.logger.warn(`Chatwoot sendMessage failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }

  /**
   * Handle an agent-bot webhook payload. Chatwoot sends two shapes: inbox
   * webhooks are flat `{event: 'message_created', ...}` events, while agent
   * bot webhooks deliver the conversation object with a `messages` array —
   * both are normalized here. Only inbound, non-private messages are
   * answered; everything else is ignored so KEY never talks to itself.
   */
  async handleWebhook(payload: ChatwootWebhookPayload): Promise<{ handled: boolean; reason?: string }> {
    if (!this.isConfigured()) return { handled: false, reason: 'chatwoot not configured' };
    this.logger.debug(
      `webhook payload: keys=[${Object.keys(payload ?? {}).join(',')}] ` +
        `event=${payload?.event ?? 'n/a'} messages=${Array.isArray(payload?.messages) ? payload.messages.length : 'n/a'} ` +
        `firstMsgType=${payload?.messages?.[0]?.message_type ?? payload?.message_type ?? 'n/a'}`,
    );

    // Normalize both webhook shapes into a single inbound message view.
    let content: string;
    let conversationId: number | undefined;
    let sender: ChatwootWebhookPayload['sender'];

    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      // Agent-bot shape: answer the newest inbound message in the payload.
      const inbound = [...payload.messages]
        .filter((m) => this.isInbound(m.message_type) && !m.private && (m.content ?? '').trim())
        .pop();
      if (!inbound) return { handled: false, reason: 'no inbound message in payload' };
      content = (inbound.content ?? '').trim();
      conversationId = inbound.conversation_id ?? payload.conversation?.id ?? payload.id;
      sender = inbound.sender ?? payload.sender;
    } else {
      if (payload.event !== 'message_created') return { handled: false, reason: 'not a message event' };
      if (!this.isInbound(payload.message_type)) return { handled: false, reason: 'not inbound' };
      if (payload.private) return { handled: false, reason: 'private note' };
      content = (payload.content ?? '').trim();
      conversationId = payload.conversation?.id;
      sender = payload.sender;
    }

    if (!content || !conversationId) return { handled: false, reason: 'empty' };

    const businessId = this.businessId!;
    const sessionId = `chatwoot-conv-${conversationId}`;
    const customer = sender?.name || sender?.email || 'the customer';

    this.logger.log(`Chatwoot conv ${conversationId}: inbound from ${customer} (${content.length} chars)`);

    try {
      const result = await this.flow.chat(
        businessId,
        `You are KEY, the front-line support agent for this business, answering in a customer support desk widget. ` +
          `The customer (${customer}) wrote: "${content}". ` +
          `Reply helpfully and concisely as support — do not expose internal IDs or internal tooling. ` +
          `If you cannot resolve it, say a human teammate will follow up and use the appropriate tool to flag it.`,
        [],
        undefined,
        { route: '/app/helpdesk', surface: 'helpdesk' } as never,
        undefined,
        undefined,
        sessionId,
      );
      const reply = (result?.reply ?? '').trim();
      if (reply) {
        await this.sendMessage(conversationId, reply);
      }
      return { handled: true };
    } catch (err) {
      this.logger.error(`KEY reply failed for conv ${conversationId}: ${(err as Error).message}`);
      await this.sendMessage(conversationId, 'Thanks for reaching out — a teammate will follow up shortly.');
      return { handled: true };
    }
  }
}

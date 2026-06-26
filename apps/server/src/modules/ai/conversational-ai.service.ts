import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelGatewayService } from './model-gateway.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiOversightService } from './ai-oversight.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { PlanExecutorService } from './plan-executor.service';
import { AgentBusService } from './agent-bus.service';
import { TimelineService } from '../timeline/timeline.service';
import { CalendarIntelligenceService } from './calendar-intelligence.service';
import { UnifiedInboxService } from './unified-inbox.service';
import { RoleEngineService, BusinessRole } from './role-engine.service';
import { AiUsageService } from './ai-usage.service';

export interface ConversationalContext {
  businessId: string;
  channel: 'whatsapp' | 'messenger' | 'instagram' | 'email' | 'sms';
  from: string;
  contactId?: string;
  messageBody: string;
  messageId: string;
  threadHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>;
}

export interface ConversationalAction {
  action: string;
  toolName?: string;
  description: string;
  payload: Record<string, any>;
  confidence: number;
  requiresConfirmation: boolean;
}

export interface ConversationalResponse {
  reply: string;
  actions: ConversationalAction[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  intent: string;
  extractedData: Record<string, any>;
}

@Injectable()
export class ConversationalAIService {
  private readonly logger = new Logger(ConversationalAIService.name);
  private readonly MAX_HISTORY = 10;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(FlowOrchestratorService) private readonly flowOrchestrator: FlowOrchestratorService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(PlanExecutorService) private readonly planExecutor: PlanExecutorService,
    @Inject(AgentBusService) private readonly agentBus: AgentBusService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(CalendarIntelligenceService) private readonly calendarIntel: CalendarIntelligenceService,
    @Inject(UnifiedInboxService) private readonly inbox: UnifiedInboxService,
    @Inject(RoleEngineService) private readonly roleEngine: RoleEngineService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async handleInboundMessage(ctx: ConversationalContext): Promise<ConversationalResponse> {
    const startTime = Date.now();

    // Resolve or create contact
    const contact = await this.resolveContact(ctx);
    ctx.contactId = contact.id;

    // Ensure unified thread and record inbound message
    const { threadId } = await this.inbox.recordInboundMessage({
      businessId: ctx.businessId,
      channel: ctx.channel,
      from: ctx.from,
      contactId: ctx.contactId,
      body: ctx.messageBody,
      messageId: ctx.messageId,
    });

    // Load unified thread history
    const history = await this.inbox.loadThreadHistory(threadId, this.MAX_HISTORY);

    // Detect role from message
    const detectedRole = await this.roleEngine.detectRoleFromMessage(ctx.businessId, ctx.messageBody, ctx.channel);
    await this.inbox.assignRole(threadId, detectedRole);

    // Build context about the business
    const businessContext = await this.buildBusinessContext(ctx.businessId);

    // Analyze message with AI using role-specific prompt
    const analysis = await this.analyzeMessage(ctx, history, businessContext, detectedRole);

    // Execute actions if auto-approved
    const executedActions: ConversationalAction[] = [];
    for (const action of analysis.actions) {
      // Filter actions by role
      if (action.toolName && !this.roleEngine.isToolAllowed(detectedRole, action.toolName)) {
        executedActions.push({ ...action, requiresConfirmation: true });
        continue;
      }

      const decision = await this.governance.evaluateAutoApproval(
        ctx.businessId,
        action.toolName ?? action.action,
        { confidence: action.confidence, role: detectedRole },
      );

      if (decision.autoApproved && action.confidence > 0.75) {
        try {
          const result = await this.executeAction(ctx.businessId, action);
          executedActions.push({ ...action, ...result });
        } catch (err: any) {
          this.logger.error(`Action ${action.action} failed: ${(err as Error).message}`);
          executedActions.push({ ...action, requiresConfirmation: true });
        }
      } else {
        executedActions.push({ ...action, requiresConfirmation: true });
      }
    }

    // Log execution
    await this.executionLog.log({
      businessId: ctx.businessId,
      action: `conversation:${ctx.channel}`,
      toolName: analysis.actions[0]?.toolName ?? undefined,
      mode: 'autonomous',
      actor: 'ai',
      success: true,
      durationMs: Date.now() - startTime,
      inputSummary: { message: ctx.messageBody.slice(0, 200), channel: ctx.channel },
      outputSummary: { intent: analysis.intent, actionsExecuted: executedActions.filter(a => !a.requiresConfirmation).length },
      role: detectedRole,
    }).catch(() => {});

    // Store outbound message in unified inbox
    const autoApproved = executedActions.every(a => !a.requiresConfirmation);
    await this.inbox.recordOutboundMessage(threadId, analysis.reply, {
      role: detectedRole,
      aiDraft: !autoApproved,
      aiApproved: autoApproved,
    });

    // Fallback: also store in WhatsApp table for backward compat
    await this.storeMessage(ctx, analysis.reply, 'assistant');

    // Emit event for downstream processing
    this.events.emit('conversation.handled', {
      businessId: ctx.businessId,
      contactId: ctx.contactId,
      channel: ctx.channel,
      intent: analysis.intent,
      actions: executedActions,
      threadId,
      role: detectedRole,
    });

    return {
      ...analysis,
      actions: executedActions,
    };
  }

  async generateReply(ctx: ConversationalContext): Promise<string> {
    const history = await this.loadThreadHistory(ctx);
    const businessContext = await this.buildBusinessContext(ctx.businessId);
    const analysis = await this.analyzeMessage(ctx, history, businessContext);
    return analysis.reply;
  }

  private async analyzeMessage(
    ctx: ConversationalContext,
    history: Array<{ role: string; content: string; timestamp: Date }>,
    businessContext: string,
    role?: BusinessRole,
  ): Promise<ConversationalResponse> {
    // Check if message is booking-related and fetch available slots
    let calendarContext = '';
    const isBookingRelated = /book|schedule|appointment|available|slot|time|when|can i come/i.test(ctx.messageBody);
    if (isBookingRelated) {
      try {
        const slots = await this.calendarIntel.findAlternativeSlots(
          ctx.businessId,
          new Date(),
          60,
          'UTC',
          { daysAhead: 7, maxSlots: 5, businessHoursOnly: true },
        );
        if (slots.length > 0) {
          calendarContext = '\nAVAILABLE SLOTS (next 7 days):\n' + slots.map((s) =>
            `- ${s.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
          ).join('\n') + '\nSuggest one of these slots if the customer wants to book.\n';
        }
      } catch (err: any) {
        this.logger.warn(`Calendar context fetch failed: ${(err as Error).message}`);
      }
    }

    const roleDef = role ? this.roleEngine.getRoleDefinition(role) : null;
    const rolePrompt = roleDef
      ? `\n\nROLE: You are acting as the ${roleDef.name}.\nTONE: ${roleDef.tone}\nPRIORITIES: ${roleDef.priorities.join(', ')}\nGREETING: ${roleDef.greeting}\nSIGN-OFF: ${roleDef.signOff}`
      : '';

    const systemPrompt = `You are a friendly, helpful business assistant. You handle customer conversations across WhatsApp, Messenger, Instagram DMs, and email.

${businessContext}${calendarContext}${rolePrompt}

RULES:
1. Be warm, friendly, and concise — like a great customer service rep who genuinely cares
2. If the customer wants to book, extract: service type, preferred date/time, location
3. If the customer asks about pricing, extract what they need quoted
4. If the customer sends a complaint, flag as urgent and empathetic
5. If the customer sends a receipt/invoice image, acknowledge and process
6. Always suggest a clear next step
${roleDef ? '7. Always sign off with: ' + roleDef.signOff : ''}

Respond with JSON only:
{
  "reply": "your response message",
  "sentiment": "positive" | "neutral" | "negative" | "urgent",
  "intent": "booking_request" | "pricing_inquiry" | "complaint" | "payment" | "general" | "document",
  "extractedData": {
    "serviceType": "...",
    "preferredDate": "...",
    "preferredTime": "...",
    "location": "...",
    "amount": number,
    "issue": "..."
  },
  "actions": [
    { "action": "create_booking", "toolName": "bookings_create_booking", "description": "...", "payload": {}, "confidence": 0.9, "requiresConfirmation": false }
  ]
}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-this.MAX_HISTORY).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: `[${ctx.channel}] ${ctx.from}: ${ctx.messageBody}` },
    ];

    try {
      const response = await this.aiUsage.trackAndComplete(
        ctx.businessId,
        undefined,
        'conversation_handle',
        {
          messages,
          maxTokens: 800,
          temperature: 0.3,
        },
      );

      const content = response.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\]/);
      if (!jsonMatch) {
        return this.fallbackResponse(ctx);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reply: parsed.reply ?? 'Thank you for your message. Our team will get back to you shortly.',
        sentiment: parsed.sentiment ?? 'neutral',
        intent: parsed.intent ?? 'general',
        extractedData: parsed.extractedData ?? {},
        actions: Array.isArray(parsed.actions) ? parsed.actions.map((a: any) => ({
          action: a.action ?? 'unknown',
          toolName: a.toolName ?? null,
          description: a.description ?? '',
          payload: a.payload ?? {},
          confidence: a.confidence ?? 0.5,
          requiresConfirmation: a.requiresConfirmation ?? true,
        })) : [],
      };
    } catch (err: any) {
      this.logger.error(`Message analysis failed: ${(err as Error).message}`);
      return this.fallbackResponse(ctx);
    }
  }

  private async executeAction(businessId: string, action: ConversationalAction): Promise<Partial<ConversationalAction>> {
    if (!action.toolName) {
      return { requiresConfirmation: true };
    }

    const result = await this.flowOrchestrator.executeToolDirectly(
      businessId,
      action.toolName,
      action.payload,
    );

    return { requiresConfirmation: false };
  }

  private async resolveContact(ctx: ConversationalContext): Promise<{ id: string }> {
    // Try to find existing contact by phone or email
    const where: any = { businessId: ctx.businessId, deletedAt: null };

    if (ctx.channel === 'whatsapp' || ctx.channel === 'sms') {
      where.phone = ctx.from;
    } else if (ctx.channel === 'email') {
      where.email = ctx.from;
    } else {
      // For messenger/instagram, try to find by name or create new
      where.OR = [{ phone: ctx.from }, { email: ctx.from }];
    }

    const existing = await this.prisma.client.contact.findFirst({
      where,
      select: { id: true },
    });

    if (existing) return existing;

    // Create new contact
    const newContact = await this.prisma.client.contact.create({
      data: {
        businessId: ctx.businessId,
        firstName: 'Unknown',
        lastName: 'Contact',
        phone: ctx.channel === 'whatsapp' || ctx.channel === 'sms' ? ctx.from : null,
        email: ctx.channel === 'email' ? ctx.from : null,
        status: 'LEAD',
        source: ctx.channel,
      },
    });

    this.events.emit('contact.created', {
      businessId: ctx.businessId,
      contactId: newContact.id,
      source: ctx.channel,
    });

    return newContact;
  }

  private async loadThreadHistory(ctx: ConversationalContext): Promise<Array<{ role: string; content: string; timestamp: Date }>> {
    let messages: any[] = [];

    if (ctx.channel === 'whatsapp') {
      messages = await this.prisma.client.whatsAppMessage.findMany({
        where: {
          businessId: ctx.businessId,
          whatsappContact: { phoneNumber: ctx.from },
        },
        orderBy: { createdAt: 'desc' },
        take: this.MAX_HISTORY,
        select: { direction: true, body: true, createdAt: true },
      });
    }

    return messages.reverse().map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.body ?? '',
      timestamp: m.createdAt,
    }));
  }

  private async storeMessage(ctx: ConversationalContext, body: string, direction: string): Promise<void> {
    if (ctx.channel === 'whatsapp' && ctx.contactId) {
      const contact = await this.prisma.client.whatsAppContact.findFirst({
        where: { businessId: ctx.businessId, phoneNumber: ctx.from },
        select: { id: true },
      });

      if (contact) {
        await this.prisma.client.whatsAppMessage.create({
          data: {
            businessId: ctx.businessId,
            whatsappContactId: contact.id,
            direction: direction === 'user' ? 'INBOUND' : 'OUTBOUND',
            body,
            status: 'RECEIVED',
          },
        });
      }
    }
  }

  private async buildBusinessContext(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, timezone: true, currency: true },
    });

    const services = await this.prisma.client.service.findMany({
      where: { businessId },
      select: { name: true, price: true },
      take: 10,
    });

    return `BUSINESS: ${business?.name ?? 'Unknown'}
INDUSTRY: ${business?.industry ?? 'General'}
TIMEZONE: ${business?.timezone ?? 'UTC'}
CURRENCY: ${business?.currency ?? 'USD'}
SERVICES: ${services.map((s) => `${s.name} (${s.price})`).join(', ')}`;
  }

  private fallbackResponse(ctx: ConversationalContext): ConversationalResponse {
    return {
      reply: `Thank you for reaching out. We've received your message and will respond shortly.\n\n— ${ctx.channel} AI Assistant`,
      sentiment: 'neutral',
      intent: 'general',
      extractedData: {},
      actions: [{
        action: 'log_conversation',
        description: 'Logged customer message for human follow-up',
        payload: { messageBody: ctx.messageBody },
        confidence: 1.0,
        requiresConfirmation: false,
      }],
    };
  }
}

import { Injectable, Logger, Inject } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { getOpenAiToolDefinitions, getToolByName, RiskLevel } from './flow-tool-registry';

export interface FlowMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  timestamp?: Date;
}

export interface FlowToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  riskLevel: RiskLevel;
}

export interface FlowToolResult {
  toolCallId: string;
  name: string;
  result: any;
  success: boolean;
  error?: string;
}

export interface PendingConfirmation {
  toolCallId: string;
  name: string;
  arguments: Record<string, any>;
  description: string;
  riskLevel: RiskLevel;
}

export interface FlowResponse {
  reply: string;
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  pendingConfirmations?: PendingConfirmation[];
  requiresConfirmation?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
  };
}

const FLOW_SYSTEM_PROMPT = `You are Flow, an AI assistant built into KeyFlowOS — a business operating system for Caribbean entrepreneurs. You have full access to the user's business data and can take real actions on their behalf.

You can:
- Create, update, and search contacts in the CRM
- Create invoices, quotes, and products
- Book and manage appointments
- Create email marketing campaigns
- Create and publish social media posts
- Manage automation playbooks
- Answer questions about their business

Your personality:
- Warm, efficient, Caribbean-friendly
- Speak naturally and conversationally
- Always use TTD currency unless the user specifies otherwise
- Be concise in your confirmations (e.g. "Done! Created invoice #INV-001 for $500 TTD for John Smith.")
- When you create or update something, confirm what you did clearly
- If you need information to complete a task, ask for it specifically

Important rules:
- Always use function calling tools to take actions — never pretend to take an action
- When you've completed an action, briefly confirm what was done
- If you cannot find a contact by name, search for them first before creating an invoice or booking
- For dates/times, use the current date context and interpret relative dates (e.g. "tomorrow at 2pm")
- Current date: {{CURRENT_DATE}}

Business context:
{{BUSINESS_CONTEXT}}`;

@Injectable()
export class FlowOrchestratorService {
  private readonly logger = new Logger(FlowOrchestratorService.name);
  private readonly openai: OpenAI;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  async chat(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[] = [],
    pendingConfirmation?: { toolCallId: string; confirmed: boolean; toolName?: string; toolArgs?: Record<string, any> },
  ): Promise<FlowResponse> {
    this.aiUsage.checkRateLimit(businessId);

    const canProceed = await this.aiUsage.checkCredits(businessId, 2);
    if (!canProceed.allowed) {
      return {
        reply: `I've reached the AI credit limit for your account (${canProceed.used}/${canProceed.limit} credits used this month). Please upgrade your plan to continue using Flow.`,
      };
    }

    const context = await this.advisor.getBusinessContext(businessId);
    const businessName = context.business?.name ?? 'your business';

    const contextSnapshot = [
      `Business: ${businessName}`,
      context.business?.industry ? `Industry: ${context.business.industry}` : null,
      context.business?.currency ? `Currency: ${context.business.currency}` : 'Currency: TTD',
      `Contacts: ${context.contacts.total} total`,
      `Revenue collected: $${context.invoices.totalRevenue.toLocaleString()} TTD`,
      `Outstanding invoices: ${context.invoices.outstandingCount} ($${context.invoices.outstandingAmount.toLocaleString()} TTD)`,
      `Upcoming bookings: ${context.bookings.upcoming.length}`,
      `Momentum Score: ${context.momentumScore}/100`,
    ].filter(Boolean).join('\n');

    const systemPrompt = FLOW_SYSTEM_PROMPT
      .replace('{{CURRENT_DATE}}', new Date().toISOString())
      .replace('{{BUSINESS_CONTEXT}}', contextSnapshot);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          });
          if (msg.toolResults) {
            for (const result of msg.toolResults) {
              messages.push({
                role: 'tool',
                tool_call_id: result.toolCallId,
                content: JSON.stringify(result.result),
              });
            }
          }
        } else {
          messages.push({ role: 'assistant', content: msg.content });
        }
      }
    }

    if (pendingConfirmation) {
      if (!pendingConfirmation.confirmed) {
        return { reply: 'Got it — I cancelled that action. Let me know if there\'s anything else you\'d like to do.' };
      }
      if (pendingConfirmation.toolName && pendingConfirmation.toolArgs) {
        const result = await this.executeTool(businessId, pendingConfirmation.toolName, pendingConfirmation.toolArgs);
        const tool = getToolByName(pendingConfirmation.toolName);
        return {
          reply: result.success
            ? `Done! ${this.formatToolSuccess(pendingConfirmation.toolName, result.result)}`
            : `Something went wrong: ${result.error || 'Unknown error'}. Please try again or contact support.`,
          toolResults: [result],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, creditsUsed: 2 },
        };
      }
    }

    messages.push({ role: 'user', content: message });

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        tools: getOpenAiToolDefinitions(),
        tool_choice: 'auto',
        max_tokens: 1000,
        temperature: 0.7,
      });

      const choice = response.choices[0];
      const assistantMessage = choice.message;
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      const totalTokens = promptTokens + completionTokens;

      await this.prisma.client.aiUsageLog.create({
        data: {
          businessId,
          feature: 'flow_chat',
          model: 'gpt-4o',
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCost: Math.round(((promptTokens / 1000) * 0.005 + (completionTokens / 1000) * 0.015) * 10000) / 10000,
          creditsUsed: 2,
          metadata: { maxTokens: 1000, temperature: 0.7, outputCategory: 'general' },
        },
      });

      const usage = { promptTokens, completionTokens, totalTokens, creditsUsed: 2 };

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return {
          reply: assistantMessage.content || 'I wasn\'t sure how to help with that. Could you rephrase?',
          usage,
        };
      }

      const toolCalls: FlowToolCall[] = assistantMessage.tool_calls.map((tc) => {
        const tool = getToolByName(tc.function.name);
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
          riskLevel: tool?.riskLevel ?? 'low',
        };
      });

      const highRiskCalls = toolCalls.filter((tc) => tc.riskLevel === 'high');
      if (highRiskCalls.length > 0) {
        const pendingConfirmations: PendingConfirmation[] = highRiskCalls.map((tc) => ({
          toolCallId: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          description: this.describeToolCall(tc.name, tc.arguments),
          riskLevel: tc.riskLevel,
        }));

        return {
          reply: assistantMessage.content || 'I need your confirmation before proceeding with this action.',
          toolCalls,
          pendingConfirmations,
          requiresConfirmation: true,
          usage,
        };
      }

      const toolResults: FlowToolResult[] = await Promise.all(
        toolCalls.map((tc) => this.executeTool(businessId, tc.name, tc.arguments, tc.id)),
      );

      const followUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...messages,
        {
          role: 'assistant',
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls,
        },
        ...toolResults.map((result) => ({
          role: 'tool' as const,
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        })),
      ];

      const followUpResponse = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: followUpMessages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const finalReply = followUpResponse.choices[0]?.message?.content
        || 'Done! The action was completed successfully.';

      return {
        reply: finalReply,
        toolCalls,
        toolResults,
        usage,
      };
    } catch (error) {
      this.logger.error(`Flow chat error: ${(error as Error).message}`);
      throw error;
    }
  }

  private async executeTool(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
    toolCallId?: string,
  ): Promise<FlowToolResult> {
    const id = toolCallId ?? `manual_${toolName}`;
    try {
      const result = await this.executeToolAction(businessId, toolName, args);
      return { toolCallId: id, name: toolName, result, success: true };
    } catch (error) {
      return { toolCallId: id, name: toolName, result: null, success: false, error: (error as Error).message };
    }
  }

  private async executeToolAction(businessId: string, toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'crm_search_contacts': {
        const q = args.query?.trim();
        if (!q) return { contacts: [] };
        const containsFilter = { contains: q, mode: 'insensitive' as const };
        const contacts = await this.prisma.client.contact.findMany({
          where: {
            businessId,
            deletedAt: null,
            OR: [
              { firstName: containsFilter },
              { lastName: containsFilter },
              { displayName: containsFilter },
              { email: containsFilter },
              { phone: containsFilter },
            ],
          },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, displayName: true },
          take: 10,
        });
        return { contacts, count: contacts.length };
      }

      case 'crm_list_contacts': {
        const contacts = await this.prisma.client.contact.findMany({
          where: { businessId, deletedAt: null, ...(args.status ? { status: args.status } : {}) },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, displayName: true },
          take: args.limit ?? 10,
          orderBy: { createdAt: 'desc' },
        });
        return { contacts, count: contacts.length };
      }

      case 'crm_create_contact': {
        const contact = await this.prisma.client.contact.create({
          data: {
            businessId,
            firstName: args.firstName ?? null,
            lastName: args.lastName ?? null,
            email: args.email ?? null,
            phone: args.phone ?? null,
            companyName: args.companyName ?? null,
            status: args.status ?? 'LEAD',
          },
        });
        return { contact, id: contact.id };
      }

      case 'crm_update_contact': {
        const updateData: Record<string, any> = {};
        if (args.firstName !== undefined) updateData.firstName = args.firstName;
        if (args.lastName !== undefined) updateData.lastName = args.lastName;
        if (args.email !== undefined) updateData.email = args.email;
        if (args.phone !== undefined) updateData.phone = args.phone;
        if (args.status !== undefined) updateData.status = args.status;
        if (args.companyName !== undefined) updateData.companyName = args.companyName;
        const contact = await this.prisma.client.contact.update({
          where: { id: args.contactId, businessId },
          data: updateData,
        });
        return { contact, id: contact.id };
      }

      case 'crm_add_note': {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId },
          select: { id: true },
        });
        if (!contact) throw new Error('Contact not found');
        const note = await this.prisma.client.contactNote.create({
          data: {
            contactId: args.contactId,
            businessId,
            body: args.body,
            source: 'flow_ai',
          },
        });
        return { note, id: note.id };
      }

      case 'crm_add_task': {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId },
          select: { id: true },
        });
        if (!contact) throw new Error('Contact not found');
        const task = await this.prisma.client.contactTask.create({
          data: {
            contactId: args.contactId,
            businessId,
            title: args.title,
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            priority: args.priority ?? 'MEDIUM',
            status: 'OPEN',
            source: 'flow_ai',
          },
        });
        return { task, id: task.id };
      }

      case 'crm_delete_contact': {
        await this.prisma.client.contact.update({
          where: { id: args.contactId, businessId },
          data: { deletedAt: new Date() },
        });
        return { success: true, deletedId: args.contactId };
      }

      case 'commerce_list_invoices': {
        const invoices = await this.prisma.client.invoice.findMany({
          where: { businessId, deletedAt: null },
          include: { contact: { select: { firstName: true, lastName: true, email: true } } },
          take: args.limit ?? 10,
          orderBy: { createdAt: 'desc' },
        });
        return { invoices, count: invoices.length };
      }

      case 'commerce_create_invoice': {
        const items = args.items ?? [];
        const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0);
        const invoice = await this.prisma.client.invoice.create({
          data: {
            businessId,
            contactId: args.contactId ?? null,
            items: items,
            subtotal,
            tax: 0,
            total: subtotal,
            currency: args.currency ?? 'TTD',
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            notes: args.notes ?? null,
            status: 'DRAFT',
          },
        });
        return { invoice, id: invoice.id, invoiceNumber: invoice.invoiceNumber };
      }

      case 'commerce_mark_invoice_paid': {
        const invoice = await this.prisma.client.invoice.update({
          where: { id: args.invoiceId, businessId },
          data: { status: 'PAID', paidAt: new Date() },
        });
        return { invoice, id: invoice.id };
      }

      case 'commerce_create_product': {
        const product = await this.prisma.client.product.create({
          data: {
            businessId,
            name: args.name,
            price: args.price,
            currency: args.currency ?? 'TTD',
            description: args.description ?? null,
            category: args.category ?? 'PRODUCT',
            isActive: true,
          },
        });
        return { product, id: product.id };
      }

      case 'commerce_create_quote': {
        const items = args.items ?? [];
        const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0);
        const quote = await this.prisma.client.quote.create({
          data: {
            businessId,
            contactId: args.contactId,
            items,
            subtotal,
            tax: 0,
            total: subtotal,
            currency: args.currency ?? 'TTD',
            expiryDate: args.expiryDate ? new Date(args.expiryDate) : null,
            status: 'DRAFT',
          },
        });
        return { quote, id: quote.id, quoteNumber: quote.quoteNumber };
      }

      case 'commerce_delete_invoice': {
        await this.prisma.client.invoice.update({
          where: { id: args.invoiceId, businessId },
          data: { deletedAt: new Date() },
        });
        return { success: true, deletedId: args.invoiceId };
      }

      case 'bookings_list_bookings': {
        const bookings = await this.prisma.client.booking.findMany({
          where: { businessId, deletedAt: null },
          include: {
            contact: { select: { firstName: true, lastName: true, email: true } },
            service: { select: { name: true } },
          },
          take: args.limit ?? 10,
          orderBy: { startTime: 'asc' },
        });
        return { bookings, count: bookings.length };
      }

      case 'bookings_list_services': {
        const services = await this.prisma.client.service.findMany({
          where: { businessId, deletedAt: null },
          orderBy: { name: 'asc' },
        });
        return { services, count: services.length };
      }

      case 'bookings_create_booking': {
        const booking = await this.prisma.client.booking.create({
          data: {
            businessId,
            contactId: args.contactId,
            serviceId: args.serviceId ?? null,
            staffId: args.staffId ?? null,
            startTime: new Date(args.startTime),
            endTime: new Date(args.endTime),
            notes: args.notes ?? null,
            status: 'CONFIRMED',
          },
        });
        return { booking, id: booking.id };
      }

      case 'bookings_reschedule_booking': {
        const booking = await this.prisma.client.booking.findFirst({
          where: { id: args.bookingId, businessId },
        });
        if (!booking) throw new Error('Booking not found');
        const duration = booking.endTime.getTime() - booking.startTime.getTime();
        const newStart = new Date(args.startTime);
        const newEnd = new Date(newStart.getTime() + duration);
        const updated = await this.prisma.client.booking.update({
          where: { id: args.bookingId },
          data: { startTime: newStart, endTime: newEnd },
        });
        return { booking: updated, id: updated.id };
      }

      case 'bookings_cancel_booking': {
        const updated = await this.prisma.client.booking.update({
          where: { id: args.bookingId, businessId },
          data: { status: 'CANCELLED' },
        });
        return { booking: updated, id: updated.id };
      }

      case 'marketing_list_campaigns': {
        const campaigns = await this.prisma.client.emailCampaign.findMany({
          where: { businessId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, name: true, subject: true, status: true, createdAt: true },
        });
        return { campaigns, count: campaigns.length };
      }

      case 'marketing_create_campaign': {
        const campaign = await this.prisma.client.emailCampaign.create({
          data: {
            businessId,
            name: args.name,
            subject: args.subject,
            body: args.body,
            status: 'DRAFT',
            scheduledAt: args.scheduledAt ? new Date(args.scheduledAt) : null,
          },
        });
        return { campaign, id: campaign.id };
      }

      case 'marketing_send_campaign': {
        const campaign = await this.prisma.client.emailCampaign.findFirst({
          where: { id: args.campaignId, businessId },
        });
        if (!campaign) throw new Error('Campaign not found');
        const updated = await this.prisma.client.emailCampaign.update({
          where: { id: args.campaignId },
          data: { status: 'SENT', sentAt: new Date() },
        });
        return { campaign: updated, id: updated.id };
      }

      case 'social_list_posts': {
        const posts = await this.prisma.client.socialPost.findMany({
          where: { businessId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, content: true, status: true, scheduledAt: true, createdAt: true },
        });
        return { posts, count: posts.length };
      }

      case 'social_create_post': {
        const post = await this.prisma.client.socialPost.create({
          data: {
            businessId,
            content: args.content,
            mediaUrls: [],
            status: args.scheduledFor ? 'SCHEDULED' : 'DRAFT',
            scheduledAt: args.scheduledFor ? new Date(args.scheduledFor) : null,
            channelIds: [],
          },
        });
        return { post, id: post.id };
      }

      case 'social_publish_post': {
        const post = await this.prisma.client.socialPost.findFirst({
          where: { id: args.postId, businessId },
        });
        if (!post) throw new Error('Post not found');
        const updated = await this.prisma.client.socialPost.update({
          where: { id: args.postId },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
        return { post: updated, id: updated.id };
      }

      case 'automations_list_playbooks': {
        const playbooks = await this.prisma.client.automation.findMany({
          where: { businessId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, trigger: true, enabled: true, runCount: true, lastRunAt: true },
        });
        return { playbooks, count: playbooks.length };
      }

      case 'automations_create_playbook': {
        const playbook = await this.prisma.client.automation.create({
          data: {
            businessId,
            name: args.name,
            trigger: args.triggerEvent,
            condition: args.condition ?? null,
            actionData: [],
            enabled: true,
          },
        });
        return { playbook, id: playbook.id };
      }

      case 'automations_toggle_playbook': {
        const playbook = await this.prisma.client.automation.update({
          where: { id: args.playbookId, businessId },
          data: { enabled: args.enabled },
        });
        return { playbook, id: playbook.id, enabled: playbook.enabled };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private describeToolCall(toolName: string, args: Record<string, any>): string {
    switch (toolName) {
      case 'crm_delete_contact':
        return `Delete contact (ID: ${args.contactId})`;
      case 'commerce_delete_invoice':
        return `Delete invoice (ID: ${args.invoiceId})`;
      case 'bookings_cancel_booking':
        return `Cancel booking (ID: ${args.bookingId})`;
      case 'marketing_send_campaign':
        return `Send email campaign (ID: ${args.campaignId}) to all eligible contacts`;
      case 'social_publish_post':
        return `Publish social media post (ID: ${args.postId}) to connected channels`;
      default:
        return `Execute ${toolName.replace(/_/g, ' ')}`;
    }
  }

  private formatToolSuccess(toolName: string, result: any): string {
    switch (toolName) {
      case 'crm_create_contact':
        return `Contact created: ${result?.contact?.firstName ?? ''} ${result?.contact?.lastName ?? ''}.`;
      case 'commerce_create_invoice':
        return `Invoice ${result?.invoiceNumber ?? ''} created.`;
      case 'bookings_create_booking':
        return `Booking confirmed (ID: ${result?.id ?? ''}).`;
      case 'marketing_send_campaign':
        return `Campaign sent successfully.`;
      case 'social_publish_post':
        return `Post published.`;
      case 'bookings_cancel_booking':
        return `Booking cancelled.`;
      case 'crm_delete_contact':
        return `Contact deleted.`;
      default:
        return 'Action completed.';
    }
  }

  async getConversationHistory(businessId: string, sessionId: string): Promise<FlowMessage[]> {
    const session = await this.prisma.client.flowSession.findFirst({
      where: { id: sessionId, businessId },
      select: { messages: true },
    });
    if (!session) return [];
    return (session.messages as any[]) || [];
  }

  async saveConversationHistory(businessId: string, sessionId: string, messages: FlowMessage[]): Promise<void> {
    await this.prisma.client.flowSession.upsert({
      where: { id: sessionId },
      create: { id: sessionId, businessId, messages: messages as any },
      update: { messages: messages as any, updatedAt: new Date() },
    });
  }

  async listSessions(businessId: string) {
    return this.prisma.client.flowSession.findMany({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, updatedAt: true, messages: true },
    });
  }

  async clearSession(businessId: string, sessionId: string) {
    await this.prisma.client.flowSession.updateMany({
      where: { id: sessionId, businessId },
      data: { messages: [] },
    });
  }

  async deleteSession(businessId: string, sessionId: string) {
    await this.prisma.client.flowSession.deleteMany({
      where: { id: sessionId, businessId },
    });
  }
}

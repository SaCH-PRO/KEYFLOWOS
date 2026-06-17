import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { GovernanceService } from './governance.service';
import { BusinessGraphService } from './business-graph.service';
import { PlannerService } from './planner.service';
import { getOpenAiToolDefinitions, getToolByName, RiskLevel, ToolFamily, wrapToolResult, FlowTool } from './flow-tool-registry';
import { AiMemoryService } from './ai-memory.service';
import { ModelGatewayService, GatewayMessage, StreamChunk } from './model-gateway.service';
import { CatalogService } from '../catalog/catalog.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { AiMessageSenderService } from './ai-message-sender.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { RoleEngineService, BusinessRole, RoleDetectionContext } from './role-engine.service';
import { ContentRequestService } from '../content-ops/content-request.service';
import { CallLogService } from '../call-tasks/call-log.service';
import { CallScriptService } from '../call-tasks/call-script.service';
import { EvidenceService } from '../evidence/evidence.service';
import { ApprovalRequestService } from '../approvals/approval-request.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';


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
  changedEntities: string[];
  followOnSuggestions: string[];
  family: string;
  riskTier: number;
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

export interface FlowStreamChunk {
  type: 'content_delta' | 'tool_calls' | 'tool_results' | 'confirmation_required' | 'usage' | 'done' | 'error';
  content?: string;
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  pendingConfirmations?: PendingConfirmation[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
  };
  error?: string;
}

/**
 * Optional context the caller can attach to a chat turn so the AI brain
 * knows where the user is in the app and what they are looking at.
 * The Keyflow Command surface attaches the current page route, the focused
 * item (e.g. a contact, invoice, booking) and recent activity hints.
 */
export interface FlowPageContext {
  surface?: string;
  route?: string;
  focusedItem?: {
    type?: string;
    id?: string;
    label?: string;
    summary?: string;
  };
  recent?: Array<{ label: string; href?: string; at?: string }>;
  notes?: Array<{ title?: string; body: string }>;
  hints?: string[];
}

function formatPageContextSection(ctx?: FlowPageContext): string {
  if (!ctx) return '';
  const lines: string[] = ['', '## Where the operator is right now'];
  if (ctx.surface) lines.push(`Active surface: ${ctx.surface}`);
  if (ctx.route) lines.push(`Route: ${ctx.route}`);
  if (ctx.focusedItem) {
    const fi = ctx.focusedItem;
    lines.push(`Focused item: ${fi.type ?? 'item'}${fi.id ? ` #${fi.id}` : ''}${fi.label ? ` — ${fi.label}` : ''}`);
    if (fi.summary) lines.push(`Focused summary: ${fi.summary}`);
  }
  if (ctx.recent?.length) {
    lines.push('Recent items:');
    for (const r of ctx.recent.slice(0, 8)) {
      lines.push(`- ${r.label}${r.href ? ` (${r.href})` : ''}`);
    }
  }
  if (ctx.notes?.length) {
    lines.push('Open Keyflow notes:');
    for (const n of ctx.notes.slice(0, 5)) {
      const head = n.title ? `${n.title}: ` : '';
      lines.push(`- ${head}${n.body.slice(0, 200)}`);
    }
  }
  if (ctx.hints?.length) {
    lines.push('Operator hints:');
    for (const h of ctx.hints.slice(0, 6)) lines.push(`- ${h}`);
  }
  return '\n' + lines.join('\n');
}

const FLOW_SYSTEM_PROMPT = `{{ONBOARDING_DIRECTIVE}}You are Flow, an AI assistant built into KeyFlowOS — a business operating system for Caribbean entrepreneurs. You have full access to the user's business data and can take real actions on their behalf.

You have 4 tool families at your disposal:

**Read** (safe, instant):
- fetch_business_summary, fetch_client_health, fetch_schedule_health, fetch_revenue_risk
- fetch_storefront_quality, fetch_project_status, fetch_expense_pressure

**Draft** (AI-generated content, no side effects):
- draft_followup_message, draft_campaign_bundle, draft_payment_reminder
- draft_storefront_copy, draft_project_update

**Organize** (structural changes, moderate risk):
- create_task, create_followup_queue, tag_contact, segment_contacts, schedule_action

**Execute** (high-impact actions, may require approval):
- queue_campaign, send_message_with_approval, apply_storefront_recommendation
- enable_flow_with_approval, update_status_with_confirmation

**CRUD** (standard data operations):
- CRM: search/create/update/list/delete contacts, add notes and tasks
- Commerce: create/list/update/send invoices, quotes, products; mark invoices paid
- Bookings: create/list/reschedule/cancel bookings, list services
- Marketing: create/update/send/list campaigns
- Social: create/update/publish/list posts
- Automations: create/list/toggle playbooks
- Content Ops: create/list/assign/transition/submit/upload/deliver content requests
- Call Tasks: create/list/log outcome/schedule follow-up calls, generate AI call scripts
- Evidence: submit/verify evidence linked to tasks and approvals
- Approvals: create/list approval requests and decide steps
- Drive: create folders and documents in Google Drive
- Calendar: create/list events, check scheduling conflicts
- Time Tracking: start/stop timers, log time entries
- Helpdesk: create/list/update support tickets
- Finance: view receivables aging, customer balances, finance action items
- Projects: create/update/complete/delete project tasks

Your personality:
- Warm, approachable, and genuinely helpful — like a trusted teammate who happens to be great with business ops
- Speak naturally and conversationally, not like a corporate chatbot
- Use a friendly, encouraging tone. Celebrate wins with the user.
- Always use TTD currency unless the user specifies otherwise
- Be concise but warm in your confirmations (e.g. "All done! 🎉 Created invoice #INV-001 for $500 TTD for John Smith. Need anything else?")
- When you create or update something, confirm what you did clearly and ask if they need help with what's next
- If you need information to complete a task, ask for it specifically and explain why it helps

Important rules:
- Always use function calling tools to take actions — never pretend to take an action
- When you've completed an action, briefly confirm what was done
- If you cannot find a contact by name, search for them first before creating an invoice or booking
- When searching for a contact by name returns multiple matches (disambiguationNeeded: true), ALWAYS ask the user which specific contact they mean before proceeding with any action
- For dates/times, use the current date context and interpret relative dates (e.g. "tomorrow at 2pm")
- Prefer Read tools when the user asks questions about their business health or status
- Use Draft tools to generate content the user can review before sending
- Current date: {{CURRENT_DATE}}

Business context:
{{BUSINESS_CONTEXT}}`;

@Injectable()
export class FlowOrchestratorService {
  private readonly logger = new Logger(FlowOrchestratorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(forwardRef(() => PlannerService)) private readonly planner: PlannerService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(AiMessageSenderService) private readonly messageSender: AiMessageSenderService,
    @Inject(SemanticMemoryService) private readonly semanticMemory: SemanticMemoryService,
    @Inject(RoleEngineService) private readonly roleEngine: RoleEngineService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  // Lazy resolvers to avoid circular module dependencies
  private getContentRequest() {
    return this.moduleRef.get(ContentRequestService, { strict: false });
  }
  private getCallLog() {
    return this.moduleRef.get(CallLogService, { strict: false });
  }
  private getCallScript() {
    return this.moduleRef.get(CallScriptService, { strict: false });
  }
  private getEvidence() {
    return this.moduleRef.get(EvidenceService, { strict: false });
  }
  private getApprovalRequest() {
    return this.moduleRef.get(ApprovalRequestService, { strict: false });
  }
  private getDrive() {
    return this.moduleRef.get(GoogleDriveService, { strict: false });
  }
  private getTaskAssignment() {
    return this.moduleRef.get(TaskAssignmentService, { strict: false });
  }

  /**
   * Build the "Blueprint" section of the system prompt. Reads from the
   * BusinessBlueprint so KEY's recommendations are grounded in the operator's
   * actual identity, goals, constraints, and brand voice.
   */
  private async buildOnboardingDirective(businessId: string): Promise<string> {
    const ctx = await this.blueprint.getBlueprintContext(businessId);
    if (!ctx || ctx.completeness >= 100) return '';
    return (
      '\n[PRIORITY DIRECTIVE — BUSINESS GENOME ONBOARDING]\n' +
      `The Business Genome is only ${ctx.completeness}% complete. Until it reaches 100%, your FIRST priority in every turn is to collect missing business facts. ` +
      'When the user shares ANY concrete business fact (industry, revenue model, ideal customer, goals, constraints, brand voice, budget, time commitment, etc.), ' +
      'STOP and call the update_business_blueprint tool with a patch containing that fact BEFORE doing anything else. Do NOT use commerce, CRM, marketing, or finance tools when a blueprint fact is present. ' +
      'If they have not shared a fact, ask ONE concise follow-up question to fill the next missing section in this order: identity, operatingModel, constraints, goals, brand, customerModel, financials, workflowModel, aiPreferences. ' +
      'Never ask for passwords, API keys, or bank details.\n'
    );
  }

  private async buildBlueprintSection(businessId: string): Promise<string> {
    const ctx = await this.blueprint.getBlueprintContext(businessId);
    if (!ctx) return '';
    const lines: string[] = ['', 'Business Blueprint (operating DNA):'];
    lines.push(`- Completeness: ${ctx.completeness}%`);
    if (ctx.summary) lines.push(`- Summary: ${ctx.summary}`);
    if (ctx.identity.archetype) lines.push(`- Archetype: ${ctx.identity.archetype}`);
    if (ctx.identity.industry) lines.push(`- Industry: ${ctx.identity.industry}`);
    if (ctx.operatingModel.revenueModel) lines.push(`- Revenue model: ${ctx.operatingModel.revenueModel}`);
    if (ctx.operatingModel.deliveryMode) lines.push(`- Delivery mode: ${ctx.operatingModel.deliveryMode}`);
    if (ctx.goals.northStar) lines.push(`- North star: ${ctx.goals.northStar}`);
    if (ctx.goals.ninetyDayGoals?.length) lines.push(`- 90-day goals: ${ctx.goals.ninetyDayGoals.join('; ')}`);
    if (ctx.constraints.budgetRange) lines.push(`- Budget: ${ctx.constraints.budgetRange}`);
    if (ctx.constraints.timeCommitment) lines.push(`- Time commitment: ${ctx.constraints.timeCommitment}`);
    if (ctx.brand.voice) lines.push(`- Brand voice: ${ctx.brand.voice}`);
    if (ctx.customerModel.idealCustomer) lines.push(`- Ideal customer: ${ctx.customerModel.idealCustomer}`);
    if (ctx.financials.avgTicket) lines.push(`- Avg ticket: ${ctx.financials.avgTicket}`);
    if (ctx.legalProfile?.recommendedEntityType) {
      lines.push(`- Recommended entity type: ${ctx.legalProfile.recommendedEntityType}`);
    }
    if (ctx.registrationProfile?.missingRegistrationSteps?.length) {
      lines.push(`- Missing registration steps: ${ctx.registrationProfile.missingRegistrationSteps.join('; ')}`);
    }
    if (ctx.projectionProfile?.runwayMonths) {
      lines.push(`- Cash runway: ${ctx.projectionProfile.runwayMonths} months`);
    }
    if (ctx.riskProfile?.riskScore) {
      lines.push(`- Business risk score: ${ctx.riskProfile.riskScore}/100`);
    }
    if (ctx.executionRoadmap?.today?.length) {
      lines.push(`- Today's priorities: ${ctx.executionRoadmap.today.join('; ')}`);
    }
    if (ctx.complianceProfile?.complianceScore !== undefined) {
      lines.push(`- Compliance score: ${ctx.complianceProfile.complianceScore}%`);
    }
    return '\n' + lines.join('\n');
  }

  /**
   * Infer the business role from conversation context.
   * Uses page route, focused item, message content, and conversation history
   * to determine which role Key should adopt. This makes Key feel like one
   * intelligent assistant that adapts transparently.
   */
  private async inferRole(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[],
    pageContext?: FlowPageContext,
  ): Promise<BusinessRole> {
    // Extract previous role from conversation history (look for role in assistant messages)
    let previousRole: BusinessRole | undefined;
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i];
      if (msg.role === 'assistant' && msg.content) {
        // Heuristic: check if the sign-off matches a role
        for (const role of ['sales', 'finance', 'support', 'operations', 'marketing'] as BusinessRole[]) {
          const def = this.roleEngine.getRoleDefinition(role);
          if (msg.content.includes(def.signOff)) {
            previousRole = role;
            break;
          }
        }
        if (previousRole) break;
      }
    }

    const detectionCtx: RoleDetectionContext = {
      route: pageContext?.route,
      focusedItemType: pageContext?.focusedItem?.type,
      message,
      previousRole,
      entityContext: pageContext ? {
        surface: pageContext.surface,
        focusedItem: pageContext.focusedItem,
        hints: pageContext.hints,
      } : undefined,
    };

    return this.roleEngine.detectRoleFromContext(detectionCtx);
  }

  async chat(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[] = [],
    pendingConfirmation?: { toolCallId: string; confirmed: boolean; toolName?: string; toolArgs?: Record<string, any> },
    pageContext?: FlowPageContext,
    role?: BusinessRole,
  ): Promise<FlowResponse> {
    this.aiUsage.checkRateLimit(businessId);

    // Auto-detect role if not explicitly provided
    const detectedRole = role ?? await this.inferRole(businessId, message, conversationHistory, pageContext);

    const canProceed = await this.aiUsage.checkCredits(businessId, 2);
    if (!canProceed.allowed) {
      return {
        reply: `I've reached the AI credit limit for your account (${canProceed.used}/${canProceed.limit} credits used this month). Please upgrade your plan to continue using Flow.`,
      };
    }

    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const businessName = snapshot.business.name || 'your business';
    const contextSnapshot = this.businessGraph.buildContextString(snapshot);

    const memoryCtx = await this.memory.buildContextBlock(businessId);
    const memorySection = this.memory.buildPromptSection(memoryCtx);

    // Semantic memory search based on last user message
    const lastUserMessage = conversationHistory.slice().reverse().find((m) => m.role === 'user');
    let semanticMemorySection = '';
    if (lastUserMessage?.content) {
      const relevant = await this.semanticMemory.search({
        businessId,
        query: lastUserMessage.content,
        limit: 5,
        minSimilarity: 0.65,
      });
      if (relevant.length > 0) {
        semanticMemorySection = '\n\nRELEVANT CONTEXT FROM MEMORY:\n' +
          relevant.map((m) => `- ${m.content} (similarity: ${Math.round(m.similarity * 100)}%)`).join('\n');
      }
    }

    const pageContextSection = formatPageContextSection(pageContext);
    const blueprintSection = await this.buildBlueprintSection(businessId);
    const onboardingDirective = await this.buildOnboardingDirective(businessId);

    let systemPrompt: string;
    if (detectedRole && detectedRole !== 'general') {
      const businessContext = onboardingDirective + contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection;
      systemPrompt = this.roleEngine.getSystemPromptForRole(detectedRole, businessContext, onboardingDirective)
        .replace('{{CURRENT_DATE}}', new Date().toISOString());
    } else {
      systemPrompt = FLOW_SYSTEM_PROMPT
        .replace('{{CURRENT_DATE}}', new Date().toISOString())
        .replace('{{ONBOARDING_DIRECTIVE}}', onboardingDirective)
        .replace('{{BUSINESS_CONTEXT}}', contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection);
    }

    const messages: GatewayMessage[] = [
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
        const confirmDecision = await this.governance.evaluate(businessId, pendingConfirmation.toolName, undefined, detectedRole);
        if (!confirmDecision.allowed) {
          return {
            reply: `This action is blocked: ${confirmDecision.reason}`,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, creditsUsed: 0 },
          };
        }
        if (confirmDecision.requiresFormalApproval) {
          await this.governance.createApprovalItem(businessId, {
            toolName: pendingConfirmation.toolName,
            title: `Chat action: ${pendingConfirmation.toolName}`,
            description: `User confirmed action via chat. Governance requires ${confirmDecision.requiresAdminApproval ? 'admin' : 'formal'} approval (Tier ${confirmDecision.tier}).`,
            rationale: confirmDecision.reason,
            inputPayload: pendingConfirmation.toolArgs as Record<string, any>,
          });
          await this.executionLog.log({
            businessId,
            action: `approval_queued_chat`,
            toolName: pendingConfirmation.toolName,
            riskTier: confirmDecision.tier,
            mode: 'assisted',
            actor: 'system',
            rationale: `Chat confirmation routed to approval queue — Tier ${confirmDecision.tier} requires ${confirmDecision.requiresAdminApproval ? 'admin' : 'formal'} approval`,
            success: true,
          });
          return {
            reply: confirmDecision.requiresAdminApproval
              ? `This is a high-impact action (Tier ${confirmDecision.tier}) that requires admin approval. It has been added to your approval queue for an admin to review.`
              : `This action requires formal approval before execution (Tier ${confirmDecision.tier}). It has been added to your approval queue.`,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, creditsUsed: 0 },
          };
        }
        const result = await this.executeTool(businessId, pendingConfirmation.toolName, pendingConfirmation.toolArgs, undefined, { planId: '', planStepId: '', role: detectedRole ?? undefined });
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
      const gatewayResponse = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'flow_chat',
        {
          messages: messages as GatewayMessage[],
          tools: detectedRole && detectedRole !== 'general'
            ? getOpenAiToolDefinitions().filter((t) => this.roleEngine.isToolAllowed(detectedRole, t.function.name))
            : getOpenAiToolDefinitions(),
          toolChoice: 'auto',
          maxTokens: 1000,
          temperature: 0.7,
        },
      );

      const assistantMessage = {
        content: gatewayResponse.content,
        tool_calls: gatewayResponse.toolCalls,
      };
      const promptTokens = gatewayResponse.usage.promptTokens;
      const completionTokens = gatewayResponse.usage.completionTokens;
      const totalTokens = gatewayResponse.usage.totalTokens;
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

      const governanceChecks = await Promise.all(
        toolCalls.map(async (tc) => {
          const decision = await this.governance.evaluate(businessId, tc.name, undefined, detectedRole);
          return { tc, decision };
        }),
      );

      const blocked = governanceChecks.filter(({ decision }) => !decision.allowed);
      const needsQuickConfirm = governanceChecks.filter(({ decision }) => decision.requiresQuickConfirm && !decision.requiresFormalApproval);
      const needsFormalApproval = governanceChecks.filter(({ decision }) => decision.requiresFormalApproval);

      if (blocked.length > 0) {
        return {
          reply: `I can't execute that action right now: ${blocked.map(b => b.decision.reason).join('; ')}`,
          usage,
        };
      }

      if (needsFormalApproval.length > 0) {
        for (const { tc, decision } of needsFormalApproval) {
          this.governance.createApprovalItem(businessId, {
            toolName: tc.name,
            title: this.describeToolCall(tc.name, tc.arguments),
            description: `Tier ${decision.tier} action requested via Flow chat — requires ${decision.requiresAdminApproval ? 'admin' : 'formal'} approval`,
            rationale: decision.reason,
            inputPayload: tc.arguments,
          }).catch((e: unknown) => {
            this.logger.error(`Failed to create approval item for ${tc.name}: ${e instanceof Error ? e.message : String(e)}`);
          });
        }

        const approvalMessages = needsFormalApproval.map(({ tc, decision }) =>
          `• ${this.describeToolCall(tc.name, tc.arguments)} (Tier ${decision.tier}${decision.requiresAdminApproval ? ', admin required' : ''})`
        ).join('\n');

        return {
          reply: `These actions require formal approval and have been added to your approval queue:\n${approvalMessages}`,
          usage,
        };
      }

      if (needsQuickConfirm.length > 0) {
        const pendingConfirmations: PendingConfirmation[] = needsQuickConfirm.map(({ tc, decision }) => ({
          toolCallId: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          description: this.describeToolCall(tc.name, tc.arguments),
          riskLevel: tc.riskLevel,
        }));

        return {
          reply: assistantMessage.content || 'I need your quick confirmation before proceeding with this action.',
          toolCalls,
          pendingConfirmations,
          requiresConfirmation: true,
          usage,
        };
      }

      const toolResults: FlowToolResult[] = await Promise.all(
        toolCalls.map((tc) => this.executeTool(businessId, tc.name, tc.arguments, tc.id, { planId: '', planStepId: '', role: detectedRole ?? undefined })),
      );

      const followUpMessages: GatewayMessage[] = [
        ...messages,
        {
          role: 'assistant' as const,
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls,
        },
        ...toolResults.map((result) => ({
          role: 'tool' as const,
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        })),
      ];

      const followUpGateway = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'flow_chat',
        {
          messages: followUpMessages,
          maxTokens: 500,
          temperature: 0.7,
        },
      );

      const finalReply = followUpGateway.content
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

  async *streamChat(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[] = [],
    pageContext?: FlowPageContext,
    role?: BusinessRole,
  ): AsyncGenerator<FlowStreamChunk> {
    // Auto-detect role if not explicitly provided
    const detectedRole = role ?? await this.inferRole(businessId, message, conversationHistory, pageContext);

    try {
      this.aiUsage.checkRateLimit(businessId);
    } catch (err) {
      yield { type: 'error', error: (err as Error).message };
      return;
    }

    const canProceed = await this.aiUsage.checkCredits(businessId, 2);
    if (!canProceed.allowed) {
      yield {
        type: 'error',
        error: `AI credit limit reached (${canProceed.used}/${canProceed.limit} credits used this month). Please upgrade your plan.`,
      };
      return;
    }

    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const contextSnapshot = this.businessGraph.buildContextString(snapshot);
    const memoryCtx = await this.memory.buildContextBlock(businessId);
    const memorySection = this.memory.buildPromptSection(memoryCtx);

    // Semantic memory search based on current message
    let semanticMemorySection = '';
    if (message) {
      const relevant = await this.semanticMemory.search({
        businessId,
        query: message,
        limit: 5,
        minSimilarity: 0.65,
      });
      if (relevant.length > 0) {
        semanticMemorySection = '\n\nRELEVANT CONTEXT FROM MEMORY:\n' +
          relevant.map((m) => `- ${m.content} (similarity: ${Math.round(m.similarity * 100)}%)`).join('\n');
      }
    }

    const pageContextSection = formatPageContextSection(pageContext);
    const blueprintSection = await this.buildBlueprintSection(businessId);
    const onboardingDirective = await this.buildOnboardingDirective(businessId);

    let systemPrompt: string;
    if (detectedRole && detectedRole !== 'general') {
      const businessContext = onboardingDirective + contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection;
      systemPrompt = this.roleEngine.getSystemPromptForRole(detectedRole, businessContext, onboardingDirective)
        .replace('{{CURRENT_DATE}}', new Date().toISOString());
    } else {
      systemPrompt = FLOW_SYSTEM_PROMPT
        .replace('{{CURRENT_DATE}}', new Date().toISOString())
        .replace('{{ONBOARDING_DIRECTIVE}}', onboardingDirective)
        .replace('{{BUSINESS_CONTEXT}}', contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection);
    }

    const messages: GatewayMessage[] = [
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

    messages.push({ role: 'user', content: message });

    try {
      const stream = this.aiUsage.trackAndStream(
        businessId,
        undefined,
        'flow_chat_stream',
        {
          messages,
          tools: detectedRole && detectedRole !== 'general'
            ? getOpenAiToolDefinitions().filter((t) => this.roleEngine.isToolAllowed(detectedRole, t.function.name))
            : getOpenAiToolDefinitions(),
          toolChoice: 'auto',
          maxTokens: 1000,
          temperature: 0.7,
        },
      );

      let fullContent = '';
      const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
      let streamUsage: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number } | undefined;
      let streamProvider = '';
      let streamModel = '';

      for await (const chunk of stream) {
        if (chunk.provider) streamProvider = chunk.provider;
        if (chunk.model) streamModel = chunk.model;

        if (chunk.type === 'content_delta' && chunk.content) {
          fullContent += chunk.content;
          yield { type: 'content_delta', content: chunk.content };
        }

        if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          const tc = chunk.toolCall;
          if (!toolCallAccumulator.has(tc.index)) {
            toolCallAccumulator.set(tc.index, { id: '', name: '', arguments: '' });
          }
          const acc = toolCallAccumulator.get(tc.index)!;
          if (tc.id) acc.id = tc.id;
          if (tc.name) acc.name = tc.name;
          if (tc.argumentsDelta) acc.arguments += tc.argumentsDelta;
        }

        if (chunk.type === 'usage' && chunk.usage) {
          streamUsage = chunk.usage;
        }

        if (chunk.type === 'error') {
          yield { type: 'error', error: chunk.error };
          return;
        }
      }



      const usage = {
        promptTokens: streamUsage?.promptTokens ?? 0,
        completionTokens: streamUsage?.completionTokens ?? 0,
        totalTokens: streamUsage?.totalTokens ?? 0,
        creditsUsed: 2,
      };

      if (toolCallAccumulator.size === 0) {
        yield { type: 'usage', usage };
        yield { type: 'done' };
        return;
      }

      const toolCalls: FlowToolCall[] = [];
      for (const [, acc] of toolCallAccumulator) {
        const tool = getToolByName(acc.name);
        toolCalls.push({
          id: acc.id,
          name: acc.name,
          arguments: JSON.parse(acc.arguments || '{}'),
          riskLevel: tool?.riskLevel ?? 'low',
        });
      }

      yield { type: 'tool_calls', toolCalls };

      const governanceChecks = await Promise.all(
        toolCalls.map(async (tc) => {
          const decision = await this.governance.evaluate(businessId, tc.name, undefined, detectedRole);
          return { tc, decision };
        }),
      );

      const blocked = governanceChecks.filter(({ decision }) => !decision.allowed);
      const needsQuickConfirm = governanceChecks.filter(({ decision }) => decision.requiresQuickConfirm && !decision.requiresFormalApproval);
      const needsFormalApproval = governanceChecks.filter(({ decision }) => decision.requiresFormalApproval);

      if (blocked.length > 0) {
        yield {
          type: 'content_delta',
          content: `I can't execute that action right now: ${blocked.map(b => b.decision.reason).join('; ')}`,
        };
        yield { type: 'usage', usage };
        yield { type: 'done' };
        return;
      }

      if (needsFormalApproval.length > 0) {
        for (const { tc, decision } of needsFormalApproval) {
          this.governance.createApprovalItem(businessId, {
            toolName: tc.name,
            title: this.describeToolCall(tc.name, tc.arguments),
            description: `Tier ${decision.tier} action requested via Flow chat — requires ${decision.requiresAdminApproval ? 'admin' : 'formal'} approval`,
            rationale: decision.reason,
            inputPayload: tc.arguments,
          }).catch((e: unknown) => {
            this.logger.error(`Failed to create approval item for ${tc.name}: ${e instanceof Error ? e.message : String(e)}`);
          });
        }

        const approvalMessages = needsFormalApproval.map(({ tc, decision }) =>
          `• ${this.describeToolCall(tc.name, tc.arguments)} (Tier ${decision.tier}${decision.requiresAdminApproval ? ', admin required' : ''})`
        ).join('\n');

        yield {
          type: 'content_delta',
          content: `These actions require formal approval and have been added to your approval queue:\n${approvalMessages}`,
        };
        yield { type: 'usage', usage };
        yield { type: 'done' };
        return;
      }

      if (needsQuickConfirm.length > 0) {
        const pendingConfirmations: PendingConfirmation[] = needsQuickConfirm.map(({ tc }) => ({
          toolCallId: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          description: this.describeToolCall(tc.name, tc.arguments),
          riskLevel: tc.riskLevel,
        }));

        yield {
          type: 'confirmation_required',
          pendingConfirmations,
          toolCalls,
        };
        yield { type: 'usage', usage };
        yield { type: 'done' };
        return;
      }

      const toolResults: FlowToolResult[] = await Promise.all(
        toolCalls.map((tc) => this.executeTool(businessId, tc.name, tc.arguments, tc.id, { planId: '', planStepId: '', role: detectedRole ?? undefined })),
      );

      yield { type: 'tool_results', toolResults };

      const followUpMessages: GatewayMessage[] = [
        ...messages,
        {
          role: 'assistant' as const,
          content: fullContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        },
        ...toolResults.map((result) => ({
          role: 'tool' as const,
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        })),
      ];

      const followUpStream = this.aiUsage.trackAndStream(
        businessId,
        undefined,
        'flow_chat_stream',
        {
          messages: followUpMessages,
          maxTokens: 500,
          temperature: 0.7,
        },
      );

      for await (const chunk of followUpStream) {
        if (chunk.type === 'content_delta' && chunk.content) {
          yield { type: 'content_delta', content: chunk.content };
        }
      }

      yield { type: 'usage', usage };
      yield { type: 'done' };
    } catch (error) {
      this.logger.error(`Flow stream chat error: ${(error as Error).message}`);
      yield { type: 'error', error: (error as Error).message };
    }
  }

  async executeToolDirectly(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
    planContext?: { planId: string; planStepId: string },
  ): Promise<any> {
    const result = await this.executeTool(businessId, toolName, args, `direct_${toolName}`, planContext);
    if (!result.success) {
      throw new Error(result.error ?? `Tool ${toolName} failed`);
    }
    return result.result;
  }

  private async executeTool(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
    toolCallId?: string,
    planContext?: { planId: string; planStepId: string; role?: string },
  ): Promise<FlowToolResult> {
    const id = toolCallId ?? `manual_${toolName}`;
    const startTime = Date.now();
    try {
      this.validateToolInput(toolName, args);
      const rawResult = await this.executeToolAction(businessId, toolName, args);
      const envelope = wrapToolResult(toolName, rawResult);
      const durationMs = Date.now() - startTime;
      const tier = this.governance.getToolTier(toolName);
      this.executionLog.logToolExecution(businessId, toolName, args, envelope, true, durationMs, {
        riskTier: tier,
        planId: planContext?.planId,
        planStepId: planContext?.planStepId,
        role: planContext?.role,
      }).catch((e: unknown) => {
        this.logger.error(`Failed to log tool execution for ${toolName}: ${e instanceof Error ? e.message : String(e)}`);
      });
      this.businessGraph.invalidateCache(businessId);
      return {
        toolCallId: id,
        name: toolName,
        result: envelope.result,
        changedEntities: envelope.changedEntities,
        followOnSuggestions: envelope.followOnSuggestions,
        family: envelope.family,
        riskTier: envelope.riskTier,
        success: true,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const tier = this.governance.getToolTier(toolName);
      this.executionLog.logToolExecution(businessId, toolName, args, (error as Error).message, false, durationMs, {
        riskTier: tier,
        planId: planContext?.planId,
        planStepId: planContext?.planStepId,
        role: planContext?.role,
      }).catch((e: unknown) => {
        this.logger.error(`Failed to log tool execution error for ${toolName}: ${e instanceof Error ? e.message : String(e)}`);
      });
      const errorEnvelope = wrapToolResult(toolName, null);
      return {
        toolCallId: id,
        name: toolName,
        result: null,
        changedEntities: errorEnvelope.changedEntities,
        followOnSuggestions: errorEnvelope.followOnSuggestions,
        family: errorEnvelope.family,
        riskTier: errorEnvelope.riskTier,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private validateToolInput(toolName: string, args: Record<string, any>): void {
    const tool = getToolByName(toolName);
    if (!tool) return;

    const missing = tool.parameters.required.filter(
      (field) => args[field] === undefined || args[field] === null || args[field] === '',
    );
    if (missing.length > 0) {
      throw new Error(`Missing required fields for ${toolName}: ${missing.join(', ')}`);
    }

    for (const [key, value] of Object.entries(args)) {
      const schema = tool.parameters.properties[key];
      if (!schema) continue;
      if (schema.type === 'string' && typeof value !== 'string') {
        throw new Error(`Field "${key}" for ${toolName} must be a string`);
      }
      if (schema.type === 'number' && typeof value !== 'number') {
        const num = Number(value);
        if (isNaN(num)) throw new Error(`Field "${key}" for ${toolName} must be a number`);
        args[key] = num;
      }
      if (schema.type === 'boolean' && typeof value !== 'boolean') {
        if (value === 'true') args[key] = true;
        else if (value === 'false') args[key] = false;
        else throw new Error(`Field "${key}" for ${toolName} must be a boolean`);
      }
      if (schema.type === 'array' && !Array.isArray(value)) {
        throw new Error(`Field "${key}" for ${toolName} must be an array`);
      }
      if (schema.enum && typeof value === 'string' && !schema.enum.includes(value)) {
        throw new Error(`Field "${key}" for ${toolName} must be one of: ${schema.enum.join(', ')}`);
      }
    }
  }

  private async executeToolAction(businessId: string, toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'update_business_blueprint': {
        const patch = args.patch as Record<string, Record<string, unknown>>;
        const blueprint = await this.blueprint.updateBlueprint(businessId, patch);
        return {
          completeness: blueprint.completeness,
          confidenceScores: blueprint.confidenceScores,
          updatedSections: Object.keys(patch),
        };
      }

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
        return { contacts, count: contacts.length, disambiguationNeeded: contacts.length > 1 };
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
        // Auto-assign KEY to tasks it creates
        await this.getTaskAssignment().assign({
          taskType: 'ContactTask',
          taskId: task.id,
          assignableType: 'KEY',
          assignableId: 'key_ai',
          assignedBy: 'key_ai',
          reason: 'Auto-assigned by KEY Operator',
        }).catch(() => { /* ignore assignment errors */ });
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
        const invoiceCount = await this.prisma.client.invoice.count({ where: { businessId } });
        const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, '0')}`;
        const invoice = await this.prisma.client.invoice.create({
          data: {
            businessId,
            contactId: args.contactId ?? null,
            items: items,
            invoiceNumber,
            subtotal,
            taxAmount: 0,
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
        const product = await this.catalog.createProduct({
          businessId,
          name: args.name,
          price: args.price,
          currency: args.currency ?? 'TTD',
          description: args.description ?? null,
          category: args.category ?? 'PRODUCT',
          isActive: true,
        });
        return { product, id: product.id };
      }

      case 'commerce_create_quote': {
        const items = args.items ?? [];
        const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0);
        const quoteCount = await this.prisma.client.quote.count({ where: { businessId } });
        const quoteNumber = `QT-${String(quoteCount + 1).padStart(4, '0')}`;
        const quote = await this.prisma.client.quote.create({
          data: {
            businessId,
            contactId: args.contactId,
            items,
            quoteNumber,
            subtotal,
            taxAmount: 0,
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
        // Validate contact exists
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, displayName: true },
        });
        if (!contact) {
          throw new BadRequestException('Contact not found. Please search for the contact first.');
        }

        // Disambiguation check: if other contacts have same/similar name, warn
        const similarContacts = await this.prisma.client.contact.findMany({
          where: {
            businessId,
            deletedAt: null,
            id: { not: args.contactId },
            OR: [
              { firstName: { equals: contact.firstName ?? '', mode: 'insensitive' } },
              { lastName: { equals: contact.lastName ?? '', mode: 'insensitive' } },
              { displayName: { equals: contact.displayName ?? '', mode: 'insensitive' } },
            ],
          },
          select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
          take: 5,
        });
        if (similarContacts.length > 0) {
          const names = similarContacts.map(c => c.displayName || `${c.firstName} ${c.lastName}`).filter(Boolean).join(', ');
          throw new BadRequestException(
            `Multiple contacts with similar names found (${names}). Please confirm which contact you want to book for.`
          );
        }

        // Availability validation
        const startTime = new Date(args.startTime);
        const endTime = new Date(args.endTime);
        const overlapWhere: Record<string, unknown> = {
          businessId,
          status: { not: 'CANCELLED' },
          OR: [
            { startTime: { lte: endTime }, endTime: { gte: startTime } },
          ],
        };
        if (args.staffId) {
          overlapWhere.staffId = args.staffId;
        }
        const overlapping = await this.prisma.client.booking.findFirst({
          where: overlapWhere,
          select: { id: true, startTime: true, endTime: true },
        });
        if (overlapping) {
          throw new BadRequestException(
            `Time slot conflicts with existing booking (${overlapping.startTime.toISOString()} - ${overlapping.endTime.toISOString()}). Please choose a different time.`
          );
        }

        const booking = await this.prisma.client.booking.create({
          data: {
            businessId,
            contactId: args.contactId,
            serviceId: args.serviceId ?? null,
            staffId: args.staffId ?? null,
            startTime,
            endTime,
            notes: args.notes ?? null,
            status: 'CONFIRMED',
          },
        });
        return { booking, id: booking.id, contactName: contact.displayName || `${contact.firstName} ${contact.lastName}` };
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
          data: { status: 'PUBLISHED', postedAt: new Date() },
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

      // ========== READ FAMILY ==========

      case 'fetch_business_summary': {
        const snapshot = await this.businessGraph.getSnapshot(businessId);
        return {
          businessName: snapshot.business.name,
          industry: snapshot.business.industry,
          momentumScore: snapshot.momentumScore,
          contacts: snapshot.contacts,
          revenue: snapshot.revenue,
          bookings: snapshot.bookings,
          expenses: snapshot.expenses,
        };
      }

      case 'fetch_client_health': {
        const now = new Date();
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

        if (args.contactId) {
          const contact = await this.prisma.client.contact.findFirst({
            where: { id: args.contactId, businessId, deletedAt: null },
            select: { id: true, firstName: true, lastName: true, email: true, status: true, updatedAt: true, tags: true },
          });
          if (!contact) throw new Error('Contact not found');
          const invoiceTotal = await this.prisma.client.invoice.aggregate({
            where: { businessId, contactId: args.contactId, deletedAt: null, status: 'PAID' },
            _sum: { total: true },
            _count: true,
          });
          const bookingCount = await this.prisma.client.booking.count({
            where: { businessId, contactId: args.contactId, deletedAt: null },
          });
          const isStale = contact.updatedAt < fourteenDaysAgo;
          return {
            contact,
            totalSpend: invoiceTotal._sum.total ?? 0,
            invoiceCount: invoiceTotal._count ?? 0,
            bookingCount,
            isStale,
            daysSinceActivity: Math.floor((now.getTime() - contact.updatedAt.getTime()) / 86400000),
          };
        }

        const [totalContacts, staleLeads, atRiskClients, topSpenders] = await Promise.all([
          this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
          this.prisma.client.contact.count({
            where: { businessId, deletedAt: null, status: 'LEAD', updatedAt: { lt: fourteenDaysAgo } },
          }),
          this.prisma.client.contact.count({
            where: { businessId, deletedAt: null, status: 'CLIENT', updatedAt: { lt: thirtyDaysAgo } },
          }),
          this.prisma.client.invoice.groupBy({
            by: ['contactId'],
            where: { businessId, deletedAt: null, status: 'PAID' },
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 5,
          }),
        ]);

        const topSpenderIds = topSpenders.map(s => s.contactId);
        const topSpenderContacts = topSpenderIds.length > 0
          ? await this.prisma.client.contact.findMany({
              where: { id: { in: topSpenderIds }, businessId },
              select: { id: true, firstName: true, lastName: true, email: true },
            })
          : [];

        return {
          totalContacts,
          staleLeads,
          atRiskClients,
          topSpenders: topSpenders.map(s => {
            const c = topSpenderContacts.find(tc => tc.id === s.contactId);
            return { contactId: s.contactId, name: c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : 'Unknown', totalSpend: s._sum.total ?? 0 };
          }),
          healthScore: totalContacts > 0 ? Math.max(0, 100 - Math.round((staleLeads + atRiskClients) / totalContacts * 100)) : 0,
        };
      }

      case 'fetch_schedule_health': {
        const daysAhead = args.days ?? 7;
        const now = new Date();
        const futureDate = new Date(now.getTime() + daysAhead * 86400000);

        const [upcomingBookings, totalServices, cancelledRecent] = await Promise.all([
          this.prisma.client.booking.findMany({
            where: { businessId, deletedAt: null, startTime: { gte: now, lte: futureDate }, status: { in: ['PENDING', 'CONFIRMED'] } },
            select: { id: true, startTime: true, endTime: true, status: true },
            orderBy: { startTime: 'asc' },
          }),
          this.prisma.client.service.count({ where: { businessId, deletedAt: null } }),
          this.prisma.client.booking.count({
            where: { businessId, deletedAt: null, status: 'CANCELLED', updatedAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
          }),
        ]);

        const bookingsByDay: Record<string, number> = {};
        for (const b of upcomingBookings) {
          const day = b.startTime.toISOString().slice(0, 10);
          bookingsByDay[day] = (bookingsByDay[day] ?? 0) + 1;
        }

        const emptyDays = [];
        for (let d = 0; d < daysAhead; d++) {
          const dayStr = new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10);
          if (!bookingsByDay[dayStr]) emptyDays.push(dayStr);
        }

        return {
          totalUpcoming: upcomingBookings.length,
          bookingsByDay,
          emptyDays,
          cancelledLast7Days: cancelledRecent,
          totalServices,
          utilizationPct: daysAhead > 0 ? Math.round((Object.keys(bookingsByDay).length / daysAhead) * 100) : 0,
        };
      }

      case 'fetch_revenue_risk': {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);

        const [overdueInvoices, recentPaid, previousPaid, topClientRevenue] = await Promise.all([
          this.prisma.client.invoice.findMany({
            where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } },
            select: { id: true, invoiceNumber: true, total: true, dueDate: true, contactId: true },
            orderBy: { dueDate: 'asc' },
            take: 20,
          }),
          this.prisma.client.invoice.aggregate({
            where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: thirtyDaysAgo } },
            _sum: { total: true },
            _count: true,
          }),
          this.prisma.client.invoice.aggregate({
            where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
            _sum: { total: true },
            _count: true,
          }),
          this.prisma.client.invoice.groupBy({
            by: ['contactId'],
            where: { businessId, deletedAt: null, status: 'PAID' },
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 3,
          }),
        ]);

        const recentRevenue = recentPaid._sum.total ?? 0;
        const previousRevenue = previousPaid._sum.total ?? 0;
        const totalOverdue = overdueInvoices.reduce((s, inv) => s + inv.total, 0);
        const totalPaidAll = await this.prisma.client.invoice.aggregate({
          where: { businessId, deletedAt: null, status: 'PAID' },
          _sum: { total: true },
        });
        const allRevenue = totalPaidAll._sum.total ?? 1;
        const topClientPct = topClientRevenue.length > 0 ? Math.round(((topClientRevenue[0]._sum.total ?? 0) / allRevenue) * 100) : 0;
        const trend = previousRevenue > 0 ? Math.round(((recentRevenue - previousRevenue) / previousRevenue) * 100) : 0;

        return {
          overdueCount: overdueInvoices.length,
          overdueTotal: totalOverdue,
          overdueInvoices: overdueInvoices.slice(0, 5),
          revenueThisMonth: recentRevenue,
          revenueTrend: trend,
          trendLabel: trend > 5 ? 'growing' : trend < -5 ? 'declining' : 'stable',
          topClientConcentration: topClientPct,
          concentrationRisk: topClientPct > 50 ? 'high' : topClientPct > 30 ? 'medium' : 'low',
        };
      }

      case 'fetch_storefront_quality': {
        const products = await this.prisma.client.product.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true, description: true, price: true, category: true, isActive: true, imageUrl: true },
        });

        let score = 100;
        const issues: string[] = [];
        const noDescription = products.filter(p => !p.description || p.description.length < 20);
        const noPrice = products.filter(p => !p.price || p.price <= 0);
        const noImage = products.filter(p => !p.imageUrl);
        const inactive = products.filter(p => !p.isActive);

        if (noDescription.length > 0) {
          score -= Math.min(30, noDescription.length * 5);
          issues.push(`${noDescription.length} product(s) missing descriptions`);
        }
        if (noPrice.length > 0) {
          score -= Math.min(20, noPrice.length * 5);
          issues.push(`${noPrice.length} product(s) with no price`);
        }
        if (noImage.length > 0) {
          score -= Math.min(20, noImage.length * 3);
          issues.push(`${noImage.length} product(s) missing images`);
        }
        if (inactive.length > 0) {
          issues.push(`${inactive.length} inactive product(s)`);
        }
        if (products.length === 0) {
          score = 0;
          issues.push('No products in storefront');
        }

        return {
          totalProducts: products.length,
          activeProducts: products.length - inactive.length,
          qualityScore: Math.max(0, score),
          issues,
          productsNeedingWork: noDescription.map(p => ({ id: p.id, name: p.name, issue: 'missing description' }))
            .concat(noPrice.map(p => ({ id: p.id, name: p.name, issue: 'no price' }))),
        };
      }

      case 'fetch_project_status': {
        const projectWhere: any = { businessId, deletedAt: null };
        if (args.projectId) projectWhere.id = args.projectId;

        const projects = await this.prisma.client.project.findMany({
          where: projectWhere,
          include: {
            tasks: {
              where: { deletedAt: null },
              select: { id: true, title: true, isCompleted: true, dueDate: true, priority: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: args.projectId ? 1 : 20,
        });

        const now = new Date();
        return {
          projects: projects.map(p => {
            const totalTasks = p.tasks.length;
            const completedTasks = p.tasks.filter(t => t.isCompleted).length;
            const overdueTasks = p.tasks.filter(t => !t.isCompleted && t.dueDate && new Date(t.dueDate) < now).length;
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            return {
              id: p.id,
              name: p.name,
              status: p.status,
              priority: p.priority,
              totalTasks,
              completedTasks,
              overdueTasks,
              progress,
              healthLabel: overdueTasks > 0 ? 'at-risk' : progress >= 75 ? 'on-track' : progress >= 25 ? 'in-progress' : 'starting',
            };
          }),
          totalProjects: projects.length,
        };
      }

      case 'fetch_expense_pressure': {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        const [thisMonth, lastMonth, byCategory, revenueThisMonth] = await Promise.all([
          this.prisma.client.expense.aggregate({
            where: { businessId, deletedAt: null, date: { gte: startOfMonth } },
            _sum: { amount: true },
            _count: true,
          }),
          this.prisma.client.expense.aggregate({
            where: { businessId, deletedAt: null, date: { gte: startOfLastMonth, lt: startOfMonth } },
            _sum: { amount: true },
          }),
          this.prisma.client.expense.groupBy({
            by: ['categoryId'],
            where: { businessId, deletedAt: null, date: { gte: startOfMonth } },
            _sum: { amount: true },
            orderBy: { _sum: { amount: 'desc' } },
            take: 10,
          }),
          this.prisma.client.invoice.aggregate({
            where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: startOfMonth } },
            _sum: { total: true },
          }),
        ]);

        const currentExpenses = thisMonth._sum.amount ?? 0;
        const lastMonthExpenses = lastMonth._sum.amount ?? 0;
        const revenue = revenueThisMonth._sum.total ?? 0;
        const momChange = lastMonthExpenses > 0 ? Math.round(((currentExpenses - lastMonthExpenses) / lastMonthExpenses) * 100) : 0;
        const expenseRatio = revenue > 0 ? Math.round((currentExpenses / revenue) * 100) : 0;

        return {
          currentMonthTotal: currentExpenses,
          lastMonthTotal: lastMonthExpenses,
          monthOverMonthChange: momChange,
          trendLabel: momChange > 10 ? 'increasing' : momChange < -10 ? 'decreasing' : 'stable',
          expenseToRevenueRatio: expenseRatio,
          revenueThisMonth: revenue,
          transactionCount: thisMonth._count ?? 0,
          topCategories: byCategory.map(c => ({ categoryId: c.categoryId, total: c._sum.amount ?? 0 })),
          pressure: expenseRatio > 80 ? 'high' : expenseRatio > 50 ? 'moderate' : 'low',
        };
      }

      // ========== DRAFT FAMILY ==========

      case 'draft_followup_message': {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true, status: true, companyName: true },
        });
        if (!contact) throw new Error('Contact not found');

        const recentNotes = await this.prisma.client.contactNote.findMany({
          where: { contactId: args.contactId, businessId },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { body: true, createdAt: true },
        });

        const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email || 'there';
        const channel = args.channel ?? 'email';
        const tone = args.tone ?? 'friendly';
        const notesCtx = recentNotes.map(n => n.body).join('\n') || 'No recent notes.';

        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'flow_draft_followup',
          messages: [
            { role: 'system', content: `Draft a ${tone} follow-up ${channel} message for ${name} (${contact.status}). Company: ${contact.companyName ?? 'N/A'}. Recent notes:\n${notesCtx}\n\nRespond ONLY with valid JSON: {"subject":"...","body":"...","callToAction":"..."}` },
            { role: 'user', content: `Draft a ${tone} follow-up for ${name} via ${channel}.` },
          ],
          maxTokens: 500,
          temperature: 0.6,
          outputCategory: 'messages',
        });

        try {
          const parsed = JSON.parse(result.content);
          return { subject: parsed.subject ?? '', body: parsed.body ?? '', channel, contactName: name };
        } catch {
          return { subject: `Follow up with ${name}`, body: result.content, channel, contactName: name };
        }
      }

      case 'draft_campaign_bundle': {
        const objective = args.objective;
        const audience = args.audience ?? 'all contacts';
        const tone = args.tone ?? 'professional';

        const business = await this.prisma.client.business.findUnique({
          where: { id: businessId },
          select: { name: true, industry: true },
        });

        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'flow_draft_campaign',
          messages: [
            { role: 'system', content: `You are a Caribbean marketing expert. Draft a campaign bundle for "${business?.name ?? 'this business'}" (${business?.industry ?? 'general'}).\nObjective: ${objective}\nAudience: ${audience}\nTone: ${tone}\n\nRespond ONLY with valid JSON: {"name":"...","subject":"...","preheader":"...","body":"...","callToAction":"...","suggestedSendTime":"..."}` },
            { role: 'user', content: `Create a ${tone} campaign for: ${objective}` },
          ],
          maxTokens: 800,
          temperature: 0.7,
          outputCategory: 'messages',
        });

        try {
          const parsed = JSON.parse(result.content);
          return { subject: parsed.subject ?? objective, body: parsed.body ?? '', cta: parsed.callToAction ?? '', audience };
        } catch {
          return { subject: objective, body: result.content, cta: '', audience };
        }
      }

      case 'draft_payment_reminder': {
        const invoice = await this.prisma.client.invoice.findFirst({
          where: { id: args.invoiceId, businessId, deletedAt: null },
          include: {
            contact: { select: { firstName: true, lastName: true, email: true } },
            business: { select: { name: true } },
          },
        });
        if (!invoice) throw new Error('Invoice not found');

        const contactName = invoice.contact ? `${invoice.contact.firstName ?? ''} ${invoice.contact.lastName ?? ''}`.trim() || invoice.contact.email || 'Customer' : 'Customer';
        const now = new Date();
        const daysOverdue = invoice.dueDate ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000)) : 0;
        const urgency = args.urgency ?? (daysOverdue > 14 ? 'firm' : 'gentle');

        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'flow_draft_reminder',
          messages: [
            { role: 'system', content: `Draft a ${urgency} payment reminder for invoice #${invoice.invoiceNumber} ($${invoice.total} ${invoice.currency}) to ${contactName}. Days overdue: ${daysOverdue}. Business: ${invoice.business?.name ?? 'our business'}.\n\nRespond ONLY with valid JSON: {"subject":"...","body":"...","tone":"${urgency}"}` },
            { role: 'user', content: `Draft a ${urgency} payment reminder for invoice #${invoice.invoiceNumber}.` },
          ],
          maxTokens: 500,
          temperature: 0.5,
          outputCategory: 'messages',
        });

        try {
          const parsed = JSON.parse(result.content);
          return { subject: parsed.subject ?? `Payment Reminder - #${invoice.invoiceNumber}`, body: parsed.body ?? '', invoiceNumber: invoice.invoiceNumber, amountDue: Number(invoice.total) };
        } catch {
          return { subject: `Payment Reminder - #${invoice.invoiceNumber}`, body: result.content, invoiceNumber: invoice.invoiceNumber, amountDue: Number(invoice.total) };
        }
      }

      case 'draft_storefront_copy': {
        const product = await this.prisma.client.product.findFirst({
          where: { id: args.productId, businessId, deletedAt: null },
          select: { id: true, name: true, description: true, price: true, category: true, currency: true },
        });
        if (!product) throw new Error('Product not found');

        const style = args.style ?? 'benefit-focused';
        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'flow_draft_storefront',
          messages: [
            { role: 'system', content: `Write ${style} storefront copy for "${product.name}" ($${product.price} ${product.currency}, category: ${product.category}). Current description: "${product.description ?? 'None'}".\n\nRespond ONLY with valid JSON: {"headline":"...","description":"...","bulletPoints":["..."],"seoMetaDescription":"..."}` },
            { role: 'user', content: `Write ${style} product copy for "${product.name}".` },
          ],
          maxTokens: 600,
          temperature: 0.7,
          outputCategory: 'general',
        });

        try {
          const parsed = JSON.parse(result.content);
          return { productName: product.name, description: parsed.description ?? '', tagline: parsed.headline ?? product.name };
        } catch {
          return { productName: product.name, description: result.content, tagline: product.name };
        }
      }

      case 'draft_project_update': {
        const project = await this.prisma.client.project.findFirst({
          where: { id: args.projectId, businessId, deletedAt: null },
          include: {
            tasks: {
              where: { deletedAt: null },
              select: { title: true, isCompleted: true, dueDate: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        });
        if (!project) throw new Error('Project not found');

        const totalTasks = project.tasks.length;
        const completedTasks = project.tasks.filter(t => t.isCompleted).length;
        const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const includeTimeline = args.includeTimeline !== false;

        const taskSummary = project.tasks.slice(0, 10).map(t => `- ${t.isCompleted ? '✓' : '○'} ${t.title}${t.dueDate ? ` (due ${new Date(t.dueDate).toLocaleDateString('en-TT')})` : ''}`).join('\n');

        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'flow_draft_project_update',
          messages: [
            { role: 'system', content: `Draft a professional project status update for "${project.name}" (${project.status}, ${progress}% complete, ${completedTasks}/${totalTasks} tasks done).${includeTimeline ? `\nTasks:\n${taskSummary}` : ''}\n\nRespond ONLY with valid JSON: {"subject":"...","body":"...","nextSteps":["..."]}` },
            { role: 'user', content: `Draft a client-facing update for project "${project.name}".` },
          ],
          maxTokens: 600,
          temperature: 0.6,
          outputCategory: 'messages',
        });

        try {
          const parsed = JSON.parse(result.content);
          return { subject: parsed.subject ?? `Update: ${project.name}`, body: parsed.body ?? '', projectName: project.name, progress };
        } catch {
          return { subject: `Update: ${project.name}`, body: result.content, projectName: project.name, progress };
        }
      }

      // ========== ORGANIZE FAMILY ==========

      case 'create_task': {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId, deletedAt: null },
          select: { id: true },
        });
        if (!contact) throw new Error('Contact not found');
        const task = await this.prisma.client.contactTask.create({
          data: {
            businessId,
            contactId: args.contactId,
            title: args.title,
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            priority: args.priority ?? 'MEDIUM',
            status: 'OPEN',
            source: 'flow_ai',
          },
        });
        // Auto-assign KEY to tasks it creates
        await this.getTaskAssignment().assign({
          taskType: 'ContactTask',
          taskId: task.id,
          assignableType: 'KEY',
          assignableId: 'key_ai',
          assignedBy: 'key_ai',
          reason: 'Auto-assigned by KEY Operator',
        }).catch(() => { /* ignore assignment errors */ });
        return { id: task.id, title: task.title, contactId: task.contactId };
      }

      case 'create_followup_queue': {
        const staleDays = args.staleDays ?? 14;
        const maxContacts = Math.min(args.maxContacts ?? 20, 50);
        const titleTemplate = args.taskTitle ?? 'Follow up with {name}';
        const cutoff = new Date(Date.now() - staleDays * 86400000);

        const staleContacts = await this.prisma.client.contact.findMany({
          where: { businessId, deletedAt: null, status: { in: ['LEAD', 'PROSPECT'] }, updatedAt: { lt: cutoff } },
          select: { id: true, firstName: true, lastName: true, email: true },
          take: maxContacts,
          orderBy: { updatedAt: 'asc' },
        });

        const createdTasks = [];
        for (const c of staleContacts) {
          const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || 'Contact';
          const task = await this.prisma.client.contactTask.create({
            data: {
              businessId,
              contactId: c.id,
              title: titleTemplate.replace('{name}', name),
              priority: 'HIGH',
              status: 'OPEN',
              source: 'flow_ai',
              dueDate: new Date(Date.now() + 2 * 86400000),
            },
          });
          createdTasks.push({ taskId: task.id, contactId: c.id, contactName: name });
        }

        return { created: createdTasks.length, contacts: createdTasks };
      }

      case 'tag_contact': {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId, deletedAt: null },
          select: { id: true, tags: true },
        });
        if (!contact) throw new Error('Contact not found');

        const existingTags = contact.tags ?? [];
        const newTags = Array.isArray(args.tags) ? args.tags : [args.tags];
        const mergedTags = [...new Set([...existingTags, ...newTags])];

        const updated = await this.prisma.client.contact.update({
          where: { id: args.contactId },
          data: { tags: mergedTags },
          select: { id: true, firstName: true, lastName: true, tags: true },
        });

        return { contactId: updated.id, tags: mergedTags };
      }

      case 'segment_contacts': {
        const where: any = { businessId, deletedAt: null };
        if (args.status) where.status = args.status;
        if (args.tag) where.tags = { has: args.tag };

        let contacts = await this.prisma.client.contact.findMany({
          where,
          select: { id: true, firstName: true, lastName: true, email: true, status: true },
        });

        if (args.minSpend) {
          const spenders = await this.prisma.client.invoice.groupBy({
            by: ['contactId'],
            where: { businessId, deletedAt: null, status: 'PAID' },
            _sum: { total: true },
            having: { total: { _sum: { gte: args.minSpend } } },
          });
          const spenderIds = new Set(spenders.map(s => s.contactId));
          contacts = contacts.filter(c => spenderIds.has(c.id));
        }

        return {
          segmentName: args.name,
          criteria: args.criteria ?? `Status: ${args.status ?? 'any'}, Tag: ${args.tag ?? 'any'}, Min Spend: ${args.minSpend ?? 'any'}`,
          matchedCount: contacts.length,
          contacts: contacts.slice(0, 50),
        };
      }

      case 'schedule_action': {
        let parsedPayload = null;
        if (args.payload) {
          try { parsedPayload = JSON.parse(args.payload); }
          catch { parsedPayload = { raw: args.payload }; }
        }
        const scheduledAction = await this.prisma.client.activity.create({
          data: {
            businessId,
            module: 'ai',
            action: 'scheduled_action',
            entityType: args.actionType,
            entityId: args.targetId ?? null,
            title: args.description,
            detail: JSON.stringify({
              actionType: args.actionType,
              scheduledFor: args.scheduledFor,
              payload: parsedPayload,
              status: 'scheduled',
            }),
            tone: 'info',
          },
        });

        return {
          id: scheduledAction.id,
          actionType: args.actionType,
          scheduledFor: args.scheduledFor,
          description: args.description,
          status: 'scheduled',
        };
      }

      // ========== EXECUTE FAMILY ==========

      case 'queue_campaign': {
        const campaign = await this.prisma.client.emailCampaign.findFirst({
          where: { id: args.campaignId, businessId },
        });
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'DRAFT') throw new Error(`Campaign must be in DRAFT status to queue (current: ${campaign.status})`);

        const sendDate = new Date(args.scheduledAt);
        if (isNaN(sendDate.getTime())) throw new Error('Invalid scheduledAt date format');

        const updated = await this.prisma.client.emailCampaign.update({
          where: { id: args.campaignId },
          data: { status: 'SCHEDULED', scheduledAt: sendDate },
        });

        return { id: updated.id, name: updated.name, status: updated.status, scheduledAt: updated.scheduledAt };
      }

      case 'send_message_with_approval': {
        const contact = await this.prisma.client.contact.findFirst({
          where: { id: args.contactId, businessId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
        if (!contact) throw new Error('Contact not found');

        // Actually send the message
        const result = await this.messageSender.sendMessage({
          businessId,
          contactId: args.contactId,
          channel: args.channel,
          subject: args.subject,
          body: args.body,
          fromName: args.fromName,
        });

        // Store a note of what was sent
        await this.prisma.client.contactNote.create({
          data: {
            contactId: args.contactId,
            businessId,
            body: `[${args.channel.toUpperCase()} Sent]\nSubject: ${args.subject ?? 'N/A'}\n\n${args.body}\n\nStatus: ${result.success ? 'Delivered' : 'Failed'}${result.messageId ? ` (ID: ${result.messageId})` : ''}${result.error ? `\nError: ${result.error}` : ''}`,
            source: 'flow_ai',
          },
        });

        await this.prisma.client.activity.create({
          data: {
            businessId,
            module: 'ai',
            action: result.success ? 'message_sent' : 'message_failed',
            entityType: 'contact',
            entityId: args.contactId,
            title: `Message ${result.success ? 'sent' : 'failed'} to ${contact.firstName ?? ''} ${contact.lastName ?? ''} via ${args.channel}`,
            detail: args.body.slice(0, 200),
            tone: result.success ? 'success' : 'warning',
          },
        });

        return {
          id: contact.id,
          contactName: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim(),
          channel: args.channel,
          status: result.success ? 'sent' : 'failed',
          messageId: result.messageId,
          error: result.error,
        };
      }

      case 'apply_storefront_recommendation': {
        const product = await this.prisma.client.product.findFirst({
          where: { id: args.productId, businessId, deletedAt: null },
        });
        if (!product) throw new Error('Product not found');

        const updateData: Record<string, any> = {};
        if (args.description !== undefined) updateData.description = args.description;
        if (args.price !== undefined) updateData.price = args.price;
        if (args.category !== undefined) updateData.category = args.category;

        if (Object.keys(updateData).length === 0) throw new Error('No updates specified');

        const updated = await this.catalog.updateProduct({ businessId, productId: args.productId, ...updateData });

        return {
          id: updated.id,
          name: updated.name,
          fieldsUpdated: Object.keys(updateData),
        };
      }

      case 'enable_flow_with_approval': {
        const playbook = await this.prisma.client.automation.findFirst({
          where: { id: args.playbookId, businessId, deletedAt: null },
        });
        if (!playbook) throw new Error('Playbook not found');

        const updated = await this.prisma.client.automation.update({
          where: { id: args.playbookId },
          data: { enabled: true },
        });

        return { id: updated.id, name: updated.name, status: updated.enabled ? 'ACTIVE' : 'INACTIVE' };
      }

      case 'update_status_with_confirmation': {
        const entityType = args.entityType;
        const ids: string[] = Array.isArray(args.ids) ? args.ids : [args.ids];
        const newStatus = args.newStatus;

        if (entityType === 'contact') {
          const result = await this.prisma.client.contact.updateMany({
            where: { id: { in: ids }, businessId, deletedAt: null },
            data: { status: newStatus },
          });
          return { entityType, updatedCount: result.count, newStatus };
        }

        if (entityType === 'invoice') {
          const updateData: any = { status: newStatus };
          if (newStatus === 'PAID') updateData.paidAt = new Date();
          const result = await this.prisma.client.invoice.updateMany({
            where: { id: { in: ids }, businessId, deletedAt: null },
            data: updateData,
          });
          return { entityType, updatedCount: result.count, newStatus };
        }

        throw new Error(`Unsupported entity type: ${entityType}`);
      }

      // ----------------------------------------------------------------
      //  PROJECTS
      // ----------------------------------------------------------------
      case 'projects_list': {
        const limit = args.limit ?? 25;
        const where: any = { businessId, deletedAt: null };
        if (args.status) where.status = args.status;
        const projects = await this.prisma.client.project.findMany({
          where,
          include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        return {
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            priority: (p as any).priority ?? null,
            dueDate: p.dueDate?.toISOString() ?? null,
            taskCount: (p as any)._count?.tasks ?? 0,
          })),
        };
      }

      case 'projects_list_tasks': {
        const where: any = { businessId, deletedAt: null };
        if (args.projectId) where.projectId = args.projectId;
        if (args.onlyOpen) where.isCompleted = false;
        const tasks = await this.prisma.client.projectTask.findMany({
          where,
          include: { project: { select: { id: true, name: true } } },
          orderBy: [{ isCompleted: 'asc' }, { dueDate: 'asc' }],
          take: 100,
        });
        return { tasks };
      }

      case 'projects_create_task': {
        const project = await this.prisma.client.project.findFirst({
          where: { id: args.projectId, businessId, deletedAt: null },
          select: { id: true },
        });
        if (!project) throw new Error('Project not found');
        const task = await this.prisma.client.projectTask.create({
          data: {
            businessId,
            projectId: args.projectId,
            title: args.title,
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            priority: args.priority ?? 'NORMAL',
          },
        });
        // Auto-assign KEY to tasks it creates
        await this.getTaskAssignment().assign({
          taskType: 'ProjectTask',
          taskId: task.id,
          assignableType: 'KEY',
          assignableId: 'key_ai',
          assignedBy: 'key_ai',
          reason: 'Auto-assigned by KEY Operator',
        }).catch(() => { /* ignore assignment errors */ });
        return { task };
      }

      case 'projects_complete_task': {
        const existing = await this.prisma.client.projectTask.findFirst({
          where: { id: args.taskId, businessId, deletedAt: null },
        });
        if (!existing) throw new Error('Task not found');
        const task = await this.prisma.client.projectTask.update({
          where: { id: args.taskId },
          data: { isCompleted: true },
        });
        return { task };
      }

      // ----------------------------------------------------------------
      //  EXPENSES
      // ----------------------------------------------------------------
      case 'expenses_list': {
        const sinceDays = args.sinceDays ?? 30;
        const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
        const expenses = await this.prisma.client.expense.findMany({
          where: { businessId, deletedAt: null, date: { gte: since } },
          orderBy: { date: 'desc' },
          take: args.limit ?? 25,
        });
        return { expenses };
      }

      case 'expenses_create': {
        const expense = await this.prisma.client.expense.create({
          data: {
            businessId,
            amount: args.amount,
            description: args.description,
            date: args.date ? new Date(args.date) : new Date(),
            vendor: args.vendor ?? null,
          } as any,
        });
        return { expense };
      }

      // ----------------------------------------------------------------
      //  DOCUMENTS
      // ----------------------------------------------------------------
      case 'documents_list': {
        const where: any = { businessId };
        if (args.status) where.status = args.status;
        const documents = await this.prisma.client.documentInstance.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 25,
          select: { id: true, title: true, status: true, createdAt: true, updatedAt: true },
        });
        return { documents };
      }

      case 'documents_search': {
        const query = String(args.query ?? '').trim();
        if (!query) return { documents: [] };
        const documents = await this.prisma.client.documentInstance.findMany({
          where: { businessId, title: { contains: query, mode: 'insensitive' } },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: { id: true, title: true, status: true, updatedAt: true },
        });
        return { documents };
      }

      // ----------------------------------------------------------------
      //  COMMUNITY
      // ----------------------------------------------------------------
      case 'community_list_posts': {
        const posts = await this.prisma.client.communityPost.findMany({
          where: { deletedAt: null } as any,
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 20,
          select: {
            id: true,
            title: true,
            content: true,
            type: true,
            tags: true,
            likes: true,
            createdAt: true,
            businessId: true,
          } as any,
        });
        return { posts };
      }

      // ----------------------------------------------------------------
      //  MARKETPLACE
      // ----------------------------------------------------------------
      case 'marketplace_list_listings': {
        const where: any = { businessId };
        if (args.status) where.status = args.status;
        const listings = await this.prisma.client.marketplaceListing.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 25,
        });
        return { listings };
      }

      case 'marketplace_list_orders': {
        const orders = await this.prisma.client.marketplaceOrder.findMany({
          where: { businessId } as any,
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 25,
        });
        return { orders };
      }

      // ----------------------------------------------------------------
      //  STORE
      // ----------------------------------------------------------------
      case 'store_list_products': {
        const products = await this.prisma.client.product.findMany({
          where: { businessId, deletedAt: null } as any,
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 25,
          select: {
            id: true,
            name: true,
            price: true,
            currency: true,
            category: true,
            isActive: true,
          } as any,
        });
        return { products };
      }

      case 'store_list_recent_orders': {
        const orders = await this.prisma.client.invoice.findMany({
          where: { businessId, deletedAt: null, status: 'PAID' },
          orderBy: { paidAt: 'desc' },
          take: args.limit ?? 25,
          include: { contact: { select: { id: true, firstName: true, lastName: true } } },
        });
        return { orders };
      }

      // ----------------------------------------------------------------
      //  KEYFLOW NOTES — universal note tool
      // ----------------------------------------------------------------
      case 'keyflow_create_note': {
        const note = await this.prisma.client.keyflowNote.create({
          data: {
            businessId,
            targetType: args.targetType,
            targetId: args.targetId,
            targetLabel: args.targetLabel ?? null,
            body: args.body ?? '',
            pinned: args.pinned ?? false,
          },
        });
        return { note };
      }

      // ========== SEO FAMILY (Phase 9) ==========

      case 'fetch_seo_dashboard': {
        const [pages, keywords, issues, briefs] = await Promise.all([
          this.prisma.client.seoPage.aggregate({
            where: { businessId },
            _count: true,
            _sum: { clicks: true, impressions: true, conversions: true, revenue: true },
          }),
          this.prisma.client.seoKeyword.count({ where: { businessId, isTracked: true } }),
          this.prisma.client.seoIssue.count({ where: { businessId, status: 'open' } }),
          this.prisma.client.contentBrief.count({ where: { businessId, status: 'draft' } }),
        ]);
        return {
          totalPages: pages._count,
          trackedKeywords: keywords,
          openIssues: issues,
          pendingBriefs: briefs,
          totalClicks: pages._sum.clicks ?? 0,
          totalImpressions: pages._sum.impressions ?? 0,
          totalConversions: pages._sum.conversions ?? 0,
          totalRevenue: pages._sum.revenue ?? 0,
        };
      }

      case 'fetch_seo_keywords': {
        const where: any = { businessId, isTracked: true };
        if (args.trend) where.trend = args.trend;
        const keywords = await this.prisma.client.seoKeyword.findMany({
          where,
          orderBy: { clicks: 'desc' },
          take: 50,
          select: {
            id: true, keyword: true, currentPosition: true, previousPosition: true,
            positionChange: true, trend: true, clicks: true, impressions: true, ctr: true,
          },
        });
        return { keywords };
      }

      case 'fetch_seo_issues': {
        const where: any = { businessId, status: 'open' };
        if (args.severity) where.severity = args.severity;
        const issues = await this.prisma.client.seoIssue.findMany({
          where,
          orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
          take: 50,
        });
        return { issues };
      }

      case 'fetch_content_gaps': {
        const trackedKeywords = await this.prisma.client.seoKeyword.findMany({
          where: { businessId, isTracked: true },
        });
        const gaps = trackedKeywords
          .map(kw => {
            let opportunityScore = 0;
            let reason = '';
            if (!kw.pageId) {
              opportunityScore = 80;
              reason = 'No dedicated page targeting this keyword';
            } else if (kw.currentPosition && kw.currentPosition > 10 && kw.currentPosition <= 30) {
              opportunityScore = 70;
              reason = `Ranking on page 2-3 (position ${kw.currentPosition})`;
            } else if (kw.impressions > 100 && kw.ctr < 0.02) {
              opportunityScore = 50;
              reason = 'High impressions, low CTR — meta needs optimization';
            }
            return opportunityScore > 0
              ? { keyword: kw.keyword, currentPosition: kw.currentPosition, opportunityScore, reason }
              : null;
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.opportunityScore - a.opportunityScore);
        return { gaps };
      }

      case 'fetch_seo_revenue_attribution': {
        const totals = await this.prisma.client.seoPage.aggregate({
          where: { businessId },
          _sum: { organicSessions: true, conversions: true, revenue: true },
        });
        const topRevenuePages = await this.prisma.client.seoPage.findMany({
          where: { businessId, conversions: { gt: 0 } },
          orderBy: { revenue: 'desc' },
          take: 10,
          select: {
            id: true, url: true, path: true, title: true,
            organicSessions: true, conversions: true, revenue: true,
          },
        });
        return {
          totalOrganicSessions: totals._sum.organicSessions ?? 0,
          totalConversions: totals._sum.conversions ?? 0,
          totalRevenue: totals._sum.revenue ?? 0,
          topRevenuePages,
        };
      }

      case 'sync_seo_pages': {
        const business = await this.prisma.client.business.findFirst({
          where: { id: businessId, deletedAt: null },
          select: { slug: true, name: true },
        });
        if (!business?.slug) return { synced: 0 };
        const baseUrl = `/book/${business.slug}`;
        await this.prisma.client.seoPage.upsert({
          where: { businessId_path: { businessId, path: baseUrl } },
          create: { businessId, url: baseUrl, path: baseUrl, pageType: 'storefront', title: business.name ?? 'Storefront' },
          update: { title: business.name ?? 'Storefront' },
        });
        return { synced: 1, message: 'Storefront page synced. Use the SEO workspace for full inventory sync.' };
      }

      case 'generate_content_brief': {
        const brief = await this.prisma.client.contentBrief.create({
          data: {
            businessId,
            title: `Content brief: ${args.targetKeyword}`,
            targetKeyword: args.targetKeyword,
            contentType: args.contentType ?? 'article',
            status: 'draft',
            priority: 'medium',
            approvalStatus: 'pending',
            contentGapSource: args.notes ?? null,
          },
        });
        return { brief, message: 'Brief stub created. Use the SEO workspace to generate full AI brief.' };
      }

      // === CONTENT OPS ===
      case 'content_list_requests': {
        const result = await this.getContentRequest().listForBusiness(businessId, {
          status: args.status,
          limit: args.limit ?? 25,
          offset: 0,
        });
        return { items: result.items, total: result.total };
      }
      case 'content_get_request': {
        const request = await this.getContentRequest().getById(args.requestId);
        return { request };
      }
      case 'content_create_request': {
        const request = await this.getContentRequest().createRequest({
          businessId,
          requestedBy: 'key_ai',
          source: 'flow_ai',
          contentTypes: args.contentTypes,
          businessGoal: args.businessGoal,
          targetAudience: args.targetAudience ?? null,
          offer: args.offer ?? null,
          tone: args.tone ?? null,
          dueDate: args.dueDate ?? null,
          priority: args.priority ?? 'NORMAL',
          approvalRequired: args.approvalRequired ?? true,
        });
        return { id: request.id, status: request.status };
      }
      case 'content_assign_request': {
        await this.getContentRequest().assignRequest(args.requestId, args.teamMemberIds, 'key_ai');
        return { requestId: args.requestId, assignedTo: args.teamMemberIds };
      }
      case 'content_transition_status': {
        await this.getContentRequest().transitionStatus(args.requestId, args.newStatus, 'key_ai', args.comment);
        return { requestId: args.requestId, newStatus: args.newStatus };
      }
      case 'content_submit_for_review': {
        await this.getContentRequest().submitForReview(args.requestId, 'key_ai', args.comment);
        return { requestId: args.requestId, status: 'INTERNAL_REVIEW' };
      }
      case 'content_upload_deliverables': {
        await this.getContentRequest().uploadDeliverables(args.requestId, args.fileIds, args.folderId, 'key_ai');
        return { requestId: args.requestId, uploaded: args.fileIds.length };
      }
      case 'content_deliver_request': {
        await this.getContentRequest().deliverRequest(args.requestId, 'key_ai');
        return { requestId: args.requestId, status: 'DELIVERED' };
      }

      // === CALL TASKS ===
      case 'call_list_tasks': {
        const result = await this.getCallLog().listCalls(businessId, {
          status: args.status,
          callerId: args.callerId,
          contactId: args.contactId,
          limit: args.limit ?? 25,
          offset: 0,
        });
        return { items: result.items, total: result.total };
      }
      case 'call_create_task': {
        const log = await this.getCallLog().createCallLog({
          businessId,
          contactId: args.contactId,
          callerId: args.callerId,
          scheduledAt: args.scheduledAt ? new Date(args.scheduledAt) : undefined,
          script: args.script ?? null,
          notes: args.notes ?? null,
        });
        return { id: log.id, contactId: args.contactId };
      }
      case 'call_log_outcome': {
        const completed = await this.getCallLog().completeCall(args.callLogId, {
          outcome: args.outcome,
          duration: args.duration ?? undefined,
          notes: args.notes ?? undefined,
        }, 'key_ai');
        return { callLogId: args.callLogId, outcome: args.outcome };
      }
      case 'call_generate_script': {
        const script = await this.getCallScript().generateScript(businessId, args.callLogId, args.contactId);
        return {
          callLogId: args.callLogId,
          greeting: script.greeting,
          talkingPoints: script.talkingPoints,
          ask: script.ask,
          close: script.close,
          durationEstimate: script.durationEstimate,
        };
      }
      case 'call_schedule_followup': {
        const task = await this.getCallLog().createFollowUpTask(args.callLogId, {
          title: args.title,
          dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
          priority: args.priority ?? 'NORMAL',
          assigneeId: args.assigneeId,
        }, 'key_ai');
        return { taskId: task.id, title: args.title };
      }

      // === EVIDENCE ===
      case 'evidence_list': {
        const result = await this.getEvidence().listForBusiness(businessId, {
          evidenceType: args.evidenceType,
          limit: args.limit ?? 25,
          offset: 0,
        });
        return { items: result.items, total: result.total };
      }
      case 'evidence_submit': {
        const ev = await this.getEvidence().submit({
          businessId,
          evidenceType: args.evidenceType,
          url: args.url,
          storageKey: args.storageKey,
          submittedBy: 'key_ai',
          linkedType: args.linkedType,
          linkedId: args.linkedId,
          metadata: args.metadata ?? {},
        });
        return { id: ev.id, linkedType: args.linkedType, linkedId: args.linkedId };
      }
      case 'evidence_verify': {
        await this.getEvidence().verify({ evidenceId: args.evidenceId, verifierId: 'key_ai' });
        return { evidenceId: args.evidenceId, verified: true };
      }

      // === APPROVALS ===
      case 'approval_list': {
        const result = await this.getApprovalRequest().listForBusiness(businessId, {
          status: args.status,
          requestType: args.requestType,
          limit: args.limit ?? 25,
          offset: 0,
        });
        return { items: result.items, total: result.total };
      }
      case 'approval_create_request': {
        const approval = await this.getApprovalRequest().createRequest({
          businessId,
          requestType: args.requestType,
          requesterId: 'key_ai',
          title: args.title,
          description: args.description ?? null,
          payload: args.payload ?? {},
          threshold: args.threshold ?? undefined,
          steps: args.steps,
        });
        return { id: approval.id, status: approval.status };
      }
      case 'approval_decide_step': {
        const decision = await this.getApprovalRequest().decideStep({
          approvalRequestId: args.approvalRequestId,
          approverId: 'key_ai',
          decision: args.decision,
          comment: args.comment ?? null,
        });
        return { approvalRequestId: args.approvalRequestId, decision: args.decision, newStatus: decision?.status ?? 'unknown' };
      }

      // === DRIVE ===
      case 'drive_create_folder': {
        const folderId = await this.getDrive().createFolder(businessId, args.name, args.parentId);
        return { folderId, name: args.name };
      }
      case 'drive_create_document': {
        const documentId = await this.getDrive().createDoc(businessId, args.title, args.parentId);
        return { documentId, title: args.title };
      }

      // === CALENDAR ===
      case 'calendar_list_events': {
        const where: any = { businessId };
        if (args.startDate) where.startAt = { gte: new Date(args.startDate) };
        if (args.endDate) where.startAt = { ...(where.startAt ?? {}), lte: new Date(args.endDate) };
        if (args.module) where.module = args.module;
        if (args.status) where.status = args.status;
        const events = await this.prisma.client.calendarEvent.findMany({
          where,
          orderBy: { startAt: 'asc' },
          take: args.limit ?? 25,
        });
        return { events, count: events.length };
      }
      case 'calendar_create_event': {
        const event = await this.prisma.client.calendarEvent.create({
          data: {
            businessId,
            title: args.title,
            description: args.description ?? null,
            startAt: new Date(args.startAt),
            endAt: args.endAt ? new Date(args.endAt) : null,
            allDay: args.allDay ?? false,
            type: args.type ?? 'OTHER',
            module: 'GENERAL',
            priority: args.priority ?? 'NORMAL',
            color: args.color ?? null,
            sourceType: 'MANUAL',
            sourceId: businessId,
            status: 'SCHEDULED',
          },
        });
        return { id: event.id, title: event.title, startAt: event.startAt };
      }
      case 'calendar_check_conflicts': {
        const startAt = new Date(args.startAt);
        const endAt = new Date(args.endAt);
        const conflicts = await this.prisma.client.calendarEvent.findMany({
          where: {
            businessId,
            status: { not: 'CANCELLED' },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
          orderBy: { startAt: 'asc' },
          take: 10,
        });
        return { hasConflict: conflicts.length > 0, conflicts };
      }

      // === TIME TRACKING ===
      case 'time_start_timer': {
        const entry = await this.prisma.client.timeEntry.create({
          data: {
            businessId,
            description: args.description,
            startTime: new Date(),
            projectId: args.projectId ?? null,
            taskId: args.taskId ?? null,
            hourlyRate: args.hourlyRate ?? null,
            billable: true,
            userId: 'key_ai',
          },
        });
        return { id: entry.id, startTime: entry.startTime };
      }
      case 'time_stop_timer': {
        const entry = await this.prisma.client.timeEntry.findFirst({
          where: { id: args.timeEntryId, businessId, endTime: null },
        });
        if (!entry) throw new Error('No running timer found for this time entry');
        const now = new Date();
        const durationMs = now.getTime() - entry.startTime.getTime();
        const durationMinutes = Math.round(durationMs / 60000);
        const updated = await this.prisma.client.timeEntry.update({
          where: { id: args.timeEntryId },
          data: { endTime: now, durationMinutes },
        });
        return { id: updated.id, durationMinutes };
      }
      case 'time_log_entry': {
        const start = new Date(args.startTime);
        const end = new Date(args.endTime);
        const durationMinutes = args.durationMinutes ?? Math.round((end.getTime() - start.getTime()) / 60000);
        const entry = await this.prisma.client.timeEntry.create({
          data: {
            businessId,
            description: args.description,
            startTime: start,
            endTime: end,
            durationMinutes,
            projectId: args.projectId ?? null,
            taskId: args.taskId ?? null,
            hourlyRate: args.hourlyRate ?? null,
            billable: args.billable ?? true,
            userId: 'key_ai',
          },
        });
        return { id: entry.id, durationMinutes };
      }

      // === HELPDESK ===
      case 'helpdesk_list_tickets': {
        const where: any = { businessId, deletedAt: null };
        if (args.status) where.status = args.status;
        if (args.priority) where.priority = args.priority;
        const tickets = await this.prisma.client.supportTicket.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 25,
          include: { contact: { select: { firstName: true, lastName: true, email: true } } },
        });
        return { tickets, count: tickets.length };
      }
      case 'helpdesk_create_ticket': {
        const ticket = await this.prisma.client.supportTicket.create({
          data: {
            businessId,
            title: args.title,
            description: args.description ?? null,
            contactId: args.contactId ?? null,
            priority: args.priority ?? 'NORMAL',
            source: args.source ?? 'MANUAL',
            status: 'OPEN',
          },
        });
        return { id: ticket.id, title: ticket.title, status: ticket.status };
      }
      case 'helpdesk_update_ticket': {
        const updateData: Record<string, any> = {};
        if (args.status !== undefined) updateData.status = args.status;
        if (args.priority !== undefined) updateData.priority = args.priority;
        if (args.assignedToId !== undefined) updateData.assignedToId = args.assignedToId;
        const ticket = await this.prisma.client.supportTicket.update({
          where: { id: args.ticketId, businessId },
          data: updateData,
        });
        return { id: ticket.id, status: ticket.status };
      }

      // === FINANCE ===
      case 'finance_view_receivables': {
        const asOf = args.asOfDate ? new Date(args.asOfDate) : new Date();
        const outstanding = await this.prisma.client.invoice.findMany({
          where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE'] } },
          include: { contact: { select: { firstName: true, lastName: true } } },
        });
        const buckets = { current: 0, overdue1_30: 0, overdue31_60: 0, overdue61_90: 0, overdue90plus: 0 };
        for (const inv of outstanding) {
          const due = inv.dueDate ? new Date(inv.dueDate) : null;
          if (!due) { buckets.current += Number(inv.total); continue; }
          const daysOverdue = Math.floor((asOf.getTime() - due.getTime()) / 86400000);
          if (daysOverdue <= 0) buckets.current += Number(inv.total);
          else if (daysOverdue <= 30) buckets.overdue1_30 += Number(inv.total);
          else if (daysOverdue <= 60) buckets.overdue31_60 += Number(inv.total);
          else if (daysOverdue <= 90) buckets.overdue61_90 += Number(inv.total);
          else buckets.overdue90plus += Number(inv.total);
        }
        const totalOutstanding = outstanding.reduce((sum, inv) => sum + Number(inv.total), 0);
        return { totalOutstanding, ...buckets, invoices: outstanding.map(i => ({ id: i.id, number: i.invoiceNumber, total: Number(i.total), contact: i.contact })) };
      }
      case 'finance_customer_balance': {
        const [invoicedAgg, paidAgg, invoices] = await Promise.all([
          this.prisma.client.invoice.aggregate({
            where: { businessId, contactId: args.contactId, deletedAt: null },
            _sum: { total: true },
            _count: true,
          }),
          this.prisma.client.invoice.aggregate({
            where: { businessId, contactId: args.contactId, deletedAt: null, status: 'PAID' },
            _sum: { total: true },
          }),
          this.prisma.client.invoice.findMany({
            where: { businessId, contactId: args.contactId, deletedAt: null },
            select: { id: true, invoiceNumber: true, status: true, total: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
        ]);
        const totalInvoiced = Number(invoicedAgg._sum.total ?? 0);
        const totalPaid = Number(paidAgg._sum.total ?? 0);
        return {
          contactId: args.contactId,
          totalInvoiced,
          totalPaid,
          outstanding: totalInvoiced - totalPaid,
          invoiceCount: invoicedAgg._count,
          recentInvoices: invoices,
        };
      }
      case 'finance_list_action_items': {
        const where: any = { businessId };
        if (args.severity) where.severity = args.severity;
        const items = await this.prisma.client.financeActionItem.findMany({
          where,
          orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
          take: args.limit ?? 25,
        });
        return { items, total: items.length };
      }

      // === PROJECT UPDATES ===
      case 'projects_update_task': {
        const updateData: Record<string, any> = {};
        if (args.title !== undefined) updateData.title = args.title;
        if (args.dueDate !== undefined) updateData.dueDate = new Date(args.dueDate);
        if (args.priority !== undefined) updateData.priority = args.priority;
        if (args.isCompleted !== undefined) updateData.isCompleted = args.isCompleted;
        const task = await this.prisma.client.projectTask.update({
          where: { id: args.taskId, businessId },
          data: updateData,
        });
        return { id: task.id, title: task.title };
      }
      case 'projects_delete_task': {
        await this.prisma.client.projectTask.update({
          where: { id: args.taskId, businessId },
          data: { deletedAt: new Date() },
        });
        return { success: true, deletedId: args.taskId };
      }

      // === COMMERCE UPDATES ===
      case 'commerce_update_invoice': {
        const updateData: Record<string, any> = {};
        if (args.status !== undefined) {
          updateData.status = args.status;
          if (args.status === 'PAID') updateData.paidAt = new Date();
        }
        if (args.dueDate !== undefined) updateData.dueDate = new Date(args.dueDate);
        if (args.notes !== undefined) updateData.notes = args.notes;
        const invoice = await this.prisma.client.invoice.update({
          where: { id: args.invoiceId, businessId },
          data: updateData,
        });
        return { id: invoice.id, status: invoice.status };
      }
      case 'commerce_update_product': {
        const updateData: Record<string, any> = {};
        if (args.name !== undefined) updateData.name = args.name;
        if (args.price !== undefined) updateData.price = args.price;
        if (args.description !== undefined) updateData.description = args.description;
        if (args.category !== undefined) updateData.category = args.category;
        if (args.isActive !== undefined) updateData.isActive = args.isActive;
        const product = await this.catalog.updateProduct({ businessId, productId: args.productId, ...updateData });
        return { id: product.id, name: product.name, fieldsUpdated: Object.keys(updateData) };
      }
      case 'commerce_send_invoice': {
        const invoice = await this.prisma.client.invoice.findFirst({
          where: { id: args.invoiceId, businessId },
          include: { contact: { select: { firstName: true, lastName: true, email: true } } },
        });
        if (!invoice) throw new Error('Invoice not found');
        if (!invoice.contact?.email) throw new Error('Contact has no email address');
        const updated = await this.prisma.client.invoice.update({
          where: { id: args.invoiceId },
          data: { status: 'SENT', sentAt: new Date() },
        });
        // Log activity
        await this.prisma.client.activity.create({
          data: {
            businessId,
            module: 'commerce',
            action: 'invoice_sent',
            entityType: 'invoice',
            entityId: invoice.id,
            title: `Invoice ${invoice.invoiceNumber} sent to ${invoice.contact.firstName ?? ''} ${invoice.contact.lastName ?? ''}`,
            tone: 'success',
          },
        });
        return { id: updated.id, status: updated.status };
      }

      // === MARKETING/SOCIAL UPDATES ===
      case 'marketing_update_campaign': {
        const updateData: Record<string, any> = {};
        if (args.name !== undefined) updateData.name = args.name;
        if (args.subject !== undefined) updateData.subject = args.subject;
        if (args.body !== undefined) updateData.body = args.body;
        if (args.scheduledAt !== undefined) updateData.scheduledAt = new Date(args.scheduledAt);
        const campaign = await this.prisma.client.emailCampaign.update({
          where: { id: args.campaignId, businessId },
          data: updateData,
        });
        return { id: campaign.id, name: campaign.name };
      }
      case 'social_update_post': {
        const updateData: Record<string, any> = {};
        if (args.content !== undefined) updateData.content = args.content;
        if (args.scheduledFor !== undefined) {
          updateData.scheduledAt = new Date(args.scheduledFor);
          updateData.status = 'SCHEDULED';
        }
        const post = await this.prisma.client.socialPost.update({
          where: { id: args.postId, businessId },
          data: updateData,
        });
        return { id: post.id, status: post.status };
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
      case 'queue_campaign':
        return `Queue campaign (ID: ${args.campaignId}) for sending at ${args.scheduledAt}`;
      case 'send_message_with_approval':
        return `Send ${args.channel} message to contact (ID: ${args.contactId})`;
      case 'apply_storefront_recommendation':
        return `Update storefront product (ID: ${args.productId})`;
      case 'enable_flow_with_approval':
        return `Enable automation playbook (ID: ${args.playbookId})`;
      case 'update_status_with_confirmation':
        return `Bulk-update ${args.ids?.length ?? 0} ${args.entityType}(s) to status "${args.newStatus}"`;
      case 'create_followup_queue':
        return `Create follow-up tasks for stale contacts (${args.staleDays ?? 14}+ days inactive)`;
      case 'content_create_request':
        return `Create content request: ${args.businessGoal}`;
      case 'content_assign_request':
        return `Assign content request ${args.requestId} to ${args.teamMemberIds?.length ?? 0} member(s)`;
      case 'content_transition_status':
        return `Transition content request ${args.requestId} to "${args.newStatus}"`;
      case 'content_submit_for_review':
        return `Submit content request ${args.requestId} for review`;
      case 'content_upload_deliverables':
        return `Upload ${args.fileIds?.length ?? 0} deliverable(s) to content request ${args.requestId}`;
      case 'content_deliver_request':
        return `Deliver content request ${args.requestId}`;
      case 'call_create_task':
        return `Schedule call to contact ${args.contactId}`;
      case 'call_log_outcome':
        return `Log call outcome: ${args.outcome}`;
      case 'call_generate_script':
        return `Generate call script for call ${args.callLogId}`;
      case 'call_schedule_followup':
        return `Schedule follow-up task from call ${args.callLogId}`;
      case 'evidence_submit':
        return `Submit ${args.evidenceType} evidence for ${args.linkedType} ${args.linkedId}`;
      case 'evidence_verify':
        return `Verify evidence ${args.evidenceId}`;
      case 'approval_create_request':
        return `Create ${args.requestType} approval request: ${args.title}`;
      case 'approval_decide_step':
        return `${args.decision === 'approve' ? 'Approve' : 'Reject'} approval request ${args.approvalRequestId}`;
      case 'drive_create_folder':
        return `Create Drive folder: ${args.name}`;
      case 'drive_create_document':
        return `Create Drive document: ${args.title}`;
      case 'calendar_create_event':
        return `Create calendar event: ${args.title}`;
      case 'calendar_check_conflicts':
        return `Check calendar conflicts for ${args.startAt} - ${args.endAt}`;
      case 'time_start_timer':
        return `Start timer: ${args.description}`;
      case 'time_stop_timer':
        return `Stop timer (ID: ${args.timeEntryId})`;
      case 'time_log_entry':
        return `Log time entry: ${args.description}`;
      case 'helpdesk_create_ticket':
        return `Create support ticket: ${args.title}`;
      case 'helpdesk_update_ticket':
        return `Update ticket ${args.ticketId} (${args.status ? `status → ${args.status}` : ''}${args.priority ? `priority → ${args.priority}` : ''})`;
      case 'finance_view_receivables':
        return 'View accounts receivable aging report';
      case 'finance_customer_balance':
        return `View customer balance (ID: ${args.contactId})`;
      case 'finance_list_action_items':
        return 'List finance action items';
      case 'projects_update_task':
        return `Update project task ${args.taskId}`;
      case 'projects_delete_task':
        return `Delete project task ${args.taskId}`;
      case 'commerce_update_invoice':
        return `Update invoice ${args.invoiceId}`;
      case 'commerce_update_product':
        return `Update product ${args.productId}`;
      case 'commerce_send_invoice':
        return `Send invoice ${args.invoiceId} to customer`;
      case 'marketing_update_campaign':
        return `Update campaign ${args.campaignId}`;
      case 'social_update_post':
        return `Update social post ${args.postId}`;
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
        return `Booking confirmed for ${result?.contactName ?? 'contact'} (ID: ${result?.id ?? ''}).`;
      case 'marketing_send_campaign':
        return `Campaign sent successfully.`;
      case 'social_publish_post':
        return `Post published.`;
      case 'bookings_cancel_booking':
        return `Booking cancelled.`;
      case 'crm_delete_contact':
        return `Contact deleted.`;
      case 'create_task':
        return `Task created: "${result?.title ?? ''}".`;
      case 'create_followup_queue':
        return `Created ${result?.created ?? 0} follow-up tasks.`;
      case 'tag_contact':
        return `Tags updated for contact.`;
      case 'segment_contacts':
        return `Segment "${result?.segmentName ?? ''}" matched ${result?.matchedCount ?? 0} contacts.`;
      case 'queue_campaign':
        return `Campaign queued for sending.`;
      case 'send_message_with_approval':
        return `Message queued for ${result?.contactName ?? 'contact'} via ${result?.channel ?? 'email'}.`;
      case 'apply_storefront_recommendation':
        return `Product updated: ${result?.fieldsUpdated?.join(', ') ?? 'fields'} changed.`;
      case 'enable_flow_with_approval':
        return `Playbook "${result?.name ?? ''}" enabled.`;
      case 'update_status_with_confirmation':
        return `Updated ${result?.updatedCount ?? 0} ${result?.entityType ?? 'entity'}(s) to "${result?.newStatus ?? ''}".`;
      case 'content_create_request':
        return `Content request created (ID: ${result?.id ?? ''}, status: ${result?.status ?? 'DRAFT'}).`;
      case 'content_assign_request':
        return `Content request assigned to ${result?.assignedTo?.length ?? 0} member(s).`;
      case 'content_transition_status':
        return `Content request status updated to "${result?.newStatus ?? ''}".`;
      case 'content_submit_for_review':
        return `Content request submitted for review.`;
      case 'content_upload_deliverables':
        return `${result?.uploaded ?? 0} deliverable(s) uploaded.`;
      case 'content_deliver_request':
        return `Content request delivered.`;
      case 'call_create_task':
        return `Call scheduled (ID: ${result?.id ?? ''}).`;
      case 'call_log_outcome':
        return `Call outcome logged: ${result?.outcome ?? ''}.`;
      case 'call_generate_script':
        return `Call script generated for call ${result?.callLogId ?? ''}.`;
      case 'call_schedule_followup':
        return `Follow-up task created: "${result?.title ?? ''}".`;
      case 'evidence_submit':
        return `Evidence submitted (ID: ${result?.id ?? ''}).`;
      case 'evidence_verify':
        return `Evidence verified.`;
      case 'approval_create_request':
        return `Approval request created (ID: ${result?.id ?? ''}, status: ${result?.status ?? ''}).`;
      case 'approval_decide_step':
        return `Approval ${result?.decision ?? ''}d. Request status: ${result?.newStatus ?? ''}.`;
      case 'drive_create_folder':
        return `Drive folder created: ${result?.name ?? ''}.`;
      case 'drive_create_document':
        return `Drive document created: ${result?.title ?? ''}.`;
      case 'calendar_create_event':
        return `Calendar event created: ${result?.title ?? ''}.`;
      case 'calendar_check_conflicts':
        return result?.hasConflict ? `Found ${result?.conflicts?.length ?? 0} conflict(s).` : 'No conflicts found.';
      case 'time_start_timer':
        return `Timer started (ID: ${result?.id ?? ''}).`;
      case 'time_stop_timer':
        return `Timer stopped. Duration: ${result?.durationMinutes ?? 0} minutes.`;
      case 'time_log_entry':
        return `Time entry logged: ${result?.durationMinutes ?? 0} minutes.`;
      case 'helpdesk_create_ticket':
        return `Support ticket created: ${result?.title ?? ''} (${result?.status ?? ''}).`;
      case 'helpdesk_update_ticket':
        return `Ticket updated. Status: ${result?.status ?? ''}.`;
      case 'finance_view_receivables':
        return `AR Report: $${result?.totalOutstanding ?? 0} outstanding. Current: $${result?.current ?? 0}, 1-30d: $${result?.overdue1_30 ?? 0}, 31-60d: $${result?.overdue31_60 ?? 0}, 61-90d: $${result?.overdue61_90 ?? 0}, 90d+: $${result?.overdue90plus ?? 0}.`;
      case 'finance_customer_balance':
        return `Customer balance: $${result?.outstanding ?? 0} outstanding ($${result?.totalInvoiced ?? 0} invoiced, $${result?.totalPaid ?? 0} paid).`;
      case 'finance_list_action_items':
        return `Found ${result?.total ?? 0} finance action item(s).`;
      case 'projects_update_task':
        return `Project task updated: ${result?.title ?? ''}.`;
      case 'projects_delete_task':
        return `Project task deleted.`;
      case 'commerce_update_invoice':
        return `Invoice updated. Status: ${result?.status ?? ''}.`;
      case 'commerce_update_product':
        return `Product updated: ${result?.fieldsUpdated?.join(', ') ?? 'fields'} changed.`;
      case 'commerce_send_invoice':
        return `Invoice sent. Status: ${result?.status ?? ''}.`;
      case 'marketing_update_campaign':
        return `Campaign updated: ${result?.name ?? ''}.`;
      case 'social_update_post':
        return `Social post updated. Status: ${result?.status ?? ''}.`;
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

  async executePlan(businessId: string, planId: string): Promise<{
    planId: string;
    status: string;
    stepsExecuted: number;
    stepsFailed: number;
    stepsSkipped: number;
    results: Array<{ stepId: string; action: string; status: string; error?: string }>;
  }> {
    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { id: planId, businessId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!plan) throw new NotFoundException(`Plan ${planId} not found`);
    if (plan.status !== 'approved') {
      throw new BadRequestException(`Plan must be in "approved" state to execute (current: "${plan.status}"). Approve the plan first.`);
    }

    await this.planner.updatePlanStatus(planId, businessId, 'executing');

    await this.executionLog.log({
      businessId,
      action: 'plan:start',
      module: 'planner',
      riskTier: plan.maxRiskTier,
      mode: 'plan_execution',
      actor: 'flow',
      rationale: `Executing plan: ${plan.objective}`,
      planId,
      success: true,
      role: plan.role ?? undefined,
    });

    const results: Array<{ stepId: string; action: string; status: string; error?: string }> = [];
    let stepsExecuted = 0;
    let stepsFailed = 0;
    let stepsSkipped = 0;
    const completedStepIds = new Set<string>();

    for (const step of plan.steps) {
      if (step.dependsOn.length > 0) {
        const depsOk = step.dependsOn.every(depId => completedStepIds.has(depId));
        if (!depsOk) {
          await this.planner.updateStepStatus(step.id, 'skipped', null, 'Dependency not met');
          stepsSkipped++;
          results.push({ stepId: step.id, action: step.action, status: 'skipped', error: 'Dependency not met' });
          continue;
        }
      }

      if (step.toolName) {
        const stepRole = (step.role ?? plan.role ?? undefined) as BusinessRole | undefined;
        const decision = await this.governance.evaluate(businessId, step.toolName, undefined, stepRole);
        if (!decision.allowed) {
          await this.planner.updateStepStatus(step.id, 'blocked', null, decision.reason);
          stepsSkipped++;
          results.push({ stepId: step.id, action: step.action, status: 'blocked', error: decision.reason });
          continue;
        }
        if (decision.requiresFormalApproval) {
          await this.governance.createApprovalItem(businessId, {
            toolName: step.toolName,
            title: step.action,
            description: `${step.description ?? step.action} — requires ${decision.requiresAdminApproval ? 'admin' : 'formal'} approval (Tier ${decision.tier})`,
            rationale: decision.reason,
            inputPayload: step.inputPayload as Record<string, any> | undefined,
            planId,
            planStepId: step.id,
          });
          await this.planner.updateStepStatus(step.id, 'awaiting_approval');
          stepsSkipped++;
          results.push({ stepId: step.id, action: step.action, status: 'awaiting_approval' });
          continue;
        }
        if (decision.requiresQuickConfirm) {
          this.logger.log(`Tier 2 quick-confirm for ${step.toolName} implicitly satisfied by plan approval — proceeding`);
        }
      }

      if (!step.toolName) {
        await this.planner.updateStepStatus(step.id, 'completed', { note: 'No tool to execute — informational step' });
        completedStepIds.add(step.id);
        stepsExecuted++;
        results.push({ stepId: step.id, action: step.action, status: 'completed' });
        continue;
      }

      await this.planner.updateStepStatus(step.id, 'executing');
      const startTime = Date.now();

      try {
        const toolResult = await this.executeTool(
          businessId,
          step.toolName,
          (step.inputPayload as Record<string, any>) ?? {},
          undefined,
          { planId, planStepId: step.id, role: step.role ?? plan.role ?? undefined },
        );
        const durationMs = Date.now() - startTime;

        if (toolResult.success) {
          await this.planner.updateStepStatus(step.id, 'completed', toolResult.result, undefined, durationMs);
          completedStepIds.add(step.id);
          stepsExecuted++;
          results.push({ stepId: step.id, action: step.action, status: 'completed' });
        } else {
          await this.planner.updateStepStatus(step.id, 'failed', null, toolResult.error, durationMs);
          stepsFailed++;
          results.push({ stepId: step.id, action: step.action, status: 'failed', error: toolResult.error });
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;
        await this.planner.updateStepStatus(step.id, 'failed', null, errorMessage, durationMs);
        stepsFailed++;
        results.push({ stepId: step.id, action: step.action, status: 'failed', error: errorMessage });
      }
    }

    const finalStatus = stepsFailed > 0 ? 'partial' : stepsSkipped > 0 ? 'partial' : 'completed';
    await this.planner.updatePlanStatus(planId, businessId, finalStatus);

    await this.executionLog.log({
      businessId,
      action: 'plan:complete',
      module: 'planner',
      mode: 'plan_execution',
      actor: 'flow',
      rationale: `Plan finished: ${stepsExecuted} executed, ${stepsFailed} failed, ${stepsSkipped} skipped`,
      planId,
      success: stepsFailed === 0,
      role: plan.role ?? undefined,
    });

    this.businessGraph.invalidateCache(businessId);

    return { planId, status: finalStatus, stepsExecuted, stepsFailed, stepsSkipped, results };
  }

  async executeToolDirect(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
    planId?: string,
    planStepId?: string,
  ): Promise<FlowToolResult> {
    const planContext = planId && planStepId ? { planId, planStepId } : undefined;
    return this.executeTool(businessId, toolName, args, undefined, planContext);
  }

  async autoExecuteToolForMonitoring(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<{ success: boolean; result?: any; error?: string; blocked?: boolean }> {
    const decision = await this.governance.evaluate(businessId, toolName, 'pro_auto');
    if (!decision.allowed) {
      return { success: false, error: decision.reason || `Tool ${toolName} blocked by governance`, blocked: true };
    }

    const startTime = Date.now();
    try {
      this.validateToolInput(toolName, args);
      const rawResult = await this.executeToolAction(businessId, toolName, args);
      const envelope = wrapToolResult(toolName, rawResult);
      const durationMs = Date.now() - startTime;
      const tier = this.governance.getToolTier(toolName);
      this.executionLog.logToolExecution(businessId, toolName, args, envelope, true, durationMs, {
        riskTier: tier,
        mode: 'pro_auto',
        rationale: 'Auto-executed by Pro Auto monitoring engine (governance approved)',
      }).catch((e: unknown) => {
        this.logger.error(`Failed to log auto-execution for ${toolName}: ${e instanceof Error ? e.message : String(e)}`);
      });
      this.businessGraph.invalidateCache(businessId);
      return { success: true, result: envelope.result };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const tier = this.governance.getToolTier(toolName);
      this.executionLog.logToolExecution(businessId, toolName, args, (error as Error).message, false, durationMs, {
        riskTier: tier,
        mode: 'pro_auto',
        rationale: 'Auto-execution attempt by Pro Auto monitoring engine',
      }).catch((e: unknown) => {
        this.logger.error(`Failed to log auto-execution error for ${toolName}: ${e instanceof Error ? e.message : String(e)}`);
      });
      return { success: false, error: (error as Error).message };
    }
  }
}

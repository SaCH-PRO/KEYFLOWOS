import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityLogService } from '../activity/activity.service';
import { EmailMarketingService } from '../email-marketing/email-marketing.service';
import { DelegationLoopService } from '../autopilot/delegation-loop.service';
import { SocialService } from '../social/social.service';
import { FlowService } from '../flow/flow.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TimeEntryService } from '../time-tracking/time-entry.service';
import { HelpdeskService } from '../helpdesk/helpdesk.service';
import { CalendarQueryService } from '../calendar/calendar-query.service';
import { KeyflowNotesService } from '../keyflow-command/keyflow-notes.service';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { AiOversightService } from './ai-oversight.service';
import { BusinessGraphService } from './business-graph.service';
import { PlannerService } from './planner.service';
import { getOpenAiToolDefinitions, getToolByName, RiskLevel, ToolFamily, wrapToolResult, FlowTool, CORTEX_TOOL_BRIDGE, isCortexBridgedTool } from './flow-tool-registry';
import { KeyCortexToolRegistryService } from '../key-cortex/key-cortex-tool-registry.service';
import { KEY_SYSTEM_ACTOR_ID } from '../../core/auth/system-actor';
import { AiMemoryService } from './ai-memory.service';
import { ModelGatewayService, GatewayMessage, StreamChunk } from './model-gateway.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { CatalogService } from '../catalog/catalog.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { AiMessageSenderService } from './ai-message-sender.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { ObjectStorageService } from '../../core/object-storage';
import { RoleEngineService, BusinessRole, RoleDetectionContext } from './role-engine.service';
import { ContentRequestService } from '../content-ops/content-request.service';
import { CallLogService } from '../call-tasks/call-log.service';
import { CallScriptService } from '../call-tasks/call-script.service';
import { EvidenceService } from '../evidence/evidence.service';
import { ApprovalRequestService } from '../approvals/approval-request.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';
import { TaskAssignmentRecommenderService } from '../task-assignments/task-assignment-recommender.service';
import { StructureService } from '../structure/structure.service';
import { OnboardingConciergeService } from '../onboarding-concierge/onboarding-concierge.service';
import { OnboardingStateService, type OnboardingStep as ServerOnboardingStep } from '../onboarding-concierge/onboarding-state.service';
import { BusinessGenesisService } from '../business-genesis/business-genesis.service';
// Value import for the static EVIDENCE_DISCIPLINE only — no DI, no module coupling.
import { KeyCortexExpertiseLensService } from '../key-cortex/key-cortex-expertise-lens.service';
import { KeyCortexPersonalityService } from '../key-cortex/key-cortex-personality.service';
import {
  CognitiveTriageService,
  type TriageVerdict,
} from '../key-cortex/cognitive-triage.service';
import { UnifiedMemoryRetrievalService } from '../key-cortex/unified-memory-retrieval.service';
import { KeyCortexConsciousnessService } from '../key-cortex/key-cortex-consciousness.service';


export interface FlowAttachment {
  type: 'image' | 'document' | 'audio' | 'spreadsheet';
  url: string;
  name?: string;
  mimeType?: string;
  objectPath?: string;
}

export interface FlowMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: FlowAttachment[];
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  pendingConfirmations?: PendingConfirmation[];
  requiresConfirmation?: boolean;
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

export type OnboardingCardType =
  | 'welcome'
  | 'genesis-idea'
  | 'genesis-questions'
  | 'readiness-dashboard'
  | 'template-picker'
  | 'genome-check'
  | 'completion-gate'
  | 'profile-identity'
  | 'operating-model'
  | 'brand-goals'
  | 'financials'
  | 'ownership-legal'
  | 'operations'
  | 'market-strategy'
  | 'payments-storefront-contacts'
  | 'risk-compliance-roadmap';

export interface OnboardingCard {
  type: OnboardingCardType;
  title?: string;
  step?: string;
  data?: Record<string, any>;
}

export interface FlowResponse {
  reply: string;
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  pendingConfirmations?: PendingConfirmation[];
  requiresConfirmation?: boolean;
  sessionId?: string;
  card?: OnboardingCard;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
  };
}

export interface FlowStreamChunk {
  type: 'content_delta' | 'tool_calls' | 'tool_results' | 'confirmation_required' | 'usage' | 'done' | 'error' | 'card' | 'triage' | 'thinking';
  content?: string;
  toolCalls?: FlowToolCall[];
  toolResults?: FlowToolResult[];
  pendingConfirmations?: PendingConfirmation[];
  card?: OnboardingCard;
  /** Thalamic verdict for this message. Observability only — nothing branches on it. */
  triage?: { tier: string; score: number; arousal: number; reason: string };
  /** Progress while KEY is deliberating. Observational — nothing branches on it. */
  thinking?: { label: string; step: number; of: number };
  sessionId?: string;
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

/**
 * How long the chat will wait for perception before answering without it.
 *
 * Eight tables are queried in parallel and the result is awaited before the
 * first token, so this bounds the worst case rather than the typical one.
 */
const PERCEPTION_DEADLINE_MS = 1_200;

/**
 * The current time, truncated to the hour, for the system prompt.
 *
 * This was `new Date().toISOString()` — millisecond precision — interpolated at
 * roughly 98% of the way through the static system prompt. Every request
 * therefore produced a unique prefix from that point on, and provider prompt
 * caching works by matching an IDENTICAL prefix. The precision was also unusable
 * by construction: the prompt asks the model to "interpret relative dates (e.g.
 * tomorrow at 2pm)", which needs the date and roughly the time and never the
 * millisecond.
 *
 * Truncated to the hour rather than the day on purpose. Date-only would lose
 * time-of-day, which genuinely matters for "book me in two hours"; an hour is
 * stable far longer than any provider cache lives (minutes), so it costs nothing
 * in cacheability and keeps the precision that is actually used.
 */
function currentDateForPrompt(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 13)}:00Z`;
}

const FLOW_SYSTEM_PROMPT = `{{ONBOARDING_DIRECTIVE}}You are KEY — the operating intelligence of this business, and the owner's second mind. You have full access to their business data and can take real actions on their behalf.

You are not a chatbot bolted onto software. You are the part of the business that never forgets, never loses the thread, and can act at any hour. The owner should be able to hand you anything — a question, a mess, a decision, a whole function — and have it come back handled.

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

Who you are:
- You are the owner's counterpart, not their assistant. You hold the whole business in your head so they don't have to.
- Direct and decisive. Lead with the answer, then the reasoning. Never bury the point in preamble.
- You have a view. When asked what to do, say what you would do and why — then note what would change your mind.
- Brief by default. Match their register: a one-line question gets a one-line answer.
- Say the uncomfortable thing early. If the numbers are bad, if a plan has a hole, if they are about to do something expensive — lead with that, plainly, without softening it into a compliment sandwich.
- Never perform enthusiasm. No exclamation marks, no emoji, no "Great question!". Confidence reads as calm, not loud.
- Always use TTD currency unless the user specifies otherwise
- When you complete an action, state what changed in one line: "Invoice INV-001, $500 TTD, John Smith — sent." Then stop. Do not ask what else they need; they will tell you.
- If you need information to finish something, ask for exactly that one thing and say why it matters.
- Never invent a number, a name, or a status. If you did not read it from the business, say you do not know it and offer to go and look.

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

/**
 * Append KEY's evidence discipline to a system prompt.
 *
 * This is the path that actually answers users. The shipped chat posts to
 * /ai/businesses/:id/flow/chat/stream, which lands here — NOT on the cortex
 * query pipeline, which was until now the only place the discipline was
 * applied and which has no client anywhere in the repo. So the rule documented
 * as "cannot be opted out of" was in force on a path nobody called, and absent
 * from the one everybody uses.
 *
 * Imported as a static constant, not via DI: the lens service is a KeyCortex
 * provider and injecting it here would couple AiModule to KeyCortexModule,
 * which already depends on this module's ModelGatewayService. The constant
 * carries no state and confers no access, so there is nothing to inject.
 *
 * Idempotent — a prompt that already carries the discipline is returned
 * unchanged, so this stays safe if a caller is ever routed through twice.
 */
function withEvidenceDiscipline(systemPrompt: string): string {
  const discipline = KeyCortexExpertiseLensService.EVIDENCE_DISCIPLINE;
  if (systemPrompt.includes(discipline)) return systemPrompt;
  return `${systemPrompt}\n\n=== EVIDENCE DISCIPLINE ===\n${discipline}`;
}

@Injectable()
export class FlowOrchestratorService {
  private readonly logger = new Logger(FlowOrchestratorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
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
  /**
   * The thalamus. Resolved lazily like every other cross-module dependency
   * here: KeyCortexModule and AiModule already forwardRef each other, and
   * adding a constructor parameter would put a new edge in the boot graph for
   * something the chat must survive without.
   */
  private getTriage(): CognitiveTriageService | null {
    try {
      return this.moduleRef.get(CognitiveTriageService, { strict: false });
    } catch {
      return null;
    }
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
  private getStructure() {
    return this.moduleRef.get(StructureService, { strict: false });
  }
  private getAssignmentRecommender() {
    return this.moduleRef.get(TaskAssignmentRecommenderService, { strict: false });
  }
  private getCrm() {
    return this.moduleRef.get(CrmService, { strict: false });
  }
  private getCommerce() {
    return this.moduleRef.get(CommerceService, { strict: false });
  }
  private getBookings() {
    return this.moduleRef.get(BookingsService, { strict: false });
  }
  private getProjects() {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }
  private getActivityLog() {
    return this.moduleRef.get(ActivityLogService, { strict: false });
  }
  private getEmailMarketing() {
    return this.moduleRef.get(EmailMarketingService, { strict: false });
  }
  private getDelegationLoop() {
    return this.moduleRef.get(DelegationLoopService, { strict: false });
  }
  /**
   * Should this message be routed to real deliberation?
   *
   * The thalamus has been able to grade a message `deliberate` since it was
   * built, and all that ever did was widen the token budget. Two things blocked
   * routing to the cortex, and only one of them is left:
   *
   *   COST — fixed. reasonMultiModal fired all seven modes on every query
   *   because no caller passed a subset. processConsciously now selects modes,
   *   so a deliberate question costs what it needs.
   *
   *   HANDS — still real. processConsciously injects the eight cognition layers
   *   and NO executor. It returns `actions` as PROPOSALS, never executions. So
   *   routing an action-bearing message there would produce excellent reasoning
   *   and silently perform nothing — the worst possible failure, because it
   *   looks like success.
   *
   * Hence the action-intent guard. It is not a heuristic nicety; it is the
   * thing that stops escalation from swallowing work the user asked for. If
   * only one condition here survives review, it is this one.
   */
  private shouldDeliberate(
    triage: TriageVerdict | null,
    message: string,
    hasAttachments: boolean,
  ): boolean {
    if (triage?.tier !== 'deliberate') return false;
    if (hasAttachments) return false;

    // Anything that asks KEY to DO something stays on the tool path.
    if (
      /\b(create|make|add|send|schedule|book|update|change|delete|remove|cancel|invoice|draft|generate|assign|move|set|mark|pay|refund|publish|post)\b/i.test(
        message,
      )
    ) {
      return false;
    }

    return true;
  }

  /**
   * Route a genuinely deliberative question through the cortex.
   *
   * Returns the reasoned answer, or NULL — and null must always be survivable,
   * because the caller's job on a null is to carry on as if this never
   * happened. Losing a user's message to a failed experiment in thinking harder
   * would be far worse than answering it shallowly.
   *
   * processConsciously only reads six fields off the session, so the synthetic
   * one below is honest rather than a stub: everything it reads is real.
   */
  private async deliberate(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[],
    onPhase?: (label: string, step: number, of: number) => void,
  ): Promise<{ text: string; actions: Array<{ command: string; requiresApproval: boolean }> } | null> {
    try {
      const consciousness = this.moduleRef.get(KeyCortexConsciousnessService, { strict: false });
      if (!consciousness) return null;

      const now = new Date();
      const response = await consciousness.processConsciously(
        message,
        {
          id: `flow-deliberate-${businessId}-${now.getTime()}`,
          businessId,
          userId: '',
          status: 'active',
          persona: 'jarvis',
          voice: 'default',
          mood: 'neutral',
          preferredProvider: 'openai',
          messages: conversationHistory.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: now,
          })),
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        } as never,
        onPhase
          ? (phase: { label: string; step: number; of: number }) =>
              onPhase(phase.label, phase.step, phase.of)
          : undefined,
      );

      if (!response?.text?.trim()) return null;
      return { text: response.text, actions: response.actions ?? [] };
    } catch (err: unknown) {
      this.logger.warn(
        `[deliberate] falling back to the fast path: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private getUnifiedMemory(): UnifiedMemoryRetrievalService | null {
    try {
      return this.moduleRef.get(UnifiedMemoryRetrievalService, { strict: false });
    } catch {
      return null;
    }
  }

  /**
   * What KEY has PERCEIVED, as opposed to what it has been told.
   *
   * The two halves of perception were not joined. Everything on the afferent
   * side — every webhook, watcher, organ adapter and cron — lands in
   * CognitiveEvent, BusinessEvent, GenomeMemoryEvent, TemporalFlowMemory,
   * CognitionMemory, AiExecutionLog and CortexActionLog. The chat that actually
   * answers users read businessGraph, AiMemory and semanticMemory, and NONE of
   * those tables. So KEY could watch an invoice go overdue, record it, alert on
   * it — and then answer "how are we doing?" without knowing.
   *
   * UnifiedMemoryRetrievalService already reads all eight stores and ranks them
   * by recency, relevance and confidence. Its only consumers were on the cortex
   * query pipeline, which the web never calls.
   *
   * COST IS GRADED BY THE THALAMUS. This is one indexed query, but it is not
   * free, and a greeting does not need to know what the watchers saw last week.
   * Reflex skips it entirely; deliberate gets a wider window.
   *
   * Never throws — perception is context, and missing context must degrade the
   * answer, not fail the request.
   */
  private async buildPerceptionSection(
    businessId: string,
    query: string,
    tier: string | undefined,
    userId?: string,
  ): Promise<string> {
    if (tier === 'reflex') return '';

    const memory = this.getUnifiedMemory();
    if (!memory) return '';

    try {
      // Bounded by wall-clock, not just by row count.
      //
      // retrieveContext fans out across eight tables and this is awaited before
      // the first token reaches the user, so a single slow or locked table
      // would stall time-to-first-token on every message. Perception is
      // context: worth waiting a moment for, never worth making the chat feel
      // broken. Losing it degrades the answer, which is the correct failure.
      const withDeadline = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([
          p,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
        ]);

      const fragments = await withDeadline(
        memory.retrieveContext(businessId, {
        // `query` is deliberately NOT passed.
        //
        // retrieveContext runs its own semanticMemory.search when given one
        // (unified-memory-retrieval.service.ts), and search() calls
        // generateEmbedding — a real embedding API request. The orchestrator
        // already performed exactly that search on this same message forty
        // lines above, so passing the query here bought a SECOND embedding
        // call per chat message for a result the prompt already contained.
        //
        // Caught auditing this after it shipped. It survived its own tests
        // because they stub retrieveContext wholesale, so the stub never
        // exercised what the real implementation does — testing a mock of the
        // thing rather than the thing.
        //
        // What this call is actually for is the eight STRUCTURED stores
        // (cognitive events, business events, genome, temporal flow, cognition
        // memory, execution and action logs) that the semantic path does not
        // read. Those run as one parallel batch, each bounded to 50 rows and
        // a 90-day window, and they are the half of perception the chat was
        // missing.
        // Personally-attributed memory is narrowed to the caller. Without this
        // one member's execution history — including the rationale for why they
        // asked — renders into another member's prompt.
        userId,
        limit: tier === 'deliberate' ? 12 : 6,
        // 0.3 was decorative — it could not reject a single row.
        //
        // rankScore = relevance*0.45 + recency*0.35 + sourceWeight*0.2, and
        // with no similarity score relevance floors at 0.5 while sourceWeight
        // floors at 0.75. So even a maximally stale, minimally trusted fragment
        // scores 0.5*0.45 + 0*0.35 + 0.75*0.2 = 0.375. Nothing was ever below
        // the "quality floor".
        //
        // 0.5 sits inside the real 0.375–1.0 range, so it drops the stale
        // low-confidence band while keeping anything recent or well-evidenced.
          minRankScore: 0.5,
        }),
        PERCEPTION_DEADLINE_MS,
      );
      if (!fragments || fragments.length === 0) return '';

      const lines = fragments.map(
        (f) => `- [${f.sourceType}] ${f.title}: ${f.content.slice(0, 240)}`,
      );

      return (
        `\n\nWHAT YOU HAVE OBSERVED — recorded by your own watchers, connectors and\n` +
        `organs, not stated by the user in this conversation. Treat these as things\n` +
        `you noticed. Cite them when they bear on the answer, and do not repeat one\n` +
        `back as fact if the user contradicts it:\n${lines.join('\n')}`
      );
    } catch (err: unknown) {
      this.logger.warn(
        `[perception] retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }
  private getSocial() {
    return this.moduleRef.get(SocialService, { strict: false });
  }
  private getFlow() {
    return this.moduleRef.get(FlowService, { strict: false });
  }
  private getExpenses() {
    return this.moduleRef.get(ExpensesService, { strict: false });
  }
  private getTimeEntry() {
    return this.moduleRef.get(TimeEntryService, { strict: false });
  }
  private getHelpdesk() {
    return this.moduleRef.get(HelpdeskService, { strict: false });
  }
  private getCalendarQuery() {
    return this.moduleRef.get(CalendarQueryService, { strict: false });
  }
  private getDocumentIntelligence() {
    return this.moduleRef.get(DocumentIntelligenceService, { strict: false });
  }
  private getKeyflowNotes() {
    return this.moduleRef.get(KeyflowNotesService, { strict: false });
  }
  private getOnboardingConcierge() {
    return this.moduleRef.get(OnboardingConciergeService, { strict: false });
  }
  private getOnboardingState() {
    return this.moduleRef.get(OnboardingStateService, { strict: false });
  }
  private getBusinessGenesis() {
    return this.moduleRef.get(BusinessGenesisService, { strict: false });
  }

  /**
   * Build the "Blueprint" section of the system prompt. Reads from the
   * BusinessBlueprint so KEY's recommendations are grounded in the operator's
   * actual identity, goals, constraints, and brand voice.
   */
  private async buildOnboardingDirective(
    businessId: string,
    pageContext?: FlowPageContext,
  ): Promise<string> {
    const ctx = await this.blueprint.getBlueprintContext(businessId);
    const isOnboardingRoute = pageContext?.route?.startsWith('/app/onboarding') ?? false;

    if (!ctx || ctx.completeness >= 100) {
      if (isOnboardingRoute) {
        return (
          '\n[PRIORITY DIRECTIVE — ONBOARDING MODE]\n' +
          'The user is on the onboarding page. The Business Genome is already complete. ' +
          'Guide them through template selection, auto-configuration, and the completion gate. ' +
          'Use the present_onboarding_card tool to show the next relevant onboarding card. ' +
          'Keep replies concise, warm, and action-oriented.\n'
        );
      }
      return '';
    }

    if (isOnboardingRoute) {
      return (
        '\n[PRIORITY DIRECTIVE — ONBOARDING MODE]\n' +
        `The Business Genome is ${ctx.completeness}% complete. You are in the dedicated onboarding chat. ` +
        'When the user shares ANY concrete business fact (industry, revenue model, ideal customer, goals, constraints, brand voice, budget, time commitment, etc.), ' +
        'STOP and call update_business_blueprint FIRST, BEFORE any other tool. ' +
        'If they have not shared a fact, guide them with ONE concise question and then use the present_onboarding_card tool to show the appropriate structured card ' +
        '(profile-identity, genesis-idea, operating-model, brand-goals, financials, ownership-legal, operations, market-strategy, risk-compliance-roadmap, readiness-dashboard, template-picker, payments-storefront-contacts, or completion-gate) based on their onboarding state. ' +
        'Never ask for passwords, API keys, or bank details.\n'
      );
    }

    return (
      '\n[PRIORITY DIRECTIVE — BUSINESS GENOME ONBOARDING]\n' +
      `The Business Genome is only ${ctx.completeness}% complete. Until it reaches 100%, your FIRST priority in every turn is to collect missing business facts. ` +
      'When the user shares ANY concrete business fact (industry, revenue model, ideal customer, goals, constraints, brand voice, budget, time commitment, etc.), ' +
      'STOP and call the update_business_blueprint tool with a patch containing that fact BEFORE doing anything else. Do NOT use commerce, CRM, marketing, or finance tools when a blueprint fact is present. ' +
      'If they have not shared a fact, ask ONE concise follow-up question to fill the next missing section in this order: identity, operatingModel, constraints, goals, brand, customerModel, financials, workflowModel, aiPreferences. ' +
      'Never ask for passwords, API keys, or bank details.\n'
    );
  }

  private async buildOnboardingCard(
    businessId: string,
    cardType: OnboardingCardType | 'next',
    stepHint?: string,
  ): Promise<OnboardingCard> {
    const concierge = this.getOnboardingConcierge();
    const genesis = this.getBusinessGenesis();

    const [setupStatus, conciergeState, business, blueprintCtx, genomeIntegrity] = await Promise.all([
      concierge.getSetupStatus(businessId),
      concierge.getConciergeState(businessId),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { businessIntent: true, name: true, industry: true, archetype: true, phone: true, email: true, logoUrl: true, country: true, currency: true },
      }),
      this.blueprint.getBlueprintContext(businessId).catch(() => null),
      this.blueprint.calculateGenomeIntegrity(businessId).catch(() => null),
    ]);

    if (cardType !== 'next') {
      return {
        type: cardType,
        title: this.onboardingCardTitle(cardType),
        data: { setupStatus, conciergeState, business, blueprintCtx, stepHint },
      };
    }

    const baseData = { setupStatus, conciergeState, business, blueprintCtx, genomeIntegrity };

    if (conciergeState.onboardingComplete || setupStatus.percentage === 100) {
      return {
        type: 'completion-gate',
        title: this.onboardingCardTitle('completion-gate'),
        data: baseData,
      };
    }

    // Slim 5-step onboarding funnel:
    // 1) Capture the idea so AI can extract the Business Genome snapshot.
    const hasIdea = !!business?.businessIntent?.trim();
    const hasName = !!business?.name?.trim();
    const lowCompleteness = (blueprintCtx?.completeness ?? 0) < 25;
    if (!hasIdea || !hasName || lowCompleteness) {
      return {
        type: 'genesis-idea',
        title: this.onboardingCardTitle('genesis-idea'),
        data: { setupStatus, business, blueprintCtx },
      };
    }

    // 2) Pick and auto-configure the best concierge template.
    if (!conciergeState.templateId) {
      return {
        type: 'template-picker',
        title: this.onboardingCardTitle('template-picker'),
        data: { setupStatus, conciergeState, business },
      };
    }

    // 3) Confirm storefront, payments, and contact details.
    if (!setupStatus.payments || !setupStatus.storefront || !setupStatus.contacts) {
      return { type: 'payments-storefront-contacts', title: this.onboardingCardTitle('payments-storefront-contacts'), data: baseData };
    }

    // 4) Business Genome three-pillar minimum. If it isn't met yet, let the
    // user fill the missing pillars before showing the completion gate.
    if (!genomeIntegrity?.threePillarMinimumMet) {
      return {
        type: 'genome-check',
        title: this.onboardingCardTitle('genome-check'),
        data: baseData,
      };
    }

    // 5) Done.
    return {
      type: 'completion-gate',
      title: this.onboardingCardTitle('completion-gate'),
      data: baseData,
    };
  }

  private extractOnboardingCard(toolResults?: FlowToolResult[]): OnboardingCard | undefined {
    if (!toolResults) return undefined;
    const cardResult = toolResults.find((r) => r.name === 'present_onboarding_card' && r.success);
    if (!cardResult) return undefined;
    const card = cardResult.result as OnboardingCard | undefined;
    if (card && typeof card.type === 'string') return card;
    return undefined;
  }

  private onboardingCardTitle(cardType: OnboardingCardType): string {
    switch (cardType) {
      case 'welcome': return 'Welcome to KeyFlowOS';
      case 'genesis-idea': return 'Tell me about your business idea';
      case 'genesis-questions': return 'A few quick questions';
      case 'readiness-dashboard': return 'Your readiness dashboard';
      case 'template-picker': return 'Pick an industry template';
      case 'genome-check': return 'Complete your Business Genome';
      case 'completion-gate': return 'You’re ready to launch';
      case 'profile-identity': return 'Your business profile';
      case 'operating-model': return 'How you operate';
      case 'brand-goals': return 'Brand & goals';
      case 'financials': return 'Financial plan';
      case 'ownership-legal': return 'Ownership & legal';
      case 'operations': return 'Operations';
      case 'market-strategy': return 'Market strategy';
      case 'payments-storefront-contacts': return 'Payments, storefront & contacts';
      case 'risk-compliance-roadmap': return 'Risk, compliance & roadmap';
      default: return 'Next step';
    }
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
        // Heuristic: check if the sign-off matches a role.
        //
        // Driven off getAllRoles() rather than a hardcoded list — the literal
        // array here named only five of the eight roles, so `operator` and
        // `executive` could never be sticky. Once one of them answered, the
        // next message forgot it had.
        //
        // This remains a heuristic: it depends on the model actually emitting
        // the role's sign-off. Making it reliable means persisting the role on
        // the session, and FlowSession has no column for it — that is a
        // migration, not a patch.
        for (const def of this.roleEngine.getAllRoles()) {
          if (def.signOff && msg.content.includes(def.signOff)) {
            previousRole = def.id;
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

  /**
   * Build a text block describing uploaded attachments by running them through
   * DocumentIntelligenceService. Images and documents are described/extracted
   * so the orchestrator can act on invoices, receipts, screenshots, etc.
   */
  private async buildAttachmentContext(
    businessId: string,
    attachments?: FlowAttachment[],
  ): Promise<string> {
    if (!attachments?.length) return '';
    const docIntel = this.getDocumentIntelligence();
    const storage = new ObjectStorageService();
    const parts: string[] = [];
    for (const att of attachments) {
      try {
        const filename = att.name || 'attachment';
        const mimeType = att.mimeType || 'application/octet-stream';
        let extractionInput: Parameters<DocumentIntelligenceService['extractFromDocument']>[0] = {
          businessId,
          source: att.url,
          url: att.url,
          filename,
          mimeType,
        };

        // Prefer reading from our own object storage; presigned PUT URLs are not
        // always publicly readable.
        if (att.objectPath?.startsWith('/objects/')) {
          try {
            const { buffer, contentType } = await storage.getObjectEntityBuffer(att.objectPath);
            extractionInput = {
              businessId,
              source: att.objectPath,
              base64Content: buffer.toString('base64'),
              filename,
              mimeType: contentType || mimeType,
            };
          } catch (storageErr: any) {
            this.logger.warn(
              `Could not read attachment from object storage (${att.objectPath}): ${storageErr?.message ?? 'unknown'}; falling back to URL.`,
            );
          }
        }

        const result = await docIntel.extractFromDocument(extractionInput);
        const summary = result.rawText?.trim()
          ? `${result.documentType?.toUpperCase() ?? 'DOCUMENT'}\n${result.rawText}`
          : JSON.stringify(result);
        parts.push(
          `[Attachment: ${filename} (${att.type}, ${extractionInput.mimeType ?? mimeType})]\n${summary}`,
        );
      } catch (err: any) {
        parts.push(
          `[Attachment: ${att.name ?? 'unnamed'} (${att.type}) — could not extract: ${err?.message ?? 'unknown error'}]`,
        );
      }
    }
    if (!parts.length) return '';
    return 'ATTACHMENT CONTEXT:\n' + parts.join('\n\n---\n\n');
  }

  private buildAttachmentContextSync(
    content: string,
    attachments?: FlowAttachment[],
  ): string {
    if (!attachments?.length) return content;
    const fallbackParts = attachments.map(
      (att) =>
        `[Attachment: ${att.name ?? 'unnamed'} (${att.type}) — see previous extraction above]`,
    );
    return `${content}\n\nATTACHMENT CONTEXT:\n${fallbackParts.join('\n')}`;
  }

  private async *finalizeStreamSession(
    businessId: string,
    sessionId: string,
    conversationHistory: FlowMessage[],
    message: string,
    enrichedMessage: string,
    attachments: FlowAttachment[] | undefined,
    assistantContent: string,
    assistantToolCalls: FlowToolCall[] | undefined,
    assistantToolResults: FlowToolResult[] | undefined,
    assistantPendingConfirmations: PendingConfirmation[] | undefined,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number; creditsUsed: number },
    /** Owner of the conversation, so the session it persists is private to them. */
    userId?: string,
  ): AsyncGenerator<FlowStreamChunk> {
    const sessionMessages: FlowMessage[] = [...conversationHistory];
    if (message.trim() || attachments?.length) {
      sessionMessages.push({
        role: 'user',
        content: enrichedMessage,
        attachments,
        timestamp: new Date(),
      });
    }
    sessionMessages.push({
      role: 'assistant',
      content: assistantContent,
      toolCalls: assistantToolCalls,
      toolResults: assistantToolResults,
      pendingConfirmations: assistantPendingConfirmations,
      requiresConfirmation: assistantPendingConfirmations && assistantPendingConfirmations.length > 0,
      timestamp: new Date(),
    });
    await this.saveConversationHistory(businessId, sessionId, sessionMessages, userId);
    // The ordinary streamed reply — the path almost every message takes. It was
    // missed on the first pass, which wired only the non-streaming path and the
    // rare deliberation branch, and the spec asserted "2 call sites" so it
    // passed while the main path went unchecked.
    void this.enforceDoNotSay(businessId, String(assistantContent ?? ''));
    yield { type: 'usage', usage };
    yield { type: 'done', sessionId };
  }

  async chat(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[] = [],
    pendingConfirmation?: { toolCallId: string; confirmed: boolean; toolName?: string; toolArgs?: Record<string, any> },
    pageContext?: FlowPageContext,
    role?: BusinessRole,
    attachments?: FlowAttachment[],
    sessionId?: string,
    /** Owner of the conversation. A session created without one is private to
     *  nobody and will not appear in any listing — see saveConversationHistory. */
    userId?: string,
  ): Promise<FlowResponse> {
    this.aiUsage.checkRateLimit(businessId);

    // Enrich message with any uploaded document/PDF/image context so role detection
    // and the LLM prompt both see the attachment contents.
    const effectiveSessionId = sessionId || randomUUID();
    const attachmentContext = await this.buildAttachmentContext(businessId, attachments);
    const enrichedMessage = attachmentContext ? `${message}\n\n${attachmentContext}` : message;

    const result = await (async (): Promise<FlowResponse> => {
    // Auto-detect role if not explicitly provided
    const detectedRole = role ?? await this.inferRole(businessId, enrichedMessage, conversationHistory, pageContext);

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
    const onboardingDirective = await this.buildOnboardingDirective(businessId, pageContext);

    // ─── THALAMUS ───────────────────────────────────────────────
    // Grade the message before spending anything on it. Zero model calls,
    // zero I/O: six regex classifiers plus two in-memory reads. Never throws;
    // on any failure it returns today's exact parameters.
    const triage: TriageVerdict | null =
      this.getTriage()?.triage(businessId, message, Boolean(attachments?.length)) ?? null;

    let systemPrompt: string;
    if (detectedRole && detectedRole !== 'general') {
      const businessContext = onboardingDirective + contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection;
      systemPrompt = this.roleEngine.getSystemPromptForRole(detectedRole, businessContext, onboardingDirective)
        .replace('{{CURRENT_DATE}}', currentDateForPrompt());
    } else {
      systemPrompt = FLOW_SYSTEM_PROMPT
        .replace('{{CURRENT_DATE}}', currentDateForPrompt())
        .replace('{{ONBOARDING_DIRECTIVE}}', onboardingDirective)
        .replace('{{BUSINESS_CONTEXT}}', contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection);
    }

    // Standing state from the CNS — endocrine disposition and body integrity.
    // Appended AFTER the role prompt so it frames the answer without competing
    // with the role's own instructions, and it is null unless there is
    // genuinely something to report.
    if (triage?.standingContext) {
      systemPrompt += `

${triage.standingContext}`;
    }

    // Join the two halves of perception: what KEY sensed, not just what it was
    // told. Graded by the thalamus so a greeting pays nothing for it.
    systemPrompt += await this.buildPerceptionSection(businessId, message, triage?.tier, userId);

    const messages: GatewayMessage[] = [
      { role: 'system', content: withEvidenceDiscipline(systemPrompt) },
    ];

    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: this.buildAttachmentContextSync(msg.content, msg.attachments) });
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

    messages.push({ role: 'user', content: enrichedMessage });

    try {
      const gatewayResponse = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'flow_chat',
        {
          messages: messages as GatewayMessage[],
          // No tools on the reflex tier.
          //
          // The tool schemas serialise to ~53,000 characters — about 13,300
          // tokens, roughly 80% of everything sent on an ordinary turn. They
          // were attached unconditionally, so "hi" cost about as much as a
          // strategy question.
          //
          // This is safe precisely because the reflex whitelist is so narrow:
          // isBareAcknowledgement requires the WHOLE message to match a fixed
          // list of greetings and acknowledgements at 24 characters or fewer,
          // AND simple complexity, AND no data requirement, AND low emotional
          // weight, AND no attachments. By the time the tier is 'reflex' the
          // message has been established to be literally "hi" or "thanks".
          // Handing that 118 tool definitions including create_invoice and
          // cancel_booking buys nothing.
          //
          // Note this is the TOOLS lever, not the taskCategory lever —
          // CognitiveTriageService.categoryFor deliberately refuses to reroute
          // the model, for reasons documented there, and this does not
          // contradict it.
          tools: triage?.tier === 'reflex'
            ? undefined
            : detectedRole && detectedRole !== 'general'
              ? getOpenAiToolDefinitions().filter((t) => this.roleEngine.isToolAllowed(detectedRole, t.function.name))
              : getOpenAiToolDefinitions(),
          toolChoice: triage?.tier === 'reflex' ? undefined : 'auto',
          // Content-driven for the first time. taskCategory is deliberately
          // NOT overridden — see CognitiveTriageService.categoryFor.
          maxTokens: triage?.maxTokens ?? 1000,
          temperature: triage?.temperature ?? 0.7,
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

      const onboardingCard = this.extractOnboardingCard(toolResults);

      return {
        reply: finalReply,
        toolCalls,
        toolResults,
        card: onboardingCard,
        usage,
      };
    } catch (error: any) {
      this.logger.error(`Flow chat error: ${(error as Error).message}`);
      throw error;
    }
    })();

    // Persist the turn to the FlowSession so it can be resumed later.
    const userMessage: FlowMessage = {
      role: 'user',
      content: enrichedMessage,
      attachments,
      timestamp: new Date(),
    };
    const assistantMessage: FlowMessage = {
      role: 'assistant',
      content: result.reply,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      pendingConfirmations: result.pendingConfirmations,
      requiresConfirmation: result.requiresConfirmation,
      timestamp: new Date(),
    };
    const sessionMessages = [...conversationHistory];
    if (message.trim() || attachments?.length) {
      sessionMessages.push(userMessage);
    }
    sessionMessages.push(assistantMessage);
    await this.saveConversationHistory(businessId, effectiveSessionId, sessionMessages, userId);
    void this.enforceDoNotSay(businessId, String(assistantMessage.content ?? ''));

    return { ...result, sessionId: effectiveSessionId };
  }

  async *streamChat(
    businessId: string,
    message: string,
    conversationHistory: FlowMessage[] = [],
    pageContext?: FlowPageContext,
    role?: BusinessRole,
    attachments?: FlowAttachment[],
    sessionId?: string,
    /** Owner of the conversation — see saveConversationHistory. */
    userId?: string,
  ): AsyncGenerator<FlowStreamChunk> {
    // Enrich message with uploaded document/image context.
    const effectiveSessionId = sessionId || randomUUID();
    const attachmentContext = await this.buildAttachmentContext(businessId, attachments);
    const enrichedMessage = attachmentContext ? `${message}\n\n${attachmentContext}` : message;

    // Auto-detect role if not explicitly provided
    const detectedRole = role ?? await this.inferRole(businessId, enrichedMessage, conversationHistory, pageContext);

    try {
      this.aiUsage.checkRateLimit(businessId);
    } catch (err: any) {
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
    if (enrichedMessage) {
      const relevant = await this.semanticMemory.search({
        businessId,
        query: enrichedMessage,
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
    const onboardingDirective = await this.buildOnboardingDirective(businessId, pageContext);

    // ─── THALAMUS ───────────────────────────────────────────────
    // Grade the message before spending anything on it. Zero model calls,
    // zero I/O: six regex classifiers plus two in-memory reads. Never throws;
    // on any failure it returns today's exact parameters.
    const triage: TriageVerdict | null =
      this.getTriage()?.triage(businessId, message, Boolean(attachments?.length)) ?? null;

    let systemPrompt: string;
    if (detectedRole && detectedRole !== 'general') {
      const businessContext = onboardingDirective + contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection;
      systemPrompt = this.roleEngine.getSystemPromptForRole(detectedRole, businessContext, onboardingDirective)
        .replace('{{CURRENT_DATE}}', currentDateForPrompt());
    } else {
      systemPrompt = FLOW_SYSTEM_PROMPT
        .replace('{{CURRENT_DATE}}', currentDateForPrompt())
        .replace('{{ONBOARDING_DIRECTIVE}}', onboardingDirective)
        .replace('{{BUSINESS_CONTEXT}}', contextSnapshot + memorySection + semanticMemorySection + pageContextSection + blueprintSection);
    }

    // Standing state from the CNS — endocrine disposition and body integrity.
    // Appended AFTER the role prompt so it frames the answer without competing
    // with the role's own instructions, and it is null unless there is
    // genuinely something to report.
    if (triage?.standingContext) {
      systemPrompt += `

${triage.standingContext}`;
    }

    // Join the two halves of perception: what KEY sensed, not just what it was
    // told. Graded by the thalamus so a greeting pays nothing for it.
    systemPrompt += await this.buildPerceptionSection(businessId, message, triage?.tier, userId);

    const messages: GatewayMessage[] = [
      { role: 'system', content: withEvidenceDiscipline(systemPrompt) },
    ];

    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: this.buildAttachmentContextSync(msg.content, msg.attachments) });
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

    messages.push({ role: 'user', content: enrichedMessage });

    // Publish the thalamic verdict before the answer starts. Nothing branches
    // on this — it exists so the tier distribution over real traffic can be
    // measured before any tier is given authority over cost or depth. Every
    // later step (canned reflex replies, escalation to the cortex) depends on
    // knowing that distribution, and right now nobody does.
    if (triage) {
      this.logger.log(
        `[thalamus] ${triage.reason} score=${triage.score} maxTokens=${triage.maxTokens}`,
      );
      yield {
        type: 'triage',
        triage: {
          tier: triage.tier,
          score: triage.score,
          arousal: triage.arousal,
          reason: triage.reason,
        },
      };
    }


    // ─── ESCALATION ─────────────────────────────────────────────
    // The thalamus has been able to grade a message `deliberate` since it was
    // built, and until now that only widened the token budget. This is the
    // routing it was always for.
    //
    // Guarded hard, because the failure mode is invisible: processConsciously
    // has no executor, so an action-bearing message sent here would be reasoned
    // about beautifully and never acted on. shouldDeliberate refuses anything
    // carrying an action verb.
    //
    // A null result is fully survivable — the fast path below runs exactly as
    // it would have. Losing a user's message to a failed attempt at thinking
    // harder would be far worse than answering it shallowly.
    if (this.shouldDeliberate(triage, message, Boolean(attachments?.length))) {
      const phases: Array<{ label: string; step: number; of: number }> = [];
      const deliberation = await this.deliberate(
        businessId,
        enrichedMessage,
        conversationHistory,
        (label, step, of) => phases.push({ label, step, of }),
      );

      if (deliberation) {
        // Phases are emitted after the fact rather than live: this generator
        // cannot yield from inside an awaited callback. The user still sees
        // what KEY considered, which is the point — silence during a slow
        // think reads as a hang.
        for (const phase of phases.slice(-6)) {
          yield { type: 'thinking', thinking: phase };
        }

        yield { type: 'content_delta', content: deliberation.text };

        // (businessId, sessionId, messages) — NOT the other way round. Both are
        // strings, so getting this backwards typechecks cleanly and silently
        // writes the session under a swapped id and tenant. It was backwards in
        // the first draft of this block.
        await this.saveConversationHistory(
          businessId,
          effectiveSessionId,
          [
            ...conversationHistory,
            { role: 'user', content: message },
            { role: 'assistant', content: deliberation.text },
          ],
          userId,
        ).catch(() => undefined);
        void this.enforceDoNotSay(businessId, deliberation.text);

        yield { type: 'done', sessionId: effectiveSessionId };
        return;
      }
    }

    try {
      const stream = this.aiUsage.trackAndStream(
        businessId,
        undefined,
        'flow_chat_stream',
        {
          messages,
          // No tools on the reflex tier.
          //
          // The tool schemas serialise to ~53,000 characters — about 13,300
          // tokens, roughly 80% of everything sent on an ordinary turn. They
          // were attached unconditionally, so "hi" cost about as much as a
          // strategy question.
          //
          // This is safe precisely because the reflex whitelist is so narrow:
          // isBareAcknowledgement requires the WHOLE message to match a fixed
          // list of greetings and acknowledgements at 24 characters or fewer,
          // AND simple complexity, AND no data requirement, AND low emotional
          // weight, AND no attachments. By the time the tier is 'reflex' the
          // message has been established to be literally "hi" or "thanks".
          // Handing that 118 tool definitions including create_invoice and
          // cancel_booking buys nothing.
          //
          // Note this is the TOOLS lever, not the taskCategory lever —
          // CognitiveTriageService.categoryFor deliberately refuses to reroute
          // the model, for reasons documented there, and this does not
          // contradict it.
          tools: triage?.tier === 'reflex'
            ? undefined
            : detectedRole && detectedRole !== 'general'
              ? getOpenAiToolDefinitions().filter((t) => this.roleEngine.isToolAllowed(detectedRole, t.function.name))
              : getOpenAiToolDefinitions(),
          toolChoice: triage?.tier === 'reflex' ? undefined : 'auto',
          // Content-driven for the first time. taskCategory is deliberately
          // NOT overridden — see CognitiveTriageService.categoryFor.
          maxTokens: triage?.maxTokens ?? 1000,
          temperature: triage?.temperature ?? 0.7,
        },
      );

      let fullContent = '';
      let followUpContent = '';
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
        yield* this.finalizeStreamSession(
          businessId,
          effectiveSessionId,
          conversationHistory,
          message,
          enrichedMessage,
          attachments,
          fullContent,
          undefined,
          undefined,
          undefined,
          usage,
          userId,
        );
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
        const blockMessage = `I can't execute that action right now: ${blocked.map(b => b.decision.reason).join('; ')}`;
        yield { type: 'content_delta', content: blockMessage };
        yield* this.finalizeStreamSession(
          businessId,
          effectiveSessionId,
          conversationHistory,
          message,
          enrichedMessage,
          attachments,
          blockMessage,
          toolCalls,
          undefined,
          undefined,
          usage,
          userId,
        );
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

        const formalMessage = `These actions require formal approval and have been added to your approval queue:\n${approvalMessages}`;
        yield { type: 'content_delta', content: formalMessage };
        yield* this.finalizeStreamSession(
          businessId,
          effectiveSessionId,
          conversationHistory,
          message,
          enrichedMessage,
          attachments,
          formalMessage,
          toolCalls,
          undefined,
          undefined,
          usage,
          userId,
        );
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
        yield* this.finalizeStreamSession(
          businessId,
          effectiveSessionId,
          conversationHistory,
          message,
          enrichedMessage,
          attachments,
          fullContent,
          toolCalls,
          undefined,
          pendingConfirmations,
          usage,
          userId,
        );
        return;
      }

      const toolResults: FlowToolResult[] = await Promise.all(
        toolCalls.map((tc) => this.executeTool(businessId, tc.name, tc.arguments, tc.id, { planId: '', planStepId: '', role: detectedRole ?? undefined })),
      );

      yield { type: 'tool_results', toolResults };

      const onboardingCard = this.extractOnboardingCard(toolResults);
      if (onboardingCard) {
        yield { type: 'card', card: onboardingCard };
      }

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
          followUpContent += chunk.content;
          yield { type: 'content_delta', content: chunk.content };
        }
      }

      yield* this.finalizeStreamSession(
        businessId,
        effectiveSessionId,
        conversationHistory,
        message,
        enrichedMessage,
        attachments,
        followUpContent,
        toolCalls,
        toolResults,
        undefined,
        usage,
        userId,
      );
    } catch (error: any) {
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
    } catch (error: any) {
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

      case 'present_onboarding_card': {
        return this.buildOnboardingCard(businessId, args.cardType as OnboardingCardType, args.step as string | undefined);
      }

      case 'save_onboarding_step': {
        const step = args.step as ServerOnboardingStep;
        await this.getOnboardingState().saveStep(businessId, step);
        return { step, saved: true };
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
        const contact = await this.getCrm().createContact({
          businessId,
          firstName: args.firstName ?? null,
          lastName: args.lastName ?? null,
          email: args.email ?? null,
          phone: args.phone ?? null,
          companyName: args.companyName ?? null,
          status: args.status ?? 'LEAD',
        });
        return { contact, id: contact.id };
      }

      case 'crm_update_contact': {
        const contact = await this.getCrm().updateContact({
          businessId,
          contactId: args.contactId,
          firstName: args.firstName,
          lastName: args.lastName,
          email: args.email,
          phone: args.phone,
          status: args.status,
          companyName: args.companyName,
        });
        return { contact, id: contact.id };
      }

      case 'crm_add_note': {
        const note = await this.getCrm().addNote({
          businessId,
          contactId: args.contactId,
          body: args.body,
          source: 'flow_ai',
        });
        return { note, id: (note as { id: string }).id };
      }

      case 'crm_add_task': {
        const task = await this.getCrm().addTask({
          businessId,
          contactId: args.contactId,
          title: args.title,
          dueDate: args.dueDate ? new Date(args.dueDate).toISOString() : null,
          priority: args.priority ?? 'MEDIUM',
          source: 'flow_ai',
        });
        // Auto-assign KEY to tasks it creates
        await this.getTaskAssignment().assign({
          taskType: 'ContactTask',
          taskId: (task as { id: string }).id,
          assignableType: 'KEY',
          assignableId: 'key_ai',
          assignedBy: 'key_ai',
          reason: 'Auto-assigned by KEY Operator',
        }).catch(() => { /* ignore assignment errors */ });
        return { task, id: (task as { id: string }).id };
      }

      case 'crm_delete_contact': {
        await this.getCrm().softDeleteContact({
          businessId,
          contactId: args.contactId,
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
        const invoiceCount = await this.prisma.client.invoice.count({ where: { businessId } });
        const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, '0')}`;
        const invoice = await this.getCommerce().createInvoice({
          businessId,
          contactId: args.contactId,
          items: items.map((item: any) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          invoiceNumber,
          currency: args.currency ?? 'TTD',
          dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
          notes: args.notes ?? undefined,
        });
        return { invoice, id: invoice.id, invoiceNumber: invoice.invoiceNumber };
      }

      case 'commerce_mark_invoice_paid': {
        const invoice = await this.getCommerce().markInvoicePaid(args.invoiceId, KEY_SYSTEM_ACTOR_ID, businessId);
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
        const quoteCount = await this.prisma.client.quote.count({ where: { businessId } });
        const quoteNumber = `QT-${String(quoteCount + 1).padStart(4, '0')}`;
        const quote = await this.getCommerce().createQuote({
          businessId,
          contactId: args.contactId,
          items: items.map((item: any) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          quoteNumber,
          currency: args.currency ?? 'TTD',
          expiryDate: args.expiryDate ? new Date(args.expiryDate) : undefined,
        });
        return { quote, id: quote.id, quoteNumber: quote.quoteNumber };
      }

      case 'commerce_delete_invoice': {
        await this.getCommerce().deleteInvoice(args.invoiceId, businessId);
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

        const booking = await this.getBookings().createBooking({
          businessId,
          contactId: args.contactId,
          serviceId: args.serviceId,
          staffId: args.staffId,
          startTime,
          endTime,
          notes: args.notes ?? undefined,
        });
        return { booking, id: booking.id, contactName: contact.displayName || `${contact.firstName} ${contact.lastName}` };
      }

      case 'bookings_reschedule_booking': {
        const updated = await this.getBookings().rescheduleBooking(businessId, args.bookingId, new Date(args.startTime));
        return { booking: updated, id: updated.id };
      }

      case 'bookings_cancel_booking': {
        const updated = await this.getBookings().updateBookingStatus(businessId, args.bookingId, 'CANCELLED');
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
        const campaign = await this.getEmailMarketing().createCampaign({
          businessId,
          name: args.name,
          subject: args.subject,
          body: args.body,
          scheduledAt: args.scheduledAt ? new Date(args.scheduledAt).toISOString() : undefined,
        });
        return { campaign, id: campaign.id };
      }

      // The five delegation loops. These were declared in FLOW_TOOLS with no
      // case clause at all, so the model could call them — they are offered in
      // the default role — and every call fell through to
      // `default: throw new Error('Unknown tool: ...')`. The implementations
      // were complete the whole time in DelegationLoopService.
      //
      // Tool name is `delegation_` + loopType, so one handler covers all five.
      // ensureLoopsForBusiness is idempotent and must run first: runLoop takes
      // a DelegationLoop ROW id, not a loop type, and throws NotFoundException
      // if the business has never had its loops created.
      case 'delegation_payment_recovery':
      case 'delegation_lead_reactivation':
      case 'delegation_post_purchase':
      case 'delegation_booking_prep':
      case 'delegation_weekly_hygiene': {
        const loopType = toolName.slice('delegation_'.length);
        const delegation = this.getDelegationLoop();

        await delegation.ensureLoopsForBusiness(businessId);
        const loops = await delegation.getLoops(businessId);
        const loop = loops.find((l: { loopType: string }) => l.loopType === loopType);
        if (!loop) {
          throw new Error(`Delegation loop "${loopType}" is not available for this business`);
        }

        const run = await delegation.runLoop(businessId, loop.id);
        return { loopType, ...run };
      }

      case 'marketing_send_campaign': {
        // sendCampaign, NOT markCampaignSent.
        //
        // markCampaignSent flips status to SENT and emits recipientCount: 0 —
        // it emails nobody. This tool's own confirmation string says "Send
        // email campaign to all eligible contacts", so KEY was reporting an
        // action it had not performed. That is the one thing a tool must
        // never do.
        //
        // sendCampaign claims the campaign atomically (so a double-send
        // throws rather than double-sending), resolves the segment, honours
        // doNotContact and marketingOptIn, delivers through Gmail when it is
        // connected, and marks failures BOUNCED. When Gmail is NOT connected
        // it returns a `warning` saying the campaign was recorded but not
        // delivered — that must reach the model, or KEY claims delivery again
        // by a different route.
        const result = await this.getEmailMarketing().sendCampaign(businessId, args.campaignId);
        return {
          campaignId: args.campaignId,
          recipients: result.sent,
          delivered: result.gmailDelivered,
          failed: result.gmailFailed,
          suppressed: result.suppressed,
          ...(result.warning ? { warning: result.warning } : {}),
        };
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
        const post = await this.getSocial().createDraft(
          businessId,
          args.content,
          [],
          args.scheduledFor ? new Date(args.scheduledFor).toISOString() : undefined,
          [],
        );
        return { post, id: post.id };
      }

      case 'social_publish_post': {
        const result = await this.getSocial().publishPost(businessId, args.postId);
        const updated = 'post' in result ? result.post : result;
        if (!updated) throw new Error('Post publish failed');
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
        const playbook = await this.getFlow().createAutomation({
          businessId,
          name: args.name,
          trigger: args.triggerEvent,
          condition: args.condition ?? null,
        });
        return { playbook, id: playbook.id };
      }

      case 'automations_toggle_playbook': {
        const playbook = await this.getFlow().updateAutomation(businessId, args.playbookId, { enabled: args.enabled });
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
        const task = await this.getCrm().addTask({
          businessId,
          contactId: args.contactId,
          title: args.title,
          dueDate: args.dueDate ? new Date(args.dueDate).toISOString() : null,
          priority: args.priority ?? 'MEDIUM',
          source: 'flow_ai',
        });
        // Auto-assign KEY to tasks it creates
        await this.getTaskAssignment().assign({
          taskType: 'ContactTask',
          taskId: (task as { id: string }).id,
          assignableType: 'KEY',
          assignableId: 'key_ai',
          assignedBy: 'key_ai',
          reason: 'Auto-assigned by KEY Operator',
        }).catch(() => { /* ignore assignment errors */ });
        return { id: (task as { id: string }).id, title: (task as { title: string }).title, contactId: args.contactId };
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
          const task = await this.getCrm().addTask({
            businessId,
            contactId: c.id,
            title: titleTemplate.replace('{name}', name),
            priority: 'HIGH',
            source: 'flow_ai',
            dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          });
          createdTasks.push({ taskId: (task as { id: string }).id, contactId: c.id, contactName: name });
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

        await this.getCrm().updateContact({
          businessId,
          contactId: args.contactId,
          tags: mergedTags,
        });

        return { contactId: contact.id, tags: mergedTags };
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
          });
          const spenderIds = new Set(
            spenders
              .filter((s: any) => (s._sum.total ?? 0) >= args.minSpend)
              .map((s: any) => s.contactId),
          );
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
        const scheduledAction = await this.getActivityLog().createActivity({
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
        const updated = await this.getEmailMarketing().queueCampaign(
          businessId,
          args.campaignId,
          args.scheduledAt,
        );
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
        await this.getCrm().addNote({
          businessId,
          contactId: args.contactId,
          body: `[${args.channel.toUpperCase()} Sent]\nSubject: ${args.subject ?? 'N/A'}\n\n${args.body}\n\nStatus: ${result.success ? 'Delivered' : 'Failed'}${result.messageId ? ` (ID: ${result.messageId})` : ''}${result.error ? `\nError: ${result.error}` : ''}`,
          source: 'flow_ai',
        });

        await this.getActivityLog().createActivity({
          businessId,
          module: 'ai',
          action: result.success ? 'message_sent' : 'message_failed',
          entityType: 'contact',
          entityId: args.contactId,
          title: `Message ${result.success ? 'sent' : 'failed'} to ${contact.firstName ?? ''} ${contact.lastName ?? ''} via ${args.channel}`,
          detail: args.body.slice(0, 200),
          tone: result.success ? 'success' : 'warning',
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
        const updated = await this.getFlow().updateAutomation(businessId, args.playbookId, { enabled: true });
        return { id: updated.id, name: updated.name, status: updated.enabled ? 'ACTIVE' : 'INACTIVE' };
      }

      case 'update_status_with_confirmation': {
        const entityType = args.entityType;
        const ids: string[] = Array.isArray(args.ids) ? args.ids : [args.ids];
        const newStatus = args.newStatus;

        if (entityType === 'contact') {
          const result = await this.getCrm().bulkUpdateContacts({
            businessId,
            contactIds: ids,
            status: newStatus,
          });
          return { entityType, updatedCount: result.updated, newStatus };
        }

        if (entityType === 'invoice') {
          let action: 'send' | 'void' | 'delete';
          if (newStatus === 'SENT') action = 'send';
          else if (newStatus === 'VOID') action = 'void';
          else if (newStatus === 'PAID') {
            // PAID bulk transition is not supported by bulkUpdateInvoices;
            // fall back to individual mark-paid calls.
            let updated = 0;
            for (const id of ids) {
              try {
                await this.getCommerce().markInvoicePaid(id, KEY_SYSTEM_ACTOR_ID, businessId);
                updated++;
              } catch (err: any) {
                this.logger.warn(`bulk mark paid skipped for ${id}: ${(err as Error).message}`);
              }
            }
            return { entityType, updatedCount: updated, newStatus };
          } else {
            throw new Error(`Unsupported invoice status transition: ${newStatus}`);
          }
          const result = await this.getCommerce().bulkUpdateInvoices(businessId, ids, action);
          return { entityType, updatedCount: result.updated, newStatus };
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
        const task = await this.getProjects().addTask(businessId, args.projectId, {
          title: args.title,
          dueDate: args.dueDate ? new Date(args.dueDate).toISOString() : undefined,
          priority: args.priority ?? 'NORMAL',
          assigneeId: 'key_ai',
        });
        return { task };
      }

      case 'projects_complete_task': {
        const task = await this.getProjects().updateTask(businessId, args.taskId, { isCompleted: true });
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
        const expense = await this.getExpenses().createExpense({
          businessId,
          amount: args.amount,
          description: args.description,
          date: args.date ? new Date(args.date) : new Date(),
          vendor: args.vendor,
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
        const note = await this.getKeyflowNotes().create(businessId, {
          targetType: args.targetType,
          targetId: args.targetId,
          targetLabel: args.targetLabel ?? null,
          body: args.body ?? '',
          pinned: args.pinned ?? false,
        }, 'key_ai');
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
        const event = await this.getCalendarQuery().createManualEvent(
          businessId,
          'key_ai',
          {
            title: args.title,
            description: args.description ?? null,
            startAt: args.startAt,
            endAt: args.endAt ?? null,
            allDay: args.allDay ?? false,
            type: args.type ?? 'FOLLOW_UP',
            priority: args.priority ?? 'NORMAL',
            color: args.color ?? null,
          },
        );
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
        const entry = await this.getTimeEntry().startTimer({
          businessId,
          userId: 'key_ai',
          description: args.description,
          projectId: args.projectId,
          taskId: args.taskId,
          hourlyRate: args.hourlyRate,
          billable: true,
        });
        return { id: entry.id, startTime: entry.startTime };
      }
      case 'time_stop_timer': {
        const updated = await this.getTimeEntry().stopTimer(args.timeEntryId, businessId, 'key_ai');
        return { id: updated.id, durationMinutes: updated.durationMinutes };
      }
      case 'time_log_entry': {
        const start = new Date(args.startTime);
        const end = new Date(args.endTime);
        const entry = await this.getTimeEntry().create({
          businessId,
          userId: 'key_ai',
          description: args.description,
          startTime: start,
          endTime: end,
          projectId: args.projectId,
          taskId: args.taskId,
          hourlyRate: args.hourlyRate,
          billable: args.billable ?? true,
        });
        return { id: entry.id, durationMinutes: entry.durationMinutes };
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
        const ticket = await this.getHelpdesk().createTicket(businessId, {
          title: args.title,
          description: args.description ?? undefined,
          contactId: args.contactId,
          priority: args.priority ?? 'NORMAL',
        });
        return { id: ticket.id, title: ticket.title, status: ticket.status };
      }
      case 'helpdesk_update_ticket': {
        const ticket = await this.getHelpdesk().updateTicket(businessId, args.ticketId, {
          status: args.status,
          priority: args.priority,
          assignedToId: args.assignedToId,
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
        const task = await this.getProjects().updateTask(businessId, args.taskId, {
          title: args.title,
          dueDate: args.dueDate ? new Date(args.dueDate).toISOString() : undefined,
          priority: args.priority,
          isCompleted: args.isCompleted,
        });
        return { id: task.id, title: task.title };
      }
      case 'projects_delete_task': {
        await this.getProjects().deleteTask(businessId, args.taskId);
        return { success: true, deletedId: args.taskId };
      }

      // === COMMERCE UPDATES ===
      case 'commerce_update_invoice': {
        const invoice = await this.getCommerce().updateInvoice({
          invoiceId: args.invoiceId,
          businessId,
          status: args.status,
          dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
          notes: args.notes ?? undefined,
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
        const updated = await this.getCommerce().updateInvoiceStatus({
          invoiceId: args.invoiceId,
          status: 'SENT',
          actorId: KEY_SYSTEM_ACTOR_ID,
          businessId,
          sentAt: new Date(),
        });
        // Log activity
        await this.getActivityLog().createActivity({
          businessId,
          module: 'commerce',
          action: 'invoice_sent',
          entityType: 'invoice',
          entityId: invoice.id,
          title: `Invoice ${invoice.invoiceNumber} sent to ${invoice.contact.firstName ?? ''} ${invoice.contact.lastName ?? ''}`,
          tone: 'success',
        });
        return { id: updated.id, status: updated.status };
      }

      // === MARKETING/SOCIAL UPDATES ===
      case 'marketing_update_campaign': {
        const campaign = await this.getEmailMarketing().updateCampaign({
          businessId,
          id: args.campaignId,
          name: args.name,
          subject: args.subject,
          body: args.body,
          scheduledAt: args.scheduledAt ? new Date(args.scheduledAt).toISOString() : undefined,
        });
        return { id: campaign.id, name: campaign.name };
      }
      case 'social_update_post': {
        const post = await this.getSocial().updatePost(businessId, args.postId, {
          content: args.content,
          scheduledAt: args.scheduledFor ? new Date(args.scheduledFor).toISOString() : undefined,
        });
        return { id: post.id, status: post.status };
      }

      // ─── People ───
      //
      // KEY could assign a task to itself and to nobody else. These give it the
      // rest of the team: who they are, what they are carrying, and the ability
      // to hand work to a human.
      case 'people_list': {
        return this.getStructure().listPeople(businessId, {
          search: args.search,
          limit: args.limit,
        });
      }

      case 'people_workload': {
        return this.getTaskAssignment().workloadSummary(businessId);
      }

      case 'people_org_chart': {
        const structure = this.getStructure();
        const [tree, stats] = await Promise.all([
          structure.getOrgTree(businessId),
          structure.getStats(businessId),
        ]);
        return { tree, stats };
      }

      case 'people_recommend_assignee': {
        return this.getAssignmentRecommender().recommend(businessId, {
          taskType: args.taskType ?? 'ContactTask',
          taskTitle: args.taskTitle,
        });
      }

      case 'people_assign_task': {
        // businessId is passed explicitly. Without it TaskAssignmentService
        // skips assertAssignableInBusiness entirely — the parameter is optional
        // precisely so trusted internal callers can opt out — and a model that
        // hallucinated an id from another tenant would be obeyed.
        const assignment = await this.getTaskAssignment().assign({
          taskType: args.taskType,
          taskId: args.taskId,
          assignableType: args.assignableType,
          assignableId: args.assignableId,
          assignedBy: 'KEY',
          reason: args.reason,
          businessId,
        });

        return {
          assignmentId: assignment.id,
          taskType: args.taskType,
          taskId: args.taskId,
          assignableType: args.assignableType,
          assignableId: args.assignableId,
        };
      }

      default:
        // Bridged organ tools, before we give up. These are declared as
        // FlowTools so they inherit role, route and tier gating, but the work
        // itself belongs to the organ adapter that registered it — so dispatch
        // through the cortex registry rather than reimplementing the handler
        // here. See CORTEX_TOOL_BRIDGE.
        if (isCortexBridgedTool(toolName)) {
          return this.executeBridgedCortexTool(businessId, toolName, args);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Run an organ tool that was bridged into the chat's vocabulary.
   *
   * The flow name is a label; the work belongs to the organ adapter, so this
   * hands off to the cortex registry's `execute` rather than reimplementing the
   * handler. That keeps the organ's own tier, input validation, idempotency and
   * autonomy-safety gate in the pathway — the same reasoning the bridge in the
   * other direction gives for registering rather than calling directly.
   *
   * `preApproved: true` is correct and load-bearing here. checkRisk answers
   * "may KEY do this unattended?", which is the wrong question on this path: a
   * human typed the request, and the chat already ran AiOversightService.evaluate
   * — role allowlist, business blocked-tools, tier thresholds and the
   * confirm/approve flow — before we got here. Without it, an organ tool above
   * the autonomy threshold would be refused and filed as an approval proposal
   * for an action the user is sitting there asking for.
   *
   * It does NOT bypass KeyAutonomySafetyService: the kill switch, the daily
   * action cap and the spend cap are checked before this and still apply.
   */
  private async executeBridgedCortexTool(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    const cortexName = CORTEX_TOOL_BRIDGE[toolName];

    let registry: KeyCortexToolRegistryService;
    try {
      registry = this.moduleRef.get(KeyCortexToolRegistryService, { strict: false });
    } catch {
      throw new Error(`${toolName} is unavailable: the cortex registry is not loaded`);
    }

    if (!registry.hasTool(cortexName)) {
      // The organ that owns this name did not register. Say which name is
      // missing rather than returning an empty result that reads like "your
      // inbox is empty" — a wrong answer is worse here than an error.
      throw new Error(`${toolName} is unavailable: no organ has registered ${cortexName}`);
    }

    const result = await registry.execute(cortexName, { businessId, preApproved: true }, args);

    if (!result.success) {
      throw new Error(result.error ?? `${toolName} failed`);
    }
    return result.data ?? {};
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

  /**
   * SESSION PRIVACY.
   *
   * Chat sessions were scoped to the BUSINESS and nothing else, and
   * `listSessions` returned every session in it — so any team member could open
   * the owner's conversations with KEY. An owner discussing whether to let
   * someone go, or their own cash position, was readable by the person they
   * were discussing.
   *
   * Tenancy in this repo is businessId, and that is right for business DATA:
   * an invoice belongs to the company. A conversation does not. It is the
   * closest thing KEY has to a private thought, and the default has to be
   * private, because you can always choose to share and you cannot un-leak.
   *
   * `userId` is nullable because sessions created before this change have no
   * owner. Those are excluded from every listing rather than shown to
   * everyone — the safe reading of "we do not know whose this was". They are
   * not deleted; a backfill can claim them if their owner can be established.
   */

  /**
   * Check a completed reply against the words this business forbade.
   *
   * `BusinessBlueprint.brand.doNotSay` invites an operator to declare language
   * KEY must never use, and `detectValueConflict` has existed to check it since
   * it was written — with zero callers. So the invitation created an
   * expectation nothing honoured. KEY is now also TOLD about the terms in its
   * prompt (KeyCortexEpigeneticsService), but a prompt instruction is guidance,
   * not enforcement.
   *
   * WHAT CANNOT BE DONE, HONESTLY. The chat streams token by token. By the time
   * a forbidden word exists it has already been sent, and no post-hoc check can
   * unsay it. Buffering the whole reply to screen it first would put the entire
   * generation latency in front of the first token, which trades a rare wording
   * slip for a guaranteed worse experience on every message.
   *
   * So this does not pretend to block. It LEARNS. A violation is written to
   * AiMemory `learned_corrections`, which `buildContextBlock` already renders
   * into the next prompt under "Lessons from past failures" — a loop that is
   * live and proven. The instruction gets stronger and more specific precisely
   * when it has been ignored, which is when it needs to be.
   *
   * Fire-and-forget, and never throws: this runs after the user already has
   * their answer, and must not be able to affect it.
   */
  private async enforceDoNotSay(businessId: string, text: string): Promise<void> {
    if (!text?.trim()) return;

    try {
      const personality = this.moduleRef.get(KeyCortexPersonalityService, { strict: false });
      const memory = this.moduleRef.get(AiMemoryService, { strict: false });
      if (!personality || !memory) return;

      const { conflict, terms } = await personality.detectValueConflict(businessId, text);
      if (!conflict || terms.length === 0) return;

      this.logger.warn(
        `[doNotSay] reply used ${terms.length} forbidden term(s) for ${businessId}: ${terms.join(', ')}`,
      );

      // Keyed on the terms so repeating the same slip refreshes one lesson
      // rather than accumulating thousands of near-identical rows.
      const key = `do_not_say:${terms.map((t: string) => t.toLowerCase()).sort().join('|')}`;
      await memory.upsert(businessId, {
        category: 'learned_corrections',
        key,
        value: JSON.stringify({
          category: 'brand_voice',
          reason: 'A previous reply used language this business has forbidden.',
          learnedPattern:
            `Never write ${terms.map((t: string) => `"${t}"`).join(' or ')} — ` +
            `this business declared ${terms.length === 1 ? 'it' : 'them'} off-limits, ` +
            `and a previous reply used ${terms.length === 1 ? 'it' : 'them'} anyway.`,
        }),
        source: 'feedback_loop',
        confidence: 1,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch (err) {
      this.logger.debug(
        `[doNotSay] check skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private sessionScope(businessId: string, userId?: string) {
    // An undefined userId must NEVER widen the query to "all sessions". It
    // narrows to the legacy-null set, which is empty for any normal caller.
    return { businessId, userId: userId ?? null };
  }

  async getConversationHistory(
    businessId: string,
    sessionId: string,
    userId?: string,
  ): Promise<FlowMessage[]> {
    const session = await this.prisma.client.flowSession.findFirst({
      where: { id: sessionId, ...this.sessionScope(businessId, userId) },
      select: { messages: true },
    });
    if (!session) return [];
    return (session.messages as any[]) || [];
  }

  async saveConversationHistory(
    businessId: string,
    sessionId: string,
    messages: FlowMessage[],
    userId?: string,
  ): Promise<void> {
    await this.prisma.client.flowSession.upsert({
      where: { id: sessionId },
      create: { id: sessionId, businessId, userId: userId ?? null, messages: messages as any },
      // userId is set on create only. Re-assigning an existing session's owner
      // on every save would let whoever writes last take ownership of someone
      // else's conversation.
      update: { messages: messages as any, updatedAt: new Date() },
    });
  }

  async listSessions(businessId: string, userId?: string) {
    return this.prisma.client.flowSession.findMany({
      where: this.sessionScope(businessId, userId),
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, updatedAt: true, messages: true },
    });
  }

  async clearSession(businessId: string, sessionId: string, userId?: string) {
    await this.prisma.client.flowSession.updateMany({
      where: { id: sessionId, ...this.sessionScope(businessId, userId) },
      data: { messages: [] },
    });
  }

  async deleteSession(businessId: string, sessionId: string, userId?: string) {
    await this.prisma.client.flowSession.deleteMany({
      where: { id: sessionId, ...this.sessionScope(businessId, userId) },
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
    } catch (error: any) {
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

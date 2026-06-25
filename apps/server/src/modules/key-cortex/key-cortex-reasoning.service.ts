/**
 * KEY Cortex Reasoning Engine
 *
 * The brain of the operation. Takes a user's question, loads the genome
 * context, calls Kimi (Moonshot AI) with structured data + tools, and
 * produces an evidence-based, confident answer.
 *
 * Uses a ReAct-style loop: Reason → Act → Observe → Respond.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ModelGatewayService, type GatewayMessage, type GatewayToolDefinition } from '../ai/model-gateway.service';
import { GenomeContextAssembler } from './genome-context-assembler.service';
import type {
  CortexSession,
  CortexIntent,
  CortexConfidence,
  CortexReasoningInput,
  CortexReasoningResult,
  CortexToolCall,
  CortexActionProposal,
  CortexEvidence,
  CortexConfig,
  GenomeContextSnapshot,
} from './key-cortex.types';

@Injectable()
export class KeyCortexReasoningService {
  private readonly logger = new Logger(KeyCortexReasoningService.name);

  constructor(
    private readonly gateway: ModelGatewayService,
    private readonly assembler: GenomeContextAssembler,
  ) {}

  /**
   * Main reasoning entry point.
   * 
   * 1. Classify intent
   * 2. Assemble genome context
   * 3. Build tool-augmented prompt
   * 4. Call AI (Kimi primary)
   * 5. Parse tool calls and actions
   * 6. Return structured result
   */
  async reason(
    session: CortexSession,
    userMessage: string,
    config: CortexConfig,
  ): Promise<CortexReasoningResult> {
    const startTime = Date.now();

    // Step 1: Classify intent (fast, cheap call)
    const intent = await this.classifyIntent(userMessage, config);
    this.logger.log(`Intent classified: ${intent} for business ${session.businessId}`);

    // Step 2: Assemble genome context
    const genomeContext = intent === 'CHAT'
      ? await this.assembler.assembleMinimal(session.businessId)
      : await this.assembler.assemble(session.businessId, config);

    // Step 3: Build messages
    const messages = await this.buildMessages(session, userMessage, genomeContext, intent, config);
    const tools = this.buildAvailableTools();

    // Step 4: Call AI with tool-calling
    const response = await this.gateway.complete({
      businessId: session.businessId,
      taskCategory: 'reasoning',
      messages,
      tools,
      toolChoice: 'auto',
      temperature: 0.4,
      maxTokens: 4096,
      providerOverride: config.primaryProvider,
      modelOverride: config.reasoningModel,
    });

    // Step 5: Parse response
    const result = this.parseResponse(response.content ?? '', response.toolCalls ?? [], genomeContext, intent);

    const latencyMs = Date.now() - startTime;
    this.logger.log(`Reasoning complete in ${latencyMs}ms (${response.provider}/${response.model})`);

    return {
      ...result,
      provider: response.provider,
      model: response.model,
      latencyMs,
      tokensUsed: response.usage.totalTokens,
    };
  }

  /**
   * Stream reasoning for real-time responses.
   */
  async *streamReason(
    session: CortexSession,
    userMessage: string,
    config: CortexConfig,
  ): AsyncGenerator<{ type: 'THINKING' | 'CONTENT' | 'TOOL_CALL' | 'DONE'; content?: string; toolCall?: CortexToolCall }> {
    const intent = await this.classifyIntent(userMessage, config);
    const genomeContext = await this.assembler.assemble(session.businessId, config);
    const messages = await this.buildMessages(session, userMessage, genomeContext, intent, config);
    const tools = this.buildAvailableTools();

    yield { type: 'THINKING', content: `Analyzing ${intent.toLowerCase()} query...` };

    const stream = this.gateway.streamComplete({
      businessId: session.businessId,
      taskCategory: 'reasoning',
      messages,
      tools,
      toolChoice: 'auto',
      temperature: 0.4,
      maxTokens: 4096,
      providerOverride: config.primaryProvider,
      modelOverride: config.reasoningModel,
    });

    let buffer = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_delta' && chunk.content) {
        buffer += chunk.content;
        yield { type: 'CONTENT', content: chunk.content };
      }
      if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
        yield {
          type: 'TOOL_CALL',
          toolCall: {
            toolName: chunk.toolCall.name ?? 'unknown',
            arguments: chunk.toolCall.argumentsDelta ? JSON.parse(chunk.toolCall.argumentsDelta) : {},
          },
        };
      }
      if (chunk.type === 'done') {
        yield { type: 'DONE' };
      }
    }
  }

  /**
   * Fast intent classification using the gateway.
   */
  private async classifyIntent(message: string, config: CortexConfig): Promise<CortexIntent> {
    try {
      const result = await this.gateway.complete({
        businessId: '__system__',
        taskCategory: 'classification',
        messages: [
          { role: 'system', content: 'Classify the user message into exactly one intent. Respond with ONLY the intent code.\n\nQUESTION: asking for data/analysis ("what are my margins?")\nCOMMAND: asking to execute ("send invoice reminders")\nIDEA: proposing something new ("thinking of launching...")\nCRISIS: urgent problem ("customer churned", "cash flow issue")\nPLAN: requesting a plan/strategy\nANALYSIS: diagnostic request ("why did revenue drop?")\nSCENARIO: hypothetical modeling ("what if I raise prices?")\nOPPORTUNITY: profit-seeking\nREVIEW: business health check\nCHAT: greeting, small talk, or vague message' },
          { role: 'user', content: message },
        ],
        temperature: 0.1,
        maxTokens: 20,
        providerOverride: config.primaryProvider,
        modelOverride: config.fastModel,
      });

      const intent = (result.content ?? 'CHAT').trim().toUpperCase();
      const validIntents: CortexIntent[] = ['QUESTION', 'COMMAND', 'IDEA', 'CRISIS', 'PLAN', 'ANALYSIS', 'SCENARIO', 'OPPORTUNITY', 'REVIEW', 'CHAT', 'VOICE'];
      return validIntents.includes(intent as CortexIntent) ? (intent as CortexIntent) : 'CHAT';
    } catch {
      return 'CHAT';
    }
  }

  /**
   * Build the complete message payload for the AI.
   */
  private async buildMessages(
    session: CortexSession,
    userMessage: string,
    genomeContext: GenomeContextSnapshot,
    _intent: CortexIntent,
    config: CortexConfig,
  ): Promise<GatewayMessage[]> {
    // System prompt with genome context
    const systemPrompt = this.assembler.formatAsSystemPrompt(genomeContext, config.personality);

    const messages: GatewayMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history (last 10 messages)
    const history = session.messages.slice(-10);
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add the user's current message
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  /**
   * Define the tools available to the AI.
   */
  private buildAvailableTools(): GatewayToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_finance_snapshot',
          description: 'Get the latest financial snapshot including revenue, margins, runway, and risks',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_sales_snapshot',
          description: 'Get the latest customer/sales snapshot including retention, CAC, LTV',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_operations_snapshot',
          description: 'Get the latest operations snapshot including process maturity, capacity risks',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_marketing_snapshot',
          description: 'Get the latest marketing snapshot including channel mix, CAC, lead volume',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_recommendations',
          description: 'Get active business recommendations ranked by expected gain',
          parameters: { type: 'object', properties: { domain: { type: 'string', description: 'Filter by domain: finance, sales, operations, marketing' }, limit: { type: 'number' } }, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_facts',
          description: 'Search genome facts by domain, section, or field',
          parameters: { type: 'object', properties: { domain: { type: 'string' }, section: { type: 'string' }, field: { type: 'string' }, limit: { type: 'number' } }, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_recommendation',
          description: 'Create a new business recommendation for the user to review',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              domain: { type: 'string' },
              insight: { type: 'string' },
              diagnosis: { type: 'string' },
              recommendation: { type: 'string' },
              expectedGain: { type: 'string' },
              riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
              effortLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            },
            required: ['title', 'domain', 'insight', 'recommendation'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_autonomy',
          description: 'Check if an action is safe to execute autonomously',
          parameters: {
            type: 'object',
            properties: {
              actionType: { type: 'string' },
              affectedDomains: { type: 'array', items: { type: 'string' } },
            },
            required: ['actionType'],
          },
        },
      },
    ];
  }

  /**
   * Parse the AI response into structured output.
   */
  private parseResponse(
    content: string,
    toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>,
    genomeContext: GenomeContextSnapshot,
    intent: CortexIntent,
  ): Omit<CortexReasoningResult, 'provider' | 'model' | 'latencyMs' | 'tokensUsed'> {
    // Parse tool calls
    const parsedToolCalls: CortexToolCall[] = toolCalls.map(tc => ({
      toolName: tc.function.name,
      arguments: this.safeParseJson(tc.function.arguments),
    }));

    // Extract actions from content
    const actionsProposed = this.extractActions(content, genomeContext);

    // Extract evidence references
    const evidence = this.extractEvidence(content, genomeContext);

    // Determine confidence
    const confidence = this.inferConfidence(content, evidence);

    // Generate follow-up questions
    const followUpQuestions = this.generateFollowUps(content, intent, genomeContext);

    return {
      response: content,
      intent,
      confidence,
      toolsCalled: parsedToolCalls,
      actionsProposed,
      evidence,
      followUpQuestions,
    };
  }

  private extractActions(content: string, _ctx: GenomeContextSnapshot): CortexActionProposal[] {
    const actions: CortexActionProposal[] = [];
    const actionPattern = /\[ACTION:\s*(.+?)\]/gi;
    let match;

    while ((match = actionPattern.exec(content)) !== null) {
      const actionText = match[1].trim();
      const riskMatch = actionText.match(/risk:\s*(LOW|MEDIUM|HIGH|CRITICAL)/i);
      const approvalMatch = actionText.match(/approval:\s*(required|optional|none)/i);

      actions.push({
        id: `action_${Date.now()}_${actions.length}`,
        actionType: 'GENERAL',
        title: actionText.substring(0, 80),
        description: actionText,
        rationale: 'Extracted from AI response',
        payload: {},
        riskLevel: (riskMatch?.[1]?.toUpperCase() as any) ?? 'MEDIUM',
        requiresApproval: (approvalMatch?.[1] ?? 'required') === 'required',
        expectedOutcome: 'See description',
        estimatedImpact: 'To be quantified',
      });
    }

    return actions;
  }

  private extractEvidence(content: string, ctx: GenomeContextSnapshot): CortexEvidence[] {
    const evidence: CortexEvidence[] = [];

    // Check if content references specific facts
    ctx.facts.forEach(fact => {
      const fieldPattern = new RegExp(fact.field.replace(/_/g, '[_\\s]'), 'i');
      if (fieldPattern.test(content) || content.includes(String(fact.value.raw))) {
        evidence.push({
          type: 'FACT',
          source: `${fact.domain}/${fact.section}`,
          description: `${fact.field}: ${JSON.stringify(fact.value.raw)}`,
          confidence: fact.score.confidence,
          id: fact.id,
          value: fact.value.raw,
        });
      }
    });

    // Check for snapshot references
    if (ctx.finance && /\b(revenue|margin|cash|runway|profit)\b/i.test(content)) {
      evidence.push({
        type: 'SNAPSHOT',
        source: 'finance',
        description: `Finance snapshot (health: ${ctx.finance.healthScore}/100)`,
        confidence: 85,
      });
    }

    if (ctx.sales && /\b(customer|LTV|CAC|churn|retention|conversion)\b/i.test(content)) {
      evidence.push({
        type: 'SNAPSHOT',
        source: 'sales',
        description: `Sales snapshot (revenue quality: ${ctx.sales.revenueQualityScore}/100)`,
        confidence: 85,
      });
    }

    return evidence;
  }

  private inferConfidence(content: string, evidence: CortexEvidence[]): CortexConfidence {
    const lower = content.toLowerCase();

    if (lower.includes('certainly') || lower.includes('definitely') || evidence.length >= 3) {
      return evidence.length > 0 ? 'CERTAIN' : 'HIGH';
    }
    if (lower.includes('likely') || lower.includes('probably') || evidence.length >= 2) {
      return 'HIGH';
    }
    if (lower.includes('may') || lower.includes('might') || lower.includes('could') || evidence.length >= 1) {
      return 'MODERATE';
    }
    if (lower.includes('unsure') || lower.includes('unclear') || lower.includes('insufficient data')) {
      return 'LOW';
    }
    return evidence.length > 0 ? 'MODERATE' : 'SPECULATIVE';
  }

  private generateFollowUps(content: string, intent: CortexIntent, ctx: GenomeContextSnapshot): string[] {
    const followUps: string[] = [];
    const lower = content.toLowerCase();

    // Context-aware follow-ups based on intent and genome state
    if (intent === 'QUESTION' && !lower.includes('would you like')) {
      followUps.push('Would you like me to dive deeper into any specific area?');
    }

    if (ctx.genomeScore.overall < 60 && intent !== 'REVIEW') {
      followUps.push('Your overall genome health is below 60%. Want me to run a full business health review?');
    }

    if (ctx.autonomyGate.overallRisk === 'HIGH' || ctx.autonomyGate.overallRisk === 'CRITICAL') {
      followUps.push(`Warning: ${ctx.autonomyGate.overallRisk} risk level detected. Should I prioritize risk mitigation?`);
    }

    if (ctx.recommendations.length > 0 && intent !== 'OPPORTUNITY') {
      followUps.push(`You have ${ctx.recommendations.length} active recommendations. Want me to show the highest-impact ones?`);
    }

    if (ctx.crossDomain?.opportunities?.length && intent !== 'OPPORTUNITY') {
      followUps.push('I also found potential opportunities in your cross-domain analysis. Interested?');
    }

    return followUps.slice(0, 3);
  }

  private safeParseJson(json: string): Record<string, unknown> {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
}

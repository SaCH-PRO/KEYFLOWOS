// ============================================================================
// KEY CORTEX COMMAND SERVICE
// Natural Language → Structured KeyFlowOS Commands
// ============================================================================
// Parses user intent using AI (gpt-4o-mini) into executable connector commands.
// Handles multi-step detection, validation, and human-readable confirmations.
//
// Sections:
//   1. Imports & Types
//   2. Injectable Service
//   3. parseIntent()           – AI-driven NL → ParsedIntent[]
//   4. parseMultiStep()        – Sequential command detection
//   5. validateIntent()        – Capability & parameter validation
//   6. toConnectorCommand()    – ParsedIntent → ConnectorCommand
//   7. generateConfirmation()  – Human-readable approval message
//   8. buildParsePrompt()      – Comprehensive AI prompt builder
//   9. Utility Helpers
// ============================================================================

import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';

// ─── Connector Types ──────────────────────────────────────────────────────────
import {
  ModuleCapability,
  ModuleAction,
  ParsedIntent,
  ConnectorCommand,
  ModuleName,
} from './key-cortex-connector.types';

// ─── Connector Service ────────────────────────────────────────────────────────
import { KeyCortexConnectorService } from './key-cortex-connector.service';

// ─── Command Router (v4) ─────────────────────────────────────────────────────
import { KeyCommandRouterService } from './key-command-router.service';

// ─── AI Services ──────────────────────────────────────────────────────────────
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';

// ─── Constants ────────────────────────────────────────────────────────────────
const AI_MODEL_FOR_PARSING = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.1;
const MAX_RETRIES = 3;
const MULTI_STEP_KEYWORDS = [
  ' and ', ' then ', ' also ', ' afterwards ', ' after that ',
  ' next ', ' followed by ', ' in addition ', ' plus ',
  '; ', ' | ', ' >> ', ' -> ',
  ', then ', ', and ', ', also ',
];

// ─── Local Types ──────────────────────────────────────────────────────────────
export interface CommandContext {
  businessId: string;
  userId: string;
  businessName: string;
  currentPage?: string;
  recentActions?: string[];
  userPreferences?: Record<string, unknown>;
  timezone?: string;
  language?: string;
}

export interface ParseOptions {
  temperature?: number;
  maxTokens?: number;
  skipValidation?: boolean;
}

interface RawParsedIntent {
  intent?: string;
  confidence?: number;
  module?: string;
  action?: string;
  parameters?: Record<string, unknown>;
  requiresApproval?: boolean;
  naturalLanguage?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable()
export class KeyCortexCommandService {
  private readonly logger = new Logger(KeyCortexCommandService.name);

  constructor(
    private readonly modelGateway: ModelGatewayService,
    private readonly connector: KeyCortexConnectorService,
    private readonly aiUsage: AiUsageService,

    // ── v4: Command Router (optional — graceful degradation) ──
    @Optional()
    @Inject(KeyCommandRouterService)
    private readonly router?: KeyCommandRouterService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 3 — parseIntent()
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Parse a single natural-language request into one or more structured intents.
   *
   * 1. Try command router first (v4) for high-confidence matches.
   * 2. Fetch all module capabilities from the connector.
   * 3. Build a comprehensive AI prompt including capabilities, business context,
   *    and the user's request.
   * 4. Call gpt-4o-mini with the prompt.
   * 5. Parse the JSON response safely — with retry/fallback logic.
   * 6. Optionally validate each intent against registered capabilities.
   * 7. Return an ordered array of ParsedIntent objects.
   */
  async parseIntent(
    input: string,
    context: CommandContext,
    options: ParseOptions = {},
  ): Promise<ParsedIntent[]> {
    const startTime = Date.now();
    const inputTrimmed = input.trim();

    this.logger.debug(
      `[parseIntent] Parsing: "${inputTrimmed.substring(0, 80)}…" for biz=${context.businessId}`,
    );

    // ── 0. Try command router first (v4) ───────────────────────────────────
    if (this.router) {
      try {
        const routed = await this.router.route(inputTrimmed, {
          businessId: context.businessId,
          userId: context.userId,
          query: inputTrimmed,
        });
        if (routed.confidence > 0.7) {
          this.logger.log(
            `[parseIntent] Command router matched with confidence ${routed.confidence} — returning routed intents`,
          );
          // Convert routed intents to ParsedIntent[] format
          return routed.intents.map((intent) => ({
            intent: intent.intent ?? intent.action ?? 'unknown',
            confidence: routed.confidence,
            module: intent.module as any,
            action: intent.action,
            parameters: intent.parameters ?? {},
            requiresApproval: intent.requiresApproval ?? false,
            naturalLanguage: intent.naturalLanguage ?? inputTrimmed,
          }));
        }
      } catch (err) {
        this.logger.warn(
          `[parseIntent] Router failed, falling back to AI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── 1. Capabilities ──────────────────────────────────────────────────────
    const capabilities = this.connector.getAllCapabilities();

    // ── 2. Build prompt ──────────────────────────────────────────────────────
    const prompt = this.buildParsePrompt(inputTrimmed, capabilities, context);

    // ── 3. Call AI ───────────────────────────────────────────────────────────
    let rawText: string | undefined;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      attempts++;
      try {
        rawText = await this.modelGateway.complete({
          model: AI_MODEL_FOR_PARSING,
          messages: [
            {
              role: 'system',
              content:
                'You are KEY, the KeyFlowOS command parser. You convert natural language requests into structured JSON commands. Respond ONLY with valid JSON. No markdown, no explanations.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          maxTokens: options.maxTokens ?? 2048,
        });
        break;
      } catch (err) {
        this.logger.warn(
          `[parseIntent] AI call attempt ${attempts} failed: ${(err as Error).message}`,
        );
        if (attempts === MAX_RETRIES) {
          // Final fallback: treat the whole input as a single intent
          return this.fallbackParse(inputTrimmed, capabilities);
        }
        await this.delay(100 * attempts);
      }
    }

    // ── 4. Parse JSON safely ─────────────────────────────────────────────────
    const parsed = this.safeJsonParse<RawParsedIntent[]>(rawText ?? '[]');

    if (!parsed || parsed.length === 0) {
      this.logger.warn('[parseIntent] Empty or unparseable AI response; using fallback');
      return this.fallbackParse(inputTrimmed, capabilities);
    }

    // ── 5. Transform & (optionally) validate ─────────────────────────────────
    const intents: ParsedIntent[] = parsed
      .map((raw) => this.normalizeIntent(raw, inputTrimmed))
      .filter((intent): intent is ParsedIntent => intent !== null);

    const validated = options.skipValidation
      ? intents
      : intents.filter((intent) => this.validateIntent(intent, capabilities));

    // ── 6. Track AI usage ────────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    await this.aiUsage
      .track({
        model: AI_MODEL_FOR_PARSING,
        tokensUsed: this.estimateTokens(prompt, rawText ?? ''),
        promptTokens: this.estimateTokens(prompt),
        completionTokens: this.estimateTokens(rawText ?? ''),
        durationMs: duration,
        businessId: context.businessId,
        userId: context.userId,
        feature: 'key_cortex_command_parse',
      })
      .catch(() => {
        /* non-blocking */
      });

    this.logger.log(
      `[parseIntent] Parsed ${validated.length} intent(s) from "${inputTrimmed.substring(0, 60)}…" in ${duration}ms`,
    );

    return validated;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 4 — parseMultiStep()
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Detect when the user wants multiple things ("and", "then", "also", …).
   *
   * Strategy:
   *   a) Detect multi-step keywords.
   *   b) If found, inject a pre-parsing hint into the AI prompt asking it to
   *      return an *ordered array* of commands.
   *   c) Otherwise, delegate to parseIntent().
   */
  async parseMultiStep(
    input: string,
    context: CommandContext,
    options: ParseOptions = {},
  ): Promise<ParsedIntent[]> {
    const inputTrimmed = input.trim();

    // ── Quick keyword detection ──────────────────────────────────────────────
    const lower = inputTrimmed.toLowerCase();
    const isMultiStep = MULTI_STEP_KEYWORDS.some((kw) => lower.includes(kw));

    if (!isMultiStep) {
      // Single-step shortcut
      return this.parseIntent(inputTrimmed, context, options);
    }

    this.logger.debug(
      `[parseMultiStep] Multi-step detected in: "${inputTrimmed.substring(0, 80)}…"`,
    );

    // ── Enrich the prompt for multi-step parsing ─────────────────────────────
    const capabilities = this.connector.getAllCapabilities();
    const prompt = this.buildMultiStepPrompt(inputTrimmed, capabilities, context);

    let rawText: string | undefined;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      attempts++;
      try {
        rawText = await this.modelGateway.complete({
          model: AI_MODEL_FOR_PARSING,
          messages: [
            {
              role: 'system',
              content:
                'You are KEY, the KeyFlowOS command parser. The user request contains MULTIPLE steps. Respond with a JSON ARRAY where each element is a step in order. ONLY valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          maxTokens: options.maxTokens ?? 4096,
        });
        break;
      } catch (err) {
        this.logger.warn(
          `[parseMultiStep] AI call attempt ${attempts} failed: ${(err as Error).message}`,
        );
        if (attempts === MAX_RETRIES) {
          return this.splitAndParseFallback(inputTrimmed, context, options);
        }
        await this.delay(100 * attempts);
      }
    }

    // ── Parse the ordered array ──────────────────────────────────────────────
    const parsed = this.safeJsonParse<RawParsedIntent[]>(rawText ?? '[]');

    if (!parsed || parsed.length === 0) {
      this.logger.warn('[parseMultiStep] Empty response; using split fallback');
      return this.splitAndParseFallback(inputTrimmed, context, options);
    }

    // ── Normalize & validate ─────────────────────────────────────────────────
    const intents: ParsedIntent[] = parsed
      .map((raw, idx) => this.normalizeIntent(raw, inputTrimmed, idx))
      .filter((intent): intent is ParsedIntent => intent !== null);

    const validated = options.skipValidation
      ? intents
      : intents.filter((intent) => this.validateIntent(intent, capabilities));

    this.logger.log(
      `[parseMultiStep] Resolved ${validated.length} step(s) from multi-step request`,
    );

    return validated;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 5 — validateIntent()
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Ensure the parsed intent maps to a real module + action and that all
   * required parameters are present (with sensible defaults filled in).
   *
   * @returns  true  – intent is valid (mutated in-place with defaults)
   *           false – intent references unknown module/action or misses
   *                   required parameters
   */
  validateIntent(
    intent: ParsedIntent,
    capabilities: ModuleCapability[],
  ): boolean {
    // ── Module existence ─────────────────────────────────────────────────────
    const cap = capabilities.find((c) => c.module === intent.module);
    if (!cap) {
      this.logger.warn(
        `[validateIntent] Unknown module "${intent.module}" for intent "${intent.intent}"`,
      );
      return false;
    }

    // ── Action existence ─────────────────────────────────────────────────────
    const action = cap.actions.find((a) => a.name === intent.action);
    if (!action) {
      this.logger.warn(
        `[validateIntent] Unknown action "${intent.action}" in module "${intent.module}"`,
      );
      return false;
    }

    // ── Sync requiresApproval flag from canonical definition ─────────────────
    intent.requiresApproval = action.requiresApproval;

    // ── Required parameters ──────────────────────────────────────────────────
    const missing: string[] = [];
    for (const param of action.parameters) {
      if (param.required && !(param.name in intent.parameters)) {
        // Try to fill from default
        if (param.default !== undefined) {
          intent.parameters[param.name] = param.default;
        } else {
          missing.push(param.name);
        }
      }

      // Type coercion for known types
      if (param.name in intent.parameters) {
        intent.parameters[param.name] = this.coerceParameter(
          intent.parameters[param.name],
          param.type,
        );
      }
    }

    if (missing.length > 0) {
      this.logger.warn(
        `[validateIntent] Intent "${intent.intent}" missing required params: [${missing.join(', ')}]`,
      );
      // Still valid — downstream can prompt user for missing values
    }

    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 6 — toConnectorCommand()
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Convert a ParsedIntent into a fully-qualified ConnectorCommand ready for
   * execution by the KeyCortexConnectorService.
   */
  toConnectorCommand(
    intent: ParsedIntent,
    businessId: string,
    userId: string,
  ): ConnectorCommand {
    return {
      module: intent.module,
      action: intent.action,
      parameters: { ...intent.parameters },
      businessId,
      userId,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: this.generateCorrelationId(intent),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 7 — generateConfirmation()
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Produce a human-readable confirmation message summarising the commands
   * that KEY is about to execute.
   *
   * Example output:
   *   "I'll create an invoice for John Smith for $500 and send it via email. Approve?"
   */
  generateConfirmation(commands: ConnectorCommand[]): string {
    if (commands.length === 0) {
      return "I couldn't determine any actions from your request. Could you rephrase?";
    }

    if (commands.length === 1) {
      return this.summarizeSingleCommand(commands[0]);
    }

    // Multi-command summary
    const parts = commands.map((cmd, idx) => {
      const summary = this.summarizeSingleCommand(cmd, false);
      // Lower-case first letter for flow
      return idx === 0
        ? summary
        : summary.charAt(0).toLowerCase() + summary.slice(1);
    });

    const last = parts.pop();
    const joined = parts.length > 0 ? `${parts.join(', ')} and ${last}` : `${last}`;

    const approvalCount = commands.filter((c) =>
      this.actionRequiresApproval(c.module, c.action),
    ).length;

    const suffix =
      approvalCount > 0
        ? ` Some actions require approval.`
        : '';

    return `I'll ${joined.charAt(0).toLowerCase()}${joined.slice(1)}.${suffix} Approve?`;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 8 — Prompt Builders
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Build the full AI prompt for single-step intent parsing.
   * Includes every module, action, parameter, and example.
   */
  buildParsePrompt(
    input: string,
    capabilities: ModuleCapability[],
    context: CommandContext,
  ): string {
    const lines: string[] = [];

    // ── Header ───────────────────────────────────────────────────────────────
    lines.push('You are KEY, the KeyFlowOS AI command parser.');
    lines.push('Convert the user request into a JSON array of structured commands.');
    lines.push('');

    // ── Available Capabilities ───────────────────────────────────────────────
    lines.push('=== AVAILABLE MODULES & ACTIONS ===');
    lines.push('');

    for (const cap of capabilities) {
      lines.push(`MODULE: ${cap.module}`);
      lines.push(`  Description: ${cap.description}`);

      if (cap.actions.length > 0) {
        lines.push('  ACTIONS:');
        for (const action of cap.actions) {
          lines.push(`    • ${action.name}: ${action.description}`);
          lines.push(`      requiresApproval: ${action.requiresApproval}`);
          if (action.parameters.length > 0) {
            lines.push('      Parameters:');
            for (const p of action.parameters) {
              const reqFlag = p.required ? 'REQUIRED' : 'optional';
              const enumFlag = p.enumValues ? ` [enum: ${p.enumValues.join('|')}]` : '';
              const defaultFlag = p.default !== undefined ? ` (default: ${p.default})` : '';
              lines.push(`        - ${p.name} (${p.type}) — ${p.description} [${reqFlag}]${enumFlag}${defaultFlag}`);
            }
          }
          if (action.examples.length > 0) {
            lines.push(`      Examples: "${action.examples.join('", "')}"`);
          }
        }
      }

      if (cap.queries.length > 0) {
        lines.push('  QUERIES:');
        for (const query of cap.queries) {
          lines.push(`    • ${query.name}: ${query.description} → returns ${query.returns}`);
        }
      }

      lines.push('');
    }

    // ── User Context ─────────────────────────────────────────────────────────
    lines.push('=== USER CONTEXT ===');
    lines.push(`- Business: ${context.businessName} (ID: ${context.businessId})`);
    lines.push(`- Current page/view: ${context.currentPage ?? 'unknown'}`);
    lines.push(`- User ID: ${context.userId}`);
    lines.push(`- Timezone: ${context.timezone ?? 'UTC'}`);
    lines.push(`- Language: ${context.language ?? 'en'}`);

    if (context.recentActions && context.recentActions.length > 0) {
      lines.push(`- Recent actions: ${context.recentActions.join(', ')}`);
    }
    if (context.userPreferences && Object.keys(context.userPreferences).length > 0) {
      lines.push(`- Preferences: ${JSON.stringify(context.userPreferences)}`);
    }
    lines.push('');

    // ── Response Format ──────────────────────────────────────────────────────
    lines.push('=== RESPONSE FORMAT ===');
    lines.push('Respond with ONLY a JSON array. No markdown fences, no explanation.');
    lines.push('');
    lines.push(`User request: "${input}"`);
    lines.push('');
    lines.push('JSON schema for each item:');
    lines.push(JSON.stringify({
      intent: 'create_invoice',
      confidence: 0.95,
      module: 'commerce',
      action: 'create_invoice',
      parameters: { contactId: '...', amount: 500 },
      requiresApproval: false,
      naturalLanguage: 'Create an invoice for John for $500',
    }, null, 2));

    return lines.join('\n');
  }

  /**
   * Build a prompt specifically tuned for multi-step detection.
   */
  buildMultiStepPrompt(
    input: string,
    capabilities: ModuleCapability[],
    context: CommandContext,
  ): string {
    const basePrompt = this.buildParsePrompt(input, capabilities, context);

    const multiStepInstructions = `
IMPORTANT: The user's request likely contains MULTIPLE independent steps.
Split them into an ORDERED JSON array where each element represents ONE step.
Preserve the original order from the user's request.

If a step depends on a previous step (e.g., "send the invoice" after "create the invoice"),
use parameter references where possible, but keep each step as a separate array item.

Example multi-step input: "Create a campaign for Black Friday, schedule it for Friday, and send it to all leads"
Expected output: [
  { "intent": "create_campaign", "module": "content", "action": "create_campaign", "parameters": { "name": "Black Friday" }, ... },
  { "intent": "schedule_campaign", "module": "content", "action": "schedule_campaign", "parameters": { "campaignName": "Black Friday", "date": "Friday" }, ... },
  { "intent": "send_campaign", "module": "communications", "action": "send_campaign", "parameters": { "campaignName": "Black Friday", "audience": "all leads" }, ... }
]
`;

    return basePrompt + '\n\n' + multiStepInstructions;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION 9 — Utility Helpers
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Generate a correlation ID that encodes intent + timestamp + randomness.
   */
  private generateCorrelationId(intent: ParsedIntent): string {
    const slug = intent.intent.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 6);
    return `kc_${slug}_${ts}_${rand}`;
  }

  /**
   * When the AI call fails entirely, do a best-effort keyword match against
   * registered capabilities to avoid returning empty.
   */
  private fallbackParse(
    input: string,
    capabilities: ModuleCapability[],
  ): ParsedIntent[] {
    this.logger.warn('[fallbackParse] Using keyword-matching fallback parser');

    const lower = input.toLowerCase();
    const matches: ParsedIntent[] = [];

    for (const cap of capabilities) {
      for (const action of cap.actions) {
        // Check action name
        if (lower.includes(action.name.replace(/_/g, ' '))) {
          matches.push(this.buildFallbackIntent(cap.module, action, input));
          continue;
        }
        // Check examples
        for (const example of action.examples) {
          const exampleWords = example.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          const matchCount = exampleWords.filter((w) => lower.includes(w)).length;
          if (matchCount >= Math.max(2, exampleWords.length * 0.5)) {
            matches.push(this.buildFallbackIntent(cap.module, action, input));
            break;
          }
        }
      }
    }

    // Deduplicate by (module, action)
    const seen = new Set<string>();
    const unique = matches.filter((m) => {
      const key = `${m.module}:${m.action}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length === 0) {
      this.logger.warn('[fallbackParse] No keyword match found; returning empty');
    }

    return unique;
  }

  /**
   * Split a multi-step string by conjunctions and parse each fragment separately.
   */
  private async splitAndParseFallback(
    input: string,
    context: CommandContext,
    options: ParseOptions,
  ): Promise<ParsedIntent[]> {
    this.logger.debug('[splitAndParseFallback] Splitting input by keywords');

    // Split on multi-step keywords
    let fragments = [input];
    for (const kw of MULTI_STEP_KEYWORDS) {
      const next: string[] = [];
      for (const f of fragments) {
        next.push(...f.split(kw).map((s) => s.trim()).filter(Boolean));
      }
      fragments = next;
    }

    // Deduplicate
    fragments = [...new Set(fragments)];

    const all: ParsedIntent[] = [];
    for (const frag of fragments) {
      const intents = await this.parseIntent(frag, context, options);
      all.push(...intents);
    }

    return all;
  }

  private buildFallbackIntent(
    module: ModuleName,
    action: ModuleAction,
    input: string,
  ): ParsedIntent {
    // Extract simple parameter guesses from the input
    const params = this.extractParameters(input, action);

    return {
      intent: action.name,
      confidence: 0.6,
      module,
      action: action.name,
      parameters: params,
      requiresApproval: action.requiresApproval,
      naturalLanguage: input,
    };
  }

  /**
   * Naive parameter extraction — look for numbers, dates, email patterns, etc.
   */
  private extractParameters(
    input: string,
    action: ModuleAction,
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const lower = input.toLowerCase();

    for (const param of action.parameters) {
      // Skip if not required and no easy pattern
      if (!param.required) continue;

      switch (param.type) {
        case 'number': {
          const numMatch = input.match(/\$?([0-9,]+\.?\d*)/);
          if (numMatch) {
            params[param.name] = parseFloat(numMatch[1].replace(/,/g, ''));
          }
          break;
        }
        case 'string': {
          // Extract quoted strings
          const quoteMatch = input.match(/"([^"]*)"/);
          if (quoteMatch) {
            params[param.name] = quoteMatch[1];
          }
          break;
        }
        case 'enum': {
          if (param.enumValues) {
            for (const ev of param.enumValues) {
              if (lower.includes(ev.toLowerCase())) {
                params[param.name] = ev;
                break;
              }
            }
          }
          break;
        }
        case 'date': {
          // Match common date patterns
          const datePatterns = [
            /\b(tomorrow)\b/i,
            /\b(today)\b/i,
            /\b(next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
            /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
          ];
          for (const re of datePatterns) {
            const m = input.match(re);
            if (m) {
              params[param.name] = m[1];
              break;
            }
          }
          break;
        }
      }
    }

    return params;
  }

  /**
   * Convert a raw AI response object into a fully-typed ParsedIntent.
   */
  private normalizeIntent(
    raw: RawParsedIntent,
    originalInput: string,
    stepIndex?: number,
  ): ParsedIntent | null {
    if (!raw.module || !raw.action) {
      this.logger.warn('[normalizeIntent] Missing module or action; skipping');
      return null;
    }

    const moduleName = raw.module as ModuleName;

    return {
      intent: raw.intent ?? raw.action ?? 'unknown',
      confidence: raw.confidence ?? 0.8,
      module: moduleName,
      action: raw.action,
      parameters: raw.parameters ?? {},
      requiresApproval: raw.requiresApproval ?? false,
      naturalLanguage:
        raw.naturalLanguage ??
        (stepIndex !== undefined
          ? `${originalInput} (step ${stepIndex + 1})`
          : originalInput),
    };
  }

  /**
   * Parse JSON with multiple fallback strategies.
   */
  private safeJsonParse<T>(raw: string): T | null {
    if (!raw || raw.trim().length === 0) return null;

    // Strategy 1: Direct parse
    try {
      return JSON.parse(raw) as T;
    } catch {
      /* continue */
    }

    // Strategy 2: Strip markdown fences
    try {
      const cleaned = raw
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/^\s*\[\s*\n?\s*"\s*json\s*"\s*\n?\s*/gi, '[')
        .trim();
      return JSON.parse(cleaned) as T;
    } catch {
      /* continue */
    }

    // Strategy 3: Extract first JSON array
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]) as T;
      }
    } catch {
      /* continue */
    }

    // Strategy 4: Extract first JSON object
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        // Wrap single object in array
        const obj = JSON.parse(match[0]);
        return [obj] as unknown as T;
      }
    } catch {
      /* continue */
    }

    this.logger.warn('[safeJsonParse] All JSON parse strategies failed');
    return null;
  }

  /**
   * Coerce a parameter value to its declared type.
   */
  private coerceParameter(
    value: unknown,
    type: string,
  ): unknown {
    switch (type) {
      case 'number':
        if (typeof value === 'string') {
          const parsed = parseFloat(value.replace(/[$,]/g, ''));
          return isNaN(parsed) ? value : parsed;
        }
        return typeof value === 'number' ? value : Number(value);
      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1';
        }
        return Boolean(value);
      case 'string':
        return String(value);
      default:
        return value;
    }
  }

  /**
   * Check whether a specific action requires approval by looking it up in
     * the connector's capability registry.
   */
  private actionRequiresApproval(module: ModuleName, action: string): boolean {
    try {
      const caps = this.connector.getAllCapabilities();
      const cap = caps.find((c) => c.module === module);
      if (!cap) return true; // unknown = safe default
      const act = cap.actions.find((a) => a.name === action);
      return act?.requiresApproval ?? true;
    } catch {
      return true; // safe default
    }
  }

  /**
   * Summarize a single command into a short sentence.
   */
  private summarizeSingleCommand(
    command: ConnectorCommand,
    includeApprove = true,
  ): string {
    const actionDisplay = command.action.replace(/_/g, ' ');

    // Parameter highlights
    const paramHighlights: string[] = [];
    const params = command.parameters;

    if (params.contactName || params.customerName) {
      paramHighlights.push(`for ${params.contactName ?? params.customerName}`);
    } else if (params.contactId) {
      paramHighlights.push(`for contact ${params.contactId}`);
    }
    if (params.amount !== undefined) {
      const amount =
        typeof params.amount === 'number'
          ? `$${params.amount.toFixed(2)}`
          : params.amount;
      paramHighlights.push(`for ${amount}`);
    }
    if (params.email) {
      paramHighlights.push(`via email to ${params.email}`);
    }
    if (params.name) {
      paramHighlights.push(`named "${params.name}"`);
    }
    if (params.title) {
      paramHighlights.push(`"${params.title}"`);
    }
    if (params.date || params.dueDate || params.scheduledDate) {
      paramHighlights.push(`on ${params.date ?? params.dueDate ?? params.scheduledDate}`);
    }

    const paramStr = paramHighlights.length > 0
      ? ` ${paramHighlights.join(' ')}`
      : '';

    const prefix = includeApprove ? "I'll " : '';
    const suffix = includeApprove ? '. Approve?' : '';

    return `${prefix}${actionDisplay}${paramStr}${suffix}`;
  }

  /**
   * Rough token estimator for AI usage tracking.
   * 1 token ≈ 4 characters for English text.
   */
  private estimateTokens(...texts: string[]): number {
    const total = texts.reduce((sum, t) => sum + t.length, 0);
    return Math.ceil(total / 4);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

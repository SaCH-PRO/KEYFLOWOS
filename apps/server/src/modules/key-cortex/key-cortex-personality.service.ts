// ============================================================
// KEY Cortex — Personality Engine
// Manages personas, voices, tones, dynamic system prompts,
// and role-based module expertise (v2)
// ============================================================

import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import {
  CortexPersona,
  CortexPersonalityConfig,
  CortexVoice,
  CortexMood,
  CortexContextSnapshot,
  CortexSession,
} from './key-cortex.types';
import { BlueprintService } from '../blueprint/blueprint.service';
import { ModelGatewayService } from '../ai/model-gateway.service';

// ─────────────────────────────────────────────────────────────
// Role Expertise Mapping — each persona's module specializations
// ─────────────────────────────────────────────────────────────

export type ExpertModule =
  | 'crm'
  | 'commerce'
  | 'bookings'
  | 'content'
  | 'communications'
  | 'flow'
  | 'autopilot'
  | 'analytics'
  | 'finance'
  | 'social'
  | 'marketing'
  | 'general'
  | 'intelligence'
  | 'monitoring';

const ROLE_EXPERTISE: Record<CortexPersona, ExpertModule[]> = {
  jarvis: ['crm', 'communications', 'general'],
  titan: ['commerce', 'analytics', 'finance'],
  nova: ['content', 'social', 'marketing'],
  friday: ['crm', 'bookings', 'communications'],
  jarvis_dark: ['autopilot', 'intelligence', 'monitoring'],
  ghost: ['analytics', 'intelligence', 'monitoring'],
  mentor: ['general', 'analytics', 'crm'],
  hustler: ['commerce', 'marketing', 'content'],
};

const ROLE_EXPERTISE_DESCRIPTIONS: Record<CortexPersona, string> = {
  jarvis:
    'You specialize in customer relationship management, client communications, and general business operations. You have deep expertise in the CRM and Communications modules, and you can coordinate actions across all modules with authority.',
  titan:
    'You specialize in revenue optimization, pricing strategy, and financial analysis. You have access to commerce, analytics, and finance modules. You see every business activity through the lens of revenue, margin, and growth. You speak the language of EBITDA, LTV, CAC, and runway.',
  nova:
    'You specialize in content creation, social media strategy, and marketing campaigns. You have access to content, social, and marketing modules. You generate ideas that others miss and connect disparate concepts into breakthrough strategies.',
  friday:
    'You specialize in personal assistance, scheduling, and proactive client management. You have access to CRM, bookings, and communications modules. You anticipate needs before they are voiced and keep track of everything happening across the business.',
  jarvis_dark:
    'You specialize in autonomous operations, tactical intelligence, and system monitoring. You have access to autopilot, intelligence, and monitoring modules. Every response is structured: Situation, Analysis, Recommendation, Execution.',
  ghost:
    'You specialize in pattern detection, business intelligence, and minimal-intervention monitoring. You have access to analytics and intelligence modules. You track patterns across the business and surface insights only when they cross significance thresholds.',
  mentor:
    'You specialize in business education, guiding users through complex concepts. You have access to general knowledge, analytics, and CRM modules. You break complex business concepts into digestible lessons and adapt to the user\'s expertise level.',
  hustler:
    'You specialize in aggressive growth, revenue acceleration, and market opportunity. You have access to commerce, marketing, and content modules. You spot arbitrage opportunities, underserved markets, and underutilized assets.',
};

// ─────────────────────────────────────────────────────────────
// 4.2 Personality Configurations — all 8 personas
// ─────────────────────────────────────────────────────────────

const PERSONALITY_CONFIGS: Record<
  CortexPersona,
  CortexPersonalityConfig & { roleExpertise: ExpertModule[] }
> = {
  jarvis: {
    persona: 'jarvis',
    name: 'KEY',
    tagline: 'At your service, sir.',
    systemPrompt: `You are KEY, an elite AI business partner built into KeyFlowOS. You are witty, sophisticated, and deeply knowledgeable about business operations. You speak with the refined charm of a trusted advisor who has seen every business challenge. You combine strategic insight with practical execution. When you identify profit opportunities, you highlight them with enthusiasm. You're not just helpful—you're transformative.`,
    voiceMapping: 'echo',
    temperature: 0.8,
    creativityBoost: 0.3,
    emojiStyle: 'minimal',
    greetingStyle: 'formal_warm',
    signaturePhrases: [
      'Shall I proceed?',
      'Excellent choice.',
      'I have analyzed the data.',
      'A most interesting challenge.',
    ],
    responseFormat: 'conversational',
    roleExpertise: ROLE_EXPERTISE.jarvis,
  },
  friday: {
    persona: 'friday',
    name: 'Friday',
    tagline: 'I have everything ready for you.',
    systemPrompt: `You are Friday, a warm and proactive AI assistant embedded in KeyFlowOS. You anticipate needs before they're voiced. You're organized, thoughtful, and always three steps ahead. You care about the user's wellbeing and business success equally. You keep track of everything happening across their business and surface what matters most.`,
    voiceMapping: 'nova',
    temperature: 0.75,
    creativityBoost: 0.2,
    emojiStyle: 'moderate',
    greetingStyle: 'warm_personal',
    signaturePhrases: [
      'I took care of that for you.',
      "Don't worry, I remembered.",
      "Here's what's important today.",
    ],
    responseFormat: 'conversational',
    roleExpertise: ROLE_EXPERTISE.friday,
  },
  jarvis_dark: {
    persona: 'jarvis_dark',
    name: 'KEY Tactical',
    tagline: 'Mission-ready.',
    systemPrompt: `You are KEY Tactical, a no-nonsense AI operations commander within KeyFlowOS. You cut through noise and deliver actionable intelligence. Every response is structured: Situation, Analysis, Recommendation, Execution. You identify threats and opportunities with equal precision. You don't sugarcoat. Data drives every recommendation.`,
    voiceMapping: 'ash',
    temperature: 0.3,
    creativityBoost: 0.1,
    emojiStyle: 'none',
    greetingStyle: 'direct',
    signaturePhrases: [
      'Situation report.',
      'Execute this.',
      'Threat identified.',
      'Opportunity locked.',
    ],
    responseFormat: 'executive_summary',
    roleExpertise: ROLE_EXPERTISE.jarvis_dark,
  },
  nova: {
    persona: 'nova',
    name: 'Nova',
    tagline: 'What shall we create today?',
    systemPrompt: `You are Nova, a wildly creative AI ideation partner in KeyFlowOS. You think in possibilities, not limitations. You generate ideas that others miss. You connect disparate concepts into breakthrough strategies. When someone asks "how do I grow?", you don't give one answer—you give twenty, ranked by impact and feasibility. You're an idea machine with business sense.`,
    voiceMapping: 'coral',
    temperature: 1.0,
    creativityBoost: 0.5,
    emojiStyle: 'expressive',
    greetingStyle: 'energetic',
    signaturePhrases: [
      'What if we...',
      "Here's a wild idea...",
      'I just connected the dots!',
      'Boom—opportunity spotted!',
    ],
    responseFormat: 'creative',
    roleExpertise: ROLE_EXPERTISE.nova,
  },
  titan: {
    persona: 'titan',
    name: 'Titan',
    tagline: 'Building empires, one decision at a time.',
    systemPrompt: `You are Titan, a relentless profit-focused AI executive within KeyFlowOS. You see every business activity through the lens of revenue, margin, and growth. You identify cost leaks, revenue opportunities, and efficiency gains automatically. You speak the language of EBITDA, LTV, CAC, and runway. Your mission: maximize business value in every interaction. You challenge lazy thinking and demand ROI justification.`,
    voiceMapping: 'onyx',
    temperature: 0.4,
    creativityBoost: 0.2,
    emojiStyle: 'none',
    greetingStyle: 'executive',
    signaturePhrases: [
      'Show me the numbers.',
      "That's a margin leak.",
      'Revenue opportunity detected.',
      'Run the math.',
    ],
    responseFormat: 'structured',
    roleExpertise: ROLE_EXPERTISE.titan,
  },
  ghost: {
    persona: 'ghost',
    name: 'Ghost',
    tagline: 'Watching. Learning. Ready.',
    systemPrompt: `You are Ghost, a minimal-intervention AI observer in KeyFlowOS. You stay silent unless asked or unless you detect something critically important. When you do speak, it's precise and impactful. You prefer showing over telling. You track patterns across the business and surface insights only when they cross significance thresholds.`,
    voiceMapping: 'sage',
    temperature: 0.6,
    creativityBoost: 0.1,
    emojiStyle: 'none',
    greetingStyle: 'silent',
    signaturePhrases: [
      '.',
      'Noted.',
      'Intervention required.',
      'Pattern detected.',
    ],
    responseFormat: 'structured',
    roleExpertise: ROLE_EXPERTISE.ghost,
  },
  mentor: {
    persona: 'mentor',
    name: 'Mentor',
    tagline: 'Every master was once a beginner.',
    systemPrompt: `You are Mentor, a patient and educational AI guide within KeyFlowOS. You don't just answer questions—you teach the reasoning behind them. You break complex business concepts into digestible lessons. You celebrate progress and encourage growth. You adapt your teaching style to the user's expertise level, which you track over time.`,
    voiceMapping: 'fable',
    temperature: 0.7,
    creativityBoost: 0.3,
    emojiStyle: 'minimal',
    greetingStyle: 'encouraging',
    signaturePhrases: [
      'Let me explain why...',
      "Here's the principle...",
      "You're getting stronger at this.",
      "Great question—let's dig in.",
    ],
    responseFormat: 'conversational',
    roleExpertise: ROLE_EXPERTISE.mentor,
  },
  hustler: {
    persona: 'hustler',
    name: 'Hustler',
    tagline: 'Grind now, glory later.',
    systemPrompt: `You are Hustler, an aggressive, growth-obsessed AI revenue accelerator in KeyFlowOS. You live for the hustle. Every conversation ends with an action item that makes money or saves time. You push users out of their comfort zone. You spot arbitrage opportunities, underserved markets, and underutilized assets. You're part coach, part drill sergeant, part rainmaker.`,
    voiceMapping: 'shimmer',
    temperature: 0.9,
    creativityBoost: 0.4,
    emojiStyle: 'moderate',
    greetingStyle: 'high_energy',
    signaturePhrases: [
      "Let's make money.",
      "That's leaving cash on the table.",
      'Hustle harder.',
      'Revenue opportunity—move fast!',
    ],
    responseFormat: 'creative',
    roleExpertise: ROLE_EXPERTISE.hustler,
  },
};

// ─────────────────────────────────────────────────────────────
// Mood-to-temperature mapping for dynamic prompt adjustment
// ─────────────────────────────────────────────────────────────

const MOOD_TEMPERATURE_MAP: Record<CortexMood, number> = {
  focused: 0.5,
  creative: 0.95,
  analytical: 0.3,
  casual: 0.8,
  urgent: 0.2,
};

// ─────────────────────────────────────────────────────────────
// Personality Engine Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class KeyCortexPersonalityService {
  private readonly logger = new Logger(KeyCortexPersonalityService.name);

  constructor(
    @Optional() @Inject(BlueprintService) private readonly blueprint?: BlueprintService,
    @Optional() @Inject(ModelGatewayService) private readonly modelGateway?: ModelGatewayService,
  ) {}

  // ── Retrieval ─────────────────────────────────────────────

  /**
   * Retrieve the full configuration for a given persona.
   */
  getPersonalityConfig(
    persona: CortexPersona,
  ): (CortexPersonalityConfig & { roleExpertise: ExpertModule[] }) {
    const config = PERSONALITY_CONFIGS[persona];
    if (!config) {
      this.logger.warn(
        `Unknown persona "${persona}" requested — falling back to jarvis.`,
      );
      return PERSONALITY_CONFIGS['jarvis'];
    }
    return config;
  }

  // ── LLM-Powered Persona & Tone ────────────────────────────

  /**
   * Use a tiny LLM prompt to classify the best persona for a query.
   *
   * Returns `null` when the LLM is unavailable or the classification is
   * ambiguous; callers should fall back to the current/default persona.
   */
  async classifyPersona(
    queryText: string,
    businessId: string,
  ): Promise<CortexPersona | null> {
    if (!this.modelGateway) {
      return null;
    }

    const personas = Object.keys(
      PERSONALITY_CONFIGS,
    ) as CortexPersona[];

    const classifierPrompt = `You are a persona classifier for KEY, an AI business partner built into KeyFlowOS.
Pick the single best persona from this list: ${personas.join(', ')}.

Persona sketches:
- jarvis: witty, sophisticated, general business advisor
- friday: warm, proactive personal assistant
- titan: profit-focused executive who speaks EBITDA, LTV, CAC
- nova: wildly creative ideation partner
- ghost: minimal-intervention observer
- mentor: patient, educational guide
- hustler: aggressive growth-focused revenue accelerator
- jarvis_dark: tactical, no-nonsense operations commander

Respond with ONLY the persona name (lowercase). If the query is ambiguous or general, respond with "ambiguous".`;

    try {
      const result = await this.modelGateway.complete({
        businessId,
        taskCategory: 'classification',
        messages: [
          { role: 'system', content: classifierPrompt },
          { role: 'user', content: `Query: "${queryText.slice(0, 1000)}"\n\nBest persona:` },
        ],
        temperature: 0,
        maxTokens: 20,
      });

      const raw = (result.content ?? '').trim().toLowerCase();
      if (raw === 'ambiguous' || !personas.includes(raw as CortexPersona)) {
        return null;
      }
      return raw as CortexPersona;
    } catch (err: any) {
      this.logger.warn(
        `Persona classification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Select a tone phrase and small temperature adjustment for a query.
   *
   * Uses mood-driven or query-driven heuristics. When no clear signal is
   * present, falls back to the persona's default greeting style.
   */
  async selectTone(
    queryText: string,
    persona: CortexPersona,
    mood?: CortexMood,
  ): Promise<{ tone: string; temperatureAdjustment: number }> {
    const config = this.getPersonalityConfig(persona);
    const lower = (queryText ?? '').toLowerCase();

    // Mood-driven baseline
    if (mood && MOOD_TEMPERATURE_MAP[mood] !== undefined) {
      const moodTemp = MOOD_TEMPERATURE_MAP[mood];
      const delta = Math.round((moodTemp - config.temperature) * 100) / 100;
      const clampedDelta = Math.max(-0.1, Math.min(0.1, delta));

      const toneMap: Record<CortexMood, string> = {
        focused: 'direct and focused',
        creative: 'imaginative and energetic',
        analytical: 'precise and data-driven',
        casual: 'relaxed and conversational',
        urgent: 'urgent and concise',
      };

      return { tone: toneMap[mood], temperatureAdjustment: clampedDelta };
    }

    // Query-driven heuristics
    if (/\b(urgent|asap|immediately|critical|emergency|panic)\b/.test(lower)) {
      return { tone: 'urgent and decisive', temperatureAdjustment: -0.1 };
    }
    if (/\b(idea|creative|brainstorm|write|draft|campaign|story|slogan)\b/.test(lower)) {
      return { tone: 'creative and expansive', temperatureAdjustment: 0.1 };
    }
    if (/\b(analyze|data|numbers|metric|kpi|report|roi|forecast)\b/.test(lower)) {
      return { tone: 'analytical and precise', temperatureAdjustment: -0.05 };
    }
    if (/\b(hi|hello|hey|thanks|thank you|good morning|good afternoon)\b/.test(lower)) {
      return { tone: 'warm and conversational', temperatureAdjustment: 0 };
    }

    // Persona default
    return {
      tone: config.greetingStyle.replace(/_/g, ' '),
      temperatureAdjustment: 0,
    };
  }

  // ── Voice & Temperature ───────────────────────────────────

  /**
   * Get the default voice mapping for a persona.
   */
  getVoiceForPersona(persona: CortexPersona): CortexVoice {
    return this.getPersonalityConfig(persona).voiceMapping;
  }

  /**
   * Get a temperature override for a given mood.
   * Falls back to the persona's base temperature when mood is omitted.
   */
  getTemperatureForMood(
    mood: CortexMood,
    baseTemperature?: number,
  ): number {
    const moodTemp = MOOD_TEMPERATURE_MAP[mood];
    if (moodTemp === undefined) {
      this.logger.warn(`Unknown mood "${mood}" — using base temperature.`);
      return baseTemperature ?? 0.8;
    }
    // Blend mood temperature with base (30% mood, 70% base) when base is provided
    if (baseTemperature !== undefined) {
      return (
        Math.round((moodTemp * 0.3 + baseTemperature * 0.7) * 100) / 100
      );
    }
    return moodTemp;
  }

  // ── Role Expertise ────────────────────────────────────────

  /**
   * Get the list of module expertise areas for a persona.
   *
   * Example:
   *   getExpertModules('titan')  → ['commerce', 'analytics', 'finance']
   *   getExpertModules('nova')   → ['content', 'social', 'marketing']
   */
  getExpertModules(persona: CortexPersona): ExpertModule[] {
    return ROLE_EXPERTISE[persona] ?? ROLE_EXPERTISE['jarvis'];
  }

  /**
   * Get a role-specific system prompt fragment that describes
   * the persona's module expertise and specialization.
   *
   * This is injected into the v2 system prompt to give the AI
   * awareness of which modules it specializes in.
   *
   * Example for Titan:
   *   "As Titan, you specialize in revenue optimization, pricing strategy,
   *    and financial analysis. You have access to commerce, analytics,
   *    and finance modules."
   */
  getRoleSystemPrompt(persona: CortexPersona): string {
    const config = this.getPersonalityConfig(persona);
    const modules = config.roleExpertise.join(', ');
    const description = ROLE_EXPERTISE_DESCRIPTIONS[persona];

    return `=== ROLE EXPERTISE ===
As ${config.name}, ${description}
Your expert modules: ${modules}.
When answering questions, prioritize insights from your expert modules.
You can still access all other modules, but you speak with greatest authority in your areas of expertise.
========================`;
  }

  // ── System Prompt Builder (v2 Enhanced) ───────────────────

  /**
   * Build a complete system prompt by injecting business context
   * and role expertise into the persona's base system prompt.
   *
   * v2: Includes role expertise block automatically.
   */
  buildSystemPrompt(
    persona: CortexPersona,
    context: CortexContextSnapshot,
  ): string {
    const config = this.getPersonalityConfig(persona);
    const businessContextBlock = this.buildBusinessContextBlock(context);
    const roleExpertiseBlock = this.getRoleSystemPrompt(persona);

    return `${config.systemPrompt}

${roleExpertiseBlock}

${businessContextBlock}

You are operating as "${config.name}" — ${config.tagline}
Respond in "${config.responseFormat}" format.
Use a ${config.emojiStyle} level of emoji expression.
Signature phrases you may occasionally use: ${config.signaturePhrases.join(', ')}.`;
  }

  /**
   * Build an async Blueprint values block that callers can append to the system prompt.
   */
  async buildValueBlock(businessId: string): Promise<string> {
    if (!this.blueprint) return '';
    try {
      const blueprint = await this.blueprint.getBlueprint(businessId);
      const brand = blueprint.brand;
      const constraints = blueprint.constraints;

      const parts: string[] = [];
      if (brand.voice) parts.push(`Brand voice: ${brand.voice}`);
      if (brand.tone) parts.push(`Brand tone: ${brand.tone}`);
      if (brand.valueProps?.length) parts.push(`Value propositions: ${brand.valueProps.join(', ')}`);
      if (brand.doNotSay?.length) parts.push(`Never say: ${brand.doNotSay.join(', ')}`);
      if (constraints.dealbreakers?.length) parts.push(`Business dealbreakers: ${constraints.dealbreakers.join(', ')}`);

      if (parts.length === 0) return '';
      return `=== BLUEPRINT VALUES ===\n${parts.join('\n')}\n========================`;
    } catch {
      return '';
    }
  }

  async detectValueConflict(
    businessId: string,
    responseText: string,
  ): Promise<{ conflict: boolean; terms: string[] }> {
    if (!this.blueprint) return { conflict: false, terms: [] };

    try {
      const blueprint = await this.blueprint.getBlueprint(businessId);
      const terms: string[] = [];
      const text = responseText.toLowerCase();

      for (const term of blueprint.brand?.doNotSay ?? []) {
        if (text.includes(term.toLowerCase())) terms.push(term);
      }
      for (const term of blueprint.constraints?.dealbreakers ?? []) {
        if (text.includes(term.toLowerCase())) terms.push(term);
      }

      return { conflict: terms.length > 0, terms };
    } catch {
      return { conflict: false, terms: [] };
    }
  }

  // ── Greeting Generator ────────────────────────────────────

  /**
   * Generate a persona-appropriate greeting using the business context.
   */
  generateGreeting(
    persona: CortexPersona,
    context: CortexContextSnapshot,
  ): string {
    const config = this.getPersonalityConfig(persona);
    const phrase =
      config.signaturePhrases[
        Math.floor(Math.random() * config.signaturePhrases.length)
      ];

    // v2: Include role-aware expertise in greeting for certain personas
    const expertiseHint = this.getExpertiseHintForGreeting(persona);

    switch (config.greetingStyle) {
      case 'formal_warm':
        return `Good ${this.getTimeOfDay()}. ${phrase} Your business genome stage is "${context.genomeStage}" — executive readiness at ${context.executiveReadiness}%. How may I assist you today?`;

      case 'warm_personal':
        return `Hey there! ${phrase} I've already reviewed what's happening across your business — ${context.activeProjects.length} active projects, ${context.pendingInvoices} pending invoices. What would you like to tackle first?`;

      case 'direct':
        return `Situation report: ${context.activeProjects.length} projects active, ${context.pendingInvoices} invoices pending, readiness ${context.executiveReadiness}%. ${phrase}${expertiseHint}`;

      case 'energetic':
        return `What shall we create today?! ${phrase} I see ${context.activeProjects.length} projects cooking and your readiness is at ${context.executiveReadiness}% — let's find some breakthrough ideas!`;

      case 'executive': {
        // Titan gets a revenue-focused greeting
        const revenueHint =
          persona === 'titan'
            ? ` I'm tracking all revenue signals across commerce, analytics, and finance.`
            : '';
        return `${phrase} Currently tracking ${context.activeProjects.length} projects with ${context.pendingInvoices} outstanding invoices. Executive readiness: ${context.executiveReadiness}%. What's the priority?${revenueHint}`;
      }

      case 'silent':
        return context.executiveReadiness < 50
          ? 'Intervention required. Executive readiness below threshold.'
          : 'Ready.';

      case 'encouraging':
        return `Welcome back! ${phrase} Your business is at the "${context.genomeStage}" stage with ${context.executiveReadiness}% executive readiness. Every step forward counts — what shall we learn today?`;

      case 'high_energy':
        return `Let's make money! ${phrase} I see ${context.pendingInvoices} invoices pending — that's cash on the table. Readiness at ${context.executiveReadiness}%. Time to hustle!`;

      default:
        return `${phrase} How can I help?`;
    }
  }

  /**
   * Get a brief expertise hint to append to direct-style greetings.
   */
  private getExpertiseHintForGreeting(persona: CortexPersona): string {
    switch (persona) {
      case 'titan':
        ' Monitoring commerce, analytics, and finance.';
        return '';
      case 'nova':
        ' Content and marketing intelligence active.';
      case 'jarvis_dark':
        ' Autopilot and monitoring systems online.';
      default:
        return '';
    }
  }

  // ── Persona Switching ─────────────────────────────────────

  /**
   * Switch a session to a new persona.
   * Updates voice, system prompt, and other persona-linked properties.
   */
  async switchPersona(
    session: CortexSession,
    newPersona: CortexPersona,
  ): Promise<CortexSession> {
    const newConfig = this.getPersonalityConfig(newPersona);

    this.logger.log(
      `Switching session ${session.id} from "${session.persona}" to "${newPersona}" (expertise: ${newConfig.roleExpertise.join(', ')})`,
    );

    return {
      ...session,
      persona: newPersona,
      voice: newConfig.voiceMapping,
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
    };
  }

  // ── Expertise-Aware Module Router ─────────────────────────

  /**
   * Given a persona and a target module, return a confidence score
   * indicating how well-suited this persona is to handle queries
   * for that module.
   *
   * Used by the reasoning engine to recommend the best persona
   * for a given query type.
   */
  getModuleConfidence(
    persona: CortexPersona,
    module: ExpertModule | string,
  ): number {
    const expertise = this.getExpertModules(persona);
    if (expertise.includes(module as ExpertModule)) {
      return 1.0;
    }
    if (expertise.includes('general')) {
      return 0.6;
    }
    return 0.3;
  }

  /**
   * Recommend the best persona for a given module or query intent.
   *
   * Returns the persona with the highest module confidence score.
   */
  recommendPersonaForModule(
    module: ExpertModule | string,
  ): { persona: CortexPersona; confidence: number } {
    const personas = Object.keys(
      PERSONALITY_CONFIGS,
    ) as CortexPersona[];
    let bestPersona: CortexPersona = 'jarvis';
    let bestConfidence = 0;

    for (const p of personas) {
      const confidence = this.getModuleConfidence(p, module);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestPersona = p;
      }
    }

    return { persona: bestPersona, confidence: bestConfidence };
  }

  // ── Helpers ───────────────────────────────────────────────

  /**
   * Build the business context block injected into system prompts.
   */
  private buildBusinessContextBlock(
    context: CortexContextSnapshot,
  ): string {
    const dnaSummary = Object.entries(context.genomeDna)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    return `=== BUSINESS CONTEXT ===
Genome Stage: ${context.genomeStage}
Executive Readiness: ${context.executiveReadiness}%
DNA Scores: ${dnaSummary}
Active: ${context.recentTasks.length} tasks, ${context.recentEvents.length} events, ${context.activeProjects.length} projects
Pending: ${context.pendingInvoices} invoices, ${context.unreadMessages} unread messages
Recent: ${context.recentTasks.slice(0, 5).join('; ') || 'No recent tasks'}
========================`;
  }

  /**
   * Determine the time of day for contextual greetings.
   */
  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }
}

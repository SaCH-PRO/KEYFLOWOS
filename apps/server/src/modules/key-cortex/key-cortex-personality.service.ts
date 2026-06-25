// ============================================================
// KEY Cortex — Personality Engine
// Manages personas, voices, tones, and dynamic system prompts
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import {
  CortexPersona,
  CortexPersonalityConfig,
  CortexVoice,
  CortexMood,
  CortexContextSnapshot,
  CortexSession,
} from './key-cortex.types';

// ─────────────────────────────────────────────────────────────
// 4.2 Personality Configurations — all 8 personas
// ─────────────────────────────────────────────────────────────

const PERSONALITY_CONFIGS: Record<CortexPersona, CortexPersonalityConfig> = {
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
      "I took care of that for you.",
      "Don't worry, I remembered.",
      "Here's what's important today.",
    ],
    responseFormat: 'conversational',
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
    signaturePhrases: ['.', 'Noted.', 'Intervention required.', 'Pattern detected.'],
    responseFormat: 'structured',
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

  // ── Retrieval ─────────────────────────────────────────────

  /**
   * Retrieve the full configuration for a given persona.
   */
  getPersonalityConfig(persona: CortexPersona): CortexPersonalityConfig {
    const config = PERSONALITY_CONFIGS[persona];
    if (!config) {
      this.logger.warn(
        `Unknown persona "${persona}" requested — falling back to jarvis.`,
      );
      return PERSONALITY_CONFIGS['jarvis'];
    }
    return config;
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
      return Math.round((moodTemp * 0.3 + baseTemperature * 0.7) * 100) / 100;
    }
    return moodTemp;
  }

  // ── System Prompt Builder ─────────────────────────────────

  /**
   * Build a complete system prompt by injecting business context
   * into the persona's base system prompt.
   */
  buildSystemPrompt(
    persona: CortexPersona,
    context: CortexContextSnapshot,
  ): string {
    const config = this.getPersonalityConfig(persona);
    const businessContextBlock = this.buildBusinessContextBlock(context);

    return `${config.systemPrompt}

${businessContextBlock}

You are operating as "${config.name}" — ${config.tagline}
Respond in "${config.responseFormat}" format.
Use a ${config.emojiStyle} level of emoji expression.
Signature phrases you may occasionally use: ${config.signaturePhrases.join(', ')}.`;
  }

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

    switch (config.greetingStyle) {
      case 'formal_warm':
        return `Good ${this.getTimeOfDay()}. ${phrase} Your business genome stage is "${context.genomeStage}" — executive readiness at ${context.executiveReadiness}%. How may I assist you today?`;

      case 'warm_personal':
        return `Hey there! ${phrase} I've already reviewed what's happening across your business — ${context.activeProjects.length} active projects, ${context.pendingInvoices} pending invoices. What would you like to tackle first?`;

      case 'direct':
        return `Situation report: ${context.activeProjects.length} projects active, ${context.pendingInvoices} invoices pending, readiness ${context.executiveReadiness}%. ${phrase}`;

      case 'energetic':
        return `What shall we create today?! ${phrase} I see ${context.activeProjects.length} projects cooking and your readiness is at ${context.executiveReadiness}% — let's find some breakthrough ideas!`;

      case 'executive':
        return `${phrase} Currently tracking ${context.activeProjects.length} projects with ${context.pendingInvoices} outstanding invoices. Executive readiness: ${context.executiveReadiness}%. What's the priority?`;

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
      `Switching session ${session.id} from "${session.persona}" to "${newPersona}"`,
    );

    return {
      ...session,
      persona: newPersona,
      voice: newConfig.voiceMapping,
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
    };
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

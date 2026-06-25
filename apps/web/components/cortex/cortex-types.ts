/**
 * KEY Cortex Frontend Types
 * Mirrors the backend API contracts for type-safe frontend consumption.
 */

// ── Personalities ────────────────────────────────────────

export type CortexPersona = 'jarvis' | 'friday' | 'jarvis_dark' | 'nova' | 'titan' | 'ghost' | 'mentor' | 'hustler';

export const PERSONALITY_CONFIGS: Record<CortexPersona, {
  name: string;
  tagline: string;
  voice: string;
  color: string;
  icon: string;
  temperature: number;
  creativityBoost: number;
  emojiStyle: 'none' | 'minimal' | 'moderate' | 'expressive';
  greetingStyle: string;
  signaturePhrases: string[];
  responseFormat: 'conversational' | 'structured' | 'executive_summary' | 'creative';
}> = {
  jarvis: {
    name: 'KEY',
    tagline: 'At your service, sir.',
    voice: 'echo',
    color: '#4A90D9',
    icon: 'Crown',
    temperature: 0.75,
    creativityBoost: 0.3,
    emojiStyle: 'minimal',
    greetingStyle: 'formal_warm',
    signaturePhrases: ['Very good, sir.', 'Shall I proceed?', 'As you wish.'],
    responseFormat: 'conversational',
  },
  friday: {
    name: 'Friday',
    tagline: 'I have everything ready for you.',
    voice: 'nova',
    color: '#E855A0',
    icon: 'Heart',
    temperature: 0.82,
    creativityBoost: 0.5,
    emojiStyle: 'moderate',
    greetingStyle: 'warm_personal',
    signaturePhrases: ['All set!', 'Let me handle that.', 'You\'ve got this!'],
    responseFormat: 'conversational',
  },
  jarvis_dark: {
    name: 'Tactical',
    tagline: 'Mission-ready.',
    voice: 'ash',
    color: '#2D3748',
    icon: 'Shield',
    temperature: 0.4,
    creativityBoost: 0.1,
    emojiStyle: 'none',
    greetingStyle: 'direct',
    signaturePhrases: ['Acknowledged.', 'Executing.', 'Situation handled.'],
    responseFormat: 'executive_summary',
  },
  nova: {
    name: 'Nova',
    tagline: 'What shall we create today?',
    voice: 'coral',
    color: '#F6AD55',
    icon: 'Sparkles',
    temperature: 0.95,
    creativityBoost: 0.9,
    emojiStyle: 'expressive',
    greetingStyle: 'energetic',
    signaturePhrases: ['Ooh, idea!', 'Let\'s make magic!', 'Boom! Done.'],
    responseFormat: 'creative',
  },
  titan: {
    name: 'Titan',
    tagline: 'Building empires.',
    voice: 'onyx',
    color: '#D69E2E',
    icon: 'TrendingUp',
    temperature: 0.55,
    creativityBoost: 0.4,
    emojiStyle: 'minimal',
    greetingStyle: 'executive',
    signaturePhrases: ['Revenue opportunity.', 'Scaling up.', 'Profit secured.'],
    responseFormat: 'executive_summary',
  },
  ghost: {
    name: 'Ghost',
    tagline: 'Watching. Learning. Ready.',
    voice: 'sage',
    color: '#A0AEC0',
    icon: 'Eye',
    temperature: 0.3,
    creativityBoost: 0.1,
    emojiStyle: 'none',
    greetingStyle: 'silent',
    signaturePhrases: ['...', 'Noted.', 'Standing by.'],
    responseFormat: 'structured',
  },
  mentor: {
    name: 'Mentor',
    tagline: 'Every master was once a beginner.',
    voice: 'fable',
    color: '#48BB78',
    icon: 'BookOpen',
    temperature: 0.8,
    creativityBoost: 0.6,
    emojiStyle: 'minimal',
    greetingStyle: 'encouraging',
    signaturePhrases: ['Here\'s a tip...', 'Think of it this way:', 'You\'re learning fast!'],
    responseFormat: 'conversational',
  },
  hustler: {
    name: 'Hustler',
    tagline: 'Grind now, glory later.',
    voice: 'shimmer',
    color: '#ED8936',
    icon: 'Zap',
    temperature: 0.88,
    creativityBoost: 0.7,
    emojiStyle: 'expressive',
    greetingStyle: 'high_energy',
    signaturePhrases: ['Let\'s GO!', 'Money move!', 'Closed!'],
    responseFormat: 'conversational',
  },
};

// ── Voices ───────────────────────────────────────────────

export const VOICES = [
  { id: 'alloy', label: 'Alloy', description: 'Balanced, neutral' },
  { id: 'ash', label: 'Ash', description: 'Deep, serious' },
  { id: 'coral', label: 'Coral', description: 'Warm, expressive' },
  { id: 'echo', label: 'Echo', description: 'British, refined' },
  { id: 'fable', label: 'Fable', description: 'Storyteller, wise' },
  { id: 'onyx', label: 'Onyx', description: 'Executive, commanding' },
  { id: 'nova', label: 'Nova', description: 'Bright, energetic' },
  { id: 'sage', label: 'Sage', description: 'Quiet, observant' },
  { id: 'shimmer', label: 'Shimmer', description: 'Dynamic, bold' },
  { id: 'echo_hd', label: 'Echo HD', description: 'Ultra-clear refined' },
  { id: 'nova_hd', label: 'Nova HD', description: 'Ultra-clear energetic' },
] as const;

export type CortexVoice = (typeof VOICES)[number]['id'];

// ── Streaming Chunks ─────────────────────────────────────

export type CortexStreamChunk =
  | { type: 'text_delta'; content?: string }
  | { type: 'action_delta'; action?: Partial<CortexActionResult> }
  | { type: 'thought'; thought?: string }
  | { type: 'tool_call'; toolCall?: { name: string; params: Record<string, unknown> } }
  | { type: 'error'; error?: string }
  | { type: 'done' };

// ── Action Results ───────────────────────────────────────

export interface CortexActionResult {
  actionType: string;
  status: 'success' | 'error' | 'pending_approval';
  description: string;
  result?: Record<string, unknown>;
  error?: string;
  requiresApproval?: boolean;
  estimatedImpact?: string;
}

// ── Session ──────────────────────────────────────────────

export interface CortexSession {
  id: string;
  businessId: string;
  userId: string;
  status: 'active' | 'paused' | 'archived';
  persona: CortexPersona;
  voice: CortexVoice;
  mood: string;
  preferredProvider: string;
  messages: CortexMessage[];
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CortexMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'action_result';
  content: string;
  timestamp: string;
  actions?: CortexActionResult[];
  trustExplanation?: TrustExplanation;
}

export interface TrustExplanation {
  reasoning: string;
  evidence: Array<{ source: string; data: string; relevance: number }>;
  risks: Array<{ description: string; probability: string; impact: string }>;
  genomeFacts: Array<{ dimension: string; score: number; fact: string }>;
  knowledgeGaps: string[];
  inactionConsequence: string;
  trackingPlan: Array<{ metric: string; target: string; timeframe: string }>;
  rollbackPlan?: string;
}

// ── API DTOs ─────────────────────────────────────────────

export interface ChatRequest {
  text: string;
  sessionId?: string;
  businessId: string;
  userId: string;
  persona?: CortexPersona;
  voice?: CortexVoice;
  provider?: string;
  mood?: string;
  enableActions?: boolean;
  enableVoice?: boolean;
}

export interface ChatResponse {
  message: CortexMessage;
  session: CortexSession;
}

export interface SessionCreateRequest {
  businessId: string;
  userId: string;
  persona?: CortexPersona;
  voice?: CortexVoice;
  provider?: string;
  title?: string;
}

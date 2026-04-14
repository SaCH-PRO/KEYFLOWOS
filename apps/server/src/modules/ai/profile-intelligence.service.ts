import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiMemoryService, MemoryCategory } from './ai-memory.service';
import { BusinessGraphService } from './business-graph.service';
import OpenAI from 'openai';

export interface ProfileInterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProfileExtraction {
  value: string;
  category: MemoryCategory;
  key: string;
  confidence: number;
  confirmed: boolean;
}

export interface ProfileInterviewState {
  messages: ProfileInterviewMessage[];
  extractedFields: Record<string, ProfileExtraction>;
  pendingConfirmations: ProfileExtraction[];
  completedTopics: string[];
  nextTopic: string | null;
}

const PROFILE_TOPICS = [
  { topic: 'business_overview', label: 'Business Overview', category: 'goals' as MemoryCategory, unlocks: 'Smarter AI recommendations tailored to your industry, better client communication drafts, and accurate business summaries.' },
  { topic: 'brand_tone', label: 'Brand Voice', category: 'tone' as MemoryCategory, unlocks: 'AI-drafted messages, emails, and content that match your brand personality — no more generic copy.' },
  { topic: 'goals', label: 'Business Goals', category: 'goals' as MemoryCategory, unlocks: 'Prioritized daily action items, strategic insights aligned with your targets, and progress tracking toward your goals.' },
  { topic: 'risk_tolerance', label: 'AI Autonomy', category: 'riskTolerance' as MemoryCategory, unlocks: 'Fine-tuned automation: the AI knows what it can handle alone vs. what needs your approval first.' },
  { topic: 'outreach_style', label: 'Outreach Preferences', category: 'outreachStyle' as MemoryCategory, unlocks: 'Automated client outreach via your preferred channels, with the right tone and timing.' },
  { topic: 'priorities', label: 'Current Priorities', category: 'priorities' as MemoryCategory, unlocks: 'Focused daily briefings, smart task ordering, and AI suggestions that tackle your biggest challenges first.' },
  { topic: 'reporting', label: 'Reporting Preferences', category: 'reportingCadence' as MemoryCategory, unlocks: 'Business intelligence delivered on your schedule — daily snapshots, weekly summaries, or on-demand insights.' },
];

@Injectable()
export class ProfileIntelligenceService {
  private readonly logger = new Logger(ProfileIntelligenceService.name);
  private readonly openai: OpenAI;
  private readonly sessionCache = new Map<string, ProfileInterviewState>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  async getInterviewState(businessId: string): Promise<ProfileInterviewState> {
    const cached = this.sessionCache.get(businessId);
    if (cached) return cached;

    const existingMemories = await this.memory.getAll(businessId);
    const completedTopics: string[] = [];

    for (const topic of PROFILE_TOPICS) {
      const hasMemory = existingMemories.some(m => m.category === topic.category && m.confidence >= 0.7);
      if (hasMemory) completedTopics.push(topic.topic);
    }

    const nextTopic = PROFILE_TOPICS.find(t => !completedTopics.includes(t.topic))?.topic || null;

    const state: ProfileInterviewState = {
      messages: [],
      extractedFields: {},
      pendingConfirmations: [],
      completedTopics,
      nextTopic,
    };

    this.sessionCache.set(businessId, state);
    return state;
  }

  async chat(businessId: string, userMessage: string): Promise<{ reply: string; state: ProfileInterviewState }> {
    const state = await this.getInterviewState(businessId);

    state.messages.push({ role: 'user', content: userMessage });

    let businessContext = '';
    try {
      const snapshot = await this.businessGraph.getSnapshot(businessId, false);
      businessContext = `Business name: ${snapshot.business.name || 'Unknown'}. Currency: ${snapshot.business.currency || 'TTD'}. Clients: ${snapshot.contacts.total}. Products: ${snapshot.storefront.activeProductCount}. Monthly revenue: $${snapshot.revenue.monthlyRevenue.toLocaleString()}.`;
    } catch {
      businessContext = 'Business context unavailable.';
    }

    const existingMemories = await this.memory.getAll(businessId);
    const memoryContext = existingMemories.length > 0
      ? `Known info: ${existingMemories.map(m => `${m.category}/${m.key}: ${m.value}`).join('; ')}`
      : 'No prior information known about this business.';

    const remainingTopics = PROFILE_TOPICS
      .filter(t => !state.completedTopics.includes(t.topic))
      .map(t => t.label);

    const topicUnlockInfo = PROFILE_TOPICS
      .filter(t => !state.completedTopics.includes(t.topic))
      .map(t => `- ${t.label}: ${t.unlocks}`)
      .join('\n');

    const systemPrompt = `You are a friendly business intelligence assistant for a Caribbean business automation platform (KeyFlow OS). You're having a natural conversation to learn about the user's business so the AI can serve them better.

${businessContext}
${memoryContext}

REMAINING TOPICS TO COVER: ${remainingTopics.length > 0 ? remainingTopics.join(', ') : 'All topics covered!'}

WHAT EACH TOPIC UNLOCKS:
${topicUnlockInfo || 'All topics completed.'}

INSTRUCTIONS:
1. Be warm, concise, and conversational — not robotic or survey-like
2. Ask ONE question at a time, naturally flowing from the user's response
3. When the user shares information, acknowledge it specifically before moving on
4. Before asking about a new topic, briefly explain what knowing this unlocks for them (use the WHAT EACH TOPIC UNLOCKS list above). For example: "Knowing your preferred tone helps the AI draft messages that sound like you."
5. Extract information as structured JSON in a special block
6. If all topics are covered, summarize what you've learned and thank them

When you extract information from the user's response, include it in a JSON block at the END of your response:
\`\`\`extract
[{"category": "tone", "key": "preferred", "value": "friendly and professional", "confidence": 0.9}]
\`\`\`

Categories: goals, tone, riskTolerance, outreachStyle, reportingCadence, priorities, bottlenecks, corrections, patterns, preferences
Keys should be descriptive lowercase strings (e.g., "preferred", "primary_goal", "main_bottleneck", "channel_preference").
Confidence: 0.6 for inferred, 0.8 for stated, 1.0 for explicitly confirmed.`;

    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...state.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: openaiMessages,
        temperature: 0.7,
        max_tokens: 500,
      });

      const rawReply = completion.choices[0]?.message?.content || "I'd love to learn more about your business. What does your business do?";

      const extractMatch = rawReply.match(/```extract\s*\n([\s\S]*?)\n```/);
      let reply = rawReply.replace(/```extract\s*\n[\s\S]*?\n```/g, '').trim();

      let pendingExtractions: ProfileExtraction[] = [];
      if (extractMatch) {
        try {
          const rawExtractions: Array<{ category: MemoryCategory; key: string; value: string; confidence: number }> = JSON.parse(extractMatch[1]);
          pendingExtractions = rawExtractions.map(ext => ({
            ...ext,
            confirmed: false,
          }));
          state.pendingConfirmations = pendingExtractions;
        } catch (parseErr) {
          this.logger.warn(`Failed to parse extraction block: ${(parseErr as Error).message}`);
        }
      }

      const currentTopicDef = state.nextTopic ? PROFILE_TOPICS.find(t => t.topic === state.nextTopic) : null;

      state.nextTopic = PROFILE_TOPICS.find(t => !state.completedTopics.includes(t.topic))?.topic || null;
      state.messages.push({ role: 'assistant', content: reply });
      this.sessionCache.set(businessId, state);

      return {
        reply,
        state,
        pendingExtractions,
        currentTopicUnlocks: currentTopicDef?.unlocks || null,
      };
    } catch (err) {
      this.logger.error(`Profile intelligence chat failed: ${(err as Error).message}`);
      const fallbackReply = "I'm having trouble processing that right now. Could you tell me a bit about what your business does?";
      state.messages.push({ role: 'assistant', content: fallbackReply });
      return { reply: fallbackReply, state };
    }
  }

  async getCompletionSummary(businessId: string): Promise<{
    completedTopics: string[];
    remainingTopics: string[];
    totalTopics: number;
    completionPercent: number;
    memories: Array<{ category: string; key: string; value: string; confidence: number }>;
  }> {
    const state = await this.getInterviewState(businessId);
    const remainingTopics = PROFILE_TOPICS
      .filter(t => !state.completedTopics.includes(t.topic))
      .map(t => t.label);

    const memories = await this.memory.getAll(businessId);

    return {
      completedTopics: state.completedTopics,
      remainingTopics,
      totalTopics: PROFILE_TOPICS.length,
      completionPercent: Math.round((state.completedTopics.length / PROFILE_TOPICS.length) * 100),
      memories: memories.map(m => ({ category: m.category, key: m.key, value: m.value, confidence: m.confidence })),
    };
  }

  async confirmExtractions(businessId: string, confirmedKeys?: string[]): Promise<{ saved: number; skipped: number }> {
    const state = this.sessionCache.get(businessId);
    if (!state || state.pendingConfirmations.length === 0) {
      return { saved: 0, skipped: 0 };
    }

    let saved = 0;
    let skipped = 0;

    for (const ext of state.pendingConfirmations) {
      const fieldKey = `${ext.category}/${ext.key}`;
      if (confirmedKeys && !confirmedKeys.includes(fieldKey)) {
        skipped++;
        continue;
      }

      await this.memory.upsert(businessId, {
        category: ext.category,
        key: ext.key,
        value: ext.value,
        confidence: ext.confidence,
        source: 'user',
      });

      ext.confirmed = true;
      state.extractedFields[fieldKey] = ext;

      const topic = PROFILE_TOPICS.find(t => t.category === ext.category);
      if (topic && !state.completedTopics.includes(topic.topic)) {
        state.completedTopics.push(topic.topic);
      }

      saved++;
    }

    state.pendingConfirmations = state.pendingConfirmations.filter(e => !e.confirmed);
    state.nextTopic = PROFILE_TOPICS.find(t => !state.completedTopics.includes(t.topic))?.topic || null;
    this.sessionCache.set(businessId, state);

    return { saved, skipped };
  }

  resetSession(businessId: string): void {
    this.sessionCache.delete(businessId);
  }
}

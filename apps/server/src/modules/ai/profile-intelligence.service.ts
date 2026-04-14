import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiMemoryService, MemoryCategory } from './ai-memory.service';
import { BusinessGraphService } from './business-graph.service';
import OpenAI from 'openai';

export interface ProfileInterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProfileInterviewState {
  messages: ProfileInterviewMessage[];
  extractedFields: Record<string, { value: string; category: MemoryCategory; key: string; confidence: number }>;
  completedTopics: string[];
  nextTopic: string | null;
}

const PROFILE_TOPICS = [
  { topic: 'business_overview', label: 'Business Overview', category: 'goals' as MemoryCategory, questions: ['What does your business do?', 'Who are your typical customers?', 'How long have you been operating?'] },
  { topic: 'brand_tone', label: 'Brand Voice', category: 'tone' as MemoryCategory, questions: ['How would you describe the tone you use with clients? (e.g., formal, friendly, casual, professional)'] },
  { topic: 'goals', label: 'Business Goals', category: 'goals' as MemoryCategory, questions: ['What are your top 2-3 business goals right now?', 'Where do you want to be in 6 months?'] },
  { topic: 'risk_tolerance', label: 'AI Autonomy', category: 'riskTolerance' as MemoryCategory, questions: ['How comfortable are you with the AI handling tasks automatically? (e.g., sending follow-ups, updating statuses)'] },
  { topic: 'outreach_style', label: 'Outreach Preferences', category: 'outreachStyle' as MemoryCategory, questions: ['How do you prefer to reach out to clients? (email, WhatsApp, phone, social media)'] },
  { topic: 'priorities', label: 'Current Priorities', category: 'priorities' as MemoryCategory, questions: ['What\'s keeping you busiest right now?', 'What\'s the biggest bottleneck in your operations?'] },
  { topic: 'reporting', label: 'Reporting Preferences', category: 'reportingCadence' as MemoryCategory, questions: ['How often would you like business updates? (daily, weekly, on-demand)'] },
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

    const systemPrompt = `You are a friendly business intelligence assistant for a Caribbean business automation platform (KeyFlow OS). You're having a natural conversation to learn about the user's business so the AI can serve them better.

${businessContext}
${memoryContext}

REMAINING TOPICS TO COVER: ${remainingTopics.length > 0 ? remainingTopics.join(', ') : 'All topics covered!'}

INSTRUCTIONS:
1. Be warm, concise, and conversational — not robotic or survey-like
2. Ask ONE question at a time, naturally flowing from the user's response
3. When the user shares information, acknowledge it specifically before moving on
4. Explain briefly WHY knowing this helps the AI serve them better
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

      if (extractMatch) {
        try {
          const extractions: Array<{ category: MemoryCategory; key: string; value: string; confidence: number }> = JSON.parse(extractMatch[1]);

          for (const ext of extractions) {
            await this.memory.upsert(businessId, {
              category: ext.category,
              key: ext.key,
              value: ext.value,
              confidence: ext.confidence,
              source: 'user',
            });

            state.extractedFields[`${ext.category}/${ext.key}`] = ext;

            const topic = PROFILE_TOPICS.find(t => t.category === ext.category);
            if (topic && !state.completedTopics.includes(topic.topic)) {
              state.completedTopics.push(topic.topic);
            }
          }
        } catch (parseErr) {
          this.logger.warn(`Failed to parse extraction block: ${(parseErr as Error).message}`);
        }
      }

      state.nextTopic = PROFILE_TOPICS.find(t => !state.completedTopics.includes(t.topic))?.topic || null;
      state.messages.push({ role: 'assistant', content: reply });
      this.sessionCache.set(businessId, state);

      return { reply, state };
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

  resetSession(businessId: string): void {
    this.sessionCache.delete(businessId);
  }
}

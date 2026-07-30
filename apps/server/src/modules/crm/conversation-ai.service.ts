import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import type { MessageReceivedPayload } from '../../core/event-bus/events.types';

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed';
export type InsightKind = 'thread_summary' | 'message_analysis';

interface ThreadEntryLite {
  id: string;
  channel: string;
  direction: 'in' | 'out' | 'internal';
  body: string;
  timestamp: string;
}

interface MessageAnalysisResult {
  sentiment: Sentiment;
  intent: string;
  intentConfidence: number;
  topics: string[];
  urgency: 'low' | 'medium' | 'high';
  reason: string;
}

interface ThreadSummaryResult {
  summary: string;
  sentiment: Sentiment;
  lastIntent: string;
  openQuestions: string[];
  actionItems: string[];
}

interface SuggestedReply {
  channel: string;
  body: string;
  tone: string;
  rationale: string;
}

const MAX_THREAD_MESSAGES = 20;
const MAX_BODY = 1200;

function sanitize(input: string | null | undefined, maxLen = MAX_BODY): string {
  if (!input) return '';
  let s = input;
  const patterns = [
    /<\|system\|>/gi, /<\|user\|>/gi, /<\|assistant\|>/gi,
    /\[INST\]/gi, /\[\/INST\]/gi, /<<SYS>>/gi, /<<\/SYS>>/gi,
    /^Human:/gim, /^Assistant:/gim, /^System:/gim,
  ];
  for (const p of patterns) s = s.replace(p, '');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return s.slice(0, maxLen);
}

function parseJson<T>(content: string, fallback: T): T {
  try {
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
  } catch {
    // swallow
  }
  return fallback;
}

function normalizeSentiment(v: unknown): Sentiment {
  const s = String(v ?? '').toLowerCase();
  if (s === 'positive' || s === 'negative' || s === 'mixed') return s;
  return 'neutral';
}

@Injectable()
export class ConversationAiService {
  private readonly logger = new Logger(ConversationAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  // ---------- Thread loading ----------

  private async loadThread(businessId: string, contactId: string, limit = MAX_THREAD_MESSAGES): Promise<ThreadEntryLite[]> {
    const waContact = await this.prisma.client.whatsAppContact.findFirst({
      where: { businessId, contactId },
      select: { id: true },
    });

    const [events, waMessages] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      waContact
        ? this.prisma.client.whatsAppMessage.findMany({
            where: { businessId, whatsappContactId: waContact.id },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    const entries: ThreadEntryLite[] = [];
    for (const m of waMessages) {
      entries.push({
        id: `wa:${m.id}`,
        channel: 'whatsapp',
        direction: m.direction === 'INBOUND' ? 'in' : 'out',
        body: m.body ?? (m.templateName ? `[template:${m.templateName}]` : ''),
        timestamp: m.createdAt.toISOString(),
      });
    }
    for (const ev of events) {
      const data = (ev.data && typeof ev.data === 'object' ? (ev.data as Record<string, unknown>) : {});
      const body = (typeof data.body === 'string' && data.body) ||
        (typeof data.message === 'string' && data.message) ||
        (typeof data.notes === 'string' && data.notes) ||
        (typeof data.subject === 'string' && data.subject) ||
        (typeof data.summary === 'string' && data.summary) ||
        '';
      if (!body) continue;
      const direction = (data.direction === 'in' || data.direction === 'INBOUND') ? 'in' : 'out';
      entries.push({
        id: `event:${ev.id}`,
        channel: typeof ev.type === 'string' ? ev.type.split('.')[0] : 'event',
        direction,
        body: String(body),
        timestamp: ev.createdAt.toISOString(),
      });
    }

    entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return entries.slice(0, limit).reverse(); // oldest -> newest
  }

  private hashThread(entries: ThreadEntryLite[]): string {
    const h = createHash('sha256');
    for (const e of entries) {
      h.update(e.id);
      h.update('\u0001');
      h.update(sanitize(e.body, 500));
      h.update('\u0002');
    }
    return h.digest('hex').slice(0, 32);
  }

  // ---------- Cache helpers ----------

  private async readInsight(businessId: string, contactId: string, kind: InsightKind, messageRef: string | null) {
    return this.prisma.client.conversationAIInsight.findUnique({
      where: {
        businessId_contactId_kind_messageRef: {
          businessId,
          contactId,
          kind,
          messageRef: messageRef ?? '',
        },
      },
    }).catch(() => null);
  }

  private async writeInsight(args: {
    businessId: string;
    contactId: string;
    kind: InsightKind;
    messageRef: string | null;
    hash: string;
    sentiment?: string | null;
    intent?: string | null;
    summary?: string | null;
    payload?: unknown;
    feature?: string;
    modelUsed?: string;
  }) {
    const where = {
      businessId_contactId_kind_messageRef: {
        businessId: args.businessId,
        contactId: args.contactId,
        kind: args.kind,
        messageRef: args.messageRef ?? '',
      },
    } as const;
    const data = {
      businessId: args.businessId,
      contactId: args.contactId,
      kind: args.kind,
      messageRef: args.messageRef ?? '',
      hash: args.hash,
      sentiment: args.sentiment ?? null,
      intent: args.intent ?? null,
      summary: args.summary ?? null,
      payload: (args.payload as object | null) ?? Prisma.JsonNull,
      feature: args.feature ?? null,
      modelUsed: args.modelUsed ?? null,
    };
    return this.prisma.client.conversationAIInsight.upsert({
      where,
      update: { ...data, updatedAt: new Date() },
      create: data,
    });
  }

  // ---------- Public API ----------

  /** Summarize the most recent conversation between business and contact. */
  async summarizeThread(
    businessId: string,
    contactId: string,
    opts?: { force?: boolean },
  ): Promise<{ insight: ThreadSummaryResult | null; cached: boolean; hash: string | null }> {
    const thread = await this.loadThread(businessId, contactId);
    if (thread.length === 0) {
      return { insight: null, cached: false, hash: null };
    }
    const hash = this.hashThread(thread);

    if (!opts?.force) {
      const cached = await this.readInsight(businessId, contactId, 'thread_summary', null);
      if (cached && cached.hash === hash && cached.payload) {
        return { insight: cached.payload as unknown as ThreadSummaryResult, cached: true, hash };
      }
    }

    const transcript = thread
      .map((e) => `[${e.direction === 'in' ? 'CONTACT' : e.direction === 'internal' ? 'NOTE' : 'BUSINESS'} · ${e.channel}] ${sanitize(e.body, 600)}`)
      .join('\n');

    const system = `You analyze CRM conversations between a small business and a contact.
Return STRICT JSON. Be concise and factual. No invented details.`;
    const user = `Summarize the following conversation thread (oldest first).
Return JSON of shape:
{
  "summary": "1-2 sentence factual summary of the relationship right now",
  "sentiment": "positive|neutral|negative|mixed",
  "lastIntent": "short snake_case label of contact's most recent intent",
  "openQuestions": ["question the business has not yet answered"],
  "actionItems": ["concrete next step the business should take"]
}

THREAD:
${transcript}`;

    let result: ThreadSummaryResult | null;
    let modelUsed: string | undefined;
    try {
      const r = await this.aiUsage.callAi({
        businessId,
        feature: 'crm_conversation_summary',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 600,
        temperature: 0.3,
        responseMode: 'structured_json',
        taskCategory: 'summarization',
      });
      modelUsed = r.model;
      const parsed = parseJson<Partial<ThreadSummaryResult>>(r.content, {});
      result = {
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : '',
        sentiment: normalizeSentiment(parsed.sentiment),
        lastIntent: typeof parsed.lastIntent === 'string' ? parsed.lastIntent.slice(0, 80) : '',
        openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.slice(0, 5).map((s) => String(s).slice(0, 200)) : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.slice(0, 5).map((s) => String(s).slice(0, 200)) : [],
      };
    } catch (err: any) {
      this.logger.warn(`summarizeThread failed for ${businessId}/${contactId}: ${(err as Error).message}`);
      return { insight: null, cached: false, hash };
    }

    if (result) {
      await this.writeInsight({
        businessId, contactId, kind: 'thread_summary', messageRef: null, hash,
        sentiment: result.sentiment, intent: result.lastIntent, summary: result.summary,
        payload: result, feature: 'crm_conversation_summary', modelUsed,
      }).catch((e) => this.logger.warn(`writeInsight summary failed: ${(e as Error).message}`));
    }
    return { insight: result, cached: false, hash };
  }

  /** Analyze a single inbound message (sentiment + intent). */
  async analyzeMessage(args: {
    businessId: string;
    contactId: string;
    messageRef: string;
    channel: string;
    body: string;
  }): Promise<MessageAnalysisResult | null> {
    const body = sanitize(args.body, 1000);
    if (!body) return null;
    const hash = createHash('sha256').update(args.messageRef).update('\u0001').update(body).digest('hex').slice(0, 32);

    const cached = await this.readInsight(args.businessId, args.contactId, 'message_analysis', args.messageRef);
    if (cached && cached.hash === hash && cached.payload) {
      return cached.payload as unknown as MessageAnalysisResult;
    }

    const system = `Classify a single CRM message from a contact to a business.
Return STRICT JSON. Use plain snake_case intent labels (e.g. pricing_question, booking_request, complaint, scheduling, smalltalk, support_request, payment_issue, cancellation).`;
    const user = `Channel: ${args.channel}
Message: ${body}

Return JSON:
{
  "sentiment": "positive|neutral|negative|mixed",
  "intent": "<snake_case label>",
  "intentConfidence": 0.0,
  "topics": ["short topic tags"],
  "urgency": "low|medium|high",
  "reason": "1 short sentence why"
}`;

    let analysis: MessageAnalysisResult | null;
    let modelUsed: string | undefined;
    try {
      const r = await this.aiUsage.callAi({
        businessId: args.businessId,
        feature: 'crm_conversation_analyze',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 250,
        temperature: 0.1,
        responseMode: 'structured_json',
        taskCategory: 'classification',
      });
      modelUsed = r.model;
      const parsed = parseJson<Partial<MessageAnalysisResult>>(r.content, {});
      analysis = {
        sentiment: normalizeSentiment(parsed.sentiment),
        intent: typeof parsed.intent === 'string' ? parsed.intent.slice(0, 60) : 'unknown',
        intentConfidence: Number.isFinite(parsed.intentConfidence as number) ? Math.max(0, Math.min(1, parsed.intentConfidence as number)) : 0.5,
        topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 6).map((s) => String(s).slice(0, 40)) : [],
        urgency: ((parsed.urgency as string) === 'high' || (parsed.urgency as string) === 'medium') ? (parsed.urgency as 'high' | 'medium') : 'low',
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : '',
      };
    } catch (err: any) {
      this.logger.warn(`analyzeMessage failed for ${args.messageRef}: ${(err as Error).message}`);
      return null;
    }

    if (analysis) {
      await this.writeInsight({
        businessId: args.businessId, contactId: args.contactId, kind: 'message_analysis',
        messageRef: args.messageRef, hash,
        sentiment: analysis.sentiment, intent: analysis.intent, summary: analysis.reason,
        payload: analysis, feature: 'crm_conversation_analyze', modelUsed,
      }).catch((e) => this.logger.warn(`writeInsight analysis failed: ${(e as Error).message}`));
    }
    return analysis;
  }

  /** Generate suggested reply drafts for the most recent thread state. */
  async suggestReplies(
    businessId: string,
    contactId: string,
    opts?: { count?: number; preferredChannel?: string; tone?: string },
  ): Promise<SuggestedReply[]> {
    const count = Math.max(1, Math.min(opts?.count ?? 3, 5));
    const thread = await this.loadThread(businessId, contactId);
    if (thread.length === 0) return [];

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, tagline: true, currency: true },
    }).catch(() => null);

    const transcript = thread
      .slice(-12)
      .map((e) => `[${e.direction === 'in' ? 'CONTACT' : e.direction === 'internal' ? 'NOTE' : 'BUSINESS'} · ${e.channel}] ${sanitize(e.body, 500)}`)
      .join('\n');

    const channelHint = opts?.preferredChannel
      ? `Default to channel "${sanitize(opts.preferredChannel, 30)}".`
      : `Default to the channel most recently used by the contact.`;
    const toneHint = opts?.tone ? `Tone: ${sanitize(opts.tone, 40)}.` : 'Tone: warm, professional, concise.';

    const system = `You draft reply options that the business owner can review before sending.
Never auto-send. Each draft must be safe to send as-is, in plain text, no placeholders like [name].
Return STRICT JSON.`;
    const user = `Business: ${business?.name ?? 'Business'}${business?.industry ? ` (${business.industry})` : ''}
Currency: ${business?.currency ?? 'TTD'}

Generate ${count} distinct reply drafts for the next outbound message. ${channelHint} ${toneHint}

Return JSON:
{
  "replies": [
    { "channel": "whatsapp|email|sms|note", "body": "the reply text", "tone": "short label", "rationale": "1 sentence why this reply" }
  ]
}

THREAD (oldest first):
${transcript}`;

    try {
      const r = await this.aiUsage.callAi({
        businessId,
        feature: 'crm_conversation_suggest_replies',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 800,
        temperature: 0.7,
        responseMode: 'structured_json',
        taskCategory: 'content-generation',
      });
      const parsed = parseJson<{ replies?: Array<Partial<SuggestedReply>> }>(r.content, { replies: [] });
      const replies = Array.isArray(parsed.replies) ? parsed.replies : [];
      return replies.slice(0, count).map((p) => ({
        channel: typeof p.channel === 'string' ? p.channel : (opts?.preferredChannel ?? 'whatsapp'),
        body: typeof p.body === 'string' ? p.body.slice(0, 1500) : '',
        tone: typeof p.tone === 'string' ? p.tone.slice(0, 40) : 'professional',
        rationale: typeof p.rationale === 'string' ? p.rationale.slice(0, 200) : '',
      })).filter((r) => r.body.trim().length > 0);
    } catch (err: any) {
      this.logger.warn(`suggestReplies failed for ${businessId}/${contactId}: ${(err as Error).message}`);
      return [];
    }
  }

  /** Rollup chips for contact card: dominant sentiment, last intent, last summary one-liner. */
  async getContactRollup(businessId: string, contactId: string): Promise<{
    dominantSentiment: Sentiment | null;
    lastIntent: string | null;
    lastSummary: string | null;
    lastAnalyzedAt: string | null;
  }> {
    const [recentAnalyses, latestSummary] = await Promise.all([
      this.prisma.client.conversationAIInsight.findMany({
        where: { businessId, contactId, kind: 'message_analysis' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }).catch(() => []),
      this.prisma.client.conversationAIInsight.findFirst({
        where: { businessId, contactId, kind: 'thread_summary' },
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null),
    ]);

    let dominant: Sentiment | null = null;
    if (recentAnalyses.length > 0) {
      const counts: Record<string, number> = {};
      for (const a of recentAnalyses) {
        const s = a.sentiment ?? 'neutral';
        counts[s] = (counts[s] ?? 0) + 1;
      }
      let best = '';
      let bestCount = -1;
      for (const [k, v] of Object.entries(counts)) {
        if (v > bestCount) { best = k; bestCount = v; }
      }
      dominant = normalizeSentiment(best);
    } else if (latestSummary?.sentiment) {
      dominant = normalizeSentiment(latestSummary.sentiment);
    }

    const lastIntent = recentAnalyses[0]?.intent ?? latestSummary?.intent ?? null;
    const lastSummary = latestSummary?.summary ?? null;
    const lastAnalyzedAt =
      (recentAnalyses[0]?.createdAt ?? latestSummary?.updatedAt ?? null)?.toISOString() ?? null;

    return { dominantSentiment: dominant, lastIntent, lastSummary, lastAnalyzedAt };
  }

  /**
   * Bulk lookup: per-message message_analysis insights for a list of message refs.
   * Returns map of messageRef -> { sentiment, intent }.
   */
  async getMessageInsights(
    businessId: string,
    contactId: string,
    messageRefs: string[],
  ): Promise<Record<string, { sentiment: string | null; intent: string | null; urgency?: string | null }>> {
    if (messageRefs.length === 0) return {};
    const rows = await this.prisma.client.conversationAIInsight.findMany({
      where: {
        businessId,
        contactId,
        kind: 'message_analysis',
        messageRef: { in: messageRefs },
      },
      select: { messageRef: true, sentiment: true, intent: true, payload: true },
    }).catch(() => [] as Array<{ messageRef: string | null; sentiment: string | null; intent: string | null; payload: unknown }>);
    const out: Record<string, { sentiment: string | null; intent: string | null; urgency?: string | null }> = {};
    for (const row of rows) {
      if (!row.messageRef) continue;
      const urgency = (row.payload && typeof row.payload === 'object' && 'urgency' in (row.payload as Record<string, unknown>))
        ? String((row.payload as Record<string, unknown>).urgency ?? '')
        : null;
      out[row.messageRef] = { sentiment: row.sentiment, intent: row.intent, urgency };
    }
    return out;
  }

  // ---------- Inbound listener ----------

  @OnEvent('message.received')
  async onInbound(payload: MessageReceivedPayload) {
    try {
      if (!payload?.businessId || !payload?.contactId) return;
      const channel = String(payload.channel ?? 'message');
      const body = sanitize(payload.body ?? '', 1500);
      if (!body) return;

      // Resolve message ref. WhatsApp inbound writes a row; look it up by externalId (wamid)
      // so the messageRef matches the conversation entry id in the UI.
      let messageRef = `inbound:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      if (channel === 'whatsapp' && payload.externalId) {
        const wa = await this.prisma.client.whatsAppMessage.findUnique({
          where: { wamid: String(payload.externalId) },
          select: { id: true },
        }).catch(() => null);
        if (wa) messageRef = `wa:${wa.id}`;
      }

      const analysis = await this.analyzeMessage({
        businessId: payload.businessId,
        contactId: payload.contactId,
        messageRef,
        channel,
        body,
      });

      if (analysis) {
        this.events.emit('crm.conversation.analyzed', {
          businessId: payload.businessId,
          contactId: payload.contactId,
          messageRef,
          channel,
          sentiment: analysis.sentiment,
          intent: analysis.intent,
          urgency: analysis.urgency,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      this.logger.warn(`onInbound analyze failed: ${(err as Error).message}`);
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { KeyInboxMessage } from '@prisma/client';
import { AiUsageService } from '../ai/ai-usage.service';
import type { InboxAnalysis, InboxEntities, InboxSuggestedAction } from './key-inbox.types';

const SYSTEM_PROMPT = `You are KEY, the inbox intelligence engine for KeyFlowOS.
Analyze the incoming business message and return ONLY valid JSON matching this exact schema:

{
  "intent": "one of: lead_inquiry, invoice_request, booking_request, support_request, complaint, pricing_question, general, spam",
  "sentiment": "positive|neutral|negative",
  "urgency": "low|normal|high|urgent",
  "confidence": 0.0-1.0,
  "summary": "2-sentence summary",
  "entities": { "contacts": [], "dates": [], "invoices": [], "bookings": [], "projects": [] },
  "suggestedActions": [
    { "type": "create_task|create_contact|create_invoice|create_booking|draft_reply|schedule_followup|escalate|none", "label": "...", "confidence": 0.0-1.0, "payload": {} }
  ]
}

Rules:
- Entities should contain string values extracted from the message (names, dates, invoice numbers, booking refs, project names).
- suggestedActions should be high-value next steps. Include confidence for each.
- Output NOTHING except the JSON object. No markdown, no explanation.`;

const SUPPORTED_INTENTS = [
  'lead_inquiry',
  'invoice_request',
  'booking_request',
  'support_request',
  'complaint',
  'pricing_question',
  'general',
  'spam',
];

const SUPPORTED_SENTIMENTS = ['positive', 'neutral', 'negative'];
const SUPPORTED_URGENCIES = ['low', 'normal', 'high', 'urgent'];

@Injectable()
export class KeyInboxAnalysisService {
  private readonly logger = new Logger(KeyInboxAnalysisService.name);

  constructor(
    @Inject(AiUsageService) private readonly ai: AiUsageService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async analyzeMessage(
    businessId: string,
    content: string,
    context?: { subject?: string; channel?: string },
  ): Promise<InboxAnalysis> {
    const userContent = this.buildUserContent(content, context);

    try {
      const response = await this.ai.trackAndComplete(
        businessId,
        undefined,
        'key_inbox_classify',
        {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          taskCategory: 'classification',
          temperature: 0.2,
          maxTokens: 1200,
        },
      );

      const raw = (response.content ?? '').trim();
      return this.parseAnalysis(raw, content);
    } catch (err) {
      this.logger.error(`analyzeMessage failed: ${(err as Error).message}`);
      return this.fallbackAnalysis(content);
    }
  }

  async analyzeThread(
    businessId: string,
    messages: KeyInboxMessage[],
    context?: { subject?: string; channel?: string },
  ): Promise<InboxAnalysis> {
    const sorted = [...messages]
      .filter((m) => m.contentText)
      .sort((a, b) => {
        const aTime = a.receivedAt?.getTime() ?? a.createdAt.getTime();
        const bTime = b.receivedAt?.getTime() ?? b.createdAt.getTime();
        return aTime - bTime;
      })
      .slice(-10);

    const content = sorted.map((m) => `[${m.direction}] ${m.senderName ?? 'Unknown'}: ${m.contentText}`).join('\n---\n');

    return this.analyzeMessage(businessId, content, context);
  }

  private buildUserContent(content: string, context?: { subject?: string; channel?: string }): string {
    const parts: string[] = [];
    if (context?.channel) parts.push(`Channel: ${context.channel}`);
    if (context?.subject) parts.push(`Subject: ${context.subject}`);
    parts.push(`Message:\n${content}`);
    return parts.join('\n');
  }

  private parseAnalysis(raw: string, originalContent: string): InboxAnalysis {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : raw;

    try {
      const parsed = JSON.parse(jsonString) as Partial<InboxAnalysis>;
      return this.normalizeAnalysis(parsed, originalContent);
    } catch (err) {
      this.logger.warn(`Failed to parse analysis JSON: ${(err as Error).message}`);
      return this.fallbackAnalysis(originalContent);
    }
  }

  private normalizeAnalysis(parsed: Partial<InboxAnalysis>, originalContent: string): InboxAnalysis {
    const entities: InboxEntities = {
      contacts: Array.isArray(parsed.entities?.contacts) ? parsed.entities.contacts : [],
      dates: Array.isArray(parsed.entities?.dates) ? parsed.entities.dates : [],
      invoices: Array.isArray(parsed.entities?.invoices) ? parsed.entities.invoices : [],
      bookings: Array.isArray(parsed.entities?.bookings) ? parsed.entities.bookings : [],
      projects: Array.isArray(parsed.entities?.projects) ? parsed.entities.projects : [],
    };

    const suggestedActions: InboxSuggestedAction[] = Array.isArray(parsed.suggestedActions)
      ? parsed.suggestedActions
          .filter((a): a is InboxSuggestedAction =>
            Boolean(a && typeof a === 'object' && 'type' in a && 'label' in a),
          )
          .map((a) => ({
            type: String(a.type),
            label: String(a.label),
            confidence: this.normalizeConfidence(a.confidence),
            payload: a.payload && typeof a.payload === 'object' ? a.payload : undefined,
          }))
      : [];

    return {
      intent: SUPPORTED_INTENTS.includes(parsed.intent ?? '') ? parsed.intent! : 'general',
      sentiment: SUPPORTED_SENTIMENTS.includes(parsed.sentiment ?? '') ? parsed.sentiment! : 'neutral',
      urgency: SUPPORTED_URGENCIES.includes(parsed.urgency ?? '') ? parsed.urgency! : 'normal',
      confidence: this.normalizeConfidence(parsed.confidence),
      summary: parsed.summary && typeof parsed.summary === 'string' ? parsed.summary : this.truncate(originalContent, 120),
      entities,
      suggestedActions,
    };
  }

  private fallbackAnalysis(content: string): InboxAnalysis {
    return {
      intent: 'general',
      sentiment: 'neutral',
      urgency: 'normal',
      confidence: 0,
      summary: this.truncate(content, 120),
      entities: { contacts: [], dates: [], invoices: [], bookings: [], projects: [] },
      suggestedActions: [{ type: 'review', label: 'Review in Key Inbox', confidence: 1 }],
    };
  }

  private normalizeConfidence(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(1, num));
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }
}

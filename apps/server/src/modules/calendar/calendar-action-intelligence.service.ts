import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessEventService } from '../business-events/business-event.service';
import { AiUsageService } from '../ai/ai-usage.service';
import type {
  CalendarEventCreatedPayload,
  CalendarEventUpdatedPayload,
} from '../../core/event-bus/events.types';

interface CalendarAction {
  type: string;
  label: string;
  confidence: number;
  payload?: Record<string, unknown>;
}

interface CalendarActionAnalysis {
  intent: string;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  confidence: number;
  summary: string;
  suggestedActions: CalendarAction[];
}

const SUPPORTED_ACTION_TYPES = new Set([
  'create_task',
  'create_contact',
  'draft_reply',
  'schedule_followup',
  'send_reminder',
  'none',
  'review',
]);

@Injectable()
export class CalendarActionIntelligenceService {
  private readonly logger = new Logger(CalendarActionIntelligenceService.name);

  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessEventService) private readonly businessEventService: BusinessEventService,
  ) {}

  async analyzeEvent(
    businessId: string,
    payload: CalendarEventCreatedPayload | CalendarEventUpdatedPayload,
  ): Promise<void> {
    try {
      const startTime = payload.startTime ? new Date(payload.startTime) : null;
      if (!startTime || Number.isNaN(startTime.getTime())) return;

      // Only analyze events that are in the future or very recent. Past events rarely
      // need prep, but a short lookback catches same-day updates.
      const hoursUntilStart = (startTime.getTime() - Date.now()) / (60 * 60 * 1000);
      if (hoursUntilStart < -4) return;

      const analysis = await this.runAiAnalysis(businessId, payload);
      const actions = this.filterActions(analysis);

      if (actions.length === 0) return;

      await this.businessEventService.emit({
        businessId,
        eventType: 'calendar_event.actions_suggested',
        subjectType: 'CalendarEvent',
        subjectId: payload.externalId ?? `${payload.title}:${startTime.toISOString()}`,
        actorType: 'ai',
        actorId: 'calendar_action_intelligence',
        action: 'suggest_actions',
        source: 'ai',
        after: {
          title: payload.title,
          startTime: payload.startTime,
          endTime: payload.endTime,
          intent: analysis.intent,
          urgency: analysis.urgency,
          summary: analysis.summary,
          actions,
        },
        metadata: {
          feature: 'calendar_action_intelligence',
          confidence: analysis.confidence,
          intent: analysis.intent,
          actionCount: actions.length,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Calendar action intelligence failed for ${businessId}: ${(err as Error).message}`,
      );
    }
  }

  private async runAiAnalysis(
    businessId: string,
    payload: CalendarEventCreatedPayload | CalendarEventUpdatedPayload,
  ): Promise<CalendarActionAnalysis> {
    const systemPrompt = `You are KEY, the calendar action intelligence engine for KeyFlowOS.
Analyze the calendar event and return ONLY valid JSON matching this exact schema:
{
  "intent": "one of: appointment, deadline, prep_needed, follow_up, travel, admin, personal, other",
  "urgency": "low|normal|high|urgent",
  "confidence": 0.0-1.0,
  "summary": "1-sentence description of what the event is and what the business should do about it",
  "suggestedActions": [
    { "type": "create_task|create_contact|draft_reply|schedule_followup|send_reminder|none", "label": "...", "confidence": 0.0-1.0, "payload": {} }
  ]
}
Rules:
- Suggest high-value next steps (e.g., prep materials, confirm attendance, send reminder, follow up after).
- Include confidence for each action.
- Output NOTHING except the JSON object.`;

    const bookingId = 'bookingId' in payload ? payload.bookingId : undefined;
    const userPrompt = `Event: ${payload.title}\nStart: ${new Date(payload.startTime).toISOString()}\nEnd: ${new Date(payload.endTime).toISOString()}\nBooking: ${bookingId ? 'yes' : 'no'}`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'calendar_action_intelligence',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          taskCategory: 'classification',
          temperature: 0.3,
          maxTokens: 800,
        },
      );
      return this.parseAnalysis(response.content ?? '', payload);
    } catch (err) {
      this.logger.warn(`AI analysis failed: ${(err as Error).message}`);
      return this.fallbackAnalysis(payload);
    }
  }

  private parseAnalysis(
    raw: string,
    payload: CalendarEventCreatedPayload | CalendarEventUpdatedPayload,
  ): CalendarActionAnalysis {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : raw;

    try {
      const parsed = JSON.parse(jsonString) as Partial<CalendarActionAnalysis>;
      const supportedUrgencies = ['low', 'normal', 'high', 'urgent'];
      const actions = Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions
            .filter((a): a is CalendarAction =>
              Boolean(a && typeof a === 'object' && 'type' in a && 'label' in a),
            )
            .map((a) => ({
              type: SUPPORTED_ACTION_TYPES.has(a.type) ? a.type : 'review',
              label: String(a.label),
              confidence: this.normalizeConfidence(a.confidence),
              payload: a.payload && typeof a.payload === 'object' ? a.payload : undefined,
            }))
        : [];

      return {
        intent: typeof parsed.intent === 'string' ? parsed.intent : 'other',
        urgency: supportedUrgencies.includes(parsed.urgency ?? '')
          ? (parsed.urgency as CalendarActionAnalysis['urgency'])
          : 'normal',
        confidence: this.normalizeConfidence(parsed.confidence),
        summary:
          typeof parsed.summary === 'string'
            ? parsed.summary
            : `Calendar event: ${payload.title}`,
        suggestedActions: actions,
      };
    } catch (err) {
      this.logger.warn(`Failed to parse calendar action JSON: ${(err as Error).message}`);
      return this.fallbackAnalysis(payload);
    }
  }

  private fallbackAnalysis(
    payload: CalendarEventCreatedPayload | CalendarEventUpdatedPayload,
  ): CalendarActionAnalysis {
    return {
      intent: 'appointment',
      urgency: 'normal',
      confidence: 0,
      summary: `Calendar event: ${payload.title}`,
      suggestedActions: [
        {
          type: 'review',
          label: 'Review calendar event',
          confidence: 1,
          payload: { title: payload.title, startTime: payload.startTime },
        },
      ],
    };
  }

  private filterActions(analysis: CalendarActionAnalysis): CalendarAction[] {
    const actions = analysis.suggestedActions.filter(
      (a) => SUPPORTED_ACTION_TYPES.has(a.type) && a.confidence >= 0.4,
    );
    if (actions.length === 0) {
      actions.push({
        type: 'review',
        label: 'Review calendar event',
        confidence: 1,
        payload: {},
      });
    }
    return actions;
  }

  private normalizeConfidence(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(1, num));
  }
}

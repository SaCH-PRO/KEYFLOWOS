import { Injectable, Logger, Inject } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';

interface FactCandidate {
  section: string;
  domain: string;
  field?: string;
  value?: unknown;
  confidence?: number;
  reason?: string;
}

const GENOME_SECTIONS = [
  'VISION_IDENTITY',
  'FOUNDER_LEADERSHIP',
  'BUSINESS_MODEL',
  'CUSTOMER_MARKET',
  'OFFER_PRODUCT',
  'OPERATIONS_DELIVERY',
  'SALES',
  'MARKETING_GROWTH',
  'FINANCIAL',
  'TECH_DATA_INTELLIGENCE',
  'LEGAL_GOVERNANCE_COMPLIANCE',
  'RISK_RESILIENCE',
];

const MAX_SIGNALS_PER_TURN = 3;
const MIN_CONFIDENCE = 0.6;
const MIN_USER_MESSAGE_LENGTH = 15;

/**
 * Every KEY conversation feeds the Business Genome. After each completed chat
 * turn this service extracts durable business facts the user stated and files
 * them as PENDING genome signals — nothing auto-merges; the user reviews and
 * accepts them in the genome Signals panel (propose/confirm trust posture).
 * Extraction is strictly best-effort: it must never break or delay a turn.
 */
@Injectable()
export class ConversationGenomeExtractorService {
  private readonly logger = new Logger(ConversationGenomeExtractorService.name);

  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(GenomeSignalService) private readonly signals: GenomeSignalService,
  ) {}

  async extractFromTurn(businessId: string, userMessage: string, assistantReply: string): Promise<void> {
    const userText = (userMessage ?? '').trim();
    if (userText.length < MIN_USER_MESSAGE_LENGTH) return;

    let candidates: FactCandidate[];
    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'genome_extraction',
        {
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            {
              role: 'user',
              content: `USER SAID:\n"""${userText.slice(0, 1200)}"""\n\nASSISTANT REPLIED (context only, do not extract from it):\n"""${(assistantReply ?? '').slice(0, 600)}"""`,
            },
          ],
          maxTokens: 300,
          temperature: 0,
        } as never,
      );
      candidates = parseCandidates(response.content ?? '');
    } catch (err) {
      this.logger.warn(`Genome extraction call failed for ${businessId}: ${(err as Error).message}`);
      return;
    }

    const accepted = candidates
      .filter((c) => (c.confidence ?? 0) >= MIN_CONFIDENCE && GENOME_SECTIONS.includes(c.section))
      .slice(0, MAX_SIGNALS_PER_TURN);

    for (const c of accepted) {
      try {
        await this.signals.createSignal({
          businessId,
          sourceModule: 'key-chat',
          signalType: 'NEW_FACT',
          section: c.section,
          domain: c.domain,
          field: c.field ?? null,
          proposedValue: c.value,
          reason: c.reason?.slice(0, 280) || 'Mentioned in a KEY chat conversation',
          evidence: [
            {
              sourceModule: 'key-chat',
              sourceEntityType: 'FlowSession',
              summary: userText.slice(0, 280),
              evidenceStrength: c.confidence ?? 0.5,
            },
          ],
          confidence: c.confidence,
        });
      } catch (err) {
        this.logger.warn(`Failed to file genome signal for ${businessId}: ${(err as Error).message}`);
      }
    }
  }
}

function parseCandidates(raw: string): FactCandidate[] {
  try {
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is FactCandidate =>
        typeof c === 'object' && c !== null &&
        typeof (c as FactCandidate).section === 'string' &&
        typeof (c as FactCandidate).domain === 'string',
    );
  } catch {
    return [];
  }
}

const EXTRACTION_PROMPT = `You extract durable business facts from a chat turn between a business owner and their AI assistant.

Valid sections: ${GENOME_SECTIONS.join(', ')}.

Rules:
- Only extract facts the USER explicitly stated about their own business (numbers, names, prices, customers, processes, goals, constraints, preferences, structure).
- Never invent or infer beyond the text. Ignore questions, commands, small talk, and facts about other companies or the world.
- domain is a short snake_case area (e.g. pricing, ideal_customer, team_size); field a short snake_case key.
- Return at most ${MAX_SIGNALS_PER_TURN} facts. If there is nothing worth keeping, return [].
- Output STRICT JSON array only, no prose: [{"section":"...","domain":"...","field":"...","value":"...","confidence":0.0-1.0,"reason":"short why"}]`;

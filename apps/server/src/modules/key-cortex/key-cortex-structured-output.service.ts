import { Injectable } from '@nestjs/common';
import { TaskCategory } from '../ai/model-gateway.service';
import { CortexQuery } from './key-cortex.types';

/**
 * KeyCortexStructuredOutputService
 *
 * Builds structured output instructions and parses KEY 10/10 reasoning
 * responses into a typed shape. Also classifies queries into task categories.
 */
@Injectable()
export class KeyCortexStructuredOutputService {
  /**
   * Classify a user query into a ModelGateway task category.
   */
  classifyTaskCategory(query: CortexQuery): TaskCategory {
    const text = query.text.toLowerCase();

    if (
      query.enableActions &&
      /\b(create|add|schedule|send|update|delete|run|execute|make|book|invoice|task|email|reminder|workflow)\b/.test(
        text,
      )
    ) {
      return 'tool-calling';
    }

    if (
      /\b(feel|feeling|stressed|overwhelmed|frustrated|angry|worried|anxious|excited|happy|disappointed|conflict|team morale|burnout)\b/.test(
        text,
      )
    ) {
      return 'emotion-analysis';
    }

    if (
      /\b(code|script|function|api|bug|error|debug|typescript|javascript|python|sql|query|endpoint|integration)\b/.test(
        text,
      )
    ) {
      return 'code';
    }

    if (
      /\b(idea|brainstorm|creative|write|draft|compose|design|campaign|slogan|content|story|pitch)\b/.test(
        text,
      )
    ) {
      return 'creative';
    }

    if (
      /\b(forecast|predict|trend|projection|next month|next quarter|seasonality|runway|growth rate|churn forecast|revenue forecast)\b/.test(
        text,
      )
    ) {
      return 'forecasting';
    }

    if (
      /\b(extract|parse|pull out|find the|get the|what is the|lookup)\b/.test(
        text,
      )
    ) {
      return 'extraction';
    }

    if (
      /\b(summarize|summary|tl;dr|recap|condense|brief|overview)\b/.test(text)
    ) {
      return 'summarization';
    }

    if (
      /\b(classify|categorize|which type|what kind|is this|route to|assign to)\b/.test(
        text,
      )
    ) {
      return 'classification';
    }

    if (
      /\b(analyze|reason|think|why|how does|explain|compare|evaluate|assess|strategy|recommend|should i|what if|pros and cons)\b/.test(
        text,
      )
    ) {
      return 'reasoning';
    }

    if (
      /\b(analysis|metric|kpi|performance|report|number|data|roi|conversion|revenue|expense)\b/.test(
        text,
      )
    ) {
      return 'analysis';
    }

    return 'general';
  }

  /**
   * Instructions that force the LLM to return a structured business reasoning response.
   */
  buildStructuredOutputInstructions(): string {
    return `=== RESPONSE FORMAT ===
You must respond using the following sections. Be concise but thorough.

1. **Role Mode**: The business role you are thinking as (e.g., CFO, CMO, COO, Founder).
2. **Analysis**: Your core reasoning using relevant frameworks and the provided context.
3. **Hidden Signals**: What the user might be missing based on the business context.
4. **Recommendation**: Specific, actionable advice in plain language.
5. **Risk Check**: What could go wrong or what to watch out for.
6. **Success Metrics**: How to measure if this recommendation works.
7. **Next Step**: The single most important action to take now.
8. **Confidence**: A number from 0-100 representing your confidence, and one sentence explaining why.

If you don't know something, state it explicitly and recommend a human expert.
========================`;
  }

  /**
   * Parse a structured response into the KEY 10/10 output shape.
   */
  parseStructuredResponse(content: string): {
    role?: string;
    analysis?: string;
    hiddenSignals: string[];
    recommendation?: string;
    risks: string[];
    successMetrics: string[];
    nextStep?: string;
    confidence: number;
    frameworks: string[];
  } {
    const empty = {
      role: undefined,
      analysis: undefined,
      hiddenSignals: [] as string[],
      recommendation: content || '',
      risks: [] as string[],
      successMetrics: [] as string[],
      nextStep: undefined,
      confidence: 70,
      frameworks: [] as string[],
    };

    if (!content || !content.includes('**')) {
      return empty;
    }

    const sectionLabels = [
      'Role Mode',
      'Analysis',
      'Hidden Signals',
      'Recommendation',
      'Risk Check',
      'Success Metrics',
      'Next Step',
      'Confidence',
    ];

    const normalized = content.replace(/\r\n/g, '\n');

    const findSection = (
      label: string,
    ): { labelStart: number; contentStart: number } | undefined => {
      const patterns = [
        new RegExp(`\\*\\*${label}\\*\\*[\\s:]*`, 'i'),
        new RegExp(`${label}:[\\s]*`, 'i'),
      ];
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.index !== undefined) {
          return {
            labelStart: match.index,
            contentStart: match.index + match[0].length,
          };
        }
      }
      return undefined;
    };

    const sections: Record<string, string> = {};
    const positions: Array<{
      label: string;
      labelStart: number;
      contentStart: number;
    }> = [];

    for (const label of sectionLabels) {
      const pos = findSection(label);
      if (pos) {
        positions.push({ label, ...pos });
      }
    }

    positions.sort((a, b) => a.contentStart - b.contentStart);

    for (let i = 0; i < positions.length; i++) {
      const current = positions[i];
      const next = positions[i + 1];
      const end = next ? next.labelStart : normalized.length;
      sections[current.label] = normalized
        .slice(current.contentStart, end)
        .replace(/\n\s*\n/g, '\n')
        .trim();
    }

    const parseList = (raw?: string): string[] => {
      if (!raw) return [];
      return raw
        .split(/\n|•|-\s*|\d+\.\s*/)
        .map((s) => s.replace(/^[-•]\s*/, '').trim())
        .filter((s) => s.length > 0);
    };

    const role = sections['Role Mode'];
    const frameworks: string[] = [];
    if (role) frameworks.push(`Role: ${role}`);

    return {
      role,
      analysis: sections['Analysis'],
      hiddenSignals: parseList(sections['Hidden Signals']),
      recommendation: sections['Recommendation'] || content,
      risks: parseList(sections['Risk Check']),
      successMetrics: parseList(sections['Success Metrics']),
      nextStep: sections['Next Step'],
      confidence: this.parseConfidence(sections['Confidence'] ?? ''),
      frameworks,
    };
  }

  parseConfidence(raw: string): number {
    if (!raw) return 70;
    const match = raw.match(/(\d{1,3})/);
    if (!match) return 70;
    const value = parseInt(match[1], 10);
    return Math.min(Math.max(value, 0), 100);
  }
}

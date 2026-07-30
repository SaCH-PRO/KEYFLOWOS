import { Injectable } from '@nestjs/common';
import { CortexMood } from './key-cortex.types';

/**
 * KeyCortexMoodDetectionService
 *
 * Detects the user's mood from their query text using keyword heuristics.
 */
@Injectable()
export class KeyCortexMoodDetectionService {
  /**
   * Detect the user's mood from their query text.
   */
  detectMood(query: string): CortexMood {
    const text = query.toLowerCase();

    if (
      /\b(?:urgent|asap|emergency|critical|deadline|now|immediately|hurry)\b/.test(
        text,
      )
    ) {
      return 'urgent';
    }

    if (
      /\b(?:idea|creative|brainstorm|imagine|design|innovative|fun|exciting|inspiration)\b/.test(
        text,
      )
    ) {
      return 'creative';
    }

    if (
      /\b(?:analyze|data|metric|report|numbers|compare|evaluate|performance|kpi|roi)\b/.test(
        text,
      )
    ) {
      return 'analytical';
    }

    if (
      /\b(?:hey|hi|hello|thanks|please|help me|can you|would you|maybe|perhaps)\b/.test(
        text,
      ) &&
      text.length < 150
    ) {
      return 'casual';
    }

    return 'focused';
  }
}

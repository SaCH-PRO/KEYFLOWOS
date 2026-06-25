import { Injectable, Logger } from '@nestjs/common';
import { EmotionInput, EmotionState, Emotion } from '../types/consciousness.types';
import { EmotionSignals } from './emotion-signals.service';

/**
 * =============================================================================
 * L1: Emotion Engine
 * =============================================================================
 * Detects 10 distinct emotions from user text using a hybrid approach:
 *   1. Keyword-based lexicon scoring (primary)
 *   2. Signal aggregation from the EmotionSignals service (secondary)
 *
 * Each emotion has a weighted dictionary of indicative terms.  The engine
 * scores every emotion, normalises, and returns the winner with calibrated
 * confidence.
 * =============================================================================
 */

interface LexiconEntry {
  keywords: string[];
  weight: number;
}

const EMOTION_LEXICON: Record<Emotion, LexiconEntry> = {
  joy: {
    keywords: ['happy', 'joy', 'excited', 'delighted', 'glad', 'wonderful', 'fantastic', 'love', 'great', 'awesome', 'amazing', 'excellent', 'thrilled', 'pleased', 'grateful', 'cheerful', 'elated', 'blissful'],
    weight: 1.0,
  },
  anger: {
    keywords: ['angry', 'furious', 'mad', 'rage', 'annoyed', 'frustrated', 'irritated', 'outraged', 'livid', 'hostile', 'hate', 'disgusted', 'pissed', 'infuriated'],
    weight: 1.0,
  },
  sadness: {
    keywords: ['sad', 'depressed', 'unhappy', 'miserable', 'disappointed', 'heartbroken', 'grief', 'sorrow', 'melancholy', 'gloomy', 'hopeless', 'devastated', 'down', 'blue', 'crying', 'upset'],
    weight: 1.0,
  },
  fear: {
    keywords: ['afraid', 'scared', 'terrified', 'anxious', 'worried', 'nervous', 'panic', 'frightened', 'dread', 'horror', 'concerned', 'uneasy', 'tense', 'alarmed'],
    weight: 1.0,
  },
  surprise: {
    keywords: ['surprised', 'shocked', 'amazed', 'astonished', 'stunned', 'wow', 'unexpected', 'unbelievable', 'incredible', 'speechless', 'startled', 'bewildered'],
    weight: 1.0,
  },
  disgust: {
    keywords: ['disgust', 'repulsed', 'revolted', 'sick', 'nauseous', 'appalled', 'horrified', 'distaste', 'contempt', 'loathing', 'detest'],
    weight: 1.0,
  },
  trust: {
    keywords: ['trust', 'confident', 'reliable', 'dependable', 'honest', 'loyal', 'faithful', 'secure', 'safe', 'believable', 'credible', 'assured', 'trustworthy'],
    weight: 1.0,
  },
  anticipation: {
    keywords: ['expect', 'hope', 'anticipate', 'eager', 'excited', 'looking forward', 'await', 'upcoming', 'soon', 'prepare', 'ready', 'enthusiastic'],
    weight: 1.0,
  },
  calm: {
    keywords: ['calm', 'peaceful', 'relaxed', 'serene', 'tranquil', 'quiet', 'still', 'composed', 'centered', 'mindful', 'balanced', 'steady', 'neutral', 'fine', 'ok', 'okay'],
    weight: 0.8,
  },
  overwhelm: {
    keywords: ['overwhelm', 'swamped', 'drowning', 'buried', 'too much', 'cannot handle', 'stressed', 'pressure', 'exhausted', 'burned out', 'at capacity', 'maxed', 'breaking'],
    weight: 1.0,
  },
};

@Injectable()
export class EmotionEngine {
  private readonly logger = new Logger(EmotionEngine.name);

  constructor(private readonly signals: EmotionSignals) {}

  /**
   * Detect the dominant emotion in a piece of user text.
   *
   * Algorithm:
   *   1. Score each emotion using the weighted lexicon.
   *   2. Augment with signal-based scores from EmotionSignals.
   *   3. Normalise and pick the winner.
   *   4. Calibrate confidence based on margin of victory.
   */
  async detectEmotion(input: EmotionInput): Promise<EmotionState> {
    try {
      this.logger.debug(`Detecting emotion for user=${input.userId}`);

      const lowerText = input.text.toLowerCase();
      const scores = this.scoreLexicon(lowerText);

      // Augment with signal aggregation
      const signalScores = await this.signals.aggregateSignals(input);
      for (const [emotion, score] of Object.entries(signalScores)) {
        if (scores[emotion as Emotion] !== undefined) {
          scores[emotion as Emotion] += score * 0.3; // 30 % signal weight
        }
      }

      const { primary, intensity, confidence } = this.resolveWinner(scores);

      this.logger.verbose(`Detected: ${primary} (intensity=${intensity}, confidence=${confidence})`);

      return { primary, intensity, confidence };
    } catch (err) {
      this.logger.warn(`Emotion detection failed: ${(err as Error).message}`);
      // Graceful degradation — return neutral calm state
      return { primary: 'calm', intensity: 0.1, confidence: 0.5 };
    }
  }

  /** Score every emotion against the text using the keyword lexicon. */
  private scoreLexicon(text: string): Record<Emotion, number> {
    const scores = {} as Record<Emotion, number>;
    for (const [emotion, entry] of Object.entries(EMOTION_LEXICON) as [Emotion, LexiconEntry][]) {
      let score = 0;
      for (const kw of entry.keywords) {
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          score += matches.length * entry.weight;
        }
      }
      // Check for punctuation amplification (!!! => stronger emotion)
      const exclamations = (text.match(/!/g) || []).length;
      if (exclamations > 2 && score > 0) {
        score *= 1 + (exclamations - 2) * 0.15;
      }
      // Check for negative modifiers ("not happy" flips joy to sadness)
      if (this.isNegated(text, emotion)) {
        score *= -0.5;
      }
      scores[emotion] = Math.max(0, score);
    }
    return scores;
  }

  /** Detect if an emotion keyword is preceded by a negation within 3 words. */
  private isNegated(text: string, emotion: Emotion): boolean {
    const negations = ['not', 'no', 'never', "n't", 'hardly', 'barely', 'scarcely'];
    const keywords = EMOTION_LEXICON[emotion].keywords;
    for (const kw of keywords) {
      // Simple negation check — look for "not ... keyword" within 3 words
      const pattern = new RegExp(`(?:${negations.join('|')})(?:\\s+\\w+){0,3}\\s+${kw}`, 'i');
      if (pattern.test(text)) return true;
    }
    return false;
  }

  /** Pick the highest-scoring emotion and calibrate intensity & confidence. */
  private resolveWinner(scores: Record<Emotion, number>): { primary: Emotion; intensity: number; confidence: number } {
    const entries = Object.entries(scores) as [Emotion, number][];
    entries.sort((a, b) => b[1] - a[1]);

    const [primary, primaryScore] = entries[0];
    const [, secondScore] = entries[1];

    const total = entries.reduce((sum, [, s]) => sum + s, 0);
    const intensity = total === 0 ? 0.1 : Math.min(1, Math.round((primaryScore / total) * 10) / 10);

    // Confidence depends on margin of victory and absolute score
    const margin = primaryScore - secondScore;
    const confidence = Math.min(1, Math.round((0.4 + margin * 0.3 + (total > 0 ? 0.2 : 0)) * 10) / 10);

    return { primary, intensity, confidence };
  }
}

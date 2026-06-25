import { Injectable, Logger } from '@nestjs/common';
import { Emotion, EmotionInput } from '../types/consciousness.types';

/**
 * =============================================================================
 * Emotion Signals — Aggregator
 * =============================================================================
 * Collects and aggregates 5 independent signal types to augment lexicon-based
 * emotion detection with orthogonal evidence:
 *
 *   1. Punctuation Signal      — intensity markers (! ? ...)
 *   2. Capitalisation Signal   — SHOUTING detection
 *   3. Sentence-Length Signal  — abrupt short = anger/surprise
 *   4. Polarity Signal         — positive vs negative word ratios
 *   5. Emoji / Unicode Signal  — emoticon detection
 * =============================================================================
 */

@Injectable()
export class EmotionSignals {
  private readonly logger = new Logger(EmotionSignals.name);

  /** Aggregate all 5 signal types into per-emotion boost scores. */
  async aggregateSignals(input: EmotionInput): Promise<Partial<Record<Emotion, number>>> {
    try {
      const text = input.text;
      const scores: Partial<Record<Emotion, number>> = {};

      const punctuation = this.analyzePunctuation(text);
      const caps = this.analyzeCapitalisation(text);
      const length = this.analyzeSentenceLength(text);
      const polarity = this.analyzePolarity(text);
      const emoji = this.analyzeEmoji(text);

      // Merge signals — each contributes up to 1.0 per emotion
      this.merge(scores, punctuation, 0.2);
      this.merge(scores, caps, 0.15);
      this.merge(scores, length, 0.2);
      this.merge(scores, polarity, 0.3);
      this.merge(scores, emoji, 0.15);

      this.logger.verbose(`Signal aggregation complete for user=${input.userId}`);
      return scores;
    } catch (err) {
      this.logger.warn(`Signal aggregation failed: ${(err as Error).message}`);
      return {};
    }
  }

  /** 1. Punctuation Signal — exclamation = excitement/anger, ellipsis = sadness. */
  private analyzePunctuation(text: string): Partial<Record<Emotion, number>> {
    const scores: Partial<Record<Emotion, number>> = {};
    const exclamations = (text.match(/!/g) || []).length;
    const questions = (text.match(/\?/g) || []).length;
    const ellipses = (text.match(/\.{3,}/g) || []).length;

    if (exclamations >= 2) {
      scores.joy = (scores.joy || 0) + 0.5;
      scores.anger = (scores.anger || 0) + 0.6;
      scores.surprise = (scores.surprise || 0) + 0.4;
    }
    if (questions >= 2) {
      scores.confusion = 0.3; // will be ignored if not in Emotion union
      scores.surprise = (scores.surprise || 0) + 0.3;
      scores.anticipation = (scores.anticipation || 0) + 0.2;
    }
    if (ellipses >= 1) {
      scores.sadness = (scores.sadness || 0) + 0.5;
      scores.overwhelm = (scores.overwhelm || 0) + 0.3;
    }
    return scores;
  }

  /** 2. Capitalisation Signal — ALL CAPS words indicate anger / overwhelm. */
  private analyzeCapitalisation(text: string): Partial<Record<Emotion, number>> {
    const scores: Partial<Record<Emotion, number>> = {};
    const words = text.split(/\s+/);
    const capsWords = words.filter(w => w.length > 2 && w === w.toUpperCase() && /^[A-Z]+$/.test(w));
    const ratio = words.length > 0 ? capsWords.length / words.length : 0;

    if (ratio > 0.3) {
      scores.anger = (scores.anger || 0) + 0.7;
      scores.overwhelm = (scores.overwhelm || 0) + 0.4;
      scores.fear = (scores.fear || 0) + 0.2;
    } else if (ratio > 0.1) {
      scores.anger = (scores.anger || 0) + 0.3;
      scores.anticipation = (scores.anticipation || 0) + 0.2;
    }
    return scores;
  }

  /** 3. Sentence-Length Signal — very short sentences = anger / surprise. */
  private analyzeSentenceLength(text: string): Partial<Record<Emotion, number>> {
    const scores: Partial<Record<Emotion, number>> = {};
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length === 0) return scores;

    const avgLen = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;

    if (avgLen < 4) {
      scores.anger = (scores.anger || 0) + 0.5;
      scores.surprise = (scores.surprise || 0) + 0.4;
    } else if (avgLen > 20) {
      scores.overwhelm = (scores.overwhelm || 0) + 0.3;
      scores.sadness = (scores.sadness || 0) + 0.2;
    }
    return scores;
  }

  /** 4. Polarity Signal — positive vs negative word ratios. */
  private analyzePolarity(text: string): Partial<Record<Emotion, number>> {
    const scores: Partial<Record<Emotion, number>> = {};
    const lower = text.toLowerCase();

    const positiveWords = ['good', 'great', 'excellent', 'love', 'happy', 'best', 'amazing', 'wonderful', 'fantastic', 'perfect', 'awesome', 'brilliant', 'outstanding'];
    const negativeWords = ['bad', 'terrible', 'awful', 'worst', 'hate', 'horrible', 'disgusting', 'pathetic', 'useless', 'stupid', 'wrong', 'fail', 'broken'];

    let posCount = 0;
    let negCount = 0;
    for (const w of positiveWords) {
      const matches = lower.match(new RegExp(`\\b${w}\\b`, 'g'));
      if (matches) posCount += matches.length;
    }
    for (const w of negativeWords) {
      const matches = lower.match(new RegExp(`\\b${w}\\b`, 'g'));
      if (matches) negCount += matches.length;
    }

    if (posCount > negCount * 2) {
      scores.joy = (scores.joy || 0) + 0.6;
      scores.trust = (scores.trust || 0) + 0.3;
    } else if (negCount > posCount * 2) {
      scores.anger = (scores.anger || 0) + 0.4;
      scores.sadness = (scores.sadness || 0) + 0.4;
      scores.disgust = (scores.disgust || 0) + 0.3;
    }
    return scores;
  }

  /** 5. Emoji / Unicode Signal — map common emoticons to emotions. */
  private analyzeEmoji(text: string): Partial<Record<Emotion, number>> {
    const scores: Partial<Record<Emotion, number>> = {};

    const emojiMap: Record<string, Emotion[]> = {
      '😊': ['joy'], '😂': ['joy'], '❤️': ['joy', 'trust'], '👍': ['trust'],
      '😢': ['sadness'], '😭': ['sadness'], '😡': ['anger'], '😠': ['anger'],
      '😱': ['fear'], '😨': ['fear'], '😃': ['joy', 'anticipation'],
      '🤢': ['disgust'], '🤮': ['disgust'], '😲': ['surprise'], '😮': ['surprise'],
      '😌': ['calm'], '😔': ['sadness'], '😫': ['overwhelm'], '😤': ['anger'],
      '❤': ['joy', 'trust'], '💔': ['sadness'], '🙏': ['trust', 'anticipation'],
    };

    for (const [emoji, emotions] of Object.entries(emojiMap)) {
      if (text.includes(emoji)) {
        for (const emotion of emotions) {
          scores[emotion] = (scores[emotion] || 0) + 0.6;
        }
      }
    }
    return scores;
  }

  /** Merge a signal vector into the accumulator with the given weight. */
  private merge(
    acc: Partial<Record<Emotion, number>>,
    delta: Partial<Record<Emotion, number>>,
    weight: number,
  ): void {
    for (const [key, value] of Object.entries(delta)) {
      const emotion = key as Emotion;
      acc[emotion] = (acc[emotion] || 0) + (value ?? 0) * weight;
    }
  }
}

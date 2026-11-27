import { describe, it, expect } from 'vitest';
import {
  KeyCortexStructuredOutputService,
  parseStructuredConfidence,
} from '../key-cortex-structured-output.service';

describe('KeyCortexStructuredOutputService — confidence parsing & ReDoS hardening', () => {
  const service = new KeyCortexStructuredOutputService();

  describe('parseStructuredConfidence / parseConfidence', () => {
    it.each(['-5', '-5%', '-95', '-0.85', 'score: -42%'])(
      'rejects negative input %j as null rather than stripping the minus sign',
      (raw) => {
        expect(parseStructuredConfidence(raw)).toBeNull();
        expect(service.parseConfidence(raw)).toBeNull();
      },
    );

    it.each(['1000', '101', '150%', '2026'])(
      'rejects out-of-range input %j (> 100) as null rather than truncating to 100',
      (raw) => {
        expect(parseStructuredConfidence(raw)).toBeNull();
        expect(service.parseConfidence(raw)).toBeNull();
      },
    );

    it('normalizes unit-interval decimals without % rather than truncating to 0', () => {
      expect(parseStructuredConfidence('0.85')).toBe(85);
      expect(parseStructuredConfidence('0.855')).toBe(85.5);
      expect(service.parseConfidence('0.85 — based on last quarter')).toBe(85);
    });

    it('keeps explicit percentage decimals on the 0-100 scale', () => {
      expect(parseStructuredConfidence('0.5%')).toBe(0.5);
      expect(parseStructuredConfidence('85.5%')).toBe(85.5);
    });

    it('accepts valid boundary and standard values on the 0-100 scale', () => {
      expect(parseStructuredConfidence('0')).toBe(0);
      expect(parseStructuredConfidence('0%')).toBe(0);
      expect(parseStructuredConfidence('100')).toBe(100);
      expect(parseStructuredConfidence('100%')).toBe(100);
      expect(parseStructuredConfidence('85/100')).toBe(85);
    });

    it('returns null for missing or non-numeric confidence values', () => {
      expect(parseStructuredConfidence(undefined)).toBeNull();
      expect(parseStructuredConfidence('')).toBeNull();
      expect(parseStructuredConfidence('High confidence')).toBeNull();
    });
  });

  describe('parseStructuredResponse adversarial inputs', () => {
    it('returns null confidence for a structured response with a negative Confidence value', () => {
      const parsed = service.parseStructuredResponse(
        '**Recommendation**: Hold spend.\n**Confidence**: -95%',
      );

      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBeNull();
    });

    it('completes linearly (< 100ms) on a 50,000-digit adversarial input in list and confidence sections', () => {
      const longDigits = '1'.repeat(50_000);
      const adversarial = [
        `**Hidden Signals**: ${longDigits}`,
        `**Risk Check**: ${longDigits}`,
        `**Success Metrics**: ${longDigits}`,
        '**Recommendation**: Keep monitoring.',
        `**Confidence**: ${longDigits}`,
      ].join('\n');

      const startedAt = performance.now();
      const parsed = service.parseStructuredResponse(adversarial);
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(100);
      expect(parsed.state).toBe('sections');
      expect(parsed.confidence).toBeNull();
      expect(parsed.hiddenSignals).toHaveLength(1);
      expect(parsed.risks).toHaveLength(1);
      expect(parsed.successMetrics).toHaveLength(1);
    });
  });
});

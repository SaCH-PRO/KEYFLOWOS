/**
 * The thalamus — per-message effort grading on the shipped chat path.
 *
 * Two of these tests exist because an adversarial review caught the first draft
 * doing real damage, and neither failure is visible by reading the diff:
 *
 *  1. TASK CATEGORY. The draft routed reflex -> 'general' and analytical
 *     traffic -> 'analysis' for "cost savings". Reading model-gateway's routing
 *     table shows 'general' and 'tool-calling' are the SAME model (gpt-4o), so
 *     the saving was zero, while 'analysis' is gpt-4o-mini — a silent downgrade
 *     of the most valuable traffic — and 'emotion-analysis' has an Anthropic
 *     primary whose stream path never forwards `tools`, which would have made
 *     KEY answer warmly and perform no action. The category is now pinned.
 *
 *  2. A READER WITH NO WRITER. effortMultiplier and describeForPrompt were
 *     shipped against an endocrine system whose only `release` caller lives
 *     inside processConsciously — so for any business that never clicked Deep
 *     think, hormones were permanently empty and the whole subcortex returned
 *     neutral. That is this repo's recurring failure and it looks exactly like
 *     working code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdaptiveRouterService } from './adaptive-router.service';
import { CognitiveTriageService } from './cognitive-triage.service';

class EndocrineStub {
  released: Array<{ businessId: string; signals: Array<Record<string, unknown>> }> = [];
  multiplier = 1;
  description: string | null = null;

  release = vi.fn((businessId: string, signals: Array<Record<string, unknown>>) => {
    this.released.push({ businessId, signals });
  });
  effortMultiplier = vi.fn(() => this.multiplier);
  describeForPrompt = vi.fn(() => this.description);
}

class InteroceptionStub {
  body: Record<string, unknown> | null = null;
  senseBodyCalls = 0;

  peekBody = vi.fn(() => this.body);
  describeForPrompt = vi.fn(() => (this.body ? 'BODY: two organs degraded' : null));
  senseBody = vi.fn(() => {
    this.senseBodyCalls += 1;
    return Promise.resolve(this.body);
  });
}

function healthyBody() {
  return {
    businessId: 'biz_1',
    readings: [{ organName: 'crm', healthy: true }],
    healthyCount: 1,
    totalCount: 1,
    unreachableCount: 0,
    gaps: [],
    integrity: 1,
    sampledAt: new Date(),
  };
}

function degradedBody() {
  return {
    businessId: 'biz_1',
    readings: [
      { organName: 'crm', healthy: true },
      { organName: 'finance', healthy: false },
      { organName: 'calendar', healthy: false, unreachable: 'timeout' },
    ],
    healthyCount: 1,
    totalCount: 3,
    unreachableCount: 1,
    gaps: [],
    integrity: 1 / 3,
    sampledAt: new Date(),
  };
}

describe('CognitiveTriageService', () => {
  let endocrine: EndocrineStub;
  let intero: InteroceptionStub;
  let svc: CognitiveTriageService;

  beforeEach(() => {
    endocrine = new EndocrineStub();
    intero = new InteroceptionStub();
    svc = new CognitiveTriageService(
      new AdaptiveRouterService(),
      endocrine as never,
      intero as never,
    );
  });

  describe('the model tier is never rerouted', () => {
    // The single highest-regret finding. 'general' buys nothing, 'analysis'
    // downgrades to a mini model, 'emotion-analysis' loses tool calling.
    const MESSAGES = [
      'hi',
      'thanks',
      'what is my revenue this month',
      'why are we losing clients',
      'should we take the series a term sheet',
      'model the cash flow impact of hiring three people',
      'I am frustrated and stressed about the numbers',
      'is it worth raising prices next quarter',
    ];

    for (const m of MESSAGES) {
      it(`keeps tool-calling for: "${m}"`, () => {
        expect(svc.triage('biz_1', m).taskCategory).toBe('tool-calling');
      });
    }
  });

  describe('reflex is a whitelist, not a low score', () => {
    it('reflexes on greetings and acknowledgements', () => {
      for (const m of ['hi', 'hello', 'thanks', 'ok', 'bye']) {
        expect(svc.triage('biz_1', m).tier, m).toBe('reflex');
      }
    });

    it('never reflexes a real question, even a short one', () => {
      // A misclassified question answered in 400 tokens reads as broken in a
      // way a slow answer never does.
      for (const m of [
        'what is my revenue this month',
        'why are we losing clients',
        'send the invoice to Acme',
        'should we hire a second developer',
      ]) {
        expect(svc.triage('biz_1', m).tier, m).not.toBe('reflex');
      }
    });

    it('an attachment always floors the message out of reflex', () => {
      // "hi" plus a document is not a greeting.
      expect(svc.triage('biz_1', 'hi', true).tier).not.toBe('reflex');
    });
  });

  describe('deliberation fires on the queries worth deliberating over', () => {
    it('grades strategic decisions as deliberate', () => {
      // Measured against the real classifier, these ALL came back `moderate`
      // before the decisionMarkers fix, because complexMarkers carried
      // "how should" but not "should we" — so the thalamus would have shipped
      // and under-rated exactly the queries it exists for.
      for (const m of [
        'should we take the series a term sheet',
        'should we hire a second developer or outsource',
        'is it worth raising prices next quarter',
      ]) {
        expect(svc.triage('biz_1', m).tier, m).toBe('deliberate');
      }
    });

    it('gives deliberate more room than standard, and reflex less', () => {
      const reflex = svc.triage('biz_1', 'hi');
      const standard = svc.triage('biz_1', 'send the invoice to Acme');
      const deliberate = svc.triage('biz_1', 'should we take the series a term sheet');

      expect(reflex.maxTokens).toBeLessThan(standard.maxTokens);
      expect(deliberate.maxTokens).toBeGreaterThan(standard.maxTokens);
    });

    it('standard reproduces today’s hardcoded parameters exactly', () => {
      // An unclassified message must behave precisely as it does now.
      const v = svc.triage('biz_1', 'send the invoice to Acme');
      expect(v.tier).toBe('standard');
      expect(v.maxTokens).toBe(1000);
      expect(v.temperature).toBe(0.7);
    });
  });

  describe('the subcortex has a writer, not just a reader', () => {
    it('a degraded body releases malaise', () => {
      intero.body = degradedBody();
      svc.triage('biz_1', 'hi');

      expect(endocrine.release).toHaveBeenCalledTimes(1);
      const [signal] = endocrine.released[0].signals;
      expect(signal.hormone).toBe('malaise');
      expect(signal.magnitude).toBeCloseTo(2 / 3, 5);
    });

    it('names the failing organs as the reason', () => {
      // release() refuses an unexplained signal, so this is required, not nice.
      intero.body = degradedBody();
      svc.triage('biz_1', 'hi');

      const [signal] = endocrine.released[0].signals;
      expect(String(signal.reason)).toContain('finance');
      expect(String(signal.reason)).toContain('calendar');
    });

    it('a healthy body releases nothing', () => {
      intero.body = healthyBody();
      svc.triage('biz_1', 'hi');
      expect(endocrine.release).not.toHaveBeenCalled();
    });

    it('an unknown body releases nothing', () => {
      // peekBody returns null on a cache miss; absence of a reading is not
      // evidence of illness.
      intero.body = null;
      svc.triage('biz_1', 'hi');
      expect(endocrine.release).not.toHaveBeenCalled();
    });
  });

  describe('standing state reaches the prompt', () => {
    it('carries endocrine disposition through', () => {
      endocrine.description = 'STANDING CONTEXT — elevated cortisol';
      expect(svc.triage('biz_1', 'hi').standingContext).toContain('elevated cortisol');
    });

    it('is null when there is nothing to report', () => {
      // "All systems normal" on every message spends tokens to say nothing.
      expect(svc.triage('biz_1', 'hi').standingContext).toBeNull();
    });

    it('arousal from the endocrine system raises the effort score', () => {
      const calm = svc.triage('biz_1', 'send the invoice to Acme').score;
      endocrine.multiplier = 1.5;
      const stressed = svc.triage('biz_1', 'send the invoice to Acme').score;

      expect(stressed).toBeGreaterThan(calm);
    });
  });

  describe('it cannot break the chat', () => {
    it('falls back to today’s parameters when the router is missing', () => {
      const bare = new CognitiveTriageService();
      const v = bare.triage('biz_1', 'anything');

      expect(v.tier).toBe('standard');
      expect(v.taskCategory).toBe('tool-calling');
      expect(v.maxTokens).toBe(1000);
      expect(v.temperature).toBe(0.7);
    });

    it('survives an endocrine system that throws', () => {
      endocrine.effortMultiplier = vi.fn(() => {
        throw new Error('map corrupted');
      });
      expect(() => svc.triage('biz_1', 'hi')).not.toThrow();
    });

    it('survives interoception throwing', () => {
      intero.peekBody = vi.fn(() => {
        throw new Error('registrar down');
      });
      const v = svc.triage('biz_1', 'hi');
      expect(v.standingContext).toBeNull();
      expect(v.tier).toBe('reflex');
    });

    it('never awaits an organ poll — triage is synchronous by construction', () => {
      // senseBody polls every organ with a 3s timeout each. If triage could
      // await that, it would put seconds in front of every chat message. The
      // signature being sync is the guarantee.
      const v = svc.triage('biz_1', 'hi');
      expect(v).not.toBeInstanceOf(Promise);
      expect(intero.peekBody).toHaveBeenCalled();
      expect(intero.senseBody).not.toHaveBeenCalled();
    });
  });
});

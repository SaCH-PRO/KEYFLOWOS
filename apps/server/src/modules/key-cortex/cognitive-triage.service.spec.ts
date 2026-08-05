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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('the verdict actually reaches the model', () => {
  // MUTATION-PROVED GAP: an audit reverted BOTH gateway call sites to the
  // literals `maxTokens: 1000, temperature: 0.7` and all 25 triage tests stayed
  // green. Everything below this line tested a verdict that nothing consumed.
  //
  // Grading a message and then discarding the grade is this repo's signature
  // defect, and the thalamus had no guard against committing it.
  const orchestrator = readFileSync(
    join(__dirname, '..', 'ai', 'flow-orchestrator.service.ts'),
    'utf8',
  );

  it('both chat paths pass the triage token budget to the gateway', () => {
    const applied = orchestrator.match(/maxTokens: triage\?\.maxTokens \?\? 1000/g) ?? [];
    expect(applied.length, 'a chat path ignores the tier’s token budget').toBe(2);
  });

  it('both chat paths pass the triage temperature', () => {
    const applied = orchestrator.match(/temperature: triage\?\.temperature \?\? 0\.7/g) ?? [];
    expect(applied.length, 'a chat path ignores the tier’s temperature').toBe(2);
  });

  it('both chat paths append the standing context to the system prompt', () => {
    // THE SAME GAP, ONE FIELD OVER — and the more expensive one.
    //
    // When the mutation above proved maxTokens and temperature were unguarded,
    // the fix covered those two literals and stopped. standingContext travels
    // on the same verdict, through the same two call sites, and had no guard at
    // all. A second audit deleted both append blocks and 2765 tests stayed
    // green.
    //
    // What rides on this one hop: the endocrine disposition, interoception's
    // body state, the immune centre, salience's ranked concerns, business
    // epigenetics and the incentive frame. Six subsystems, each with its own
    // careful spec, every one of them terminating at these three lines. Delete
    // them and every one of those specs still passes while KEY silently stops
    // knowing anything it perceived.
    const applied = orchestrator.match(/systemPrompt \+= `\s*\n\s*\$\{triage\.standingContext\}`/g) ?? [];
    expect(applied.length, 'a chat path drops the standing context').toBe(2);
  });

  it('guards the standing context behind a presence check, not unconditionally', () => {
    // It is null unless there is genuinely something to report, and appending
    // an empty block every turn would break the cacheable prefix the prompt
    // work depends on.
    const guards = orchestrator.match(/if \(triage\?\.standingContext\) \{/g) ?? [];
    expect(guards.length).toBe(2);
  });

  it('neither gateway call reverts to a hardcoded budget', () => {
    // Scoped to the two trackAndComplete/trackAndStream argument objects.
    // A file-wide match is wrong here: `temperature: 0.7` legitimately appears
    // in other AI calls that triage does not govern, so asserting on the whole
    // file failed against correct code.
    for (const entry of ['trackAndComplete(', 'trackAndStream(']) {
      const i = orchestrator.indexOf(entry);
      expect(i, `${entry} not found`).toBeGreaterThan(-1);
      const args = orchestrator.slice(i, i + 1200);
      expect(args, `${entry} hardcodes maxTokens`).not.toMatch(/maxTokens: 1000,/);
      expect(args, `${entry} hardcodes temperature`).not.toMatch(/temperature: 0\.7,/);
    }
  });
});

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
    it('reflexes on greetings and sign-offs', () => {
      for (const m of ['hi', 'hello', 'thanks', 'thank you', 'bye']) {
        expect(svc.triage('biz_1', m).tier, m).toBe('reflex');
      }
    });

    it('the whitelist is an upper bound, not a guarantee', () => {
      // `yo`, `ty` and `cheers` are in isBareAcknowledgement's regex and have
      // never once reflexed: reflex also requires complexity === 'simple', and
      // the dimension classifier's simpleMarkers do not match them. Recorded
      // rather than fixed — the conservative direction is harmless, and someone
      // reading the regex would otherwise assume coverage it does not have.
      for (const m of ['yo', 'ty', 'cheers']) {
        expect(svc.triage('biz_1', m).tier, m).not.toBe('reflex');
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

    it('NEVER reflexes an action-bearing message that merely contains an ack', () => {
      // This shipped wrong. classifyComplexity's simpleMarkers regex matches
      // ANYWHERE, so `complexity === 'simple'` was true for all of these and
      // every one was answered on the cheapest tier at 400 tokens:
      //
      //   "ok delete that contact"   "ok cancel the booking"
      //   "hi can you refund them"   "no, remove that task"
      //
      // Destructive requests on the reflex tier, because they contain "ok".
      // The whitelist claim was only ever true if the WHOLE message is an
      // acknowledgement.
      for (const m of [
        'ok delete that contact',
        'yes send it',
        'ok cancel the booking',
        'hi can you refund them',
        'no, remove that task',
        'thanks, now delete the invoice',
      ]) {
        expect(svc.triage('biz_1', m).tier, `"${m}" reflexed`).not.toBe('reflex');
      }
    });

    it('still reflexes a genuine bare greeting', () => {
      for (const m of ['hi', 'hey', 'thanks!', 'thank you', 'bye', 'goodbye', 'hi thanks']) {
        expect(svc.triage('biz_1', m).tier, `"${m}" did not reflex`).toBe('reflex');
      }
    });

    it('NEVER reflexes a bare confirmation, because the reflex tier has no tools', () => {
      // A confirmation carries no meaning of its own — it means whatever KEY
      // asked on the previous turn. "Shall I send the invoice to Ada?" / "yes"
      // graded reflex, and the reflex tier sends `tools: undefined`, so the only
      // reply available to the model was one that CLAIMED a send it could not
      // perform.
      //
      // Rejections are here for the same reason in reverse: declining a pending
      // action is a cancellation, which is also a tool call.
      for (const m of ['yes', 'yep', 'ok', 'okay', 'k', 'no', 'nope', 'got it', 'perfect']) {
        expect(svc.triage('biz_1', m).tier, `"${m}" reflexed`).not.toBe('reflex');
      }
    });

    it('does not let a trailing pleasantry launder a confirmation', () => {
      // "ok thanks" reads as a sign-off and is also exactly how someone
      // approves a pending action. The optional-suffix group must not turn a
      // confirmation into a greeting.
      for (const m of ['ok thanks', 'yes please', 'ok please']) {
        expect(svc.triage('biz_1', m).tier, `"${m}" reflexed`).not.toBe('reflex');
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

  describe('triage READS the subcortex and never writes to it', () => {
    // It used to release malaise here, and that was wrong twice over.
    //
    // The push accumulated per CHAT MESSAGE rather than per observation.
    // peekBody serves one cached reading for 15 seconds, so a busy minute dosed
    // malaise from the SAME reading dozens of times — saturating the hormone on
    // traffic volume instead of on how long the organs had actually been
    // degraded. A hormone that responds to chattiness is not measuring the body.
    //
    // It also put an endocrine write, and therefore a database persist, on the
    // per-message request path.
    //
    // Body-driven malaise now belongs to the homeostasis loop, which samples on
    // a fixed 30-minute cadence, so one push means one half hour of degradation.
    it('does not release on a degraded body — that is the control loop’s job', () => {
      intero.body = degradedBody();
      svc.triage('biz_1', 'hi');

      expect(endocrine.release).not.toHaveBeenCalled();
    });

    it('does not release on a hundred messages either', () => {
      // The accumulation bug in one assertion: the old code would have dosed
      // malaise a hundred times from a single cached reading.
      intero.body = degradedBody();
      for (let i = 0; i < 100; i += 1) svc.triage('biz_1', 'hi');

      expect(endocrine.release).not.toHaveBeenCalled();
    });

    it('still READS disposition for the prompt', () => {
      // Reading is the whole point — only writing moved.
      endocrine.description = 'STANDING CONTEXT — elevated cortisol';
      expect(svc.triage('biz_1', 'hi').standingContext).toContain('elevated cortisol');
    });

    it('still reads body state into the prompt', () => {
      intero.body = degradedBody();
      expect(svc.triage('biz_1', 'hi').standingContext).toContain('organs degraded');
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

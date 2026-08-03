/**
 * One model call per reasoning mode.
 *
 * `runSingleMode` used to do this:
 *
 *     const response = await this.modelGateway.complete({ ...messages, 2500 });
 *     const chain = this.parseReasoningChain(response.content, ...);
 *     // Track usage
 *     try {
 *       await this.aiUsage.callAi({ ...same messages, same 2500... });
 *     } catch {}
 *     return chain;
 *
 * The second call reads as instrumentation and is not. `callAi` builds
 * `executeCall`, which invokes `gateway.complete`, and runs it
 * (ai-usage.service.ts) — so every mode paid for two 2500-token completions
 * and threw one away. processConsciously runs seven modes, which made Deep
 * think 14 completions for the reasoning step instead of 7.
 *
 * The empty `catch {}` also swallowed the ForbiddenException from checkCredits,
 * and since the REAL call went straight to the gateway and never checked
 * credits at all, the AI credit limit was unenforceable on this path.
 *
 * Both properties are pinned below. The cost one is invisible in a diff and
 * cannot be caught by typecheck, lint or any existing test — the only symptom
 * is the bill.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexReasoningEngineService } from './key-cortex-reasoning-engine.service';

const VALID_CHAIN = JSON.stringify({
  steps: [{ number: 1, thought: 'a', evidence: ['e'], confidence: 0.8 }],
  conclusion: 'c',
  supportingEvidence: ['s'],
  counterArguments: [],
  confidence: 0.8,
});

class AiUsageStub {
  trackAndComplete = vi.fn(() => Promise.resolve({ content: VALID_CHAIN }));
  callAi = vi.fn(() => Promise.resolve({ content: VALID_CHAIN }));
}

class ContextStub {
  getFullContext = vi.fn(() => Promise.reject(new Error('no context in test')));
  formatContextForPrompt = vi.fn(() => '');
}

function makeEngine(usage: AiUsageStub) {
  return new KeyCortexReasoningEngineService(usage as never, new ContextStub() as never);
}

describe('deliberation is graded, not fixed at maximum', () => {
  // reasonMultiModal has ALWAYS accepted a mode subset and every caller passed
  // none, so all seven modes fired on every Deep-think query — seven model
  // calls whether the question was "why are we losing clients" or "should we
  // sign this term sheet".
  //
  // That is why the thalamus could grade a message `deliberate` and then do
  // nothing but widen its token budget: routing to deliberation automatically
  // was unaffordable while its cost was fixed at maximum.
  const engine = new KeyCortexReasoningEngineService(
    new AiUsageStub() as never,
    new ContextStub() as never,
  );

  it('always includes analytical AND critical', () => {
    // Decomposing the problem and challenging the result are not optional for
    // any question worth deliberating over. A "cheap" set that could skip
    // criticism would produce confident, unchallenged answers — worse than a
    // shallow one.
    for (const q of ['what should we do', 'hi', 'should we raise prices']) {
      const modes = engine.selectModes(q);
      expect(modes, q).toContain('analytical');
      expect(modes, q).toContain('critical');
    }
  });

  it('a plain question costs the minimum', () => {
    expect(engine.selectModes('what is our revenue this month')).toHaveLength(2);
  });

  it('earns strategic depth only when the question is strategic', () => {
    expect(engine.selectModes('what is our revenue')).not.toContain('strategic');
    expect(engine.selectModes('how should we position against our competitor')).toContain(
      'strategic',
    );
  });

  it('earns probabilistic reasoning for questions about risk and forecast', () => {
    expect(engine.selectModes('what is the risk of losing this client')).toContain(
      'probabilistic',
    );
  });

  it('earns counterfactual reasoning for "what if"', () => {
    expect(engine.selectModes('what if we had raised prices last year')).toContain(
      'counterfactual',
    );
  });

  it('never exceeds the full set', () => {
    const modes = engine.selectModes(
      'what if we compare our long-term strategy risk to other companies with new ideas',
    );
    expect(modes.length).toBeLessThanOrEqual(7);
    expect(new Set(modes).size, 'duplicate modes').toBe(modes.length);
  });

  it('costs zero model calls to decide', () => {
    // Selecting modes must be cheaper than the modes themselves, or the
    // optimisation is self-defeating.
    const usage = new AiUsageStub();
    const e = new KeyCortexReasoningEngineService(usage as never, new ContextStub() as never);

    e.selectModes('should we take the series a term sheet');
    expect(usage.trackAndComplete).not.toHaveBeenCalled();
  });

  it('processConsciously ACTUALLY passes the subset', async () => {
    // The compute-and-discard guard. selectModes could be perfect and unused,
    // which is this repo's signature defect and has already happened twice
    // today.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex-consciousness.service.ts'), 'utf8');

    expect(src).toMatch(/const selectedModes = this\.reasoning\.selectModes\(query\)/);
    expect(src).toMatch(/reasonMultiModal\(\s*query,\s*reasoningContext,\s*selectedModes,/);
  });
});

describe('reasoning cost', () => {
  let usage: AiUsageStub;
  let engine: KeyCortexReasoningEngineService;

  beforeEach(() => {
    usage = new AiUsageStub();
    engine = makeEngine(usage);
  });

  it('makes exactly ONE model call per reasoning mode', async () => {
    await engine.reasonMultiModal('should we raise prices', { businessId: 'biz_1' }, [
      'analytical',
    ]);

    const calls = usage.trackAndComplete.mock.calls.length + usage.callAi.mock.calls.length;
    expect(calls).toBe(1);
  });

  it('scales one-for-one with the number of modes', async () => {
    // The whole point of the availableModes subset is that asking for fewer
    // modes costs proportionally less. A duplicated call breaks that ratio
    // silently.
    await engine.reasonMultiModal('should we raise prices', { businessId: 'biz_1' }, [
      'analytical',
      'critical',
      'strategic',
    ]);

    const calls = usage.trackAndComplete.mock.calls.length + usage.callAi.mock.calls.length;
    expect(calls).toBe(3);
  });

  it('never calls callAi — it is a second completion, not a recorder', async () => {
    await engine.reasonMultiModal('x', { businessId: 'biz_1' }, ['analytical']);
    expect(usage.callAi).not.toHaveBeenCalled();
  });

  it('routes through trackAndComplete, so credits are actually checked', async () => {
    // checkCredits lives inside trackAndComplete. Calling the gateway directly
    // bypassed it entirely.
    await engine.reasonMultiModal('x', { businessId: 'biz_1' }, ['analytical']);

    expect(usage.trackAndComplete).toHaveBeenCalledTimes(1);
    const [businessId, , feature] = usage.trackAndComplete.mock.calls[0] as unknown as [
      string,
      undefined,
      string,
    ];
    expect(businessId).toBe('biz_1');
    expect(feature).toBe('reasoning_engine');
  });

  it('a mode refused for credit reasons degrades that mode, not the pipeline', async () => {
    // reasonMultiModal uses Promise.allSettled and, for a mode that failed,
    // pushes a low-confidence fallback chain rather than dropping it — so
    // synthesis still runs and the shortfall is visible in the output instead
    // of silently shrinking the chain count. Enforcing credits here therefore
    // costs one mode's quality, not the answer.
    usage.trackAndComplete
      .mockRejectedValueOnce(new Error('AI credit limit reached'))
      .mockResolvedValue({ content: VALID_CHAIN });

    const result = await engine.reasonMultiModal('x', { businessId: 'biz_1' }, [
      'analytical',
      'critical',
    ]);

    expect(result.chains).toHaveLength(2);

    const refused = result.chains.filter((c) => c.confidence <= 0.1);
    expect(refused).toHaveLength(1);
    expect(refused[0].counterArguments.join(' ')).toContain('credit limit');

    // The surviving mode is still the one that answers.
    expect(result.bestChain.confidence).toBeGreaterThan(0.1);
  });
});

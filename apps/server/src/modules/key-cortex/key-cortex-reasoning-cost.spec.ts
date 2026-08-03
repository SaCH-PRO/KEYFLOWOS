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

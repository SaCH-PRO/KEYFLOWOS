/**
 * Escalation — the thalamus finally routing to real deliberation.
 *
 * It has been able to grade a message `deliberate` since it was built, and all
 * that ever did was widen the token budget. Two things blocked routing to the
 * cortex; only one is left:
 *
 *   COST — fixed. reasonMultiModal fired all seven modes on every query because
 *   no caller passed a subset. processConsciously now selects modes.
 *
 *   HANDS — still real. processConsciously injects the eight cognition layers
 *   and NO executor. It returns `actions` as PROPOSALS, never executions.
 *
 * So the action-intent guard is not a nicety. Routing "send the invoice to
 * Acme" to a pipeline with no hands produces excellent reasoning and performs
 * nothing — a failure that looks exactly like success. If one assertion in this
 * file survives review, it is that one.
 *
 * The second property is survivability: a null from deliberate() must leave the
 * fast path completely unaffected. Losing a user's message to a failed attempt
 * at thinking harder would be far worse than answering it shallowly.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';

const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

/** Runs the real guard against a stub instance. */
function shouldDeliberate(
  tier: string | undefined,
  message: string,
  hasAttachments = false,
): boolean {
  const impl = (
    FlowOrchestratorService.prototype as unknown as Record<
      string,
      (t: unknown, m: string, a: boolean) => boolean
    >
  ).shouldDeliberate;
  return impl.call({}, tier ? { tier } : null, message, hasAttachments);
}

describe('the action guard — the one that matters', () => {
  const ACTION_BEARING = [
    'create an invoice for Acme and send it',
    'schedule a call with the client next week',
    'update the pricing on our top product',
    'draft a proposal for the new market',
    'delete the duplicate contacts',
    'send the payment reminder',
    'book them in for Thursday',
    'generate the quarterly report',
  ];

  for (const message of ACTION_BEARING) {
    it(`refuses to deliberate: "${message.slice(0, 40)}"`, () => {
      // These must stay on the tool path. Deliberating them would reason
      // beautifully and perform nothing.
      expect(shouldDeliberate('deliberate', message)).toBe(false);
    });
  }

  it('allows a genuine judgement question', () => {
    expect(
      shouldDeliberate('deliberate', 'should we take the series a term sheet'),
    ).toBe(true);
    expect(shouldDeliberate('deliberate', 'why are we losing clients')).toBe(true);
  });

  it('never escalates below the deliberate tier', () => {
    expect(shouldDeliberate('reflex', 'why are we losing clients')).toBe(false);
    expect(shouldDeliberate('standard', 'why are we losing clients')).toBe(false);
    expect(shouldDeliberate(undefined, 'why are we losing clients')).toBe(false);
  });

  it('never escalates a message with an attachment', () => {
    // An attachment is something to act on, and the vision path lives on the
    // fast route.
    expect(shouldDeliberate('deliberate', 'what do you make of this', true)).toBe(false);
  });
});

describe('failure is always survivable', () => {
  it('deliberate() returns null rather than throwing', async () => {
    const impl = (
      FlowOrchestratorService.prototype as unknown as Record<
        string,
        (b: string, m: string, h: unknown[]) => Promise<unknown>
      >
    ).deliberate;

    const instance = {
      moduleRef: {
        get: () => {
          throw new Error('cortex unavailable');
        },
      },
      logger: { warn: vi.fn() },
    };

    await expect(impl.call(instance, 'biz_1', 'q', [])).resolves.toBeNull();
  });

  it('an empty answer is treated as no answer', async () => {
    // A cortex that returns whitespace must fall back, not emit a blank reply.
    const impl = (
      FlowOrchestratorService.prototype as unknown as Record<
        string,
        (b: string, m: string, h: unknown[]) => Promise<unknown>
      >
    ).deliberate;

    const instance = {
      moduleRef: {
        get: () => ({ processConsciously: () => Promise.resolve({ text: '   ', actions: [] }) }),
      },
      logger: { warn: vi.fn() },
    };

    await expect(impl.call(instance, 'biz_1', 'q', [])).resolves.toBeNull();
  });

  it('the caller falls through to the fast path on null', () => {
    // Structural: the escalation block must be a guarded early-return, not a
    // replacement for the normal path.
    const block = src.slice(src.indexOf('if (this.shouldDeliberate('));
    const body = block.slice(0, block.indexOf('\n    try {'));

    expect(body).toMatch(/if \(deliberation\) \{/);
    expect(body).toMatch(/return;/);
  });
});

describe('the escalated turn is a complete turn', () => {
  const block = (() => {
    const i = src.indexOf('if (this.shouldDeliberate(');
    return src.slice(i, src.indexOf('\n    try {', i));
  })();

  it('emits the answer as content', () => {
    expect(block).toMatch(/type: 'content_delta', content: deliberation\.text/);
  });

  it('closes the stream', () => {
    // Without a done chunk the client waits forever.
    expect(block).toMatch(/type: 'done', sessionId: effectiveSessionId/);
  });

  it('persists the exchange so the next turn has context', () => {
    expect(block).toMatch(/saveConversationHistory\(/);
  });

  it('persists with the arguments in the RIGHT ORDER', () => {
    // saveConversationHistory(businessId, sessionId, messages). Both are
    // strings, so reversing them typechecks cleanly and silently writes the
    // session under a swapped id and tenant. It WAS reversed in the first
    // draft of this block and tsc said nothing.
    expect(block).toMatch(/saveConversationHistory\(businessId, effectiveSessionId,/);
  });

  it('shows progress rather than going silent', () => {
    // A slow think with no output reads as a hang.
    expect(block).toMatch(/type: 'thinking'/);
  });

  it('a failed save cannot lose the answer', () => {
    expect(block).toMatch(/\.catch\(\(\) => undefined\)/);
  });
});

/**
 * The words a business forbade must actually cost something when used.
 *
 * `BusinessBlueprint.brand.doNotSay` invites an operator to declare language KEY
 * must never use. `detectValueConflict` has existed to check it since it was
 * written, with ZERO callers — so the invitation created an expectation nothing
 * honoured. KEY is now also told about the terms in its prompt, but a prompt
 * instruction is guidance, not enforcement.
 *
 * WHAT IS HONESTLY POSSIBLE. The chat streams token by token: by the time a
 * forbidden word exists it has been sent, and no post-hoc check unsays it.
 * Buffering the whole reply to screen it first would put full generation latency
 * in front of the first token — trading a rare wording slip for a guaranteed
 * worse experience on every message.
 *
 * So this does not block. It LEARNS: a violation writes an AiMemory
 * `learned_corrections` row, which buildContextBlock already renders into the
 * next prompt under "Lessons from past failures". The instruction gets stronger
 * and more specific exactly when it has been ignored.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';

const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const code = src
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
  .join('\n');

/** Runs the real method against a stub instance. */
function enforce(instance: unknown, businessId: string, text: string): Promise<void> {
  const impl = (
    FlowOrchestratorService.prototype as unknown as Record<
      string,
      (b: string, t: string) => Promise<void>
    >
  ).enforceDoNotSay;
  return impl.call(instance, businessId, text);
}

function makeInstance(terms: string[]) {
  const upserts: any[] = [];
  const personality = {
    detectValueConflict: vi.fn(async () => ({ conflict: terms.length > 0, terms })),
  };
  const memory = { upsert: vi.fn(async (b: string, e: any) => upserts.push({ b, ...e })) };
  return {
    upserts,
    personality,
    instance: {
      moduleRef: {
        get: (token: any) =>
          String(token?.name ?? token).includes('Personality') ? personality : memory,
      },
      logger: { warn: vi.fn(), debug: vi.fn() },
    },
  };
}

describe('a violation becomes a lesson', () => {
  it('records a correction when a forbidden term is used', async () => {
    const { upserts, instance } = makeInstance(['synergy']);
    await enforce(instance, 'biz_1', 'This creates real synergy across teams.');

    expect(upserts).toHaveLength(1);
    expect(upserts[0].category).toBe('learned_corrections');
  });

  it('writes it where the next prompt will actually read it', async () => {
    // ai-memory.service.ts has a `case 'learned_corrections'` that parses
    // `learnedPattern` and renders it. A category with no case is written and
    // silently dropped - the exact defect this repo keeps reproducing.
    const { upserts, instance } = makeInstance(['synergy']);
    await enforce(instance, 'biz_1', 'synergy');

    const value = JSON.parse(upserts[0].value);
    expect(value.learnedPattern).toBeTruthy();
    expect(value.learnedPattern).toMatch(/synergy/);
  });

  it('names the term so the lesson is specific, not a vague scolding', async () => {
    const { upserts, instance } = makeInstance(['synergy', 'leverage']);
    await enforce(instance, 'biz_1', 'synergy and leverage');

    const value = JSON.parse(upserts[0].value);
    expect(value.learnedPattern).toMatch(/"synergy"/);
    expect(value.learnedPattern).toMatch(/"leverage"/);
  });

  it('keys on the terms, so repeating a slip refreshes one row', async () => {
    // Keyed on the message, thousands of near-identical rows would accumulate
    // and crowd out every other lesson.
    const a = makeInstance(['synergy']);
    await enforce(a.instance, 'biz_1', 'synergy here');
    const b = makeInstance(['synergy']);
    await enforce(b.instance, 'biz_1', 'and synergy there, quite differently worded');

    expect(a.upserts[0].key).toBe(b.upserts[0].key);
  });

  it('treats the same terms in any order as one lesson', async () => {
    const a = makeInstance(['synergy', 'leverage']);
    await enforce(a.instance, 'biz_1', 'x');
    const b = makeInstance(['leverage', 'synergy']);
    await enforce(b.instance, 'biz_1', 'x');

    expect(a.upserts[0].key).toBe(b.upserts[0].key);
  });

  it('expires, so an old slip does not scold forever', async () => {
    const { upserts, instance } = makeInstance(['synergy']);
    await enforce(instance, 'biz_1', 'synergy');

    expect(upserts[0].expiresAt).toBeInstanceOf(Date);
  });
});

describe('it stays out of the way', () => {
  it('writes nothing when the reply is clean', async () => {
    const { upserts, instance } = makeInstance([]);
    await enforce(instance, 'biz_1', 'A perfectly ordinary answer.');

    expect(upserts).toHaveLength(0);
  });

  it('writes nothing for an empty reply', async () => {
    const { personality, instance } = makeInstance(['synergy']);
    await enforce(instance, 'biz_1', '   ');

    expect(personality.detectValueConflict).not.toHaveBeenCalled();
  });

  it('never throws — the user already has their answer', async () => {
    const broken = {
      moduleRef: { get: () => { throw new Error('not available'); } },
      logger: { warn: vi.fn(), debug: vi.fn() },
    };
    await expect(enforce(broken, 'biz_1', 'synergy')).resolves.toBeUndefined();
  });

  it('is fire-and-forget at both call sites, so it cannot delay a reply', () => {
    const calls = [...code.matchAll(/this\.enforceDoNotSay\(/g)];
    expect(calls.length).toBe(2);
    // `void` rather than `await`: this runs after the answer is already sent.
    expect(code).not.toMatch(/await this\.enforceDoNotSay\(/);
    expect((code.match(/void this\.enforceDoNotSay\(/g) ?? []).length).toBe(2);
  });
});

describe('it is wired to both chat paths', () => {
  it('runs after the non-streaming reply is persisted', () => {
    const block = code.slice(code.indexOf('sessionMessages.push(assistantMessage);'));
    expect(block.slice(0, 400)).toMatch(/enforceDoNotSay\(businessId/);
  });

  it('runs on the deliberation path too', () => {
    const block = code.slice(code.indexOf('yield { type: \'content_delta\', content: deliberation.text }'));
    expect(block.slice(0, 800)).toMatch(/enforceDoNotSay\(businessId, deliberation\.text\)/);
  });

  it('uses a MemorySource the type actually permits', () => {
    // 'value_conflict' was the obvious name and is not in the union; tsc caught
    // it. feedback_loop is true here - this IS a correction derived from
    // observing our own output against a declared rule.
    const fn = code.slice(code.indexOf('private async enforceDoNotSay('));
    expect(fn.slice(0, 3000)).toMatch(/source: 'feedback_loop'/);
  });
});

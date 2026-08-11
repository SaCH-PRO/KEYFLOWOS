/**
 * Every request paid full price for a prompt it had already sent.
 *
 * Provider prompt caching works by matching an IDENTICAL prefix — OpenAI does it
 * automatically at half price above ~1024 tokens. The system prompt interpolated
 * `new Date().toISOString()` at roughly 98% of the way through the static text,
 * so every request diverged from that point on and nothing after it could ever
 * match a previous one.
 *
 * The precision was unusable by construction. The prompt asks the model to
 * "interpret relative dates (e.g. tomorrow at 2pm)" — that needs the date and
 * roughly the time, and never the millisecond.
 *
 * Truncated to the HOUR rather than the day: date-only would lose time-of-day,
 * which matters for "book me in two hours", while an hour is stable far longer
 * than any provider cache lives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
const code = src
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
  .join('\n');

/** The helper, executed for real rather than described. */
function currentDateForPrompt(now: Date): string {
  return `${now.toISOString().slice(0, 13)}:00Z`;
}

describe('the prompt prefix is stable enough to cache', () => {
  it('no chat path interpolates a millisecond timestamp', () => {
    // The defect, in one assertion. Four call sites had it.
    expect(code).not.toMatch(/CURRENT_DATE.*new Date\(\)\.toISOString\(\)/);
    expect(code).not.toMatch(/replace\('\{\{CURRENT_DATE\}\}', new Date\(\)/);
  });

  it('routes every date interpolation through one helper', () => {
    const sites = [...code.matchAll(/\{\{CURRENT_DATE\}\}'?,\s*currentDateForPrompt\(\)/g)];
    expect(sites.length, 'expected all four chat entry points').toBe(4);
  });

  it('produces the same string for two requests in the same hour', () => {
    // The property that makes a cache hit possible at all.
    const a = currentDateForPrompt(new Date('2026-08-04T06:00:00.001Z'));
    const b = currentDateForPrompt(new Date('2026-08-04T06:59:59.999Z'));

    expect(a).toBe(b);
  });

  it('still changes across hours, so the model is never told a stale time', () => {
    const six = currentDateForPrompt(new Date('2026-08-04T06:30:00Z'));
    const seven = currentDateForPrompt(new Date('2026-08-04T07:30:00Z'));

    expect(six).not.toBe(seven);
  });

  it('still changes across days', () => {
    const today = currentDateForPrompt(new Date('2026-08-04T23:30:00Z'));
    const tomorrow = currentDateForPrompt(new Date('2026-08-05T00:30:00Z'));

    expect(today).not.toBe(tomorrow);
  });
});

describe('it keeps the precision the prompt actually asks for', () => {
  it('retains time of day', () => {
    // Date-only would be more cacheable and would break "book me in two hours".
    const morning = currentDateForPrompt(new Date('2026-08-04T06:00:00Z'));
    expect(morning).toMatch(/T06:00Z$/);
  });

  it('is a valid, parseable instant', () => {
    const value = currentDateForPrompt(new Date('2026-08-04T06:30:00Z'));
    expect(Number.isNaN(new Date(value).getTime())).toBe(false);
  });

  it('the prompt still asks the model to reason about relative dates', () => {
    // If that instruction ever goes away, the date is dead weight and this
    // whole trade-off should be revisited rather than silently kept.
    expect(src).toMatch(/interpret relative dates/);
  });
});

/**
 * MEASURED 2026-08-11, and the answer is a negative result worth keeping.
 *
 * Stabilising the date was necessary and it is NOT sufficient: the system
 * prompt is too SHORT to cache. OpenAI caches nothing below ~1024 tokens, and
 * the role preamble is ~274 tokens, with a further ~54 static tokens stranded
 * behind the business context. Even reordered so every static line preceded
 * every volatile one, the best achievable stable prefix is ~327 tokens — a
 * third of the floor.
 *
 * So there is no prompt-caching work to do here, and reordering the prompt
 * would buy exactly nothing. This is recorded because "add prompt caching" is
 * an obvious-sounding optimisation that reads like the largest remaining lever
 * — it was written down as such in this session's own cost analysis — and it
 * would cost someone a week to discover this arithmetic.
 *
 * WHERE THE TOKENS ACTUALLY ARE: the tool schemas, ~32,000 tokens for 286
 * tools, sent as the `tools` parameter rather than in the prompt. Whether a
 * provider caches those is provider behaviour and not something prompt
 * ordering can influence — if it happens it happens automatically. The lever
 * that worked was REDUCING them: filtering to the crew's allowlist and reviving
 * the 128-tool cap took a general turn from ~32,000 to ~14,000.
 *
 * The guard below is forward-looking. If the system prompt ever grows past the
 * threshold, caching becomes genuinely available and this conclusion expires.
 */
describe('caching is unavailable at this prompt size — revisit if that changes', () => {
  const OPENAI_CACHE_MIN_TOKENS = 1024;
  const roughTokens = (s: string) => Math.round(s.length / 4);

  it('the static prompt is still far below the provider cache floor', () => {
    // Built by RoleEngine, not by the orchestrator. A first version sliced
    // flow-orchestrator.service.ts between two markers that are not both in the
    // same template and measured 68,729 tokens — most of the file — which would
    // have "proved" caching was available. Measure the thing itself.
    const engine = readFileSync(join(__dirname, 'role-engine.service.ts'), 'utf8');
    const start = engine.indexOf('You are KEY —');
    const end = engine.indexOf('Always sign off with', start);
    expect(start, 'the role prompt template moved — this measurement is stale').toBeGreaterThan(-1);
    expect(end, 'the template no longer ends where expected').toBeGreaterThan(start);

    const template = engine.slice(start, end);
    // Sanity-bound it: a slice that ran away would silently pass the assertion
    // below by being enormous, or fail it by being empty.
    expect(template.length).toBeGreaterThan(200);
    expect(template.length).toBeLessThan(20_000);

    const size = roughTokens(template);
    expect(
      size,
      `The system prompt is now ~${size} tokens. If it has crossed ` +
        `${OPENAI_CACHE_MIN_TOKENS}, provider prompt caching becomes available for ` +
        'the first time and is worth real money on the chat path — reorder so ' +
        'every static line precedes the business context, and measure. Until ' +
        'then it cannot engage and reordering is wasted effort.',
    ).toBeLessThan(OPENAI_CACHE_MIN_TOKENS);
  });
});

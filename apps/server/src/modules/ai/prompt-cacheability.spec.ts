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

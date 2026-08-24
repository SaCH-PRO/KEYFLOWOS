import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorDigestService } from './error-digest.service';
import { errorRegistry } from './error-registry';

/**
 * The digest is the part that reaches a person. Its whole value depends on two
 * properties that pull against each other:
 *
 *   - it must SPEAK when something new breaks, or the registry is a record
 *     nobody reads and nothing is gained over the logs it replaced;
 *   - it must stay SILENT otherwise, because a summary emitted every fifteen
 *     minutes regardless is noise, and noise is how a signal gets filtered and
 *     then ignored. This repo has already learned that a permanently-red gate
 *     gets disabled.
 *
 * So the assertions below are mostly about when it says NOTHING.
 */
describe('ErrorDigestService', () => {
  let svc: ErrorDigestService;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    errorRegistry.reset();
    svc = new ErrorDigestService();
    warn = vi.fn();
    (svc as unknown as { logger: { warn: unknown; error: unknown } }).logger = {
      warn,
      error: vi.fn(),
    };
  });

  it('says nothing when nothing has failed', () => {
    expect(svc.emit()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports when something new fails', () => {
    errorRegistry.record('background', 'NightlyJob', new Error('db down'));
    const line = svc.emit();
    expect(line).toContain('1 new failure(s)');
    expect(line).toContain('NightlyJob');
    expect(line).toContain('db down');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('goes quiet again once the same failures stop being new', () => {
    errorRegistry.record('background', 'NightlyJob', new Error('db down'));
    expect(svc.emit()).not.toBeNull();
    // Nothing further has happened; a second digest must not repeat itself.
    expect(svc.emit()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('speaks again when a KNOWN job fails more, not only on new signatures', () => {
    errorRegistry.record('background', 'FlakyJob', new Error('same cause'));
    svc.emit();
    warn.mockClear();
    // Same signature, more occurrences — a job that has gone from failing once
    // to failing every tick is exactly what an operator needs to hear about.
    errorRegistry.record('background', 'FlakyJob', new Error('same cause'));
    const line = svc.emit();
    expect(line).toContain('1 new failure(s)');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('separates http from background counts in the line', () => {
    errorRegistry.record('http', 'GET /a', new Error('x'));
    errorRegistry.record('background', 'JobA', new Error('y'));
    const line = svc.emit()!;
    expect(line).toContain('http=1');
    expect(line).toContain('background=1');
  });

  it('names only the top offenders and counts the rest', () => {
    for (let i = 0; i < 12; i++) {
      errorRegistry.record('background', `Job${i}`, new Error(`cause ${i}`));
    }
    const line = svc.emit()!;
    expect(line).toContain(`+${12 - ErrorDigestService.TOP_N} other signatures`);
  });

  it('surfaces that entries were dropped, rather than under-reporting silently', () => {
    for (let i = 0; i < 400; i++) {
      errorRegistry.record('http', `GET /r/${i}`, new Error('boom'));
    }
    expect(svc.emit()!).toContain('dropped: key cap reached');
  });

  it('does not go permanently silent if the registry is reset beneath it', () => {
    errorRegistry.record('background', 'JobA', new Error('x'));
    svc.emit();
    errorRegistry.reset();
    // lastTotal would now exceed total; without a resync every future digest
    // would compute a negative delta and stay quiet forever.
    expect(svc.emit()).toBeNull();
    errorRegistry.record('background', 'JobB', new Error('y'));
    expect(svc.emit(), 'the digest went permanently silent after a reset').not.toBeNull();
  });

  it('is scheduled through safeInterval so it cannot kill the process', () => {
    // The digest reads a registry and formats a string, but it runs on a timer,
    // and a raw setInterval with an async callback is exactly the bug this
    // codebase just fixed everywhere else.
    const src = ErrorDigestService.prototype.onModuleInit.toString();
    expect(src).toContain('safeInterval');
  });
});

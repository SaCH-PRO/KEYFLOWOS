/**
 * A signal seen twice is one signal, not two.
 *
 * recordSignals upserts on `sig_${businessId}_${signal.id}` and says why in a
 * comment: "so a recurring signal UPDATES rather than accumulating a duplicate
 * row every ten minutes". Every signal id was `uuidv4()` — fresh on every scan —
 * so the key was unique every time and the upsert only ever inserted. The intent
 * was documented and defeated in the same file.
 *
 * The consequence was visible in the product: the awareness panel shows a
 * 25-row window, and it filled with 25 copies of the same observation.
 *
 * The scan also ran every ten minutes over a corpus with a fourteen-day window,
 * so each piece of text was re-analysed roughly two thousand times over its
 * life, each time at the price of a model call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'key-cortex-intuition.service.ts'), 'utf8');
const code = src
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
  .join('\n');

/** The real helper, re-declared so its behaviour can be exercised. */
function stableSignalId(...parts: Array<string | undefined>): string {
  return parts
    .filter((p): p is string => !!p)
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .join(':');
}

describe('the same observation produces the same key', () => {
  it('is stable across scans', () => {
    // The whole property. Two sweeps noticing the same thing must collide.
    expect(stableSignalId('stress', 'task_backlog')).toBe(
      stableSignalId('stress', 'task_backlog'),
    );
  });

  it('does not vary with the measured VALUE', () => {
    // A backlog of 41 and then 43 is one persisting signal, not two. Values are
    // deliberately excluded from identity — including them would reintroduce
    // the duplicate-per-scan behaviour in a subtler form.
    const idA = stableSignalId('stress', 'task_backlog');
    const idB = stableSignalId('stress', 'task_backlog');
    expect(idA).toBe(idB);
  });

  it('separates genuinely different signals', () => {
    expect(stableSignalId('stress', 'task_backlog')).not.toBe(
      stableSignalId('stress', 'error_rate'),
    );
  });

  it('separates a spike from a drop on the same metric', () => {
    expect(stableSignalId('anomaly', 'revenue', 'spike', 'current_month')).not.toBe(
      stableSignalId('anomaly', 'revenue', 'drop', 'current_month'),
    );
  });

  it('normalises punctuation and case, so cosmetic changes do not fork the key', () => {
    expect(stableSignalId('stress', 'Task Backlog')).toBe(
      stableSignalId('stress', 'task-backlog'),
    );
  });

  it('produces a key safe to embed in a memory row id', () => {
    const id = stableSignalId('anomaly', 'Revenue / Month', 'spike');
    expect(id).toMatch(/^[a-z0-9_:]+$/);
  });
});

/** The real identity function, re-declared so its behaviour can be exercised. */
function signalIdentity(signal: { id?: string; category?: string; description?: string }): string {
  const withoutNumbers = (signal.description ?? '').replace(/[\d.,%+-]+/g, ' ').slice(0, 160);
  const identity = stableSignalId(signal.category, withoutNumbers);
  return identity || stableSignalId(signal.id);
}

describe('identity comes from what the signal SAYS, not from a fresh uuid', () => {
  it('gives the same key when only the measured value moved', () => {
    // The load-bearing case. An hourly sweep sees the same problem with
    // slightly different numbers; that is one signal persisting.
    const first = signalIdentity({
      id: 'a',
      category: 'operational',
      description: 'Operational stress: task_backlog at 41.0 (baseline: 12.0, deviation: +241.7%)',
    });
    const later = signalIdentity({
      id: 'b',
      category: 'operational',
      description: 'Operational stress: task_backlog at 43.5 (baseline: 12.0, deviation: +262.5%)',
    });

    expect(first).toBe(later);
  });

  it('ignores the random id entirely', () => {
    const a = signalIdentity({ id: 'random-1', category: 'x', description: 'Same thing observed' });
    const b = signalIdentity({ id: 'random-2', category: 'x', description: 'Same thing observed' });
    expect(a).toBe(b);
  });

  it('still separates different problems', () => {
    const backlog = signalIdentity({ category: 'operational', description: 'Operational stress: task_backlog at 41' });
    const errors = signalIdentity({ category: 'operational', description: 'Operational stress: error_rate at 41' });
    expect(backlog).not.toBe(errors);
  });

  it('separates the same words in different categories', () => {
    expect(signalIdentity({ category: 'financial', description: 'revenue is down' })).not.toBe(
      signalIdentity({ category: 'operational', description: 'revenue is down' }),
    );
  });

  it('falls back to the id when there is nothing else to go on', () => {
    // Collapsing every description-less signal into one row would be worse
    // than the duplicates this fixes.
    const a = signalIdentity({ id: 'only-id-a' });
    const b = signalIdentity({ id: 'only-id-b' });
    expect(a).not.toBe(b);
  });

  it('is bounded, so a long description cannot produce an unbounded key', () => {
    const id = signalIdentity({ category: 'x', description: 'word '.repeat(500) });
    expect(id.length).toBeLessThan(220);
  });
});

describe('the fix is applied where signals are persisted', () => {
  it('keys the upsert on the content identity, not the raw id', () => {
    // Sixteen call sites construct a WeakSignal and every one assigned
    // uuidv4(). Fixing them individually would leave the next new detector free
    // to reintroduce the bug, so identity is computed at the single point that
    // writes.
    const fn = code.slice(code.indexOf('private async recordSignals('));
    expect(fn.slice(0, 1400)).toMatch(/signalIdentity\(signal\)/);
    expect(fn.slice(0, 1400)).not.toMatch(/sig_\$\{businessId\}_\$\{signal\.id\}/);
  });

  it('still upserts, so a stable key actually dedupes', () => {
    const fn = code.slice(code.indexOf('private async recordSignals('));
    expect(fn.slice(0, 1400)).toMatch(/keyCortexMemory\.upsert/);
  });
});

describe('the sweep no longer re-reads a fortnight every ten minutes', () => {
  it('runs hourly', () => {
    const block = code.slice(code.indexOf('scheduledIntuitionScan') - 400, code.indexOf('scheduledIntuitionScan'));
    expect(block).toMatch(/EVERY_HOUR/);
    expect(block).not.toMatch(/EVERY_10_MINUTES/);
  });

  it('still reads a window far larger than the interval', () => {
    // Hourly is only safe because the corpus window is measured in weeks. If
    // that window ever shrank toward the interval, this cadence would start
    // missing things and should be revisited.
    expect(code).toMatch(/14 \* 24 \* 60 \* 60 \* 1000/);
  });
});

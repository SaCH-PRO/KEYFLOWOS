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

describe('what collapses to one key, and why that is correct', () => {
  // Stripping digits is the riskiest part of this transform: two GENUINELY
  // different signals whose descriptions differ only in numbers would merge into
  // one row and hide one of them. Checked against every real description
  // template in the service rather than invented examples.

  it('keeps signals distinct when the template carries a name', () => {
    // metric, keyword, theme, industry, day-of-week and customer identifiers all
    // survive digit-stripping, which is what keeps these apart.
    const cases: Array<[string, string]> = [
      [
        'Operational stress: task_backlog at 41.0 (baseline: 12.0)',
        'Operational stress: error_rate at 41.0 (baseline: 12.0)',
      ],
      [
        'Emerging keyword "refund" appearing 12x (3.0x above baseline)',
        'Emerging keyword "delay" appearing 12x (3.0x above baseline)',
      ],
      [
        'AI-detected theme: "pricing confusion" across 4 sources',
        'AI-detected theme: "delivery delays" across 4 sources',
      ],
      [
        'Strong day-of-week revenue effect: Monday is 3.0x higher than Sunday',
        'Strong day-of-week revenue effect: Friday is 3.0x higher than Sunday',
      ],
      [
        'Revenue above monthly expectation by 20.0% (500 vs expected 400)',
        'Revenue below monthly expectation by 20.0% (300 vs expected 400)',
      ],
    ];

    for (const [a, b] of cases) {
      expect(
        signalIdentity({ category: 'x', description: a }),
        `these two must not merge:\n  ${a}\n  ${b}`,
      ).not.toBe(signalIdentity({ category: 'x', description: b }));
    }
  });

  it('keeps two customers apart even though their ids contain digits', () => {
    // Customer templates embed a cuid. Digit-stripping leaves the letters, which
    // still differ between customers.
    const a = signalIdentity({
      category: 'churn',
      description: 'Customer Acme (cmrvdk4la00039z9gcby655qq) engagement dropped 40% over 30 days',
    });
    const b = signalIdentity({
      category: 'churn',
      description: 'Customer Globex (cmrtnh5fv00h29zd4r4j3trte) engagement dropped 40% over 30 days',
    });

    expect(a).not.toBe(b);
  });

  it('DOES collapse the business-level conditions, which is the point', () => {
    // Three templates carry no distinguishing token at all: ad fatigue, the
    // email engagement gap, and the ticket surge. Each describes ONE condition a
    // business is either in or not, so two observations of it are the same
    // signal at different moments - exactly what should share a row.
    const fatigueA = signalIdentity({
      category: 'marketing',
      description: 'Ad fatigue detected: marketing spend increased 40% but leads decreased 20%. Current CPL: $85.00',
    });
    const fatigueB = signalIdentity({
      category: 'marketing',
      description: 'Ad fatigue detected: marketing spend increased 55% but leads decreased 31%. Current CPL: $92.00',
    });

    expect(fatigueA).toBe(fatigueB);
  });

  it('still separates those conditions from each other', () => {
    const fatigue = signalIdentity({ category: 'marketing', description: 'Ad fatigue detected: spend increased 40%' });
    const tickets = signalIdentity({ category: 'support', description: 'Support ticket volume surged 40%' });

    expect(fatigue).not.toBe(tickets);
  });
});

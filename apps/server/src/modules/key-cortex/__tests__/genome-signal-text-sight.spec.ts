/**
 * FU-KEY-GENOME-READS-RESIDUAL, Codex P1 on PR #228 (D-234: authorization follows the data's meaning, not only its
 * labels; D-128, D-233, D-235). A genome signal was judged by its labels alone (source module, section, domain, type,
 * field). A signal made from an inbox thread stores the customer's text as its reason, and the KEY genome bridge serves
 * that reason as the signal's message, so a signal with non-money labels and money in its text ("balance due TTD 900")
 * reached a reader without revenue read; the round-8 pool let rows 21 to 100 fill the places of the withheld ones.
 * A signal is now money when its reason or message, its evidence or its proposed value states money, read with the
 * proposal vocabulary, on every reader projection: the KEY genome context (both pools), the REST signal list, the
 * governance counts and the single-signal routes (all through isFinanceSignal). A revenue reader is served as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { genomeContextForReader } from '../genome-context-for-reader';
import { isFinanceSignal, listSignalsForReader } from '../../business-genome/key-genome/genome-finance-scope';

const opsSignal = (id: string, message: string) => ({ id, type: 'customer_request', message, module: 'key_inbox', section: 'OPERATIONS', domain: 'operations', severity: 'high', createdAt: new Date() });
const ctx = (signals: any[], signalPool?: any[]) => ({
  dnaScores: { operations: 70 }, genomeStage: 'growth', executiveReadiness: 60, recommendations: [], opportunities: [], autonomyMap: {}, timestamp: new Date(),
  signals, ...(signalPool ? { signalPool } : {}),
}) as any;

describe('a genome signal is judged by its text too (Codex P1 on #228)', () => {
  const money = opsSignal('s_money', 'Customer says the balance due TTD 900 is wrong');
  const plain = opsSignal('s_plain', 'Customer asked to move the Friday delivery');

  it('RED-BEFORE: the KEY genome context serves a reader without revenue read no signal whose message states money', () => {
    const out = genomeContextForReader(ctx([money, plain]), false) as any;
    expect(out.signals.map((s: any) => s.id)).toEqual(['s_plain']);
    expect(JSON.stringify(out)).not.toContain('TTD 900');
  });

  it('RED-BEFORE: nor from the signal pool (the rows that fill the places of withheld ones)', () => {
    const pool = [money, ...Array.from({ length: 25 }, (_, i) => opsSignal(`s_${i}`, i % 2 ? `Invoice ${i} unpaid, owes $${i}00` : `Delivery ${i} slipped`))];
    const out = genomeContextForReader(ctx(pool.slice(0, 20), pool), false) as any;
    expect(JSON.stringify(out.signals)).not.toMatch(/TTD 900|unpaid|owes/);
    expect(out.signals.length).toBeGreaterThan(0);
    for (const s of out.signals) expect(s.message).toMatch(/^Delivery \d+ slipped$/);
  });

  it('control: a revenue reader is served the context as it was', () => {
    const c = ctx([money, plain]);
    expect(genomeContextForReader(c, true)).toBe(c);
  });

  it('RED-BEFORE: isFinanceSignal reads a stored signal\'s reason, evidence and proposed value', () => {
    const row = { sourceModule: 'key_inbox', section: 'OPERATIONS', domain: 'operations', signalType: 'customer_request', field: 'notes' };
    expect(isFinanceSignal({ ...row, reason: 'Customer asked to move the Friday delivery' } as any)).toBe(false);
    expect(isFinanceSignal({ ...row, reason: 'balance due TTD 900' } as any)).toBe(true);
    expect(isFinanceSignal({ ...row, reason: 'Move the delivery', evidence: [{ summary: 'They still owe $4,000 on the last invoice' }] } as any)).toBe(true);
    expect(isFinanceSignal({ ...row, reason: 'Update the notes', proposedValue: { note: 'refund the deposit of 500' } } as any)).toBe(true);
    expect(isFinanceSignal({ ...row, reason: 'Move the delivery', evidence: [{ sourceModule: 'key_inbox', sourceEntityId: 'cmzcku666tax29xx90fuyj0uu', summary: 'Asked to move the delivery' }] } as any)).toBe(false);
  });

  it('RED-BEFORE: the REST signal list serves a reader without revenue read no signal whose reason states money, and counts what it serves', async () => {
    const rows = [
      { id: 'a', sourceModule: 'key_inbox', section: 'OPERATIONS', domain: 'operations', signalType: 'customer_request', reason: 'balance due TTD 900' },
      { id: 'b', sourceModule: 'key_inbox', section: 'OPERATIONS', domain: 'operations', signalType: 'customer_request', reason: 'Move the Friday delivery' },
      { id: 'c', sourceModule: 'key_inbox', section: 'OPERATIONS', domain: 'operations', signalType: 'customer_request', reason: 'Rebook the session' },
    ];
    const signals = { listSignals: vi.fn(async (_b: string, f: any) => rows.slice(0, f.limit ?? rows.length)) } as any;
    const out = (await listSignalsForReader(signals, 'biz_A', { limit: 2 } as any, false)) as any[];
    expect(out.map((r) => r.id)).toEqual(['b', 'c']);
    const owner = (await listSignalsForReader(signals, 'biz_A', { limit: 2 } as any, true)) as any[];
    expect(owner.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

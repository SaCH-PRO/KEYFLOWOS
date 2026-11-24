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
import { KeyCortexGenomeBridgeService } from '../key-cortex-genome-bridge.service';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
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
    // Rows 20..25 hold 3 plain delivery signals (s_20, s_22, s_24) that must be promoted past the initial 20.
    expect(out.signals.map((s: any) => s.id)).toEqual(
      Array.from({ length: 13 }, (_, k) => `s_${k * 2}`),
    );
    for (const s of out.signals) expect(s.message).toMatch(/^Delivery \d+ slipped$/);
  });

  it('the shared vocabulary applies to the text as it does to the labels: an operations signal saying "tasks overdue" is withheld (D-234, fails closed)', () => {
    const out = genomeContextForReader(ctx([opsSignal('s_overdue', 'tasks overdue'), plain]), false) as any;
    expect(out.signals.map((s: any) => s.id)).toEqual(['s_plain']);
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

  it('RED-BEFORE (security MAJOR-1): isFinanceSignal checks sourceEntityType, wide money field names, and field+proposedValue pairs', () => {
    const base = { sourceModule: 'key_inbox', section: 'OPERATIONS', domain: 'operations', signalType: 'FACT_CONFLICT', reason: 'Confirmed updated figure from thread', evidence: [] };
    // sourceEntityType provenance
    expect(isFinanceSignal({ ...base, field: 'notes', sourceEntityType: 'Invoice' } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, field: 'notes', sourceEntityType: 'FINANCE' } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, field: 'notes', sourceEntityType: 'balance_sheet' } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, field: 'notes', sourceEntityType: 'Task' } as any)).toBe(false);
    // field names in PROPOSAL_MONEY_WORDS (even with bare numeric or null proposedValue)
    for (const field of ['balance_due', 'monthly_rent', 'amount_owed', 'monthly_income', 'rate_card']) {
      expect(isFinanceSignal({ ...base, field, proposedValue: 900 } as any), field).toBe(true);
      expect(isFinanceSignal({ ...base, field, proposedValue: null } as any), `${field}:null`).toBe(true);
    }
    // figure-word field paired with numeric/nested proposedValue
    expect(isFinanceSignal({ ...base, field: 'total', proposedValue: 900 } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, field: 'total', proposedValue: { value: 900 } } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, field: 'rate', proposedValue: '150' } as any)).toBe(true);
    // ID_KEY field name must not mask a money word inside proposedValue
    expect(isFinanceSignal({ ...base, field: 'userId', proposedValue: 'balance_123' } as any)).toBe(true);
    // controls: non-money count field and benign operational field remain visible
    expect(isFinanceSignal({ ...base, field: 'totalCount', proposedValue: 12 } as any)).toBe(false);
    expect(isFinanceSignal({ ...base, field: 'delivery_status', proposedValue: 'on_track' } as any)).toBe(false);
  });

  it('RED-BEFORE (security MAJOR-2): bridge + genome context carry full-row finance classification and bypass stale v3 cache', async () => {
    const now = new Date();
    const storedRows = [
      // (a) Inbox truncation: benign first 200 chars in reason, money past char 200 in evidence[0].summary
      {
        id: 'sig_trunc_evidence',
        sourceModule: 'key_inbox',
        section: 'OPERATIONS',
        domain: 'operations',
        signalType: 'RISK_PATTERN',
        field: 'notes',
        reason: 'Customer sent a long scheduling note. '.repeat(5),
        evidence: [{ summary: `${'x'.repeat(210)} balance due TTD 900` }],
        proposedValue: null,
        sourceEntityType: 'InboxThread',
        createdAt: now,
      },
      // (b) Benign reason, money only in proposedValue
      {
        id: 'sig_proposed',
        sourceModule: 'temporal',
        section: 'OPERATIONS',
        domain: 'operations',
        signalType: 'RISK_PATTERN',
        field: 'notes',
        reason: 'Urgent follow-up needed',
        evidence: [],
        proposedValue: { actual: 12000, balance: 50000 },
        sourceEntityType: 'Schedule',
        createdAt: now,
      },
      // (c) Benign reason, money only in field + scalar proposedValue
      {
        id: 'sig_field',
        sourceModule: 'executive',
        section: 'OPERATIONS',
        domain: 'operations',
        signalType: 'RISK_PATTERN',
        field: 'balance_due',
        reason: 'Target missed for Q4',
        evidence: [],
        proposedValue: 900,
        sourceEntityType: 'Goal',
        createdAt: now,
      },
      // (d) Benign reason, money only in sourceEntityType
      {
        id: 'sig_entity',
        sourceModule: 'executive',
        section: 'OPERATIONS',
        domain: 'operations',
        signalType: 'RISK_PATTERN',
        field: 'status',
        reason: 'Needs review',
        evidence: [],
        proposedValue: null,
        sourceEntityType: 'Invoice',
        createdAt: now,
      },
      // (e) Genuinely non-financial control
      {
        id: 'sig_clean',
        sourceModule: 'operations',
        section: 'OPERATIONS',
        domain: 'operations',
        signalType: 'RISK_PATTERN',
        field: 'delivery_status',
        reason: 'Warehouse bay 2 needs reshuffling',
        evidence: [{ summary: 'Two pallets arrived early' }],
        proposedValue: 'on_track',
        sourceEntityType: 'Task',
        createdAt: now,
      },
    ];

    const bridge = Object.create(KeyCortexGenomeBridgeService.prototype) as any;
    bridge.logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn() };
    bridge.prisma = { client: { businessGenome: { findUnique: vi.fn(async () => ({ dnaScores: { operations: 70 }, stage: 'growth', executiveReadiness: 60 })) } } };
    bridge.signalService = { listSignals: vi.fn(async () => storedRows) };
    bridge.loadRankedRecommendations = vi.fn(async () => []);
    bridge.loadOpportunities = vi.fn(async () => []);
    bridge.loadCrossDomainSnapshot = vi.fn(async () => null);
    bridge.loadModuleReadiness = vi.fn(async () => []);

    const store = new Map<string, unknown>();
    // Stale v3 entry lacking isFinance on bridge signals must not be served.
    store.set('genome:context:v3:biz_A', ctx([opsSignal('sig_stale_v3', 'Target missed for Q4')], [opsSignal('sig_stale_v3', 'Target missed for Q4')]));
    const redis = {
      getJson: vi.fn(async (k: string) => store.get(k) ?? null),
      setJson: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    } as any;

    const svc = new KeyCortexGenomeContextService(redis, bridge);
    const enriched = await svc.getGenomeEnrichedContext('biz_A');
    expect(Array.from(store.keys()).some((k) => k.startsWith('genome:context:v4:'))).toBe(true);

    const blind = genomeContextForReader(enriched, false) as any;
    expect(blind.signals.map((s: any) => s.id)).toEqual(['sig_clean']);
    expect(blind.signals[0]).not.toHaveProperty('isFinance');

    const owner = genomeContextForReader(enriched, true) as any;
    expect(owner.signals.map((s: any) => s.id)).toEqual([
      'sig_trunc_evidence',
      'sig_proposed',
      'sig_field',
      'sig_entity',
      'sig_clean',
    ]);
  });

  it('fail-closed mutant guards (circular, BigInt, oversized, and shared cross-field reading budget)', () => {
    const base = { sourceModule: 'key_inbox', section: 'OPERATIONS', domain: 'operations', signalType: 'customer_request', field: 'notes' };
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(isFinanceSignal({ ...base, reason: 'ok', evidence: cyclic } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, reason: 'ok', proposedValue: BigInt(42) } as any)).toBe(true);
    expect(isFinanceSignal({ ...base, reason: 'a'.repeat(50_001) } as any)).toBe(true);

    // One field with backslashes + ZWSP expands across multiple readings (~12x length) and stays under 300k alone (~120k),
    // while three such fields (~360k) exhaust the shared 300k reading budget and must fail closed.
    const dense = `${'a'.repeat(10_000)}\\n\u200B`;
    expect(isFinanceSignal({ ...base, reason: dense } as any)).toBe(false);
    expect(isFinanceSignal({ ...base, reason: dense, message: dense, evidence: dense } as any)).toBe(true);
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

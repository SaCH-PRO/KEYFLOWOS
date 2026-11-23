/**
 * FU-KEY-CHAT-GENOME-MONEY-SIGHT review repair (security review BLOCKING-1, MAJOR-1, minor 1; D-128).
 *
 * BLOCKING-1: KeyCortexGenomeBridgeService.toBridgeSignal kept only `module = sourceModule`, so the chat
 * projection read a signal's module alone. Finance signals filed under another module pass that test:
 * key-proactive-engine.service.ts writes sourceModule 'key_autonomy' with section 'FINANCE' (domain
 * 'cashflow' / 'revenue'), the conversation genome extractor writes sourceModule 'key-chat' with section
 * 'FINANCIAL'. The REST rule (isFinanceSignal over sourceModule, section, domain) withholds them.
 * MAJOR-1 / minor 1: getProactiveSuggestions and shouldSuggestProactiveAction read the genome unprojected,
 * so all-finance recommendations hid the reader's non-finance fallback, and finance rows decided whether
 * suggestions run at all.
 */
import { describe, it, expect } from 'vitest';
import { KeyCortexGenomeBridgeService } from '../key-cortex-genome-bridge.service';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
import { genomeContextForReader, genomeRecommendationsForReader } from '../genome-context-for-reader';

const PROACTIVE_FINANCE_ROW = {
  id: 'sig_autonomy_fin',
  sourceModule: 'key_autonomy',
  section: 'FINANCE',
  domain: 'cashflow',
  signalType: 'RISK_PATTERN',
  reason: '3 pending/overdue invoices require attention',
  createdAt: new Date(),
};
const OPS_ROW = { id: 'sig_ops', sourceModule: 'key_autonomy', section: 'OPERATIONS', domain: 'tasks', signalType: 'RISK_PATTERN', reason: 'tasks are behind schedule', createdAt: new Date() };
// Codex P1 on #228: a signal's text is now read by the money vocabulary too, which reads "overdue" as money (D-234, fails
// closed), so the operations row's reason is worded without it (genome-signal-text-sight.spec.ts pins that case).

function bridgeSignal(row: Record<string, unknown>) {
  const bridge = Object.create(KeyCortexGenomeBridgeService.prototype) as any;
  return bridge.toBridgeSignal(row);
}

describe('BLOCKING-1: a finance signal filed under another module is a finance signal in the chat genome', () => {
  it('the bridge signal carries the row section and domain', () => {
    expect(bridgeSignal(PROACTIVE_FINANCE_ROW)).toMatchObject({ module: 'key_autonomy', section: 'FINANCE', domain: 'cashflow' });
  });

  it('a reader without revenue read is not handed it; operations rows and revenue readers are unchanged', () => {
    const ctx = {
      dnaScores: {}, genomeStage: 'growth', executiveReadiness: 1, recommendations: [], opportunities: [], autonomyMap: {}, timestamp: new Date(),
      signals: [bridgeSignal(PROACTIVE_FINANCE_ROW), bridgeSignal(OPS_ROW), { ...bridgeSignal(OPS_ROW), id: 'chat_fin', module: 'key-chat', section: 'FINANCIAL', domain: null }],
    } as any;
    expect(genomeContextForReader(ctx, false).signals.map((s: any) => s.id)).toEqual(['sig_ops']);
    expect(genomeContextForReader(ctx, true).signals).toHaveLength(3);
  });

  it('review MINOR-1: a REVENUE_PATTERN signal filed under a non-money section and domain is withheld, as REST withholds it', () => {
    const ctx = {
      dnaScores: {}, genomeStage: 'growth', executiveReadiness: 1, recommendations: [], opportunities: [], autonomyMap: {}, timestamp: new Date(),
      signals: [bridgeSignal({ ...OPS_ROW, id: 'sig_rev_ops', section: 'operations', domain: 'inbox', signalType: 'REVENUE_PATTERN' })],
    } as any;
    expect(genomeContextForReader(ctx, false).signals).toEqual([]);
  });

  it('security review MINOR-7: a reader without revenue read is not handed the ranking score (it weighs the financial value)', () => {
    const recs = genomeRecommendationsForReader([{ id: 'r_ops', title: 'SOPs', description: '', impact: 'high', category: 'OPERATIONS', confidence: 0.9, genomeScore: 87.5 }] as any, false);
    expect(recs).toHaveLength(1);
    expect(recs[0]).not.toHaveProperty('genomeScore');
    expect(genomeRecommendationsForReader([{ category: 'OPERATIONS', genomeScore: 87.5 }] as any, true)[0]).toHaveProperty('genomeScore', 87.5);
  });

  it('the genome context cache key changed with the signal shape, so a cached context without section is not served', async () => {
    const keys: string[] = [];
    const redis = { getJson: async (k: string) => { keys.push(k); return null; }, setJson: async () => undefined } as any;
    const bridge = { getGenomeIntelligence: async () => ({ signals: [bridgeSignal(PROACTIVE_FINANCE_ROW)], recommendations: [], opportunities: [] }) } as any;
    const svc = new KeyCortexGenomeContextService(redis, bridge);
    const ctx = await svc.getGenomeEnrichedContext('biz_1');
    expect(keys[0]).not.toBe('genome:context:biz_1');
    expect(ctx.signals[0]).toMatchObject({ module: 'key_autonomy', section: 'FINANCE', domain: 'cashflow' });
  });
});

describe('MAJOR-1 / minor 1: proactive suggestions are chosen from the genome the reader may see', () => {
  const finRec = { id: 'r_fin', title: 'Raise prices', recommendation: 'fin', impact: 0.9, confidence: 0.9, domain: 'FINANCIAL' };
  function service(signals: any[], recs: any[], opportunities: any[] = []) {
    const redis = { getJson: async () => null, setJson: async () => undefined } as any;
    const bridge = {
      getGenomeIntelligence: async () => ({ signals, recommendations: [], opportunities }),
      getRankedRecommendations: async () => recs,
    } as any;
    return new KeyCortexGenomeContextService(redis, bridge);
  }

  it('all-finance recommendations do not hide the non-finance signal fallback from a reader without revenue read, and the finance signal is not offered', async () => {
    const svc = service([bridgeSignal(PROACTIVE_FINANCE_ROW), bridgeSignal(OPS_ROW)].map((s) => ({ ...s, signalType: 'RISK_PATTERN' })), [finRec]);
    const blind = await svc.getProactiveSuggestions('biz_1', false, false);
    expect(blind.map((s) => s.id)).toEqual(['sig_ops']);
    const reader = await svc.getProactiveSuggestions('biz_1', false, true);
    expect(reader.map((s) => s.id)).toEqual(['r_fin']);
  });

  it('a finance signal or a money opportunity alone does not decide to suggest for a reader without revenue read', async () => {
    const svc = service([bridgeSignal(PROACTIVE_FINANCE_ROW)], [], [{ id: 'o', title: 'Upsell', estimatedValue: 9000, confidence: 0.9, category: 'revenue' }]);
    expect(await svc.shouldSuggestProactiveAction('biz_1', false)).toBe(false);
    expect(await svc.shouldSuggestProactiveAction('biz_1', true)).toBe(true);
  });
});

describe('Codex P2 on #217: recommendations are filtered for the reader before the top rows are taken', () => {
  it('RED-BEFORE: five finance recommendations ranked first do not push out a permitted sixth for a reader without revenue read', async () => {
    const fin = (i: number) => ({ id: `r_fin_${i}`, title: `Raise prices ${i}`, recommendation: 'fin', impact: 0.9, confidence: 0.9, domain: 'FINANCIAL' });
    const ops = { id: 'r_ops', title: 'Write the SOPs', recommendation: 'ops', impact: 0.9, confidence: 0.9, domain: 'OPERATIONS' };
    const ranked = [fin(1), fin(2), fin(3), fin(4), fin(5), ops];
    const redis = { getJson: async () => null, setJson: async () => undefined } as any;
    const bridge = {
      getGenomeIntelligence: async () => ({ signals: [], recommendations: [], opportunities: [] }),
      getRankedRecommendations: async (_b: string, limit?: number) => ranked.slice(0, limit ?? ranked.length),
    } as any;
    const svc = new KeyCortexGenomeContextService(redis, bridge);
    expect((await svc.getProactiveSuggestions('biz_1', false, false)).map((s) => s.id)).toEqual(['r_ops']);
    expect((await svc.getProactiveSuggestions('biz_1', false, true)).map((s) => s.id)).toEqual(['r_fin_1', 'r_fin_2', 'r_fin_3']);
  });
});

/**
 * RR-UNKNOWN-COST-NOT-ZERO (D-261, D-262): one model price table, and an
 * unpriced model's cost is marked unpriced, never written as $0.
 *
 * Premises at main 9a7b5011: two price tables that disagreed (the gateway's,
 * verified 2026-08-04: gpt-4o 0.0025/0.010 per 1k; llm-cost.service's: gpt-4o
 * 0.005/0.015, plus the embedding and audio rows the gateway lacked); the
 * native and opensource paths priced an unknown model at zero
 * (`TOKEN_COST_PER_1K[model] || { input: 0, output: 0 }`, four sites) while the
 * other providers fell back to a named model; LLMCostService.computeCost
 * returned 0 for an unknown model and recordCost's `||` let that zero through;
 * the budget read AiUsageLog.estimatedCost, so an unknown model spent nothing.
 *
 * Now llm-cost.service.ts holds the one exported table (the gateway imports it
 * and its copy is gone); priceFor(model) is the single lookup and answers
 * { input, output, priced }; an unpriced model is costed at the deliberate
 * gpt-4o overstatement, so a budget cannot be bypassed by an unknown model,
 * and every row it writes is marked metadata.costStatus 'unpriced_estimate'
 * (priced rows 'priced'); computeCost never invents 0; getBudgetStatus reports
 * unpricedCalls beside the total. Historical rows are not rewritten.
 *
 * The cost module is read through a namespace import so this file loads on
 * main and names what is missing instead of failing to link. The OpenAI SDK is
 * stubbed as ai-usage.service.spec.ts stubs it: the real constructor runs, the
 * resource methods are stand-ins, no request leaves the process.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => {
  vi.resetModules();
});
afterAll(() => {
  vi.resetModules();
});

const sdk = vi.hoisted(() => ({ chatCreate: vi.fn() }));
vi.mock('openai', async (importOriginal) => {
  const actual: any = await importOriginal();
  const RealOpenAI = actual.default;
  class StubOpenAI extends RealOpenAI {
    constructor(options: any = {}) {
      super(options);
      (this as any).chat = { completions: { create: (...args: any[]) => sdk.chatCreate(...args) } };
    }
  }
  return { ...actual, default: StubOpenAI, OpenAI: StubOpenAI };
});

import * as costMod from './llm-cost.service';
import { LLMCostService, TOKEN_COST_PER_1K } from './llm-cost.service';
import { ModelGatewayService, type GatewayRequest } from './model-gateway.service';
import { LangfuseService } from './langfuse.service';
import { AiUsageService } from './ai-usage.service';

type Priced = { input: number; output: number; priced: boolean };
const priceFor: (model: string) => Priced =
  (costMod as unknown as { priceFor?: (m: string) => Priced }).priceFor ?? (() => {
    throw new Error('priceFor is not exported from llm-cost.service');
  });
const costStatusFor: (model: string) => string =
  (costMod as unknown as { costStatusFor?: (m: string) => string }).costStatusFor ?? (() => {
    throw new Error('costStatusFor is not exported from llm-cost.service');
  });

const SRC_ROOT = join(__dirname, '..', '..');
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.ts$/.test(entry) && !/\.spec\.ts$|\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/** The gpt-4o estimate for 1000 prompt + 1000 completion tokens: what an unpriced model is billed as. */
const GPT4O_1K_1K = () => TOKEN_COST_PER_1K['gpt-4o'].input + TOKEN_COST_PER_1K['gpt-4o'].output;

function mockPrisma() {
  const client = {
    aiMemory: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    aiUsageLog: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCost: 1.25 } }),
      groupBy: vi.fn().mockResolvedValue([{ provider: 'openai', _sum: { estimatedCost: 1.25 } }]),
      count: vi.fn().mockResolvedValue(3),
    },
    lLMProviderCost: { create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'cost_1', ...data })), aggregate: vi.fn(), groupBy: vi.fn() },
  };
  return { client } as any;
}

describe('RR-UNKNOWN-COST-NOT-ZERO: one price table', () => {
  it('DoD RED: the table is defined once under apps/server/src, in llm-cost.service.ts, and the gateway imports it', () => {
    const definitions = tsFilesUnder(SRC_ROOT)
      .map((f) => ({ f, n: (readFileSync(f, 'utf8').match(/TOKEN_COST_PER_1K: Record</g) ?? []).length }))
      .filter((x) => x.n > 0);
    expect(definitions.map((d) => d.f.replace(SRC_ROOT, '')), 'TOKEN_COST_PER_1K must be defined exactly once').toEqual(['/modules/ai/llm-cost.service.ts']);
    const gateway = readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');
    expect(gateway).toMatch(/import \{[^}]*\bpriceFor\b[^}]*\} from '\.\/llm-cost\.service'/);
    expect(gateway).not.toMatch(/\|\| \{ input: 0, output: 0 \}/);
  });

  it('DoD RED (a): the gateway and the cost service agree on gpt-4o, at the verified price', () => {
    const fromService = new LLMCostService(mockPrisma()).computeCost('gpt-4o', 1000, 0);
    expect(fromService.inputCost).toBe(priceFor('gpt-4o').input);
    expect(priceFor('gpt-4o')).toEqual({ input: 0.0025, output: 0.01, priced: true });
    expect(TOKEN_COST_PER_1K['gpt-4o-mini']).toEqual({ input: 0.00015, output: 0.0006 });
    // the embedding and audio rows the gateway lacked are in the one table
    for (const m of ['text-embedding-3-small', 'text-embedding-3-large', 'gpt-4o-mini-tts', 'tts-1', 'whisper-1']) {
      expect(TOKEN_COST_PER_1K[m], m).toBeDefined();
    }
    // and the table says when it was verified
    const header = readFileSync(join(__dirname, 'llm-cost.service.ts'), 'utf8');
    expect(header).toMatch(/LAST VERIFIED AGAINST PROVIDER PRICING: \d{4}-\d{2}-\d{2}/);
  });

  it('priceFor never answers zero: an unknown model is billed at the gpt-4o rate and marked unpriced', () => {
    expect(priceFor('native-llm')).toEqual({ ...TOKEN_COST_PER_1K['gpt-4o'], priced: false });
    expect(costStatusFor('native-llm')).toBe('unpriced_estimate');
    expect(costStatusFor('gpt-4o-mini')).toBe('priced');
    const cost = new LLMCostService(mockPrisma()).computeCost('native-llm', 1000, 1000);
    expect(cost.totalCost).toBe(GPT4O_1K_1K());
    expect(cost.totalCost).toBeGreaterThan(0);
  });
});

describe('RR-UNKNOWN-COST-NOT-ZERO: an unpriced model is never written as $0', () => {
  let prisma: any;
  let llmCost: LLMCostService;
  let svc: ModelGatewayService;
  const request: GatewayRequest = { businessId: 'biz_cost', taskCategory: 'general', messages: [{ role: 'user', content: 'hi' }] } as GatewayRequest;

  beforeEach(() => {
    sdk.chatCreate.mockReset();
    prisma = mockPrisma();
    llmCost = new LLMCostService(prisma);
    svc = new ModelGatewayService(prisma, llmCost, new LangfuseService());
    (svc as any).routingTableLoaded = true;
    process.env.KEYFLOW_NATIVE_AI_URL = 'http://native.test.local/v1';
    process.env.OPENSOURCE_AI_URL = process.env.OPENSOURCE_AI_URL || 'http://opensource.test.local/v1';
  });

  const completion = (prompt: number, completionTokens: number) => ({
    choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
    usage: { prompt_tokens: prompt, completion_tokens: completionTokens, total_tokens: prompt + completionTokens },
  });

  it("DoD RED (b): callNative with a model absent from the table costs it at the gpt-4o estimate and marks it 'unpriced_estimate'", async () => {
    sdk.chatCreate.mockResolvedValue(completion(1000, 1000));
    const res = await (svc as any).callNative(request.messages, 'native-llm', request);
    expect(res.usage.estimatedCost).toBe(GPT4O_1K_1K());
    expect(res.usage.costStatus).toBe('unpriced_estimate');
  });

  it('the LLMProviderCost row for an unpriced call carries the estimate and the mark; a priced row is unchanged and marked priced', async () => {
    const unpriced = await llmCost.recordCost({
      businessId: 'biz_cost', provider: 'native', model: 'native-llm', taskCategory: 'general',
      promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, inputCost: 0, outputCost: 0, totalCost: 0, latencyMs: 10,
    });
    expect(unpriced.totalCost).toBe(GPT4O_1K_1K());
    expect(unpriced.metadata).toMatchObject({ costStatus: 'unpriced_estimate' });

    const priced = await llmCost.recordCost({
      businessId: 'biz_cost', provider: 'openai', model: 'gpt-4o-mini', taskCategory: 'general',
      promptTokens: 1000, completionTokens: 500, totalTokens: 1500, inputCost: 0.00015, outputCost: 0.0003, totalCost: 0.00045, latencyMs: 10,
      metadata: { contractType: null },
    });
    expect(priced.totalCost).toBe(0.00045);
    expect(priced.metadata).toEqual({ contractType: null, costStatus: 'priced' });
  });

  it('getBudgetStatus reports unpricedCalls beside the total, from the rows marked unpriced this month', async () => {
    const status = await svc.getBudgetStatus('biz_cost');
    expect(status.overall.spent).toBe(1.25);
    expect((status as any).unpricedCalls).toBe(3);
    const countArgs = prisma.client.aiUsageLog.count.mock.calls[0][0];
    expect(countArgs.where.businessId).toBe('biz_cost');
    expect(countArgs.where.metadata).toEqual({ path: ['costStatus'], equals: 'unpriced_estimate' });
  });

  it('negative control: a priced model through the OpenAI-compatible native path keeps its own price and is marked priced', async () => {
    sdk.chatCreate.mockResolvedValue(completion(1000, 1000));
    const res = await (svc as any).callNative(request.messages, 'gpt-4o-mini', request);
    // the native path rounds its estimate to four decimals, as on main
    expect(res.usage.estimatedCost).toBe(Math.round((0.00015 + 0.0006) * 10000) / 10000);
    expect(res.usage.costStatus).toBe('priced');
  });
});

describe('RR-UNKNOWN-COST-NOT-ZERO: review round 1 controls', () => {
  const gatewaySrc = readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');

  it('every usage object a provider path builds carries costStatus, the Google stream included, and no provider prices by its own named fallback any more', () => {
    const usageObjects = (gatewaySrc.match(/\n\s+estimatedCost: Math\.round\(estimatedCost \* 10000\) \/ 10000,/g) ?? []).length;
    const marked = (gatewaySrc.match(/costStatus: costStatusFor\(model\),/g) ?? []).length;
    expect(usageObjects).toBeGreaterThan(10);
    expect(marked).toBe(usageObjects);
    // the single lookup: no `TOKEN_COST_PER_1K[model] || ...` left in the gateway
    expect(gatewaySrc).not.toMatch(/TOKEN_COST_PER_1K\[model\] \|\|/);
  });

  it('no second price table hides anywhere under apps/server/src: per-1k prices are literals in llm-cost.service.ts only', () => {
    const offenders = tsFilesUnder(SRC_ROOT)
      .filter((f) => !f.endsWith('llm-cost.service.ts'))
      .filter((f) => /'gpt-4o(-mini)?':\s*\{\s*input:\s*[\d.]+/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(SRC_ROOT, ''));
    expect(offenders).toEqual([]);
  });

  it("recordCost's mark comes from the table, never from the caller's metadata", async () => {
    const prisma = mockPrisma();
    const row = await new LLMCostService(prisma).recordCost({
      businessId: 'biz_cost', provider: 'native', model: 'native-llm', taskCategory: 'general',
      promptTokens: 10, completionTokens: 10, totalTokens: 20, inputCost: 0, outputCost: 0, totalCost: 0, latencyMs: 1,
      metadata: { costStatus: 'priced', source: 'stream' },
    });
    expect(row.metadata).toEqual({ source: 'stream', costStatus: 'unpriced_estimate' });
  });

  it("the AiUsageLog row for an unpriced model carries costStatus 'unpriced_estimate', from the gateway's usage or, failing that, from the table", async () => {
    const aiUsageLog = { create: vi.fn().mockResolvedValue({}), aggregate: vi.fn().mockResolvedValue({ _sum: { creditsUsed: 0, estimatedCost: 0 } }), groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) };
    const subscriptions = { getActiveSubscription: vi.fn().mockResolvedValue({ plan: 'KEYFLOW', status: 'ACTIVE', limits: { aiCreditsPerMonth: -1 }, subscription: { currency: 'TTD', priceMonthly: 500 } }) };
    const templates = { resolveTemplate: vi.fn().mockResolvedValue(null) };
    const content = 'A long enough answer to pass the general output validation, with several sentences of specific content. '.repeat(3);
    const gateway = { complete: vi.fn(), getBudgetStatus: vi.fn(), streamComplete: vi.fn() };
    const usage = new AiUsageService({ client: { aiUsageLog } } as any, subscriptions as any, templates as any, gateway as any);
    try {
      // the gateway marked it
      gateway.complete.mockResolvedValue({ content, provider: 'native', model: 'native-llm', usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, estimatedCost: GPT4O_1K_1K(), costStatus: 'unpriced_estimate' }, latencyMs: 5, fallbackUsed: false });
      await usage.callAi({ businessId: 'biz_cost', feature: 'chat', messages: [{ role: 'user', content: 'hi' }] });
      await vi.waitFor(() => expect(aiUsageLog.create).toHaveBeenCalledTimes(1));
      expect(aiUsageLog.create.mock.calls[0][0].data).toMatchObject({ model: 'native-llm', estimatedCost: GPT4O_1K_1K(), metadata: expect.objectContaining({ costStatus: 'unpriced_estimate' }) });

      // an older gateway response without the field: the table decides
      gateway.complete.mockResolvedValue({ content, provider: 'native', model: 'native-llm', usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, estimatedCost: GPT4O_1K_1K() }, latencyMs: 5, fallbackUsed: false });
      await usage.callAi({ businessId: 'biz_cost', feature: 'chat', messages: [{ role: 'user', content: 'hi again' }] });
      await vi.waitFor(() => expect(aiUsageLog.create).toHaveBeenCalledTimes(2));
      expect(aiUsageLog.create.mock.calls[1][0].data.metadata).toMatchObject({ costStatus: 'unpriced_estimate' });

      // and a priced model is marked priced
      gateway.complete.mockResolvedValue({ content, provider: 'openai', model: 'gpt-4o-mini', usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, estimatedCost: 0.001, costStatus: 'priced' }, latencyMs: 5, fallbackUsed: false });
      await usage.callAi({ businessId: 'biz_cost', feature: 'chat', messages: [{ role: 'user', content: 'third' }] });
      await vi.waitFor(() => expect(aiUsageLog.create).toHaveBeenCalledTimes(3));
      expect(aiUsageLog.create.mock.calls[2][0].data.metadata).toMatchObject({ costStatus: 'priced' });
    } finally {
      usage.onModuleDestroy?.();
    }
  });
});

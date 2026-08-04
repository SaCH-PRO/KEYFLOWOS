/**
 * The pricing table is the instrument, not decoration.
 *
 * filterCandidatesByBudget cuts providers off using these numbers,
 * getBudgetStatus and the admin spend view report them, and every judgement
 * about model routing — including the ones made while fixing the cost of this
 * system — is made against them.
 *
 * They were the May-2024 launch prices: gpt-4o carried $5/$15 per 1M against an
 * actual $2.50/$10, gpt-4o-mini $0.40/$1.60 against $0.15/$0.60. Budget caps
 * therefore fired at roughly half the real spend. Worse, the mini overstatement
 * (2.7x) exceeded the gpt-4o one (2x), so the table understated how much cheaper
 * the cheap tier is — biasing the exact decisions it exists to inform.
 *
 * These assertions cannot know the live price. What they CAN do is pin the
 * relationships that must hold for the routing logic to be sane, so a future
 * stale edit breaks something visible.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');

/**
 * Source with comment lines removed.
 *
 * The first version of the `?? 0` assertion below matched the comment that
 * EXPLAINS the old defect, so it failed against the fixed file. A test that
 * reads its own documentation is a recurring trap in this repo — the same
 * mistake has been made four separate times today.
 */
const code = src
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
  .join('\n');

function pricingTable(): Record<string, { input: number; output: number }> {
  const start = src.indexOf('const TOKEN_COST_PER_1K');
  const body = src.slice(start, src.indexOf('};', start));
  const out: Record<string, { input: number; output: number }> = {};

  for (const m of body.matchAll(
    /'([^']+)':\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+)\s*\}/g,
  )) {
    out[m[1]] = { input: Number(m[2]), output: Number(m[3]) };
  }
  return out;
}

describe('the cheap tier is priced as cheaper than the expensive one', () => {
  const table = pricingTable();

  it('parsed the table', () => {
    expect(Object.keys(table).length).toBeGreaterThan(4);
  });

  it('gpt-4o-mini costs less than gpt-4o on both axes', () => {
    expect(table['gpt-4o-mini'].input).toBeLessThan(table['gpt-4o'].input);
    expect(table['gpt-4o-mini'].output).toBeLessThan(table['gpt-4o'].output);
  });

  it('the mini discount is large enough to be worth routing for', () => {
    // The routing table sends classification/extraction/summarization/analysis
    // to mini specifically because it is roughly an order of magnitude cheaper.
    // If an edit ever made that ratio small, those routing decisions stop
    // paying for themselves and someone should notice.
    const ratio = table['gpt-4o'].input / table['gpt-4o-mini'].input;
    expect(ratio).toBeGreaterThan(5);
  });

  it('haiku costs less than sonnet', () => {
    expect(table['claude-3-5-haiku-20241022'].input).toBeLessThan(
      table['claude-3-5-sonnet-20241022'].input,
    );
  });

  it('output always costs more than input', () => {
    // True of every provider on the market, and a good smoke test for a
    // transposed pair.
    for (const [model, price] of Object.entries(table)) {
      if (model.startsWith('moonshot')) continue; // flat-rate by design
      expect(price.output, `${model} output should exceed input`).toBeGreaterThan(price.input);
    }
  });

  it('no model is free', () => {
    for (const [model, price] of Object.entries(table)) {
      expect(price.input, `${model} input is zero`).toBeGreaterThan(0);
      expect(price.output, `${model} output is zero`).toBeGreaterThan(0);
    }
  });
});

describe('an unpriced model is a bug, not a freebie', () => {
  it('never records a cost of zero for a model it does not know', () => {
    // The call sites used `?? 0`, so any model reached via modelOverride and
    // absent from the table recorded as FREE — while the estimate path fell
    // back to gpt-4o pricing, giving two different numbers for one call.
    expect(code).not.toMatch(/TOKEN_COST_PER_1K\[[^\]]+\]\?\.\w+ \?\? 0/);
  });

  it('routes every lookup through a fallback that warns', () => {
    expect(code).toMatch(/function priceFor\(/);
    const fn = code.slice(code.indexOf('function priceFor('));
    expect(fn.slice(0, 600)).toMatch(/console\.warn|logger/);
    expect(fn.slice(0, 600)).toMatch(/TOKEN_COST_PER_1K\['gpt-4o'\]/);
  });
});

describe('the table says when it was last checked', () => {
  it('carries a verification date, because prices move', () => {
    const header = src.slice(
      src.indexOf('LAST VERIFIED') - 400,
      src.indexOf('const TOKEN_COST_PER_1K'),
    );
    expect(header).toMatch(/LAST VERIFIED AGAINST PROVIDER PRICING: \d{4}-\d{2}-\d{2}/);
  });
});

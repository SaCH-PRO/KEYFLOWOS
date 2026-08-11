/**
 * The cost meter can see every model the product can reach.
 *
 * MEASURED ON PRODUCTION 2026-08-10: of 465 recorded AI calls, **374 reported a
 * cost of exactly $0.00**. `text-embedding-3-small` and `gpt-4o-mini-tts` were
 * absent from TOKEN_COST_PER_1K, so `computeCost` fell through to
 * `|| { input: 0, output: 0 }` and reported a precise-looking zero for four
 * fifths of the product's inference.
 *
 * Nothing failed. Nothing could: a zero cost is a perfectly plausible number,
 * and the only way to notice was to compare the meter against the models the
 * router actually uses — which is what this file does, every build.
 *
 * It matters beyond reporting. AI_OVERAGE_RATE_TTD bills customers for usage
 * beyond their plan and gross margin per plan is derived from these figures, so
 * a zero here is not a missing datum, it is a wrong one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKEN_COST_PER_1K } from './llm-cost.service';

/** Every model named as a primary or fallback in the routing table. */
function routableModels(): string[] {
  const src = readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');
  const at = src.indexOf('const DEFAULT_ROUTING_TABLE');
  const table = src.slice(at, src.indexOf('\n};', at));
  return [...new Set([...table.matchAll(/model:\s*'([^']+)'/g)].map((m) => m[1]))];
}

/** Models used outside the chat router — embeddings, speech. */
function directModels(): string[] {
  const files = ['ai-usage.service.ts', 'semantic-memory.service.ts'];
  const found = new Set<string>();
  for (const f of files) {
    let src = '';
    try {
      src = readFileSync(join(__dirname, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(
      /'(text-embedding-[a-z0-9-]+|gpt-4o-mini-tts|tts-[0-9]|whisper-[a-z0-9-]+)'/g,
    )) {
      found.add(m[1]);
    }
  }
  return [...found];
}

describe('every reachable model has a price', () => {
  it('finds both sides — the check is not vacuous', () => {
    // The failure this file exists to prevent, applied to itself: a reader that
    // matches nothing reports no gaps and passes forever.
    expect(routableModels().length, 'no models parsed from the routing table').toBeGreaterThan(5);
    expect(Object.keys(TOKEN_COST_PER_1K).length).toBeGreaterThan(5);
  });

  it('every model the router can select is priced', () => {
    const unpriced = routableModels().filter((m) => !(m in TOKEN_COST_PER_1K));
    expect(
      unpriced,
      'these are primaries or fallbacks in DEFAULT_ROUTING_TABLE with no entry in ' +
        'TOKEN_COST_PER_1K, so every call routed to them records $0 and understates ' +
        'both the bill and the margin',
    ).toEqual([]);
  });

  it('every directly-invoked model is priced', () => {
    // Embeddings and speech never go through the router, which is exactly why
    // they were the ones missing: nothing that reads the routing table would
    // ever have noticed them.
    const unpriced = directModels().filter((m) => !(m in TOKEN_COST_PER_1K));
    expect(unpriced, 'embedding/audio models called directly must still be priced').toEqual([]);
  });

  it('no price is silently zero on both sides', () => {
    // A zero/zero entry is the fallback wearing a costume: it looks deliberate
    // and behaves identically to the bug.
    const bothZero = Object.entries(TOKEN_COST_PER_1K)
      .filter(([, c]) => c.input === 0 && c.output === 0)
      .map(([m]) => m);
    expect(
      bothZero,
      'an entry priced at zero for both input and output is indistinguishable from ' +
        'the missing-model fallback it was added to fix',
    ).toEqual([]);
  });

  it('the models production actually used are priced', () => {
    // The four seen in the live usage table on 2026-08-10. Named explicitly so
    // that if a future edit drops one, the failure says which real traffic it
    // just made invisible.
    for (const m of ['gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small', 'gpt-4o-mini-tts']) {
      expect(TOKEN_COST_PER_1K[m], `${m} is live in production and unpriced`).toBeDefined();
    }
  });
});

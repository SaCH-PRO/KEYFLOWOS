/**
 * An unmapped feature is silently billed at the most expensive rate.
 *
 * resolveTaskCategory falls back to 'general' for any feature absent from
 * FEATURE_TASK_MAP, and 'general' routes to gpt-4o — roughly 12x the input
 * price and 9x the output price of gpt-4o-mini.
 *
 * Every cortex background feature was missing: reflection-rank,
 * reflection-outcome, dream-connections, dream-hypotheses, synthesis-report,
 * intuition-semantic. Those are the highest-volume calls in the system —
 * reflection alone can make 21 per business per tick on a 30-minute cron — and
 * none of them is a reasoning task. They were paying top rate to rank and
 * classify.
 *
 * The failure was invisible because the fallback is silent and correct-looking.
 * This file makes it loud: it reads every feature string actually passed to
 * trackAndComplete out of the source and requires a mapping for each.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_TASK_MAP } from './ai-usage.service';

const SERVER_SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Feature strings passed to trackAndComplete.
 *
 * The signature is trackAndComplete(businessId, userId, feature, request), so
 * the feature is the third argument — usually on its own line.
 */
function featuresInUse(): Map<string, string> {
  const found = new Map<string, string>();

  for (const file of walk(SERVER_SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('trackAndComplete(')) continue;

    for (const m of src.matchAll(
      /trackAndComplete\(\s*[^,]+,\s*[^,]+,\s*['"]([a-zA-Z0-9_-]+)['"]/g,
    )) {
      found.set(m[1], file.replace(SERVER_SRC, ''));
    }
  }
  return found;
}

describe('every feature that spends money declares what kind of work it is', () => {
  it('found the call sites at all', () => {
    // Guards the regex: an empty result would make the assertion below pass
    // trivially, which is how this class of test usually rots.
    expect(featuresInUse().size).toBeGreaterThan(3);
  });

  it('has a FEATURE_TASK_MAP entry for every feature in use', () => {
    const missing = [...featuresInUse().entries()]
      .filter(([feature]) => !(feature in FEATURE_TASK_MAP))
      .map(([feature, file]) => `${feature}  (${file})`);

    expect(
      missing,
      'these fall through to "general" and are billed at gpt-4o rates without ' +
        'anyone choosing that',
    ).toEqual([]);
  });

  it('maps the cortex background work to cheap categories', () => {
    // These are the high-volume ones. If someone re-points them at a reasoning
    // or general category, the background bill multiplies quietly.
    const cheap = ['extraction', 'classification', 'summarization', 'analysis'];

    for (const feature of [
      'reflection-rank',
      'reflection-outcome',
      'dream-connections',
      'synthesis-report',
      'intuition-semantic',
    ]) {
      expect(cheap, `${feature} should be cheap background work`).toContain(
        FEATURE_TASK_MAP[feature],
      );
    }
  });

  it('uses general only where it is explicitly chosen', () => {
    // 'general' is the fallback for an UNMAPPED feature, so a deliberate
    // 'general' and a forgotten one are indistinguishable in the routing table.
    // The coverage test above is the real guard against forgetting; this one
    // just keeps the deliberate set small and visible, so a drift toward the
    // expensive default has to be argued for rather than accumulated.
    const generals = Object.entries(FEATURE_TASK_MAP)
      .filter(([, c]) => c === 'general')
      .map(([f]) => f);

    expect(generals).toEqual(['chat']);
  });
});

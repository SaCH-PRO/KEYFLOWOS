/**
 * MEM-SALIENCE-SIGHT acceptance-review follow-ups (orchestrator, 2026-11-22):
 *
 * Security MINOR-1 (D-234, fail closed): the conscious pipeline's endocrine doses are derived from the business's whole
 * context. The weak-signal cortisol counts intuition's weak signals over all of the business's data, money included,
 * and the ethics cortisol and the calibration humility judge an answer built from that context, so none of them is
 * provably money-free. They name every module (EVENT_MODULES), so only a reader who sees every module is told them.
 * The body malaise (organ health, as homeostasis reports it) stays business-wide.
 *
 * Correctness M3: a business-wide dose strengthens every module strand already held, so a reader whose strongest
 * strand is a module strand is told the business-wide reason and a higher level too.
 */
import { describe, it, expect } from 'vitest';
import { KeyCortexEndocrineService, type EndocrineSignal } from './key-cortex-endocrine.service';
import { KeyCortexConsciousnessService } from './key-cortex-consciousness.service';
import { EVENT_MODULES, moduleSightOf } from './key-cortex-prompt-context.service';

const BIZ = 'biz_mem_salience_conscious';
const NO_REVENUE = moduleSightOf(['bookings', 'crm', 'operations']);

type Derive = (
  body: unknown,
  permitted: boolean,
  rawConfidence: number,
  calibratedConfidence: number,
  weakSignalCount: number,
) => EndocrineSignal[];

/** The conscious pipeline's own derivation (step 11b), every dose firing: a degraded body, an ethics flag, overconfidence, 5 weak signals. */
function consciousDoses(): EndocrineSignal[] {
  const svc = Object.create(KeyCortexConsciousnessService.prototype) as { deriveEndocrineSignals: Derive };
  const body = {
    businessId: BIZ,
    readings: [
      { organName: 'crm', healthy: true },
      { organName: 'calendar', healthy: false, unreachable: 'timeout' },
    ],
    healthyCount: 1,
    totalCount: 2,
    unreachableCount: 1,
    gaps: [],
    integrity: 0.5,
    sampledAt: new Date(),
  };
  return svc.deriveEndocrineSignals(body, false, 0.9, 0.5, 5);
}

describe('MEM-SALIENCE-SIGHT review MINOR-1: conscious-pipeline doses not provably money-free reach only a reader of every module', () => {
  it('the doses derived from the whole context name every module; the body malaise stays business-wide', () => {
    const doses = consciousDoses();
    const byReason = (re: RegExp) => doses.find((d) => re.test(d.reason))!;
    expect(byReason(/weak signals/).modules).toEqual(EVENT_MODULES);
    expect(byReason(/ethical review/).modules).toEqual(EVENT_MODULES);
    expect(byReason(/calibration reduced/).modules).toEqual(EVENT_MODULES);
    expect(byReason(/subsystems impaired/).modules).toBeUndefined();
  });

  it('a reader without revenue read is told no weak-signal, ethics or calibration basis, nor a level or effort raised by them', () => {
    const endocrine = new KeyCortexEndocrineService();
    const now = new Date();
    const before = endocrine.effortMultiplier(BIZ, now, NO_REVENUE);
    endocrine.release(BIZ, consciousDoses(), now);

    const text = endocrine.describeForPrompt(BIZ, now, NO_REVENUE) ?? '';
    expect(text).not.toMatch(/weak signals|ethical review|calibration reduced/);
    expect(text).toMatch(/subsystems impaired/);
    expect(endocrine.readFor(BIZ, NO_REVENUE, now).map((h) => h.name)).toEqual(['malaise']);
    // Malaise is a caution hormone, so effort still rises by it alone, and by nothing else.
    const malaise = endocrine.readFor(BIZ, NO_REVENUE, now)[0].level;
    expect(endocrine.effortMultiplier(BIZ, now, NO_REVENUE)).toBeCloseTo(1 + malaise * 0.5, 10);
    expect(before).toBe(1);
  });

  it('control: a reader of every module is told them, as before', () => {
    const endocrine = new KeyCortexEndocrineService();
    const now = new Date();
    endocrine.release(BIZ, consciousDoses(), now);
    const text = endocrine.describeForPrompt(BIZ, now, moduleSightOf(EVENT_MODULES)) ?? '';
    expect(text).toMatch(/weak signals/);
    expect(text).toBe(endocrine.describeForPrompt(BIZ, now));
  });
});

describe('MEM-SALIENCE-SIGHT review M3: a business-wide dose strengthens the module strands already held', () => {
  it('a STAFF reader whose strongest strand is bookings is told the business-wide reason and a higher level', () => {
    const endocrine = new KeyCortexEndocrineService();
    const now = new Date();
    const noShows = { hormone: 'cortisol' as const, magnitude: 0.35, reason: '3 booking no-shows in 24h', modules: ['bookings'] as const };
    for (let i = 0; i < 3; i += 1) endocrine.release(BIZ, [], now, [noShows]);
    const before = endocrine.readFor(BIZ, NO_REVENUE, now).find((h) => h.name === 'cortisol')!;

    endocrine.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.2, reason: 'bulk_delete detected in the audit stream' }], now);

    const after = endocrine.readFor(BIZ, NO_REVENUE, now).find((h) => h.name === 'cortisol')!;
    expect(after.level).toBeCloseTo(before.level + 0.2 * (1 - before.level), 10);
    expect(after.reasons).toEqual(['bulk_delete detected in the audit stream', '3 booking no-shows in 24h']);
  });
});

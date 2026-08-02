/**
 * The endocrine system — slow, diffuse modulation.
 *
 * The reason this exists separately from interoception: neural signals are fast,
 * targeted and transient ("this invoice is overdue"), while hormonal signals are
 * slow and persistent ("cash has been tightening for three weeks"). Without the
 * second kind, KEY re-derives its posture from scratch every query and is
 * therefore incapable of sustained caution — a business in real trouble gets a
 * cheerful answer whenever the current question does not mention the trouble.
 *
 * The tests below are mostly about the guardrails, because an unbounded mood
 * system is exactly how an evidence-based assistant stops being one:
 *
 *   - a hormone with no evidence is refused outright
 *   - hormones decay, so one bad week is not a permanent personality change
 *   - no finite number of signals can saturate the system
 *   - the framing may bias HOW KEY reasons, never WHAT it reports as fact
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';

const BIZ = 'biz_1';
const hoursLater = (from: Date, hours: number) =>
  new Date(from.getTime() + hours * 3_600_000);

describe('release and read', () => {
  let s: KeyCortexEndocrineService;
  beforeEach(() => {
    s = new KeyCortexEndocrineService();
  });

  it('starts with no hormones — an unmodulated KEY reads as it always has', () => {
    expect(s.read(BIZ)).toEqual([]);
    expect(s.describeForPrompt(BIZ)).toBeNull();
    expect(s.effortMultiplier(BIZ)).toBe(1);
  });

  it('a signal raises its hormone and records why', () => {
    s.release(BIZ, [
      { hormone: 'cortisol', magnitude: 0.3, reason: 'runway under 60 days' },
    ]);
    const [h] = s.read(BIZ);
    expect(h.name).toBe('cortisol');
    expect(h.level).toBeGreaterThan(0);
    expect(h.reasons).toContain('runway under 60 days');
  });

  it('REFUSES an unexplained signal', () => {
    // A disposition KEY cannot justify is one it should not hold.
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.9, reason: '   ' }]);
    expect(s.read(BIZ)).toEqual([]);
  });

  it('no finite number of signals saturates a hormone', () => {
    for (let i = 0; i < 200; i++) {
      s.release(BIZ, [
        { hormone: 'cortisol', magnitude: 1, reason: `observation ${i}` },
      ]);
    }
    const [h] = s.read(BIZ);
    expect(h.level).toBeLessThan(1);
  });

  it('caps how far one observation can push', () => {
    s.release(BIZ, [
      { hormone: 'cortisol', magnitude: 99, reason: 'one very bad number' },
    ]);
    expect(s.read(BIZ)[0].level).toBeLessThanOrEqual(0.35);
  });

  it('keeps only the most recent distinct reasons', () => {
    for (let i = 0; i < 10; i++) {
      s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.05, reason: `r${i}` }]);
    }
    const [h] = s.read(BIZ);
    expect(h.reasons.length).toBeLessThanOrEqual(5);
    expect(h.reasons[0]).toBe('r9'); // newest first
  });

  it('tracks businesses independently', () => {
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.3, reason: 'x' }]);
    expect(s.read('biz_2')).toEqual([]);
  });

  it('reports strongest first', () => {
    s.release(BIZ, [
      { hormone: 'humility', magnitude: 0.1, reason: 'a' },
      { hormone: 'cortisol', magnitude: 0.35, reason: 'b' },
    ]);
    expect(s.read(BIZ)[0].name).toBe('cortisol');
  });
});

describe('decay', () => {
  let s: KeyCortexEndocrineService;
  beforeEach(() => {
    s = new KeyCortexEndocrineService();
  });

  it('falls over time without reinforcement', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bad week' }], t0);

    const initial = s.read(BIZ, t0)[0].level;
    const later = s.read(BIZ, hoursLater(t0, 8))[0].level;
    expect(later).toBeLessThan(initial);
  });

  it('disappears entirely once past the noise floor', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bad week' }], t0);
    // Several days with nothing reinforcing it.
    expect(s.read(BIZ, hoursLater(t0, 24 * 5))).toEqual([]);
  });

  it('reading does NOT restart the decay clock', () => {
    // If updatedAt advanced on read, a hormone would become permanent for any
    // business that is queried regularly — the exact opposite of homeostasis.
    const t0 = new Date('2026-01-01T00:00:00Z');
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bad week' }], t0);

    for (let h = 1; h <= 10; h++) s.read(BIZ, hoursLater(t0, h));
    const afterPolling = s.read(BIZ, hoursLater(t0, 12))[0]?.level ?? 0;

    const fresh = new KeyCortexEndocrineService();
    fresh.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bad week' }], t0);
    const withoutPolling = fresh.read(BIZ, hoursLater(t0, 12))[0]?.level ?? 0;

    expect(afterPolling).toBeCloseTo(withoutPolling, 5);
  });

  it('sustained signals hold the level up', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const decaying = new KeyCortexEndocrineService();
    decaying.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.3, reason: 'week 1' }], t0);

    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.3, reason: 'week 1' }], t0);
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.3, reason: 'week 2' }], hoursLater(t0, 2));

    expect(s.read(BIZ, hoursLater(t0, 4))[0].level).toBeGreaterThan(
      decaying.read(BIZ, hoursLater(t0, 4))[0].level,
    );
  });

  it('reset clears everything', () => {
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.3, reason: 'x' }]);
    s.reset(BIZ);
    expect(s.read(BIZ)).toEqual([]);
  });
});

describe('describeForPrompt', () => {
  let s: KeyCortexEndocrineService;
  beforeEach(() => {
    s = new KeyCortexEndocrineService();
  });

  it('states the disposition AND its evidence', () => {
    // A model told only "be cautious" becomes vaguely hedgy about everything;
    // told why, it becomes specifically careful about the right thing.
    s.release(BIZ, [
      { hormone: 'cortisol', magnitude: 0.35, reason: 'runway under 60 days' },
    ]);
    const text = s.describeForPrompt(BIZ)!;
    expect(text).toMatch(/reversible/i);
    expect(text).toContain('runway under 60 days');
  });

  it('forbids the disposition from changing reported facts', () => {
    // The single most important line in the framing: bias how you reason, never
    // what you report. Without it this system would license spin.
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'x' }]);
    const text = s.describeForPrompt(BIZ)!;
    expect(text).toMatch(/NOT change what you report as fact/);
    expect(text).toMatch(/do not soften, omit, or\s+overstate evidence/);
  });

  it('marks the context as standing, not from this message', () => {
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'x' }]);
    expect(s.describeForPrompt(BIZ)).toMatch(/over time, not from this message/);
  });

  it('optimism does not lower the evidence bar', () => {
    s.release(BIZ, [
      { hormone: 'dopamine', magnitude: 0.35, reason: 'three months of growth' },
    ]);
    expect(s.describeForPrompt(BIZ)).toMatch(/without lowering the\s+evidence bar/);
  });
});

describe('effortMultiplier', () => {
  let s: KeyCortexEndocrineService;
  beforeEach(() => {
    s = new KeyCortexEndocrineService();
  });

  it('is 1.0 at baseline and rises with caution', () => {
    expect(s.effortMultiplier(BIZ)).toBe(1);
    s.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'x' }]);
    expect(s.effortMultiplier(BIZ)).toBeGreaterThan(1);
  });

  it('never exceeds 1.5', () => {
    for (let i = 0; i < 100; i++) {
      s.release(BIZ, [{ hormone: 'cortisol', magnitude: 1, reason: `x${i}` }]);
      s.release(BIZ, [{ hormone: 'malaise', magnitude: 1, reason: `y${i}` }]);
    }
    expect(s.effortMultiplier(BIZ)).toBeLessThanOrEqual(1.5);
  });

  it('optimism does NOT reduce effort', () => {
    // Feeling good about the business is not a reason to think less carefully.
    s.release(BIZ, [{ hormone: 'dopamine', magnitude: 0.35, reason: 'growth' }]);
    expect(s.effortMultiplier(BIZ)).toBe(1);
  });

  it('humility and malaise raise effort like cortisol does', () => {
    for (const hormone of ['humility', 'malaise'] as const) {
      const fresh = new KeyCortexEndocrineService();
      fresh.release(BIZ, [{ hormone, magnitude: 0.35, reason: 'x' }]);
      expect(fresh.effortMultiplier(BIZ)).toBeGreaterThan(1);
    }
  });
});

/**
 * The proactive cognition layer must produce something.
 *
 * Three services totalling ~5,400 lines ran on schedules and left nothing
 * behind:
 *
 *   intuition (1,887 lines, 0 DB writes)
 *     - scheduledIntuitionScan ran EVERY 10 MINUTES across every active
 *       business, called detectWeakSignals(), and discarded the return value
 *     - scheduledChurnAnalysis did the same daily with churn predictions
 *
 *   creativity (1,596 lines, 0 DB writes)
 *     - persistIdeas() updated an in-memory Map and then hit a dead loop with
 *       the comment "model absent from schema.prisma"
 *     - its 05:00 cron was inert by construction: `recentInsights` was a
 *       hardcoded [] followed by `if (length === 0) continue`, so it skipped
 *       every business, every day
 *
 * KEY was paying real database and model cost to notice things, and then
 * telling nobody. These tests pin the output.
 *
 * Storage is KeyCortexMemory, which already existed with the right shape — no
 * schema migration was needed for any of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const intuitionSrc = readFileSync(join(__dirname, 'key-cortex-intuition.service.ts'), 'utf8');
const creativitySrc = readFileSync(join(__dirname, 'key-cortex-creativity.service.ts'), 'utf8');

describe('intuition — the scan produces output', () => {
  it('the 10-minute scan no longer discards its result', () => {
    const cron = intuitionSrc.slice(intuitionSrc.indexOf('async scheduledIntuitionScan'));
    const body = cron.slice(0, cron.indexOf('\n  }'));
    expect(body).toMatch(/recordSignals/);
  });

  it('the daily churn analysis no longer discards its result', () => {
    const cron = intuitionSrc.slice(intuitionSrc.indexOf('async scheduledChurnAnalysis'));
    const body = cron.slice(0, cron.indexOf('\n  }'));
    expect(body).toMatch(/recordChurnRisk/);
  });

  it('persists signals to storage', () => {
    expect(intuitionSrc).toMatch(/keyCortexMemory\.upsert/);
  });

  it('UPSERTS rather than inserting, so a recurring signal is not duplicated', () => {
    // At one scan per ten minutes, insert-only would write 144 rows per signal
    // per day.
    const fn = intuitionSrc.slice(intuitionSrc.indexOf('private async recordSignals'));
    const body = fn.slice(0, fn.indexOf('\n  private '));
    expect(body).toMatch(/upsert/);
    expect(body).not.toMatch(/keyCortexMemory\.create\(/);
  });

  it('raises alerts through the event service', () => {
    expect(intuitionSrc).toMatch(/this\.eventService\.logAlert\(/);
  });

  it('alerts on a HIGHER bar than it persists on', () => {
    // A weak signal is uncertain by definition. Alerting on everything trains
    // the user to ignore the channel, which is worse than no channel.
    const persist = Number(/SIGNAL_PERSIST_THRESHOLD = ([\d.]+)/.exec(intuitionSrc)?.[1]);
    const alert = Number(/SIGNAL_ALERT_THRESHOLD = ([\d.]+)/.exec(intuitionSrc)?.[1]);

    expect(persist).toBeGreaterThan(0);
    expect(alert).toBeGreaterThan(persist);
  });

  it('requires high or critical impact before alerting, not just confidence', () => {
    const fn = intuitionSrc.slice(intuitionSrc.indexOf('const worthRaising'));
    const block = fn.slice(0, fn.indexOf(';'));
    expect(block).toMatch(/potentialImpact === 'high'/);
    expect(block).toMatch(/potentialImpact === 'critical'/);
    expect(block).toMatch(/SIGNAL_ALERT_THRESHOLD/);
  });

  it('storage failure cannot break the scheduled job', () => {
    const fn = intuitionSrc.slice(intuitionSrc.indexOf('private async recordSignals'));
    const body = fn.slice(0, fn.indexOf('\n  private '));
    expect(body).toMatch(/catch \(error: unknown\)/);
  });
});

describe('creativity — ideas survive the process', () => {
  it('persistIdeas actually writes, instead of looping over nothing', () => {
    const fn = creativitySrc.slice(creativitySrc.indexOf('private async persistIdeas'));
    const body = fn.slice(0, fn.indexOf('\n  private '));

    expect(body).toMatch(/keyCortexMemory\.create/);
    expect(body).not.toMatch(/model absent from schema/);
  });

  it('still populates the in-memory cache, which is the read path', () => {
    const fn = creativitySrc.slice(creativitySrc.indexOf('private async persistIdeas'));
    const body = fn.slice(0, fn.indexOf('\n  private '));
    expect(body).toMatch(/creativeHistory\.set/);
  });

  it('is reachable from every generator, not just the cron', () => {
    // brainstorm, generateNovelStrategy and lateralThinking all call it, so
    // filling in the one method made all three durable.
    const calls = creativitySrc.match(/this\.persistIdeas\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('the daily cron is no longer inert', () => {
    const cron = creativitySrc.slice(creativitySrc.indexOf('async scheduledCreativeExploration'));
    const body = cron.slice(0, cron.indexOf('\n  /**'));

    // The construct that made it skip every business every day.
    expect(body).not.toMatch(/const recentInsights = \(\[\] as/);
    expect(body).toMatch(/recentWeakSignals/);
  });

  it('sparks from what intuition actually recorded', () => {
    const fn = creativitySrc.slice(creativitySrc.indexOf('private async recentWeakSignals'));
    const body = fn.slice(0, fn.indexOf('\n  /**'));
    expect(body).toMatch(/type: 'weak_signal'/);
  });

  it('ranks stored ideas by feasibility, not novelty', () => {
    const fn = creativitySrc.slice(creativitySrc.indexOf('private async persistIdeas'));
    const body = fn.slice(0, fn.indexOf('\n  private '));
    expect(body).toMatch(/confidence: idea\.feasibility/);
  });

  it('a storage failure does not fail idea generation', () => {
    const fn = creativitySrc.slice(creativitySrc.indexOf('private async persistIdeas'));
    const body = fn.slice(0, fn.indexOf('\n  private '));
    expect(body).toMatch(/catch \(error: unknown\)/);
  });
});

describe('no migration was required', () => {
  it('both services store in the pre-existing KeyCortexMemory model', () => {
    // Adding tables to a production database is the owner's decision, not a
    // side effect of fixing a no-op.
    for (const src of [intuitionSrc, creativitySrc]) {
      expect(src).toMatch(/keyCortexMemory/);
    }
  });

  it('each record type is discriminated, so they can be read back apart', () => {
    expect(intuitionSrc).toMatch(/MEMORY_TYPE_WEAK_SIGNAL = 'weak_signal'/);
    expect(intuitionSrc).toMatch(/MEMORY_TYPE_CHURN_RISK = 'churn_risk'/);
    expect(creativitySrc).toMatch(/MEMORY_TYPE_CREATIVE_IDEA = 'creative_idea'/);
  });
});

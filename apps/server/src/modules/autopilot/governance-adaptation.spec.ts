/**
 * A system must not grant itself more authority because it acted.
 *
 * adaptGovernanceFromHistory is the feedback arm of the only fully closed loop
 * in the codebase: the delegation loop measures its own history and raises or
 * lowers maxAutoTier, which decides whether the NEXT payment-recovery email
 * sends without asking anyone.
 *
 * It counted AUTO_EXECUTED as an approval. That status is written by the loop
 * itself, with executedBy: 'AI', on the line after it sends the email. So once
 * a loop was auto-executing, its own output became the evidence that it should
 * be trusted with more — approvalRate converged on 1.0 by construction and the
 * tier ratcheted up.
 *
 * That is positive feedback dressed as negative feedback, and the variable it
 * escalates is permission to act without a human. These tests pin the
 * distinction between "a person agreed" and "I did it".
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DelegationLoopService } from './delegation-loop.service';

const BIZ = 'biz_1';

function tasks(spec: Record<string, number>) {
  const out: Array<{ status: string }> = [];
  for (const [status, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) out.push({ status });
  }
  return out;
}

/** Runs the real method against a stub instance. */
function adapt(instance: unknown, loopType = 'payment_recovery'): Promise<void> {
  const impl = (
    DelegationLoopService.prototype as unknown as Record<
      string,
      (b: string, l: string) => Promise<void>
    >
  ).adaptGovernanceFromHistory;
  return impl.call(instance, BIZ, loopType);
}

function makeInstance(rows: Array<{ status: string }>, currentTier = 1) {
  const updates: any[] = [];
  return {
    updates,
    instance: {
      prisma: { client: { autopilotTask: { findMany: vi.fn(async () => rows) } } },
      governance: {
        getAutonomySettings: vi.fn(async () => ({ maxAutoTier: currentTier })),
        getToolTier: vi.fn(() => 2),
        updateAutonomySettings: vi.fn(async (_b: string, patch: any) => updates.push(patch)),
      },
      memory: { upsert: vi.fn(async () => undefined) },
      events: { emit: vi.fn() },
      eventEmitter: { emit: vi.fn() },
      logger: { log: vi.fn(), warn: vi.fn() },
    },
  };
}

describe('acting is not the same as being approved', () => {
  it('does NOT promote on its own auto-executions', async () => {
    // 40 tasks the loop performed itself. Nobody expressed a view about any of
    // them. Under the old rule this was a 100% approval rate and a promotion.
    const { updates, instance } = makeInstance(tasks({ AUTO_EXECUTED: 40 }));
    await adapt(instance);

    expect(updates).toEqual([]);
  });

  it('does not promote on auto-executions mixed with a token human approval', async () => {
    // 39 self-awarded plus one genuine approval is not evidence of trust.
    const { updates, instance } = makeInstance(tasks({ AUTO_EXECUTED: 39, COMPLETED: 1 }));
    await adapt(instance);

    expect(updates).toEqual([]);
  });

  it('DOES promote when enough real people actually approved', async () => {
    const { updates, instance } = makeInstance(tasks({ COMPLETED: 20 }));
    await adapt(instance);

    expect(updates).toHaveLength(1);
    expect(updates[0].maxAutoTier).toBe(2);
  });

  it('auto-executions cannot dilute a poor human record', async () => {
    // 8 approvals, 8 denials is a 50% rate. Padding with self-awarded rows must
    // not push it over the promotion line.
    const { updates, instance } = makeInstance(
      tasks({ COMPLETED: 8, SKIPPED: 8, AUTO_EXECUTED: 100 }),
    );
    await adapt(instance);

    expect(updates.some((u) => u.maxAutoTier === 2)).toBe(false);
  });

  it('still hears a human saying no', async () => {
    // denyTask writes SKIPPED, and that must keep working.
    const { updates, instance } = makeInstance(tasks({ COMPLETED: 2, SKIPPED: 18 }), 2);
    await adapt(instance);

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].maxAutoTier).toBeLessThan(2);
  });
});

describe('the loop cannot be its own witness', () => {
  const code = readFileSync(join(__dirname, 'delegation-loop.service.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');

  const fn = code.slice(code.indexOf('private async adaptGovernanceFromHistory('));
  const body = fn.slice(0, fn.indexOf('\n  private '));

  it('never counts AUTO_EXECUTED as an approval', () => {
    const approvedLine = body.slice(body.indexOf('const approved'), body.indexOf('const rejected'));
    expect(approvedLine).not.toMatch(/AUTO_EXECUTED/);
  });

  it('keeps the human denial signal', () => {
    const rejectedLine = body.slice(body.indexOf('const rejected'), body.indexOf('const total'));
    // denyTask writes SKIPPED; REJECTED is retained for forward compatibility
    // but nothing writes it to an autopilotTask today.
    expect(rejectedLine).toMatch(/SKIPPED/);
  });

  it('excludes self-awarded rows from the denominator too', () => {
    // Counting them as weak evidence would still let volume of self-action
    // move the tier. They are not weak evidence; they are none.
    const totalLine = body.slice(body.indexOf('const total'), body.indexOf('approvalRate ='));
    expect(totalLine).toMatch(/approved \+ rejected/);
    expect(totalLine).not.toMatch(/AUTO_EXECUTED|recentTasks\.length/);
  });

  it('the status it writes for its own actions is still distinguishable', () => {
    // If the loop ever started writing COMPLETED for its own sends, this whole
    // distinction collapses silently.
    const send = code.slice(code.indexOf("status: 'AUTO_EXECUTED'"));
    expect(send.slice(0, 120)).toMatch(/executedBy: 'AI'/);
  });
});

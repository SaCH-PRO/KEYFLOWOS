/**
 * AI governance must fail CLOSED, and must never overwrite itself with defaults.
 *
 * getAutonomySettings reads a business's policy — blocked tools, blocked
 * modules, and the mode that decides whether KEY may act at all. Both of its
 * lookups used to end in a bare `catch { }`, so ANY database error fell through
 * to DEFAULT_AUTONOMY, whose blockedTools and blockedModules are EMPTY and whose
 * mode is 'assisted'.
 *
 * evaluate() enforces the blocklist from that object. So a dropped connection
 * silently lifted a business's explicit bans and promoted "suggest, never
 * execute" to a mode that reaches the auto-approval ladder. A governance gate
 * that fails OPEN — the exact inverse of rate-limit.guard.ts, which documents
 * failing closed and is right to.
 *
 * THE SECOND HALF IS WORSE AND IS WHY THIS FILE EXISTS
 * ----------------------------------------------------
 * updateAutonomySettings is a read-modify-write: it merges the caller's changes
 * over whatever the read returned and upserts the result. With the read
 * silently defaulting, an admin toggling one unrelated switch PERSISTED empty
 * blocklists over their real policy. The database error lasts seconds; the
 * erased policy lasts until someone notices KEY doing something it was banned
 * from, with nothing in the record to explain it.
 *
 * "Not knowing the policy" and "there is no policy" are different states, and
 * were indistinguishable. `degraded` distinguishes them.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AiOversightService } from './ai-oversight.service';

/** A prisma double whose settings reads throw, or return a real policy. */
function makePrisma(opts: {
  readThrows?: boolean;
  typedReadThrows?: boolean;
  legacyReadThrows?: boolean;
  typedPolicy?: unknown;
  policy?: unknown;
  legacyValue?: string;
} = {}) {
  const boom = () => {
    throw new Error('Connection terminated unexpectedly');
  };
  return {
    client: {
      autopilotSettings: {
        findUnique: opts.readThrows || opts.typedReadThrows
          ? vi.fn(boom)
          : vi.fn(async () => opts.typedPolicy ?? null),
      },
      aiMemory: {
        findUnique: opts.readThrows || opts.legacyReadThrows
          ? vi.fn(boom)
          : vi.fn(async () => opts.legacyValue !== undefined
            ? { value: opts.legacyValue }
            : (opts.policy ? { value: JSON.stringify(opts.policy) } : null)),
        upsert: vi.fn(async () => ({})),
      },
      user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'SUPER_ADMIN' })) },
      // The audit write that follows the upsert. Omitting it made the service
      // throw AFTER persisting — which would have read as "the update was
      // refused" when it had in fact succeeded.
      teamActivityLog: { create: vi.fn(async () => ({})) },
      membership: { findFirst: vi.fn(async () => ({ role: 'OWNER' })) },
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  // Only the settings path is exercised; the rest are never reached.
  return new AiOversightService(
    prisma as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  );
}

describe('a governance read that fails does not become a permissive policy', () => {
  it('does not promote permissive legacy after an unresolved typed-policy read failure', async () => {
    const prisma = makePrisma({
      typedReadThrows: true,
      policy: { mode: 'pro_auto', maxAutoTier: 4, autonomyLevel: 4, degraded: false },
    });

    const settings = await makeService(prisma).getAutonomySettings('biz_1');

    expect(settings.mode).toBe('restricted');
    expect(settings.degraded).toBe(true);
    expect(settings.maxAutoTier).toBe(1);
  });

  it('keeps typed policy authoritative over a permissive legacy record', async () => {
    const prisma = makePrisma({
      typedPolicy: {
        autonomyLevel: 0,
        blockedTools: ['payments_refund_charge'],
        approvedTools: [],
        approvalTimeoutHours: 36,
      },
      policy: { mode: 'pro_auto', blockedTools: [] },
    });

    const settings = await makeService(prisma).getAutonomySettings('biz_1');

    expect(settings.mode).toBe('advisory');
    expect(settings.blockedTools).toEqual(['payments_refund_charge']);
    expect(settings.approvalTimeoutHours).toBe(36);
    expect(settings.degraded).toBeFalsy();
    expect(prisma.client.aiMemory.findUnique).not.toHaveBeenCalled();
  });

  it('keeps a failed legacy read degraded after confirmed typed absence', async () => {
    const settings = await makeService(makePrisma({ legacyReadThrows: true }))
      .getAutonomySettings('biz_1');

    expect(settings.mode).toBe('restricted');
    expect(settings.degraded).toBe(true);
  });

  it('keeps malformed legacy policy degraded after confirmed typed absence', async () => {
    const settings = await makeService(makePrisma({ legacyValue: '{broken' }))
      .getAutonomySettings('biz_1');

    expect(settings.mode).toBe('restricted');
    expect(settings.degraded).toBe(true);
  });

  it('applies the same failure rule to an explicit transaction reader', async () => {
    const shared = makePrisma({ policy: { mode: 'pro_auto', maxAutoTier: 4 } });
    const transaction = makePrisma({
      typedReadThrows: true,
      policy: { mode: 'pro_auto', maxAutoTier: 4 },
    });

    const settings = await makeService(shared).getAutonomySettings('biz_1', transaction.client as never);

    expect(settings.mode).toBe('restricted');
    expect(settings.degraded).toBe(true);
    expect(shared.client.autopilotSettings.findUnique).not.toHaveBeenCalled();
    expect(shared.client.aiMemory.findUnique).not.toHaveBeenCalled();
  });

  it('returns restricted mode when the settings cannot be read', async () => {
    const service = makeService(makePrisma({ readThrows: true }));

    const settings = await service.getAutonomySettings('biz_1');

    // 'assisted' — the old fallback — reaches the auto-approval ladder.
    expect(settings.mode, 'a failed read must not produce an actionable mode').toBe('restricted');
    expect(settings.degraded).toBe(true);
  });

  it('still returns ordinary defaults when there is simply no policy row', async () => {
    // The distinction that makes this safe to ship: a business that has never
    // configured governance is NOT degraded, and must keep working as before.
    const service = makeService(makePrisma({ readThrows: false }));

    const settings = await service.getAutonomySettings('biz_1');

    expect(settings.degraded).toBeFalsy();
    expect(settings.mode).toBe('assisted');
  });

  it('reads a configured policy unchanged', async () => {
    const service = makeService(
      makePrisma({ policy: { mode: 'advisory', blockedTools: ['payments_refund_charge'] } }),
    );

    const settings = await service.getAutonomySettings('biz_1');

    expect(settings.mode).toBe('advisory');
    expect(settings.blockedTools).toContain('payments_refund_charge');
    expect(settings.degraded).toBeFalsy();
  });
});

describe('a settings save never overwrites a policy it could not read', () => {
  it('refuses policy and audit writes even when legacy succeeds after a typed read failure', async () => {
    const prisma = makePrisma({
      typedReadThrows: true,
      policy: { mode: 'pro_auto', blockedTools: [], blockedModules: [], degraded: false },
    });

    await expect(
      makeService(prisma).updateAutonomySettings('biz_1', { approvalTimeoutHours: 12 }, 'u1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.client.aiMemory.upsert).not.toHaveBeenCalled();
    expect(prisma.client.teamActivityLog.create).not.toHaveBeenCalled();
  });

  it('still refuses non-admin updates before reading or writing policy', async () => {
    const prisma = makePrisma({ policy: { mode: 'advisory', blockedTools: ['x'] } });
    prisma.client.user.findUnique.mockResolvedValue({ id: 'u1', role: 'USER' });
    prisma.client.membership.findFirst.mockResolvedValue({ role: 'MEMBER' });

    await expect(
      makeService(prisma).updateAutonomySettings('biz_1', { approvalTimeoutHours: 12 }, 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.client.autopilotSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.client.aiMemory.findUnique).not.toHaveBeenCalled();
    expect(prisma.client.aiMemory.upsert).not.toHaveBeenCalled();
    expect(prisma.client.teamActivityLog.create).not.toHaveBeenCalled();
  });

  it('refuses the update instead of persisting defaults', async () => {
    const prisma = makePrisma({ readThrows: true });
    const service = makeService(prisma);

    await expect(
      service.updateAutonomySettings('biz_1', { approvalTimeoutHours: 12 }, 'u1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // The load-bearing assertion. Failing the request is recoverable; writing
    // empty blocklists over a real policy is not, and nothing would report it.
    expect(
      prisma.client.aiMemory.upsert,
      'the update was written on top of a failed read — blockedTools and ' +
        'blockedModules have just been permanently replaced with defaults',
    ).not.toHaveBeenCalled();
  });

  it('saves normally when the read succeeded', async () => {
    const prisma = makePrisma({ policy: { mode: 'advisory', blockedTools: ['x'] } });
    const service = makeService(prisma);

    await service.updateAutonomySettings('biz_1', { approvalTimeoutHours: 12 }, 'u1');

    expect(prisma.client.aiMemory.upsert).toHaveBeenCalled();
    const written = JSON.parse(
      (prisma.client.aiMemory.upsert.mock.calls[0][0] as { create: { value: string } }).create.value,
    );
    expect(written.blockedTools, 'an unrelated edit must not drop the blocklist').toContain('x');
    expect(written.degraded, 'the marker describes one read, not the policy').toBeUndefined();
    expect(prisma.client.teamActivityLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.client.teamActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessId: 'biz_1', userId: 'u1', action: 'ai_governance_updated' }),
    });
  });
});

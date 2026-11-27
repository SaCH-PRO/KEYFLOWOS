import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  AUDIT_ACTION_KEY,
  AUDIT_ONCE_PER_ENTITY_KEY,
  TeamAuditInterceptor,
} from '../../core/interceptors/team-audit.interceptor';
import { ContactAuditService } from './privacy/contact-audit.service';
import { trackAsyncWrites } from '../../../test/helpers/async-writes.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildInterceptorHarness(delayMs: number, options?: { shouldFail?: boolean }) {
  const teamLogs: Array<Record<string, unknown>> = [];
  const mockPrisma = {
    client: {
      teamActivityLog: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          await delay(delayMs);
          if (options?.shouldFail) {
            throw new Error('simulated team_activity_logs write failure');
          }
          teamLogs.push(args.data);
          return { id: `log_${teamLogs.length}`, ...args.data };
        }),
      },
    },
  };

  const mockReflector = {
    get: vi.fn((key: string) => {
      if (key === AUDIT_ACTION_KEY) {
        return { module: 'crm', action: 'contact_updated', entityType: 'contact' };
      }
      if (key === AUDIT_ONCE_PER_ENTITY_KEY) {
        return false;
      }
      return undefined;
    }),
  };

  const interceptor = new TeamAuditInterceptor(mockPrisma as never, mockReflector as never);

  async function fireHttpMutation(method: 'POST' | 'PATCH' | 'DELETE', contactId: string, userId: string) {
    const context = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          user: { id: userId },
          params: { businessId: 'tca_bizA', contactId },
          headers: {},
        }),
      }),
    };
    const next = {
      handle: () => of({ id: contactId }),
    };
    return lastValueFrom(interceptor.intercept(context as never, next as never));
  }

  return { teamLogs, mockPrisma, interceptor, fireHttpMutation };
}

describe('P142 FU-CONTACTS-AUDIT-FLAKE: deterministic drain of fire-and-forget team-activity and contact-audit writes', () => {
  it('[CA-DRAIN-01] reproduces the 2-late-write teamLogs bleed under naive sleep with a 200ms forced delay, and passes deterministically with trackAsyncWrites.drain()', async () => {
    const FORCED_DELAY_MS = 200;
    const NAIVE_SETTLE_MS = 40;

    // Part 1: Naive fixed sleep (< forced delay) lets two earlier mutations'
    // fire-and-forget teamActivityLog writes bleed into the refusal's traceCounts.
    const naive = buildInterceptorHarness(FORCED_DELAY_MS);
    await naive.fireHttpMutation('PATCH', 'tca_c1', 'tca_staff');
    await naive.fireHttpMutation('DELETE', 'tca_c1', 'tca_owner');
    await delay(NAIVE_SETTLE_MS);
    const naiveBefore = naive.teamLogs.length;
    expect(naiveBefore).toBe(0);
    // Refused enrichment writes zero team logs, then delayed earlier writes land.
    await delay(FORCED_DELAY_MS + 40);
    const naiveAfter = naive.teamLogs.length;
    expect(naiveAfter).toBe(2);
    expect(naiveAfter - naiveBefore).toBe(2);

    // Part 2: Deterministic drain waits for every in-flight TeamAuditInterceptor
    // write before the baseline is captured, regardless of delay length.
    const tracker = trackAsyncWrites([
      [ContactAuditService.prototype, 'write'],
      [TeamAuditInterceptor.prototype, 'record'],
    ]);
    try {
      const drained = buildInterceptorHarness(FORCED_DELAY_MS);
      await drained.fireHttpMutation('PATCH', 'tca_c2', 'tca_staff');
      await drained.fireHttpMutation('DELETE', 'tca_c2', 'tca_owner');

      // HTTP responses have returned while both fire-and-forget writes are still pending.
      expect(tracker.inFlight()).toBe(2);
      expect(drained.teamLogs).toHaveLength(0);

      await tracker.drain();
      expect(tracker.inFlight()).toBe(0);
      const before = drained.teamLogs.length;
      expect(before).toBe(2);

      // Refused enrichment writes nothing; draining again keeps exact count equality.
      await tracker.drain();
      expect(drained.teamLogs.length).toBe(before);
    } finally {
      tracker.restore();
    }
  });

  it('[CA-DRAIN-02] NEGATIVE CONTROL: deterministic drain still catches a refusal path that erroneously writes a delayed team log or contact audit entry', async () => {
    const tracker = trackAsyncWrites([
      [ContactAuditService.prototype, 'write'],
      [TeamAuditInterceptor.prototype, 'record'],
    ]);
    try {
      const harness = buildInterceptorHarness(180);
      await harness.fireHttpMutation('PATCH', 'tca_c3', 'tca_staff');
      await harness.fireHttpMutation('DELETE', 'tca_c3', 'tca_owner');
      await tracker.drain();
      const beforeTeamLogs = harness.teamLogs.length;
      expect(beforeTeamLogs).toBe(2);

      // Simulate a buggy refusal that still triggers a delayed teamActivityLog write.
      await harness.fireHttpMutation('POST', 'tca_c3_refused', 'tca_staff');
      expect(tracker.inFlight()).toBe(1);
      await tracker.drain();
      expect(harness.teamLogs.length).toBe(beforeTeamLogs + 1);
      expect(harness.teamLogs.length).not.toBe(beforeTeamLogs);

      // Same negative control for a fire-and-forget ContactAuditService.write.
      const audits: Array<Record<string, unknown>> = [];
      const auditService = new ContactAuditService({
        client: {
          contactAuditEntry: {
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
              await delay(150);
              audits.push(args.data);
              return args.data;
            }),
          },
        },
      } as never);

      const beforeAudits = audits.length;
      void auditService.write({
        businessId: 'tca_bizA',
        contactId: 'tca_c3_refused',
        action: 'updated',
        actor: { type: 'USER', id: 'tca_staff' },
      });
      expect(tracker.inFlight()).toBe(1);
      await tracker.drain();
      expect(audits.length).toBe(beforeAudits + 1);
      expect(audits.length).not.toBe(beforeAudits);
    } finally {
      tracker.restore();
    }
  });

  it('[CA-DRAIN-03] drains cleanly when an async write fails or spawns a follow-up write while draining', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const tracker = trackAsyncWrites([
      [ContactAuditService.prototype, 'write'],
      [TeamAuditInterceptor.prototype, 'record'],
    ]);
    try {
      // Failing team log write must not hang or reject drain().
      const failing = buildInterceptorHarness(80, { shouldFail: true });
      await failing.fireHttpMutation('PATCH', 'tca_c4', 'tca_staff');
      expect(tracker.inFlight()).toBe(1);
      await expect(tracker.drain()).resolves.toBeUndefined();
      expect(tracker.inFlight()).toBe(0);
      expect(failing.teamLogs).toHaveLength(0);

      // Re-entrant write started while drain() is already awaiting an earlier write.
      const chained: string[] = [];
      let secondStarted = false;
      const auditService = new ContactAuditService({
        client: {
          contactAuditEntry: {
            create: vi.fn(async (args: { data: { contactId: string } }) => {
              await delay(60);
              chained.push(args.data.contactId);
              if (!secondStarted) {
                secondStarted = true;
                void auditService.write({
                  businessId: 'tca_bizA',
                  contactId: 'tca_c4_second',
                  action: 'updated',
                  actor: { type: 'SYSTEM' },
                });
              }
              return args.data;
            }),
          },
        },
      } as never);

      void auditService.write({
        businessId: 'tca_bizA',
        contactId: 'tca_c4_first',
        action: 'created',
        actor: { type: 'SYSTEM' },
      });
      await tracker.drain();
      expect(tracker.inFlight()).toBe(0);
      expect(chained).toEqual(['tca_c4_first', 'tca_c4_second']);
    } finally {
      tracker.restore();
      warnSpy.mockRestore();
    }
  });

  it('[CA-DRAIN-04] contacts-audit-actor.integration.test.ts uses deterministic trackAsyncWrites drain, drains before every traceCounts baseline, preserves ST-R3/CR-1 teamLogs assertions, and covers [CAA-DRAIN-01]', () => {
    const integrationPath = join(__dirname, '..', '..', '..', 'test', 'contacts-audit-actor.integration.test.ts');
    const src = readFileSync(integrationPath, 'utf8');

    // Uses deterministic tracker for both fire-and-forget writers, not a fixed sleep.
    expect(src).toContain('./helpers/async-writes.js');
    expect(src).toContain('trackAsyncWrites');
    expect(src).toContain("[ContactAuditService.prototype, 'write']");
    expect(src).toContain("[TeamAuditInterceptor.prototype, 'record']");
    expect(src).toContain('asyncWrites.drain()');
    expect(src).toContain('asyncWrites?.restore()');
    expect(src).not.toMatch(/settle\s*=\s*\(\)\s*=>\s*new Promise\(\(r\)\s*=>\s*setTimeout/);

    // Every `const before = await traceCounts()` baseline is preceded by `await settle()`
    // so no earlier request's late async write can bleed into a refusal assertion.
    const lines = src.split('\n');
    const baselineLines: number[] = [];
    lines.forEach((line, idx) => {
      if (line.includes('const before = await traceCounts()')) {
        baselineLines.push(idx);
      }
    });
    expect(baselineLines.length).toBeGreaterThanOrEqual(8);
    for (const idx of baselineLines) {
      const prevNonEmpty = lines
        .slice(Math.max(0, idx - 3), idx)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('//'));
      expect(
        prevNonEmpty.at(-1),
        `line ${idx + 1} ('const before = await traceCounts()') must be immediately preceded by 'await settle();'`,
      ).toBe('await settle();');
    }

    // Preserves full traceCounts() including teamLogs and ST-R3/CR-1 refusal check.
    expect(src).toContain('db.teamActivityLog.count({ where: { businessId: ID.bizA } })');
    expect(src).toContain('ST-R3 / CR-1: enrichment applies the GET visibility clause before the provider call');
    expect(src).toContain('expect(await traceCounts()).toEqual(before)');

    // Includes the real-DB forced-delay & negative-control regression case.
    expect(src).toContain('[CAA-DRAIN-01]');
  });
});

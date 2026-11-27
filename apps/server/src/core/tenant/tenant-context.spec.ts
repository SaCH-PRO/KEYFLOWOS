/**
 * P148 / RR-JOB-TENANT-CONTEXT (D-261 / D-262 / D-17 / D-103) —
 * Unit contract for `runForTenant(businessId, fn)` and ambient-context readers.
 *
 * Background work (crons, intervals, BullMQ workers) runs outside HTTP so
 * TenantInterceptor never fires. `runForTenant` opens an AsyncLocalStorage
 * tenant context `{ businessId, userId: undefined }` so the Prisma tenant
 * isolation extension scopes every query on `BUSINESS_ID_MODELS`, while naming
 * NO user so every ambient-context actor reader preserves its SYSTEM / null
 * answer and never attributes background work to a human.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  runForTenant,
  runWithTenant,
  getTenantContext,
  getCurrentBusinessId,
  getCurrentUserId,
} from './tenant-context';
import { BookingsService } from '../../modules/bookings/bookings.service';
import { BookingWaitlistService } from '../../modules/bookings/booking-waitlist.service';
import { boundMemberOpensContacts } from '../../modules/crm/crm-deals.service';
import { configuringMember } from '../../modules/connect/google-contacts-sync.service';
import { AccountingPeriodService } from '../../modules/finance/accounting-period.service';
import { BusinessCommandCenterService } from '../../modules/business-command-center/business-command-center.service';

const BIZ_A = 'biz_tenant_a';
const BIZ_B = 'biz_tenant_b';
const USER_1 = 'user_actor_1';

describe('runForTenant: AsyncLocalStorage tenant scope without user attribution', () => {
  it('sets getCurrentBusinessId() and leaves getCurrentUserId() undefined', () => {
    expect(getTenantContext()).toBeUndefined();
    expect(getCurrentBusinessId()).toBeUndefined();
    expect(getCurrentUserId()).toBeUndefined();

    const result = runForTenant(BIZ_A, () => {
      expect(getCurrentBusinessId()).toBe(BIZ_A);
      expect(getCurrentUserId()).toBeUndefined();
      expect(getTenantContext()).toEqual({ businessId: BIZ_A, userId: undefined });
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(getTenantContext()).toBeUndefined();
    expect(getCurrentBusinessId()).toBeUndefined();
    expect(getCurrentUserId()).toBeUndefined();
  });

  it('propagates across async awaits and isolates concurrent tenants', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const [seenA, seenB] = await Promise.all([
      runForTenant(BIZ_A, async () => {
        const before = { biz: getCurrentBusinessId(), user: getCurrentUserId() };
        await delay(15);
        const after = { biz: getCurrentBusinessId(), user: getCurrentUserId() };
        return { before, after };
      }),
      runForTenant(BIZ_B, async () => {
        const before = { biz: getCurrentBusinessId(), user: getCurrentUserId() };
        await delay(5);
        const after = { biz: getCurrentBusinessId(), user: getCurrentUserId() };
        return { before, after };
      }),
    ]);

    expect(seenA).toEqual({
      before: { biz: BIZ_A, user: undefined },
      after: { biz: BIZ_A, user: undefined },
    });
    expect(seenB).toEqual({
      before: { biz: BIZ_B, user: undefined },
      after: { biz: BIZ_B, user: undefined },
    });
    expect(getTenantContext()).toBeUndefined();
  });

  it('restores an enclosing context cleanly on return, sync throw, and async rejection', async () => {
    await runWithTenant(BIZ_A, USER_1, async () => {
      // Normal return
      runForTenant(BIZ_B, () => {
        expect(getCurrentBusinessId()).toBe(BIZ_B);
        expect(getCurrentUserId()).toBeUndefined();
      });
      expect(getTenantContext()).toEqual({ businessId: BIZ_A, userId: USER_1 });

      // Synchronous throw
      expect(() =>
        runForTenant(BIZ_B, () => {
          expect(getCurrentBusinessId()).toBe(BIZ_B);
          throw new Error('sync boom');
        }),
      ).toThrow('sync boom');
      expect(getTenantContext()).toEqual({ businessId: BIZ_A, userId: USER_1 });

      // Async rejection
      await expect(
        runForTenant(BIZ_B, async () => {
          await Promise.resolve();
          expect(getCurrentBusinessId()).toBe(BIZ_B);
          expect(getCurrentUserId()).toBeUndefined();
          throw new Error('async boom');
        }),
      ).rejects.toThrow('async boom');
      expect(getTenantContext()).toEqual({ businessId: BIZ_A, userId: USER_1 });
    });

    expect(getTenantContext()).toBeUndefined();
  });

  it('fails closed on empty, whitespace, or non-string businessId without calling fn', () => {
    const invalidInputs: unknown[] = ['', '   ', '\t\n', undefined, null, 123, {}, [BIZ_A]];
    for (const bad of invalidInputs) {
      const fn = vi.fn(() => 'should-not-run');
      expect(() => runForTenant(bad as string, fn)).toThrow(/runForTenant requires a non-empty businessId/);
      expect(fn).not.toHaveBeenCalled();
      expect(getTenantContext()).toBeUndefined();
    }
  });
});

describe('ambient-context readers keep SYSTEM / null behavior under both no-context and runForTenant', () => {
  const bookings = Object.create(BookingsService.prototype) as {
    requestActor: (businessId: string) => { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' };
  };
  const waitlist = Object.create(BookingWaitlistService.prototype) as {
    offerActor: (
      businessId: string,
      actorType: 'SYSTEM' | 'USER',
    ) => { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' };
  };
  const accountingPeriod = Object.assign(Object.create(AccountingPeriodService.prototype), {
    prisma: {
      client: {
        membership: {
          findUnique: vi.fn(() => {
            throw new Error('membership lookup must not run when ambient context has no userId');
          }),
        },
      },
    },
  }) as {
    assertMayGate: (
      businessId: string,
      explicitActorId: string | undefined,
      verb: 'close' | 'reopen' | 'update' | 'delete',
    ) => Promise<string>;
  };
  const commandCenter = Object.assign(Object.create(BusinessCommandCenterService.prototype), {
    prisma: {
      client: {
        membership: {
          findUnique: vi.fn(() => {
            throw new Error('membership lookup must not run when ambient context has no userId');
          }),
        },
      },
    },
  }) as {
    resolveResultsAccess: (
      businessId: string,
    ) => Promise<{ crmRead: boolean; revenueRead: boolean; contactVisibility: unknown }>;
  };
  const unusedPrisma = {
    client: {
      membership: {
        findUnique: vi.fn(() => {
          throw new Error('membership lookup must not run when ambient context has no userId');
        }),
      },
    },
  } as never;

  it('BookingsService.requestActor answers SYSTEM with no context and inside runForTenant (control: USER under runWithTenant)', () => {
    expect(bookings.requestActor(BIZ_A)).toEqual({ actorType: 'SYSTEM' });
    expect(runForTenant(BIZ_A, () => bookings.requestActor(BIZ_A))).toEqual({ actorType: 'SYSTEM' });
    expect(runWithTenant(BIZ_A, USER_1, () => bookings.requestActor(BIZ_A))).toEqual({
      actorType: 'USER',
      actorId: USER_1,
    });
  });

  it('BookingWaitlistService.offerActor answers SYSTEM with no context and inside runForTenant (control: USER under runWithTenant)', () => {
    expect(waitlist.offerActor(BIZ_A, 'USER')).toEqual({ actorType: 'SYSTEM' });
    expect(runForTenant(BIZ_A, () => waitlist.offerActor(BIZ_A, 'USER'))).toEqual({ actorType: 'SYSTEM' });
    expect(runWithTenant(BIZ_A, USER_1, () => waitlist.offerActor(BIZ_A, 'USER'))).toEqual({
      actorType: 'USER',
      actorId: USER_1,
    });
  });

  it('crm-deals boundMemberOpensContacts returns null with no context and inside runForTenant', async () => {
    await expect(boundMemberOpensContacts(unusedPrisma, BIZ_A, ['contact_1'])).resolves.toBeNull();
    await expect(
      runForTenant(BIZ_A, () => boundMemberOpensContacts(unusedPrisma, BIZ_A, ['contact_1'])),
    ).resolves.toBeNull();
  });

  it('google-contacts-sync configuringMember returns null with no context and inside runForTenant (control: USER under runWithTenant)', () => {
    expect(configuringMember(BIZ_A)).toBeNull();
    expect(runForTenant(BIZ_A, () => configuringMember(BIZ_A))).toBeNull();
    expect(runWithTenant(BIZ_A, USER_1, () => configuringMember(BIZ_A))).toBe(USER_1);
  });

  it('AccountingPeriodService.assertMayGate refuses with no context and inside runForTenant (never grants authority)', async () => {
    await expect(accountingPeriod.assertMayGate(BIZ_A, undefined, 'close')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      runForTenant(BIZ_A, () => accountingPeriod.assertMayGate(BIZ_A, undefined, 'close')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('BusinessCommandCenterService.resolveResultsAccess returns NO_RESULTS_ACCESS with no context and inside runForTenant', async () => {
    const noAccess = { crmRead: false, revenueRead: false, contactVisibility: null };
    await expect(commandCenter.resolveResultsAccess(BIZ_A)).resolves.toEqual(noAccess);
    await expect(runForTenant(BIZ_A, () => commandCenter.resolveResultsAccess(BIZ_A))).resolves.toEqual(
      noAccess,
    );
  });
});

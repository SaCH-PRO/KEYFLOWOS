/**
 * R0-09f-D11-FINANCE-TAX-AND-WEB — the pure half of the finance settings
 * owner check (owner ruling D-11). The real-database half, through the real
 * FinanceController, guards and Postgres, is
 * test/d11-finance-settings.integration.test.ts.
 *
 * FinanceSettingsService.assertTaxRateOwner refuses a non-owner's
 * defaultTaxRate CHANGE (403 BUSINESS_PROFILE_OWNER_ONLY), lets a non-owner's
 * resubmitted current rate through with the rate removed (the finance settings
 * page saves the whole form), and leaves every submission without a rate, and
 * every owner's submission, as it was.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FinanceSettingsService, BUSINESS_PROFILE_OWNER_ONLY } from './finance-settings.service';

const BIZ = 'biz_fin_1';

function makeService(opts: { membershipRole?: string; ownerId?: string; storedRate?: number | null } = {}) {
  const client = {
    membership: {
      findUnique: vi.fn(async (args: any) => {
        const { userId, businessId } = args.where.userId_businessId;
        return opts.membershipRole && businessId === BIZ && userId === 'member' ? { role: opts.membershipRole } : null;
      }),
    },
    business: {
      // The recorded-owner lookup: Business.ownerId of this business and, owner rulings D-104 and
      // D-116, the members filter honoured against the fake membership (its role too, when named).
      findFirst: vi.fn(async (args: any) => {
        const { where } = args;
        if (where.id !== BIZ || !opts.ownerId || where.ownerId !== opts.ownerId) return null;
        const some = where.members?.some;
        if (some) {
          if (!opts.membershipRole || some.userId !== 'member') return null;
          if (some.role !== undefined && some.role !== opts.membershipRole) return null;
        }
        return { id: BIZ };
      }),
      findUnique: vi.fn(async () => ({ defaultTaxRate: opts.storedRate === undefined ? 12.5 : opts.storedRate })),
      update: vi.fn(),
    },
    financialAccount: { count: vi.fn() },
  };
  const service = new FinanceSettingsService({ client } as any);
  return { service, client };
}

describe('FinanceSettingsService.assertTaxRateOwner (owner ruling D-11, R0-09f)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a submission without defaultTaxRate (or with null, which update does not write) is returned as it is, with no owner lookup', async () => {
    const { service, client } = makeService();
    for (const input of [{ accountingBasis: 'ACCRUAL' as const }, { defaultTaxRate: null as unknown as number, fiscalYearStartMonth: 4 }]) {
      await expect(service.assertTaxRateOwner(BIZ, input, { id: 'member', role: 'USER' })).resolves.toBe(input);
    }
    expect(client.membership.findUnique).not.toHaveBeenCalled();
  });

  it("a STAFF or ADMIN member's change to the rate is refused: 403 BUSINESS_PROFILE_OWNER_ONLY naming defaultTaxRate", async () => {
    for (const role of ['STAFF', 'ADMIN']) {
      const { service, client } = makeService({ membershipRole: role, ownerId: 'someone-else' });
      const err = await service.assertTaxRateOwner(BIZ, { defaultTaxRate: 99, accountingBasis: 'ACCRUAL' }, { id: 'member', role: 'USER' })
        .then(() => null, (e) => e);
      expect(err, role).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: BUSINESS_PROFILE_OWNER_ONLY, fields: ['defaultTaxRate'] });
      expect(client.business.update).not.toHaveBeenCalled();
    }
  });

  it("a non-owner's resubmitted current rate is not a change: the submission goes through without defaultTaxRate (a stored NULL counts as 0, as get answers it)", async () => {
    for (const [stored, sent] of [[12.5, 12.5], [null, 0], [0, 0]] as const) {
      const { service } = makeService({ membershipRole: 'STAFF', storedRate: stored });
      const out = await service.assertTaxRateOwner(BIZ, { defaultTaxRate: sent, accountingBasis: 'ACCRUAL' }, { id: 'member', role: 'USER' });
      expect(out, `stored ${stored}`).toEqual({ accountingBasis: 'ACCRUAL' });
    }
  });

  it('the owner (an OWNER membership of this business) and a SUPER_ADMIN keep the rate in the submission; the recorded owner (Business.ownerId) holding no OWNER membership (none, STAFF or ADMIN) does not (owner rulings D-104, D-116)', async () => {
    const input = { defaultTaxRate: 15 };
    await expect(makeService({ membershipRole: 'OWNER' }).service.assertTaxRateOwner(BIZ, input, { id: 'member', role: 'USER' })).resolves.toBe(input);
    await expect(makeService({ membershipRole: 'OWNER', ownerId: 'member' }).service.assertTaxRateOwner(BIZ, input, { id: 'member', role: 'USER' })).resolves.toBe(input);
    await expect(makeService().service.assertTaxRateOwner(BIZ, input, { id: 'platform', role: 'SUPER_ADMIN' })).resolves.toBe(input);
    // Owner ruling D-116: the recorded owner holding only STAFF or ADMIN is that role; with no membership they are no member.
    for (const membershipRole of [undefined, 'STAFF', 'ADMIN']) {
      const { service, client } = makeService({ membershipRole, ownerId: 'member' });
      const err = await service.assertTaxRateOwner(BIZ, { defaultTaxRate: 15 }, { id: 'member', role: 'USER' }).then(() => null, (e) => e);
      expect(err, String(membershipRole)).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: BUSINESS_PROFILE_OWNER_ONLY, fields: ['defaultTaxRate'] });
      expect(client.business.update).not.toHaveBeenCalled();
    }
  });

  it('no authenticated actor is not the owner (fails closed), and the owner lookups are bound to the route business', async () => {
    const { service, client } = makeService({ membershipRole: 'OWNER', ownerId: 'member' });
    await expect(service.assertTaxRateOwner(BIZ, { defaultTaxRate: 5 }, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await service.assertTaxRateOwner(BIZ, { defaultTaxRate: 5 }, { id: 'member', role: 'USER' });
    expect(client.membership.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_businessId: { userId: 'member', businessId: BIZ } } }));
  });
});

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * R0-09f (owner ruling D-11): the refusal a non-owner gets on
 * PATCH /finance/businesses/:businessId/settings for a defaultTaxRate change;
 * the code the concierge, genesis and template refusals answer (R0-09b, R0-09d).
 */
export const BUSINESS_PROFILE_OWNER_ONLY = 'BUSINESS_PROFILE_OWNER_ONLY';

export interface FinanceSettings {
  accountingBasis: 'CASH' | 'ACCRUAL';
  fiscalYearStartMonth: number;
  defaultTaxRate: number;
  defaultCashAccountId: string | null;
  defaultArAccountId: string | null;
  defaultApAccountId: string | null;
  defaultTaxAccountId: string | null;
  currency: string;
  accountantEmail: string | null;
}

export interface UpdateFinanceSettingsInput {
  accountingBasis?: 'CASH' | 'ACCRUAL';
  fiscalYearStartMonth?: number;
  defaultTaxRate?: number;
  defaultCashAccountId?: string | null;
  defaultArAccountId?: string | null;
  defaultApAccountId?: string | null;
  defaultTaxAccountId?: string | null;
  accountantEmail?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * FIN5 — Single read/write surface over the seven business-level finance
 * preferences (basis, fiscal year, default accounts, default tax rate).
 */
@Injectable()
export class FinanceSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(businessId: string): Promise<FinanceSettings> {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        accountingBasis: true,
        fiscalYearStartMonth: true,
        defaultTaxRate: true,
        defaultCashAccountId: true,
        defaultArAccountId: true,
        defaultApAccountId: true,
        defaultTaxAccountId: true,
        currency: true,
        accountantEmail: true,
      },
    });
    if (!biz) throw new NotFoundException('Business not found');
    return {
      accountingBasis: ((biz.accountingBasis as 'CASH' | 'ACCRUAL' | null) ?? 'CASH'),
      fiscalYearStartMonth: biz.fiscalYearStartMonth ?? 1,
      defaultTaxRate: biz.defaultTaxRate ?? 0,
      defaultCashAccountId: biz.defaultCashAccountId ?? null,
      defaultArAccountId: biz.defaultArAccountId ?? null,
      defaultApAccountId: biz.defaultApAccountId ?? null,
      defaultTaxAccountId: biz.defaultTaxAccountId ?? null,
      currency: biz.currency ?? 'TTD',
      accountantEmail: biz.accountantEmail ?? null,
    };
  }

  /**
   * R0-09f-D11-FINANCE-TAX-AND-WEB, owner ruling D-11 (2026-10-31: editing the
   * business profile is OWNER only, regardless of granted scopes; found by the
   * R0-09d sweep). update writes Business.defaultTaxRate, the tax rate the
   * owner-only profile PATCH (PATCH /identity/businesses/:businessId, R0-09,
   * UpdateBusinessDto) writes, so a non-owner — STAFF or ADMIN, settings:write
   * included — who CHANGES it is refused the whole submission: 403
   * BUSINESS_PROFILE_OWNER_ONLY before anything is validated or written.
   *
   * Gated by field, not as a route: accountingBasis, fiscalYearStartMonth, the
   * four default account ids and accountantEmail are not owner-only fields and
   * keep the route's rule (ensureAccess: any member). The finance settings page
   * saves the whole form with the rate GET returned (get answers a stored NULL
   * as 0), so a non-owner's submission that carries the current rate is not a
   * change: it goes through with defaultTaxRate removed, and a non-owner never
   * writes the column. Returns the input update may write.
   *
   * The owner test is isProfileOwner.
   */
  async assertTaxRateOwner(
    businessId: string,
    input: UpdateFinanceSettingsInput,
    actor: { id?: string; role?: string } | undefined,
  ): Promise<UpdateFinanceSettingsInput> {
    if (input.defaultTaxRate == null) return input;
    if (await this.isProfileOwner(businessId, actor)) return input;
    const current = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { defaultTaxRate: true },
    });
    if (current && Number(input.defaultTaxRate) === (current.defaultTaxRate ?? 0)) {
      const rest: UpdateFinanceSettingsInput = { ...input };
      delete rest.defaultTaxRate;
      return rest;
    }
    throw new ForbiddenException({
      code: BUSINESS_PROFILE_OWNER_ONLY,
      message: 'Only the business owner can change the default tax rate.',
      fields: ['defaultTaxRate'],
    });
  }

  /**
   * Whether the actor is the business owner for owner ruling D-11
   * (R0-09f-D11-FINANCE-TAX-AND-WEB): the OWNER membership or the distinguished
   * owner (Business.ownerId), the two arms IdentityService.assertBusinessOwner
   * and BusinessGuard admit an owner by, both looked up on the route's
   * business; a SUPER_ADMIN keeps the platform bypass BusinessGuard grants.
   * The actor is the authenticated user AuthMiddleware attached (req.user);
   * none is not the owner (fails closed). The rule is restated rather than
   * imported, as R0-08c, R0-09b and R0-09d did (PresenceService.isSlugOwner,
   * OnboardingConciergeService, BusinessGenesisService and
   * TemplatesService.isProfileOwner): injecting IdentityService would need
   * FinanceModule to import IdentityModule, and finance.module.ts is outside
   * the R0-09f write set.
   */
  async isProfileOwner(businessId: string, actor: { id?: string; role?: string } | undefined): Promise<boolean> {
    if (!actor?.id) return false;
    if (actor.role === 'SUPER_ADMIN') return true;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actor.id, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return true;
    const owned = await this.prisma.client.business.findFirst({
      // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row.
      where: { id: businessId, ownerId: actor.id, members: { some: { userId: actor.id } } },
      select: { id: true },
    });
    return !!owned;
  }

  /** Owner-only (D-11) for defaultTaxRate: the controller runs assertTaxRateOwner first. */
  async update(businessId: string, input: UpdateFinanceSettingsInput): Promise<FinanceSettings> {
    if (input.accountingBasis && input.accountingBasis !== 'CASH' && input.accountingBasis !== 'ACCRUAL') {
      throw new BadRequestException('Accounting basis must be CASH or ACCRUAL');
    }
    if (input.fiscalYearStartMonth != null) {
      if (input.fiscalYearStartMonth < 1 || input.fiscalYearStartMonth > 12) {
        throw new BadRequestException('Fiscal year start month must be 1-12');
      }
    }
    if (input.defaultTaxRate != null && (input.defaultTaxRate < 0 || input.defaultTaxRate > 100)) {
      throw new BadRequestException('Default tax rate must be between 0 and 100');
    }

    // Validate any defaultXxxAccountId references belong to this business —
    // mis-pointed defaults silently corrupt postings downstream.
    const accountIds = [
      input.defaultCashAccountId,
      input.defaultArAccountId,
      input.defaultApAccountId,
      input.defaultTaxAccountId,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (accountIds.length > 0) {
      const found = await this.prisma.client.financialAccount.count({
        where: { businessId, id: { in: accountIds } },
      });
      if (found !== new Set(accountIds).size) {
        throw new BadRequestException('One or more default accounts do not belong to this business');
      }
    }

    if (input.accountantEmail != null && input.accountantEmail !== '') {
      if (!EMAIL_RE.test(input.accountantEmail.trim())) {
        throw new BadRequestException('Accountant email is not a valid email address');
      }
    }

    const data: Record<string, unknown> = {};
    if (input.accountingBasis != null) data.accountingBasis = input.accountingBasis;
    if (input.fiscalYearStartMonth != null) data.fiscalYearStartMonth = input.fiscalYearStartMonth;
    if (input.defaultTaxRate != null) data.defaultTaxRate = input.defaultTaxRate;
    if (input.defaultCashAccountId !== undefined) data.defaultCashAccountId = input.defaultCashAccountId;
    if (input.defaultArAccountId !== undefined) data.defaultArAccountId = input.defaultArAccountId;
    if (input.defaultApAccountId !== undefined) data.defaultApAccountId = input.defaultApAccountId;
    if (input.defaultTaxAccountId !== undefined) data.defaultTaxAccountId = input.defaultTaxAccountId;
    if (input.accountantEmail !== undefined) {
      const v = input.accountantEmail == null ? null : input.accountantEmail.trim();
      data.accountantEmail = v && v.length > 0 ? v : null;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.client.business.update({ where: { id: businessId }, data });
    }
    return this.get(businessId);
  }
}

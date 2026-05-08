import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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

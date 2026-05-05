import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { FinancialAccountSeederService } from './financial-account-seeder.service';

const ALLOWED_TYPES = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR', 'CREDIT_CARD', 'LOAN', 'EQUITY', 'TAX', 'OTHER']);

export interface CreateAccountInput {
  name: string;
  type: string;
  subtype?: string | null;
  currency?: string | null;
  openingBalance?: number | null;
  institution?: string | null;
  accountLast4?: string | null;
  isDefault?: boolean | null;
  chartOfAccountId?: string | null;
}

export type UpdateAccountInput = Partial<CreateAccountInput> & { isActive?: boolean };

/**
 * FIN5 — CRUD over FinancialAccount (Cash/Bank/Credit Card/etc).
 * The ChartOfAccount link is required by the schema, so when omitted the
 * service resolves the appropriate system COA bucket for the type.
 */
@Injectable()
export class FinanceAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountSeeder: FinancialAccountSeederService,
    private readonly coaSeeder: ChartOfAccountsSeederService,
  ) {}

  async list(businessId: string) {
    await this.accountSeeder.ensureDefaults(businessId);
    return this.prisma.client.financialAccount.findMany({
      where: { businessId },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { type: 'asc' }, { name: 'asc' }],
    });
  }

  private coaSystemKeyForType(type: string): string {
    switch (type) {
      case 'CASH': return 'CASH';
      case 'BANK': return 'BANK';
      case 'PAYMENT_PROCESSOR': return 'PAYMENT_PROCESSOR';
      case 'CREDIT_CARD': return 'CREDIT_CARD';
      case 'LOAN': return 'LOAN_PAYABLE';
      case 'EQUITY': return 'OWNER_EQUITY';
      case 'TAX': return 'TAX_PAYABLE';
      default: return 'CASH';
    }
  }

  async create(businessId: string, input: CreateAccountInput) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Account name is required');
    if (!ALLOWED_TYPES.has(input.type)) {
      throw new BadRequestException(`Unknown account type: ${input.type}`);
    }
    let coaId = input.chartOfAccountId ?? null;
    if (!coaId) {
      const coa = await this.coaSeeder.getBySystemKey(businessId, this.coaSystemKeyForType(input.type));
      if (!coa) throw new BadRequestException('Could not resolve chart-of-account for this type');
      coaId = coa.id;
    }
    const opening = Number(input.openingBalance ?? 0);
    return this.prisma.client.financialAccount.create({
      data: {
        businessId,
        chartOfAccountId: coaId,
        name,
        type: input.type,
        subtype: input.subtype ?? null,
        currency: input.currency ?? 'TTD',
        openingBalance: opening,
        currentBalance: opening,
        institution: input.institution ?? null,
        accountLast4: input.accountLast4 ?? null,
        isDefault: input.isDefault ?? false,
        isActive: true,
      },
    });
  }

  async update(businessId: string, id: string, input: UpdateAccountInput) {
    const existing = await this.prisma.client.financialAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');

    const data: Record<string, unknown> = {};
    if (input.name != null) data.name = input.name.trim();
    if (input.type != null) {
      if (!ALLOWED_TYPES.has(input.type)) throw new BadRequestException('Invalid type');
      data.type = input.type;
    }
    if (input.subtype !== undefined) data.subtype = input.subtype;
    if (input.currency != null) data.currency = input.currency;
    if (input.institution !== undefined) data.institution = input.institution;
    if (input.accountLast4 !== undefined) data.accountLast4 = input.accountLast4;
    if (input.isDefault != null) data.isDefault = input.isDefault;
    if (input.isActive != null) data.isActive = input.isActive;
    if (input.chartOfAccountId != null) data.chartOfAccountId = input.chartOfAccountId;

    return this.prisma.client.financialAccount.update({ where: { id }, data });
  }

  async archive(businessId: string, id: string) {
    const existing = await this.prisma.client.financialAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    // Soft archive — never hard-delete since LedgerEntry rows reference it.
    return this.prisma.client.financialAccount.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

interface DefaultAccountSeed {
  name: string;
  type: 'CASH' | 'BANK' | 'PAYMENT_PROCESSOR' | 'CREDIT_CARD' | 'LOAN' | 'EQUITY' | 'TAX' | 'OTHER';
  subtype?: string;
  systemKey: string;
  isDefault?: boolean;
}

const DEFAULT_ACCOUNTS: DefaultAccountSeed[] = [
  { name: 'Cash on Hand', type: 'CASH', systemKey: 'CASH', isDefault: true },
  { name: 'Bank Account', type: 'BANK', systemKey: 'BANK' },
];

/** Map provider strings (from `payments.provider`) to processor labels. */
const PROCESSOR_LABELS: Record<string, string> = {
  wipay: 'WiPay',
  paypal: 'PayPal',
  stripe: 'Stripe',
};

@Injectable()
export class FinancialAccountSeederService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coaSeeder: ChartOfAccountsSeederService,
  ) {}

  /**
   * Idempotently ensure each business has Cash + Bank, plus one
   * PAYMENT_PROCESSOR account per active payment provider seen in
   * historical Payment rows.
   */
  async ensureDefaults(businessId: string): Promise<void> {
    await this.coaSeeder.ensureDefaults(businessId);

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, currency: true },
    });
    if (!business) return;
    const currency = business.currency ?? 'TTD';

    // Existing accounts to skip on re-run.
    const existing = await this.prisma.client.financialAccount.findMany({
      where: { businessId },
      select: { name: true, subtype: true, type: true },
    });
    const haveByName = new Set(existing.map((a) => a.name.toLowerCase()));
    const haveProcessor = new Set(
      existing.filter((a) => a.type === 'PAYMENT_PROCESSOR').map((a) => a.subtype ?? ''),
    );

    // Cash + Bank — upsert against the (businessId, name) unique index
    // so concurrent first-runs are race-safe.
    for (const seed of DEFAULT_ACCOUNTS) {
      if (haveByName.has(seed.name.toLowerCase())) continue;
      const coa = await this.coaSeeder.getBySystemKey(businessId, seed.systemKey);
      if (!coa) continue;
      await this.prisma.client.financialAccount.upsert({
        where: { businessId_name: { businessId, name: seed.name } },
        create: {
          businessId,
          chartOfAccountId: coa.id,
          name: seed.name,
          type: seed.type,
          subtype: seed.subtype ?? null,
          currency,
          isDefault: seed.isDefault ?? false,
          isActive: true,
        },
        update: {},
      });
      haveByName.add(seed.name.toLowerCase());
    }

    // One processor per distinct historical Payment.provider that maps to
    // a known processor (skip 'cash', 'bank_transfer' — already covered).
    const processors = await this.prisma.client.payment.findMany({
      where: { businessId, provider: { in: Object.keys(PROCESSOR_LABELS) } },
      select: { provider: true },
      distinct: ['provider'],
    });
    if (processors.length > 0) {
      const processorCoa = await this.coaSeeder.getBySystemKey(businessId, 'PAYMENT_PROCESSOR');
      if (processorCoa) {
        for (const p of processors) {
          if (haveProcessor.has(p.provider)) continue;
          const label = PROCESSOR_LABELS[p.provider] ?? p.provider;
          if (haveByName.has(label.toLowerCase())) continue;
          await this.prisma.client.financialAccount.upsert({
            where: { businessId_name: { businessId, name: label } },
            create: {
              businessId,
              chartOfAccountId: processorCoa.id,
              name: label,
              type: 'PAYMENT_PROCESSOR',
              subtype: p.provider,
              currency,
              isDefault: false,
              isActive: true,
            },
            update: {},
          });
          haveProcessor.add(p.provider);
          haveByName.add(label.toLowerCase());
        }
      }
    }
  }
}

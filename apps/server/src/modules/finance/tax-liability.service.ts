import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService } from './posting.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

/**
 * FIN7 — Per-period tax liability rollups (VAT, Sales Tax, Business Levy).
 *
 * Sources of truth (cash basis MVP):
 *   - taxable sales / tax collected = SUM(Invoice.subtotal / Invoice.taxAmount)
 *     for invoices PAID in the period (paidAt window).
 *   - tax paid on purchases = 0 (Expense schema does not yet carry taxAmount;
 *     TODO once FIN3 grows an expense.taxAmount column).
 *   - amountDue = taxCollected - taxPaid.
 *
 * Open periods are recomputed in place. Once a period is FILED, recompute
 * writes a sibling AMENDED row instead of mutating the locked figures.
 */

export type TaxPeriodKind = 'MONTH' | 'QUARTER' | 'YEAR';

export interface TaxPeriodRange {
  type: string; // VAT | BUSINESS_LEVY | SALES_TAX
  periodStart: Date;
  periodEnd: Date;
  kind: TaxPeriodKind;
}

const TWO_DP = 4; // Decimal scale matches schema (Decimal(18,4)).

@Injectable()
export class TaxLiabilityService {
  private readonly logger = new Logger(TaxLiabilityService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(ChartOfAccountsSeederService) private readonly coa: ChartOfAccountsSeederService,
  ) {}

  // ---------------------------------------------------------------------
  // Period helpers
  // ---------------------------------------------------------------------

  /** Trinidad-anchored start of month for a given date. */
  private monthStart(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  private monthEnd(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0) - 1);
  }
  private quarterStart(d: Date): Date {
    const q = Math.floor(d.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(d.getUTCFullYear(), q, 1, 0, 0, 0, 0));
  }
  private quarterEnd(d: Date): Date {
    const q = Math.floor(d.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(d.getUTCFullYear(), q + 3, 1, 0, 0, 0, 0) - 1);
  }
  private yearStart(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  }
  private yearEnd(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0) - 1);
  }

  /**
   * Return all periods this rollup tick should compute for `now`.
   * VAT — bi-monthly (we collapse to monthly here for granularity);
   * Business Levy — quarterly.
   */
  private periodsFor(now: Date): TaxPeriodRange[] {
    return [
      { type: 'VAT', periodStart: this.monthStart(now), periodEnd: this.monthEnd(now), kind: 'MONTH' },
      // Sales Tax — monthly remittance, computed identically to VAT
      // (collected from invoice tax / TAX_PAYABLE credits), kept as a
      // distinct row so jurisdictions that use Sales Tax (not VAT) get
      // their own filing record.
      { type: 'SALES_TAX', periodStart: this.monthStart(now), periodEnd: this.monthEnd(now), kind: 'MONTH' },
      { type: 'BUSINESS_LEVY', periodStart: this.quarterStart(now), periodEnd: this.quarterEnd(now), kind: 'QUARTER' },
    ];
  }

  // ---------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------

  /**
   * Look up the configured rate for a given tax type from the persisted
   * TaxRate table. Falls back to the seed default for the type if the
   * business hasn't customised it. Returns a fraction (0.006 = 0.6%).
   */
  private async resolveRate(businessId: string, type: string): Promise<number> {
    const row = await this.prisma.client.taxRate.findFirst({
      where: { businessId, isActive: true, type: { equals: type, mode: 'insensitive' } },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: { rate: true },
    });
    if (row?.rate != null) {
      const n = Number(row.rate);
      // Heuristic: schema stores percent or fraction. Treat values >= 1 as
      // percent (e.g. 0.6 stored as "0.6" means 0.6%, but 12.5 means 12.5%).
      return n >= 1 ? n / 100 : n;
    }
    // Seed defaults — TT MVP. Not jurisdiction-aware; configure in Settings.
    const SEED: Record<string, number> = { BUSINESS_LEVY: 0.006, GREEN_FUND: 0.003 };
    return SEED[type] ?? 0;
  }

  private async aggregatePeriod(
    businessId: string,
    range: TaxPeriodRange,
  ): Promise<{ taxableSales: number; taxCollected: number; taxPaid: number }> {
    // Ledger-first: VAT collected = net credits to TAX_PAYABLE in period.
    // Filing payments (Dr TAX_PAYABLE / Cr CASH) are excluded so they do
    // not reduce the period's collected tax. If the COA hasn't seen any
    // tax postings yet (e.g. revenue-posting hasn't started splitting tax
    // onto TAX_PAYABLE), we fall back to invoice taxAmount as the source
    // of truth and flag the period notes for transparency.
    const taxAccount = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey: 'TAX_PAYABLE' },
      select: { id: true },
    });

    let ledgerTaxCollected = 0;
    let hasLedgerTaxPostings = false;
    if (taxAccount) {
      // Exclude TAX-typed transactions — those are filing payments
      // (Dr TAX_PAYABLE / Cr CASH) and would cancel out the collection
      // they are settling.
      const entries = await this.prisma.client.ledgerEntry.findMany({
        where: {
          businessId,
          accountId: taxAccount.id,
          date: { gte: range.periodStart, lte: range.periodEnd },
        },
        select: { credit: true, debit: true, transaction: { select: { type: true } } },
      });
      for (const e of entries) {
        if (e.transaction?.type === 'TAX') continue;
        hasLedgerTaxPostings = true;
        ledgerTaxCollected += Number(e.credit ?? 0) - Number(e.debit ?? 0);
      }
    }

    // Invoice-side aggregation — used both for taxable-sales basis and as
    // the fallback for taxCollected when nothing has hit TAX_PAYABLE yet.
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: range.periodStart, lte: range.periodEnd },
      },
      select: { subtotal: true, taxAmount: true },
    });
    let taxableSales = 0;
    let invoiceTaxCollected = 0;
    for (const inv of invoices) {
      const sub = Number(inv.subtotal ?? 0);
      const tax = Number(inv.taxAmount ?? 0);
      if (range.type === 'VAT' || range.type === 'SALES_TAX') {
        if (tax > 0) {
          taxableSales += sub;
          invoiceTaxCollected += tax;
        }
      } else if (range.type === 'BUSINESS_LEVY') {
        taxableSales += sub;
      }
    }

    let taxCollected = 0;
    if (range.type === 'VAT' || range.type === 'SALES_TAX') {
      // Use ledger numbers when ANY tax postings exist for the period —
      // even if they net to zero or negative (refunds/adjustments). Falling
      // back on `> 0` would silently overstate liability for periods with
      // legitimate negative net activity.
      taxCollected = hasLedgerTaxPostings ? ledgerTaxCollected : invoiceTaxCollected;
    } else if (range.type === 'BUSINESS_LEVY') {
      // Business Levy is a % of net revenue; rate from configured TaxRate.
      const rate = await this.resolveRate(businessId, 'BUSINESS_LEVY');
      taxCollected = Math.round(taxableSales * rate * 100) / 100;
    }

    // Input tax — tax paid on purchases for the period. Meaningful for
    // VAT and Sales Tax (Business Levy is a turnover tax, no input credit).
    let taxPaid = 0;
    if (range.type === 'VAT' || range.type === 'SALES_TAX') {
      const expAgg = await this.prisma.client.expense.aggregate({
        where: {
          businessId,
          deletedAt: null,
          status: { not: 'VOID' },
          date: { gte: range.periodStart, lte: range.periodEnd },
        },
        _sum: { taxAmount: true },
      });
      taxPaid = Number(expAgg._sum.taxAmount ?? 0);
    }

    return {
      taxableSales: round(taxableSales),
      taxCollected: round(taxCollected),
      taxPaid: round(taxPaid),
    };
  }

  // ---------------------------------------------------------------------
  // Recompute / list / get
  // ---------------------------------------------------------------------

  async recompute(businessId: string, now: Date = new Date()) {
    const ranges = this.periodsFor(now);
    const out: Array<{ id: string; type: string; status: string; amountDue: number }> = [];
    for (const range of ranges) {
      const agg = await this.aggregatePeriod(businessId, range);
      const amountDue = round(agg.taxCollected - agg.taxPaid);

      // Canonical (non-amendment) row for this period — partial unique
      // index ensures at most one exists.
      const existing = await this.prisma.client.taxLiability.findFirst({
        where: {
          businessId,
          type: range.type,
          periodStart: range.periodStart,
          periodEnd: range.periodEnd,
          isAmendment: false,
        },
      });

      if (!existing) {
        const created = await this.prisma.client.taxLiability.create({
          data: {
            businessId,
            type: range.type,
            periodStart: range.periodStart,
            periodEnd: range.periodEnd,
            taxableSales: agg.taxableSales,
            taxCollected: agg.taxCollected,
            taxPaid: agg.taxPaid,
            amountDue,
            status: 'OPEN',
          },
        });
        out.push({ id: created.id, type: created.type, status: created.status, amountDue });
        continue;
      }

      if (existing.status === 'FILED' || existing.status === 'PAID') {
        // Once filed, never silently mutate the locked row. Materialise an
        // amendment row pointing back at the original via amendsTaxLiabilityId.
        // Period boundaries stay canonical; uniqueness is preserved by the
        // partial unique index on rows where is_amendment=false.
        const latest = await this.prisma.client.taxLiability.findFirst({
          where: { businessId, type: range.type, periodStart: range.periodStart, periodEnd: range.periodEnd },
          orderBy: { version: 'desc' },
          select: { version: true, taxableSales: true, taxCollected: true, taxPaid: true, amountDue: true, isAmendment: true, id: true },
        });
        const same =
          latest &&
          Number(latest.taxableSales) === agg.taxableSales &&
          Number(latest.taxCollected) === agg.taxCollected &&
          Number(latest.taxPaid) === agg.taxPaid &&
          Number(latest.amountDue) === amountDue;
        if (same && latest?.isAmendment) {
          out.push({ id: latest.id, type: range.type, status: 'AMENDED', amountDue });
          continue;
        }
        if (same) {
          out.push({ id: existing.id, type: existing.type, status: existing.status, amountDue });
          continue;
        }
        const nextVersion = (latest?.version ?? existing.version ?? 1) + 1;
        const amendment = await this.prisma.client.taxLiability.create({
          data: {
            businessId,
            type: range.type,
            periodStart: range.periodStart,
            periodEnd: range.periodEnd,
            taxableSales: agg.taxableSales,
            taxCollected: agg.taxCollected,
            taxPaid: agg.taxPaid,
            amountDue,
            status: 'AMENDED',
            isAmendment: true,
            amendsTaxLiabilityId: existing.id,
            version: nextVersion,
            notes: `Amendment v${nextVersion} of ${existing.id} — original was ${existing.status}.`,
          },
        });
        out.push({ id: amendment.id, type: amendment.type, status: 'AMENDED', amountDue });
        continue;
      }

      const updated = await this.prisma.client.taxLiability.update({
        where: { id: existing.id },
        data: {
          taxableSales: agg.taxableSales,
          taxCollected: agg.taxCollected,
          taxPaid: agg.taxPaid,
          amountDue,
        },
      });
      out.push({ id: updated.id, type: updated.type, status: updated.status, amountDue });
    }
    return { computed: out, computedAt: new Date().toISOString() };
  }

  async list(businessId: string, status?: string) {
    return this.prisma.client.taxLiability.findMany({
      where: {
        businessId,
        ...(status ? { status } : {}),
      },
      orderBy: [{ periodEnd: 'desc' }, { type: 'asc' }],
    });
  }

  async get(businessId: string, id: string) {
    const row = await this.prisma.client.taxLiability.findFirst({
      where: { id, businessId },
    });
    if (!row) throw new NotFoundException('Tax liability not found');
    return row;
  }

  /**
   * Drill-down: return the invoices that contributed to the tax-collected
   * figure for this period. Used by the Tax tab to make every number
   * traceable.
   */
  async contributingInvoices(businessId: string, id: string) {
    const liability = await this.get(businessId, id);
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: liability.periodStart, lte: liability.periodEnd },
        ...(liability.type === 'VAT' || liability.type === 'SALES_TAX' ? { taxAmount: { gt: 0 } } : {}),
      },
      orderBy: { paidAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        paidAt: true,
        subtotal: true,
        taxRate: true,
        taxAmount: true,
        total: true,
        currency: true,
        contact: { select: { firstName: true, lastName: true, displayName: true, email: true } },
      },
    });
    return { liability, invoices };
  }

  // ---------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------

  async file(businessId: string, id: string, dueDate?: Date | null, notes?: string | null) {
    const row = await this.get(businessId, id);
    if (row.status !== 'OPEN' && row.status !== 'AMENDED') {
      throw new ConflictException(`Cannot file a ${row.status} period`);
    }
    return this.prisma.client.taxLiability.update({
      where: { id },
      data: {
        status: 'FILED',
        dueDate: dueDate ?? row.dueDate ?? null,
        notes: notes ?? row.notes,
      },
    });
  }

  async pay(
    businessId: string,
    id: string,
    opts: { paymentDate?: Date; notes?: string | null; userId?: string | null } = {},
  ) {
    const row = await this.get(businessId, id);
    if (row.status === 'PAID') return row;
    if (row.status !== 'FILED' && row.status !== 'OPEN' && row.status !== 'AMENDED') {
      throw new ConflictException(`Cannot pay a ${row.status} period`);
    }

    const amount = Number(row.amountDue ?? 0);
    if (amount <= 0) {
      throw new BadRequestException('Nothing to pay — amount due is zero');
    }

    const taxPayable = await this.coa.getBySystemKey(businessId, 'TAX_PAYABLE');
    if (!taxPayable) throw new BadRequestException('Chart of Accounts not seeded — missing TAX_PAYABLE');

    // Settlement account: prefer CASH, fall back to BANK then
    // PAYMENT_PROCESSOR. This keeps tenants who run a bank-only or
    // processor-only book from being blocked by an artificial CASH gate.
    const settlement =
      (await this.coa.getBySystemKey(businessId, 'CASH')) ??
      (await this.coa.getBySystemKey(businessId, 'BANK')) ??
      (await this.coa.getBySystemKey(businessId, 'PAYMENT_PROCESSOR'));
    if (!settlement) {
      throw new BadRequestException(
        'No settlement account available — seed CASH, BANK, or PAYMENT_PROCESSOR in the Chart of Accounts',
      );
    }

    const date = opts.paymentDate ?? new Date();
    await this.posting.post({
      businessId,
      type: 'TAX',
      date,
      amount,
      description: `Tax payment — ${row.type} ${row.periodStart.toISOString().slice(0, 10)} → ${row.periodEnd.toISOString().slice(0, 10)}`,
      sourceType: 'TaxLiability',
      sourceId: row.id,
      kind: 'paid',
      createdById: opts.userId ?? null,
      entries: [
        { accountId: taxPayable.id, debit: amount, memo: 'Tax payable settled' },
        { accountId: settlement.id, credit: amount, memo: 'Tax payment' },
      ],
    });

    return this.prisma.client.taxLiability.update({
      where: { id },
      data: {
        status: 'PAID',
        notes: opts.notes ?? row.notes,
      },
    });
  }
}

function round(n: number): number {
  return Math.round(n * Math.pow(10, TWO_DP)) / Math.pow(10, TWO_DP);
}

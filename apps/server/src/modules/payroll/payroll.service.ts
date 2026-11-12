import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { skipTenantIsolation } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ExpensePostingService } from '../finance/expense-posting.service';
import {
  convertToBaseOrThrow,
  invalidateBusinessFinancialSnapshotCache,
  loadLatestExchangeRates,
  normalizeCurrencyCode,
  type ExchangeRateRow,
} from '../finance/finance-accounting.util';

export interface PayRateInput {
  assignmentId: string;
  amount: number;
  currency?: string;
  periodType?: 'hourly' | 'monthly';
}

export interface PayrollRunFilters {
  status?: string;
  limit?: number;
}

export interface MarkRunPaidInput {
  paymentAccountId?: string | null;
  paymentMethod?: string | null;
}

const VALID_PAYROLL_PAYMENT_METHODS = new Set([
  'cash',
  'bank',
  'bank_transfer',
  'transfer',
  'wire',
  'ach',
  'cheque',
  'check',
  'wipay',
  'paypal',
  'stripe',
  'processor',
]);

const VALID_DISBURSEMENT_ACCOUNT_TYPES = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

/**
 * Payroll MVP: rates per staff position (OrgAssignment) + pay runs
 * generated from logged time entries (hourly) or flat salaries (monthly).
 * Approve and pay are separate, tier-3-gated transitions — money never
 * moves without a human approving the run first.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(ExpensePostingService) private readonly expensePosting?: ExpensePostingService,
  ) {}

  // ── Rates ──────────────────────────────────────────────────────────────

  async setRate(businessId: string, input: PayRateInput) {
    const assignment = await this.prisma.client.orgAssignment.findFirst({
      where: { id: input.assignmentId, businessId },
    });
    if (!assignment) throw new NotFoundException('Staff assignment not found');
    if (!(input.amount > 0)) throw new BadRequestException('amount must be positive');

    return this.prisma.client.payRate.create({
      data: {
        businessId,
        assignmentId: input.assignmentId,
        amount: input.amount,
        currency: normalizeCurrencyCode(input.currency, 'TTD'),
        periodType: input.periodType ?? 'hourly',
        effectiveFrom: new Date(),
      },
    });
  }

  /** Latest effective rate per assignment. */
  async listRates(businessId: string) {
    const rates = await this.prisma.client.payRate.findMany({
      where: { businessId },
      orderBy: { effectiveFrom: 'desc' },
      include: { assignment: true },
    });
    const latest = new Map<string, typeof rates[number]>();
    for (const rate of rates) {
      if (!latest.has(rate.assignmentId)) latest.set(rate.assignmentId, rate);
    }
    return [...latest.values()].map((r) => ({
      id: r.id,
      assignmentId: r.assignmentId,
      staffName: this.assignmentName(r.assignment),
      amount: Number(r.amount),
      currency: r.currency,
      periodType: r.periodType,
      effectiveFrom: r.effectiveFrom,
    }));
  }

  private assignmentName(a: { contactName: string | null; contactEmail: string | null; userId: string | null } | null): string {
    if (!a) return 'Unknown';
    return a.contactName ?? a.contactEmail ?? a.userId ?? 'Staff member';
  }

  private async currentRate(businessId: string, assignmentId: string, asOf: Date) {
    return this.prisma.client.payRate.findFirst({
      where: { businessId, assignmentId, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // ── Run generation ─────────────────────────────────────────────────────

  async generateRun(
    businessId: string,
    periodStart: Date,
    periodEnd: Date,
    opts?: { notes?: string; userId?: string; currency?: string },
  ) {
    if (!(periodStart < periodEnd)) throw new BadRequestException('periodStart must be before periodEnd');

    const overlap = await this.prisma.client.payrollRun.findFirst({
      where: {
        businessId,
        status: { not: 'VOID' },
        periodStart: { lt: periodEnd },
        periodEnd: { gt: periodStart },
      },
    });
    if (overlap) {
      throw new BadRequestException(`A payroll run already overlaps this period (${overlap.id}, status ${overlap.status})`);
    }

    const rates = await this.listRates(businessId);
    if (rates.length === 0) {
      throw new BadRequestException('No pay rates configured — set staff rates first (payroll_set_rate)');
    }

    const rateCurrencies = Array.from(
      new Set(rates.map((r) => normalizeCurrencyCode(r.currency, 'TTD'))),
    );
    const business = this.prisma.client.business?.findUnique
      ? await this.prisma.client.business.findUnique({
          where: { id: businessId },
          select: { currency: true },
        })
      : null;

    const runCurrency = opts?.currency
      ? normalizeCurrencyCode(opts.currency, 'TTD')
      : rateCurrencies.length === 1
        ? rateCurrencies[0]
        : normalizeCurrencyCode(business?.currency, rateCurrencies[0] ?? 'TTD');

    const needsConversion = rateCurrencies.some((c) => c !== runCurrency);
    let exchangeRates: ExchangeRateRow[] = [];
    if (needsConversion) {
      exchangeRates = await loadLatestExchangeRates(this.prisma.client.exchangeRate, businessId);
      for (const rc of rateCurrencies) {
        if (rc !== runCurrency) {
          convertToBaseOrThrow(1, rc, runCurrency, exchangeRates, 'payroll run');
        }
      }
    }

    const items: Array<{ assignmentId: string; hoursWorked: number | null; grossPay: number; currency: string; notes?: string }> = [];

    for (const rate of rates) {
      const assignment = await this.prisma.client.orgAssignment.findFirst({ where: { id: rate.assignmentId } });
      if (!assignment) continue;

      const rateCurrency = normalizeCurrencyCode(rate.currency, runCurrency);

      if (rate.periodType === 'monthly') {
        const convertedGross =
          rateCurrency === runCurrency
            ? rate.amount
            : convertToBaseOrThrow(rate.amount, rateCurrency, runCurrency, exchangeRates, 'payroll run');
        items.push({
          assignmentId: rate.assignmentId,
          hoursWorked: null,
          grossPay: convertedGross,
          currency: runCurrency,
          notes:
            rateCurrency === runCurrency
              ? 'Monthly salary'
              : `Monthly salary (${rateCurrency} ${rate.amount.toFixed(2)} converted to ${runCurrency})`,
        });
        continue;
      }

      // Hourly: sum billable time in the period for this assignment's user.
      let hoursWorked = 0;
      if (assignment.userId) {
        const agg = await this.prisma.client.timeEntry.aggregate({
          where: {
            businessId,
            userId: assignment.userId,
            billable: true,
            startTime: { gte: periodStart, lt: periodEnd },
          },
          _sum: { durationMinutes: true },
        });
        hoursWorked = (agg._sum.durationMinutes ?? 0) / 60;
      }

      const rawGross = Math.round(hoursWorked * rate.amount * 100) / 100;
      const convertedGross =
        rateCurrency === runCurrency
          ? rawGross
          : convertToBaseOrThrow(rawGross, rateCurrency, runCurrency, exchangeRates, 'payroll run');

      items.push({
        assignmentId: rate.assignmentId,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        grossPay: convertedGross,
        currency: runCurrency,
        notes:
          hoursWorked > 0
            ? rateCurrency === runCurrency
              ? `${hoursWorked.toFixed(2)}h × ${rate.amount}`
              : `${hoursWorked.toFixed(2)}h × ${rateCurrency} ${rate.amount} (converted to ${runCurrency})`
            : 'No logged hours',
      });
    }

    const totalGross = Math.round(items.reduce((s, i) => s + i.grossPay, 0) * 100) / 100;

    const createdRun = await this.prisma.client.payrollRun.create({
      data: {
        businessId,
        periodStart,
        periodEnd,
        status: 'DRAFT',
        totalGross,
        currency: runCurrency,
        itemCount: items.length,
        notes: opts?.notes,
        items: { create: items.map((i) => ({ ...i, businessId })) },
      },
      include: { items: true },
    });
    invalidateBusinessFinancialSnapshotCache(businessId);
    return createdRun;
  }

  // ── Runs ───────────────────────────────────────────────────────────────

  async listRuns(businessId: string, filters: PayrollRunFilters = {}) {
    const runs = await this.prisma.client.payrollRun.findMany({
      where: { businessId, ...(filters.status ? { status: filters.status } : {}) },
      orderBy: { periodEnd: 'desc' },
      take: filters.limit ?? 20,
    });
    return runs.map((r) => ({
      id: r.id,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      totalGross: Number(r.totalGross),
      currency: r.currency,
      itemCount: r.itemCount,
    }));
  }

  async getRun(businessId: string, runId: string) {
    const run = await this.prisma.client.payrollRun.findFirst({
      where: { id: runId, businessId },
      include: { items: { include: { assignment: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return {
      ...run,
      totalGross: Number(run.totalGross),
      items: run.items.map((i) => ({
        id: i.id,
        assignmentId: i.assignmentId,
        staffName: this.assignmentName(i.assignment),
        hoursWorked: i.hoursWorked === null ? null : Number(i.hoursWorked),
        grossPay: Number(i.grossPay),
        currency: i.currency,
        notes: i.notes,
      })),
    };
  }

  // ── Tier-3 transitions ─────────────────────────────────────────────────

  async approveRun(businessId: string, runId: string, userId?: string) {
    const run = await this.getRun(businessId, runId);
    if (run.status !== 'DRAFT') {
      throw new BadRequestException(`Run is ${run.status} — only DRAFT runs can be approved`);
    }
    const approvedRun = await this.prisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: userId ?? null },
    });
    invalidateBusinessFinancialSnapshotCache(businessId);
    return approvedRun;
  }

  async markRunPaid(
    businessId: string,
    runId: string,
    paymentInput?: string | MarkRunPaidInput,
  ) {
    if (!this.expensePosting) {
      throw new InternalServerErrorException(
        'ExpensePostingService is required to mark payroll runs paid',
      );
    }
    if (typeof this.prisma.client.$transaction !== 'function') {
      throw new InternalServerErrorException(
        'Database transaction support is required to mark payroll runs paid',
      );
    }

    const opts: MarkRunPaidInput =
      typeof paymentInput === 'string'
        ? { paymentMethod: paymentInput }
        : (paymentInput ?? {});

    const rawAccountId = (opts.paymentAccountId ?? '').trim();
    const rawMethod = (opts.paymentMethod ?? '').trim().toLowerCase();

    if (!rawAccountId && !rawMethod) {
      throw new BadRequestException(
        'A payment account (paymentAccountId) or payment method (paymentMethod) is required to mark a payroll run paid',
      );
    }
    if (rawMethod && !VALID_PAYROLL_PAYMENT_METHODS.has(rawMethod)) {
      throw new BadRequestException(
        `Invalid payroll paymentMethod "${opts.paymentMethod}". Allowed values: cash, bank_transfer, wire, ach, cheque, wipay, paypal, stripe`,
      );
    }

    const paidRun = await this.prisma.client.$transaction(async (rawTx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = rawTx as any;

      const currentRun = tx.payrollRun?.findFirst
        ? await tx.payrollRun.findFirst({
            where: { id: runId, businessId },
            include: { items: { include: { assignment: true } } },
          })
        : await this.getRun(businessId, runId);

      if (!currentRun) {
        throw new NotFoundException('Payroll run not found');
      }

      let resolvedAccountId: string | null = null;
      let resolvedCoaId: string | null = null;
      let resolvedMethod: string | null = rawMethod || null;

      if (rawAccountId) {
        const faDelegate = tx.financialAccount ?? this.prisma.client.financialAccount;
        if (!faDelegate) {
          throw new BadRequestException('FinancialAccount lookup unavailable');
        }
        const account = faDelegate.findUnique
          ? await faDelegate.findUnique(
              skipTenantIsolation({
                where: { id: rawAccountId },
                select: {
                  id: true,
                  businessId: true,
                  type: true,
                  subtype: true,
                  chartOfAccountId: true,
                  isActive: true,
                  currency: true,
                },
              }),
            )
          : await faDelegate.findFirst(
              skipTenantIsolation({
                where: { id: rawAccountId },
                select: {
                  id: true,
                  businessId: true,
                  type: true,
                  subtype: true,
                  chartOfAccountId: true,
                  isActive: true,
                  currency: true,
                },
              }),
            );

        if (!account) {
          throw new BadRequestException(`Payment account ${rawAccountId} not found`);
        }
        if (account.businessId !== businessId) {
          throw new BadRequestException(
            `Cross-business payment account access blocked: ${rawAccountId}`,
          );
        }
        if (!account.isActive) {
          throw new BadRequestException(
            `Payment account ${rawAccountId} is inactive and cannot disburse payroll`,
          );
        }
        if (!VALID_DISBURSEMENT_ACCOUNT_TYPES.has(account.type)) {
          throw new BadRequestException(
            `Invalid payment account type "${account.type}" — payroll must be paid from an active CASH, BANK, or PAYMENT_PROCESSOR account`,
          );
        }

        const runCurrency = normalizeCurrencyCode(currentRun.currency, 'TTD');
        const acctCurrency = normalizeCurrencyCode(account.currency, runCurrency);
        if (acctCurrency !== runCurrency) {
          throw new BadRequestException(
            `Payment account currency (${acctCurrency}) does not match payroll run currency (${runCurrency})`,
          );
        }

        resolvedAccountId = account.id;
        resolvedCoaId = account.chartOfAccountId;
        if (!resolvedMethod) {
          resolvedMethod =
            account.type === 'CASH'
              ? 'cash'
              : account.type === 'PAYMENT_PROCESSOR'
                ? account.subtype || 'processor'
                : 'bank_transfer';
        }
      } else if (rawMethod) {
        const faDelegate = tx.financialAccount ?? this.prisma.client.financialAccount;
        if (faDelegate?.findFirst) {
          const namedProcessors = new Set(['wipay', 'paypal', 'stripe']);
          const expectedType =
            rawMethod === 'cash'
              ? 'CASH'
              : namedProcessors.has(rawMethod) || rawMethod === 'processor'
                ? 'PAYMENT_PROCESSOR'
                : 'BANK';
          const expectedSubtype = namedProcessors.has(rawMethod) ? rawMethod : undefined;
          const runCurrency = normalizeCurrencyCode(currentRun.currency, 'TTD');
          const matchedAccount = await faDelegate.findFirst({
            where: {
              businessId,
              type: expectedType,
              ...(expectedSubtype ? { subtype: expectedSubtype } : {}),
              isActive: true,
              currency: runCurrency,
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              businessId: true,
              type: true,
              subtype: true,
              chartOfAccountId: true,
              isActive: true,
              currency: true,
            },
          });
          if (
            !matchedAccount ||
            !matchedAccount.isActive ||
            matchedAccount.type !== expectedType ||
            (expectedSubtype &&
              matchedAccount.subtype !== undefined &&
              (matchedAccount.subtype ?? '').toLowerCase().trim() !== expectedSubtype) ||
            normalizeCurrencyCode(matchedAccount.currency, runCurrency) !== runCurrency
          ) {
            throw new BadRequestException(
              `No active ${runCurrency} ${expectedType}${expectedSubtype ? ` (${expectedSubtype})` : ''} financial account found for paymentMethod "${rawMethod}"; specify paymentAccountId or configure an active account first`,
            );
          }
          resolvedAccountId = matchedAccount.id;
          resolvedCoaId = matchedAccount.chartOfAccountId ?? null;
        }
      }

      // Idempotent retry: if the run is already PAID, ensure the ledger posting
      // exists (via PostingService's externalRef idempotency) and return the
      // existing paid run without re-transitioning or double-posting.
      if (currentRun.status === 'PAID') {
        const existingPaidAt = currentRun.paidAt ? new Date(currentRun.paidAt) : new Date();
        await this.expensePosting!.onPayrollRunPaid(
          {
            id: currentRun.id,
            businessId,
            totalGross: Number(currentRun.totalGross),
            currency: currentRun.currency,
            paidAt: existingPaidAt,
            periodStart: new Date(currentRun.periodStart),
            periodEnd: new Date(currentRun.periodEnd),
            paymentMethod: resolvedMethod,
            paymentAccountId: resolvedAccountId,
            paymentCoaId: resolvedCoaId,
            notes: currentRun.notes ?? null,
          },
          tx as Prisma.TransactionClient,
        );
        return currentRun;
      }

      if (currentRun.status !== 'APPROVED') {
        throw new BadRequestException(
          `Run is ${currentRun.status} — it must be APPROVED before marking paid`,
        );
      }

      const paidAt = new Date();
      let updated: typeof currentRun;

      if (typeof tx.payrollRun.updateMany === 'function') {
        const claim = await tx.payrollRun.updateMany({
          where: { id: runId, businessId, status: 'APPROVED' },
          data: { status: 'PAID', paidAt },
        });
        if (!claim || claim.count === 0) {
          throw new ConflictException(
            `Payroll run ${runId} is already being processed or is no longer in APPROVED state`,
          );
        }
        updated = tx.payrollRun.findFirst
          ? ((await tx.payrollRun.findFirst({ where: { id: runId, businessId } })) ?? {
              ...currentRun,
              status: 'PAID',
              paidAt,
            })
          : { ...currentRun, status: 'PAID', paidAt };
      } else {
        updated = await tx.payrollRun.update({
          where: { id: runId },
          data: { status: 'PAID', paidAt },
        });
      }

      const gross = Number(currentRun.totalGross);
      const postResult = await this.expensePosting!.onPayrollRunPaid(
        {
          id: currentRun.id,
          businessId,
          totalGross: gross,
          currency: currentRun.currency,
          paidAt,
          periodStart: new Date(currentRun.periodStart),
          periodEnd: new Date(currentRun.periodEnd),
          paymentMethod: resolvedMethod,
          paymentAccountId: resolvedAccountId,
          paymentCoaId: resolvedCoaId,
          notes: currentRun.notes ?? null,
        },
        tx as Prisma.TransactionClient,
      );

      if (gross > 0 && (!postResult || !postResult.transactionId)) {
        throw new InternalServerErrorException(
          `Failed to create mandatory ledger posting for payroll run ${runId}`,
        );
      }

      return updated;
    });
    invalidateBusinessFinancialSnapshotCache(businessId);
    return paidRun;
  }
}

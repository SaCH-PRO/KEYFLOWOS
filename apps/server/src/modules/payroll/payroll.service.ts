import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ExpensePostingService, PAYROLL_DISBURSEMENT_METHODS } from '../finance/expense-posting.service';
import { invalidateBusinessFinancialSnapshotCache } from '../finance/finance-accounting.util';
import { normalizeCurrency } from '../finance/posting.service';

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

/**
 * PR195-PORT: how a run is marked paid. One of `paymentAccountId` (a cash-class
 * FinancialAccount of the run's business, in the run's currency) or
 * `paymentMethod` (PAYROLL_DISBURSEMENT_METHODS) is required. `actorId` is who
 * the ledger posting names: the signed-in member on REST, KEY's system actor on
 * KEY, with `initiatedBy` the member KEY ran for (audit data, never authority).
 * Both are set by the server (the controller, the KEY dispatcher), never read
 * from a request body.
 */
export interface MarkRunPaidInput {
  paymentAccountId?: string | null;
  paymentMethod?: string | null;
  actorId?: string | null;
  initiatedBy?: string | null;
}

/** The FinancialAccount types money can leave by, and the chart rows they keep cash in (V1-34). */
const DISBURSEMENT_ACCOUNT_TYPES = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);
const CASH_CLASS_SYSTEM_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

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
    // PR195-PORT: the ledger door's payroll recipe. Optional only so hand-built
    // instances keep constructing; mark-paid refuses (503) without it rather
    // than paying a run with no books.
    @Optional() @Inject(ExpensePostingService) private readonly expensePosting?: ExpensePostingService | null,
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
        currency: input.currency ?? 'TTD',
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

  async generateRun(businessId: string, periodStart: Date, periodEnd: Date, opts?: { notes?: string; userId?: string }) {
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

    const items: Array<{ assignmentId: string; hoursWorked: number | null; grossPay: number; currency: string; notes?: string }> = [];

    for (const rate of rates) {
      const assignment = await this.prisma.client.orgAssignment.findFirst({ where: { id: rate.assignmentId } });
      if (!assignment) continue;

      if (rate.periodType === 'monthly') {
        items.push({
          assignmentId: rate.assignmentId,
          hoursWorked: null,
          grossPay: rate.amount,
          currency: rate.currency,
          notes: 'Monthly salary',
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

      items.push({
        assignmentId: rate.assignmentId,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        grossPay: Math.round(hoursWorked * rate.amount * 100) / 100,
        currency: rate.currency,
        notes: hoursWorked > 0 ? `${hoursWorked.toFixed(2)}h × ${rate.amount}` : 'No logged hours',
      });
    }

    const totalGross = Math.round(items.reduce((s, i) => s + i.grossPay, 0) * 100) / 100;
    const currency = rates[0]?.currency ?? 'TTD';

    const created = await this.prisma.client.payrollRun.create({
      data: {
        businessId,
        periodStart,
        periodEnd,
        status: 'DRAFT',
        totalGross,
        currency,
        itemCount: items.length,
        notes: opts?.notes,
        items: { create: items.map((i) => ({ ...i, businessId })) },
      },
      include: { items: true },
    });
    // PR195-PORT: a DRAFT run is committed payroll (safe-to-spend, KEY's treasury figures).
    invalidateBusinessFinancialSnapshotCache(businessId);
    return created;
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
    const approved = await this.prisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: userId ?? null },
    });
    invalidateBusinessFinancialSnapshotCache(businessId); // PR195-PORT
    return approved;
  }

  /**
   * PR195-PORT (owner PR #195 part 2): mark an APPROVED run paid and post the
   * disbursement to the ledger, in one transaction: the run's move to PAID
   * (a compare-and-set on APPROVED) and the posting through the ledger door
   * (ExpensePostingService.onPayrollRunPaid -> PostingService.post, V1-15)
   * commit or roll back together, so a posting the door refuses (a CLOSED
   * period, a currency D-13 does not allow, a chart row of another business)
   * leaves the run APPROVED with no paidAt.
   *
   * Idempotent: a run already PAID (a double click, a KEY retry, the loser of
   * two concurrent calls) is not moved again; its posting is asked for again
   * under the same key (PayrollRun:<id>:paid), which the door answers with the
   * first posting. A PAID run with no posting (paid before mark-paid posted)
   * gets its posting then, dated its own paidAt, which a CLOSED period refuses
   * with 409 and nothing changes.
   *
   * Tenant: the run is read by (id, businessId); the payment account by (id,
   * businessId) (another business's account is "not found in this business");
   * its chart row must be this business's and cash-class. D-13: the account is
   * in the run's currency; nothing is converted.
   */
  async markRunPaid(businessId: string, runId: string, input: MarkRunPaidInput = {}) {
    if (!this.expensePosting) {
      throw new ServiceUnavailableException('Payroll posting is unavailable: a run is not marked paid without its books');
    }
    const expensePosting = this.expensePosting;
    const paymentAccountId = (input.paymentAccountId ?? '').trim();
    const paymentMethod = (input.paymentMethod ?? '').trim().toLowerCase();
    if (!paymentAccountId && !paymentMethod) {
      throw new BadRequestException(
        'A payment account (paymentAccountId) or payment method (paymentMethod) is required to mark a payroll run paid',
      );
    }
    if (paymentMethod && !PAYROLL_DISBURSEMENT_METHODS.has(paymentMethod)) {
      throw new BadRequestException(
        `Invalid payroll paymentMethod "${input.paymentMethod}". Allowed: ${[...PAYROLL_DISBURSEMENT_METHODS].join(', ')}`,
      );
    }

    const paid = await this.prisma.client.$transaction(async (tx) => {
      let run = await tx.payrollRun.findFirst({ where: { id: runId, businessId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'APPROVED' && run.status !== 'PAID') {
        throw new BadRequestException(`Run is ${run.status} — it must be APPROVED before marking paid`);
      }

      const paymentCoaId = paymentAccountId
        ? await this.disbursementChartRow(tx as unknown as Prisma.TransactionClient, businessId, paymentAccountId, run.currency)
        : await expensePosting.resolvePaymentCoa(businessId, paymentMethod);

      if (run.status === 'APPROVED') {
        const paidAt = new Date();
        const claim = await tx.payrollRun.updateMany({
          where: { id: runId, businessId, status: 'APPROVED' },
          data: { status: 'PAID', paidAt },
        });
        run = await tx.payrollRun.findFirst({ where: { id: runId, businessId } });
        if (!run) throw new NotFoundException('Payroll run not found');
        if (claim.count !== 1 && run.status !== 'PAID') {
          throw new ConflictException(`Payroll run ${runId} is ${run.status}; it was not marked paid`);
        }
      }

      await expensePosting.onPayrollRunPaid(
        {
          id: run.id,
          businessId,
          totalGross: Number(run.totalGross),
          currency: run.currency,
          paidAt: run.paidAt ?? run.updatedAt ?? new Date(),
          periodStart: new Date(run.periodStart),
          periodEnd: new Date(run.periodEnd),
          paymentMethod: paymentMethod || null,
          paymentCoaId,
          paymentAccountId: paymentAccountId || null,
          actorId: input.actorId ?? null,
          initiatedBy: input.initiatedBy ?? null,
          notes: run.notes ?? null,
        },
        tx as unknown as Prisma.TransactionClient,
      );
      return run;
    });
    invalidateBusinessFinancialSnapshotCache(businessId);
    return paid;
  }

  /**
   * The chart row a payroll paid from `paymentAccountId` credits: the account
   * must be this business's, active, cash-class (CASH, BANK or
   * PAYMENT_PROCESSOR) and in the run's currency (D-13), and its chart row must
   * be this business's cash-class system row (where the ledger keeps the cash
   * it moves, V1-34). Anything else is refused before the run is touched.
   */
  private async disbursementChartRow(
    tx: Prisma.TransactionClient,
    businessId: string,
    paymentAccountId: string,
    runCurrency: string,
  ): Promise<string> {
    const account = await tx.financialAccount.findFirst({
      where: { id: paymentAccountId, businessId },
      select: { id: true, type: true, isActive: true, currency: true, chartOfAccountId: true },
    });
    if (!account) throw new BadRequestException(`Payment account ${paymentAccountId} not found in this business`);
    if (!account.isActive) throw new BadRequestException(`Payment account ${paymentAccountId} is archived`);
    if (!DISBURSEMENT_ACCOUNT_TYPES.has(account.type)) {
      throw new BadRequestException(
        `Payment account ${paymentAccountId} is a ${account.type} account: payroll is paid from a CASH, BANK or PAYMENT_PROCESSOR account`,
      );
    }
    const run = normalizeCurrency(runCurrency);
    const held = normalizeCurrency(account.currency) || run;
    if (held !== run) {
      throw new BadRequestException(
        `Payment account ${paymentAccountId} holds ${held}; the run is in ${run} (one currency, nothing converted: D-13)`,
      );
    }
    const chart = account.chartOfAccountId
      ? await tx.chartOfAccount.findFirst({
          where: { id: account.chartOfAccountId, businessId },
          select: { id: true, systemKey: true },
        })
      : null;
    if (!chart || !chart.systemKey || !CASH_CLASS_SYSTEM_KEYS.has(chart.systemKey)) {
      throw new BadRequestException(
        `Payment account ${paymentAccountId} is not linked to a cash, bank or processor account of this business's chart`,
      );
    }
    return chart.id;
  }
}

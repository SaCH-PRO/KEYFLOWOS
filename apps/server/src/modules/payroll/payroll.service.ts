import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { KEY_SYSTEM_ACTOR_ID } from '../../core/auth/system-actor';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
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
  /** P235 (D-310 / D-100): false withholds totalGross from readers without revenue:read. */
  includeMoney?: boolean;
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
  /** P235 (D-310 / D-100): false withholds totalGross from the HTTP response. */
  includeMoney?: boolean;
}

/**
 * V1-65 (TOF-PAYROLL-DISCARD, D-144): discard an unposted DRAFT run, or an
 * unposted legacy DRAFT/APPROVED run in a non-business currency, to VOID.
 * `actorId` is always set by the server from the signed-in member, never read
 * from a request body.
 */
export interface DiscardRunInput {
  reason?: unknown;
  actorId?: string | null;
  /** P235 (D-310 / D-100): false withholds totalGross from the HTTP response. */
  includeMoney?: boolean;
}

/** The currency a business with none recorded keeps (the column default; CashPositionService reads it so too). */
const DEFAULT_BUSINESS_CURRENCY = 'TTD';

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

  /**
   * P235 (FU-PAYROLL-IS-MONEY, D-310 / D-100 / D-140): whether `actorUserId`
   * may read payroll money figures in `businessId`. Evaluates canonical
   * `memberModuleLevel(membership, 'revenue')` for every role including
   * explicit-scope OWNERs (D-140); fails closed (false) when actor or
   * membership is absent.
   */
  async canReadPayrollMoney(businessId: string, actorUserId?: string | null): Promise<boolean> {
    if (!actorUserId || typeof actorUserId !== 'string' || !actorUserId.trim()) return false;
    const uid = actorUserId.trim();
    const user = await this.prisma.client.user.findUnique({ where: { id: uid }, select: { role: true } });
    if (user?.role === 'SUPER_ADMIN') return true;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: uid, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return false;
    return rankOf(memberModuleLevel(membership, 'revenue')) >= LEVEL_RANK.read;
  }

  // ── Rates ──────────────────────────────────────────────────────────────

  async setRate(businessId: string, input: PayRateInput) {
    const assignment = await this.prisma.client.orgAssignment.findFirst({
      where: { id: input.assignmentId, businessId },
    });
    if (!assignment) throw new NotFoundException('Staff assignment not found');
    if (!(input.amount > 0)) throw new BadRequestException('amount must be positive');

    // PR195-PORT review CR-P195-1 (D-13: one currency per business, defaulting to the business currency): a
    // rate set with no currency is in the business currency, as payroll_set_rate says; it was the literal TTD,
    // so a USD business's payroll was generated, reserved and (since the port) posted in TTD.
    const currency = normalizeCurrency(input.currency) || (await this.businessCurrency(this.prisma.client, businessId));
    return this.prisma.client.payRate.create({
      data: {
        businessId,
        assignmentId: input.assignmentId,
        amount: input.amount,
        currency,
        periodType: input.periodType ?? 'hourly',
        effectiveFrom: new Date(),
      },
    });
  }

  /** Latest effective rate per assignment. */
  async listRates(businessId: string, opts: { includeMoney?: boolean } = {}) {
    const includeMoney = opts.includeMoney ?? true;
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
      amount: includeMoney ? Number(r.amount) : null,
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

    // PR195-PORT review CR-P195-1 (D-13): a run is in one currency, the business's, since its gross is reserved
    // in safe-to-spend and posted to the ledger in it. Rates in any other currency (one set before rates took
    // the business currency, or set in another) are refused here, before anything is written, rather than
    // summed across currencies or labelled with the first rate's; nothing is converted.
    const businessCurrency = await this.businessCurrency(this.prisma.client, businessId);
    const rateCurrencies = new Set(rates.map((r) => normalizeCurrency(r.currency) || businessCurrency));
    const foreign = [...rateCurrencies].filter((code) => code !== businessCurrency).sort();
    if (foreign.length > 0) {
      const which = rateCurrencies.size > 1 ? `more than one currency (${[...rateCurrencies].sort().join(', ')})` : foreign[0];
      throw new BadRequestException(
        `Pay rates are in ${which}, not only the business currency ${businessCurrency}: a payroll run is in the business currency and nothing is converted or summed across currencies (D-13). Set those rates again in ${businessCurrency}.`,
      );
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
          currency: businessCurrency,
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
        currency: businessCurrency,
        notes: hoursWorked > 0 ? `${hoursWorked.toFixed(2)}h × ${rate.amount}` : 'No logged hours',
      });
    }

    const totalGross = Math.round(items.reduce((s, i) => s + i.grossPay, 0) * 100) / 100;
    const currency = businessCurrency;

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
    const includeMoney = filters.includeMoney ?? true;
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
      totalGross: includeMoney ? Number(r.totalGross) : null,
      currency: r.currency,
      itemCount: r.itemCount,
    }));
  }

  async getRun(businessId: string, runId: string, opts: { includeMoney?: boolean } = {}) {
    const includeMoney = opts.includeMoney ?? true;
    const run = await this.prisma.client.payrollRun.findFirst({
      where: { id: runId, businessId },
      include: { items: { include: { assignment: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return {
      ...run,
      totalGross: includeMoney ? Number(run.totalGross) : null,
      items: run.items.map((i) => ({
        id: i.id,
        assignmentId: i.assignmentId,
        staffName: this.assignmentName(i.assignment),
        hoursWorked: i.hoursWorked === null ? null : Number(i.hoursWorked),
        grossPay: includeMoney ? Number(i.grossPay) : null,
        currency: i.currency,
        notes: includeMoney ? i.notes : null,
      })),
    };
  }

  // ── Tier-3 transitions ─────────────────────────────────────────────────

  async approveRun(businessId: string, runId: string, userId?: string, opts: { includeMoney?: boolean } = {}) {
    const includeMoney = opts.includeMoney ?? true;
    const approved = await this.prisma.client.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id: runId, businessId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'DRAFT') {
        throw new BadRequestException(`Run is ${run.status} — only DRAFT runs can be approved`);
      }
      const claim = await tx.payrollRun.updateMany({
        where: { id: runId, businessId, status: 'DRAFT' },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedById: userId ?? null },
      });
      if (claim.count !== 1) {
        throw new ConflictException(`Payroll run ${runId} changed status concurrently; it was not approved`);
      }
      const updated = await tx.payrollRun.findFirst({ where: { id: runId, businessId } });
      if (!updated) throw new NotFoundException('Payroll run not found');
      return updated;
    });
    invalidateBusinessFinancialSnapshotCache(businessId); // PR195-PORT
    return includeMoney ? approved : { ...approved, totalGross: null };
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
   *
   * Review repair: who may post (assertMayPostPayroll: a member of this business
   * with expenses write, refused 403 before anything is read or written;
   * SEC-P195-1, SEC-P195-3), and in which currency (the business's: a run or
   * item in any other is refused 400 before the claim; CR-P195-1, D-13).
   */
  async markRunPaid(businessId: string, runId: string, input: MarkRunPaidInput = {}) {
    if (!this.expensePosting) {
      throw new ServiceUnavailableException('Payroll posting is unavailable: a run is not marked paid without its books');
    }
    const expensePosting = this.expensePosting;
    await this.assertMayPostPayroll(businessId, input);
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
      await this.assertRunInBusinessCurrency(tx as unknown as Prisma.TransactionClient, businessId, run);

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
    const includeMoney = input.includeMoney ?? true;
    return includeMoney ? paid : { ...paid, totalGross: null };
  }

  /**
   * V1-65 (TOF-PAYROLL-DISCARD, D-144): discard an unposted DRAFT run, or an
   * unposted legacy DRAFT/APPROVED run whose currency (or any item's currency)
   * is not the business currency (D-13), transitioning it atomically to VOID
   * with the server-verified member and reason recorded on both the run notes
   * and an Activity audit row.
   *
   * PAID runs, any run with a ledger posting (FinancialTransaction keyed to
   * PayrollRun), same-currency APPROVED runs, and already-VOID runs are
   * refused with 409 Conflict. Non-members (including a platform SUPER_ADMIN
   * without a Membership of this business, D-46/D-104) and calls with no
   * member actor (D-73) are refused with 403 Forbidden before anything is read
   * or written.
   */
  async discardRun(businessId: string, runId: string, input: DiscardRunInput = {}) {
    const actorId = typeof input.actorId === 'string' ? input.actorId.trim() : '';
    if (!actorId || actorId === KEY_SYSTEM_ACTOR_ID) {
      throw new ForbiddenException(
        'Discarding a payroll run requires a signed-in member of this business (D-73)',
      );
    }
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: actorId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Not a member of this business: payroll runs may only be discarded by a business member (D-46)',
      );
    }
    const user = await this.prisma.client.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (user?.role !== 'SUPER_ADMIN') {
      const level = memberModuleLevel(membership, 'operations');
      if (rankOf(level) < LEVEL_RANK.write) {
        throw new ForbiddenException(
          `Insufficient permissions: discarding a payroll run requires operations write access (you have ${level})`,
        );
      }
    }

    const reason = this.sanitizeDiscardReason(input.reason);
    const discardedAt = new Date();

    const discarded = await this.prisma.client.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: runId, businessId },
        include: { items: { select: { currency: true } } },
      });
      if (!run) throw new NotFoundException('Payroll run not found');

      if (run.status === 'VOID') {
        throw new ConflictException(`Payroll run ${runId} is already VOID`);
      }
      if (run.status === 'PAID') {
        throw new ConflictException(`Paid payroll run ${runId} cannot be discarded`);
      }

      const existingPosting = await this.findPayrollPosting(tx as unknown as Prisma.TransactionClient, businessId, run.id);
      if (existingPosting) {
        throw new ConflictException(`Posted payroll run ${runId} cannot be discarded`);
      }

      const businessCurrency = await this.businessCurrency(tx as unknown as Prisma.TransactionClient, businessId);
      const codes = new Set(
        [run.currency, ...run.items.map((i) => i.currency)].map((code) => normalizeCurrency(code) || businessCurrency),
      );
      const foreignCurrencies = [...codes].filter((code) => code !== businessCurrency).sort();
      const hasForeignCurrency = foreignCurrencies.length > 0;

      if (run.status !== 'DRAFT' && !(run.status === 'APPROVED' && hasForeignCurrency)) {
        throw new ConflictException(
          `Payroll run ${runId} is ${run.status} in ${businessCurrency}; only DRAFT runs or unposted runs in a non-business currency can be discarded (D-144)`,
        );
      }

      const stamp = `[VOIDED by ${actorId} at ${discardedAt.toISOString()}: ${reason}]`;
      const updatedNotes = run.notes && run.notes.trim() ? `${run.notes.trim()}\n${stamp}` : stamp;

      const claim = await tx.payrollRun.updateMany({
        where: { id: runId, businessId, status: run.status },
        data: { status: 'VOID', notes: updatedNotes },
      });
      if (claim.count !== 1) {
        throw new ConflictException(`Payroll run ${runId} changed status concurrently; it was not discarded`);
      }

      // Re-check postings after acquiring the row lock on payroll_runs so a concurrent
      // ledger posting cannot commit alongside VOID.
      const concurrentPosting = await this.findPayrollPosting(tx as unknown as Prisma.TransactionClient, businessId, run.id);
      if (concurrentPosting) {
        throw new ConflictException(`Posted payroll run ${runId} cannot be discarded`);
      }

      const periodLabel = `${new Date(run.periodStart).toISOString().slice(0, 10)} to ${new Date(run.periodEnd).toISOString().slice(0, 10)}`;
      await tx.activity.create({
        data: {
          businessId,
          module: 'operations',
          action: 'discarded',
          entityType: 'payroll_run',
          entityId: run.id,
          type: 'payroll_run.discarded',
          category: 'SYSTEM',
          actorType: 'USER',
          actorId,
          title: `Discarded payroll run (${periodLabel})`,
          detail: reason,
          data: {
            previousStatus: run.status,
            currency: run.currency,
            foreignCurrencies,
            totalGross: Number(run.totalGross),
            actorId,
            reason,
            discardedAt: discardedAt.toISOString(),
          },
        },
      });

      const includeMoney = input.includeMoney ?? true;
      const updated = await tx.payrollRun.findFirst({ where: { id: runId, businessId } });
      return {
        ...(updated ?? { ...run, status: 'VOID', notes: updatedNotes }),
        totalGross: includeMoney ? Number((updated ?? run).totalGross) : null,
        discardedById: actorId,
        discardReason: reason,
        discardedAt: discardedAt.toISOString(),
      };
    });

    invalidateBusinessFinancialSnapshotCache(businessId);
    return discarded;
  }

  private sanitizeDiscardReason(raw: unknown): string {
    if (raw === undefined || raw === null) return 'Discarded by operator';
    if (typeof raw !== 'string') {
      throw new BadRequestException('reason must be a string');
    }
    if (raw.length > 2000) {
      throw new BadRequestException('reason must be 500 characters or fewer');
    }
    let cleaned = '';
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      // Reject unpaired UTF-16 surrogates (SEC-P59-2) so malformed Unicode returns 400 instead of 500 on DB write.
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < raw.length ? raw.charCodeAt(i + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) {
          throw new BadRequestException('reason contains invalid Unicode surrogate characters');
        }
        cleaned += raw[i] + raw[i + 1];
        i += 1;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        throw new BadRequestException('reason contains invalid Unicode surrogate characters');
      }
      const isControlOrBidi =
        code < 0x20 ||
        code === 0x7f ||
        (code >= 0x80 && code <= 0x9f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069);
      cleaned += isControlOrBidi ? ' ' : raw[i];
    }
    const normalized = cleaned.replace(/\s+/g, ' ').trim();
    if (normalized.length > 500) {
      throw new BadRequestException('reason must be 500 characters or fewer');
    }
    return normalized || 'Discarded by operator';
  }

  private async findPayrollPosting(
    tx: Prisma.TransactionClient,
    businessId: string,
    runId: string,
  ): Promise<{ id: string } | null> {
    return tx.financialTransaction.findFirst({
      where: {
        businessId,
        OR: [
          { sourceType: 'PayrollRun', sourceId: runId },
          { externalRef: { startsWith: `PayrollRun:${runId}:` } },
        ],
      },
      select: { id: true },
    });
  }

  /**
   * PR195-PORT review SEC-P195-1 and SEC-P195-3: who may mark a run paid, now that it posts the business's
   * money. The people the posting is for are named by the server, never by a request body: on REST the
   * signed-in member (actorId); on KEY the member KEY ran for (initiatedBy; actorId is then KEY's system
   * actor, whose authority is that member's). At least one must be named (D-73: a run with no member pays no
   * payroll), and each must hold a Membership of this business (FinanceController.ensureAccess's rule for a
   * Books write, D-104; D-46: a platform SUPER_ADMIN who is not a member writes none of its money) with
   * expenses write, read as ModuleScopeGuard reads a membership (memberModuleLevel); a SUPER_ADMIN who is a
   * member passes that check as the guard lets one through. Expenses write beside the route's operations
   * write is the restrictive pick pending an owner ruling (SEC-P195-3); KEY's authority map holds
   * payroll_mark_paid to the same pair (GRAPH_ACTION_EXTRA_SCOPES). Refused 403 before anything is read or
   * written.
   */
  private async assertMayPostPayroll(businessId: string, input: MarkRunPaidInput): Promise<void> {
    const people = [input.actorId, input.initiatedBy]
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id !== '' && id !== KEY_SYSTEM_ACTOR_ID);
    if (people.length === 0) {
      throw new ForbiddenException('Marking a payroll run paid posts it to the books, and this call names no member it is for (D-73)');
    }
    for (const userId of new Set(people)) {
      const membership = await this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId, businessId } },
        select: { role: true, permissionScopes: true },
      });
      if (!membership) {
        throw new ForbiddenException('Not a member of this business: its payroll is posted to its books only by a member (D-46)');
      }
      const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (user?.role === 'SUPER_ADMIN') continue;
      const level = memberModuleLevel(membership, 'expenses');
      if (rankOf(level) < LEVEL_RANK.write) {
        throw new ForbiddenException(
          `Insufficient permissions: marking a payroll run paid posts it to the books; expenses requires write access (you have ${level})`,
        );
      }
    }
  }

  /**
   * PR195-PORT review CR-P195-1 (D-13: one currency per business): a run is posted, and reserved, only in the
   * business currency. A run labelled in another currency, or holding an item in one (a run generated from
   * rates stored in the old literal TTD default in a USD business), is refused 400 before the claim, so
   * nothing changes, until the owner rules on payroll in a second currency. Nothing is converted.
   */
  private async assertRunInBusinessCurrency(
    tx: Prisma.TransactionClient,
    businessId: string,
    run: { id: string; currency: string | null },
  ): Promise<void> {
    const businessCurrency = await this.businessCurrency(tx, businessId);
    const items = await tx.payrollItem.findMany({ where: { runId: run.id, businessId }, select: { currency: true } });
    const codes = new Set([run.currency, ...items.map((i) => i.currency)].map((code) => normalizeCurrency(code) || businessCurrency));
    const foreign = [...codes].filter((code) => code !== businessCurrency).sort();
    if (foreign.length > 0) {
      throw new BadRequestException(
        `Payroll run ${run.id} is in ${foreign.join(', ')}; the business currency is ${businessCurrency}. A run is posted only in the business currency and nothing is converted (D-13), so it is not marked paid.`,
      );
    }
  }

  /** The business's currency (D-13: one per business), normalized; the column default when none is recorded. */
  private async businessCurrency(client: Prisma.TransactionClient | PrismaService['client'], businessId: string): Promise<string> {
    const business = await (client as Prisma.TransactionClient).business.findUnique({ where: { id: businessId }, select: { currency: true } });
    return normalizeCurrency(business?.currency) || DEFAULT_BUSINESS_CURRENCY;
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

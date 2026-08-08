import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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
 * Payroll MVP: rates per staff position (OrgAssignment) + pay runs
 * generated from logged time entries (hourly) or flat salaries (monthly).
 * Approve and pay are separate, tier-3-gated transitions — money never
 * moves without a human approving the run first.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.client.payrollRun.create({
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
    return this.prisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: userId ?? null },
    });
  }

  async markRunPaid(businessId: string, runId: string) {
    const run = await this.getRun(businessId, runId);
    if (run.status !== 'APPROVED') {
      throw new BadRequestException(`Run is ${run.status} — it must be APPROVED before marking paid`);
    }
    return this.prisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }
}

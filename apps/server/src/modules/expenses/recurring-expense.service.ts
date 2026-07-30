import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ExpensesService } from './expenses.service';

/**
 * FIN3 — RecurringExpense scheduler. Mirrors the RecurringInvoice
 * service: an hourly tick scans for due active schedules and emits one
 * Expense per schedule. Each emitted expense flows through
 * ExpensesService.createExpense (so it goes through PostingService and
 * lands in the ledger atomically).
 */
@Injectable()
export class RecurringExpenseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringExpenseService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ExpensesService) private readonly expensesSvc: ExpensesService,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      this.processDueRecurringExpenses().catch((err) => {
        this.logger.error('Error processing recurring expenses', err);
      });
    }, 60 * 60 * 1000);
    this.logger.log('Recurring expense scheduler started (hourly interval)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  list(businessId: string) {
    return this.prisma.client.recurringExpense.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { category: true },
    });
  }

  get(businessId: string, id: string) {
    return this.prisma.client.recurringExpense.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { category: true },
    });
  }

  async create(input: {
    businessId: string;
    name: string;
    frequency: string;
    nextRunDate: string | Date;
    endDate?: string | Date | null;
    description: string;
    amount: number;
    currency?: string;
    vendor?: string;
    paymentMethod?: string;
    notes?: string;
    createsBill?: boolean;
    dueOffsetDays?: number;
    categoryId?: string;
    projectId?: string;
    contactId?: string;
    serviceId?: string;
  }) {
    if (!['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].includes(input.frequency)) {
      throw new BadRequestException(`Invalid frequency ${input.frequency}`);
    }
    return this.prisma.client.recurringExpense.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        frequency: input.frequency,
        nextRunDate: new Date(input.nextRunDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        description: input.description,
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        vendor: input.vendor ?? null,
        paymentMethod: input.paymentMethod ?? null,
        notes: input.notes ?? null,
        createsBill: input.createsBill ?? false,
        dueOffsetDays: input.dueOffsetDays ?? null,
        categoryId: input.categoryId ?? null,
        projectId: input.projectId ?? null,
        contactId: input.contactId ?? null,
        serviceId: input.serviceId ?? null,
      },
    });
  }

  async update(input: {
    id: string;
    businessId: string;
    name?: string;
    frequency?: string;
    nextRunDate?: string | Date;
    endDate?: string | Date | null;
    amount?: number;
    description?: string;
    vendor?: string;
    paymentMethod?: string | null;
    notes?: string | null;
    createsBill?: boolean;
    dueOffsetDays?: number | null;
    categoryId?: string | null;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.client.recurringExpense.findFirst({
      where: { id: input.id, businessId: input.businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring expense not found');

    const data: Prisma.RecurringExpenseUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.nextRunDate !== undefined) data.nextRunDate = new Date(input.nextRunDate);
    if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.description !== undefined) data.description = input.description;
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.createsBill !== undefined) data.createsBill = input.createsBill;
    if (input.dueOffsetDays !== undefined) data.dueOffsetDays = input.dueOffsetDays;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.client.recurringExpense.update({
      where: { id: input.id },
      data,
    });
  }

  async cancel(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringExpense.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring expense not found');
    return this.prisma.client.recurringExpense.update({
      where: { id },
      data: { isActive: false, cancelledAt: new Date() },
    });
  }

  /** Compute the next run date from a frequency string. */
  static computeNext(from: Date, frequency: string): Date {
    const d = new Date(from);
    switch (frequency) {
      case 'WEEKLY':
        d.setDate(d.getDate() + 7);
        return d;
      case 'BIWEEKLY':
        d.setDate(d.getDate() + 14);
        return d;
      case 'MONTHLY':
        d.setMonth(d.getMonth() + 1);
        return d;
      case 'QUARTERLY':
        d.setMonth(d.getMonth() + 3);
        return d;
      case 'YEARLY':
        d.setFullYear(d.getFullYear() + 1);
        return d;
      default:
        throw new Error(`Unknown frequency ${frequency}`);
    }
  }

  /** Hourly scheduler tick. Public so tests + scripts can run it on demand. */
  async processDueRecurringExpenses(): Promise<{ generated: number; failed: number }> {
    if (this.running) return { generated: 0, failed: 0 };
    this.running = true;
    let generated = 0;
    let failed = 0;
    try {
      const now = new Date();
      const due = await this.prisma.client.recurringExpense.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          nextRunDate: { lte: now },
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
        take: 100,
      });
      for (const r of due) {
        try {
          await this.runOnce(r.id, r.businessId, now);
          generated += 1;
        } catch (err: any) {
          failed += 1;
          this.logger.error(`RecurringExpense ${r.id} failed`, (err as Error)?.stack);
          await this.prisma.client.recurringExpense.update({
            where: { id: r.id },
            data: {
              failureCount: { increment: 1 },
              lastFailureAt: now,
              lastError: (err as Error)?.message?.slice(0, 500) ?? 'unknown error',
            },
          });
        }
      }
    } finally {
      this.running = false;
    }
    if (generated > 0 || failed > 0) {
      this.logger.log(`Recurring expenses tick: generated=${generated} failed=${failed}`);
    }
    return { generated, failed };
  }

  /** Generate one expense for a schedule and roll its nextRunDate forward. */
  async runOnce(recurringId: string, businessId: string, now: Date = new Date()) {
    const rec = await this.prisma.client.recurringExpense.findFirst({
      where: { id: recurringId, businessId, deletedAt: null },
    });
    if (!rec) throw new NotFoundException('Recurring expense not found');
    if (!rec.isActive) throw new BadRequestException('Schedule is not active');

    const dueDate = rec.createsBill && rec.dueOffsetDays
      ? new Date(now.getTime() + rec.dueOffsetDays * 86400000)
      : undefined;

    await this.expensesSvc.createExpense({
      businessId,
      description: rec.description,
      amount: rec.amount,
      currency: rec.currency,
      date: now,
      vendor: rec.vendor ?? undefined,
      notes: rec.notes ?? undefined,
      paymentMethod: rec.paymentMethod ?? undefined,
      categoryId: rec.categoryId ?? undefined,
      projectId: rec.projectId ?? undefined,
      contactId: rec.contactId ?? undefined,
      serviceId: rec.serviceId ?? undefined,
      status: rec.createsBill ? 'BILL' : 'PAID',
      dueDate,
      recurringExpenseId: rec.id,
      isRecurring: true,
      recurringFrequency: rec.frequency,
    });

    const nextRunDate = RecurringExpenseService.computeNext(rec.nextRunDate, rec.frequency);
    await this.prisma.client.recurringExpense.update({
      where: { id: rec.id },
      data: {
        lastRunDate: now,
        nextRunDate,
        runCount: { increment: 1 },
        failureCount: 0,
        lastError: null,
      },
    });
  }
}

import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ExpensesService, expenseCurrency } from './expenses.service';
import { schedulersDisabled } from '../../core/config/env';

const VALID_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
const DEFAULT_TIME_ZONE = 'America/Port_of_Spain';
const CALENDAR_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_DUE_OFFSET_DAYS = 3650;
const MS_PER_DAY = 86_400_000;

interface YmdTuple {
  year: number;
  month: number;
  day: number;
}

function resolveTimeZone(raw?: string | null): string {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: candidate });
      return candidate;
    } catch {
      // Unknown IANA zone: fall back to the business schema default.
    }
  }
  return DEFAULT_TIME_ZONE;
}

/**
 * Extract numeric (year, month, day) in `timeZone` using `formatToParts` with
 * explicit era handling (astronomical year numbering: 1 BC -> 0, 2 BC -> -1),
 * avoiding lexicographic comparison bugs for years < 1000 AD or BC dates.
 */
function ymdInZone(at: Date, timeZone: string): YmdTuple {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  let era = 'AD';
  let year = 0;
  let month = 1;
  let day = 1;
  for (const part of parts) {
    if (part.type === 'era') era = part.value;
    else if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  const signedYear = /B/i.test(era) ? 1 - year : year;
  return { year: signedYear, month, day };
}

function compareYmd(a: YmdTuple, b: YmdTuple): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function validateDueOffsetDays(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_DUE_OFFSET_DAYS) {
    throw new BadRequestException(`dueOffsetDays must be an integer between 0 and ${MAX_DUE_OFFSET_DAYS}`);
  }
  return raw;
}

function parseOptionalEndDate(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date) {
    const d = new Date(raw.getTime());
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid endDate');
    return d;
  }
  if (typeof raw !== 'string') {
    throw new BadRequestException('Invalid endDate');
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = CALENDAR_DAY_RE.exec(trimmed);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const parsed = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      throw new BadRequestException('Invalid endDate');
    }
    return parsed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Invalid endDate');
  }
  return parsed;
}

function addMonthsClamped(from: Date, monthsToAdd: number, anchorDay?: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const day = from.getUTCDate();
  const h = from.getUTCHours();
  const min = from.getUTCMinutes();
  const s = from.getUTCSeconds();
  const ms = from.getUTCMilliseconds();
  const targetDay =
    typeof anchorDay === 'number' && Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
      ? anchorDay
      : day;
  const totalMonths = y * 12 + m + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDayProbe = new Date(0);
  lastDayProbe.setUTCFullYear(targetYear, targetMonth + 1, 0);
  lastDayProbe.setUTCHours(0, 0, 0, 0);
  const lastDayOfTargetMonth = lastDayProbe.getUTCDate();
  const clampedDay = Math.min(targetDay, lastDayOfTargetMonth);
  const out = new Date(0);
  out.setUTCFullYear(targetYear, targetMonth, clampedDay);
  out.setUTCHours(h, min, s, ms);
  return out;
}

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
    if (schedulersDisabled()) {
      this.logger.log('Scheduler disabled (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
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

  /**
   * V1-91 (FU-RECURRING-EXPENSE-SERVER, SEC-EXH2-3): verify that any supplied
   * categoryId, projectId, contactId, or serviceId belongs to `businessId` and
   * is not soft-deleted (where applicable). Uses identical 400 wording across
   * foreign-tenant, nonexistent, and soft-deleted ids so cross-tenant
   * existence is never leaked.
   */
  private async assertRelationsInBusiness(
    businessId: string,
    refs: {
      categoryId?: string | null;
      projectId?: string | null;
      contactId?: string | null;
      serviceId?: string | null;
    },
  ): Promise<void> {
    if (refs.categoryId !== undefined && refs.categoryId !== null) {
      if (typeof refs.categoryId !== 'string' || refs.categoryId.trim().length === 0) {
        throw new BadRequestException('Category not found or does not belong to this business');
      }
      const cat = await this.prisma.client.expenseCategory.findFirst({
        where: { id: refs.categoryId, businessId },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException('Category not found or does not belong to this business');
      }
    }

    if (refs.projectId !== undefined && refs.projectId !== null) {
      if (typeof refs.projectId !== 'string' || refs.projectId.trim().length === 0) {
        throw new BadRequestException('Project not found or does not belong to this business');
      }
      const proj = await this.prisma.client.project.findFirst({
        where: { id: refs.projectId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!proj) {
        throw new BadRequestException('Project not found or does not belong to this business');
      }
    }

    if (refs.contactId !== undefined && refs.contactId !== null) {
      if (typeof refs.contactId !== 'string' || refs.contactId.trim().length === 0) {
        throw new BadRequestException('Contact not found or does not belong to this business');
      }
      const ct = await this.prisma.client.contact.findFirst({
        where: { id: refs.contactId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!ct) {
        throw new BadRequestException('Contact not found or does not belong to this business');
      }
    }

    if (refs.serviceId !== undefined && refs.serviceId !== null) {
      if (typeof refs.serviceId !== 'string' || refs.serviceId.trim().length === 0) {
        throw new BadRequestException('Service not found or does not belong to this business');
      }
      const svc = await this.prisma.client.service.findFirst({
        where: { id: refs.serviceId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!svc) {
        throw new BadRequestException('Service not found or does not belong to this business');
      }
    }
  }

  /**
   * V1-91 (FU-RECURRING-EXPENSE-SERVER): parse and validate `nextRunDate`
   * against the start of today in the business's timezone. Today is accepted;
   * strictly past dates (including years < 1000 AD and BC dates) and
   * unparseable values are rejected with 400.
   */
  private async validateNextRunDate(businessId: string, raw: string | Date, now: Date = new Date()): Promise<Date> {
    let parsed: Date;
    let calendarYmd: YmdTuple | null = null;

    if (raw instanceof Date) {
      parsed = new Date(raw.getTime());
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid nextRunDate');
      }
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        throw new BadRequestException('Invalid nextRunDate');
      }
      const match = CALENDAR_DAY_RE.exec(trimmed);
      if (match) {
        const y = Number(match[1]);
        const m = Number(match[2]);
        const d = Number(match[3]);
        parsed = new Date(0);
        parsed.setUTCFullYear(y, m - 1, d);
        parsed.setUTCHours(0, 0, 0, 0);
        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.getUTCFullYear() !== y ||
          parsed.getUTCMonth() !== m - 1 ||
          parsed.getUTCDate() !== d
        ) {
          throw new BadRequestException('Invalid nextRunDate');
        }
        calendarYmd = { year: y, month: m, day: d };
      } else {
        parsed = new Date(trimmed);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('Invalid nextRunDate');
        }
      }
    } else {
      throw new BadRequestException('Invalid nextRunDate');
    }

    // No IANA timezone offset exceeds ±14h, so anything >48h before `now` is
    // strictly in the past in every timezone on earth.
    if (parsed.getTime() < now.getTime() - 48 * 3600 * 1000) {
      throw new BadRequestException('nextRunDate cannot be in the past');
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = resolveTimeZone(business?.timezone);
    const todayYmd = ymdInZone(now, tz);
    const candidateYmd = calendarYmd ?? ymdInZone(parsed, tz);
    if (compareYmd(candidateYmd, todayYmd) < 0) {
      throw new BadRequestException('nextRunDate cannot be in the past');
    }

    return parsed;
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
    dueOffsetDays?: number | null;
    categoryId?: string | null;
    projectId?: string | null;
    contactId?: string | null;
    serviceId?: string | null;
  }) {
    if (!(VALID_FREQUENCIES as readonly string[]).includes(input.frequency)) {
      throw new BadRequestException(`Invalid frequency ${input.frequency}`);
    }
    const nextRunDate = await this.validateNextRunDate(input.businessId, input.nextRunDate);
    const endDate = parseOptionalEndDate(input.endDate);
    const dueOffsetDays = validateDueOffsetDays(input.dueOffsetDays);
    await this.assertRelationsInBusiness(input.businessId, {
      categoryId: input.categoryId,
      projectId: input.projectId,
      contactId: input.contactId,
      serviceId: input.serviceId,
    });
    // FOLLOW3-B4 (VL-06, D-13): the business currency when none is named (it
    // was the literal 'TTD', so a USD business's schedules generated TTD expenses).
    const currency = await expenseCurrency(this.prisma, input.businessId, input.currency);
    return this.prisma.client.recurringExpense.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        frequency: input.frequency,
        nextRunDate,
        endDate,
        description: input.description,
        amount: input.amount,
        currency,
        vendor: input.vendor ?? null,
        paymentMethod: input.paymentMethod ?? null,
        notes: input.notes ?? null,
        createsBill: input.createsBill ?? false,
        dueOffsetDays,
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
    projectId?: string | null;
    contactId?: string | null;
    serviceId?: string | null;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.client.recurringExpense.findFirst({
      where: { id: input.id, businessId: input.businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring expense not found');

    if (input.frequency !== undefined && !(VALID_FREQUENCIES as readonly string[]).includes(input.frequency)) {
      throw new BadRequestException(`Invalid frequency ${input.frequency}`);
    }

    await this.assertRelationsInBusiness(input.businessId, {
      categoryId: input.categoryId,
      projectId: input.projectId,
      contactId: input.contactId,
      serviceId: input.serviceId,
    });

    const data: Prisma.RecurringExpenseUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.nextRunDate !== undefined) {
      data.nextRunDate = await this.validateNextRunDate(input.businessId, input.nextRunDate);
    }
    if (input.endDate !== undefined) data.endDate = parseOptionalEndDate(input.endDate);
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.description !== undefined) data.description = input.description;
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.createsBill !== undefined) data.createsBill = input.createsBill;
    if (input.dueOffsetDays !== undefined) data.dueOffsetDays = validateDueOffsetDays(input.dueOffsetDays);
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.projectId !== undefined) data.projectId = input.projectId;
    if (input.contactId !== undefined) data.contactId = input.contactId;
    if (input.serviceId !== undefined) data.serviceId = input.serviceId;
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

  /**
   * Compute the next run date from a frequency string using UTC calendar math.
   * Clamps month-end days instead of overflowing into the following month
   * (e.g. Jan 31 + MONTHLY -> Feb 28/29, never Mar 3; leap Feb 29 + YEARLY ->
   * Feb 28). Accepts an optional `anchorDay` (1..31) so multi-step cadence
   * advancement preserves the original day-of-month across shorter months
   * (Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31).
   */
  static computeNext(from: Date, frequency: string, anchorDay?: number): Date {
    const base = new Date(from.getTime());
    if (Number.isNaN(base.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    switch (frequency) {
      case 'WEEKLY':
        return new Date(base.getTime() + 7 * MS_PER_DAY);
      case 'BIWEEKLY':
        return new Date(base.getTime() + 14 * MS_PER_DAY);
      case 'MONTHLY':
        return addMonthsClamped(base, 1, anchorDay);
      case 'QUARTERLY':
        return addMonthsClamped(base, 3, anchorDay);
      case 'YEARLY':
        return addMonthsClamped(base, 12, anchorDay);
      default:
        throw new Error(`Unknown frequency ${frequency}`);
    }
  }

  /**
   * Advance `nextRunDate` at least one period and strictly past `after` in O(1)
   * time, preserving `from`'s day-of-month anchor across shorter months.
   * Prevents both overdue hourly catch-up loops and synchronous event-loop DoS
   * on arbitrarily old dates.
   */
  static advancePast(from: Date, frequency: string, after: Date): Date {
    const base = new Date(from.getTime());
    if (Number.isNaN(base.getTime()) || Number.isNaN(after.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    const anchorDay = base.getUTCDate();
    let next = RecurringExpenseService.computeNext(base, frequency, anchorDay);
    if (next.getTime() > after.getTime()) {
      return next;
    }

    if (frequency === 'WEEKLY' || frequency === 'BIWEEKLY') {
      const periodMs = (frequency === 'WEEKLY' ? 7 : 14) * MS_PER_DAY;
      const periods = Math.floor((after.getTime() - base.getTime()) / periodMs) + 1;
      next = new Date(base.getTime() + periods * periodMs);
    } else if (frequency === 'MONTHLY' || frequency === 'QUARTERLY' || frequency === 'YEARLY') {
      const stepMonths = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
      const monthsDiff =
        (after.getUTCFullYear() - base.getUTCFullYear()) * 12 +
        (after.getUTCMonth() - base.getUTCMonth());
      const steps = Math.max(1, Math.floor(monthsDiff / stepMonths));
      next = addMonthsClamped(base, steps * stepMonths, anchorDay);
    }

    while (next.getTime() <= after.getTime()) {
      next = RecurringExpenseService.computeNext(next, frequency, anchorDay);
    }
    return next;
  }

  /** Hourly scheduler tick. Public so tests + scripts can run it on demand. */
  async processDueRecurringExpenses(now: Date = new Date()): Promise<{ generated: number; failed: number }> {
    if (this.running) return { generated: 0, failed: 0 };
    this.running = true;
    let generated = 0;
    let failed = 0;
    try {
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

  /** Generate one expense for a schedule and roll its nextRunDate strictly past `now`. */
  async runOnce(recurringId: string, businessId: string, now: Date = new Date()) {
    const rec = await this.prisma.client.recurringExpense.findFirst({
      where: { id: recurringId, businessId, deletedAt: null },
    });
    if (!rec) throw new NotFoundException('Recurring expense not found');
    if (!rec.isActive) throw new BadRequestException('Schedule is not active');
    if (rec.endDate && now > rec.endDate) {
      throw new BadRequestException('Schedule has passed its end date');
    }

    let dueDate: Date | undefined;
    if (
      rec.createsBill &&
      typeof rec.dueOffsetDays === 'number' &&
      Number.isInteger(rec.dueOffsetDays) &&
      rec.dueOffsetDays >= 0 &&
      rec.dueOffsetDays <= MAX_DUE_OFFSET_DAYS
    ) {
      const candidate = new Date(now.getTime() + rec.dueOffsetDays * MS_PER_DAY);
      if (!Number.isNaN(candidate.getTime())) {
        dueDate = candidate;
      }
    }

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

    const nextRunDate = RecurringExpenseService.advancePast(rec.nextRunDate, rec.frequency, now);
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

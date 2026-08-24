import { Injectable, Inject, OnModuleInit, OnModuleDestroy, NotFoundException, BadRequestException , Logger} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService } from './posting.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

const VALID_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

export interface CreateRecurringJournalEntryInput {
  name: string;
  description?: string;
  frequency: string;
  nextRunDate: string;
  endDate?: string | null;
  entries: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }>;
}

export interface UpdateRecurringJournalEntryInput {
  name?: string;
  description?: string | null;
  frequency?: string;
  nextRunDate?: string;
  endDate?: string | null;
  entries?: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }>;
  isActive?: boolean;
}

/**
 * FIN1 extension — scheduled double-entry journal entries that emit on a
 * recurring cadence. Mirrors the RecurringExpense scheduler pattern.
 */
@Injectable()
export class RecurringJournalEntryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringJournalEntryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  onModuleInit() {
    this.timer = safeInterval('RecurringJournalEntryService', 60 * 60 * 1000, () => this.tick(), this.logger); // hourly
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processDueEntries();
    } finally {
      this.running = false;
    }
  }

  async list(businessId: string) {
    return this.prisma.client.recurringJournalEntry.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(businessId: string, id: string) {
    const entry = await this.prisma.client.recurringJournalEntry.findFirst({
      where: { id, businessId },
    });
    if (!entry) throw new NotFoundException('Recurring journal entry not found');
    return entry;
  }

  async create(businessId: string, input: CreateRecurringJournalEntryInput) {
    this.validateFrequency(input.frequency);
    this.validateEntries(input.entries);
    const nextRunDate = new Date(input.nextRunDate);
    if (isNaN(nextRunDate.getTime())) throw new BadRequestException('Invalid nextRunDate');

    return this.prisma.client.recurringJournalEntry.create({
      data: {
        businessId,
        name: input.name,
        description: input.description ?? null,
        frequency: input.frequency,
        nextRunDate,
        endDate: input.endDate ? new Date(input.endDate) : null,
        entries: input.entries as Prisma.InputJsonValue,
      },
    });
  }

  async update(businessId: string, id: string, input: UpdateRecurringJournalEntryInput) {
    const existing = await this.get(businessId, id);
    if (input.frequency) this.validateFrequency(input.frequency);
    if (input.entries) this.validateEntries(input.entries);

    return this.prisma.client.recurringJournalEntry.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.frequency !== undefined && { frequency: input.frequency }),
        ...(input.nextRunDate !== undefined && { nextRunDate: new Date(input.nextRunDate) }),
        ...(input.endDate !== undefined && { endDate: input.endDate ? new Date(input.endDate) : null }),
        ...(input.entries !== undefined && { entries: input.entries as Prisma.InputJsonValue }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
  }

  async cancel(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.recurringJournalEntry.update({
      where: { id },
      data: { isActive: false, cancelledAt: new Date() },
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.recurringJournalEntry.delete({ where: { id } });
  }

  async runOnce(businessId: string, id: string, now = new Date()) {
    const entry = await this.get(businessId, id);
    if (!entry.isActive) throw new BadRequestException('Entry is not active');
    if (entry.endDate && now > entry.endDate) throw new BadRequestException('Entry has passed its end date');
    return this.emitEntry(entry, now);
  }

  private async processDueEntries() {
    const now = new Date();
    const due = await this.prisma.client.recurringJournalEntry.findMany({
      where: {
        isActive: true,
        nextRunDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      take: 100,
      orderBy: { nextRunDate: 'asc' },
    });

    for (const entry of due) {
      try {
        await this.emitEntry(entry, now);
      } catch (err: any) {
        const nextRunDate = this.computeNext(entry.frequency, entry.nextRunDate);
        const failureCount = entry.failureCount + 1;
        await this.prisma.client.recurringJournalEntry.update({
          where: { id: entry.id },
          data: {
            failureCount,
            lastError: err instanceof Error ? err.message : String(err),
            lastRunDate: now,
            nextRunDate,
            ...(failureCount >= 5 ? { isActive: false } : {}),
          },
        });
      }
    }
  }

  private async emitEntry(
    entry: { id: string; businessId: string; name: string; description: string | null; entries: Prisma.JsonValue; frequency: string; nextRunDate: Date },
    now: Date,
  ) {
    const items = Array.isArray(entry.entries) ? entry.entries as Array<{ accountId: string; debit?: number; credit?: number; memo?: string }> : [];
    if (items.length < 2) {
      throw new BadRequestException('Recurring journal entry must have at least 2 line items');
    }

    const totalDebit = items.reduce((sum, e) => sum + (e.debit ?? 0), 0);

    await this.posting.post({
      businessId: entry.businessId,
      type: 'ADJUSTMENT',
      date: entry.nextRunDate,
      amount: totalDebit,
      description: entry.name,
      notes: entry.description,
      sourceType: 'RecurringJournalEntry',
      sourceId: entry.id,
      kind: 'recurring_run',
      entries: items.map((e) => ({
        accountId: e.accountId,
        debit: e.debit ?? 0,
        credit: e.credit ?? 0,
        memo: e.memo,
      })),
    });

    const nextRunDate = this.computeNext(entry.frequency, entry.nextRunDate);
    await this.prisma.client.recurringJournalEntry.update({
      where: { id: entry.id },
      data: {
        nextRunDate,
        runCount: { increment: 1 },
        lastRunDate: now,
        lastError: null,
      },
    });
  }

  private computeNext(frequency: string, from: Date): Date {
    const d = new Date(from);
    switch (frequency) {
      case 'WEEKLY':
        d.setDate(d.getDate() + 7);
        break;
      case 'BIWEEKLY':
        d.setDate(d.getDate() + 14);
        break;
      case 'MONTHLY': {
        const day = d.getDate();
        d.setMonth(d.getMonth() + 1);
        if (d.getDate() !== day) d.setDate(0);
        break;
      }
      case 'QUARTERLY': {
        const day = d.getDate();
        d.setMonth(d.getMonth() + 3);
        if (d.getDate() !== day) d.setDate(0);
        break;
      }
      case 'YEARLY':
        d.setFullYear(d.getFullYear() + 1);
        break;
      default: {
        const day = d.getDate();
        d.setMonth(d.getMonth() + 1);
        if (d.getDate() !== day) d.setDate(0);
      }
    }
    return d;
  }

  private validateFrequency(frequency: string) {
    if (!VALID_FREQUENCIES.includes(frequency as (typeof VALID_FREQUENCIES)[number])) {
      throw new BadRequestException(`Invalid frequency: ${frequency}. Must be one of: ${VALID_FREQUENCIES.join(', ')}`);
    }
  }

  private validateEntries(entries: Array<{ accountId: string; debit?: number; credit?: number }>) {
    if (!Array.isArray(entries) || entries.length < 2) {
      throw new BadRequestException('Journal entry must have at least 2 line items');
    }
    const totalDebit = entries.reduce((sum, e) => sum + (e.debit ?? 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + (e.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException('Debits and credits must balance');
    }
  }
}

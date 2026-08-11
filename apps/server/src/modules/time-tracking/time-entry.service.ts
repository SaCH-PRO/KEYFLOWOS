import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateTimeEntryInput {
  businessId: string;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  hourlyRate?: number;
}

export interface UpdateTimeEntryInput {
  description?: string;
  startTime?: Date;
  endTime?: Date;
  durationMinutes?: number;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  hourlyRate?: number;
}

export interface TimeEntryFilters {
  businessId: string;
  userId?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  billed?: boolean;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class TimeEntryService {
  private readonly logger = new Logger(TimeEntryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Prove that caller-supplied project/task references belong to this business.
   *
   * These are written straight into the row, and until recently the global
   * ValidationPipe stripped them (the DTOs carried no validator metadata), so
   * the unchecked write was unreachable. Making the DTOs work makes the fields
   * live: without this, a caller could attach their time entry to another
   * tenant's project or task, and the `include: { project: ... }` on these
   * queries would then read that project's name straight back out.
   *
   * Not-found and not-yours return the same error on purpose — distinguishing
   * them would confirm the existence of an id the caller has no right to probe.
   */
  private async assertOwnedRefs(
    businessId: string,
    refs: { projectId?: string | null; taskId?: string | null },
  ): Promise<void> {
    if (refs.projectId) {
      const project = await this.prisma.client.project.findFirst({
        where: { id: refs.projectId, businessId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project not found');
    }

    if (refs.taskId) {
      const task = await this.prisma.client.projectTask.findFirst({
        where: { id: refs.taskId, project: { businessId } },
        select: { id: true },
      });
      if (!task) throw new NotFoundException('Task not found');
    }
  }

  async create(input: CreateTimeEntryInput) {
    await this.assertOwnedRefs(input.businessId, input);

    const duration = this.calculateDuration(input.startTime, input.endTime);

    return this.prisma.client.timeEntry.create({
      data: {
        businessId: input.businessId,
        userId: input.userId,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        durationMinutes: duration,
        projectId: input.projectId,
        taskId: input.taskId,
        billable: input.billable ?? true,
        hourlyRate: input.hourlyRate,
      },
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  async startTimer(input: {
    businessId: string;
    userId: string;
    description?: string;
    projectId?: string;
    taskId?: string;
    billable?: boolean;
    hourlyRate?: number;
  }) {
    await this.assertOwnedRefs(input.businessId, input);

    // Stop any running timer first
    await this.stopRunningTimer(input.businessId, input.userId);

    return this.prisma.client.timeEntry.create({
      data: {
        businessId: input.businessId,
        userId: input.userId,
        description: input.description,
        startTime: new Date(),
        projectId: input.projectId,
        taskId: input.taskId,
        billable: input.billable ?? true,
        hourlyRate: input.hourlyRate,
      },
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  async stopTimer(id: string, businessId: string, userId: string) {
    const entry = await this.prisma.client.timeEntry.findFirst({
      where: { id, businessId, userId, endTime: null },
    });
    if (!entry) {
      throw new NotFoundException('No running timer found');
    }

    const now = new Date();
    const duration = this.calculateDuration(entry.startTime, now);

    return this.prisma.client.timeEntry.update({
      where: { id },
      data: { endTime: now, durationMinutes: duration },
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  async stopRunningTimer(businessId: string, userId: string) {
    const running = await this.prisma.client.timeEntry.findFirst({
      where: { businessId, userId, endTime: null },
    });
    if (running) {
      const now = new Date();
      const duration = this.calculateDuration(running.startTime, now);
      await this.prisma.client.timeEntry.update({
        where: { id: running.id },
        data: { endTime: now, durationMinutes: duration },
      });
    }
    return running;
  }

  async getRunningTimer(businessId: string, userId: string) {
    return this.prisma.client.timeEntry.findFirst({
      where: { businessId, userId, endTime: null },
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  async findById(id: string, businessId: string) {
    const entry = await this.prisma.client.timeEntry.findFirst({
      where: { id, businessId },
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!entry) throw new NotFoundException('Time entry not found');
    return entry;
  }

  async list(filters: TimeEntryFilters) {
    const where: Record<string, unknown> = { businessId: filters.businessId };
    if (filters.userId) where.userId = filters.userId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.taskId) where.taskId = filters.taskId;
    if (filters.billable !== undefined) where.billable = filters.billable;
    if (filters.billed !== undefined) where.billed = filters.billed;
    if (filters.startDate || filters.endDate) {
      where.startTime = {};
      if (filters.startDate) (where.startTime as Record<string, Date>).gte = filters.startDate;
      if (filters.endDate) (where.startTime as Record<string, Date>).lte = filters.endDate;
    }

    return this.prisma.client.timeEntry.findMany({
      where,
      orderBy: { startTime: 'desc' },
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
  }

  async update(id: string, businessId: string, input: UpdateTimeEntryInput) {
    const entry = await this.prisma.client.timeEntry.findFirst({
      where: { id, businessId },
    });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.billed) {
      throw new BadRequestException('Cannot edit a billed time entry');
    }

    // Re-parenting an existing entry crosses the tenant boundary just as
    // easily as creating one does. Null is allowed through: it clears the
    // reference rather than pointing it somewhere.
    await this.assertOwnedRefs(businessId, input);

    const data: Record<string, unknown> = {};
    if (input.description !== undefined) data.description = input.description;
    if (input.startTime !== undefined) data.startTime = input.startTime;
    if (input.endTime !== undefined) data.endTime = input.endTime;
    if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
    if (input.projectId !== undefined) data.projectId = input.projectId;
    if (input.taskId !== undefined) data.taskId = input.taskId;
    if (input.billable !== undefined) data.billable = input.billable;
    if (input.hourlyRate !== undefined) data.hourlyRate = input.hourlyRate;

    // Recalculate duration if start/end changed
    const start = (input.startTime ?? entry.startTime) as Date;
    const end = (input.endTime ?? entry.endTime) as Date | null;
    if (end) {
      data.durationMinutes = this.calculateDuration(start, end);
    }

    return this.prisma.client.timeEntry.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  async delete(id: string, businessId: string) {
    const entry = await this.prisma.client.timeEntry.findFirst({
      where: { id, businessId },
    });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.billed) {
      throw new BadRequestException('Cannot delete a billed time entry');
    }
    await this.prisma.client.timeEntry.delete({ where: { id } });
    return { deleted: true };
  }

  async getSummary(filters: TimeEntryFilters) {
    const where: Record<string, unknown> = { businessId: filters.businessId };
    if (filters.userId) where.userId = filters.userId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.startDate || filters.endDate) {
      where.startTime = {};
      if (filters.startDate) (where.startTime as Record<string, Date>).gte = filters.startDate;
      if (filters.endDate) (where.startTime as Record<string, Date>).lte = filters.endDate;
    }

    const [totalEntries, totalMinutes, billableMinutes, billedMinutes] = await Promise.all([
      this.prisma.client.timeEntry.count({ where }),
      this.prisma.client.timeEntry.aggregate({ where, _sum: { durationMinutes: true } }).then(r => r._sum.durationMinutes ?? 0),
      this.prisma.client.timeEntry.aggregate({ where: { ...where, billable: true }, _sum: { durationMinutes: true } }).then(r => r._sum.durationMinutes ?? 0),
      this.prisma.client.timeEntry.aggregate({ where: { ...where, billable: true, billed: true }, _sum: { durationMinutes: true } }).then(r => r._sum.durationMinutes ?? 0),
    ]);

    return {
      totalEntries,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      billableMinutes,
      billableHours: Math.round((billableMinutes / 60) * 100) / 100,
      billedMinutes,
      billedHours: Math.round((billedMinutes / 60) * 100) / 100,
      unbilledMinutes: billableMinutes - billedMinutes,
      unbilledHours: Math.round(((billableMinutes - billedMinutes) / 60) * 100) / 100,
    };
  }

  async markAsBilled(ids: string[], businessId: string, invoiceId: string) {
    // The entries are already scoped by businessId in the `where` below, but
    // invoiceId came from the request body and was written unchecked — so a
    // caller could mark their own entries as billed against ANOTHER tenant's
    // invoice, corrupting that tenant's billing records.
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return this.prisma.client.timeEntry.updateMany({
      where: { id: { in: ids }, businessId, billable: true, billed: false },
      data: { billed: true, invoiceId },
    });
  }

  /**
   * "Invoice everything unbilled on this project."
   *
   * THE JOIN THAT WAS MISSING. Both legs already existed and had never been
   * connected: `markAsBilled` writes `billed` and `invoiceId`, `TimeEntry`
   * carries `hourlyRate` and an `invoice` relation, and `@@index([businessId,
   * billable, billed])` is exactly the index this query wants — while nothing
   * in `commerce` or `projects` read `timeEntry` at all. Tracked hours and
   * issued invoices were two halves of a sentence nobody had written.
   *
   * It is one of the instructions no incumbent can execute: Harvest cannot post
   * an invoice, Xero cannot see the timer, and neither can be made to.
   *
   * REFUSES RATHER THAN INVOICING NOTHING. An empty selection throws instead of
   * producing a zero-total invoice and reporting success — a "sent" invoice for
   * no work is the fabricated-success shape this codebase keeps finding, and it
   * would reach a customer.
   *
   * ENTRIES WITH NO RATE ARE REFUSED, NOT SILENTLY ZEROED. `hourlyRate` is
   * nullable, and billing an hour at an implicit £0 is how time disappears:
   * the entry is marked billed, the invoice is short, and the hours can never
   * be recovered because `billed` is now true.
   *
   * ON ATOMICITY, stated because it is a real limitation. The invoice is
   * created and the entries are marked in two steps, not one transaction —
   * `createInvoice` owns tax, discount and numbering and does not accept a
   * transaction client. So the count is VERIFIED: if the number of entries
   * marked does not equal the number selected, this throws naming the invoice,
   * because the alternative is hours that look unbilled and have already been
   * charged. `markAsBilled` filters on `billed: false`, so a retry cannot
   * double-mark.
   */
  async invoiceUnbilledTime(
    businessId: string,
    input: {
      projectId?: string;
      contactId?: string;
      currency?: string;
      dueDate?: Date | string;
      taxRate?: number;
      notes?: string;
      createInvoice: (args: {
        businessId: string;
        contactId?: string;
        items: { description: string; quantity: number; unitPrice: number }[];
        currency?: string;
        dueDate?: Date | string;
        taxRate?: number;
        notes?: string;
      }) => Promise<{ id: string; invoiceNumber?: string; total?: number }>;
    },
  ) {
    const entries = await this.prisma.client.timeEntry.findMany({
      where: {
        businessId,
        billable: true,
        billed: false,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        durationMinutes: { not: null },
      },
      orderBy: { startTime: 'asc' },
      include: { task: { select: { title: true } }, project: { select: { name: true } } },
    });

    if (entries.length === 0) {
      throw new BadRequestException(
        input.projectId
          ? 'No unbilled billable time on this project.'
          : 'No unbilled billable time for this business.',
      );
    }

    const unrated = entries.filter((e) => e.hourlyRate === null || e.hourlyRate === undefined);
    if (unrated.length > 0) {
      throw new BadRequestException(
        `${unrated.length} of ${entries.length} time entries have no hourly rate. ` +
          'Set a rate on them, or mark them non-billable — billing them at zero would ' +
          'mark the hours as billed and make them unrecoverable.',
      );
    }

    // One line per task, so the invoice reads the way the work happened rather
    // than as an undifferentiated block of hours.
    const byLine = new Map<string, { minutes: number; rate: number }>();
    for (const e of entries) {
      const label =
        e.task?.title ??
        e.description ??
        (e.project?.name ? `${e.project.name} — time` : 'Billable time');
      const existing = byLine.get(label);
      const minutes = e.durationMinutes ?? 0;
      if (existing && existing.rate === e.hourlyRate) {
        existing.minutes += minutes;
      } else if (existing) {
        // Same label at a different rate is a genuinely different line.
        byLine.set(`${label} (@ ${e.hourlyRate})`, { minutes, rate: e.hourlyRate! });
      } else {
        byLine.set(label, { minutes, rate: e.hourlyRate! });
      }
    }

    const items = [...byLine.entries()].map(([description, { minutes, rate }]) => ({
      description,
      // Two decimals of an hour. Rounding per LINE rather than per entry keeps
      // the invoice total within a cent of the hours actually worked.
      quantity: Math.round((minutes / 60) * 100) / 100,
      unitPrice: rate,
    }));

    const invoice = await input.createInvoice({
      businessId,
      contactId: input.contactId,
      items,
      currency: input.currency,
      dueDate: input.dueDate,
      taxRate: input.taxRate,
      notes: input.notes,
    });

    const ids = entries.map((e) => e.id);
    const marked = await this.markAsBilled(ids, businessId, invoice.id);

    if (marked.count !== ids.length) {
      // The silent-zero class, caught rather than logged. updateMany reports a
      // count and this is the only place that reads it.
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber ?? invoice.id} was created, but only ` +
          `${marked.count} of ${ids.length} time entries were marked billed. Those ` +
          'hours are now invoiced and still look unbilled — void the invoice or ' +
          'reconcile the entries before invoicing this project again.',
      );
    }

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      entriesBilled: marked.count,
      totalMinutes: entries.reduce((s, e) => s + (e.durationMinutes ?? 0), 0),
      lineItems: items,
    };
  }

  private calculateDuration(start: Date, end?: Date | null): number | null {
    if (!end) return null;
    return Math.round((end.getTime() - start.getTime()) / 1000 / 60);
  }
}

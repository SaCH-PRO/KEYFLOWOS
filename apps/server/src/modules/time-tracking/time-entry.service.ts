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

  private calculateDuration(start: Date, end?: Date | null): number | null {
    if (!end) return null;
    return Math.round((end.getTime() - start.getTime()) / 1000 / 60);
  }
}

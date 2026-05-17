import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateCallLogInput {
  businessId: string;
  contactId?: string;
  taskId?: string;
  callerId: string;
  scheduledAt?: Date | string;
  script?: string;
  notes?: string;
  evidenceIds?: string[];
}

export interface UpdateCallLogInput {
  contactId?: string;
  scheduledAt?: Date | string;
  script?: string;
  notes?: string;
  evidenceIds?: string[];
}

export interface CompleteCallInput {
  outcome: string;
  duration?: number;
  notes?: string;
  recordingUrl?: string;
  evidenceIds?: string[];
}

export interface CreateFollowUpInput {
  title: string;
  dueDate?: Date | string;
  priority?: string;
  notes?: string;
  assigneeId?: string;
}

export interface ListCallsFilter {
  callerId?: string;
  contactId?: string;
  status?: string; // 'scheduled' | 'completed' | specific outcome
  fromDate?: Date | string;
  toDate?: Date | string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class CallLogService {
  private readonly logger = new Logger(CallLogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
  ) {}

  async createCallLog(input: CreateCallLogInput) {
    const scheduledAt = input.scheduledAt
      ? new Date(input.scheduledAt)
      : undefined;

    const callLog = await this.prisma.client.callLog.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId ?? null,
        taskId: input.taskId ?? null,
        callerId: input.callerId,
        scheduledAt: scheduledAt ?? null,
        script: input.script ?? null,
        notes: input.notes ?? null,
        evidenceIds: input.evidenceIds ?? [],
      },
    });

    this.emitter.emit('call_log.created', {
      businessId: input.businessId,
      callLogId: callLog.id,
      callerId: input.callerId,
      contactId: input.contactId,
    });

    return callLog;
  }

  async getCallLog(id: string) {
    const callLog = await this.prisma.client.callLog.findUnique({
      where: { id },
    });
    if (!callLog) {
      throw new NotFoundException('Call log not found');
    }
    return callLog;
  }

  async listCalls(businessId: string, filters?: ListCallsFilter) {
    const where: any = { businessId };

    if (filters?.callerId) {
      where.callerId = filters.callerId;
    }
    if (filters?.contactId) {
      where.contactId = filters.contactId;
    }
    if (filters?.status) {
      if (filters.status === 'scheduled') {
        where.scheduledAt = { not: null };
        where.completedAt = null;
      } else if (filters.status === 'completed') {
        where.completedAt = { not: null };
      } else {
        where.outcome = filters.status;
      }
    }
    if (filters?.fromDate || filters?.toDate) {
      where.scheduledAt = {};
      if (filters.fromDate) {
        where.scheduledAt.gte = new Date(filters.fromDate);
      }
      if (filters.toDate) {
        where.scheduledAt.lte = new Date(filters.toDate);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.client.callLog.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        skip: filters?.offset ?? 0,
        take: filters?.limit ?? 50,
      }),
      this.prisma.client.callLog.count({ where }),
    ]);

    return { items, total, offset: filters?.offset ?? 0, limit: filters?.limit ?? 50 };
  }

  async updateCallLog(id: string, input: UpdateCallLogInput) {
    const existing = await this.getCallLog(id);

    if (existing.completedAt) {
      throw new BadRequestException('Cannot update a completed call log');
    }

    const updated = await this.prisma.client.callLog.update({
      where: { id },
      data: {
        contactId: input.contactId ?? existing.contactId,
        scheduledAt: input.scheduledAt
          ? new Date(input.scheduledAt)
          : existing.scheduledAt,
        script: input.script ?? existing.script,
        notes: input.notes ?? existing.notes,
        evidenceIds: input.evidenceIds ?? existing.evidenceIds,
      },
    });

    this.emitter.emit('call_log.updated', {
      businessId: existing.businessId,
      callLogId: id,
    });

    return updated;
  }

  async completeCall(id: string, input: CompleteCallInput, completedBy: string) {
    const existing = await this.getCallLog(id);

    if (existing.completedAt) {
      throw new BadRequestException('Call is already completed');
    }

    const updated = await this.prisma.client.callLog.update({
      where: { id },
      data: {
        outcome: input.outcome,
        duration: input.duration ?? null,
        notes: input.notes ?? existing.notes,
        recordingUrl: input.recordingUrl ?? null,
        evidenceIds: input.evidenceIds ?? existing.evidenceIds,
        completedAt: new Date(),
      },
    });

    this.emitter.emit('call_log.completed', {
      businessId: existing.businessId,
      callLogId: id,
      outcome: input.outcome,
      duration: input.duration,
      completedBy,
    });

    return updated;
  }

  async getScheduledCalls(
    businessId: string,
    callerId: string,
    date: Date | string,
  ) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.client.callLog.findMany({
      where: {
        businessId,
        callerId,
        scheduledAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        completedAt: null,
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async createFollowUpTask(
    callLogId: string,
    input: CreateFollowUpInput,
    createdBy: string,
  ) {
    const callLog = await this.getCallLog(callLogId);

    if (!callLog.contactId) {
      throw new BadRequestException(
        'Cannot create follow-up task for a call without a contact',
      );
    }

    const task = await this.prisma.client.contactTask.create({
      data: {
        businessId: callLog.businessId,
        contactId: callLog.contactId,
        title: input.title,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        status: 'OPEN',
        priority: input.priority ?? 'NORMAL',
        source: 'call_follow_up',
        assigneeId: input.assigneeId ?? callLog.callerId,
        callLogId,
      },
    });

    await this.prisma.client.callLog.update({
      where: { id: callLogId },
      data: { followUpTaskId: task.id },
    });

    this.emitter.emit('call_log.follow_up_created', {
      businessId: callLog.businessId,
      callLogId,
      taskId: task.id,
      contactId: callLog.contactId,
      createdBy,
    });

    return task;
  }

  async createFromContactNextAction(
    contactId: string,
    callerId: string,
    script?: string,
  ) {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        businessId: true,
        nextActionAt: true,
        nextActionType: true,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    if (contact.nextActionType !== 'call') {
      throw new BadRequestException(
        `Contact next action is '${contact.nextActionType}', not 'call'`,
      );
    }

    const callLog = await this.prisma.client.callLog.create({
      data: {
        businessId: contact.businessId,
        contactId: contact.id,
        callerId,
        scheduledAt: contact.nextActionAt ?? new Date(),
        script: script ?? null,
        evidenceIds: [],
      },
    });

    this.emitter.emit('call_log.created_from_next_action', {
      businessId: contact.businessId,
      callLogId: callLog.id,
      contactId: contact.id,
      callerId,
    });

    return callLog;
  }

  async deleteCallLog(id: string) {
    const existing = await this.getCallLog(id);

    if (existing.completedAt) {
      throw new BadRequestException('Cannot delete a completed call log');
    }

    await this.prisma.client.callLog.delete({ where: { id } });

    this.emitter.emit('call_log.deleted', {
      businessId: existing.businessId,
      callLogId: id,
    });

    return { success: true };
  }
}

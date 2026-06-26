import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { normalizeContactEventType, getContactEventCategory } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { EvidenceService } from '../evidence/evidence.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';

type TimelineEntry = {
  id: string;
  type: 'event' | 'note' | 'task' | 'invoice' | 'booking';
  contactId: string;
  contactName?: string;
  contactEmail?: string | null;
  title: string;
  description?: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
};

@Injectable()
export class CrmTimelineService {
  private readonly logger = new Logger(CrmTimelineService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(TaskAssignmentService) private readonly assignments: TaskAssignmentService,
  ) {}

  private formatContactName(contact: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    if (contact.displayName && contact.displayName.trim()) return contact.displayName.trim();
    const full = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (full) return full;
    if (contact.email) return contact.email;
    if (contact.phone) return contact.phone;
    return 'Unnamed';
  }

  private parseDateOrNull(input?: string | null) {
    if (!input) return null;
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async assertContact(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  async logEvent(
    businessId: string,
    contactId: string,
    type: string,
    data: any,
    meta?: { actorType?: string; actorId?: string; source?: string },
    tx?: {
      contactEvent: { create: (args: any) => Promise<{ id: string }> };
      contact?: { update: (args: any) => Promise<unknown> };
    },
  ) {
    const client = tx ?? this.prisma.client;
    const normalized = normalizeContactEventType(type);
    if (!normalized.canonical) {
      throw new BadRequestException(
        `Unknown ContactEvent type "${type}". Use a canonical CONTACT_EVENT_TYPES value.`,
      );
    }
    const created = await client.contactEvent.create({
      data: {
        businessId,
        contactId,
        type: normalized.canonical,
        data: data ?? {},
        actorType: meta?.actorType,
        actorId: meta?.actorId,
        source: meta?.source ?? 'system',
      },
    });

    // Also write to unified Activity ledger (Wave 1)
    const categoryMap: Record<string, 'CONTACT' | 'COMMERCE' | 'BOOKING' | 'PAYMENT' | 'AI' | 'SYSTEM' | 'STORE' | 'TASK'> = {
      communication: 'CONTACT',
      revenue: 'COMMERCE',
      booking: 'BOOKING',
      payment: 'PAYMENT',
      ai: 'AI',
      system: 'SYSTEM',
      store: 'STORE',
      task: 'TASK',
    };
    const contactEventCat = getContactEventCategory(normalized.canonical);
    this.timeline.recordEvent({
      businessId,
      module: 'crm',
      action: normalized.canonical,
      entityType: 'contact',
      entityId: contactId,
      title: normalized.canonical,
      detail: typeof data === 'string' ? data : JSON.stringify(data ?? {}),
      contactId,
      category: (contactEventCat ? categoryMap[contactEventCat] : undefined) ?? 'CONTACT',
      type: normalized.canonical,
      actorType: (meta?.actorType as any) ?? 'SYSTEM',
      actorId: meta?.actorId,
      data: data ?? {},
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record activity for contactEvent: ${(err as Error).message}`);
    });

    if (getContactEventCategory(normalized.canonical) === 'communication') {
      const contactClient = tx?.contact ?? this.prisma.client.contact;
      try {
        await contactClient.update({
          where: { id: contactId },
          data: { lastContactedAt: new Date() },
        });
      } catch (err: any) {
        this.logger.warn(
          `[CRM] failed to update lastContactedAt for contact=${contactId}: ${(err as Error).message}`,
        );
      }
    }
    this.events.emit('crm.contact_event.logged', {
      businessId,
      contactId,
      type: normalized.canonical,
      eventId: created?.id,
      source: meta?.source ?? 'system',
      actorType: meta?.actorType,
      actorId: meta?.actorId,
      data: data ?? {},
    });
    return created;
  }

  async listContactEvents(params: { businessId: string; contactId: string; limit?: number }) {
    await this.assertContact(params.businessId, params.contactId);
    return this.prisma.client.contactEvent.findMany({
      where: { businessId: params.businessId, contactId: params.contactId },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 20,
    });
  }

  async listContactNotes(params: { businessId: string; contactId: string }) {
    await this.assertContact(params.businessId, params.contactId);
    return this.prisma.client.contactNote.findMany({
      where: { businessId: params.businessId, contactId: params.contactId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listContactTasks(input: {
    businessId: string;
    contactId?: string;
    status?: string;
    dueBefore?: Date;
  }) {
    const where: any = { businessId: input.businessId };
    if (input.contactId) {
      await this.assertContact(input.businessId, input.contactId);
      where.contactId = input.contactId;
    }
    if (input.status) where.status = input.status;
    if (input.dueBefore) where.dueDate = { lte: input.dueBefore };
    return this.prisma.client.contactTask.findMany({
      where,
      orderBy: { dueDate: 'asc', createdAt: 'desc' },
      include: { contact: true },
      take: 100,
    });
  }

  addNote(input: { businessId: string; contactId: string; body: string; authorId?: string | null; source?: string }) {
    return this.assertContact(input.businessId, input.contactId).then(async () => {
      const note = await this.prisma.client.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body: input.body,
          authorId: input.authorId ?? null,
          source: input.source ?? 'manual',
        },
      });
      await this.logEvent(
        input.businessId,
        input.contactId,
        'note.created',
        { noteId: note.id },
        { source: input.source ?? 'crm', actorType: 'USER', actorId: input.authorId ?? undefined },
      );
      return note;
    });
  }

  async addTask(input: {
    businessId: string;
    contactId: string;
    title: string;
    dueDate?: string | null;
    priority?: string | null;
    assigneeId?: string | null;
    assigneeType?: string | null;
    remindAt?: string | null;
    creatorId?: string | null;
    source?: string | null;
  }) {
    await this.assertContact(input.businessId, input.contactId);

    const task = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.contactTask.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          title: input.title,
          dueDate: this.parseDateOrNull(input.dueDate),
          priority: input.priority ?? 'NORMAL',
          assigneeId: input.assigneeId ?? null,
          remindAt: this.parseDateOrNull(input.remindAt),
          source: input.source ?? 'manual',
        },
      });

      // Phase 3: polymorphic task assignment (atomic)
      if (input.assigneeId) {
        let assignableType: string = (input.assigneeType as any) ?? 'User';
        const [user, staff] = await Promise.all([
          tx.user.findUnique({ where: { id: input.assigneeId }, select: { id: true } }),
          tx.staffMember.findUnique({ where: { id: input.assigneeId }, select: { id: true } }),
        ]);
        if (staff) assignableType = 'StaffMember';
        else if (user) assignableType = 'User';

        await tx.taskAssignment.create({
          data: {
            taskType: 'ContactTask',
            taskId: created.id,
            assignableType,
            assignableId: input.assigneeId,
            assignedBy: input.creatorId ?? 'system',
            reason: 'task_created',
          },
        });
      }

      return created;
    });

    await this.logEvent(
      input.businessId,
      input.contactId,
      'task.created',
      {
        title: input.title,
        dueDate: input.dueDate,
        priority: input.priority ?? 'NORMAL',
        assigneeId: input.assigneeId,
      },
      { actorType: 'USER', actorId: input.creatorId ?? undefined, source: input.source ?? 'crm' },
    );
    this.events.emit('contact_task.created', { task, businessId: input.businessId });
    return task;
  }

  async updateNote(input: { businessId: string; noteId: string; body?: string; source?: string }) {
    const note = await this.prisma.client.contactNote.findFirst({
      where: { id: input.noteId, businessId: input.businessId },
    });
    if (!note) throw new NotFoundException('Note not found');
    const data: any = {};
    if (input.body !== undefined) data.body = input.body;
    if (input.source !== undefined) data.source = input.source;
    const updated = await this.prisma.client.contactNote.update({
      where: { id: input.noteId },
      data,
    });
    await this.logEvent(input.businessId, note.contactId, 'note.updated', { noteId: note.id });
    return updated;
  }

  async deleteNote(input: { businessId: string; noteId: string }) {
    const note = await this.prisma.client.contactNote.findFirst({
      where: { id: input.noteId, businessId: input.businessId },
    });
    if (!note) throw new NotFoundException('Note not found');
    await this.prisma.client.contactNote.delete({ where: { id: input.noteId } });
    await this.logEvent(input.businessId, note.contactId, 'note.deleted', { noteId: note.id, body: note.body?.slice(0, 100) });
    return { deleted: true };
  }

  async updateTask(input: { businessId: string; taskId: string; title?: string; dueDate?: string; priority?: string; remindAt?: string }) {
    const task = await this.prisma.client.contactTask.findFirst({
      where: { id: input.taskId, businessId: input.businessId },
    });
    if (!task) throw new NotFoundException('Task not found');
    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.remindAt !== undefined) data.remindAt = input.remindAt ? new Date(input.remindAt) : null;
    const updated = await this.prisma.client.contactTask.update({
      where: { id: input.taskId },
      data,
    });
    await this.logEvent(input.businessId, task.contactId, 'task.updated', { taskId: task.id, title: updated.title });
    this.events.emit('contact_task.updated', { task: updated, businessId: input.businessId });
    if (input.dueDate !== undefined && input.dueDate !== (task.dueDate?.toISOString?.() ?? null)) {
      this.events.emit('contact_task.rescheduled', { task: updated, businessId: input.businessId });
    }
    return updated;
  }

  async deleteTask(input: { businessId: string; taskId: string }) {
    const task = await this.prisma.client.contactTask.findFirst({
      where: { id: input.taskId, businessId: input.businessId },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.client.contactTask.delete({ where: { id: input.taskId } });
    await this.logEvent(input.businessId, task.contactId, 'task.deleted', { taskId: task.id, title: task.title });
    this.events.emit('contact_task.deleted', { businessId: input.businessId, taskId: task.id });
    return { deleted: true };
  }

  async completeTask(input: { businessId: string; taskId: string; evidenceIds?: string[] }) {
    const task = await this.prisma.client.contactTask.findFirst({
      where: { id: input.taskId, businessId: input.businessId },
    });
    if (!task) throw new NotFoundException('Task not found');

    // Phase 2: Check evidence requirement
    if (task.evidenceRequired) {
      const check = await this.evidence.checkTaskEvidence('ContactTask', input.taskId);
      if (!check.hasEvidence && (!input.evidenceIds || input.evidenceIds.length === 0)) {
        throw new BadRequestException(
          `This task requires evidence before completion. Please submit proof (photo, file, note, etc.) and try again.`
        );
      }
    }

    const updated = await this.prisma.client.contactTask.update({
      where: { id: input.taskId },
      data: { status: 'DONE', completedAt: new Date() },
    });
    await this.logEvent(input.businessId, task.contactId, 'task.completed', {
      taskId: task.id,
      title: task.title,
      evidenceIds: input.evidenceIds ?? [],
    });
    this.events.emit('contact_task.completed', { task: updated, businessId: input.businessId });
    return updated;
  }

  async reopenTask(input: { businessId: string; taskId: string }) {
    const task = await this.prisma.client.contactTask.findFirst({
      where: { id: input.taskId, businessId: input.businessId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const updated = await this.prisma.client.contactTask.update({
      where: { id: input.taskId },
      data: { status: 'OPEN', completedAt: null },
    });
    await this.logEvent(input.businessId, task.contactId, 'task.reopened', { taskId: task.id, title: task.title });
    this.events.emit('contact_task.reopened', { task: updated, businessId: input.businessId });
    return updated;
  }

  async logCommunication(input: {
    businessId: string;
    contactId: string;
    channelType: string;
    outcome: string;
    duration?: number | null;
    notes?: string | null;
    actorId?: string | null;
  }) {
    const validChannels = ['call', 'email', 'whatsapp', 'meeting', 'sms'];
    const validOutcomes = ['answered', 'voicemail', 'no-answer', 'sent', 'received', 'completed', 'cancelled'];
    const channelType = validChannels.includes(input.channelType) ? input.channelType : 'call';
    const outcome = validOutcomes.includes(input.outcome) ? input.outcome : 'answered';

    await this.assertContact(input.businessId, input.contactId);

    const eventData: Record<string, unknown> = {
      channelType,
      outcome,
    };
    if (input.duration != null) eventData.duration = input.duration;
    if (input.notes) eventData.notes = input.notes;

    const event = await this.logEvent(
      input.businessId,
      input.contactId,
      `communication.${channelType}`,
      eventData,
      { actorType: 'USER', actorId: input.actorId ?? undefined, source: 'crm' },
    );

    let note = null;
    if (input.notes && input.notes.trim()) {
      const durationStr = input.duration ? ` (${input.duration} min)` : '';
      const noteBody = `[${channelType.toUpperCase()} - ${outcome}]${durationStr}\n${input.notes.trim()}`;
      note = await this.prisma.client.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body: noteBody,
          authorId: input.actorId ?? null,
          source: 'communication-log',
        },
      });
    }

    return { event, note };
  }

  async logContactEvent(input: {
    businessId: string;
    contactId: string;
    type: string;
    data: any;
    actorType?: string;
    actorId?: string;
    source?: string;
  }) {
    await this.assertContact(input.businessId, input.contactId);
    return this.logEvent(input.businessId, input.contactId, input.type, input.data, {
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
    });
  }

  /**
   * One-shot idempotent backfill: rewrites legacy event types to canonical.
   * Rows whose type is already canonical or legacy-flagged are skipped.
   */
  async backfillLegacyEvents(input: { businessId?: string; batchSize?: number } = {}) {
    const batchSize = input.batchSize ?? 500;
    let processed = 0;
    let aliased = 0;
    let flagged = 0;
    let cursor: string | null = null;

    while (true) {
      const rows: Array<{ id: string; type: string; data: unknown }> =
        await this.prisma.client.contactEvent.findMany({
          where: input.businessId ? { businessId: input.businessId } : {},
          select: { id: true, type: true, data: true },
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      for (const row of rows) {
        processed++;
        const normalized = normalizeContactEventType(row.type);
        const existingData =
          typeof row.data === 'object' && row.data !== null && !Array.isArray(row.data)
            ? (row.data as Record<string, unknown>)
            : {};
        if (normalized.canonical && normalized.wasAliased) {
          await this.prisma.client.contactEvent.update({
            where: { id: row.id },
            data: { type: normalized.canonical },
          });
          aliased++;
        } else if (!normalized.canonical && existingData.is_legacy !== true) {
          await this.prisma.client.contactEvent.update({
            where: { id: row.id },
            data: {
              data: { ...existingData, is_legacy: true, legacy_type: row.type },
            },
          });
          flagged++;
        }
      }

      if (rows.length < batchSize) break;
    }

    this.logger.log(`[ContactEvent backfill] processed=${processed} aliased=${aliased} flagged=${flagged}`);
    return { processed, aliased, flagged };
  }

  async dueTasks(input: { businessId: string; windowDays?: number }) {
    const windowDays = input.windowDays ?? 7;
    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + windowDays);
    return this.prisma.client.contactTask.findMany({
        where: {
          businessId: input.businessId,
          status: { not: 'DONE' },
          OR: [
            { dueDate: { lte: now } },
            { dueDate: { lte: soon } },
            { remindAt: { lte: soon } },
          ],
        },
      orderBy: { dueDate: 'asc' },
      include: { contact: true },
      take: 50,
    });
  }

  async approveAutopilotAction(input: { businessId: string; actionId: string }) {
    const parts = input.actionId.split('_');
    const actionType = parts[0];
    const id = parts.slice(1).join('_');
    let contactId = id;

    const ACTION_TASK_MAP: Record<string, { titleFn: (name: string) => string; priority: string }> = {
      checkin: { titleFn: (n) => `Check in with ${n} — scheduled by autopilot`, priority: 'MEDIUM' },
      nudge: { titleFn: (n) => `Send nurture email to ${n} — cold lead re-engagement`, priority: 'MEDIUM' },
      autowelcome: { titleFn: (n) => `Send welcome message to ${n}`, priority: 'HIGH' },
      stalenudge: { titleFn: (n) => `Send incentive offer to ${n} — stale prospect`, priority: 'MEDIUM' },
      postbooking: { titleFn: (n) => `Send post-session follow-up`, priority: 'MEDIUM' },
    };

    try {
      if (actionType === 'overdue' && parts[1] === 'inv') {
        const invoiceId = parts.slice(2).join('_');
        const invoice = await this.prisma.client.invoice.findFirst({
          where: { id: invoiceId, businessId: input.businessId },
        });
        contactId = invoice?.contactId || invoiceId;
        if (contactId) {
          await this.prisma.client.contactTask.create({
            data: {
              businessId: input.businessId,
              contactId,
              title: `Send payment reminder for invoice ${invoice?.invoiceNumber || invoiceId}`,
              status: 'OPEN',
              priority: 'HIGH',
              dueDate: new Date(),
              source: 'autopilot',
            },
          });
        }
      } else if (ACTION_TASK_MAP[actionType]) {
        const mapping = ACTION_TASK_MAP[actionType];
        if (actionType === 'postbooking') {
          const booking = await this.prisma.client.booking.findFirst({
            where: { id, contact: { businessId: input.businessId, deletedAt: null } },
            select: { contactId: true, contact: { select: { firstName: true } } },
          });
          if (booking?.contactId) {
            contactId = booking.contactId;
            const name = booking.contact?.firstName || 'client';
            await this.prisma.client.contactTask.create({
              data: {
                businessId: input.businessId,
                contactId,
                title: mapping.titleFn(name),
                status: 'OPEN',
                priority: mapping.priority,
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                source: 'autopilot',
              },
            });
          }
        } else {
          contactId = id;
          const contact = await this.prisma.client.contact.findFirst({
            where: { id: contactId, businessId: input.businessId, deletedAt: null },
          });
          if (contact) {
            await this.prisma.client.contactTask.create({
              data: {
                businessId: input.businessId,
                contactId,
                title: mapping.titleFn(contact.firstName || 'contact'),
                status: 'OPEN',
                priority: mapping.priority,
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                source: 'autopilot',
              },
            });
          }
        }
      }
    } catch (err: any) {
      console.error('Error creating task for autopilot approval:', err);
    }

    await this.logEvent(input.businessId, contactId, 'autopilot.approved', {
      actionId: input.actionId,
    });
    return { approved: true, actionId: input.actionId };
  }

  async denyAutopilotAction(input: { businessId: string; actionId: string }) {
    const parts = input.actionId.split('_');
    const actionType = parts[0];
    const id = parts.slice(1).join('_');
    let contactId = id;

    if (actionType === 'overdue' && parts[1] === 'inv') {
      const invoiceId = parts.slice(2).join('_');
      const invoice = await this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, businessId: input.businessId },
      });
      contactId = invoice?.contactId || invoiceId;
    } else if (actionType === 'postbooking') {
      const booking = await this.prisma.client.booking.findFirst({
        where: { id, contact: { businessId: input.businessId, deletedAt: null } },
        select: { contactId: true },
      });
      contactId = booking?.contactId || id;
    }

    await this.logEvent(input.businessId, contactId, 'autopilot.denied', {
      actionId: input.actionId,
    });
    return { denied: true, actionId: input.actionId };
  }

  async buildTimeline(businessId: string, limit = 20): Promise<TimelineEntry[]> {
    const [events, notes, tasks, invoices, bookings] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const contactIds = Array.from(
      new Set(
        [
          ...events.map((event) => event.contactId),
          ...notes.map((note) => note.contactId),
          ...tasks.map((task) => task.contactId),
          ...invoices.map((invoice) => invoice.contactId),
          ...bookings.map((booking) => booking.contactId),
        ].filter(Boolean),
      ),
    );
    const contacts = contactIds.length
      ? await this.prisma.client.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true },
        })
      : [];
    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));

    const entries: TimelineEntry[] = [
      ...events.map((event) => ({
        id: event.id,
        type: 'event' as const,
        contactId: event.contactId,
        contactName: contactMap.get(event.contactId)
          ? this.formatContactName(contactMap.get(event.contactId)!)
          : undefined,
        contactEmail: contactMap.get(event.contactId)?.email ?? null,
        title: event.type,
        description: `Event recorded via ${event.source ?? 'system'}`,
        timestamp: event.createdAt,
      })),
      ...notes.map((note) => ({
        id: note.id,
        type: 'note' as const,
        contactId: note.contactId,
        contactName: contactMap.get(note.contactId) ? this.formatContactName(contactMap.get(note.contactId)!) : undefined,
        contactEmail: contactMap.get(note.contactId)?.email ?? null,
        title: 'Note added',
        description: note.body.slice(0, 120),
        timestamp: note.createdAt,
      })),
      ...tasks.map((task) => ({
        id: task.id,
        type: 'task' as const,
        contactId: task.contactId,
        contactName: contactMap.get(task.contactId) ? this.formatContactName(contactMap.get(task.contactId)!) : undefined,
        contactEmail: contactMap.get(task.contactId)?.email ?? null,
        title: `Task: ${task.title}`,
        description: task.dueDate ? `Due ${new Date(task.dueDate).toLocaleString()}` : 'No due date',
        timestamp: task.createdAt,
      })),
      ...invoices.map((invoice) => ({
        id: invoice.id,
        type: 'invoice' as const,
        contactId: invoice.contactId,
        contactName: contactMap.get(invoice.contactId)
          ? this.formatContactName(contactMap.get(invoice.contactId)!)
          : undefined,
        contactEmail: contactMap.get(invoice.contactId)?.email ?? null,
        title: `Invoice ${invoice.status}`,
        description: `Total ${invoice.total} ${invoice.currency}`,
        timestamp: invoice.createdAt,
      })),
      ...bookings.map((booking) => ({
        id: booking.id,
        type: 'booking' as const,
        contactId: booking.contactId,
        contactName: contactMap.get(booking.contactId)
          ? this.formatContactName(contactMap.get(booking.contactId)!)
          : undefined,
        contactEmail: contactMap.get(booking.contactId)?.email ?? null,
        title: `Booking ${booking.status}`,
        description: `Starts ${booking.startTime?.toISOString() ?? 'TBD'}`,
        timestamp: booking.createdAt,
      })),
    ];

    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }
}

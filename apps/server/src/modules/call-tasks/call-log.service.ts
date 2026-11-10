import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  assertContactVisible,
  contactVisibilityFilter,
  resolveCrmAccess,
  visibilityClause,
  type CrmAccess,
} from '../crm/crm-permissions.helper';

/**
 * The session member a call-log route reads or writes for (V1-84): their user id and their
 * session role (the User row's role, which AuthMiddleware attached to the request).
 */
export interface CallLogViewer {
  userId: string;
  role?: string | null;
}

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
  /** The member the list is for: only the call logs whose contact they may open (V1-84). */
  viewer?: CallLogViewer;
}

@Injectable()
export class CallLogService {
  private readonly logger = new Logger(CallLogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
  ) {}

  /**
   * A call log's contact is the business's own (V1-21b review 9 TD9-2). createCallLog and
   * updateCallLog stored any contactId: a call log of A then named B's contact, getCallLog(A, id)
   * passed, and createFollowUpTask wrote a ContactTask { businessId A, contactId <B's> } whose
   * title reached B's call script. On the staff bridge no tenant context binds anything, and over
   * HTTP the tenant extension binds wheres, not a foreign key. Another business's contact answers
   * as an unknown one.
   */
  private async assertContactInBusiness(businessId: string, contactId: string | null | undefined) {
    if (contactId === undefined || contactId === null) return;
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
  }

  /**
   * A call log's caller is a member user of its business who may open its contact (V1-54 review
   * ST-4; V1-84 review ST-1, CR-1, CR-2). createCallLog stored any callerId, and the KEY tool
   * call_create_task hands it the callerId the model chose, so a call log could name another
   * business's user or any string as the member who makes the call (the tool contract: "User ID
   * who will make the call"). Both writers of a caller, createCallLog and
   * createFromContactNextAction, check it here rather than in the dispatcher or the controller,
   * so every writer is covered.
   *
   * Being the caller grants no visibility of the contact (review CR-2 ruling): the V1-08 rule
   * through CallLog.contactId stays the only rule, so a call is not assigned to a member on a
   * contact that member cannot open, where they could never open, complete or follow it up. A
   * call whose contact is hidden from its caller later (the owner makes it PRIVATE, the member's
   * crm_view changes) leaves that caller's view; the members who may open the contact keep it.
   *
   * `session` is the session member when they are the caller (the HTTP routes): its refusals are
   * the actor's, 403 for a SUPER_ADMIN who is not a member (BusinessGuard lets them through) and,
   * for a contact they cannot open, 404 'Contact not found' as GET contacts/:contactId answers
   * them, with the SUPER_ADMIN bit taken from the session as crmRule does. Without it the callerId
   * is an argument another writer chose (KEY call_create_task, a direct service call): 400, with
   * the caller's role read from their User row.
   */
  private async assertCaller(
    businessId: string,
    callerId: string,
    contactId: string | null | undefined,
    session?: CallLogViewer,
  ) {
    const asSession = session && session.userId === callerId ? session : undefined;
    const membership = callerId
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: callerId, businessId } },
          select: { id: true },
        })
      : null;
    if (!membership) {
      if (asSession) {
        throw new ForbiddenException('Only a member of this business can be the caller of a call log');
      }
      throw new BadRequestException('callerId must belong to a member of this business');
    }
    if (contactId === undefined || contactId === null) return;
    try {
      await assertContactVisible(asSession ? this.crmRule(asSession) : this.prisma, businessId, contactId, callerId);
    } catch (err) {
      if (!asSession && err instanceof NotFoundException) {
        throw new BadRequestException('callerId must be a member who may open this contact');
      }
      throw err;
    }
  }

  /**
   * The CRM rule's client for `viewer` (V1-84). resolveCrmAccess, assertContactVisible and
   * contactVisibilityFilter read the User row only to tell SUPER_ADMIN; here the role comes
   * from the session, the same answer ModuleScopeGuard and BusinessGuard decided the request
   * by. The membership and contact reads are the real ones, so the rule is V1-08's verbatim.
   */
  private crmRule(viewer: CallLogViewer): PrismaService {
    const client = this.prisma.client;
    return {
      client: {
        user: { findUnique: async () => ({ role: viewer.role ?? 'USER' }) },
        membership: client.membership,
        contact: client.contact,
      },
    } as unknown as PrismaService;
  }

  private viewerAccess(businessId: string, viewer: CallLogViewer): Promise<CrmAccess> {
    return resolveCrmAccess(this.crmRule(viewer), businessId, viewer.userId);
  }

  /**
   * Refuses, as GET contacts/:contactId refuses an unknown id (404 'Contact not found'), a
   * contact `viewer` may not open by the V1-08 rule: a PATCH that moves a call log onto it would
   * put the member's call notes on a contact they cannot see and show them that it exists
   * (V1-84). POST calls and from-next-action, where the member is the caller, are checked by
   * assertCaller. No contact is no check.
   */
  async assertContactVisibleTo(businessId: string, contactId: string | null | undefined, viewer: CallLogViewer) {
    if (contactId === undefined || contactId === null) return;
    await assertContactVisible(this.crmRule(viewer), businessId, contactId, viewer.userId);
  }

  /**
   * The call log `id` of `businessId` if `viewer` may open it (V1-84): a call log on a contact
   * the member may not open (V1-08: another member's PRIVATE contact, or outside "my book" under
   * crm_view 'owned') answers 404 'Call log not found', exactly as an unknown id, so its notes,
   * script and outcome are not read through it and its existence is not told. A call log with
   * no contact is the business's. A member with the whole book (OWNER, SUPER_ADMIN) reads as
   * before: no contact lookup is made for them. Being the call log's caller opens nothing (review
   * CR-2 ruling, see assertCaller): the rule is the contact's.
   */
  async getVisibleCallLog(businessId: string, id: string, viewer: CallLogViewer) {
    const callLog = await this.getCallLog(businessId, id);
    if (!callLog.contactId) return callLog;
    const access = await this.viewerAccess(businessId, viewer);
    if (!visibilityClause(access, viewer.userId)) return callLog;
    try {
      await assertContactVisible(this.crmRule(viewer), businessId, callLog.contactId, viewer.userId);
    } catch (err) {
      if (err instanceof NotFoundException) throw new NotFoundException('Call log not found');
      throw err;
    }
    return callLog;
  }

  /**
   * A where that keeps the call logs `viewer` may open among those `where` matches, or null
   * when the member has the whole book (V1-84). The distinct contacts of the matching call logs
   * go through contactVisibilityFilter (the V1-08 rule), and the list keeps the contactless
   * call logs and those on a visible contact. A contact soft-deleted or gone is not visible.
   */
  private async visibleCallLogsWhere(
    businessId: string,
    where: Prisma.CallLogWhereInput,
    viewer: CallLogViewer,
  ): Promise<Prisma.CallLogWhereInput | null> {
    const access = await this.viewerAccess(businessId, viewer);
    if (!visibilityClause(access, viewer.userId)) return null;
    const rows = await this.prisma.client.callLog.findMany({
      where,
      select: { contactId: true },
      distinct: ['contactId'],
    });
    const contactIds = rows.map((r: { contactId: string | null }) => r.contactId).filter((id): id is string => !!id);
    const canOpen = await contactVisibilityFilter(this.crmRule(viewer), businessId, access, viewer.userId, contactIds);
    const visible = canOpen ? contactIds.filter((id) => canOpen(id)) : contactIds;
    return { OR: [{ contactId: null }, { contactId: { in: visible } }] };
  }

  /**
   * `session`: the session member, when they are the caller (POST calls). See assertCaller.
   */
  async createCallLog(input: CreateCallLogInput, session?: CallLogViewer) {
    await this.assertContactInBusiness(input.businessId, input.contactId);
    await this.assertCaller(input.businessId, input.callerId, input.contactId, session);
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

  /**
   * The call log `id` of `businessId`, or 404. Every method below that takes a call log id looks
   * it up here, within the business it is given (V1-21b review 8 DD8-1): a bare findUnique({ id })
   * stays in the tenant only while TenantInterceptor's ambient tenant is armed, which it is for an
   * HTTP request and is not on the WhatsApp/SMS staff bridge, where the KEY dispatcher completed
   * another business's call log and planted a task in its CRM. Another business's id answers as
   * an unknown one.
   */
  async getCallLog(businessId: string, id: string) {
    const callLog = await this.prisma.client.callLog.findFirst({
      where: { id, businessId },
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
    if (filters?.viewer) {
      // In the where, not filtered after the read, so skip/take and the total count only
      // the call logs the member may open.
      const visible = await this.visibleCallLogsWhere(businessId, where, filters.viewer);
      if (visible) where.AND = [visible];
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

  /**
   * A write to a call log that is still open (V1-54 review ST-1). completeCall, updateCallLog and
   * deleteCallLog read completedAt and then wrote by id alone, so two members completing the same
   * call both succeeded: each emitted call_log.completed with its own outcome and completedBy while
   * the row kept one, and the autoExecute 'callback_requested' default trigger could fire for an
   * outcome the row does not hold. An edit or a delete racing a completion likewise rewrote or
   * removed a completed call. The where now carries `completedAt: null`; under Postgres' row lock
   * the second writer re-checks the row the first one changed and matches nothing. A miss is then
   * told apart: the call log is gone (404) or another request completed it (`completedMessage`).
   */
  private async assertOpenWrite(businessId: string, id: string, count: number, completedMessage: string) {
    if (count > 0) return;
    await this.getCallLog(businessId, id);
    throw new BadRequestException(completedMessage);
  }

  async updateCallLog(businessId: string, id: string, input: UpdateCallLogInput) {
    const existing = await this.getCallLog(businessId, id);

    if (existing.completedAt) {
      throw new BadRequestException('Cannot update a completed call log');
    }
    await this.assertContactInBusiness(businessId, input.contactId);

    const { count } = await this.prisma.client.callLog.updateMany({
      where: { id, businessId, completedAt: null },
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
    await this.assertOpenWrite(businessId, id, count, 'Cannot update a completed call log');
    const updated = await this.getCallLog(businessId, id);

    this.emitter.emit('call_log.updated', {
      businessId: existing.businessId,
      callLogId: id,
    });

    return updated;
  }

  async completeCall(businessId: string, id: string, input: CompleteCallInput, completedBy: string) {
    const existing = await this.getCallLog(businessId, id);

    if (existing.completedAt) {
      throw new BadRequestException('Call is already completed');
    }

    // Completed once: only the writer that still finds the call open completes it and emits
    // (see assertOpenWrite).
    const { count } = await this.prisma.client.callLog.updateMany({
      where: { id, businessId, completedAt: null },
      data: {
        outcome: input.outcome,
        duration: input.duration ?? null,
        notes: input.notes ?? existing.notes,
        recordingUrl: input.recordingUrl ?? null,
        evidenceIds: input.evidenceIds ?? existing.evidenceIds,
        completedAt: new Date(),
      },
    });
    await this.assertOpenWrite(businessId, id, count, 'Call is already completed');
    const updated = await this.getCallLog(businessId, id);

    this.emitter.emit('call_log.completed', {
      businessId: existing.businessId,
      callLogId: id,
      outcome: input.outcome,
      duration: input.duration,
      completedBy,
    });

    return updated;
  }

  /**
   * The open calls scheduled on `date`: `callerId`'s when one is named, otherwise every member's
   * in the business (what the Operations dashboard and the call-tasks page show, V1-54 review
   * CR-1). The filter is left out rather than handed to Prisma as undefined. With a `viewer`,
   * only the calls whose contact that member may open (V1-84); the day is not paged, so the
   * rows read are filtered by the V1-08 rule (contactVisibilityFilter).
   */
  async getScheduledCalls(
    businessId: string,
    callerId: string | undefined,
    date: Date | string,
    viewer?: CallLogViewer,
  ) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const access = viewer ? await this.viewerAccess(businessId, viewer) : null;
    const calls = await this.prisma.client.callLog.findMany({
      where: {
        businessId,
        ...(callerId ? { callerId } : {}),
        scheduledAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        completedAt: null,
      },
      orderBy: { scheduledAt: 'asc' },
    });
    if (!viewer || !access) return calls;
    const canOpen = await contactVisibilityFilter(
      this.crmRule(viewer),
      businessId,
      access,
      viewer.userId,
      calls.map((c: { contactId: string | null }) => c.contactId),
    );
    return canOpen ? calls.filter((c: { contactId: string | null }) => !c.contactId || canOpen(c.contactId)) : calls;
  }

  /**
   * `viewer` (W9-KEY-OBLIGATIONS-CALLS; owner rulings D-64, D-88): the member a KEY command runs for.
   * With one, the call log is looked up as GET calls/:id looks it up for them (getVisibleCallLog), so
   * one on a contact they may not open answers 404 'Call log not found', exactly as an unknown id.
   * Without one, as before; POST calls/:id/follow-up checks its session member before it calls this.
   */
  async createFollowUpTask(
    businessId: string,
    callLogId: string,
    input: CreateFollowUpInput,
    createdBy: string,
    viewer?: CallLogViewer,
  ) {
    const callLog = viewer
      ? await this.getVisibleCallLog(businessId, callLogId, viewer)
      : await this.getCallLog(businessId, callLogId);

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
        // W9-KEY-OBLIGATIONS-CALLS review (SEC-W9KOC-2): the row looked up (and, with a viewer,
        // checked) is the row written, never the argument it was found by.
        callLogId: callLog.id,
      },
    });

    await this.prisma.client.callLog.update({
      where: { id: callLog.id },
      data: { followUpTaskId: task.id },
    });

    this.emitter.emit('call_log.follow_up_created', {
      businessId: callLog.businessId,
      callLogId: callLog.id,
      taskId: task.id,
      contactId: callLog.contactId,
      createdBy,
    });

    return task;
  }

  /**
   * A call log for the contact's next action, within `businessId` (V1-54 review ST-3). The
   * contact was looked up by a bare findUnique({ id }) and the call log written under the
   * contact's own business, so where no ambient tenant binds the lookup (a direct service call,
   * the staff bridge) another business's contact got a call log in that business for this
   * business's member. Another business's contact now answers as an unknown one. The caller is
   * checked as createCallLog checks it (assertCaller, V1-84 review ST-1), before the next action
   * is read, so a contact hidden from the caller does not tell its next action. `session`: the
   * session member, when they are the caller (POST contacts/:contactId/calls/from-next-action).
   */
  async createFromContactNextAction(
    businessId: string,
    contactId: string,
    callerId: string,
    script?: string,
    session?: CallLogViewer,
  ) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId },
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
    await this.assertCaller(businessId, callerId, contact.id, session);

    if (contact.nextActionType !== 'call') {
      throw new BadRequestException(
        `Contact next action is '${contact.nextActionType}', not 'call'`,
      );
    }

    const callLog = await this.prisma.client.callLog.create({
      data: {
        businessId,
        contactId: contact.id,
        callerId,
        scheduledAt: contact.nextActionAt ?? new Date(),
        script: script ?? null,
        evidenceIds: [],
      },
    });

    this.emitter.emit('call_log.created_from_next_action', {
      businessId,
      callLogId: callLog.id,
      contactId: contact.id,
      callerId,
    });

    return callLog;
  }

  async deleteCallLog(businessId: string, id: string) {
    const existing = await this.getCallLog(businessId, id);

    if (existing.completedAt) {
      throw new BadRequestException('Cannot delete a completed call log');
    }

    // never removes a call another request has just completed (see assertOpenWrite)
    const { count } = await this.prisma.client.callLog.deleteMany({
      where: { id, businessId, completedAt: null },
    });
    await this.assertOpenWrite(businessId, id, count, 'Cannot delete a completed call log');

    this.emitter.emit('call_log.deleted', {
      businessId: existing.businessId,
      callLogId: id,
    });

    return { success: true };
  }
}

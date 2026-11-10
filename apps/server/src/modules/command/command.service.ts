import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { contactVisibilityFilter, resolveCrmAccess, type CrmAccess } from '../crm/crm-permissions.helper';
import { CreateCommandItemDto } from './dto/create-command-item.dto';
import { UpdateCommandItemDto } from './dto/update-command-item.dto';

/**
 * FOLLOW3-D10 (V1-84): an item that names a contact is listed, read and acted
 * on only by a member who may open that contact. An item names a contact
 * through any of these columns (review ST-D10-2), whichever writer set them:
 * - ownerType 'CONTACT' + ownerId: generateDoItForMe ('Follow up: <name>',
 *   key-command.service.ts) and KEY createCommandItem;
 * - contactId: message intake ('Reply to ...', ownerType 'KEY'), REBOOK
 *   obligations and the intelligence command bridge;
 * - owedToType 'CONTACT' + owedToId: REBOOK obligations ('Rebook <name> for
 *   <service>', bookings.service.ts);
 * - entityType 'contact' + entityId: finance SLOW_PAYER ('Slow payer: <name>').
 * The type columns are free text across writers, so they compare ignoring case.
 * NAMED_CONTACTS_SQL says the same in SQL; the two are kept in step.
 */
type ContactNamingItem = {
  ownerType: string | null;
  ownerId: string | null;
  contactId: string | null;
  owedToType: string | null;
  owedToId: string | null;
  entityType: string | null;
  entityId: string | null;
};

const isContactType = (type: string | null) => (type ?? '').toUpperCase() === 'CONTACT';

function contactsNamedBy(item: ContactNamingItem): string[] {
  return [
    isContactType(item.ownerType) ? item.ownerId : null,
    item.contactId,
    isContactType(item.owedToType) ? item.owedToId : null,
    isContactType(item.entityType) ? item.entityId : null,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** The contacts row `ci` of command_items names, one per column, NULL where a column names none (contactsNamedBy). */
const NAMED_CONTACTS_SQL = Prisma.sql`(VALUES
    (CASE WHEN upper(ci.owner_type) = 'CONTACT' THEN ci.owner_id END),
    (ci.contact_id),
    (CASE WHEN upper(ci.owed_to_type) = 'CONTACT' THEN ci.owed_to_id END),
    (CASE WHEN upper(ci.entity_type) = 'CONTACT' THEN ci.entity_id END)
  ) AS named(contact_id)`;

/**
 * contactVisibilityFilter reads its candidates with one contact.findMany, and
 * the client caps every findMany at 1000 rows (packages/db defaultTakeExtension):
 * contact ids are checked in slices no larger (review CR-1).
 */
const VISIBILITY_SLICE = 1000;

/** The cap the client puts on every findMany (packages/db defaultTakeExtension); the SQL list path keeps it. */
const FIND_MANY_CAP = 1000;

/** The statuses findDue leaves out: the obligation is no longer owed. */
const CLOSED_STATUSES = ['COMPLETED', 'DISMISSED', 'EXECUTED', 'FAILED'];

/**
 * What a business-wide channel says of an item that names a contact (review
 * ST-D10-1). The timeline (GET timeline/businesses/:id/events), notifications
 * (GET notifications/businesses/:id) and the realtime stream serve every member
 * of the business whichever contacts they may open, so the item's title and
 * description, which name the contact, stay on the item, which the member reads
 * only if they may open it.
 */
export const CONTACT_ITEM_LABEL = 'An item for a contact';

type TitledItem = ContactNamingItem & { title: string };

/** The title a business-wide channel may carry for `item` (and what it became, `after`). */
function channelTitle(item: TitledItem, after?: ContactNamingItem): string {
  const names = contactsNamedBy(item).length > 0 || (after ? contactsNamedBy(after).length > 0 : false);
  return names ? CONTACT_ITEM_LABEL : item.title;
}

/** The description a business-wide channel may carry: none for an item that names a contact. */
function channelDetail(item: ContactNamingItem & { description: string | null }): string | undefined {
  return contactsNamedBy(item).length > 0 ? undefined : item.description ?? undefined;
}

/** A Date as the UTC wall time Prisma stores in a TIMESTAMP(3) column, for raw SQL. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Command-centre items. W7-OPS-AUDIT-ACTOR (review SEC-R013g-4, D-40): actorUserId, the member the
 * controller hands every write, also names that member on the feed row the write records (actorId
 * beside actorType); before, approve, complete, dismiss and the rest recorded USER with no one. An
 * internal caller that passes no member (KEY compensation's delete) writes the row as before.
 */
@Injectable()
export class CommandService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  /**
   * actorUserId: the member who files the item (the POST items route, W7-OPS-AUDIT-ACTOR), named on
   * its feed row; the internal writers (the generator, message intake, KEY tools, devices) pass none
   * and the row stays a SYSTEM one, as before.
   */
  async create(businessId: string, dto: CreateCommandItemDto, actorUserId?: string) {
    const item = await this.prisma.client.commandItem.create({
      data: {
        businessId,
        sourceModule: dto.sourceModule,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        actionType: dto.actionType,
        status: dto.status ?? 'OPEN',
        priority: dto.priority ?? 50,
        urgency: dto.urgency ?? 50,
        impactScore: dto.impactScore ?? 0,
        expectedValue: dto.expectedValue ? dto.expectedValue : null,
        currency: dto.currency,
        riskTier: dto.riskTier ?? 1,
        requiresApproval: dto.requiresApproval ?? false,
        executableByKey: dto.executableByKey ?? false,
        executionTool: dto.executionTool,
        executionPayload: dto.executionPayload ?? undefined,
        recommendedBy: dto.recommendedBy,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        contactId: dto.contactId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        dueAt: dto.dueAt,
        snoozedUntil: dto.snoozedUntil,
      },
    });
    // Business-wide channels: an item that names a contact is announced without its title or description (review ST-D10-1).
    const shown = channelTitle(item);
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'create',
      entityType: 'command_item',
      entityId: item.id,
      title: shown,
      detail: channelDetail(item),
      category: 'SYSTEM',
      actorType: actorUserId ? 'USER' : 'SYSTEM',
      actorId: actorUserId,
      data: { category: dto.category, actionType: dto.actionType, priority: dto.priority },
    });
    this.realtime.emit({
      businessId,
      type: 'command.created',
      payload: { id: item.id, title: shown, status: item.status, category: item.category },
    });
    // Notify for high-priority or approval-required commands
    if (item.requiresApproval || item.priority >= 80 || item.riskTier >= 3) {
      await this.notifications.create({
        businessId,
        type: 'command',
        title: item.requiresApproval ? `Approval required: ${shown}` : `High priority: ${shown}`,
        body: channelDetail(item),
        data: { commandId: item.id, category: item.category, priority: item.priority },
      });
    }
    return item;
  }

  /**
   * The member's CRM access when it limits which contacts they may open, else
   * null: no actor (an internal caller: KEY tools, compensation), the OWNER and
   * SUPER_ADMIN. contactVisibilityFilter answers null for exactly the members
   * visibilityClause does not restrict, and reads nothing for an empty list.
   */
  private async restrictedAccess(businessId: string, actorUserId?: string): Promise<CrmAccess | null> {
    if (!actorUserId) return null;
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    return (await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [])) ? access : null;
  }

  /**
   * Which of `contactIds` the member may not open, by the rule GET
   * contacts/:contactId applies (contactVisibilityFilter: the tenant predicate,
   * deletedAt null and visibilityClause), checked in slices of VISIBILITY_SLICE
   * so the client's findMany cap never drops a visible contact (review CR-1).
   */
  private async hiddenAmong(
    businessId: string,
    access: CrmAccess,
    actorUserId: string,
    contactIds: Iterable<string>,
  ): Promise<string[]> {
    const ids = [...new Set(contactIds)];
    const hidden: string[] = [];
    for (let i = 0; i < ids.length; i += VISIBILITY_SLICE) {
      const slice = ids.slice(i, i + VISIBILITY_SLICE);
      const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, slice);
      if (canOpen) hidden.push(...slice.filter((id) => !canOpen(id)));
    }
    return hidden;
  }

  /**
   * The contacts named by the items `scope` selects (SQL over command_items
   * ci) that the member may not open. One query, uncapped: every named contact
   * is checked, however many there are and whatever the items' status (review
   * CR-1: the first version read at most 1000 owners and listed the rest).
   */
  private async hiddenNamedIn(businessId: string, access: CrmAccess, actorUserId: string, scope: Prisma.Sql): Promise<string[]> {
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT named.contact_id AS id
      FROM command_items ci CROSS JOIN LATERAL ${NAMED_CONTACTS_SQL}
      WHERE ${scope} AND named.contact_id IS NOT NULL`);
    return this.hiddenAmong(businessId, access, actorUserId, rows.map((r) => r.id));
  }

  /**
   * SQL over command_items ci: the row names none of `hidden`. One array
   * parameter, so no count of hidden contacts reaches the bind-parameter limit
   * a Prisma `notIn` list hits at 32767 values.
   */
  private static namesNoneOf(hidden: string[]): Prisma.Sql {
    return Prisma.sql`NOT EXISTS (SELECT 1 FROM ${NAMED_CONTACTS_SQL} WHERE named.contact_id = ANY(${hidden}::text[]))`;
  }

  /** The rows of `ids` in the order of `ids` (at most FIND_MANY_CAP of them). */
  private async rowsInOrder(businessId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.client.commandItem.findMany({ where: { businessId, id: { in: ids } } });
    const at = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  }

  /**
   * Whether `actorUserId` may open every contact one of `items` names
   * (FOLLOW3-D10). True with no actor (an internal caller) and for items that
   * name no contact; the OWNER and SUPER_ADMIN open every contact.
   */
  private async namedContactsVisible(businessId: string, items: ContactNamingItem[], actorUserId?: string): Promise<boolean> {
    const named = items.flatMap(contactsNamedBy);
    if (named.length === 0) return true;
    const access = await this.restrictedAccess(businessId, actorUserId);
    if (!access) return true;
    return (await this.hiddenAmong(businessId, access, actorUserId as string, named)).length === 0;
  }

  /**
   * With `actorUserId` (the HTTP routes), an item that names a contact the
   * member may not open is left out of the list and the total, whatever the
   * client's own ownerId/ownerType filters say (FOLLOW3-D10). When the member
   * is restricted and such an item is in scope, the page is selected in SQL
   * (the same filters and order as below, plus namesNoneOf) and its rows read
   * through Prisma; otherwise the query below runs as it always has.
   */
  async findMany(businessId: string, filters: {
    status?: string;
    category?: string;
    sourceModule?: string;
    ownerId?: string;
    ownerType?: string;
    limit?: number;
    offset?: number;
  }, actorUserId?: string) {
    const where: Record<string, unknown> = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.sourceModule) where.sourceModule = filters.sourceModule;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.ownerType) where.ownerType = filters.ownerType;

    const access = await this.restrictedAccess(businessId, actorUserId);
    if (access) {
      // The same filters as `where`, in SQL.
      const conds = [Prisma.sql`ci.business_id = ${businessId}`];
      if (filters.status) conds.push(Prisma.sql`ci.status = ${filters.status}`);
      if (filters.category) conds.push(Prisma.sql`ci.category = ${filters.category}`);
      if (filters.sourceModule) conds.push(Prisma.sql`ci.source_module = ${filters.sourceModule}`);
      if (filters.ownerId) conds.push(Prisma.sql`ci.owner_id = ${filters.ownerId}`);
      if (filters.ownerType) conds.push(Prisma.sql`ci.owner_type = ${filters.ownerType}`);
      const scope = Prisma.join(conds, ' AND ');
      const hidden = await this.hiddenNamedIn(businessId, access, actorUserId as string, scope);
      if (hidden.length > 0) {
        const visible = Prisma.sql`${scope} AND ${CommandService.namesNoneOf(hidden)}`;
        const take = Math.min(filters.limit ?? 25, FIND_MANY_CAP);
        const [page, counted] = await Promise.all([
          this.prisma.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT ci.id FROM command_items ci WHERE ${visible}
            ORDER BY ci.priority DESC, ci.urgency DESC, ci.created_at DESC
            LIMIT ${take} OFFSET ${filters.offset ?? 0}`),
          this.prisma.client.$queryRaw<Array<{ n: number }>>(Prisma.sql`
            SELECT count(*)::int AS n FROM command_items ci WHERE ${visible}`),
        ]);
        return { items: await this.rowsInOrder(businessId, page.map((r) => r.id)), total: counted[0]?.n ?? 0 };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.client.commandItem.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { urgency: 'desc' }, { createdAt: 'desc' }],
        take: filters.limit ?? 25,
        skip: filters.offset ?? 0,
      }),
      this.prisma.client.commandItem.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * With `actorUserId`, an item that names a contact the member may not open
   * answers exactly as an unknown id (FOLLOW3-D10). Every single-item mutation
   * below reads its row through here first, so it refuses before it writes.
   */
  async findOne(businessId: string, id: string, actorUserId?: string) {
    const item = await this.prisma.client.commandItem.findFirst({
      where: { id, businessId },
    });
    if (!item || !(await this.namedContactsVisible(businessId, [item], actorUserId))) {
      throw new NotFoundException('Command item not found');
    }
    return item;
  }

  /**
   * "What is due this week."
   *
   * Ordered by dueAt, oldest first, so the answer opens on what is already
   * late rather than on what scored highest. That is the one ordering
   * decision in here and it is deliberate: `findMany` above sorts by
   * priority/urgency because it answers "what should I look at", and a
   * business asking what is DUE is asking a question about time.
   *
   * OBLIGATIONS ONLY. `kind: 'OBLIGATION'` is what keeps advice out of the
   * answer. Every pre-existing row in this table is a SUGGESTION — something
   * KEY thought would be a good idea — and "what do I owe this week" must not
   * be padded with them, or the number stops meaning anything and people stop
   * reading it.
   *
   * SNOOZED ROWS ARE EXCLUDED UNTIL THEY WAKE. Snoozing is a promise the
   * product already made through /app/command-center; an obligation that
   * reappears the moment it is snoozed breaks it.
   *
   * OVERDUE IS NOT A STORED STATE. Anything with dueAt < now and no discharge
   * is overdue, computed here. Storing it would need a sweep that flips rows,
   * which is a timer, and this product has 52 of those and no leader election.
   */
  /**
   * Record that an obligation has been met.
   *
   * Lives HERE, not in the tool handler that calls it, and that placement is
   * the whole point. `command_items` already has sixteen writers across twelve
   * modules — which is how one table acquired twelve opinions about its own
   * status vocabulary — and the obligation work exists to stop that spreading.
   * A write from `flow-orchestrator` would have been the seventeenth, added by
   * the same change that argued producers should emit rather than write.
   *
   * Distinct from `complete()`, which is a person ticking something off.
   * Discharged means the thing owed actually happened, and `dischargeRef` names
   * what did it — a tool name, an invoice id, a short note.
   */
  async discharge(businessId: string, id: string, dischargeRef?: string, actorUserId?: string) {
    const item = await this.findOne(businessId, id, actorUserId);

    if (item.kind !== 'OBLIGATION') {
      // Refusing rather than quietly succeeding. Discharging a SUGGESTION would
      // record that the business met a commitment it never had.
      throw new BadRequestException(
        `"${item.title}" is a suggestion, not an obligation — there is nothing to discharge. Complete or dismiss it instead.`,
      );
    }

    // Idempotent: discharging twice is not an error, and returning the first
    // discharge is more useful than throwing at a caller who cannot tell the
    // difference between "already done" and "failed".
    if (item.dischargedAt) {
      return { ...item, alreadyDischarged: true };
    }

    const now = new Date();
    const updated = await this.prisma.client.commandItem.update({
      where: { id: item.id },
      data: {
        status: 'COMPLETED',
        dischargedAt: now,
        completedAt: now,
        dischargeRef: dischargeRef ?? 'manual',
      },
    });

    this.realtime.emit({
      businessId,
      type: 'command.updated',
      payload: { id: updated.id, title: channelTitle(updated), status: updated.status },
    });

    return { ...updated, alreadyDischarged: false };
  }

  async findDue(
    businessId: string,
    opts: { windowDays?: number; includeOverdue?: boolean; limit?: number; now?: Date } = {},
    actorUserId?: string,
  ) {
    const now = opts.now ?? new Date();
    const windowDays = Math.min(Math.max(opts.windowDays ?? 7, 1), 365);
    const until = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const includeOverdue = opts.includeOverdue ?? true;
    const take = Math.min(opts.limit ?? 100, 500);

    // FOLLOW3-D10: with an actor, an obligation that names a contact they may
    // not open is not theirs to see. When one is in scope the page is selected
    // in SQL (the same conditions and order as below, plus namesNoneOf).
    let items: Awaited<ReturnType<CommandService['rowsInOrder']>> | null = null;
    const access = await this.restrictedAccess(businessId, actorUserId);
    if (access) {
      const scope = Prisma.join([
        Prisma.sql`ci.business_id = ${businessId}`,
        Prisma.sql`ci.kind = 'OBLIGATION'`,
        Prisma.sql`ci.status NOT IN (${Prisma.join(CLOSED_STATUSES)})`,
        Prisma.sql`ci.discharged_at IS NULL`,
        Prisma.sql`ci.due_at <= ${utc(until)}`,
        ...(includeOverdue ? [] : [Prisma.sql`ci.due_at >= ${utc(now)}`]),
        Prisma.sql`(ci.snoozed_until IS NULL OR ci.snoozed_until <= ${utc(now)})`,
      ], ' AND ');
      const hidden = await this.hiddenNamedIn(businessId, access, actorUserId as string, scope);
      if (hidden.length > 0) {
        const page = await this.prisma.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT ci.id FROM command_items ci
          WHERE ${scope} AND ${CommandService.namesNoneOf(hidden)}
          ORDER BY ci.due_at ASC, ci.priority DESC
          LIMIT ${take}`);
        items = await this.rowsInOrder(businessId, page.map((r) => r.id));
      }
    }

    items ??= await this.prisma.client.commandItem.findMany({
      where: {
        businessId,
        kind: 'OBLIGATION',
        status: { notIn: CLOSED_STATUSES },
        dischargedAt: null,
        dueAt: includeOverdue ? { lte: until } : { gte: now, lte: until },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take,
    });

    const overdue = items.filter((i) => i.dueAt !== null && i.dueAt < now);
    return {
      window: { from: now.toISOString(), to: until.toISOString(), days: windowDays },
      total: items.length,
      overdueCount: overdue.length,
      items: items.map((i) => ({
        ...i,
        overdue: i.dueAt !== null && i.dueAt < now,
        daysUntilDue:
          i.dueAt === null
            ? null
            : Math.round((i.dueAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      })),
    };
  }

  async update(businessId: string, id: string, dto: UpdateCommandItemDto, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.urgency !== undefined && { urgency: dto.urgency }),
        ...(dto.impactScore !== undefined && { impactScore: dto.impactScore }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.executableByKey !== undefined && { executableByKey: dto.executableByKey }),
        ...(dto.executionTool !== undefined && { executionTool: dto.executionTool }),
        ...(dto.executionPayload !== undefined && { executionPayload: dto.executionPayload }),
        ...(dto.ownerType !== undefined && { ownerType: dto.ownerType }),
        ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
        ...(dto.dueAt !== undefined && { dueAt: dto.dueAt }),
        ...(dto.snoozedUntil !== undefined && { snoozedUntil: dto.snoozedUntil }),
        ...(dto.completedAt !== undefined && { completedAt: dto.completedAt }),
        ...(dto.dismissedAt !== undefined && { dismissedAt: dto.dismissedAt }),
      },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'update',
      entityType: 'command_item',
      entityId: id,
      title: `Updated: ${channelTitle(existing, item)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { changedFields: Object.keys(dto) },
    });
    return item;
  }

  async dismiss(businessId: string, id: string, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'dismiss',
      entityType: 'command_item',
      entityId: id,
      title: `Dismissed: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { previousStatus: existing.status },
    });
    return item;
  }

  async snooze(businessId: string, id: string, until: Date, actorUserId?: string) {
    if (until.getTime() <= Date.now()) {
      throw new BadRequestException('Snooze until date must be in the future');
    }
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'SNOOZED', snoozedUntil: until },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'snooze',
      entityType: 'command_item',
      entityId: id,
      title: `Snoozed: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { until: until.toISOString(), previousStatus: existing.status },
    });
    return item;
  }

  async complete(businessId: string, id: string, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'complete',
      entityType: 'command_item',
      entityId: id,
      title: `Completed: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { previousStatus: existing.status },
    });
    this.realtime.emit({
      businessId,
      type: 'command.completed',
      payload: { id: item.id, title: channelTitle(existing) },
    });
    return item;
  }

  async assign(businessId: string, id: string, ownerType: string, ownerId: string, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { ownerType, ownerId },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'assign',
      entityType: 'command_item',
      entityId: id,
      title: `Assigned: ${channelTitle(existing, item)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { ownerType, ownerId, previousOwnerType: existing.ownerType, previousOwnerId: existing.ownerId },
    });
    this.realtime.emit({
      businessId,
      type: 'command.assigned',
      payload: { id: item.id, title: channelTitle(existing, item), ownerType, ownerId },
    });
    return item;
  }

  async reopen(businessId: string, id: string, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'OPEN', completedAt: null, dismissedAt: null, snoozedUntil: null },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'reopen',
      entityType: 'command_item',
      entityId: id,
      title: `Reopened: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { previousStatus: existing.status },
    });
    return item;
  }

  async approve(businessId: string, id: string, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'EXECUTED', completedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'approve',
      entityType: 'command_item',
      entityId: id,
      title: `Approved: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
      data: { previousStatus: existing.status },
    });
    return item;
  }

  async execute(businessId: string, id: string, result?: Record<string, unknown>, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        completedAt: new Date(),
        executionPayload: result ? { ...(result as Record<string, unknown>) } : undefined,
      },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'execute',
      entityType: 'command_item',
      entityId: id,
      title: `Executed: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: existing.executableByKey ? 'AI' : 'USER',
      actorId: actorUserId,
      data: { result },
    });
    return item;
  }

  async delete(businessId: string, id: string, actorUserId?: string) {
    const existing = await this.findOne(businessId, id, actorUserId);
    await this.prisma.client.commandItem.delete({ where: { id } });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'delete',
      entityType: 'command_item',
      entityId: id,
      title: `Deleted: ${channelTitle(existing)}`,
      category: 'SYSTEM',
      actorType: 'USER',
      actorId: actorUserId,
    });
    return existing;
  }

  async bulkComplete(businessId: string, ids: string[], actorUserId?: string) {
    if (!ids.length) return { count: 0 };
    const existing = await this.prisma.client.commandItem.findMany({
      where: { id: { in: ids }, businessId },
    });
    // FOLLOW3-D10: an item that names a contact the member may not open refuses the whole call, as an unknown id does.
    if (existing.length !== ids.length || !(await this.namedContactsVisible(businessId, existing, actorUserId))) {
      throw new NotFoundException('One or more command items not found');
    }
    const { count } = await this.prisma.client.commandItem.updateMany({
      where: { id: { in: ids }, businessId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await Promise.all(
      existing.map((item) =>
        this.timeline.recordEvent({
          businessId,
          module: 'command',
          action: 'complete',
          entityType: 'command_item',
          entityId: item.id,
          title: `Completed: ${channelTitle(item)}`,
          category: 'SYSTEM',
          actorType: 'USER',
          actorId: actorUserId,
          data: { previousStatus: item.status },
        }),
      ),
    );
    this.realtime.emit({
      businessId,
      type: 'command.bulk_completed',
      payload: { count, ids },
    });
    return { count };
  }

  async bulkDismiss(businessId: string, ids: string[], actorUserId?: string) {
    if (!ids.length) return { count: 0 };
    const existing = await this.prisma.client.commandItem.findMany({
      where: { id: { in: ids }, businessId },
    });
    // FOLLOW3-D10: an item that names a contact the member may not open refuses the whole call, as an unknown id does.
    if (existing.length !== ids.length || !(await this.namedContactsVisible(businessId, existing, actorUserId))) {
      throw new NotFoundException('One or more command items not found');
    }
    const { count } = await this.prisma.client.commandItem.updateMany({
      where: { id: { in: ids }, businessId },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    await Promise.all(
      existing.map((item) =>
        this.timeline.recordEvent({
          businessId,
          module: 'command',
          action: 'dismiss',
          entityType: 'command_item',
          entityId: item.id,
          title: `Dismissed: ${channelTitle(item)}`,
          category: 'SYSTEM',
          actorType: 'USER',
          actorId: actorUserId,
          data: { previousStatus: item.status },
        }),
      ),
    );
    this.realtime.emit({
      businessId,
      type: 'command.bulk_dismissed',
      payload: { count, ids },
    });
    return { count };
  }

  async bulkDelete(businessId: string, ids: string[], actorUserId?: string) {
    if (!ids.length) return { count: 0 };
    const existing = await this.prisma.client.commandItem.findMany({
      where: { id: { in: ids }, businessId },
    });
    // FOLLOW3-D10: an item that names a contact the member may not open refuses the whole call, as an unknown id does.
    if (existing.length !== ids.length || !(await this.namedContactsVisible(businessId, existing, actorUserId))) {
      throw new NotFoundException('One or more command items not found');
    }
    const { count } = await this.prisma.client.commandItem.deleteMany({
      where: { id: { in: ids }, businessId },
    });
    await Promise.all(
      existing.map((item) =>
        this.timeline.recordEvent({
          businessId,
          module: 'command',
          action: 'delete',
          entityType: 'command_item',
          entityId: item.id,
          title: `Deleted: ${channelTitle(item)}`,
          category: 'SYSTEM',
          actorType: 'USER',
          actorId: actorUserId,
        }),
      ),
    );
    return { count };
  }

  async summary(businessId: string) {
    const [open, waitingApproval, executableByKey, byCategory] = await Promise.all([
      this.prisma.client.commandItem.count({ where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.client.commandItem.count({ where: { businessId, status: 'WAITING_APPROVAL' } }),
      this.prisma.client.commandItem.count({ where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS'] }, executableByKey: true } }),
      this.prisma.client.commandItem.groupBy({
        by: ['category'],
        where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL'] } },
        _count: { category: true },
      }),
    ]);

    return {
      open,
      waitingApproval,
      executableByKey,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count.category })),
    };
  }
}

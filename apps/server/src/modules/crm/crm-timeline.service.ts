import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CONTACT_EVENT_TYPES_BY_CATEGORY, normalizeContactEventType, getContactEventCategory } from '@keyflow/shared';
import type { ContactEvent, Invoice, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';
import {
  WHATSAPP_INBOUND_SOURCE,
  isInboundWhatsAppEvent,
  stripInboundWhatsAppBody,
} from './whatsapp-inbound-exclusion';
import { TimelineService } from '../timeline/timeline.service';
import {
  TIMELINE_SCAN_LIMIT,
  crmRowCarriesMoney,
  readVisibleActivityPage,
  resolveTimelineViewer,
} from '../timeline/timeline-visibility';
import { EvidenceService } from '../evidence/evidence.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';
import { ContactAuditService, type ContactAuditActor, type ContactAuditContext } from './privacy/contact-audit.service';

export const CONTACT_EVENTS_DEFAULT_LIMIT = 20;
export const CONTACT_EVENTS_MAX_LIMIT = 200;
const MAX_CONTACT_EVENT_CURSOR_LENGTH = 512;

export function encodeContactEventCursor(event: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: event.createdAt.toISOString(), id: event.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeContactEventCursor(raw: string): { createdAt: Date; id: string } {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_CONTACT_EVENT_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException('Invalid cursor');
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 2 || !Object.prototype.hasOwnProperty.call(obj, 'createdAt') || !Object.prototype.hasOwnProperty.call(obj, 'id')) {
    throw new BadRequestException('Invalid cursor');
  }
  if (typeof obj.createdAt !== 'string' || typeof obj.id !== 'string') {
    throw new BadRequestException('Invalid cursor');
  }
  // SEC-P66-2: reject empty/oversized IDs, ASCII C0/DEL control characters, and unpaired UTF-16 surrogates.
  if (
    obj.id.length === 0 ||
    obj.id.length > 128 ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(obj.id) ||
    Buffer.from(obj.id, 'utf8').toString('utf8') !== obj.id
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  // SEC-P66-1 / COR-P66-1: require strict 4-digit positive UTC ISO-8601 timestamp (reject ±YYYYYY and year 0000).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(obj.createdAt)) {
    throw new BadRequestException('Invalid cursor');
  }
  const createdAt = new Date(obj.createdAt);
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.getUTCFullYear() < 1 ||
    createdAt.getUTCFullYear() > 9999 ||
    createdAt.toISOString() !== obj.createdAt
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  // COR-P66-2: require exact canonical base64url + JSON framing (rejects len%4===1, non-zero trailing bits, invalid UTF-8, whitespace/reordered JSON).
  if (encodeContactEventCursor({ createdAt, id: obj.id }) !== raw) {
    throw new BadRequestException('Invalid cursor');
  }
  return { createdAt, id: obj.id };
}

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

/**
 * The contact a task list names (GET tasks/due, GET tasks): who it is and how
 * to reach them, never the stored row (notesInternal, custom fields, the stored
 * money fields). W9-CRM-RESIDUALS SEC-L81-3; V1-63 review repair SEC-OB-1 /
 * OB-COR-1 (D-37, D-63, D-90, D-100).
 */
const CONTACT_TASK_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
  phone: true,
  status: true,
} as const satisfies Prisma.ContactSelect;

/**
 * The top-level ContactEvent data fields that carry an amount, as the copy
 * writers put them (an invoice or order total, a payment, a refund, a
 * storefront booking's deposit, a referral's invoice total).
 */
const MONEY_DATA_KEYS = ['amount', 'total', 'subtotal', 'invoiceTotal', 'totalPaid', 'paymentAmount', 'refundAmount', 'depositAmount'] as const;

/**
 * W4-FEED-COPY-COMPLETE review SEC-FCC-1 (owner rulings D-90 and D-63, the
 * V1-84 timeline rule): the Activity category of a ContactEvent's CRM copy.
 *
 * A copy that carries money is COMMERCE, which canReadActivityRow
 * (timeline-visibility.ts) reads as a revenue row, so a member without revenue
 * read is not served its amount: every sales_revenue type (@keyflow/shared
 * getContactEventCategory), and any other type whose data carries an amount
 * (MONEY_DATA_KEYS: store_order.paid / refunded, checkout.*, payment.completed,
 * a storefront booking.created's deposit, a referral note.created's invoice
 * total). The map this replaces was keyed by category names @keyflow/shared no
 * longer uses ('revenue', 'booking', 'payment', ...), so every copy was CONTACT
 * and a member with crm read and revenue 'none' read those amounts.
 *
 * Every other copy stays CONTACT, as it has been written since those names
 * changed, so ?category=CONTACT keeps returning it (V55-12a parity).
 */
function contactEventCopyCategory(type: string, data: unknown): 'COMMERCE' | 'CONTACT' {
  if (getContactEventCategory(type) === 'sales_revenue') return 'COMMERCE';
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const fields = data as Record<string, unknown>;
    if (MONEY_DATA_KEYS.some((key) => fields[key] !== null && fields[key] !== undefined)) return 'COMMERCE';
  }
  return 'CONTACT';
}

/**
 * A ContactEvent as the feed rule (canReadActivityRow, timeline-visibility.ts)
 * judges it: the row of its CRM copy (module crm, naming the contact; logEvent),
 * its type as action and type, its data. GET contacts/:contactId/events
 * (listContactEvents) and the highlights timeline (buildTimeline withoutMoney;
 * W10-MONEY-SIGNALS-REST review repair SEC-W10MSR-1, owner rulings D-100, D-90
 * and D-63) judge the same row.
 */
function contactEventActivityRow(event: Pick<ContactEvent, 'type' | 'contactId' | 'data'>) {
  return { module: 'crm', action: event.type, type: event.type, contactId: event.contactId, data: event.data };
}

/** The ContactEvents buildTimeline reads: the 10 newest. */
const TIMELINE_EVENTS = 10;

/** The batch buildTimeline reads money-free events in (eventsWithoutMoney). */
const EVENT_SCAN_BATCH = 100;

const NOTE_EVENT_PREVIEW_MAX = 120;

export function formatNoteEventPreview(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const chars = Array.from(normalized);
  return chars.length > NOTE_EVENT_PREVIEW_MAX
    ? `${chars.slice(0, NOTE_EVENT_PREVIEW_MAX).join('')}…`
    : normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * P239 (FU-TIMELINE-NOTE-TEXT, D-319/Q40): hydrate ordinary `note.created`
 * ContactEvent rows with live `body` and `description` from `ContactNote`,
 * strictly scoped to `{ businessId, contactId, id: { in: noteIds } }`.
 *
 * Reading live `ContactNote` covers historical and newly created notes alike,
 * reflects edits immediately, strips any stale `body`/`description` when a note
 * was deleted, never hydrates cross-tenant or cross-contact note ids, and
 * leaves referral `note.created` events (`data.kind` without `noteId`) untouched.
 */
export async function hydrateNoteCreatedEvents<T extends Pick<ContactEvent, 'type' | 'data'>>(
  prisma: PrismaService,
  businessId: string,
  contactId: string,
  events: T[],
  prefetchedNotes?: ReadonlyArray<{ id: string; businessId: string; contactId: string; body: string }>,
): Promise<T[]> {
  const noteIds = new Set<string>();
  for (const event of events) {
    if (event.type !== 'note.created' || !isPlainRecord(event.data)) continue;
    if (typeof event.data.kind === 'string') continue;
    const noteId = event.data.noteId;
    if (typeof noteId === 'string' && noteId.length > 0) {
      noteIds.add(noteId);
    }
  }
  if (noteIds.size === 0) return events;

  const bodyById = new Map<string, string>();
  if (prefetchedNotes) {
    for (const note of prefetchedNotes) {
      if (note.businessId !== businessId || note.contactId !== contactId) continue;
      if (noteIds.has(note.id) && typeof note.body === 'string') {
        bodyById.set(note.id, note.body);
      }
    }
  }

  const missingIds = [...noteIds].filter((id) => !bodyById.has(id));
  if (missingIds.length > 0) {
    const fetched = await prisma.client.contactNote.findMany({
      where: { businessId, contactId, id: { in: missingIds } },
      select: { id: true, body: true },
    });
    for (const note of fetched) {
      if (typeof note.body === 'string') {
        bodyById.set(note.id, note.body);
      }
    }
  }

  return events.map((event) => {
    if (event.type !== 'note.created' || !isPlainRecord(event.data)) return event;
    if (typeof event.data.kind === 'string') return event;
    const noteId = event.data.noteId;
    if (typeof noteId !== 'string' || noteId.length === 0) return event;

    const liveBody = bodyById.get(noteId);
    const nextData: Record<string, unknown> = { ...event.data };
    if (liveBody !== undefined) {
      nextData.body = liveBody;
      const preview = formatNoteEventPreview(liveBody);
      if (preview.length > 0) {
        nextData.description = preview;
      } else {
        delete nextData.description;
      }
    } else {
      delete nextData.body;
      delete nextData.description;
    }
    return { ...event, data: nextData };
  });
}

@Injectable()
export class CrmTimelineService {
  private readonly logger = new Logger(CrmTimelineService.name);
  private readonly contactAudit: ContactAuditService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(TaskAssignmentService) private readonly assignments: TaskAssignmentService,
    @Optional() @Inject(ContactAuditService) contactAudit?: ContactAuditService,
  ) {
    this.contactAudit = contactAudit ?? new ContactAuditService(prisma);
  }

  private resolveAuditActor(audit?: ContactAuditContext | null, fallbackUserId?: string | null): ContactAuditActor {
    if (audit?.actor) return audit.actor;
    if (fallbackUserId) return { type: 'USER', id: fallbackUserId };
    return { type: 'SYSTEM' };
  }

  private eventMetaForAudit(audit?: ContactAuditContext | null, source = 'crm'): { actorType?: string; actorId?: string; source?: string } | undefined {
    const actor = audit?.actor;
    if (!actor) return undefined;
    return { actorType: actor.type, actorId: actor.id ?? undefined, source };
  }

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
    /**
     * feedCopy false (V1-55b-FEED-DEDUPE-REST; D-08: Activity is the feed):
     * the caller knows another writer puts this event's feed row in Activity,
     * so the ContactEvent (and its crm.contact_event.logged emit) is written
     * and the Activity copy is not. Default: copied, as before.
     */
    meta?: { actorType?: string; actorId?: string; source?: string; feedCopy?: boolean },
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

    // Also write to unified Activity ledger (Wave 1), unless the caller says
    // another writer puts this event's feed row there (V1-55b, meta.feedCopy).
    // D-280 (SEC-WAW-1): never mirror pasted WhatsApp message body text into the
    // secondary Activity ledger; keep non-body metadata only.
    if (meta?.feedCopy !== false) {
      const stripBody = isInboundWhatsAppEvent({
        source: meta?.source,
        type: normalized.canonical,
        data,
      });
      const activityData = stripBody ? stripInboundWhatsAppBody(data) : (data ?? {});
      const activityDetail =
        stripBody
          ? JSON.stringify(activityData)
          : typeof data === 'string'
            ? data
            : JSON.stringify(data ?? {});
      this.timeline.recordEvent({
        businessId,
        module: 'crm',
        action: normalized.canonical,
        entityType: 'contact',
        entityId: contactId,
        title: normalized.canonical,
        detail: activityDetail,
        contactId,
        category: contactEventCopyCategory(normalized.canonical, activityData),
        type: normalized.canonical,
        actorType: (meta?.actorType as any) ?? 'SYSTEM',
        actorId: meta?.actorId,
        data: activityData,
        occurredAt: new Date(),
      }).catch((err) => {
        this.logger.warn(`[UnifiedLedger] failed to record activity for contactEvent: ${(err as Error).message}`);
      });
    }

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

  /**
   * The contact's ContactEvents, newest first, that the reading member
   * (`viewerUserId`) may see.
   *
   * W6-CONTACT-EVENTS-MONEY (W5-FEED-CATEGORIES review SEC-W5FC-1; owner
   * rulings D-90 and D-63, the V1-84 timeline rule): each event is judged as
   * the feed judges its CRM copy (module crm, naming the contact; logEvent),
   * by canReadActivityRow through readVisibleActivityPage
   * (timeline-visibility.ts). So an event of a sales_revenue type, or whose
   * data carries a MONEY_DATA_FIELDS field (crmRowCarriesMoney: e.g.
   * invoice.payment_recorded, which D-90 still writes without a copy,
   * invoice.paid, store_order.paid, a storefront booking.created's deposit),
   * is withheld from a member without revenue read, and the page is filled
   * from older events. Before it the route served every event, amounts
   * included, on crm read alone. A read that names no member is refused: there
   * is no one to judge the events for.
   *
   * W6-CONTACT-EVENTS-MONEY covered this route only. The contact's sibling
   * reads (CrmStatsService.contactDetail, CrmJourneyService
   * .getContactCrossJourney / getContactJourney and CrmRevenueService
   * .getContactRevenueSummary; review SEC-W6CEM-1, SEC-W6CEM-2, CR-W6CEM-1)
   * withhold the same money events and figures from a member without revenue
   * read since W7-CONTACT-MONEY-VIEWS (D-90, D-63): the live cases V55-13f..h
   * in test/evidence-feed.integration.test.ts (W8-HOUSEKEEPING: this comment
   * called them an it.todo and said those reads still served them).
   */
  async listContactEvents(params: { businessId: string; contactId: string; limit?: number; viewerUserId?: string | null }) {
    await this.assertContact(params.businessId, params.contactId);
    if (!params.viewerUserId) throw new ForbiddenException('Contact events are read for a member');
    const viewer = await resolveTimelineViewer(this.prisma, params.businessId, params.viewerUserId);
    const where = { businessId: params.businessId, contactId: params.contactId };
    const page = await readVisibleActivityPage(this.prisma, viewer, params.limit ?? CONTACT_EVENTS_DEFAULT_LIMIT, async (skip, take) => {
      const events = await this.prisma.client.contactEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      });
      return events.map((event) => ({ ...contactEventActivityRow(event), event }));
    });
    return hydrateNoteCreatedEvents(
      this.prisma,
      params.businessId,
      params.contactId,
      page.map((row) => row.event),
    );
  }

  /**
   * FU-TIMELINE-EVENTS-PAGING (D-284, D-100): keyset-paginated read of a
   * contact's events. Requests `limit + 1` visible rows via
   * `readVisibleActivityPage` over the `(createdAt DESC, id DESC)` keyset
   * window strictly older than the opaque cursor. Because the lookahead counts
   * visible rows only and the cursor encodes only the last returned visible
   * row's `(createdAt, id)`, neither `nextCursor` nor page sizes reveal how
   * many money rows were withheld from a member without revenue read.
   */
  async listContactEventsPage(params: {
    businessId: string;
    contactId: string;
    limit?: number;
    cursor?: string;
    viewerUserId?: string | null;
  }): Promise<{ events: ContactEvent[]; nextCursor: string | null; hasMore: boolean }> {
    await this.assertContact(params.businessId, params.contactId);
    if (!params.viewerUserId) throw new ForbiddenException('Contact events are read for a member');
    const limit = params.limit ?? CONTACT_EVENTS_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > CONTACT_EVENTS_MAX_LIMIT) {
      throw new BadRequestException(`limit must be an integer between 1 and ${CONTACT_EVENTS_MAX_LIMIT}`);
    }
    const decodedCursor = params.cursor !== undefined ? decodeContactEventCursor(params.cursor) : null;
    const viewer = await resolveTimelineViewer(this.prisma, params.businessId, params.viewerUserId);
    const where: Prisma.ContactEventWhereInput = {
      businessId: params.businessId,
      contactId: params.contactId,
      ...(decodedCursor
        ? {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
            ],
          }
        : {}),
    };
    const visible = await readVisibleActivityPage(this.prisma, viewer, limit + 1, async (skip, take) => {
      const events = await this.prisma.client.contactEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      });
      return events.map((event) => ({ ...contactEventActivityRow(event), event }));
    });
    const hasMore = visible.length > limit;
    const rawEvents = (hasMore ? visible.slice(0, limit) : visible).map((row) => row.event);
    const nextCursor = hasMore && rawEvents.length > 0 ? encodeContactEventCursor(rawEvents[rawEvents.length - 1]) : null;
    const events = await hydrateNoteCreatedEvents(this.prisma, params.businessId, params.contactId, rawEvents);
    return { events, nextCursor, hasMore };
  }

  async listContactNotes(params: { businessId: string; contactId: string }) {
    await this.assertContact(params.businessId, params.contactId);
    return this.prisma.client.contactNote.findMany({
      where: { businessId: params.businessId, contactId: params.contactId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * GET tasks (a customer's Tasks tab with ?contactId=, the business's list
   * without it) and the KEY CRM adapter. V1-63 review repair (SEC-OB-1,
   * OB-COR-1, SEC-OB-2; D-37, D-63, D-90, D-100), as dueTasks reads
   * (W9-CRM-RESIDUALS SEC-L81-3): only tasks of live contacts of the business
   * are listed, so a soft-deleted contact's (a forget in its grace period) is
   * not, for the OWNER either; `visibility` is the caller's CRM visibility
   * clause (GET tasks passes the member's; null or absent for the OWNER,
   * SUPER_ADMIN and internal callers), and with one only the tasks of contacts
   * the member may open are listed. Every task carries the contact summary,
   * never the stored row (notesInternal, custom fields, the stored money fields
   * withoutStoredMoney withholds).
   */
  async listContactTasks(input: {
    businessId: string;
    contactId?: string;
    status?: string;
    dueBefore?: Date;
    visibility?: Prisma.ContactWhereInput | null;
  }) {
    const where: any = {
      businessId: input.businessId,
      contact: { ...contactWhereBase(input.businessId), ...(input.visibility ? { AND: [input.visibility] } : {}) },
    };
    if (input.contactId) {
      await this.assertContact(input.businessId, input.contactId);
      where.contactId = input.contactId;
    }
    if (input.status) where.status = input.status;
    if (input.dueBefore) where.dueDate = { lte: input.dueBefore };
    // By due date (undated last), then the newest first. Two sort fields are an
    // array, one object each: an object with both answered 500, so a customer's
    // Tasks tab said 'No tasks yet' right after 'Task added' (sweep BUG-036).
    return this.prisma.client.contactTask.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: { contact: { select: CONTACT_TASK_SUMMARY_SELECT } },
      take: 100,
    });
  }

  async addNote(
    input: { businessId: string; contactId: string; body: string; authorId?: string | null; source?: string },
    audit?: ContactAuditContext,
  ) {
    await this.assertContact(input.businessId, input.contactId);
    const actor = this.resolveAuditActor(audit, input.authorId);
    return this.prisma.client.$transaction(async (tx) => {
      const note = await tx.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body: input.body,
          authorId: input.authorId ?? null,
          source: input.source ?? 'manual',
        },
      });
      // D-25 / D-207 (FU-CONTACT-AUDIT-RESIDUAL): the audit entry commits with
      // the note inside the same transaction, before logEvent so a refused
      // audit row leaves no ContactEvent, feed copy or announcement behind.
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: input.contactId,
          action: 'note_added',
          entityType: 'note',
          entityId: note.id,
          after: { body: note.body, source: note.source },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );
      await this.logEvent(
        input.businessId,
        input.contactId,
        'note.created',
        { noteId: note.id },
        { source: input.source ?? 'crm', actorType: actor.type, actorId: actor.id ?? undefined },
        tx,
      );
      return note;
    });
  }

  async addTask(
    input: {
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
    },
    audit?: ContactAuditContext,
  ) {
    await this.assertContact(input.businessId, input.contactId);
    const actor = this.resolveAuditActor(audit, input.creatorId);

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

      // D-25 / D-207 (FU-CONTACT-AUDIT-RESIDUAL): task, assignment, audit row
      // and task.created event commit or roll back atomically.
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: input.contactId,
          action: 'task_added',
          entityType: 'task',
          entityId: created.id,
          after: {
            title: created.title,
            dueDate: input.dueDate ?? null,
            priority: created.priority,
            assigneeId: created.assigneeId,
          },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );

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
        { actorType: actor.type, actorId: actor.id ?? undefined, source: input.source ?? 'crm' },
        tx,
      );

      return created;
    });

    this.events.emit('contact_task.created', { task, businessId: input.businessId });
    return task;
  }

  async updateNote(
    input: { businessId: string; noteId: string; body?: string; source?: string },
    audit?: ContactAuditContext,
  ) {
    const actor = this.resolveAuditActor(audit);
    return this.prisma.client.$transaction(async (tx) => {
      const note = await tx.contactNote.findFirst({
        where: { id: input.noteId, businessId: input.businessId },
      });
      if (!note) throw new NotFoundException('Note not found');
      const data: any = {};
      if (input.body !== undefined) data.body = input.body;
      if (input.source !== undefined) data.source = input.source;
      const updated = await tx.contactNote.update({
        where: { id: input.noteId },
        data,
      });
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: note.contactId,
          action: 'note_updated',
          entityType: 'note',
          entityId: note.id,
          before: { body: note.body, source: note.source },
          after: { body: updated.body, source: updated.source },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );
      await this.logEvent(
        input.businessId,
        note.contactId,
        'note.updated',
        { noteId: note.id },
        this.eventMetaForAudit(audit),
        tx,
      );
      return updated;
    });
  }

  async deleteNote(
    input: { businessId: string; noteId: string },
    audit?: ContactAuditContext,
  ) {
    const actor = this.resolveAuditActor(audit);
    return this.prisma.client.$transaction(async (tx) => {
      const note = await tx.contactNote.findFirst({
        where: { id: input.noteId, businessId: input.businessId },
      });
      if (!note) throw new NotFoundException('Note not found');
      await tx.contactNote.delete({ where: { id: input.noteId } });
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: note.contactId,
          action: 'note_deleted',
          entityType: 'note',
          entityId: note.id,
          before: { body: note.body, source: note.source },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );
      // D-280 (SEC-WAW-1): deleting a pasted WhatsApp note must not copy its body into ContactEvent / Activity.
      const deleteData =
        note.source === WHATSAPP_INBOUND_SOURCE
          ? { noteId: note.id }
          : { noteId: note.id, body: note.body?.slice(0, 100) };
      await this.logEvent(
        input.businessId,
        note.contactId,
        'note.deleted',
        deleteData,
        this.eventMetaForAudit(audit),
        tx,
      );
      return { deleted: true };
    });
  }

  async updateTask(
    input: { businessId: string; taskId: string; title?: string; dueDate?: string; priority?: string; remindAt?: string },
    audit?: ContactAuditContext,
  ) {
    const actor = this.resolveAuditActor(audit);
    const { task, updated } = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.contactTask.findFirst({
        where: { id: input.taskId, businessId: input.businessId },
      });
      if (!existing) throw new NotFoundException('Task not found');
      const data: any = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.remindAt !== undefined) data.remindAt = input.remindAt ? new Date(input.remindAt) : null;
      const next = await tx.contactTask.update({
        where: { id: input.taskId },
        data,
      });
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: existing.contactId,
          action: 'task_updated',
          entityType: 'task',
          entityId: existing.id,
          before: { title: existing.title, dueDate: existing.dueDate, priority: existing.priority, remindAt: existing.remindAt },
          after: { title: next.title, dueDate: next.dueDate, priority: next.priority, remindAt: next.remindAt },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );
      await this.logEvent(
        input.businessId,
        existing.contactId,
        'task.updated',
        { taskId: existing.id, title: next.title },
        this.eventMetaForAudit(audit),
        tx,
      );
      return { task: existing, updated: next };
    });
    this.events.emit('contact_task.updated', { task: updated, businessId: input.businessId });
    if (input.dueDate !== undefined && input.dueDate !== (task.dueDate?.toISOString?.() ?? null)) {
      this.events.emit('contact_task.rescheduled', { task: updated, businessId: input.businessId });
    }
    return updated;
  }

  async deleteTask(
    input: { businessId: string; taskId: string },
    audit?: ContactAuditContext,
  ) {
    const actor = this.resolveAuditActor(audit);
    const taskId = await this.prisma.client.$transaction(async (tx) => {
      const task = await tx.contactTask.findFirst({
        where: { id: input.taskId, businessId: input.businessId },
      });
      if (!task) throw new NotFoundException('Task not found');
      await tx.contactTask.delete({ where: { id: input.taskId } });
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: task.contactId,
          action: 'task_deleted',
          entityType: 'task',
          entityId: task.id,
          before: { title: task.title, status: task.status, priority: task.priority },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );
      await this.logEvent(
        input.businessId,
        task.contactId,
        'task.deleted',
        { taskId: task.id, title: task.title },
        this.eventMetaForAudit(audit),
        tx,
      );
      return task.id;
    });
    this.events.emit('contact_task.deleted', { businessId: input.businessId, taskId });
    return { deleted: true };
  }

  async completeTask(
    input: { businessId: string; taskId: string; evidenceIds?: string[] },
    audit?: ContactAuditContext,
  ) {
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

    const actor = this.resolveAuditActor(audit);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const next = await tx.contactTask.update({
        where: { id: input.taskId },
        data: { status: 'DONE', completedAt: new Date() },
      });
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: task.contactId,
          action: 'task_completed',
          entityType: 'task',
          entityId: task.id,
          before: { status: task.status },
          after: { status: 'DONE' },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? null,
        },
        tx,
      );
      await this.logEvent(
        input.businessId,
        task.contactId,
        'task.completed',
        {
          taskId: task.id,
          title: task.title,
          evidenceIds: input.evidenceIds ?? [],
        },
        this.eventMetaForAudit(audit),
        tx,
      );
      return next;
    });
    this.events.emit('contact_task.completed', { task: updated, businessId: input.businessId });
    return updated;
  }

  async reopenTask(
    input: { businessId: string; taskId: string },
    audit?: ContactAuditContext,
  ) {
    const actor = this.resolveAuditActor(audit);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const task = await tx.contactTask.findFirst({
        where: { id: input.taskId, businessId: input.businessId },
      });
      if (!task) throw new NotFoundException('Task not found');

      const next = await tx.contactTask.update({
        where: { id: input.taskId },
        data: { status: 'OPEN', completedAt: null },
      });
      await this.contactAudit.write(
        {
          businessId: input.businessId,
          contactId: task.contactId,
          action: 'task_updated',
          entityType: 'task',
          entityId: task.id,
          before: { status: task.status },
          after: { status: 'OPEN' },
          actor,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          reason: audit?.reason ?? 'task.reopened',
        },
        tx,
      );
      await this.logEvent(
        input.businessId,
        task.contactId,
        'task.reopened',
        { taskId: task.id, title: task.title },
        this.eventMetaForAudit(audit),
        tx,
      );
      return next;
    });
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
    /**
     * W4-FEED-COPY-COMPLETE (owner ruling D-90, on D-08): logEvent's
     * meta.feedCopy (V1-55b), carried for callers that reach the timeline
     * through CrmService.logContactEvent. false: another writer puts this
     * event's feed row in Activity, so the ContactEvent (and its emit) is
     * written and its Activity copy is not. Absent: copied, as before.
     */
    feedCopy?: boolean;
  }) {
    await this.assertContact(input.businessId, input.contactId);
    return this.logEvent(input.businessId, input.contactId, input.type, input.data, {
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      ...(input.feedCopy === false ? { feedCopy: false } : {}),
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

  /**
   * W9-CRM-RESIDUALS (review SEC-L81-3, D-37): `visibility` is the caller's CRM
   * visibility clause (GET tasks/due passes the member's; null or absent for the
   * OWNER, SUPER_ADMIN and internal callers): with one, only tasks of live
   * contacts of the business the member may open are listed. Every task carries
   * a contact summary, never the full row (notesInternal, custom fields).
   */
  async dueTasks(input: { businessId: string; windowDays?: number; visibility?: Prisma.ContactWhereInput | null }) {
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
          ...(input.visibility ? { contact: { ...contactWhereBase(input.businessId), AND: [input.visibility] } } : {}),
        },
      orderBy: { dueDate: 'asc' },
      include: { contact: { select: CONTACT_TASK_SUMMARY_SELECT } },
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

  async getContactTimeline(
    businessId: string,
    contactId: string,
    limit = 50,
  ): Promise<TimelineEntry[]> {
    await this.assertContact(businessId, contactId);

    const [events, notes, tasks, invoices, bookings] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, contactId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, contactId, deletedAt: null },
        orderBy: { startTime: 'desc' },
        take: limit,
      }),
    ]);

    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true },
    });

    const hydratedEvents = await hydrateNoteCreatedEvents(
      this.prisma,
      businessId,
      contactId,
      events,
      notes,
    );

    const entries: TimelineEntry[] = [
      ...hydratedEvents.map((event) => {
        const data = isPlainRecord(event.data) ? event.data : null;
        const noteDescription =
          event.type === 'note.created' &&
          typeof data?.description === 'string' &&
          data.description.length > 0
            ? data.description
            : null;
        return {
          id: event.id,
          type: 'event' as const,
          contactId: event.contactId,
          contactName: contact ? this.formatContactName(contact) : undefined,
          contactEmail: contact?.email ?? null,
          title: event.type,
          description: noteDescription ?? `Event recorded via ${event.source ?? 'system'}`,
          timestamp: event.createdAt,
        };
      }),
      ...notes.map((note) => ({
        id: note.id,
        type: 'note' as const,
        contactId: note.contactId,
        contactName: contact ? this.formatContactName(contact) : undefined,
        contactEmail: contact?.email ?? null,
        title: 'Note added',
        description: formatNoteEventPreview(note.body),
        timestamp: note.createdAt,
      })),
      ...tasks.map((task) => ({
        id: task.id,
        type: 'task' as const,
        contactId: task.contactId,
        contactName: contact ? this.formatContactName(contact) : undefined,
        contactEmail: contact?.email ?? null,
        title: `Task: ${task.title}`,
        description: task.dueDate ? `Due ${new Date(task.dueDate).toLocaleString()}` : 'No due date',
        timestamp: task.createdAt,
      })),
      ...invoices.map((invoice) => ({
        id: invoice.id,
        type: 'invoice' as const,
        contactId: invoice.contactId,
        contactName: contact ? this.formatContactName(contact) : undefined,
        contactEmail: contact?.email ?? null,
        title: `Invoice ${invoice.status}`,
        description: `Total ${invoice.total} ${invoice.currency}`,
        timestamp: invoice.createdAt,
      })),
      ...bookings.map((booking) => ({
        id: booking.id,
        type: 'booking' as const,
        contactId: booking.contactId,
        contactName: contact ? this.formatContactName(contact) : undefined,
        contactEmail: contact?.email ?? null,
        title: `Booking ${booking.status}`,
        description: `Starts ${booking.startTime?.toISOString() ?? 'TBD'}`,
        timestamp: booking.startTime ?? booking.createdAt,
      })),
    ];

    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }

  /**
   * The business's recent CRM rows (the 10 newest ContactEvents, 8 notes, 8
   * tasks, 6 invoices, 6 bookings), newest first, cut to `limit`. With no
   * options every row of the business is read, as before (the owner's
   * highlights).
   *
   * W10-MONEY-SIGNALS-REST (owner rulings D-63 and D-100; review residuals
   * SEC-W9MR-1 and SEC-W9MR-2 remainder), for CrmStatsService.flowHighlights:
   * - `contacts`: each read keeps only the rows of the contacts matching it
   *   (the viewer's visibility clause, the rule GET contacts/:contactId
   *   applies), so another member's PRIVATE contact takes no place and is
   *   never named;
   * - `withoutMoney`: no invoice is read and every ContactEvent the feed rule
   *   withholds from a member without revenue read is left out before the 10
   *   are taken, so none takes any of the 10 places (eventsWithoutMoney). The
   *   rule is GET contacts/:contactId/events' (canReadActivityRow ->
   *   crmRowCarriesMoney): a sales_revenue type (@keyflow/shared), and since
   *   the W10-MONEY-SIGNALS-REST review repair SEC-W10MSR-1 (D-100, D-90,
   *   D-63) also any other type whose data carries an amount (e.g.
   *   payment.completed, store_order.paid / refunded,
   *   autopilot.payment_recovery), which the entry's type alone (the rule
   *   timelineEntryCarriesMoney applies) does not show.
   */
  async buildTimeline(
    businessId: string,
    limit = 20,
    options: { contacts?: Prisma.ContactWhereInput | null; withoutMoney?: boolean } = {},
  ): Promise<TimelineEntry[]> {
    const ofContacts = options.contacts ? { contact: options.contacts } : {};
    const eventWhere: Prisma.ContactEventWhereInput = {
      businessId,
      ...ofContacts,
      // The sales_revenue types are left out in the query (rows the rule withholds anyway, fewer reads).
      ...(options.withoutMoney ? { type: { notIn: [...CONTACT_EVENT_TYPES_BY_CATEGORY.sales_revenue] } } : {}),
    };
    const [events, notes, tasks, invoices, bookings] = await Promise.all([
      options.withoutMoney
        ? this.eventsWithoutMoney(eventWhere)
        : this.prisma.client.contactEvent.findMany({ where: eventWhere, orderBy: { createdAt: 'desc' }, take: TIMELINE_EVENTS }),
      this.prisma.client.contactNote.findMany({
        where: { businessId, ...ofContacts },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId, ...ofContacts },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      options.withoutMoney
        ? Promise.resolve([] as Invoice[])
        : this.prisma.client.invoice.findMany({
            where: { businessId, deletedAt: null, ...ofContacts },
            orderBy: { createdAt: 'desc' },
            take: 6,
          }),
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null, ...ofContacts },
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

    // P239: hydrate ordinary note.created rows in business highlights strictly
    // matched by (businessId, contactId, noteId) within the viewer's visible contacts.
    const noteBodyByContactAndId = new Map<string, string>();
    for (const note of notes) {
      if (note.businessId === businessId && typeof note.body === 'string') {
        noteBodyByContactAndId.set(`${note.contactId}:${note.id}`, note.body);
      }
    }
    const missingNoteIds = new Set<string>();
    for (const event of events) {
      if (event.type !== 'note.created' || !isPlainRecord(event.data) || typeof event.data.kind === 'string') {
        continue;
      }
      const noteId = typeof event.data.noteId === 'string' ? event.data.noteId : '';
      if (noteId && !noteBodyByContactAndId.has(`${event.contactId}:${noteId}`)) {
        missingNoteIds.add(noteId);
      }
    }
    if (missingNoteIds.size > 0) {
      const fetchedNotes = await this.prisma.client.contactNote.findMany({
        where: { businessId, ...ofContacts, id: { in: [...missingNoteIds] } },
        select: { id: true, contactId: true, body: true },
      });
      for (const note of fetchedNotes) {
        if (typeof note.body === 'string') {
          noteBodyByContactAndId.set(`${note.contactId}:${note.id}`, note.body);
        }
      }
    }

    const entries: TimelineEntry[] = [
      ...events.map((event) => {
        let noteDescription: string | null = null;
        if (event.type === 'note.created' && isPlainRecord(event.data) && typeof event.data.kind !== 'string') {
          const noteId = typeof event.data.noteId === 'string' ? event.data.noteId : '';
          const liveBody = noteId ? noteBodyByContactAndId.get(`${event.contactId}:${noteId}`) : undefined;
          if (liveBody !== undefined) {
            const preview = formatNoteEventPreview(liveBody);
            if (preview.length > 0) noteDescription = preview;
          }
        }
        return {
          id: event.id,
          type: 'event' as const,
          contactId: event.contactId,
          contactName: contactMap.get(event.contactId)
            ? this.formatContactName(contactMap.get(event.contactId)!)
            : undefined,
          contactEmail: contactMap.get(event.contactId)?.email ?? null,
          title: event.type,
          description: noteDescription ?? `Event recorded via ${event.source ?? 'system'}`,
          timestamp: event.createdAt,
        };
      }),
      ...notes.map((note) => ({
        id: note.id,
        type: 'note' as const,
        contactId: note.contactId,
        contactName: contactMap.get(note.contactId) ? this.formatContactName(contactMap.get(note.contactId)!) : undefined,
        contactEmail: contactMap.get(note.contactId)?.email ?? null,
        title: 'Note added',
        description: formatNoteEventPreview(note.body),
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

  /**
   * W10-MONEY-SIGNALS-REST review repair SEC-W10MSR-1 (owner rulings D-100,
   * D-90 and D-63): the TIMELINE_EVENTS newest of the ContactEvents `where`
   * matches that carry no money by the feed rule. Each event is judged as
   * listContactEvents (GET contacts/:contactId/events) judges it, the row of
   * its CRM copy (contactEventActivityRow), by crmRowCarriesMoney: a
   * sales_revenue type, or data carrying a MONEY_DATA_FIELDS field (e.g.
   * payment.completed, store_order.paid / refunded, autopilot.payment_recovery
   * with an amount). For the highlights' viewer that is canReadActivityRow's
   * whole verdict on such a row: the route requires crm read and `where` keeps
   * the contacts they may open, so a member without revenue read is withheld
   * exactly the money rows. The events are read newest first in batches, in a
   * total order (createdAt, then id), so a withheld row takes none of the
   * places, until TIMELINE_EVENTS are kept, the events run out or
   * TIMELINE_SCAN_LIMIT have been examined (readVisibleActivityPage's bound).
   */
  private async eventsWithoutMoney(where: Prisma.ContactEventWhereInput): Promise<ContactEvent[]> {
    const kept: ContactEvent[] = [];
    let skip = 0;
    while (kept.length < TIMELINE_EVENTS && skip < TIMELINE_SCAN_LIMIT) {
      const take = Math.min(EVENT_SCAN_BATCH, TIMELINE_SCAN_LIMIT - skip);
      const batch = await this.prisma.client.contactEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      });
      kept.push(...batch.filter((event) => !crmRowCarriesMoney(contactEventActivityRow(event))));
      if (batch.length < take) break;
      skip += batch.length;
    }
    return kept.slice(0, TIMELINE_EVENTS);
  }
}

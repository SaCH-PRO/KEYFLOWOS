import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CreateBusinessEventInput,
  AuditFilter,
  KpiStats,
  ActorType,
} from './dto/create-business-event.dto';

/**
 * V1-72 (RR-ERASURE-BUSINESS-EVENTS, D-25): the metadata keys a business event
 * keeps once it names a forgotten person. The interceptor's route pattern and
 * HTTP method say what happened; everything else in metadata (the caller's ip,
 * and free-form values other writers put there, such as a captured name) goes.
 */
export const FORGOTTEN_EVENT_METADATA_KEYS = ['route', 'httpMethod', 'routeContactId'] as const;

/**
 * The top-level keys of the server-produced `after` snapshot that name a
 * contact: contactId (a note, a task, the forget request), fromContactId and
 * toContactId (a relationship), and targetContactId (a referral, whose request
 * body carries the new target's name, email and phone). V1-72 review round 2.
 */
export const CONTACT_REFERENCE_KEYS = ['contactId', 'fromContactId', 'toContactId', 'targetContactId'] as const;

/** The shape the write-time check reads and rewrites; every business_events writer's input has it. */
export interface ForgettableEvent {
  businessId: string;
  eventType?: string;
  subjectType: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * The contacts a business event names, by the same rule the forget purge uses
 * to scrub stored rows (ContactPrivacyService.eraseForgottenContact), and only
 * from server-derived data (V1-72 review, SEC-1): the subject when it is a
 * contact, a CONTACT_REFERENCE_KEYS value at the top level of the `after`
 * snapshot (the handler's response), and metadata.routeContactId (the route's
 * :contactId, recorded by the interceptor). Never `before`: the interceptor
 * stores the raw request body there, before any DTO whitelisting, so a key a
 * caller planted in it would let them strip an unrelated event's snapshots.
 */
export function contactIdsOfEvent(input: Pick<ForgettableEvent, 'subjectType' | 'subjectId' | 'before' | 'after' | 'metadata'>): string[] {
  const ids = new Set<string>();
  if (input.subjectType === 'contact' && input.subjectId && input.subjectId !== 'unknown') ids.add(input.subjectId);
  const after = asRecord(input.after);
  if (after) {
    for (const key of CONTACT_REFERENCE_KEYS) {
      const id = after[key];
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  const routeContactId = asRecord(input.metadata)?.routeContactId;
  if (typeof routeContactId === 'string' && routeContactId.length > 0) ids.add(routeContactId);
  return [...ids];
}

function keptMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const source = metadata as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of FORGOTTEN_EVENT_METADATA_KEYS) {
    if (key in source) kept[key] = source[key];
  }
  return kept;
}

const checkLogger = new Logger('ForgottenContactCheck');

/**
 * V1-72 (RR-ERASURE-BUSINESS-EVENTS, D-25): a row written after its person
 * asked to be forgotten carries no personal data. Every business_events writer
 * that can name a contact applies this right before its insert:
 * BusinessEventService.emit/emitBatch (the interceptor's queue worker, sync
 * fallback and replay all end there), KEY analytics track_event and the KEY
 * cortex event bus audit (SEC-3). Decided at the write, so the forget
 * request's own row and a write that lands after the purge committed are
 * covered; the purge scrubs the rows written before.
 *
 * An event that names a contact (contactIdsOfEvent) of this business which,
 * or which a contact it was merged into, has an open forget request, or has
 * been purged (a purged request is detached and keeps only the contact's
 * hash, matched over the named ids too, so a row that is gone still counts),
 * is returned with before and after undefined and metadata reduced to
 * FORGOTTEN_EVENT_METADATA_KEYS; event type, action, actor, subject and
 * timestamps stay. One read, tenant-bound, only for an event that names a
 * contact and carries something to drop. If the read fails the event is
 * returned scrubbed (fail closed): a lost snapshot is the lesser harm.
 */
export async function withoutForgottenPersonalData<T extends ForgettableEvent>(
  client: { $queryRaw: PrismaService['client']['$queryRaw'] },
  input: T,
): Promise<T> {
  const ids = contactIdsOfEvent(input);
  if (ids.length === 0) return input;
  const kept = keptMetadata(input.metadata);
  const hasPersonal =
    input.before !== undefined ||
    input.after !== undefined ||
    (input.metadata !== undefined && input.metadata !== null &&
      Object.keys(input.metadata as object).length !== Object.keys(kept ?? {}).length);
  if (!hasPersonal) return input;
  let forgotten = true;
  try {
    const rows = await client.$queryRaw<Array<{ forgotten: boolean }>>`
      WITH RECURSIVE chain(id) AS (
        SELECT id FROM contacts WHERE business_id = ${input.businessId} AND id = ANY(${ids})
        UNION
        SELECT c.merged_into_id FROM contacts c JOIN chain ON c.id = chain.id
         WHERE c.business_id = ${input.businessId} AND c.merged_into_id IS NOT NULL
      ),
      -- The named ids themselves too: a purged contact's row may be gone
      -- (the request is detached, ON DELETE SET NULL), its hash is not.
      named(id) AS (SELECT id FROM chain UNION SELECT unnest(${ids}::text[]))
      SELECT EXISTS (
        SELECT 1 FROM contact_forget_requests r
         WHERE r.business_id = ${input.businessId}
           AND (
             (r.status = 'requested' AND r.contact_id IN (SELECT id FROM named))
             OR (r.status = 'purged' AND r.contact_hash IN (
               SELECT 'sha256:' || encode(sha256(convert_to(${input.businessId} || ':' || named.id, 'UTF8')), 'hex') FROM named))
           )
      ) AS forgotten`;
    forgotten = rows[0]?.forgotten === true;
  } catch (err: unknown) {
    checkLogger.warn(
      `Forgotten-contact check failed; writing ${input.eventType ?? 'an event'} without snapshots: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!forgotten) return input;
  return { ...input, before: undefined, after: undefined, metadata: kept } as T;
}

@Injectable()
export class BusinessEventService {
  private readonly logger = new Logger(BusinessEventService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) @Optional() private readonly events: EventEmitter2 | null = null,
  ) {}

  /**
   * Emit a single business event. Fire-and-forget: never throws.
   * This is the primary method — every mutation should call this.
   */
  async emit(event: CreateBusinessEventInput): Promise<void> {
    // Scrubbed before anything else, so the failure log below never holds
    // what the row may not (V1-72 review).
    let input: CreateBusinessEventInput;
    try {
      input = await withoutForgottenPersonalData(this.prisma.client, event);
    } catch {
      // Never throw (the contract every caller relies on): an input the check
      // cannot read is written, if at all, without its snapshots.
      input = event && typeof event === 'object'
        ? { ...event, before: undefined, after: undefined, metadata: keptMetadata(event.metadata) }
        : event;
    }
    try {
      await this.prisma.client.businessEvent.create({
        data: {
          businessId: input.businessId,
          branchId: input.branchId ?? null,
          eventType: input.eventType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          actorType: input.actorType,
          actorId: input.actorId,
          action: input.action,
          before: input.before ?? undefined,
          after: input.after ?? undefined,
          evidenceIds: input.evidenceIds ?? [],
          messageIds: input.messageIds ?? [],
          approvalId: input.approvalId ?? null,
          riskScore: input.riskScore ?? null,
          source: input.source,
          metadata: input.metadata ?? undefined,
          sessionId: input.sessionId ?? null,
          commandId: input.commandId ?? null,
          correlationId: input.correlationId ?? null,
        },
      });

      // Also fan out to the EventEmitter2 bridge so KEY FLOWS roles can
      // subscribe to this signal. Fire-and-forget; never block audit emit.
      this.events?.emit('business_event.created', input);
    } catch (err: any) {
      this.logger.error(
        `Failed to emit business event: ${(err as Error).message}`,
        { input: (JSON.stringify(input) ?? String(input)).slice(0, 500) },
      );
      // Never throw — audit failure should not break the business operation
    }
  }

  /**
   * Emit multiple events in a single transaction. Use for bulk operations.
   */
  async emitBatch(inputs: CreateBusinessEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      // The same forgotten-person check as emit (V1-72 review).
      const scrubbed = await Promise.all(inputs.map((input) => withoutForgottenPersonalData(this.prisma.client, input)));
      await this.prisma.client.$transaction(
        scrubbed.map((input) =>
          this.prisma.client.businessEvent.create({
            data: {
              businessId: input.businessId,
              branchId: input.branchId ?? null,
              eventType: input.eventType,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              actorType: input.actorType,
              actorId: input.actorId,
              action: input.action,
              before: input.before ?? undefined,
              after: input.after ?? undefined,
              evidenceIds: input.evidenceIds ?? [],
              messageIds: input.messageIds ?? [],
              approvalId: input.approvalId ?? null,
              riskScore: input.riskScore ?? null,
              source: input.source,
              metadata: input.metadata ?? undefined,
            },
          }),
        ),
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to emit ${inputs.length} business events: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get full timeline for a specific business object.
   * Returns events in chronological order (oldest first).
   */
  async getTimeline(
    subjectType: string,
    subjectId: string,
    limit: number = 50,
  ) {
    return this.prisma.client.businessEvent.findMany({
      where: { subjectType, subjectId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Get audit trail for a business with filters.
   */
  async getAuditTrail(businessId: string, filters: AuditFilter = {}) {
    const where: any = { businessId };

    if (filters.eventTypes?.length) {
      where.eventType = { in: filters.eventTypes };
    }
    if (filters.subjectTypes?.length) {
      where.subjectType = { in: filters.subjectTypes };
    }
    if (filters.actorTypes?.length) {
      where.actorType = { in: filters.actorTypes };
    }
    if (filters.actions?.length) {
      where.action = { in: filters.actions };
    }
    if (filters.sources?.length) {
      where.source = { in: filters.sources };
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [events, total] = await Promise.all([
      this.prisma.client.businessEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.offset ?? 0,
        take: filters.limit ?? 50,
      }),
      this.prisma.client.businessEvent.count({ where }),
    ]);

    return { events, total, offset: filters.offset ?? 0, limit: filters.limit ?? 50 };
  }

  /**
   * Get KPI stats for a business over a time window.
   */
  async getKpiStats(businessId: string, windowDays: number = 7): Promise<KpiStats> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const events = await this.prisma.client.businessEvent.findMany({
      where: {
        businessId,
        createdAt: { gte: since },
      },
      select: {
        eventType: true,
        actorType: true,
        riskScore: true,
        action: true,
        approvalId: true,
      },
    });

    const stats: KpiStats = {
      totalEvents: events.length,
      eventsByType: {},
      eventsByActor: {},
      highRiskEvents: 0,
      approvalEvents: 0,
      aiActions: 0,
    };

    for (const e of events) {
      stats.eventsByType[e.eventType] = (stats.eventsByType[e.eventType] ?? 0) + 1;
      stats.eventsByActor[e.actorType] = (stats.eventsByActor[e.actorType] ?? 0) + 1;
      if ((e.riskScore ?? 0) >= 3) stats.highRiskEvents++;
      if (e.approvalId) stats.approvalEvents++;
      if (e.actorType === 'ai') stats.aiActions++;
    }

    return stats;
  }

  /**
   * Convenience: emit from a NestJS request context.
   * Extracts actor from req.user, source from request headers.
   */
  async emitFromRequest(
    req: { user?: { id: string }; headers?: Record<string, string> },
    input: Omit<CreateBusinessEventInput, 'actorType' | 'actorId' | 'source'>,
  ): Promise<void> {
    const actorType: ActorType = req.user ? 'human' : 'system';
    const actorId = req.user?.id ?? 'system';
    const source = this.detectSource(req.headers);

    await this.emit({
      ...input,
      actorType,
      actorId,
      source,
    });
  }

  private detectSource(headers?: Record<string, string>): 'web' | 'mobile' | 'api' | 'worker' {
    const ua = headers?.['user-agent']?.toLowerCase() ?? '';
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('ios')) return 'mobile';
    if (headers?.['x-api-key']) return 'api';
    return 'web';
  }
}

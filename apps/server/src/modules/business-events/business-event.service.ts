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
export const FORGOTTEN_EVENT_METADATA_KEYS = ['route', 'httpMethod'] as const;

/**
 * The contacts a business event names, by the same rule the forget purge uses
 * to scrub stored rows (ContactPrivacyService.eraseForgottenContact): the
 * subject when it is a contact, and a top-level contactId of the before or
 * after snapshot (a note, a forget request, a task on a contact).
 */
export function contactIdsOfEvent(input: Pick<CreateBusinessEventInput, 'subjectType' | 'subjectId' | 'before' | 'after'>): string[] {
  const ids = new Set<string>();
  if (input.subjectType === 'contact' && input.subjectId && input.subjectId !== 'unknown') ids.add(input.subjectId);
  for (const snap of [input.before, input.after]) {
    const id = snap && typeof snap === 'object' && !Array.isArray(snap) ? (snap as Record<string, unknown>).contactId : undefined;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return [...ids];
}

function keptMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const key of FORGOTTEN_EVENT_METADATA_KEYS) {
    if (key in metadata) kept[key] = metadata[key];
  }
  return kept;
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
    try {
      const input = await this.withoutForgottenPersonalData(event);
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
        { input: JSON.stringify(event).slice(0, 500) },
      );
      // Never throw — audit failure should not break the business operation
    }
  }

  /**
   * V1-72 (RR-ERASURE-BUSINESS-EVENTS, D-25): a row written after its person
   * asked to be forgotten carries no personal data. The interceptor writes its
   * row after the handler returned, outside any transaction, through a queue
   * or a sync fallback, and every path ends here: so the forget request's own
   * row (its body and the request it answers name the person) and a mutation
   * whose write lands after the purge committed are decided at the write, not
   * when the request was handled. The purge scrubs the rows written before.
   *
   * An event that names a contact (contactIdsOfEvent) of this business which,
   * or which a contact it was merged into, has an open forget request, or has
   * been purged (a purged request is detached and keeps only the contact's
   * hash), is written with before and after NULL and metadata reduced to
   * FORGOTTEN_EVENT_METADATA_KEYS; event type, action, actor, subject and
   * timestamps stay. One read, tenant-bound, only for an event that names a
   * contact and carries something to drop. If the read fails the event is
   * written scrubbed (fail closed): a lost snapshot is the lesser harm.
   */
  private async withoutForgottenPersonalData(input: CreateBusinessEventInput): Promise<CreateBusinessEventInput> {
    const ids = contactIdsOfEvent(input);
    if (ids.length === 0) return input;
    const kept = keptMetadata(input.metadata);
    const hasPersonal =
      input.before !== undefined ||
      input.after !== undefined ||
      (input.metadata !== undefined && Object.keys(input.metadata ?? {}).length !== Object.keys(kept ?? {}).length);
    if (!hasPersonal) return input;
    let forgotten = true;
    try {
      const rows = await this.prisma.client.$queryRaw<Array<{ forgotten: boolean }>>`
        WITH RECURSIVE chain(id) AS (
          SELECT id FROM contacts WHERE business_id = ${input.businessId} AND id = ANY(${ids})
          UNION
          SELECT c.merged_into_id FROM contacts c JOIN chain ON c.id = chain.id
           WHERE c.business_id = ${input.businessId} AND c.merged_into_id IS NOT NULL
        )
        SELECT EXISTS (
          SELECT 1 FROM contact_forget_requests r
           WHERE r.business_id = ${input.businessId}
             AND (
               (r.status = 'requested' AND r.contact_id IN (SELECT id FROM chain))
               OR (r.status = 'purged' AND r.contact_hash IN (
                 SELECT 'sha256:' || encode(sha256(convert_to(${input.businessId} || ':' || chain.id, 'UTF8')), 'hex') FROM chain))
             )
        ) AS forgotten`;
      forgotten = rows[0]?.forgotten === true;
    } catch (err: unknown) {
      this.logger.warn(
        `Forgotten-contact check failed; writing ${input.eventType} without snapshots: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!forgotten) return input;
    return { ...input, before: undefined, after: undefined, metadata: kept };
  }

  /**
   * Emit multiple events in a single transaction. Use for bulk operations.
   */
  async emitBatch(inputs: CreateBusinessEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await this.prisma.client.$transaction(
        inputs.map((input) =>
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

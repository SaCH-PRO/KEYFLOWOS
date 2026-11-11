import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

type ProjectStageProgressionConfig = {
  enabled?: boolean;
  fromStatus?: string;
  toStatusOnInvoicePaid?: string;
  toStatusOnBookingCompleted?: string;
};

const DEFAULT_PROGRESSION: Required<ProjectStageProgressionConfig> = {
  enabled: true,
  fromStatus: 'ACTIVE',
  toStatusOnInvoicePaid: 'IN_PROGRESS',
  toStatusOnBookingCompleted: 'IN_PROGRESS',
};

/**
 * Advances projects when their tied invoice/booking moves on the money axis.
 * Per-business configurable via Business.metaData.projectStageProgression:
 *   { enabled, fromStatus, toStatusOnInvoicePaid, toStatusOnBookingCompleted }
 * Defaults: ACTIVE -> IN_PROGRESS for both invoice.paid and booking.completed.
 * Idempotent: only updates when current status equals configured `fromStatus`.
 *
 * W10-REOPEN-REVERSALS (owner ruling D-102): each invoice.paid move is recorded
 * as a business_events row (eventType project.status_advanced, subject the
 * project, before / after the statuses, metadata { invoiceId, reason }), and a
 * refund's reopen of that invoice steps the project back to the status it left,
 * only while it is still in the status the paid move set, once (a
 * project.status_reverted row closes the move).
 */
const ADVANCED = 'project.status_advanced';
const REVERTED = 'project.status_reverted';
const ACTOR_ID = 'project_revenue_listener';
@Injectable()
export class ProjectRevenueListener {
  private readonly logger = new Logger(ProjectRevenueListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: { invoice?: { id?: string }; businessId: string }) {
    const invoiceId = payload.invoice?.id;
    if (!invoiceId) return;
    const cfg = await this.resolveConfig(payload.businessId);
    if (!cfg.enabled) return;
    try {
      const projects = await this.prisma.client.project.findMany({
        where: { businessId: payload.businessId, invoiceId, status: cfg.fromStatus, deletedAt: null },
        select: { id: true },
      });
      for (const p of projects) {
        await this.transition(payload.businessId, p.id, cfg.fromStatus, cfg.toStatusOnInvoicePaid, 'invoice.paid');
        if (cfg.fromStatus !== cfg.toStatusOnInvoicePaid) {
          await this.recordMove(payload.businessId, p.id, ADVANCED, cfg.fromStatus, cfg.toStatusOnInvoicePaid, invoiceId, 'invoice.paid');
        }
      }
    } catch (err: any) {
      this.logger.warn(`project advance from invoice failed: ${(err as Error).message}`);
    }
  }

  /**
   * W10-REOPEN-REVERSALS (owner ruling D-102): a refund's reopen of a paid
   * invoice steps each project its invoice.paid advanced back to the status it
   * left. A project is moved back only when its last recorded move for this
   * invoice is that advance (not yet reverted: a re-delivered or second reopen
   * moves nothing) and only while it is still in the status the advance set (a
   * compare-and-set: a project the operator moved on since is left). A project
   * the paid move never advanced (already past fromStatus, or advanced before
   * this record existed) is left. If the invoice is PAID again by the time this
   * ran, its projects are advanced again (as on invoice.paid).
   */
  @OnEvent('invoice.reopened', { async: true })
  async onInvoiceReopened(payload: { invoice?: { id?: string }; businessId: string }) {
    const invoiceId = payload?.invoice?.id;
    const businessId = payload?.businessId;
    if (!invoiceId || !businessId) return;
    try {
      const status = await this.invoiceStatus(businessId, invoiceId);
      if (status == null || status === 'PAID') return;
      const moves = await this.prisma.client.businessEvent.findMany({
        where: {
          businessId,
          subjectType: 'project',
          eventType: { in: [ADVANCED, REVERTED] },
          actorId: ACTOR_ID,
          metadata: { path: ['invoiceId'], equals: invoiceId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { subjectId: true, eventType: true, before: true, after: true },
      });
      const lastMove = new Map<string, (typeof moves)[number]>();
      for (const m of moves) if (!lastMove.has(m.subjectId)) lastMove.set(m.subjectId, m);
      let reverted = 0;
      for (const [projectId, move] of lastMove) {
        if (move.eventType !== ADVANCED) continue;
        const left = (move.before as { status?: string } | null)?.status;
        const set = (move.after as { status?: string } | null)?.status;
        if (!left || !set) continue;
        const back = await this.prisma.client.project.updateMany({
          where: { id: projectId, businessId, invoiceId, status: set, deletedAt: null },
          data: { status: left },
        });
        if (back.count !== 1) continue;
        await this.recordMove(businessId, projectId, REVERTED, set, left, invoiceId, 'invoice.reopened');
        reverted += 1;
        this.logger.log(`Project ${projectId} ${set} → ${left} (reason: invoice.reopened)`);
      }
      if (reverted > 0 && (await this.invoiceStatus(businessId, invoiceId)) === 'PAID') {
        await this.onInvoicePaid({ invoice: { id: invoiceId }, businessId });
      }
    } catch (err) {
      this.logger.warn(`project step-back on invoice reopen failed: ${(err as Error).message}`);
    }
  }

  private async invoiceStatus(businessId: string, invoiceId: string): Promise<string | null> {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { status: true },
    });
    return inv?.status ?? null;
  }

  /**
   * W10-REOPEN-REVERSALS (D-102): the business_events record of a paid move or
   * its reversal. Best-effort: a move left unrecorded is never reversed.
   */
  private async recordMove(
    businessId: string,
    projectId: string,
    eventType: typeof ADVANCED | typeof REVERTED,
    fromStatus: string,
    toStatus: string,
    invoiceId: string,
    reason: string,
  ) {
    try {
      await this.prisma.client.businessEvent.create({
        data: {
          businessId,
          eventType,
          subjectType: 'project',
          subjectId: projectId,
          actorType: 'system',
          actorId: ACTOR_ID,
          action: 'update',
          before: { status: fromStatus },
          after: { status: toStatus },
          source: 'worker',
          metadata: { invoiceId, reason },
        },
      });
    } catch (err) {
      this.logger.warn(`project move record failed for ${projectId}: ${(err as Error).message}`);
    }
  }

  @OnEvent('booking.completed', { async: true })
  async onBookingCompleted(payload: { booking?: { id?: string }; businessId: string }) {
    const bookingId = payload.booking?.id;
    if (!bookingId) return;
    const cfg = await this.resolveConfig(payload.businessId);
    if (!cfg.enabled) return;
    try {
      const projects = await this.prisma.client.project.findMany({
        where: { businessId: payload.businessId, bookingId, status: cfg.fromStatus, deletedAt: null },
        select: { id: true },
      });
      for (const p of projects) {
        await this.transition(payload.businessId, p.id, cfg.fromStatus, cfg.toStatusOnBookingCompleted, 'booking.completed');
      }
    } catch (err: any) {
      this.logger.warn(`project advance from booking failed: ${(err as Error).message}`);
    }
  }

  private async resolveConfig(businessId: string): Promise<Required<ProjectStageProgressionConfig>> {
    try {
      const biz = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true },
      });
      const raw = (biz?.metaData ?? {}) as Record<string, unknown>;
      const cfg = (raw.projectStageProgression ?? {}) as ProjectStageProgressionConfig;
      return {
        enabled: cfg.enabled ?? DEFAULT_PROGRESSION.enabled,
        fromStatus: cfg.fromStatus ?? DEFAULT_PROGRESSION.fromStatus,
        toStatusOnInvoicePaid: cfg.toStatusOnInvoicePaid ?? DEFAULT_PROGRESSION.toStatusOnInvoicePaid,
        toStatusOnBookingCompleted: cfg.toStatusOnBookingCompleted ?? DEFAULT_PROGRESSION.toStatusOnBookingCompleted,
      };
    } catch {
      return DEFAULT_PROGRESSION;
    }
  }

  private async transition(
    businessId: string,
    projectId: string,
    fromStatus: string,
    toStatus: string,
    reason: string,
  ) {
    if (fromStatus === toStatus) return;
    const updated = await this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data: { status: toStatus },
    });
    this.events.emit('project.status_advanced', {
      project: updated,
      businessId,
      fromStatus,
      toStatus,
      reason,
    });
    this.logger.log(`Project ${projectId} ${fromStatus} → ${toStatus} (reason: ${reason})`);
  }
}

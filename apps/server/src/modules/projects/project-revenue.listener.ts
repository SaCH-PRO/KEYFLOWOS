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
 */
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
      }
    } catch (err: any) {
      this.logger.warn(`project advance from invoice failed: ${(err as Error).message}`);
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

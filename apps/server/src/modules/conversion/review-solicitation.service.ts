import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { BookingCompletedPayload, InvoicePaidPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';
import { schedulersDisabled } from '../../core/config/env';

@Injectable()
export class ReviewSolicitationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewSolicitationService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionalEmailService) private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  onModuleInit() {
    if (schedulersDisabled()) {
      this.logger.log('Scheduler disabled (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
    this.interval = setInterval(() => {
      this.processPendingJobs().catch((e) =>
        this.logger.error(`Review solicitation poller error: ${(e as Error).message}`),
      );
    }, 60 * 60 * 1000); // hourly
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  @OnEvent('booking.completed')
  async onBookingCompleted(payload: BookingCompletedPayload) {
    await this.scheduleReviewRequest(payload.businessId, payload.booking.id, 'booking', payload.contact);
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    await this.scheduleReviewRequest(payload.businessId, payload.invoice.id, 'invoice', payload.invoice.contact);
  }

  /**
   * W10-REOPEN-REVERSALS (owner ruling D-102): a refund's reopen of a paid
   * invoice cancels its review request while it is not yet sent: the PENDING
   * job becomes CANCELLED by a compare-and-set on PENDING, which the runner's
   * claim (PENDING -> COMPLETED before it sends, V1-35) also takes, so the two
   * never both win. A request already sent (COMPLETED) is a message already
   * sent and stays; a re-delivered reopen finds nothing PENDING. Nobody is
   * messaged. Paying the invoice again re-arms the job (scheduleReviewRequest);
   * if it is PAID again by the time this ran, the job is re-armed here.
   */
  @OnEvent('invoice.reopened', { async: true })
  async onInvoiceReopened(payload: InvoiceStatusPayload) {
    const businessId = payload?.businessId;
    const invoiceId = payload?.invoice?.id;
    if (!businessId || !invoiceId) return;
    try {
      const status = await this.invoiceStatus(businessId, invoiceId);
      if (status == null || status === 'PAID') return;
      const cancelled = await this.prisma.client.scheduledAgentJob.updateMany({
        where: {
          businessId,
          entityId: invoiceId,
          checkpoint: `review_invoice_${invoiceId}`,
          jobType: 'review_solicitation',
          status: 'PENDING',
        },
        data: { status: 'CANCELLED' },
      });
      if (cancelled.count === 0) return;
      this.logger.log(`D-102: cancelled the unsent review request of reopened invoice ${invoiceId}`);
      if ((await this.invoiceStatus(businessId, invoiceId)) === 'PAID') {
        await this.scheduleReviewRequest(businessId, invoiceId, 'invoice', payload.invoice.contact ?? undefined);
      }
    } catch (e) {
      this.logger.warn(`D-102 review request cancel failed for invoice ${invoiceId}: ${(e as Error).message}`);
    }
  }

  private async invoiceStatus(businessId: string, invoiceId: string): Promise<string | null> {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { status: true },
    });
    return inv?.status ?? null;
  }

  private async scheduleReviewRequest(
    businessId: string,
    entityId: string,
    entityType: 'booking' | 'invoice',
    contact: { id?: string; firstName?: string | null; lastName?: string | null; email?: string | null } | undefined,
  ) {
    if (!contact?.email) return;

    const checkpoint = `review_${entityType}_${entityId}`;
    const existing = await this.prisma.client.scheduledAgentJob.findFirst({
      where: { businessId, entityId, checkpoint },
    });
    const scheduledFor = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    if (existing) {
      // W10-REOPEN-REVERSALS (D-102): an invoice paid again after its reopen cancelled the
      // request gets it re-armed (CANCELLED -> PENDING); a sent or pending request stays as it is.
      if (existing.status === 'CANCELLED' && entityType === 'invoice') {
        const rearmed = await this.prisma.client.scheduledAgentJob.updateMany({
          where: { id: existing.id, status: 'CANCELLED' },
          data: { status: 'PENDING', scheduledFor, executedAt: null },
        });
        if (rearmed.count === 1) this.logger.log(`Re-armed review request for invoice ${entityId} at ${scheduledFor.toISOString()}`);
      }
      return;
    }

    await this.prisma.client.scheduledAgentJob.create({
      data: {
        businessId,
        jobType: 'review_solicitation',
        entityId,
        checkpoint,
        status: 'PENDING',
        scheduledFor,
        payload: {
          contactId: contact.id,
          contactEmail: contact.email,
          contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Valued Customer',
          entityType,
        },
      },
    });

    this.logger.log(`Scheduled review request for ${entityType} ${entityId} at ${scheduledFor.toISOString()}`);
  }

  /**
   * V1-84 (FOLLOW3-D17-JOB-RUNNER-CLAIMS): the V1-35 claim, unchanged. Each job
   * is claimed before any effect by a compare-and-set on the version read
   * (PENDING, same updatedAt, still due; count === 1), so overlapping ticks or a
   * second server instance never send the review request twice. A failed
   * execution marks the row FAILED only while it is still this claim's. A claim
   * that throws leaves the row PENDING and ends this tick (logged by the
   * interval). A lease for a crash after the claim is V1+.
   */
  async processPendingJobs() {
    const jobs = await this.prisma.client.scheduledAgentJob.findMany({
      where: {
        jobType: 'review_solicitation',
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
      },
      take: 50,
      orderBy: { scheduledFor: 'asc' },
    });

    for (const job of jobs) {
      const claimedAt = new Date();
      const claim = await this.prisma.client.scheduledAgentJob.updateMany({
        where: { id: job.id, status: 'PENDING', updatedAt: job.updatedAt, scheduledFor: { lte: claimedAt } },
        data: { status: 'COMPLETED', executedAt: claimedAt },
      });
      if (claim.count !== 1) continue; // taken by another claimant, cancelled, or re-armed after the read
      try {
        const p = job.payload as Record<string, any>;
        const dedupeKey = await this.reviewDedupeKey(job.businessId, job.entityId, p.entityType);
        await this.transactionalEmail.send({
          businessId: job.businessId,
          type: 'review_request',
          recipientEmail: p.contactEmail,
          recipientName: p.contactName,
          contactId: p.contactId,
          templateData: {
            orderNumber: p.entityType === 'invoice' ? job.entityId.slice(-8).toUpperCase() : undefined,
            productNames: p.entityType === 'booking' ? ['your service'] : undefined,
          },
          dedupeKey,
        });
      } catch (e) {
        this.logger.error(`Review solicitation failed for job ${job.id}: ${(e as Error).message}`);
        // Fenced to this claim: a row its writer re-armed during the execution keeps its new run.
        const failed = await this.prisma.client.scheduledAgentJob.updateMany({
          where: { id: job.id, status: 'COMPLETED', executedAt: claimedAt },
          data: { status: 'FAILED' },
        }).catch(() => null);
        if (failed && failed.count !== 1) {
          this.logger.warn(`Review solicitation job ${job.id} changed during its failed execution; left as its writer set it`);
        }
      }
    }
  }

  /**
   * W3-D17b-REVIEW-SOLICIT-DEDUPE (V1-89): the review request's dedupe key is
   * the booking it asks about plus the purpose. A booking is solicited by its
   * own completion (booking.completed) and by the payment of its final or
   * deposit invoice (invoice.paid): two jobs, one visit, so an invoice job
   * resolves the booking that invoice belongs to (as flow.listener's
   * confirmBookingForPaidInvoice does, in the job's business). An invoice of no
   * booking keeps its own key, so a contact's other purchases are each still
   * solicited. TransactionalEmailService claims the key before any effect, so
   * the two jobs reach the provider once even when two ticks run them at once.
   *
   * Review repair CR-D17b-1: an invoice job takes the booking key only when that
   * booking's visit has happened (the booking is COMPLETED when the job runs).
   * A deposit, or a final invoice drawn up and paid ahead, is usually solicited
   * before the visit (its job is due 3 days after payment); under the booking
   * key it took the slot of the post-visit request, which then never went out.
   * Before the visit it keeps its own invoice key, as every job sent on base.
   */
  private async reviewDedupeKey(businessId: string, entityId: string, entityType: unknown): Promise<string> {
    if (entityType === 'invoice') {
      const booking = await this.prisma.client.booking.findFirst({
        where: { businessId, status: 'COMPLETED', OR: [{ invoiceId: entityId }, { depositInvoiceId: entityId }] },
        select: { id: true },
      });
      return booking ? `review-solicitation:booking:${booking.id}` : `review-solicitation:invoice:${entityId}`;
    }
    return `review-solicitation:booking:${entityId}`;
  }
}

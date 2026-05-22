import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { BookingCompletedPayload, InvoicePaidPayload } from '../../core/event-bus/events.types';

@Injectable()
export class ReviewSolicitationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewSolicitationService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionalEmailService) private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  onModuleInit() {
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
    if (existing) return;

    const scheduledFor = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
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
      try {
        const p = job.payload as Record<string, any>;
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
        });
        await this.prisma.client.scheduledAgentJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', executedAt: new Date() },
        });
      } catch (e) {
        this.logger.error(`Review solicitation failed for job ${job.id}: ${(e as Error).message}`);
        await this.prisma.client.scheduledAgentJob.update({
          where: { id: job.id },
          data: { status: 'FAILED' },
        }).catch(() => {});
      }
    }
  }
}

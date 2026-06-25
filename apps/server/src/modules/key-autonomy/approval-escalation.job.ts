import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApprovalQueue } from './services/approval-queue.service';

/**
 * ApprovalEscalationJob — automated cron jobs for the approval queue.
 *
 * Runs two scheduled tasks:
 *   1. expireOverdueApprovals — every 10 minutes, marks expired tickets.
 *   2. escalateLongPending   — every 30 minutes, logs escalations for
 *                               tickets pending longer than a threshold.
 */
@Injectable()
export class ApprovalEscalationJob {
  private readonly logger = new Logger(ApprovalEscalationJob.name);

  constructor(private readonly approvalQueue: ApprovalQueue) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireOverdueApprovals() {
    try {
      const count = await this.approvalQueue.expireOverdue();
      if (count > 0) {
        this.logger.warn(`Expired ${count} overdue approval ticket(s)`);
      } else {
        this.logger.debug('No overdue approval tickets to expire');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`expireOverdueApprovals failed: ${msg}`);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async escalateLongPending() {
    try {
      const count = await this.approvalQueue.escalateOverdue(60); // Escalate after 1 hour
      if (count > 0) {
        this.logger.warn(`Escalated ${count} long-pending approval ticket(s)`);
      } else {
        this.logger.debug('No long-pending tickets requiring escalation');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`escalateLongPending failed: ${msg}`);
    }
  }
}

/**
 * Contracts renew whether or not anyone remembered.
 *
 * THE GAP, verified rather than quoted. `renewalNoticeDays` is written by the
 * AI extractor (document-intelligence.service.ts:210), by the KEY tool
 * (flow-orchestrator.service.ts:2883) and by the service (:357) — and read by
 * NOTHING. A business enters "warn me 60 days before" and no code has ever
 * looked at that number.
 *
 * `regenerateAlerts` does read `renewalDate`, so the audit's "read by nothing"
 * is slightly too strong — but it runs only at WRITE time, and it adds
 * RENEWAL_DUE only while `renewal > now`. So the alert row is created the day
 * the contract is filed, nothing ever sweeps it, and once the date passes a
 * regeneration silently drops it. Auto-renewing supplier contracts renew in
 * silence and terminable ones lapse; the module contains no @Cron and no
 * setInterval at all.
 *
 * WHY THIS RAISES AN OBLIGATION RATHER THAN SENDING AN ALERT. A renewal is
 * something the business OWES someone a decision about by a date, which is what
 * `work.obligation.raised` means. It then appears in "due this week" beside the
 * salon's rebook and the accountant's return — one list, one clock — instead of
 * becoming a thirteenth notification channel nobody reads.
 *
 * ON RUNNING WITHOUT LEADER ELECTION. This server has 26 @Cron jobs, 52
 * setInterval schedulers and no leader election, so a second replica double-
 * fires everything. That is a real problem and it is NOT this producer's
 * problem: the obligation contract is idempotent on
 * `[businessId, sourceModule, sourceType, sourceId, actionType]`, so two
 * replicas sweeping the same contract on the same day produce one row. Raising
 * an obligation is safe to do twice, which is most of the argument for raising
 * obligations rather than writing rows directly.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WORK_OBLIGATION_RAISED, type ObligationRaisedPayload } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Used when a contract has no `renewalNoticeDays`. 30 is the extractor's own
 * default (document-intelligence.service.ts:210), so a contract KEY read and
 * one a human typed behave the same way.
 */
const DEFAULT_NOTICE_DAYS = 30;

/** A renewal nobody can act on any more is not worth a row in "due this week". */
const RENEWABLE_STATUSES = ['ACTIVE', 'RENEWAL_DUE'] as const;

@Injectable()
export class ContractRenewalSweep {
  private readonly logger = new Logger(ContractRenewalSweep.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  /**
   * Daily, early. Renewal notice is measured in days, so a finer cadence buys
   * nothing and costs a scan of every contract in the system.
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async sweep(): Promise<{ scanned: number; raised: number }> {
    try {
      return await this.raiseDueRenewals(new Date());
    } catch (err) {
      // A sweep must not take the process down, but a swallowed rejection is
      // the documented failure class here, so it is logged with its message.
      this.logger.error(`Contract renewal sweep failed: ${(err as Error).message}`);
      return { scanned: 0, raised: 0 };
    }
  }

  /**
   * Exposed and pure-ish (takes `now`) so a test can drive it at a fixed date
   * rather than mocking the clock — the cron wrapper is one line above.
   */
  async raiseDueRenewals(now: Date): Promise<{ scanned: number; raised: number }> {
    // The widest window any contract could ask for, so one indexed query does
    // the coarse filter and the per-contract notice period is applied in
    // memory. Selecting every contract with a renewalDate would scan the table.
    const horizon = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const contracts = await this.prisma.client.contract.findMany({
      where: {
        renewalDate: { not: null, lte: horizon },
        // Contract is not in the soft-delete set, so there is no deletedAt to
        // filter — status carries the whole lifecycle here.
        status: { in: [...RENEWABLE_STATUSES] },
      },
      select: {
        id: true,
        businessId: true,
        title: true,
        renewalDate: true,
        renewalNoticeDays: true,
        renewalType: true,
        contractValue: true,
        currency: true,
        parties: { select: { name: true }, take: 1 },
      },
    });

    let raised = 0;
    for (const c of contracts) {
      if (!c.renewalDate) continue;

      const noticeDays = c.renewalNoticeDays ?? DEFAULT_NOTICE_DAYS;
      const noticeStarts = new Date(
        c.renewalDate.getTime() - noticeDays * 24 * 60 * 60 * 1000,
      );

      // Outside the window the business asked to be warned in. This is the
      // whole point of the field, and the first time anything has read it.
      if (now < noticeStarts) continue;

      const counterparty = c.parties[0]?.name ?? null;
      const autoRenews = (c.renewalType ?? '').toUpperCase().includes('AUTO');

      const payload: ObligationRaisedPayload = {
        businessId: c.businessId,
        sourceModule: 'contracts',
        sourceType: 'contract',
        sourceId: c.id,
        actionType: 'CONTRACT_RENEWAL',
        title: autoRenews
          ? `${c.title} auto-renews — cancel or accept`
          : `${c.title} is up for renewal`,
        description: autoRenews
          ? `Renews automatically on ${c.renewalDate.toISOString().slice(0, 10)}. Doing nothing renews it.`
          : `Renewal date ${c.renewalDate.toISOString().slice(0, 10)}. Doing nothing lets it lapse.`,
        category: 'GOVERNANCE',
        dueAt: c.renewalDate,
        owedToType: counterparty ? 'SUPPLIER' : 'BUSINESS',
        owedToId: null,
        owedToLabel: counterparty,
        entityType: 'contract',
        entityId: c.id,
        expectedValue: c.contractValue ?? null,
        currency: c.currency ?? null,
        // An auto-renewing contract costs money by default, so it outranks one
        // that merely lapses.
        priority: autoRenews ? 75 : 60,
      };

      this.events.emit(WORK_OBLIGATION_RAISED, payload);
      raised += 1;
    }

    if (raised > 0) {
      this.logger.log(
        `Contract renewal sweep: ${raised} obligation(s) raised from ${contracts.length} contract(s) in the horizon`,
      );
    }
    return { scanned: contracts.length, raised };
  }
}

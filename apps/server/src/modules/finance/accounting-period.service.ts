import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getTenantContext } from '../../core/tenant/tenant-context';

export interface CreateAccountingPeriodInput {
  year: number;
  month: number;
}

export interface CloseAccountingPeriodInput {
  closedById?: string;
}

export interface ReopenAccountingPeriodInput {
  reopenedById?: string;
}

/**
 * V1-15 review SEC-V15-3: the advisory-lock namespace that serializes closing
 * a business's period against that business's postings. close() holds the
 * lock exclusively; PostingService.post()/reverse() hold it shared (through
 * assertOpenForPosting, inside the posting transaction), so postings never
 * wait on each other, a close waits for every posting already past its period
 * check to commit (and then stamps it), and a posting that starts while a
 * close runs reads the period after the close committed. Namespaced so the
 * key never collides with another advisory lock that hashes a bare id.
 */
export const ACCOUNTING_PERIOD_LOCK_NAMESPACE = 'finance:accounting-period:';

/** Who may close or reopen a period (V1-15 review SEC-V15-2). */
const PERIOD_GATE_ROLES = new Set(['OWNER', 'ADMIN']);

/** Close waits for in-flight postings of the business before stamping. */
const CLOSE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class AccountingPeriodService {
  private readonly logger = new Logger(AccountingPeriodService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.accountingPeriod.findMany({
      where: { businessId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async get(businessId: string, id: string) {
    const period = await this.prisma.client.accountingPeriod.findFirst({
      where: { id, businessId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    return period;
  }

  async create(businessId: string, input: CreateAccountingPeriodInput) {
    if (input.month < 1 || input.month > 12) {
      throw new BadRequestException('Month must be 1-12');
    }

    const existing = await this.prisma.client.accountingPeriod.findFirst({
      where: { businessId, year: input.year, month: input.month },
    });
    if (existing) throw new BadRequestException('Accounting period already exists');

    const startDate = new Date(Date.UTC(input.year, input.month - 1, 1));
    const endDate = new Date(Date.UTC(input.year, input.month, 0, 23, 59, 59, 999));

    return this.prisma.client.accountingPeriod.create({
      data: {
        businessId,
        year: input.year,
        month: input.month,
        startDate,
        endDate,
      },
    });
  }

  async update(businessId: string, id: string, input: Partial<CreateAccountingPeriodInput>) {
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot update a closed period');

    const year = input.year ?? period.year;
    const month = input.month ?? period.month;

    if (month < 1 || month > 12) {
      throw new BadRequestException('Month must be 1-12');
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return this.prisma.client.accountingPeriod.update({
      where: { id },
      data: { year, month, startDate, endDate },
    });
  }

  /**
   * Close a period: from then on PostingService refuses anything dated inside
   * it (V1-15, CF-40), and every transaction already dated inside it is
   * stamped `metadata.lockedByPeriod`.
   *
   * V1-15 review:
   *  - SEC-V15-1: only a period that has ENDED can be closed (400 otherwise).
   *    Payments, provider settlements (Stripe, WiPay, PayPal webhooks), their
   *    refunds and every reversal are dated "now", so with this rule nothing
   *    dated now ever meets a closed period: a provider webhook, which commits
   *    its dedupe row before it posts, can never be refused by a period and
   *    then acked as a duplicate on redelivery (the payment would be lost).
   *  - SEC-V15-2: the actor must be the business owner or an OWNER / ADMIN
   *    member (403 otherwise; a STAFF member cannot shut the posting door), and
   *    the close is recorded in the finance audit trail (team_activity_logs,
   *    module 'finance', action PERIOD_CLOSED) in the same transaction.
   *  - SEC-V15-3: the close takes the business's period lock exclusively, so it
   *    waits for postings already past their period check and stamps them, and
   *    no posting lands inside the period after it closes.
   *
   * The actor is `input.closedById`, else the request's authenticated user
   * (TenantInterceptor's AsyncLocalStorage context) for this business; with
   * neither, the close is refused.
   */
  async close(businessId: string, id: string, input: CloseAccountingPeriodInput = {}) {
    await this.get(businessId, id);
    const actorId = await this.assertMayGate(businessId, input.closedById, 'close');

    await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      await this.lockPeriods(tx, businessId, 'exclusive');
      // Re-read under the lock: a concurrent close of the same period lost the race.
      const period = await tx.accountingPeriod.findFirst({ where: { id, businessId } });
      if (!period) throw new NotFoundException('Accounting period not found');
      if (period.status === 'CLOSED') throw new BadRequestException('Period already closed');
      if (period.endDate.getTime() >= Date.now()) {
        throw new BadRequestException(
          `Accounting period ${periodLabel(period)} has not ended: a period can be closed only after its last day.`,
        );
      }

      const stamp = `lock:${businessId}:${periodLabel(period)}`;
      // Stamp all transactions in the period — preserve existing metadata
      const txs = await tx.financialTransaction.findMany({
        where: {
          businessId,
          date: { gte: period.startDate, lte: period.endDate },
        },
        select: { id: true, metadata: true },
      });
      for (const t of txs) {
        const existing = (t.metadata as Record<string, unknown> | null) ?? {};
        await tx.financialTransaction.update({
          where: { id: t.id },
          data: { metadata: { ...existing, lockedByPeriod: stamp } },
        });
      }

      const closedAt = new Date();
      await tx.accountingPeriod.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt,
          closedById: actorId,
          lockedTransactionStamp: stamp,
        },
      });

      await this.audit(tx, {
        businessId,
        actorId,
        action: 'PERIOD_CLOSED',
        periodId: id,
        title: `Accounting period ${periodLabel(period)} closed`,
        meta: { year: period.year, month: period.month, stamp, transactionsStamped: txs.length, closedAt: closedAt.toISOString() },
      });
    }, CLOSE_TX_OPTIONS);

    return this.get(businessId, id);
  }

  /**
   * Reopen a CLOSED period. Same authority as close() (V1-15 review
   * SEC-V15-2): the actor is `input.reopenedById`, else the request's
   * authenticated user for this business (the reopen route passes none; the
   * global TenantInterceptor provides it); with neither, refused. The reopen
   * clears closedById / closedAt on the period, so who closed it, when, and
   * who reopened it are written to the finance audit trail (PERIOD_REOPENED)
   * in the same transaction, which fails the reopen if it cannot be written.
   */
  async reopen(businessId: string, id: string, input: ReopenAccountingPeriodInput = {}) {
    await this.get(businessId, id);
    const actorId = await this.assertMayGate(businessId, input.reopenedById, 'reopen');

    await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // Serialized with close() (and with a second reopen): one audit row per change.
      await this.lockPeriods(tx, businessId, 'exclusive');
      const period = await tx.accountingPeriod.findFirst({ where: { id, businessId } });
      if (!period) throw new NotFoundException('Accounting period not found');
      if (period.status !== 'CLOSED') throw new BadRequestException('Period is not closed');

      // Clear stamp from transactions — preserve other metadata
      let unstamped = 0;
      if (period.lockedTransactionStamp) {
        const txs = await tx.financialTransaction.findMany({
          where: {
            businessId,
            date: { gte: period.startDate, lte: period.endDate },
          },
          select: { id: true, metadata: true },
        });
        for (const t of txs) {
          const existing = { ...((t.metadata as Record<string, unknown> | null) ?? {}) };
          delete existing.lockedByPeriod;
          await tx.financialTransaction.update({
            where: { id: t.id },
            data: { metadata: Object.keys(existing).length > 0 ? (existing as Prisma.InputJsonObject) : Prisma.JsonNull },
          });
        }
        unstamped = txs.length;
      }

      await tx.accountingPeriod.update({
        where: { id },
        data: {
          status: 'OPEN',
          closedAt: null,
          closedById: null,
          lockedTransactionStamp: null,
        },
      });

      await this.audit(tx, {
        businessId,
        actorId,
        action: 'PERIOD_REOPENED',
        periodId: id,
        title: `Accounting period ${periodLabel(period)} reopened`,
        meta: {
          year: period.year,
          month: period.month,
          previousClosedById: period.closedById,
          previousClosedAt: period.closedAt ? period.closedAt.toISOString() : null,
          previousStamp: period.lockedTransactionStamp,
          transactionsUnstamped: unstamped,
        },
      });
    });

    return this.get(businessId, id);
  }

  async remove(businessId: string, id: string) {
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot delete a closed period');
    return this.prisma.client.accountingPeriod.delete({ where: { id } });
  }

  /**
   * Check whether a date falls inside a closed period. Returns the period if
   * locked. Pass `client` (the caller's transaction) to read the period inside
   * the same transaction as the write it guards.
   */
  async checkClosed(businessId: string, date: Date, client?: Prisma.TransactionClient) {
    const db = client ?? (this.prisma.client as unknown as Prisma.TransactionClient);
    return db.accountingPeriod.findFirst({
      where: {
        businessId,
        status: 'CLOSED',
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
  }

  /**
   * V1-15 (CF-40): the posting door's closed-period control. PostingService
   * calls this inside the posting transaction before it writes a transaction
   * (post) or a reversal (reverse), so nothing is written with a date inside
   * a CLOSED period of the posting business, by any recipe. Another business's
   * periods never apply. Throws 409; reopen the period, or date the entry
   * inside an open one.
   *
   * V1-15 review:
   *  - SEC-V15-3: with the caller's transaction, the business's period lock is
   *    taken shared first, so the read below cannot pass while a close of the
   *    same business is committing, and a close waits for this posting.
   *  - SEC-V15-1: a period is a lock once it is CLOSED and has ENDED. close()
   *    refuses a period that has not ended, so for every period it closes the
   *    two coincide. A CLOSED row that has not ended can only be left by a
   *    close made before this rule (closing was metadata only before V1-15): it
   *    is not enforced, so it can never refuse what is dated now (payments,
   *    provider settlements, refunds, reversals). It becomes a lock once it ends.
   */
  async assertOpenForPosting(businessId: string, date: Date, client?: Prisma.TransactionClient): Promise<void> {
    if (client) await this.lockPeriods(client, businessId, 'shared');
    const closed = await this.checkClosed(businessId, date, client);
    if (!closed) return;
    if (closed.endDate.getTime() >= Date.now()) {
      this.logger.warn(
        `Accounting period ${periodLabel(closed)} of ${businessId} is CLOSED but has not ended (closed before V1-15); ` +
          'not enforced until it ends.',
      );
      return;
    }
    throw new ConflictException(
      `Accounting period ${periodLabel(closed)} is closed: ` +
        `nothing can be posted dated ${date.toISOString().slice(0, 10)}. Reopen the period or post in an open one.`,
    );
  }

  /** The business's period lock (see ACCOUNTING_PERIOD_LOCK_NAMESPACE), released at commit or rollback. */
  private async lockPeriods(tx: Prisma.TransactionClient, businessId: string, mode: 'shared' | 'exclusive') {
    const key = ACCOUNTING_PERIOD_LOCK_NAMESPACE + businessId;
    if (mode === 'shared') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
  }

  /**
   * V1-15 review SEC-V15-2: closing or reopening a period opens or shuts the
   * posting door, so it is the business owner's or an admin's call: the
   * distinguished owner (Business.ownerId) or an OWNER / ADMIN membership.
   * A STAFF member, a stranger, or no actor at all is refused (403).
   */
  private async assertMayGate(businessId: string, explicitActorId: string | undefined, verb: 'close' | 'reopen'): Promise<string> {
    const ambient = getTenantContext();
    const actorId = explicitActorId ?? (ambient?.businessId === businessId ? ambient.userId : undefined);
    if (actorId) {
      const membership = await this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId: actorId, businessId } },
        select: { role: true },
      });
      if (membership && PERIOD_GATE_ROLES.has(membership.role)) return actorId;
      const owned = await this.prisma.client.business.findFirst({
        where: { id: businessId, ownerId: actorId },
        select: { id: true },
      });
      if (owned) return actorId;
    }
    throw new ForbiddenException(`Only the business owner or an admin can ${verb} an accounting period.`);
  }

  /** The period's finance audit row, written with the change it records (fails it if it cannot be written). */
  private async audit(
    tx: Prisma.TransactionClient,
    entry: {
      businessId: string;
      actorId: string;
      action: 'PERIOD_CLOSED' | 'PERIOD_REOPENED';
      periodId: string;
      title: string;
      meta: Record<string, unknown>;
    },
  ) {
    await tx.teamActivityLog.create({
      data: {
        businessId: entry.businessId,
        userId: entry.actorId,
        module: 'finance',
        action: entry.action,
        entityType: 'AccountingPeriod',
        entityId: entry.periodId,
        title: entry.title,
        meta: entry.meta as Prisma.InputJsonValue,
      },
    });
  }
}

function periodLabel(period: { year: number; month: number }): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

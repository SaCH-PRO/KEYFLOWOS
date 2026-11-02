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

/** Who changes or deletes a period (review SEC9-1); else the request's authenticated user. */
export interface AccountingPeriodActor {
  actorId?: string;
}

/**
 * V1-15 review SEC-V15-3: the advisory-lock namespace that serializes closing
 * a period against the postings dated inside it. close() and reopen() hold
 * the lock exclusively; PostingService.post()/reverse() (and FixedAssetService)
 * hold it shared (through assertOpenForPosting, inside the posting
 * transaction), so postings never wait on each other, a close waits for every
 * posting already past its period check to commit (and then stamps it), and a
 * posting that starts while a close runs reads the period after the close
 * committed. Namespaced so the key never collides with another advisory lock
 * that hashes a bare id.
 *
 * V1-15b repair2 (review LC-1): the lock is one per business per UTC calendar
 * month (accountingPeriodLockKey), not one per business. A close only ever
 * shuts a month that has ENDED, so a posting dated now (a provider webhook, a
 * payment, a refund, a reversal) never shares a key with it and never waits
 * on it. With one lock per business, a close stamping a large month held every
 * posting of the business: a webhook's payment transaction (5s interactive
 * timeout) expired after its dedupe row had committed, and the redelivery was
 * acked as a duplicate, so the payment was lost.
 */
export const ACCOUNTING_PERIOD_LOCK_NAMESPACE = 'finance:accounting-period:';

/** The period lock's key for one business and one UTC calendar month (review LC-1). */
export function accountingPeriodLockKey(businessId: string, year: number, month: number): string {
  return `${ACCOUNTING_PERIOD_LOCK_NAMESPACE}${businessId}:${year}-${String(month).padStart(2, '0')}`;
}

/** Who may close, reopen, change or delete a period (V1-15 review SEC-V15-2; repair2 SEC9-1). */
const PERIOD_GATE_ROLES = new Set(['OWNER', 'ADMIN']);

/** Close waits for in-flight postings of the month before stamping. */
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

  /**
   * Move an OPEN period to another month. V1-15b repair2 (review SEC9-1):
   *  - the owner's or an admin's call, like close and reopen (403 otherwise):
   *    a period's months decide what its close shuts;
   *  - written only while the row is still OPEN (`status: 'OPEN'` in the
   *    write's own WHERE). close() holds the row (FOR UPDATE) while it closes,
   *    so a PATCH that read the period OPEN and writes after the close
   *    committed matches nothing and is refused (400): it can no longer move a
   *    CLOSED period off its month (reopening that month with no audit row) or
   *    onto a month that has not ended.
   */
  async update(
    businessId: string,
    id: string,
    input: Partial<CreateAccountingPeriodInput>,
    actor: AccountingPeriodActor = {},
  ) {
    await this.assertMayGate(businessId, actor.actorId, 'update');
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot update a closed period');

    const year = input.year ?? period.year;
    const month = input.month ?? period.month;

    if (month < 1 || month > 12) {
      throw new BadRequestException('Month must be 1-12');
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const { count } = await this.prisma.client.accountingPeriod.updateMany({
      where: { id, businessId, status: 'OPEN' },
      data: { year, month, startDate, endDate },
    });
    if (count === 0) await this.refuseNoLongerOpen(businessId, id, 'update');
    return this.get(businessId, id);
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
   *  - SEC-V15-3: the close takes the period lock of its month exclusively, so
   *    it waits for postings dated in the month already past their period
   *    check and stamps them, and no posting lands inside the period after it
   *    closes.
   *
   * V1-15b repair2:
   *  - SEC9-1: the period's row is locked first (FOR UPDATE), so a PATCH or
   *    DELETE racing the close waits and then finds it CLOSED.
   *  - LC-1: the lock is the month's, not the business's (a posting dated now
   *    never waits on a close), and the stamp is one statement, so the close
   *    holds its month for one round trip instead of one per transaction (and
   *    stamps every row, not the first 1000 a findMany returns).
   *
   * The actor is `input.closedById`, else the request's authenticated user
   * (TenantInterceptor's AsyncLocalStorage context) for this business; with
   * neither, the close is refused.
   */
  async close(businessId: string, id: string, input: CloseAccountingPeriodInput = {}) {
    const current = await this.get(businessId, id);
    const actorId = await this.assertMayGate(businessId, input.closedById, 'close');
    // Refused before any lock is taken, and again under the locks below.
    if (current.status !== 'CLOSED') assertEnded(current);

    await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // The row first (review SEC9-1): its months cannot change and it cannot be
      // deleted while it closes; a concurrent close of it waits and then loses.
      const period = await this.lockPeriodRow(tx, businessId, id);
      await this.lockMonths(tx, businessId, monthsOf(period), 'exclusive');
      if (period.status === 'CLOSED') throw new BadRequestException('Period already closed');
      assertEnded(period);

      const stamp = `lock:${businessId}:${periodLabel(period)}`;
      // Stamp every transaction dated in the period, keeping its own metadata.
      // One statement (review LC-1): the month's rows are neither read through
      // the 1000-row findMany cap nor written one round trip each under the lock.
      const stamped = await tx.$executeRaw`
        UPDATE financial_transactions AS ft
           SET metadata = (CASE WHEN jsonb_typeof(ft.metadata) = 'object' THEN ft.metadata ELSE '{}'::jsonb END)
                          || jsonb_build_object('lockedByPeriod', ${stamp}::text),
               updated_at = (now() AT TIME ZONE 'UTC')
          FROM accounting_periods AS ap
         WHERE ap.id = ${id}
           AND ap.business_id = ${businessId}
           AND ft.business_id = ap.business_id
           AND ft.date >= ap.start_date
           AND ft.date <= ap.end_date`;

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
        meta: { year: period.year, month: period.month, stamp, transactionsStamped: stamped, closedAt: closedAt.toISOString() },
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
   * Locks as close() does: the row, then its month (repair2, SEC9-1 / LC-1).
   */
  async reopen(businessId: string, id: string, input: ReopenAccountingPeriodInput = {}) {
    await this.get(businessId, id);
    const actorId = await this.assertMayGate(businessId, input.reopenedById, 'reopen');

    await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // Serialized with close() (and with a second reopen): one audit row per change.
      const period = await this.lockPeriodRow(tx, businessId, id);
      await this.lockMonths(tx, businessId, monthsOf(period), 'exclusive');
      if (period.status !== 'CLOSED') throw new BadRequestException('Period is not closed');

      // Clear the stamp from every transaction dated in the period, keeping the
      // rest of its metadata (JSON null when nothing else is left). One
      // statement, as in close() (review LC-1).
      let unstamped = 0;
      if (period.lockedTransactionStamp) {
        unstamped = await tx.$executeRaw`
          UPDATE financial_transactions AS ft
             SET metadata = CASE WHEN (ft.metadata - 'lockedByPeriod') = '{}'::jsonb THEN 'null'::jsonb
                                 ELSE ft.metadata - 'lockedByPeriod' END,
                 updated_at = (now() AT TIME ZONE 'UTC')
            FROM accounting_periods AS ap
           WHERE ap.id = ${id}
             AND ap.business_id = ${businessId}
             AND ft.business_id = ap.business_id
             AND ft.date >= ap.start_date
             AND ft.date <= ap.end_date
             AND jsonb_typeof(ft.metadata) = 'object'
             AND (ft.metadata -> 'lockedByPeriod') IS NOT NULL`;
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

  /**
   * Delete an OPEN period. Same rules as update() (V1-15b repair2, review
   * SEC9-1): the owner's or an admin's call (403 otherwise), and deleted only
   * while the row is still OPEN, so a DELETE that read the period OPEN and
   * runs after its close committed is refused (400) and the CLOSED period
   * stays.
   */
  async remove(businessId: string, id: string, actor: AccountingPeriodActor = {}) {
    await this.assertMayGate(businessId, actor.actorId, 'delete');
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot delete a closed period');
    const { count } = await this.prisma.client.accountingPeriod.deleteMany({ where: { id, businessId, status: 'OPEN' } });
    if (count === 0) await this.refuseNoLongerOpen(businessId, id, 'delete');
    return period;
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
   *  - SEC-V15-3: with the caller's transaction, the period lock of the date's
   *    month is taken shared first, so the read below cannot pass while a
   *    close of that month is committing, and that close waits for this
   *    posting. A close of another month never holds it (review LC-1).
   *  - SEC-V15-1: a period is a lock once it is CLOSED and has ENDED. close()
   *    refuses a period that has not ended, so for every period it closes the
   *    two coincide. A CLOSED row that has not ended can only be left by a
   *    close made before this rule (closing was metadata only before V1-15): it
   *    is not enforced, so it can never refuse what is dated now (payments,
   *    provider settlements, refunds, reversals). It becomes a lock once it ends.
   */
  async assertOpenForPosting(businessId: string, date: Date, client?: Prisma.TransactionClient): Promise<void> {
    if (client) await this.lockMonths(client, businessId, [{ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }], 'shared');
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

  /**
   * The period locks of `months` (see ACCOUNTING_PERIOD_LOCK_NAMESPACE and
   * accountingPeriodLockKey), released at commit or rollback. Taken in month
   * order, so two holders of several months never wait on each other in a cycle.
   */
  private async lockMonths(
    tx: Prisma.TransactionClient,
    businessId: string,
    months: Array<{ year: number; month: number }>,
    mode: 'shared' | 'exclusive',
  ) {
    const ordered = [...months].sort((a, b) => a.year - b.year || a.month - b.month);
    for (const m of ordered) {
      const key = accountingPeriodLockKey(businessId, m.year, m.month);
      if (mode === 'shared') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }
    }
  }

  /**
   * Lock the period's row (FOR UPDATE) for the rest of the transaction and read
   * it (review SEC9-1): while close() or reopen() holds it, update() and
   * remove() wait, and then find it no longer OPEN.
   */
  private async lockPeriodRow(tx: Prisma.TransactionClient, businessId: string, id: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM accounting_periods WHERE id = ${id} AND business_id = ${businessId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundException('Accounting period not found');
    const period = await tx.accountingPeriod.findFirst({ where: { id, businessId } });
    if (!period) throw new NotFoundException('Accounting period not found');
    return period;
  }

  /** update() / remove() matched no OPEN row: it was deleted (404) or closed (400) after it was read. */
  private async refuseNoLongerOpen(businessId: string, id: string, verb: 'update' | 'delete'): Promise<never> {
    const now = await this.prisma.client.accountingPeriod.findFirst({ where: { id, businessId }, select: { status: true } });
    if (!now) throw new NotFoundException('Accounting period not found');
    throw new BadRequestException(`Cannot ${verb} a closed period`);
  }

  /**
   * V1-15 review SEC-V15-2: closing or reopening a period opens or shuts the
   * posting door, and changing or deleting one decides which month a close
   * shuts (repair2, review SEC9-1), so each is the business owner's or an
   * admin's call: the distinguished owner (Business.ownerId) or an OWNER /
   * ADMIN membership. A STAFF member, a stranger, or no actor at all is
   * refused (403).
   */
  private async assertMayGate(
    businessId: string,
    explicitActorId: string | undefined,
    verb: 'close' | 'reopen' | 'update' | 'delete',
  ): Promise<string> {
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

/** SEC-V15-1: only a period that has ended can be closed (400 otherwise). */
function assertEnded(period: { year: number; month: number; endDate: Date }): void {
  if (period.endDate.getTime() >= Date.now()) {
    throw new BadRequestException(
      `Accounting period ${periodLabel(period)} has not ended: a period can be closed only after its last day.`,
    );
  }
}

/**
 * The UTC calendar months a period's range touches, in order: its own month
 * for every period create() and update() write; every month a legacy row's
 * range spans, so a close locks each month a posting inside it could lock.
 */
function monthsOf(period: { startDate: Date; endDate: Date }): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  let year = period.startDate.getUTCFullYear();
  let month = period.startDate.getUTCMonth() + 1;
  const lastYear = period.endDate.getUTCFullYear();
  const lastMonth = period.endDate.getUTCMonth() + 1;
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

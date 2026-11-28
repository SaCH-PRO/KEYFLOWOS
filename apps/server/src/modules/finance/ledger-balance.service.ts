import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { normalizeCurrency } from './posting.service';

export interface AccountBalance {
  accountId: string;
  systemKey: string | null;
  name: string;
  type: string;
  /**
   * V1-37 (CF-38): the currency of this row's debits and credits. An account
   * with entries in two currencies has one row per currency; one with no
   * activity has one zero row in the business currency. V1-37c: always the
   * normalized (trimmed, upper-case) code.
   */
  currency: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Net = debit - credit (positive for assets/expenses, negative for liabilities/equity/income by convention). */
  net: Prisma.Decimal;
}

export interface GeneralLedgerRow {
  entryId: string;
  transactionId: string;
  date: Date;
  accountId: string;
  accountName: string;
  accountCode: string | null;
  accountType: string;
  /** V1-66: the line's own currency, normalized (a TTD business's USD line says USD). */
  currency: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  memo: string | null;
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  runningBalance: Prisma.Decimal;
}

const D = Prisma.Decimal;
const ZERO = new D(0);

/** A date with no time of day: YYYY-MM-DD. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** The earliest instant a Postgres timestamp can hold (year 0001). */
const MIN_INSTANT_MS = Date.parse('0001-01-01T00:00:00.000Z');
/** The last instant a stored timestamp can hold (the end of year 9999). */
const MAX_INSTANT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
/** Safe upper bounds for general-ledger pagination (prevents INT4 skip overflow / DoS). */
export const MAX_GENERAL_LEDGER_PAGE = 10_000;
export const MAX_GENERAL_LEDGER_PAGE_SIZE = 500;
/** The zone of a business whose stored timezone is empty or is no zone (the schema default of Business.timezone). */
export const DEFAULT_BUSINESS_TIMEZONE = 'America/Port_of_Spain';

/** Whether `d` is a valid Date representable by PostgreSQL timestamp (years 0001..9999). */
export function isValidPostgresTimestamp(d: Date): boolean {
  const ms = d.getTime();
  return Number.isFinite(ms) && ms >= MIN_INSTANT_MS && ms <= MAX_INSTANT_MS;
}

/**
 * V1-66 (SWP-FIN-LEDGER): whether `value` is a date-only string (YYYY-MM-DD)
 * naming a day that is on the calendar. '2026-02-31' has the shape but is no
 * day (new Date() reads it as 3 March), so it is not one.
 */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
  const utcMidnight = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(utcMidnight.getTime()) && utcMidnight.toISOString().slice(0, 10) === value;
}

/** Whether `value` has the date-only shape, on the calendar or not. */
export function looksDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value);
}

/** `timeZone` when the runtime knows it as a zone, else the default. */
function knownTimeZone(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    } catch {
      /* not a zone */
    }
  }
  return DEFAULT_BUSINESS_TIMEZONE;
}

/** What the wall clock in `timeZone` reads at `instant`, as if that reading were UTC, minus the instant: the zone's offset then, in ms. */
function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    era: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const n = (type: string) => Number(part(type));
  const year = part('era').startsWith('B') ? 1 - n('year') : n('year');
  const wall = new Date(0);
  wall.setUTCFullYear(year, n('month') - 1, n('day'));
  wall.setUTCHours(n('hour'), n('minute'), n('second'), 0);
  return wall.getTime() - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant the day whose midnight, read as UTC, is `utcMidnight` starts in
 * `timeZone`. The offset is read at the answer itself (two passes), so a day
 * that starts on the other side of a daylight-saving change from midnight UTC
 * is right. Where the clocks go forward over local midnight (Havana, Santiago,
 * the Azores) no instant reads 00:00 that day: no pass checks out, and the day
 * starts at the change itself (review F2: the earlier pass cut the day
 * before's last hour).
 */
function startOfZonedDay(utcMidnight: number, timeZone: string): number {
  const reads = (instant: number) => instant + zoneOffsetMs(timeZone, instant) === utcMidnight;
  const first = utcMidnight - zoneOffsetMs(timeZone, utcMidnight);
  const second = utcMidnight - zoneOffsetMs(timeZone, first);
  // Where the clocks go back across midnight, 00:00 comes twice: the day
  // starts at the earlier one (review C-2). That one is found with the offset
  // in force just before each pass's answer, and a quarter day before it (a
  // change of several hours: Antarctica/Casey 2010). A candidate counts only
  // if the zone's clock reads 00:00 of the day at it, so a probe that finds
  // nothing changes nothing.
  const earlier = [first, second].flatMap((pass) => [
    utcMidnight - zoneOffsetMs(timeZone, pass - 1),
    utcMidnight - zoneOffsetMs(timeZone, pass - DAY_MS / 4),
  ]);
  const valid = [first, second, ...earlier].filter(reads);
  if (valid.length > 0) return Math.min(...valid);
  // No instant reads 00:00: the clocks jump over it. The day starts at the
  // jump, the instant between the two passes where the offset changes
  // (final review C-2: a jump that straddles midnight, Toronto 1919, is not at
  // either pass). Found by bisection: at most ~27 steps for a day's span.
  let before = Math.min(first, second);
  let after = Math.max(first, second);
  const offsetBefore = zoneOffsetMs(timeZone, before);
  if (zoneOffsetMs(timeZone, after) === offsetBefore) return after;
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2);
    if (zoneOffsetMs(timeZone, middle) === offsetBefore) before = middle;
    else after = middle;
  }
  return after;
}

/**
 * FU-LEDGER-ZONED-FROM: the first instant OF day `day` in `timeZone`.
 * A date-only start date covers from `date >= beginOfZonedDay(day)` so adjacent
 * single-day ranges (`from=D-1&to=D-1` and `from=D&to=D`) partition cleanly with
 * zero overlap. Throws 400 for a `day` that is not a valid calendar date.
 */
export function beginOfZonedDay(day: string, timeZone: string | null | undefined): Date {
  if (!isDateOnly(day)) throw new BadRequestException('Invalid from date');
  const utcMidnight = new Date(`${day}T00:00:00.000Z`).getTime();
  const instant = startOfZonedDay(utcMidnight, knownTimeZone(timeZone));
  return new Date(Math.max(MIN_INSTANT_MS, instant));
}

/**
 * V1-66 (SWP-FIN-LEDGER, BUG-029): the first instant AFTER day `day` in
 * `timeZone`, that is the start of the next day there. A date-only end date
 * covers the whole day as `date < endOfZonedDay(day)`: a 23-hour or 25-hour
 * day (daylight saving) is covered as it is. A timeZone that is empty or no
 * zone reads as DEFAULT_BUSINESS_TIMEZONE. Throws 400 for a `day` that is not
 * a date-only day on the calendar.
 */
export function endOfZonedDay(day: string, timeZone: string | null | undefined): Date {
  if (!isDateOnly(day)) throw new BadRequestException('Invalid to date');
  const nextUtcMidnight = new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS;
  return new Date(startOfZonedDay(nextUtcMidnight, knownTimeZone(timeZone)));
}

@Injectable()
export class LedgerBalanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Net balance of one ChartOfAccount, optionally as-of a date. */
  async getAccountBalance(accountId: string, asOf?: Date): Promise<Prisma.Decimal> {
    const where: Prisma.LedgerEntryWhereInput = { accountId };
    if (asOf) where.date = { lte: asOf };
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where,
      _sum: { debit: true, credit: true },
    });
    const debit = (agg._sum.debit as Prisma.Decimal | null) ?? ZERO;
    const credit = (agg._sum.credit as Prisma.Decimal | null) ?? ZERO;
    return new D(debit.toString()).sub(new D(credit.toString()));
  }

  /**
   * Trial balance — every active account, including those with zero activity.
   * Sums debit/credit per (account, currency) in one grouped query, then joins
   * the active ChartOfAccount rows so zero-balance accounts are still shown.
   *
   * V1-37 (CF-38, D-13): grouped by currency as well as account. It grouped by
   * account only, so a TTD business's USD invoice added its USD debit to the
   * TTD debits on accounts receivable. Each row now carries its currency, and
   * within each currency sum(debit) = sum(credit) (every posting is balanced
   * in its one currency, PostingService). Idle accounts read once, zero, in
   * the business currency.
   *
   * V1-37c (VR-03): grouped by the NORMALIZED code. Rows written before the
   * door normalized hold the code as their writer spelled it ('ttd'), and
   * Postgres groups 'ttd' apart from 'TTD', so one account read two rows and
   * the balance sheet's business-currency sheet dropped the legacy one. The
   * groups are folded by normalizeCurrency (the door's own rule), and the
   * business currency is normalized too (a business stored as 'ttd' reads
   * TTD). Nothing is rewritten in storage: the readers normalize on read.
   */
  async getTrialBalance(businessId: string, asOf?: Date): Promise<AccountBalance[]> {
    const where: Prisma.LedgerEntryWhereInput = { businessId };
    if (asOf) where.date = { lte: asOf };

    const [grouped, allAccounts, business] = await Promise.all([
      this.prisma.client.ledgerEntry.groupBy({
        by: ['accountId', 'currency'],
        where,
        _sum: { debit: true, credit: true },
      }),
      this.prisma.client.chartOfAccount.findMany({
        where: { businessId, isActive: true },
        select: { id: true, name: true, type: true, systemKey: true },
      }),
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
    ]);
    const businessCurrency = normalizeCurrency(business?.currency) || 'TTD';

    // (account, normalized currency) -> summed debit and credit.
    type Sum = { currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal };
    const byId = new Map<string, Map<string, Sum>>();
    for (const g of grouped) {
      const code = normalizeCurrency(g.currency) || businessCurrency;
      const perAccount = byId.get(g.accountId) ?? new Map<string, Sum>();
      const sum = perAccount.get(code) ?? { currency: code, debit: ZERO, credit: ZERO };
      sum.debit = sum.debit.add(new D(((g._sum.debit as Prisma.Decimal | null) ?? ZERO).toString()));
      sum.credit = sum.credit.add(new D(((g._sum.credit as Prisma.Decimal | null) ?? ZERO).toString()));
      perAccount.set(code, sum);
      byId.set(g.accountId, perAccount);
    }

    return allAccounts
      .flatMap((account): AccountBalance[] => {
        const groups = [...(byId.get(account.id)?.values() ?? [])];
        const sums = groups.length > 0 ? groups : [{ currency: businessCurrency, debit: ZERO, credit: ZERO }];
        return sums.map((g) => {
          const { debit, credit } = g;
          return {
            accountId: account.id,
            systemKey: account.systemKey ?? null,
            name: account.name,
            type: account.type,
            currency: g.currency,
            debit,
            credit,
            net: debit.sub(credit),
          };
        });
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));
  }

  /**
   * General ledger detail view — chronological ledger rows with running balance.
   * Paginated; default page size 100.
   *
   * V1-66 (SWP-FIN-LEDGER, BUG-029): the end of the range is `to` (a
   * timestamp: lines dated at or before it) or `toDay` (a date-only day,
   * YYYY-MM-DD: every line of that day in the business's timezone, that is
   * dated before the next day starts there). A date-only end was read as
   * midnight UTC with `<=`, which dropped the day after its first instant.
   * `toDay` wins when both are given. `from` is unchanged (`>=` the instant).
   */
  async getGeneralLedger(
    businessId: string,
    opts: {
      accountId?: string;
      from?: Date;
      /** A date-only start day (YYYY-MM-DD), starting at local 00:00 in the business's timezone. */
      fromDay?: string;
      to?: Date;
      /** A date-only end day (YYYY-MM-DD), covered whole in the business's timezone. */
      toDay?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{ rows: GeneralLedgerRow[]; total: number; page: number; pageSize: number }> {
    const rawPage = opts.page ?? 1;
    if (!Number.isInteger(rawPage) || rawPage < 1 || rawPage > MAX_GENERAL_LEDGER_PAGE) {
      throw new BadRequestException('Invalid page');
    }
    const rawPageSize = opts.pageSize ?? 100;
    if (!Number.isInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > MAX_GENERAL_LEDGER_PAGE_SIZE) {
      throw new BadRequestException('Invalid pageSize');
    }
    if (opts.from !== undefined && opts.fromDay === undefined && !isValidPostgresTimestamp(opts.from)) {
      throw new BadRequestException('Invalid from date');
    }
    if (opts.to !== undefined && opts.toDay === undefined && !isValidPostgresTimestamp(opts.to)) {
      throw new BadRequestException('Invalid to date');
    }
    const page = rawPage;
    const pageSize = rawPageSize;

    const where: Prisma.LedgerEntryWhereInput = { businessId };
    if (opts.accountId) where.accountId = opts.accountId;
    if (opts.from || opts.fromDay !== undefined || opts.to || opts.toDay !== undefined) {
      const date: Prisma.DateTimeFilter = {};
      const business =
        opts.fromDay !== undefined || opts.toDay !== undefined
          ? await this.prisma.client.business.findUnique({
              where: { id: businessId },
              select: { timezone: true },
            })
          : null;

      if (opts.fromDay !== undefined) {
        date.gte = beginOfZonedDay(opts.fromDay, business?.timezone);
      } else if (opts.from) {
        date.gte = opts.from;
      }

      if (opts.toDay !== undefined) {
        const end = endOfZonedDay(opts.toDay, business?.timezone);
        // Review N-1: the end of the last days of year 9999 is an instant in
        // year 10000, which the database cannot hold: nothing is dated past
        // the last instant it can, so the range ends there.
        if (end.getTime() > MAX_INSTANT_MS) date.lte = new Date(MAX_INSTANT_MS);
        else date.lt = end;
      } else if (opts.to) {
        date.lte = opts.to;
      }
      where.date = date;
    }

    const total = await this.prisma.client.ledgerEntry.count({ where });

    const entries = await this.prisma.client.ledgerEntry.findMany({
      where,
      // id last: the lines of one posting share date and createdAt, and a
      // tie left to Postgres can repeat or drop a line across pages (C-1).
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        account: { select: { id: true, name: true, code: true, type: true } },
        transaction: { select: { id: true, description: true, reference: true, sourceType: true, sourceId: true } },
      },
    });

    // Running balance per account AND currency (V1-66 review C-4; D-13, as the
    // trial balance: two currencies are never added into one figure). Each
    // row says its currency, so its balance is in that currency.
    const running = new Map<string, Prisma.Decimal>();
    const runningKey = (e: { accountId: string; currency: string | null }) => `${e.accountId}:${normalizeCurrency(e.currency)}`;

    // For page > 1 the balance carries on from the lines of the earlier pages:
    // the same range in the same order, so a line's balance is the one it has
    // when the whole range is on one page (page 1 starts from zero). Review
    // B-1: page N started from the lines dated before `from` (none without
    // `from`) and left out pages 1 to N-1.
    //
    // Review S-1: the opening sums are taken in the database, one per
    // (account, currency), over the lines of the range that come before this
    // page's first line in the (date, createdAt, id) order: no earlier line is
    // loaded into the server. A page past the end shows no row and reads
    // nothing to seed.
    if (page > 1 && entries.length > 0) {
      const first = entries[0];
      const sums = await this.prisma.client.ledgerEntry.groupBy({
        by: ['accountId', 'currency'],
        where: {
          AND: [
            where,
            {
              OR: [
                { date: { lt: first.date } },
                { date: first.date, createdAt: { lt: first.createdAt } },
                { date: first.date, createdAt: first.createdAt, id: { lt: first.id } },
              ],
            },
          ],
        },
        _sum: { debit: true, credit: true },
      });
      for (const s of sums) {
        const net = new D((s._sum.debit ?? ZERO).toString()).sub(new D((s._sum.credit ?? ZERO).toString()));
        running.set(runningKey(s), (running.get(runningKey(s)) ?? ZERO).add(net));
      }
    }

    const rows: GeneralLedgerRow[] = entries.map((e): GeneralLedgerRow => {
      const accountRunning = running.get(runningKey(e)) ?? ZERO;
      const nextBalance = accountRunning.add(new D(e.debit.toString())).sub(new D(e.credit.toString()));
      running.set(runningKey(e), nextBalance);
      return {
        entryId: e.id,
        transactionId: e.transactionId,
        date: e.date,
        accountId: e.accountId,
        accountName: e.account.name,
        accountCode: e.account.code ?? null,
        accountType: e.account.type,
        currency: normalizeCurrency(e.currency),
        debit: new D(e.debit.toString()),
        credit: new D(e.credit.toString()),
        memo: e.memo,
        description: e.transaction.description,
        reference: e.transaction.reference,
        sourceType: e.transaction.sourceType,
        sourceId: e.transaction.sourceId,
        runningBalance: nextBalance,
      };
    });

    return { rows, total, page, pageSize };
  }
}

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { invalidateBusinessFinancialSnapshotCache } from './finance-accounting.util';
import { FinancialAccountSeederService } from './financial-account-seeder.service';
import { FinanceAuditService } from './finance-audit.service';
import { PostingService, normalizeCurrency, type PostingEntryInput, type PostingResult } from './posting.service';
import { CASH_POSITION_ACCOUNT_TYPES, CASH_POSITION_SYSTEM_KEYS, OPENING_BALANCE_POSTING } from './cash-position.service';

const ALLOWED_TYPES = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR', 'CREDIT_CARD', 'LOAN', 'EQUITY', 'TAX', 'OTHER']);

const D = Prisma.Decimal;

/**
 * The idempotency kind of an account's opening posting: with sourceType
 * 'FinancialAccount' and sourceId the account id, the door keys it
 * `FinancialAccount:<id>:opening_balance`, so it is posted once.
 */
const OPENING_BALANCE_KIND = 'opening_balance';

/** Transaction statuses that are in the books (as CashPositionService reads them). */
const BOOKED_TRANSACTION_STATUSES = ['POSTED', 'REVERSED'];

/**
 * V1-37b review RV37b-CR-01: the currency create stored, before V1-37b,
 * whenever the caller named none (`input.currency ?? 'TTD'`); the Books >
 * Accounts forms never name one. On a business that keeps another currency a
 * legacy row holding it is read as that default, not as a choice.
 */
const LEGACY_DEFAULT_ACCOUNT_CURRENCY = 'TTD';

export interface CreateAccountInput {
  name: string;
  type: string;
  subtype?: string | null;
  currency?: string | null;
  openingBalance?: number | null;
  institution?: string | null;
  accountLast4?: string | null;
  isDefault?: boolean | null;
  chartOfAccountId?: string | null;
}

export type UpdateAccountInput = Partial<CreateAccountInput> & { isActive?: boolean };

/** What backfillOpeningBalances did, per account. */
export interface OpeningBalanceBackfillResult {
  posted: Array<{
    financialAccountId: string;
    name: string;
    transactionId: string;
    amount: string;
    /** The currency the opening was posted in. */
    currency: string;
    /** The account was archived: the V1-34 bridge never counted its opening, so the cash moves by it. */
    archived: boolean;
    /** Set when the row held the pre-V1-37b literal default and was corrected to `currency`. */
    currencyCorrectedFrom?: string;
  }>;
  /** Accounts with an opening that was not posted, each with why. */
  skipped: Array<{ financialAccountId: string; name: string; reason: string }>;
}

type OpeningAccount = {
  id: string;
  name: string;
  type: string;
  chartOfAccountId: string;
  currency: string;
  openingBalance: Prisma.Decimal | number | string | null;
  createdAt: Date;
};

/** An opening that stays on the account row, with why (nothing is posted). */
type OpeningNotPosted = { notPosted: string };

/**
 * FIN5 — CRUD over FinancialAccount (Cash/Bank/Credit Card/etc).
 * The ChartOfAccount link is required by the schema, so when omitted the
 * service resolves the appropriate system COA bucket for the type.
 *
 * V1-37b (V1-34 review CR-34-01): an account's opening balance reaches the
 * ledger through the V1-15 door (PostingService). create wrote it on the row
 * only (openingBalance and currentBalance) and posted nothing, so the ledger
 * (and the trial balance, the balance sheet and the cockpit cash) never saw
 * it; CashPositionService bridged such an unposted opening into the cash.
 * create now writes the row and posts its opening in one transaction (a
 * refused posting writes no account), and backfillOpeningBalances posts the
 * openings of accounts created before, explicitly and idempotently. Either
 * way the posting is an OPENING_BALANCE sourced from the account
 * (OPENING_BALANCE_POSTING), keyed once per account, dated at the account,
 * in the account currency, against OWNER_EQUITY: an asset row (cash, bank,
 * processor) is debited, a liability row (card, loan, tax) is credited, and
 * a negative opening reverses the sides. An account linked to any other kind
 * of chart row carries no opening posting.
 *
 * V1-37b review repairs: an opening is posted only where the account's type
 * and its chart row agree on whether it is cash (RV37b-CR-02: an OTHER
 * account resolves to the CASH row by default, and V1-34 never counted an
 * OTHER opening as cash); the backfill posts archived accounts' openings too
 * (RV37b-CR-04: archiving moves no money, as for an account create posted)
 * and reads a legacy row's literal 'TTD' default as the business currency
 * (RV37b-CR-01); every create and every backfilled opening writes a finance
 * audit row naming the member (SEC-V37b-2).
 */
@Injectable()
export class FinanceAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinancialAccountSeederService) private readonly accountSeeder: FinancialAccountSeederService,
    @Inject(ChartOfAccountsSeederService) private readonly coaSeeder: ChartOfAccountsSeederService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(FinanceAuditService) private readonly audit: FinanceAuditService,
  ) {}

  async list(businessId: string) {
    await this.accountSeeder.ensureDefaults(businessId);
    return this.prisma.client.financialAccount.findMany({
      where: { businessId },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { type: 'asc' }, { name: 'asc' }],
    });
  }

  private coaSystemKeyForType(type: string): string {
    switch (type) {
      case 'CASH': return 'CASH';
      case 'BANK': return 'BANK';
      case 'PAYMENT_PROCESSOR': return 'PAYMENT_PROCESSOR';
      case 'CREDIT_CARD': return 'CREDIT_CARD';
      case 'LOAN': return 'LOAN_PAYABLE';
      case 'EQUITY': return 'OWNER_EQUITY';
      case 'TAX': return 'TAX_PAYABLE';
      default: return 'CASH';
    }
  }

  async create(businessId: string, input: CreateAccountInput, opts: { userId?: string | null } = {}) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Account name is required');
    if (!ALLOWED_TYPES.has(input.type)) {
      throw new BadRequestException(`Unknown account type: ${input.type}`);
    }
    let coaId = input.chartOfAccountId ?? null;
    if (!coaId) {
      const coa = await this.coaSeeder.getBySystemKey(businessId, this.coaSystemKeyForType(input.type));
      if (!coa) throw new BadRequestException('Could not resolve chart-of-account for this type');
      coaId = coa.id;
    }
    const opening = Number(input.openingBalance ?? 0);
    if (!Number.isFinite(opening)) throw new BadRequestException('Opening balance must be a number');
    // The opening's other side; resolved (and seeded if need be) before the transaction.
    const equity = opening !== 0 ? await this.ownerEquity(businessId) : null;
    const chartOfAccountId = coaId;

    const userId = opts.userId ?? null;
    const { account, openingPosting: posted } = await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // D-13: an account names its currency or keeps the business's (it was the literal 'TTD').
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { currency: true } });
      const currency = normalizeCurrency(input.currency) || normalizeCurrency(business?.currency) || 'TTD';
      const created = await tx.financialAccount.create({
        data: {
          businessId,
          chartOfAccountId,
          name,
          type: input.type,
          subtype: input.subtype ?? null,
          currency,
          openingBalance: opening,
          currentBalance: opening,
          institution: input.institution ?? null,
          accountLast4: input.accountLast4 ?? null,
          isDefault: input.isDefault ?? false,
          isActive: true,
        },
      });
      // Posted through the door in this transaction: a refusal (400 currency or
      // foreign chart row) writes no account. An opening on a chart row that is
      // neither an asset nor a liability, or whose cash reading disagrees with
      // the account type, stays on the row only, as before.
      const openingPosting = equity
        ? await this.postOpening(tx, businessId, created, created.currency, equity.id, userId)
        : null;
      return { account: created, openingPosting };
    });

    // SEC-V37b-2: a create can write the ledger (an opening against owner
    // equity), so it is audited with its author, beside createdById.
    const openingPosted = posted && !('notPosted' in posted) ? posted : null;
    await this.audit.log({
      businessId,
      userId,
      action: 'ACCOUNT_CREATED',
      entityType: 'FinancialAccount',
      entityId: account.id,
      title: `Account created: ${account.name}`,
      detail: openingPosted
        ? `Opening balance ${account.currency} ${new D(String(account.openingBalance)).toString()} posted against owner equity`
        : null,
      meta: {
        type: account.type,
        chartOfAccountId: account.chartOfAccountId,
        currency: account.currency,
        openingBalance: new D(String(account.openingBalance)).toString(),
        openingTransactionId: openingPosted?.transactionId ?? null,
        ...(posted && 'notPosted' in posted ? { openingNotPosted: posted.notPosted } : {}),
      },
    });
    // PR195-PORT: an account's (unposted) opening is part of the ledger cash KEY reads.
    invalidateBusinessFinancialSnapshotCache(businessId);
    return account;
  }

  /**
   * V1-37b (V1-34 review CR-34-01): post the opening balance of every account
   * of the business created before create posted it. Explicit (nothing calls
   * it implicitly) and idempotent: an account whose opening is already booked
   * (an OPENING_BALANCE posting sourced from it, as CashPositionService reads
   * it) is left alone, and the posting key is the one create uses, so a second
   * run posts nothing. Each opening is posted in its own transaction, dated at
   * the account's creation, and audited (TRANSACTION_POSTED, naming who ran
   * the backfill). An opening the door refuses (a currency D-13 does not
   * support, a date inside a CLOSED period, a chart row of another business)
   * is skipped, and so is one that create would not post either (a chart row
   * that is neither an asset nor a liability, or an account type and chart row
   * that disagree on whether it is cash). Every skip is reported with its
   * reason.
   *
   * Review RV37b-CR-04: an archived account's opening is posted too, and
   * reported `archived`. Archiving moves no money: an account created (and its
   * opening posted) then archived keeps its opening in the books, and so must
   * one created before. The V1-34 bridge dropped an archived account's opening
   * while the ledger kept every movement on it, so a till spent down and then
   * archived read short by its opening; posting the opening makes it net to
   * zero. The cash therefore moves by the archived openings, and only by them.
   *
   * Review RV37b-CR-01: before V1-37b create stored the literal 'TTD' whenever
   * no currency was sent, and the Books forms send none. So a row of a
   * business that keeps another currency holding 'TTD' is read as that
   * default: its opening is posted in the business currency and the row's
   * currency is corrected in the same transaction (reported as
   * `currencyCorrectedFrom`, and audited). Any other stored currency is the
   * account's own and is kept.
   */
  async backfillOpeningBalances(businessId: string, opts: { userId?: string | null } = {}): Promise<OpeningBalanceBackfillResult> {
    const result: OpeningBalanceBackfillResult = { posted: [], skipped: [] };
    const userId = opts.userId ?? null;
    const accounts = await this.prisma.client.financialAccount.findMany({
      where: { businessId, openingBalance: { not: 0 } },
      select: { id: true, name: true, type: true, chartOfAccountId: true, currency: true, openingBalance: true, createdAt: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (accounts.length === 0) return result;

    const booked = await this.prisma.client.financialTransaction.findMany({
      where: {
        businessId,
        type: OPENING_BALANCE_POSTING.type,
        sourceType: OPENING_BALANCE_POSTING.sourceType,
        sourceId: { in: accounts.map((a) => a.id) },
        status: { in: BOOKED_TRANSACTION_STATUSES },
      },
      select: { sourceId: true },
    });
    const bookedIds = new Set(booked.map((t) => t.sourceId));
    const pending = accounts.filter((a) => !bookedIds.has(a.id));
    if (pending.length === 0) return result;

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } });
    const businessCurrency = normalizeCurrency(business?.currency) || LEGACY_DEFAULT_ACCOUNT_CURRENCY;
    const equity = await this.ownerEquity(businessId);
    for (const account of pending) {
      const stored = normalizeCurrency(account.currency);
      // RV37b-CR-01: the pre-V1-37b literal default on a business that keeps another currency.
      const legacyDefault = stored === LEGACY_DEFAULT_ACCOUNT_CURRENCY && businessCurrency !== LEGACY_DEFAULT_ACCOUNT_CURRENCY;
      const currency = legacyDefault ? businessCurrency : stored || businessCurrency;
      let posted: PostingResult | OpeningNotPosted;
      try {
        posted = await this.prisma.client.$transaction(async (rawTx) => {
          const tx = rawTx as unknown as Prisma.TransactionClient;
          const outcome = await this.postOpening(tx, businessId, account, currency, equity.id, userId);
          if (legacyDefault && !('notPosted' in outcome) && !outcome.alreadyPosted) {
            // The row names the currency its opening was posted in (bank rules post in it too).
            await tx.financialAccount.updateMany({ where: { id: account.id, businessId }, data: { currency } });
          }
          return outcome;
        });
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof ConflictException) {
          result.skipped.push({ financialAccountId: account.id, name: account.name, reason: err.message });
          continue;
        }
        throw err;
      }
      if ('notPosted' in posted) {
        result.skipped.push({ financialAccountId: account.id, name: account.name, reason: posted.notPosted });
      } else if (posted.alreadyPosted) {
        // Its key is taken by an opening posting that is not booked (e.g. VOID): never post it twice.
        result.skipped.push({ financialAccountId: account.id, name: account.name, reason: 'An opening posting for this account already exists and is not booked' });
      } else {
        const entry: OpeningBalanceBackfillResult['posted'][number] = {
          financialAccountId: account.id,
          name: account.name,
          transactionId: posted.transactionId,
          amount: new D(String(account.openingBalance ?? 0)).toString(),
          currency,
          archived: !account.isActive,
          ...(legacyDefault ? { currencyCorrectedFrom: account.currency } : {}),
        };
        result.posted.push(entry);
        await this.audit.log({
          businessId,
          userId,
          action: 'TRANSACTION_POSTED',
          entityType: 'FinancialAccount',
          entityId: account.id,
          title: `Opening balance posted (backfill): ${account.name}`,
          detail: `Opening balance ${currency} ${entry.amount} posted against owner equity`
            + (entry.archived ? '; the account is archived' : '')
            + (legacyDefault ? `; the account currency was corrected from ${account.currency} (the pre-V1-37b default)` : ''),
          meta: {
            kind: OPENING_BALANCE_KIND,
            transactionId: entry.transactionId,
            amount: entry.amount,
            currency,
            archived: entry.archived,
            ...(legacyDefault ? { currencyCorrectedFrom: account.currency } : {}),
          },
        });
      }
    }
    return result;
  }

  /** The business's OWNER_EQUITY chart row (seeded if missing). */
  private async ownerEquity(businessId: string) {
    const equity = await this.coaSeeder.getBySystemKey(businessId, 'OWNER_EQUITY');
    if (!equity) throw new BadRequestException('Could not resolve the owner equity chart-of-account');
    return equity;
  }

  /**
   * Post `account`'s opening balance through the door inside `tx`, in
   * `currency`: DR an asset row / CR OWNER_EQUITY, or CR a liability row / DR
   * OWNER_EQUITY (sides reversed for a negative opening). The door checks the
   * currency (D-13), the period and that every chart row is this business's.
   *
   * Not posted (the opening stays on the row, with why) when the chart row is
   * neither an asset nor a liability, or when the account's type and its chart
   * row disagree on whether it is cash (review RV37b-CR-02): the cash position
   * reads the CASH / BANK / PAYMENT_PROCESSOR chart rows, while the V1-34
   * bridge counts the openings of CASH / BANK / PAYMENT_PROCESSOR typed
   * accounts. Where they disagree (an OTHER account on the CASH row it
   * resolves to by default; a cash-typed account on a non-cash row) posting
   * would move the cockpit's cash by an opening V1-34 never counted, or drop
   * one it did; so it is left where it is, and the bridge keeps reading it as
   * it always has.
   */
  private async postOpening(
    tx: Prisma.TransactionClient,
    businessId: string,
    account: OpeningAccount,
    currency: string,
    equityId: string,
    userId: string | null,
  ): Promise<PostingResult | OpeningNotPosted> {
    const opening = new D(String(account.openingBalance ?? 0));
    if (opening.isZero()) return { notPosted: 'The opening balance is zero' };
    const row = await tx.chartOfAccount.findFirst({
      where: { id: account.chartOfAccountId, businessId },
      select: { id: true, type: true, systemKey: true, name: true },
    });
    if (!row) {
      throw new BadRequestException(`The account's chart-of-account row ${account.chartOfAccountId} does not belong to this business`);
    }
    if (row.type !== 'ASSET' && row.type !== 'LIABILITY') {
      return { notPosted: 'The account is linked to a chart row that is neither an asset nor a liability' };
    }
    const rowIsCash = (CASH_POSITION_SYSTEM_KEYS as readonly string[]).includes(row.systemKey ?? '');
    const typeIsCash = (CASH_POSITION_ACCOUNT_TYPES as readonly string[]).includes(account.type);
    if (rowIsCash !== typeIsCash) {
      return {
        notPosted:
          `The account type ${account.type} and its chart row ${row.systemKey ?? row.name} disagree on whether it holds cash: `
          + 'its opening balance stays on the account row (posting it would move the cash position by an opening it does not count)',
      };
    }

    const amount = opening.abs();
    const memo = `Opening balance: ${account.name}`.slice(0, 255);
    // The row's normal side: an asset's balance is a debit, a liability's a credit.
    const debitRow = (row.type === 'ASSET') === opening.isPositive();
    const entries: PostingEntryInput[] = debitRow
      ? [{ accountId: row.id, debit: amount, memo }, { accountId: equityId, credit: amount, memo }]
      : [{ accountId: equityId, debit: amount, memo }, { accountId: row.id, credit: amount, memo }];

    return this.posting.post(
      {
        businessId,
        type: OPENING_BALANCE_POSTING.type,
        date: account.createdAt,
        amount,
        currency,
        description: memo,
        sourceType: OPENING_BALANCE_POSTING.sourceType,
        sourceId: account.id,
        kind: OPENING_BALANCE_KIND,
        entries,
        createdById: userId,
      },
      tx,
    );
  }

  async update(businessId: string, id: string, input: UpdateAccountInput) {
    const existing = await this.prisma.client.financialAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');

    const data: Record<string, unknown> = {};
    if (input.name != null) data.name = input.name.trim();
    if (input.type != null) {
      if (!ALLOWED_TYPES.has(input.type)) throw new BadRequestException('Invalid type');
      data.type = input.type;
    }
    if (input.subtype !== undefined) data.subtype = input.subtype;
    if (input.currency != null) data.currency = input.currency;
    if (input.institution !== undefined) data.institution = input.institution;
    if (input.accountLast4 !== undefined) data.accountLast4 = input.accountLast4;
    if (input.isDefault != null) data.isDefault = input.isDefault;
    if (input.isActive != null) data.isActive = input.isActive;
    if (input.chartOfAccountId != null) data.chartOfAccountId = input.chartOfAccountId;

    const updated = await this.prisma.client.financialAccount.update({ where: { id }, data });
    invalidateBusinessFinancialSnapshotCache(businessId); // PR195-PORT
    return updated;
  }

  async archive(businessId: string, id: string) {
    const existing = await this.prisma.client.financialAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    // Soft archive — never hard-delete since LedgerEntry rows reference it.
    const archived = await this.prisma.client.financialAccount.update({
      where: { id },
      data: { isActive: false },
    });
    invalidateBusinessFinancialSnapshotCache(businessId); // PR195-PORT
    return archived;
  }
}

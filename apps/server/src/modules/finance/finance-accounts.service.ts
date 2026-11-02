import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { FinancialAccountSeederService } from './financial-account-seeder.service';
import { PostingService, normalizeCurrency, type PostingEntryInput, type PostingResult } from './posting.service';
import { OPENING_BALANCE_POSTING } from './cash-position.service';

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
  posted: Array<{ financialAccountId: string; name: string; transactionId: string; amount: string; currency: string }>;
  /** Accounts with an opening that was not posted, each with why. */
  skipped: Array<{ financialAccountId: string; name: string; reason: string }>;
}

type OpeningAccount = {
  id: string;
  name: string;
  chartOfAccountId: string;
  currency: string;
  openingBalance: Prisma.Decimal | number | string | null;
  createdAt: Date;
};

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
 */
@Injectable()
export class FinanceAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinancialAccountSeederService) private readonly accountSeeder: FinancialAccountSeederService,
    @Inject(ChartOfAccountsSeederService) private readonly coaSeeder: ChartOfAccountsSeederService,
    @Inject(PostingService) private readonly posting: PostingService,
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

    return this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // D-13: an account names its currency or keeps the business's (it was the literal 'TTD').
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { currency: true } });
      const currency = normalizeCurrency(input.currency) || normalizeCurrency(business?.currency) || 'TTD';
      const account = await tx.financialAccount.create({
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
      // neither an asset nor a liability stays on the row only, as before.
      if (equity) await this.postOpening(tx, businessId, account, equity.id, opts.userId ?? null);
      return account;
    });
  }

  /**
   * V1-37b (V1-34 review CR-34-01): post the opening balance of every account
   * of the business created before create posted it. Explicit (nothing calls
   * it implicitly) and idempotent: an account whose opening is already booked
   * (an OPENING_BALANCE posting sourced from it, as CashPositionService reads
   * it) is left alone, and the posting key is the one create uses, so a second
   * run posts nothing. Each opening is posted in its own transaction, dated at
   * the account's creation. An archived account is skipped (the cash position
   * never bridged it, so posting it would move the cockpit's cash); so is one
   * the door refuses (a currency D-13 does not support, a date inside a CLOSED
   * period, a chart row of another business) or whose chart row is neither an
   * asset nor a liability. Every skip is reported with its reason.
   */
  async backfillOpeningBalances(businessId: string, opts: { userId?: string | null } = {}): Promise<OpeningBalanceBackfillResult> {
    const result: OpeningBalanceBackfillResult = { posted: [], skipped: [] };
    const accounts = await this.prisma.client.financialAccount.findMany({
      where: { businessId, openingBalance: { not: 0 } },
      select: { id: true, name: true, chartOfAccountId: true, currency: true, openingBalance: true, createdAt: true, isActive: true },
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

    const equity = await this.ownerEquity(businessId);
    for (const account of pending) {
      if (!account.isActive) {
        result.skipped.push({ financialAccountId: account.id, name: account.name, reason: 'The account is archived: its opening balance is not posted' });
        continue;
      }
      let posted: PostingResult | 'NOT_POSTABLE';
      try {
        posted = await this.prisma.client.$transaction(async (rawTx) =>
          this.postOpening(rawTx as unknown as Prisma.TransactionClient, businessId, account, equity.id, opts.userId ?? null),
        );
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof ConflictException) {
          result.skipped.push({ financialAccountId: account.id, name: account.name, reason: err.message });
          continue;
        }
        throw err;
      }
      if (posted === 'NOT_POSTABLE') {
        result.skipped.push({ financialAccountId: account.id, name: account.name, reason: 'The account is linked to a chart row that is neither an asset nor a liability' });
      } else if (posted.alreadyPosted) {
        // Its key is taken by an opening posting that is not booked (e.g. VOID): never post it twice.
        result.skipped.push({ financialAccountId: account.id, name: account.name, reason: 'An opening posting for this account already exists and is not booked' });
      } else {
        result.posted.push({
          financialAccountId: account.id,
          name: account.name,
          transactionId: posted.transactionId,
          amount: new D(String(account.openingBalance ?? 0)).toString(),
          currency: account.currency,
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
   * Post `account`'s opening balance through the door inside `tx`: DR an asset
   * row / CR OWNER_EQUITY, or CR a liability row / DR OWNER_EQUITY (sides
   * reversed for a negative opening). 'NOT_POSTABLE' when the account's chart
   * row is neither. The door checks the currency (D-13), the period and that
   * every chart row is this business's.
   */
  private async postOpening(
    tx: Prisma.TransactionClient,
    businessId: string,
    account: OpeningAccount,
    equityId: string,
    userId: string | null,
  ): Promise<PostingResult | 'NOT_POSTABLE'> {
    const opening = new D(String(account.openingBalance ?? 0));
    if (opening.isZero()) return 'NOT_POSTABLE';
    const row = await tx.chartOfAccount.findFirst({
      where: { id: account.chartOfAccountId, businessId },
      select: { id: true, type: true },
    });
    if (!row) {
      throw new BadRequestException(`The account's chart-of-account row ${account.chartOfAccountId} does not belong to this business`);
    }
    if (row.type !== 'ASSET' && row.type !== 'LIABILITY') return 'NOT_POSTABLE';

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
        currency: account.currency,
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

    return this.prisma.client.financialAccount.update({ where: { id }, data });
  }

  async archive(businessId: string, id: string) {
    const existing = await this.prisma.client.financialAccount.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Account not found');
    // Soft archive — never hard-delete since LedgerEntry rows reference it.
    return this.prisma.client.financialAccount.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

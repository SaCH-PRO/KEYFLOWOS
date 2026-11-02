import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import type { BankRule as BankRuleModel } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService, type PostingResult } from './posting.service';
import { FinanceAuditService } from './finance-audit.service';

const D = Prisma.Decimal;

export type BankRuleMatchType = 'contains' | 'starts_with' | 'equals' | 'regex';

export interface CreateBankRuleInput {
  name: string;
  priority?: number;
  pattern: string;
  matchType?: BankRuleMatchType;
  accountId: string;
  expenseCategoryId?: string | null;
  isActive?: boolean;
}

export interface UpdateBankRuleInput {
  name?: string;
  priority?: number;
  pattern?: string;
  matchType?: BankRuleMatchType;
  accountId?: string;
  expenseCategoryId?: string | null;
  isActive?: boolean;
}

export interface ApplyRulesSkip {
  bankTransactionId: string;
  ruleId: string;
  /** Why the matched rule was not applied; the row stays UNMATCHED. */
  reason: string;
}

export interface ApplyRulesResult {
  scanned: number;
  matched: number;
  createdTransactions: number;
  /** Rows a rule matched but could not post (e.g. dated inside a CLOSED accounting period). */
  skipped: ApplyRulesSkip[];
}

/**
 * FIN6 extension — user-defined pattern rules for auto-categorizing imported
 * bank transactions. When a bank row matches a rule, the service optionally
 * creates a categorized ledger transaction and links the bank row to it.
 */
@Injectable()
export class BankRuleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(FinanceAuditService) private readonly audit: FinanceAuditService,
  ) {}

  async list(businessId: string) {
    return this.prisma.client.bankRule.findMany({
      where: { businessId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: { account: { select: { id: true, name: true, code: true, type: true } }, expenseCategory: { select: { id: true, name: true } } },
    });
  }

  async get(businessId: string, id: string) {
    const rule = await this.prisma.client.bankRule.findFirst({
      where: { id, businessId },
      include: { account: { select: { id: true, name: true, code: true, type: true } }, expenseCategory: { select: { id: true, name: true } } },
    });
    if (!rule) throw new NotFoundException('Bank rule not found');
    return rule;
  }

  async create(businessId: string, input: CreateBankRuleInput) {
    await this.validateAccount(businessId, input.accountId);
    if (input.expenseCategoryId) {
      await this.validateExpenseCategory(businessId, input.expenseCategoryId);
    }
    return this.prisma.client.bankRule.create({
      data: {
        businessId,
        name: input.name,
        priority: input.priority ?? 0,
        pattern: input.pattern,
        matchType: input.matchType ?? 'contains',
        accountId: input.accountId,
        expenseCategoryId: input.expenseCategoryId ?? null,
        isActive: input.isActive ?? true,
      },
      include: { account: { select: { id: true, name: true, code: true, type: true } }, expenseCategory: { select: { id: true, name: true } } },
    });
  }

  async update(businessId: string, id: string, input: UpdateBankRuleInput) {
    const existing = await this.get(businessId, id);
    if (input.accountId && input.accountId !== existing.accountId) {
      await this.validateAccount(businessId, input.accountId);
    }
    if (input.expenseCategoryId && input.expenseCategoryId !== existing.expenseCategoryId) {
      await this.validateExpenseCategory(businessId, input.expenseCategoryId);
    }
    return this.prisma.client.bankRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.pattern !== undefined && { pattern: input.pattern }),
        ...(input.matchType !== undefined && { matchType: input.matchType }),
        ...(input.accountId !== undefined && { accountId: input.accountId }),
        ...(input.expenseCategoryId !== undefined && { expenseCategoryId: input.expenseCategoryId }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
      include: { account: { select: { id: true, name: true, code: true, type: true } }, expenseCategory: { select: { id: true, name: true } } },
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.bankRule.delete({ where: { id } });
  }

  /**
   * Apply active bank rules to a set of UNMATCHED bank transactions.
   * For each match, creates a categorized FinancialTransaction and links
   * the bank row to it. Returns counts for telemetry.
   *
   * V1-15b (V1-15 review CR-3): each row's posting and its MATCHED link are
   * one transaction, keyed per row (`BankRule:<ruleId>:<bankTransactionId>`,
   * so two rows one rule matches each post once, and re-applying a row
   * re-links its own posting). A row the posting door refuses with 409
   * (dated inside a CLOSED accounting period) stays UNMATCHED: it is listed
   * in `skipped` with the reason and a finance audit row records it, and the
   * other rows are still applied, so a statement import never fails on it.
   */
  async applyRules(
    businessId: string,
    bankTransactionIds: string[],
    opts: { userId?: string | null } = {},
  ): Promise<ApplyRulesResult> {
    if (bankTransactionIds.length === 0) return { scanned: 0, matched: 0, createdTransactions: 0, skipped: [] };

    const rules = await this.prisma.client.bankRule.findMany({
      where: { businessId, isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    if (rules.length === 0) return { scanned: 0, matched: 0, createdTransactions: 0, skipped: [] };

    const bankRows = await this.prisma.client.bankTransaction.findMany({
      where: { id: { in: bankTransactionIds }, businessId, status: 'UNMATCHED' },
      include: { account: { select: { chartOfAccountId: true, currency: true } } },
    });

    let matched = 0;
    let createdTransactions = 0;
    const skipped: ApplyRulesSkip[] = [];

    for (const bank of bankRows) {
      const text = `${bank.description} ${bank.reference ?? ''}`.trim();
      const rule = this.findMatchingRule(text, rules);
      if (!rule) continue;

      // Build a categorized transaction. For withdrawals (negative amount) we
      // debit the expense account and credit the bank account. For deposits
      // (positive amount) we debit the bank account and credit the income account.
      const amount = new D(String(bank.amount)).abs();
      if (amount.eq(0)) continue;
      const isDeposit = new D(String(bank.amount)).gte(0);
      const bankCoaId = bank.account.chartOfAccountId;
      if (!bankCoaId) {
        console.warn(`[BankRule] Skipping bank transaction ${bank.id}: account has no chartOfAccountId`);
        skipped.push({ bankTransactionId: bank.id, ruleId: rule.id, reason: 'The bank account is not linked to a chart-of-account' });
        continue;
      }

      const entries = isDeposit
        ? [
            { accountId: bankCoaId, debit: amount, credit: new D(0), memo: `Rule: ${rule.name}` },
            { accountId: rule.accountId, debit: new D(0), credit: amount, memo: `Rule: ${rule.name}` },
          ]
        : [
            { accountId: rule.accountId, debit: amount, credit: new D(0), memo: `Rule: ${rule.name}` },
            { accountId: bankCoaId, debit: new D(0), credit: amount, memo: `Rule: ${rule.name}` },
          ];

      let txn: PostingResult;
      try {
        txn = await this.prisma.client.$transaction(async (rawTx) => {
          const tx = rawTx as unknown as Prisma.TransactionClient;
          const posted = await this.posting.post(
            {
              businessId,
              type: 'ADJUSTMENT',
              date: bank.date,
              amount: amount.toNumber(),
              currency: bank.account.currency,
              description: `${isDeposit ? 'Deposit' : 'Withdrawal'}: ${bank.description}`.slice(0, 255),
              reference: bank.reference ?? null,
              sourceType: 'BankRule',
              sourceId: rule.id,
              // One posting per bank row: the rule alone would key every row it matches the same.
              kind: bank.id,
              notes: `Auto-categorized by bank rule "${rule.name}"`,
              entries,
              createdById: opts.userId ?? null,
            },
            tx,
          );
          const linked = await tx.bankTransaction.updateMany({
            where: { id: bank.id, businessId, status: 'UNMATCHED' },
            data: { matchedTransactionId: posted.transactionId, status: 'MATCHED' },
          });
          if (linked.count !== 1) {
            throw new ConflictException(`Bank transaction ${bank.id} is no longer UNMATCHED`);
          }
          return posted;
        });
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        const reason = err.message;
        skipped.push({ bankTransactionId: bank.id, ruleId: rule.id, reason });
        await this.audit.log({
          businessId,
          userId: opts.userId ?? null,
          action: 'BANK_TRANSACTION_UNMATCHED',
          entityType: 'BankTransaction',
          entityId: bank.id,
          title: 'Bank rule not applied',
          detail: `Rule "${rule.name}" matched but was not applied: ${reason}`,
          meta: { ruleId: rule.id, ruleName: rule.name, reason },
        });
        continue;
      }

      if (!txn.alreadyPosted) createdTransactions += 1;

      await this.audit.log({
        businessId,
        userId: opts.userId ?? null,
        action: 'BANK_TRANSACTION_MATCHED',
        entityType: 'BankTransaction',
        entityId: bank.id,
        title: 'Bank transaction rule-matched',
        detail: `Matched by rule "${rule.name}"`,
        meta: { ruleId: rule.id, ruleName: rule.name, transactionId: txn.transactionId },
      });

      matched += 1;
    }

    return { scanned: bankRows.length, matched, createdTransactions, skipped };
  }

  /**
   * Apply rules to all UNMATCHED bank rows for an account. Used by the
   * auto-match pipeline before heuristic matching runs.
   */
  async applyRulesToAccount(
    businessId: string,
    accountId: string,
    opts: { sinceDate?: Date | null; untilDate?: Date | null; userId?: string | null } = {},
  ): Promise<ApplyRulesResult> {
    const where: Prisma.BankTransactionWhereInput = {
      businessId,
      accountId,
      status: 'UNMATCHED',
    };
    if (opts.sinceDate || opts.untilDate) {
      where.date = {};
      if (opts.sinceDate) (where.date as Prisma.DateTimeFilter).gte = opts.sinceDate;
      if (opts.untilDate) (where.date as Prisma.DateTimeFilter).lte = opts.untilDate;
    }
    const rows = await this.prisma.client.bankTransaction.findMany({ where, select: { id: true } });
    return this.applyRules(businessId, rows.map((r) => r.id), opts);
  }

  private findMatchingRule(text: string, rules: BankRuleModel[]): BankRuleModel | null {
    for (const rule of rules) {
      if (this.matches(text, rule.pattern, rule.matchType as BankRuleMatchType)) {
        return rule;
      }
    }
    return null;
  }

  private matches(text: string, pattern: string, matchType: BankRuleMatchType): boolean {
    const t = text.toLowerCase();
    const p = pattern.toLowerCase();
    switch (matchType) {
      case 'contains':
        return t.includes(p);
      case 'starts_with':
        return t.startsWith(p);
      case 'equals':
        return t === p;
      case 'regex':
        try {
          return new RegExp(pattern, 'i').test(text);
        } catch {
          return false;
        }
      default:
        return t.includes(p);
    }
  }

  private async validateAccount(businessId: string, accountId: string) {
    const acc = await this.prisma.client.chartOfAccount.findFirst({
      where: { id: accountId, businessId },
      select: { id: true },
    });
    if (!acc) throw new NotFoundException('Chart of account not found');
  }

  private async validateExpenseCategory(businessId: string, categoryId: string) {
    const cat = await this.prisma.client.expenseCategory.findFirst({
      where: { id: categoryId, businessId },
      select: { id: true },
    });
    if (!cat) throw new NotFoundException('Expense category not found');
  }
}

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinanceAuditService } from './finance-audit.service';

const D = Prisma.Decimal;

export interface ParsedBankRow {
  date: Date;
  description: string;
  amount: Prisma.Decimal;
  reference: string | null;
  raw: Record<string, string>;
}

export interface BankImportResult {
  accountId: string;
  parsed: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  errors: string[];
}

const COLUMN_ALIASES: Record<keyof ParsedBankRow, string[]> = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'value date'],
  description: ['description', 'narrative', 'details', 'memo', 'transaction', 'particulars'],
  amount: ['amount', 'value', 'transaction amount'],
  reference: ['reference', 'ref', 'reference number', 'check number', 'transaction id'],
  raw: [],
};

/** Find the first column whose header matches one of the aliases (case-insensitive). */
function pickHeader(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return headers[idx];
  }
  return null;
}

/** Parse a date string in common formats (ISO, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD). */
export function parseBankDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // ISO yyyy-mm-dd or yyyy-mm-ddThh:mm:ssZ
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  // dd/mm/yyyy or mm/dd/yyyy or dd-mm-yyyy — assume day-first (international/Trinidad).
  const m = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, dd, mm] = m;
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) >= 70 ? '19' : '20') + yy;
    const d = new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd)));
    return isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Parse a money column. Strips currency symbols, thousands separators,
 * and accepts trailing/leading minus signs and parentheses for negatives.
 * Banks vary wildly — we do not want a single bad column to torpedo the
 * import. Returns null when the cell is blank or unparseable.
 */
export function parseBankAmount(raw: string): Prisma.Decimal | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let sign = 1;
  let s = trimmed;
  if (s.startsWith('(') && s.endsWith(')')) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  // If there is a leading minus AND we already detected parentheses, the
  // signs cancel — that mirrors what users mean when they hand-type both.
  if (s.startsWith('-')) {
    sign *= -1;
    s = s.slice(1);
  }
  try {
    const n = new D(s);
    return sign === -1 ? n.negated() : n;
  } catch {
    return null;
  }
}

/**
 * FIN6 — Pure CSV parser. Exposed for unit tests so we can exercise every
 * column-detection / value-coercion branch without a database.
 */
export function parseBankCsv(content: string): { rows: ParsedBankRow[]; errors: string[] } {
  const errors: string[] = [];
  let records: Array<Record<string, string>>;
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;
  } catch (err: any) {
    throw new BadRequestException(`Could not parse CSV: ${(err as Error).message}`);
  }
  if (records.length === 0) return { rows: [], errors: ['CSV had no data rows'] };

  const headers = Object.keys(records[0]);
  const dateCol = pickHeader(headers, COLUMN_ALIASES.date);
  const descCol = pickHeader(headers, COLUMN_ALIASES.description);
  const amountCol = pickHeader(headers, COLUMN_ALIASES.amount);
  const refCol = pickHeader(headers, COLUMN_ALIASES.reference);

  // If there's no single Amount column, look for separate Debit/Credit
  // columns (very common in TT bank exports).
  const debitCol = !amountCol ? pickHeader(headers, ['debit', 'withdrawal', 'money out']) : null;
  const creditCol = !amountCol ? pickHeader(headers, ['credit', 'deposit', 'money in']) : null;

  if (!dateCol) throw new BadRequestException('CSV is missing a Date column');
  if (!descCol) throw new BadRequestException('CSV is missing a Description column');
  if (!amountCol && !(debitCol || creditCol)) {
    throw new BadRequestException('CSV is missing an Amount (or Debit/Credit) column');
  }

  const rows: ParsedBankRow[] = [];
  records.forEach((rec, idx) => {
    const date = parseBankDate(rec[dateCol] ?? '');
    if (!date) {
      errors.push(`Row ${idx + 2}: invalid date "${rec[dateCol]}"`);
      return;
    }
    let amount: Prisma.Decimal | null;
    if (amountCol) {
      amount = parseBankAmount(rec[amountCol] ?? '');
    } else {
      const dr = parseBankAmount(rec[debitCol!] ?? '');
      const cr = parseBankAmount(rec[creditCol!] ?? '');
      const drNum = dr ?? new D(0);
      const crNum = cr ?? new D(0);
      // Standard convention: credits add to the bank balance, debits subtract.
      amount = crNum.sub(drNum);
      if (amount.eq(0) && !dr && !cr) amount = null;
    }
    if (amount === null) {
      errors.push(`Row ${idx + 2}: invalid amount`);
      return;
    }
    const description = (rec[descCol] ?? '').trim() || '(no description)';
    const reference = refCol ? (rec[refCol] ?? '').trim() || null : null;
    rows.push({ date, description, amount, reference, raw: rec });
  });

  return { rows, errors };
}

/**
 * FIN6 — CSV bank-statement importer. Dedupes within the existing
 * `(accountId, date, amount, reference)` rows so re-uploading the same
 * file is a no-op, not a duplicate-row explosion.
 */
@Injectable()
export class BankImportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceAuditService) private readonly audit: FinanceAuditService,
  ) {}

  async importCsv(
    businessId: string,
    accountId: string,
    csvContent: string,
    opts: { userId?: string | null } = {},
  ): Promise<BankImportResult> {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: accountId, businessId },
      select: { id: true, currency: true },
    });
    if (!account) throw new NotFoundException('Bank account not found for this business');

    const { rows, errors } = parseBankCsv(csvContent);
    const result: BankImportResult = {
      accountId,
      parsed: rows.length,
      inserted: 0,
      duplicates: 0,
      invalid: errors.length,
      errors,
    };
    if (rows.length === 0) return result;

    // Pre-load existing rows in the date range so the dedupe check is one
    // round-trip rather than N. Bank statements usually cover < 1 year, so
    // this is bounded.
    const minDate = new Date(Math.min(...rows.map((r) => r.date.getTime())));
    const maxDate = new Date(Math.max(...rows.map((r) => r.date.getTime())));
    const existing = await this.prisma.client.bankTransaction.findMany({
      where: {
        businessId,
        accountId,
        date: { gte: minDate, lte: maxDate },
      },
      select: { date: true, amount: true, reference: true },
    });
    // Per FIN6 audit: dedupe key is (accountId, date, amount, reference) only.
    // Description is intentionally excluded so the same transaction with a
    // re-formatted memo (very common across bank exports) is recognised as a
    // duplicate, not a fresh row.
    const dedupeKey = (date: Date, amount: Prisma.Decimal | string | number, ref: string | null) =>
      `${date.toISOString().slice(0, 10)}|${new D(String(amount)).toFixed(4)}|${(ref ?? '').trim().toLowerCase()}`;
    const seen = new Set(existing.map((e) => dedupeKey(e.date, e.amount, e.reference)));

    const toCreate: Prisma.BankTransactionCreateManyInput[] = [];
    for (const r of rows) {
      const key = dedupeKey(r.date, r.amount, r.reference);
      if (seen.has(key)) {
        result.duplicates += 1;
        continue;
      }
      seen.add(key);
      toCreate.push({
        businessId,
        accountId,
        date: r.date,
        description: r.description,
        amount: r.amount,
        currency: account.currency,
        reference: r.reference,
        status: 'UNMATCHED',
        rawData: r.raw as Prisma.InputJsonValue,
      });
    }

    if (toCreate.length > 0) {
      const created = await this.prisma.client.bankTransaction.createMany({ data: toCreate });
      result.inserted = created.count;
    }

    await this.audit.log({
      businessId,
      userId: opts.userId ?? null,
      action: 'BANK_TRANSACTION_IMPORTED',
      entityType: 'FinancialAccount',
      entityId: accountId,
      title: `Imported ${result.inserted} bank transactions`,
      detail: `Parsed ${result.parsed}, inserted ${result.inserted}, duplicates ${result.duplicates}, invalid ${result.invalid}`,
      meta: { parsed: result.parsed, inserted: result.inserted, duplicates: result.duplicates, invalid: result.invalid },
    });
    return result;
  }
}

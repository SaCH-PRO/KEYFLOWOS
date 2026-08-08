import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinanceAuditService } from './finance-audit.service';
import {
  detectFormat,
  parseOfx,
  parseQif,
  parseMt940,
  type ParseOutcome,
  type ParsedStatementRow,
  type StatementFormat,
} from './bank-statement-parsers';

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
  /** Which parser handled the file. Absent on the legacy CSV-only path. */
  format?: StatementFormat;
  /**
   * True when the format carried a bank-assigned id for every row, so
   * duplicates were rejected on that rather than on (date, amount, reference).
   * A scheduled or email-driven import should only be trusted unattended when
   * this is true — see the note on `ingest`.
   */
  exactDedupe?: boolean;
}

/**
 * A remembered column mapping for one account's CSV exports.
 *
 * Stored on `FinancialAccount.metadata.importProfile`, so a user maps Republic
 * Bank's peculiar headers once and every later import — including an automated
 * one — needs no human. No migration: the column is already Json.
 */
export interface ImportProfile {
  date?: string;
  description?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;
  /** Free-text label so the UI can say "Republic Bank export" rather than a hash. */
  label?: string;
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
export function parseBankCsv(
  content: string,
  profile?: ImportProfile | null,
): { rows: ParsedBankRow[]; errors: string[] } {
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

  // A saved profile wins over guessing. Guessing is right most of the time and
  // "most of the time" is not good enough for an unattended import — a bank
  // that renames "Amount" to "Value (TTD)" would silently start failing, and
  // the whole point of the profile is that a human resolved that once.
  //
  // A profile naming a column the file does not have is a real error, not a
  // reason to fall back: falling back would hide that the export changed shape.
  const fromProfile = (key: keyof ImportProfile, aliases: string[]): string | null => {
    const named = profile?.[key];
    if (named) {
      if (headers.includes(named)) return named;
      errors.push(`Saved column mapping expects "${named}" and this file has no such column.`);
      return null;
    }
    return pickHeader(headers, aliases);
  };

  const dateCol = fromProfile('date', COLUMN_ALIASES.date);
  const descCol = fromProfile('description', COLUMN_ALIASES.description);
  const amountCol = fromProfile('amount', COLUMN_ALIASES.amount);
  const refCol = fromProfile('reference', COLUMN_ALIASES.reference);

  // If there's no single Amount column, look for separate Debit/Credit
  // columns (very common in TT bank exports).
  const debitCol = !amountCol ? fromProfile('debit', ['debit', 'withdrawal', 'money out']) : null;
  const creditCol = !amountCol ? fromProfile('credit', ['credit', 'deposit', 'money in']) : null;

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

  private readonly logger = new Logger(BankImportService.name);

  /**
   * The single ingestion entry point. HTTP upload, emailed attachment, a
   * scheduled pull and a KEY tool all come through here.
   *
   * Format is sniffed from the CONTENT, never the filename — banks emit OFX as
   * `.txt` and semicolon QIF as `.csv` often enough that trusting the extension
   * produces a confident wrong parse.
   *
   * On dedupe: when the format carries a bank-assigned id (OFX FITID, the MT940
   * :61: reference) we key on that, which is exact. Otherwise we fall back to
   * (date, amount, reference), which is a good heuristic and still a heuristic —
   * two identical card payments to the same shop on the same day with no
   * reference collapse into one. `result.exactDedupe` reports which happened,
   * so an unattended caller can decide whether to trust the run or flag it.
   */
  async ingest(
    businessId: string,
    accountId: string,
    content: string,
    opts: { userId?: string | null; source?: string } = {},
  ): Promise<BankImportResult> {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: accountId, businessId },
      select: { id: true, currency: true, metadata: true },
    });
    if (!account) throw new NotFoundException('Bank account not found for this business');

    const format = detectFormat(content);
    let outcome: ParseOutcome;

    if (format === 'ofx') outcome = parseOfx(content);
    else if (format === 'qif') outcome = parseQif(content);
    else if (format === 'mt940') outcome = parseMt940(content);
    else {
      const profile = (account.metadata as { importProfile?: ImportProfile } | null)?.importProfile ?? null;
      const csv = parseBankCsv(content, profile);
      outcome = {
        format: 'csv',
        rows: csv.rows.map((r) => ({ ...r, externalId: null })),
        errors: csv.errors,
        exactDedupe: false,
      };
    }

    return this.persist(businessId, account, outcome, opts);
  }

  /**
   * Remember how this account's CSV exports are laid out.
   *
   * Written to FinancialAccount.metadata rather than a new table: the column is
   * already Json, and a mapping is per-account configuration, not an entity.
   */
  async saveImportProfile(
    businessId: string,
    accountId: string,
    profile: ImportProfile,
  ): Promise<ImportProfile> {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: accountId, businessId },
      select: { id: true, metadata: true },
    });
    if (!account) throw new NotFoundException('Bank account not found for this business');

    const meta = (account.metadata as Record<string, unknown> | null) ?? {};
    await this.prisma.client.financialAccount.update({
      where: { id: account.id },
      data: { metadata: { ...meta, importProfile: profile } as unknown as Prisma.InputJsonValue },
    });
    return profile;
  }

  /** Shared dedupe + insert + audit, whatever produced the rows. */
  private async persist(
    businessId: string,
    account: { id: string; currency: string },
    outcome: ParseOutcome,
    opts: { userId?: string | null; source?: string },
  ): Promise<BankImportResult> {
    const accountId = account.id;
    const result: BankImportResult = {
      accountId,
      parsed: outcome.rows.length,
      inserted: 0,
      duplicates: 0,
      invalid: outcome.errors.length,
      errors: outcome.errors,
      format: outcome.format,
      exactDedupe: outcome.exactDedupe,
    };
    if (outcome.rows.length === 0) return result;

    const minDate = new Date(Math.min(...outcome.rows.map((r) => r.date.getTime())));
    const maxDate = new Date(Math.max(...outcome.rows.map((r) => r.date.getTime())));
    const existing = await this.prisma.client.bankTransaction.findMany({
      where: { businessId, accountId, date: { gte: minDate, lte: maxDate } },
      select: { date: true, amount: true, reference: true, rawData: true },
    });

    const heuristicKey = (date: Date, amount: Prisma.Decimal | string | number, ref: string | null) =>
      `${date.toISOString().slice(0, 10)}|${new D(String(amount)).toFixed(4)}|${(ref ?? '').trim().toLowerCase()}`;

    // Two independent sets. An external id is authoritative on its own; the
    // heuristic key is only consulted when the row has no id, so a statement
    // re-issued with reformatted memos still dedupes correctly.
    const seenExternal = new Set<string>();
    const seenHeuristic = new Set<string>();
    for (const e of existing) {
      const ext = (e.rawData as { externalId?: string } | null)?.externalId;
      if (ext) seenExternal.add(ext);
      seenHeuristic.add(heuristicKey(e.date, e.amount, e.reference));
    }

    const toCreate: Prisma.BankTransactionCreateManyInput[] = [];
    for (const r of outcome.rows) {
      if (r.externalId) {
        if (seenExternal.has(r.externalId)) { result.duplicates += 1; continue; }
        seenExternal.add(r.externalId);
      } else {
        const key = heuristicKey(r.date, r.amount, r.reference);
        if (seenHeuristic.has(key)) { result.duplicates += 1; continue; }
        seenHeuristic.add(key);
      }
      toCreate.push({
        businessId,
        accountId,
        date: r.date,
        description: r.description,
        amount: r.amount,
        currency: account.currency,
        reference: r.reference,
        status: 'UNMATCHED',
        rawData: {
          ...r.raw,
          ...(r.externalId ? { externalId: r.externalId } : {}),
        } as Prisma.InputJsonValue,
      });
    }

    if (toCreate.length > 0) {
      // skipDuplicates emits ON CONFLICT DO NOTHING, which is what turns the
      // partial unique index on (account_id, rawData->>'externalId') into a
      // dedupe mechanism rather than a 500. The in-memory pass above still does
      // the work in the common case; this is the backstop for the ingest that
      // interleaves — the 5am cron overlapping a manual sweep, or two accounts
      // pointed at the same Drive folder.
      const created = await this.prisma.client.bankTransaction.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      result.inserted = created.count;

      // Anything the database refused was a duplicate the in-memory pass could
      // not see. Count it as one rather than losing it: parsed must keep
      // equalling inserted + duplicates + invalid, or the report stops adding
      // up and a skipped duplicate reads the same as a dropped transaction.
      const refused = toCreate.length - created.count;
      if (refused > 0) {
        result.duplicates += refused;
        this.logger.log(
          `[import] ${refused} row(s) refused by the unique index — a concurrent import had already inserted them`,
        );
      }
    }

    await this.audit.log({
      businessId,
      userId: opts.userId ?? null,
      action: 'BANK_TRANSACTION_IMPORTED',
      entityType: 'FinancialAccount',
      entityId: accountId,
      title: `Imported ${result.inserted} bank transactions`,
      detail: `Format ${outcome.format} via ${opts.source ?? 'upload'} — parsed ${result.parsed}, inserted ${result.inserted}, duplicates ${result.duplicates}, invalid ${result.invalid}`,
      meta: {
        parsed: result.parsed, inserted: result.inserted, duplicates: result.duplicates,
        invalid: result.invalid, format: outcome.format, exactDedupe: outcome.exactDedupe,
        source: opts.source ?? 'upload',
      },
    });
    return result;
  }

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
      // skipDuplicates emits ON CONFLICT DO NOTHING, which is what turns the
      // partial unique index on (account_id, rawData->>'externalId') into a
      // dedupe mechanism rather than a 500. The in-memory pass above still does
      // the work in the common case; this is the backstop for the ingest that
      // interleaves — the 5am cron overlapping a manual sweep, or two accounts
      // pointed at the same Drive folder.
      const created = await this.prisma.client.bankTransaction.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      result.inserted = created.count;

      // Anything the database refused was a duplicate the in-memory pass could
      // not see. Count it as one rather than losing it: parsed must keep
      // equalling inserted + duplicates + invalid, or the report stops adding
      // up and a skipped duplicate reads the same as a dropped transaction.
      const refused = toCreate.length - created.count;
      if (refused > 0) {
        result.duplicates += refused;
        this.logger.log(
          `[import] ${refused} row(s) refused by the unique index — a concurrent import had already inserted them`,
        );
      }
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

/**
 * Automated ways a statement arrives.
 *
 * BankImportService.ingest() was the receiving end with nothing plugged into
 * it: the only way a statement reached it was a person uploading a file. This
 * is the plug.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not scan Drive and it does not talk to Gmail's transport. Both
 * already exist and are used elsewhere:
 *
 *   ConnectorIntelligenceService.scanDriveFiles  incremental sync, pagination,
 *     (ai/connector-intelligence.service.ts)     idempotency on file+mtime
 *   GmailService                                 OAuth, refresh, expiry skew,
 *     (commerce/gmail.service.ts)                and now search/read
 *
 * A second scanner would drift from the first and a second Gmail client would
 * drift from the token handling. This service decides *which account a file
 * belongs to* and hands it to ingest(); everything else is borrowed.
 *
 * CONFIG LIVES ON THE ACCOUNT
 * ---------------------------
 * FinancialAccount.metadata.statementSources, beside the importProfile that is
 * already there. No migration, and it keeps "how statements reach this account"
 * next to "how this account's columns are laid out".
 *
 * ROUTING IS EXPLICIT, NEVER INFERRED
 * -----------------------------------
 * A file is only ingested into an account whose configuration names the folder
 * or the mail query it came from. Guessing which account a statement belongs to
 * by reading an account number out of it would be a plausible feature and a bad
 * one: guessing wrong posts a whole month of transactions to the wrong ledger,
 * and reconciliation would then "succeed" against the wrong book.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { GmailService } from '../commerce/gmail.service';
import { BankImportService, type BankImportResult } from './bank-import.service';
import { detectFormat } from './bank-statement-parsers';

/** Where an account's statements come from, if anywhere. */
export interface StatementSources {
  /** A Google Drive folder id. Anything dropped in it is treated as a statement. */
  driveFolderId?: string;
  /**
   * A Gmail search string, exactly as typed into Gmail's own box —
   * `has:attachment from:republicbank.com`. A `newer_than:` clause is appended
   * automatically so a sweep never re-reads the whole mailbox.
   */
  gmailQuery?: string;
  /** Set by the sweeps so a re-run does not reprocess what it already saw. */
  lastSweptAt?: string;
}

export interface SweepResult {
  accountId: string;
  source: 'drive' | 'gmail';
  filesConsidered: number;
  imported: number;
  skipped: number;
  results: BankImportResult[];
  errors: string[];
}

/** Extensions a bank actually exports statements as. */
const STATEMENT_EXT = /\.(ofx|qfx|qif|sta|mt940|txt|csv)$/i;

@Injectable()
export class StatementSourceService {
  private readonly logger = new Logger(StatementSourceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleDriveService) private readonly drive: GoogleDriveService,
    @Inject(GmailService) private readonly gmail: GmailService,
    @Inject(BankImportService) private readonly bankImport: BankImportService,
  ) {}

  /* ── configuration ─────────────────────────────────────────────────── */

  async setSources(
    businessId: string,
    accountId: string,
    sources: StatementSources,
  ): Promise<StatementSources> {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: accountId, businessId },
      select: { id: true, metadata: true },
    });
    if (!account) throw new Error('Bank account not found for this business');

    const meta = (account.metadata as Record<string, unknown> | null) ?? {};
    const merged = { ...(meta.statementSources as StatementSources | undefined), ...sources };
    await this.prisma.client.financialAccount.update({
      where: { id: account.id },
      data: { metadata: { ...meta, statementSources: merged } as never },
    });
    return merged;
  }

  /** Accounts that have opted into an automated source. */
  private async configuredAccounts(businessId?: string) {
    const accounts = await this.prisma.client.financialAccount.findMany({
      where: businessId ? { businessId } : {},
      select: { id: true, businessId: true, name: true, metadata: true },
    });
    return accounts
      .map((a) => ({
        ...a,
        sources: (a.metadata as { statementSources?: StatementSources } | null)?.statementSources,
      }))
      .filter((a) => a.sources?.driveFolderId || a.sources?.gmailQuery);
  }

  /* ── detection ─────────────────────────────────────────────────────── */

  /**
   * Is this file plausibly a statement?
   *
   * Two gates, both cheap, and the second is the real one. A name and mime type
   * are a hint; `detectFormat` reading OFX/QIF/MT940 markers out of the content
   * is evidence. CSV has no markers, so a .csv is admitted on its extension and
   * will fail loudly in the parser if it is something else — which is the right
   * failure, because a silently skipped statement looks identical to a bank
   * that sent nothing.
   */
  private looksLikeStatement(filename: string, content: string): boolean {
    if (!STATEMENT_EXT.test(filename)) return false;
    const format = detectFormat(content);
    if (format !== 'csv') return true;
    // A CSV must at least have a header row with something date-shaped in it.
    return /date|posted|transaction/i.test(content.slice(0, 512));
  }

  /* ── Path A: Google Drive folder ───────────────────────────────────── */

  /**
   * Sweep the configured Drive folder for one account.
   *
   * Uses GoogleDriveService.listFiles and downloadBinary — the same calls the
   * existing Drive intake scanner uses, so token refresh and error handling
   * behave identically.
   */
  async sweepDrive(businessId: string, accountId: string): Promise<SweepResult> {
    const account = (await this.configuredAccounts(businessId)).find((a) => a.id === accountId);
    const result: SweepResult = {
      accountId, source: 'drive', filesConsidered: 0, imported: 0, skipped: 0, results: [], errors: [],
    };
    const folderId = account?.sources?.driveFolderId;
    if (!folderId) { result.errors.push('No Drive folder configured for this account.'); return result; }

    // listFiles' `query` option is a FILENAME SUBSTRING, not a Drive query.
    // This originally hand-built `'<folder>' in parents and trashed = false`
    // and passed it as `query`, which Drive received as a search for a file
    // *named* that — matching nothing, every night, without erroring. Only a
    // test at the fetch boundary showed it; every test that mocked listFiles
    // passed. Hence folderId/modifiedAfter, which build the clauses properly.
    const list = await this.drive.listFiles(businessId, {
      folderId,
      modifiedAfter: account?.sources?.lastSweptAt,
      pageSize: 50,
      orderBy: 'modifiedTime desc',
    });
    const files = list.files ?? [];
    result.filesConsidered = files.length;

    for (const file of files) {
      try {
        const { base64 } = await this.drive.downloadBinary(businessId, file.id);
        const content = Buffer.from(base64, 'base64').toString('utf8');
        if (!this.looksLikeStatement(file.name ?? '', content)) { result.skipped += 1; continue; }

        const imported = await this.bankImport.ingest(businessId, accountId, content, {
          source: `drive:${file.name ?? file.id}`,
        });
        result.results.push(imported);
        result.imported += imported.inserted;
      } catch (err: any) {
        result.errors.push(`${file.name ?? file.id}: ${(err as Error).message}`);
      }
    }

    await this.markSwept(businessId, accountId);
    return result;
  }

  /* ── Path B: Gmail search ──────────────────────────────────────────── */

  /**
   * Sweep matching mail for one account.
   *
   * Needed no new OAuth: `gmail.modify` was already in the granted scopes, so
   * every business that has ever connected Gmail can be swept today without
   * re-consenting.
   */
  async sweepGmail(businessId: string, accountId: string): Promise<SweepResult> {
    const account = (await this.configuredAccounts(businessId)).find((a) => a.id === accountId);
    const result: SweepResult = {
      accountId, source: 'gmail', filesConsidered: 0, imported: 0, skipped: 0, results: [], errors: [],
    };
    const baseQuery = account?.sources?.gmailQuery;
    if (!baseQuery) { result.errors.push('No Gmail query configured for this account.'); return result; }

    // Bound the search. Without this the first sweep of an old mailbox walks
    // years of mail, and every later sweep re-reads everything it already has.
    const query = `${baseQuery} has:attachment newer_than:${account?.sources?.lastSweptAt ? '7d' : '90d'}`;

    const messages = await this.gmail.searchMessages(businessId, query, 25);

    for (const m of messages) {
      try {
        const msg = await this.gmail.getMessageWithAttachments(businessId, m.id);
        for (const att of msg.attachments) {
          result.filesConsidered += 1;
          const bytes = await this.gmail.getAttachment(businessId, m.id, att.attachmentId);
          const content = bytes.toString('utf8');
          if (!this.looksLikeStatement(att.filename, content)) { result.skipped += 1; continue; }

          const imported = await this.bankImport.ingest(businessId, accountId, content, {
            source: `gmail:${att.filename}`,
          });
          result.results.push(imported);
          result.imported += imported.inserted;
        }
      } catch (err: any) {
        result.errors.push(`message ${m.id}: ${(err as Error).message}`);
      }
    }

    await this.markSwept(businessId, accountId);
    return result;
  }

  private async markSwept(businessId: string, accountId: string) {
    await this.setSources(businessId, accountId, { lastSweptAt: new Date().toISOString() });
  }

  /* ── the automation itself ─────────────────────────────────────────── */

  /**
   * Nightly sweep of every configured account, across every business.
   *
   * Runs with no tenant context, like every other cron here, so each account's
   * own businessId is passed explicitly rather than relied upon from ambient
   * scope — the Prisma tenant extension is inert on this path by construction.
   *
   * Safe to run unattended because ingest() dedupes: OFX and MT940 carry a
   * bank-assigned id and re-ingesting is exactly a no-op. For CSV and QIF the
   * dedupe is the (date, amount, reference) heuristic, which is why
   * `exactDedupe: false` is logged rather than hidden — a nightly job over a
   * heuristic is a choice someone should be able to see they made.
   */
  @Cron('0 5 * * *')
  async sweepAll(): Promise<{ swept: number; imported: number }> {
    const accounts = await this.configuredAccounts();
    let imported = 0;

    for (const a of accounts) {
      try {
        if (a.sources?.driveFolderId) {
          const r = await this.sweepDrive(a.businessId, a.id);
          imported += r.imported;
          if (r.results.some((x) => x.exactDedupe === false)) {
            this.logger.log(`[sweep] ${a.name}: imported via heuristic dedupe — a duplicate is possible`);
          }
        }
        if (a.sources?.gmailQuery) {
          const r = await this.sweepGmail(a.businessId, a.id);
          imported += r.imported;
        }
      } catch (err: any) {
        // One business's expired Gmail token must not stop the estate.
        this.logger.warn(`[sweep] ${a.businessId}/${a.id} failed: ${(err as Error).message}`);
      }
    }

    if (accounts.length) this.logger.log(`[sweep] ${accounts.length} account(s), ${imported} transactions imported`);
    return { swept: accounts.length, imported };
  }
}

/**
 * Statement parsers — the acquisition half of bank reconciliation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The matching half of reconciliation is already built and good: amount
 * tolerance, date windows, reference scoring, deterministic tie-breaks, manual
 * match/unmatch/ignore. What was missing was any way to get transactions in
 * except a human uploading a CSV and hoping the column headers were recognised.
 *
 * An aggregator feed (Plaid and friends) is the usual answer, and for Trinidad
 * & Tobago banks it may simply not exist — open banking is a UK/EU regulatory
 * regime, and the major aggregators' coverage lists are worth checking before
 * anyone writes a connector. Which means the realistic feed for this market is
 * statement ingestion, and the bar is not "match a US bank feed" but "beat what
 * every other accounting product does here", which is also a CSV upload.
 *
 * THE THING THAT MAKES AUTOMATION SAFE
 * ------------------------------------
 * Automation is only responsible if re-ingesting the same statement is a no-op.
 * The existing CSV path dedupes on (date, amount, reference) — a good heuristic,
 * and a heuristic: two identical £20 card payments to the same shop on the same
 * day with no reference collapse into one, and the second is lost.
 *
 * OFX and MT940 both carry a bank-assigned unique id per transaction (FITID,
 * and the :61: reference). When a format supplies one we dedupe on THAT, which
 * is exact. That is the difference between "importing twice is probably fine"
 * and "a scheduled job can run every night".
 *
 * FORMATS
 * -------
 *   OFX/QFX  structured, has FITID              — best case, prefer it
 *   MT940    structured, bank reference on :61: — common for business accounts
 *   QIF      structured, no id                  — old but widely exported
 *   CSV      unstructured, headers guessed      — the fallback, and the norm
 */

import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export type StatementFormat = 'ofx' | 'qif' | 'mt940' | 'csv';

export interface ParsedStatementRow {
  date: Date;
  description: string;
  amount: Prisma.Decimal;
  reference: string | null;
  /**
   * The bank's own id for this transaction, when the format carries one.
   * Present for OFX (FITID) and usually MT940. Null for QIF and CSV.
   */
  externalId: string | null;
  raw: Record<string, string>;
}

export interface ParseOutcome {
  format: StatementFormat;
  rows: ParsedStatementRow[];
  errors: string[];
  /** True when every row carries a bank-assigned id, so dedupe is exact. */
  exactDedupe: boolean;
}

/* ── format detection ─────────────────────────────────────────────────── */

/**
 * Sniff the format from the content, not the filename.
 *
 * Filenames lie — banks emit `statement.txt` for OFX and `.csv` for
 * semicolon-delimited QIF often enough that trusting the extension produces a
 * confident wrong parse. Content detection fails loudly instead.
 */
export function detectFormat(content: string): StatementFormat {
  const head = content.slice(0, 4096);

  // OFX: either the SGML header block or the XML-ish root tag.
  if (/OFXHEADER\s*[:=]/i.test(head) || /<OFX>/i.test(head)) return 'ofx';

  // QIF: a type header, or a bare record starting with a D-date line.
  if (/^\s*!Type:/im.test(head)) return 'qif';

  // MT940: the transaction-reference and statement-line tags.
  if (/^:20:/m.test(head) && /^:61:/m.test(content)) return 'mt940';

  return 'csv';
}

/* ── OFX ──────────────────────────────────────────────────────────────── */

/** OFX dates are YYYYMMDD, optionally followed by time and a [±h:TZ] suffix. */
function parseOfxDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

function ofxTag(block: string, tag: string): string | null {
  // OFX is SGML: tags are frequently unclosed, so read to the next tag or EOL.
  const m = block.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
  return m ? m[1].trim() : null;
}

export function parseOfx(content: string): ParseOutcome {
  const rows: ParsedStatementRow[] = [];
  const errors: string[] = [];
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  if (blocks.length === 0) errors.push('No <STMTTRN> transaction blocks found in the OFX file.');

  blocks.forEach((block, i) => {
    const dateRaw = ofxTag(block, 'DTPOSTED');
    const amtRaw = ofxTag(block, 'TRNAMT');
    const date = dateRaw ? parseOfxDate(dateRaw) : null;

    if (!date) { errors.push(`Transaction ${i + 1}: unreadable DTPOSTED "${dateRaw ?? ''}"`); return; }
    if (!amtRaw) { errors.push(`Transaction ${i + 1}: missing TRNAMT`); return; }

    let amount: Prisma.Decimal;
    try { amount = new D(amtRaw.replace(/,/g, '')); }
    catch { errors.push(`Transaction ${i + 1}: unreadable TRNAMT "${amtRaw}"`); return; }

    // NAME is the counterparty, MEMO the free-text. Banks populate one or the
    // other inconsistently, so join whichever exist rather than picking.
    const name = ofxTag(block, 'NAME');
    const memo = ofxTag(block, 'MEMO');
    const description = [name, memo].filter(Boolean).join(' — ') || 'Bank transaction';

    rows.push({
      date,
      description,
      amount,
      reference: ofxTag(block, 'CHECKNUM') ?? ofxTag(block, 'REFNUM'),
      externalId: ofxTag(block, 'FITID'),
      raw: { format: 'ofx', trntype: ofxTag(block, 'TRNTYPE') ?? '', dtposted: dateRaw ?? '', trnamt: amtRaw },
    });
  });

  return {
    format: 'ofx',
    rows,
    errors,
    exactDedupe: rows.length > 0 && rows.every((r) => !!r.externalId),
  };
}

/* ── QIF ──────────────────────────────────────────────────────────────── */

/** QIF dates: M/D/YY, D/M/YYYY, and the ' apostrophe-century form (12/31'99). */
function parseQifDate(raw: string): Date | null {
  const t = raw.trim().replace(/'/g, '/');
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const [, a, b, rawYear] = m;
  let y = rawYear;
  if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
  // Day-first unless the first field cannot be a day. Trinidad, like most of
  // the world outside the US, writes DD/MM — and a US export with 12/31 still
  // resolves correctly because 31 cannot be a month.
  let day = Number(a), month = Number(b);
  if (day > 12 && month <= 12) { /* already day-first */ }
  else if (month > 12 && day <= 12) { const t2 = day; day = month; month = t2; }
  const d = new Date(Date.UTC(Number(y), month - 1, day));
  return isNaN(d.getTime()) ? null : d;
}

export function parseQif(content: string): ParseOutcome {
  const rows: ParsedStatementRow[] = [];
  const errors: string[] = [];

  // Records are terminated by a lone ^. The !Type: header is not one.
  const records = content.split(/^\^\s*$/m).map((r) => r.trim()).filter(Boolean);

  records.forEach((rec, i) => {
    if (/^!/.test(rec) && !/^D/m.test(rec)) return; // header-only chunk

    const field = (letter: string) => {
      const m = rec.match(new RegExp('^' + letter + '(.*)$', 'm'));
      return m ? m[1].trim() : null;
    };

    const dateRaw = field('D');
    if (!dateRaw) return; // not a transaction record
    const date = parseQifDate(dateRaw);
    if (!date) { errors.push(`Record ${i + 1}: unreadable date "${dateRaw}"`); return; }

    const amtRaw = field('T') ?? field('U');
    if (!amtRaw) { errors.push(`Record ${i + 1}: missing amount`); return; }

    let amount: Prisma.Decimal;
    try { amount = new D(amtRaw.replace(/[,\s]/g, '')); }
    catch { errors.push(`Record ${i + 1}: unreadable amount "${amtRaw}"`); return; }

    const payee = field('P');
    const memo = field('M');

    rows.push({
      date,
      description: [payee, memo].filter(Boolean).join(' — ') || 'Bank transaction',
      amount,
      reference: field('N'),
      externalId: null, // QIF carries no bank id — dedupe stays heuristic
      raw: { format: 'qif', payee: payee ?? '', memo: memo ?? '', amount: amtRaw },
    });
  });

  if (rows.length === 0 && errors.length === 0) errors.push('No QIF transaction records found.');
  return { format: 'qif', rows, errors, exactDedupe: false };
}

/* ── MT940 ────────────────────────────────────────────────────────────── */

/**
 * :61: is the statement line and packs several fields with no separators:
 *
 *   YYMMDD [MMDD] {C|D|RC|RD} [funds-code] amount N<type> <bank-ref>//<own-ref>
 *
 * The amount uses a comma as the decimal separator, which is the single most
 * common way a naive MT940 parser produces numbers a thousand times too large.
 */
const MT940_LINE = /^:61:(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)N(\w{3})([^/\n\r]*)(?:\/\/(\S*))?/;

function parseMt940Date(yymmdd: string): Date | null {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  return isNaN(d.getTime()) ? null : d;
}

export function parseMt940(content: string): ParseOutcome {
  const rows: ParsedStatementRow[] = [];
  const errors: string[] = [];

  // Normalise continuations: MT940 wraps long :86: info across lines.
  const lines = content.split(/\r?\n/);
  const entries: Array<{ line: string; info: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^:61:/.test(lines[i])) continue;
    let info = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (/^:86:/.test(lines[j])) {
        info = lines[j].slice(4);
        for (let k = j + 1; k < lines.length && !/^:\d{2}/.test(lines[k]); k++) info += ' ' + lines[k].trim();
        break;
      }
      if (/^:\d{2}/.test(lines[j])) break;
    }
    entries.push({ line: lines[i], info: info.trim() });
  }

  entries.forEach((e, i) => {
    const m = e.line.match(MT940_LINE);
    if (!m) { errors.push(`Line ${i + 1}: could not read :61: statement line`); return; }

    const [, valueDate, , mark, , amountRaw, , bankRef, ownRef] = m;
    const date = parseMt940Date(valueDate);
    if (!date) { errors.push(`Line ${i + 1}: unreadable value date "${valueDate}"`); return; }

    let amount: Prisma.Decimal;
    try {
      // Comma is the decimal separator in MT940, never a thousands separator.
      amount = new D(amountRaw.replace(',', '.'));
    } catch { errors.push(`Line ${i + 1}: unreadable amount "${amountRaw}"`); return; }

    // D = debit (money out) so it must be negative; RC/RD are reversals.
    const isDebit = mark === 'D' || mark === 'RC';
    if (isDebit) amount = amount.negated();

    const ref = (ownRef || bankRef || '').trim() || null;

    rows.push({
      date,
      description: e.info || 'Bank transaction',
      amount,
      reference: ref,
      // The bank's own reference is unique per transaction on a statement.
      externalId: ref,
      raw: { format: 'mt940', mark, amount: amountRaw, info: e.info },
    });
  });

  if (rows.length === 0 && errors.length === 0) errors.push('No :61: statement lines found.');
  return {
    format: 'mt940',
    rows,
    errors,
    exactDedupe: rows.length > 0 && rows.every((r) => !!r.externalId),
  };
}

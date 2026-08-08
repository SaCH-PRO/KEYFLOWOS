/**
 * Statement parsers — the failures here are all silent-wrong-number failures.
 *
 * A parser that throws is a support ticket. A parser that returns 150000 where
 * the statement said 1.500,00 reconciles cleanly against nothing, and the
 * owner discovers it at year end. Every assertion below is aimed at a value
 * that would be WRONG rather than absent.
 *
 * The four traps, in the order they bite:
 *
 *   MT940  comma is the DECIMAL separator, never thousands. Read it as a
 *          thousands separator and every amount is 100x too large.
 *   MT940  the D/C mark carries the sign. Miss it and every payment out looks
 *          like money in, and the account reconciles to double its balance.
 *   QIF    dates are ambiguous. 03/04 is two different days depending on where
 *          the bank is.
 *   OFX    tags are frequently unclosed SGML. A regex expecting </TAG> reads
 *          the rest of the file as the value.
 */
import { describe, it, expect } from 'vitest';
import { detectFormat, parseOfx, parseQif, parseMt940 } from './bank-statement-parsers';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260703120000[-4:AST]
<TRNAMT>-1250.75
<FITID>2026070300123456
<NAME>MASSY STORES
<MEMO>CARD PURCHASE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260705
<TRNAMT>18000.00
<FITID>2026070500987654
<NAME>CLIENT TRANSFER
<CHECKNUM>4471
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const QIF = `!Type:Bank
D03/07/2026
T-1250.75
PMASSY STORES
MCARD PURCHASE
^
D05/07/2026
T18000.00
PCLIENT TRANSFER
N4471
^`;

// Amounts use a comma decimal separator — the whole point of the MT940 tests.
const MT940 = `:20:STMT20260731
:25:TT12RBTT0001234567
:28C:00007/001
:60F:C260701TTD45000,00
:61:2607030703D1250,75NTRFMASSY//REF00123456
:86:CARD PURCHASE MASSY STORES POS 4471
:61:2607050705C18000,00NTRFCLIENT//REF00987654
:86:INCOMING TRANSFER CLIENT LTD
:62F:C260731TTD61749,25`;

/* ── detection ────────────────────────────────────────────────────────── */

describe('format is sniffed from content, not the filename', () => {
  it('recognises each format', () => {
    expect(detectFormat(OFX)).toBe('ofx');
    expect(detectFormat(QIF)).toBe('qif');
    expect(detectFormat(MT940)).toBe('mt940');
    expect(detectFormat('Date,Description,Amount\n2026-07-03,Shop,-10.00')).toBe('csv');
  });

  it('an OFX file named .csv is still parsed as OFX', () => {
    // Banks really do emit OFX with a .txt or .csv extension. Trusting the
    // extension produces a confident wrong parse rather than a failure.
    expect(detectFormat(OFX)).toBe('ofx');
  });

  it('falls back to CSV rather than guessing wildly', () => {
    expect(detectFormat('total nonsense\nwith no markers')).toBe('csv');
  });
});

/* ── OFX ──────────────────────────────────────────────────────────────── */

describe('OFX', () => {
  const out = parseOfx(OFX);

  it('reads both transactions with no errors', () => {
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(2);
  });

  it('reads unclosed SGML tags without swallowing the rest of the file', () => {
    // <NAME>MASSY STORES with no </NAME>. A regex expecting a closing tag
    // captures everything to the end of the document.
    expect(out.rows[0].description).toBe('MASSY STORES — CARD PURCHASE');
    expect(out.rows[0].description.length).toBeLessThan(60);
  });

  it('keeps the sign from TRNAMT', () => {
    expect(out.rows[0].amount.toFixed(2)).toBe('-1250.75');
    expect(out.rows[1].amount.toFixed(2)).toBe('18000.00');
  });

  it('strips the timezone suffix from DTPOSTED', () => {
    // 20260703120000[-4:AST] — a naive Date() on that string gives Invalid Date.
    expect(out.rows[0].date.toISOString().slice(0, 10)).toBe('2026-07-03');
  });

  it('captures FITID, which is what makes dedupe exact', () => {
    expect(out.rows[0].externalId).toBe('2026070300123456');
    expect(out.exactDedupe).toBe(true);
  });

  it('reports a file with no transactions rather than returning silence', () => {
    const empty = parseOfx('<OFX></OFX>');
    expect(empty.rows).toHaveLength(0);
    expect(empty.errors.join(' ')).toMatch(/No <STMTTRN>/);
    expect(empty.exactDedupe, 'an empty file must not claim exact dedupe').toBe(false);
  });
});

/* ── QIF ──────────────────────────────────────────────────────────────── */

describe('QIF', () => {
  const out = parseQif(QIF);

  it('reads both records', () => {
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(2);
  });

  it('reads 03/07/2026 as 3 July, not 7 March', () => {
    // Day-first. Trinidad, like most of the world outside the US, writes DD/MM.
    expect(out.rows[0].date.toISOString().slice(0, 10)).toBe('2026-07-03');
  });

  it('still resolves a US-style date when the first field cannot be a day', () => {
    const us = parseQif('!Type:Bank\nD12/31/2026\nT-5.00\nPSHOP\n^');
    expect(us.rows[0].date.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('never claims exact dedupe — QIF carries no bank id', () => {
    expect(out.rows.every((r) => r.externalId === null)).toBe(true);
    expect(out.exactDedupe).toBe(false);
  });

  it('does not treat the !Type header as a transaction', () => {
    expect(out.rows).toHaveLength(2);
  });
});

/* ── MT940 ────────────────────────────────────────────────────────────── */

describe('MT940', () => {
  const out = parseMt940(MT940);

  it('reads both statement lines', () => {
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(2);
  });

  it('treats the comma as a DECIMAL separator, not thousands', () => {
    // 1250,75 is one thousand two hundred and fifty. Read as a thousands
    // separator it becomes 125075 — a hundred times too large, and it would
    // reconcile against nothing while looking entirely plausible.
    expect(out.rows[0].amount.abs().toFixed(2)).toBe('1250.75');
    expect(out.rows[1].amount.toFixed(2)).toBe('18000.00');
  });

  it('takes the sign from the D/C mark, not from the number', () => {
    // The amount field is unsigned; D means money out. Miss this and every
    // payment looks like income.
    expect(out.rows[0].amount.isNegative(), 'a D line must be negative').toBe(true);
    expect(out.rows[1].amount.isPositive(), 'a C line must be positive').toBe(true);
  });

  it('pulls the description from the :86: line that follows', () => {
    expect(out.rows[0].description).toMatch(/MASSY STORES/);
  });

  it('captures the bank reference as an external id', () => {
    expect(out.rows[0].externalId).toBe('REF00123456');
    expect(out.exactDedupe).toBe(true);
  });

  it('reports unreadable statement lines instead of dropping them silently', () => {
    const broken = ':20:X\n:61:NOT-A-STATEMENT-LINE\n:86:whatever';
    const r = parseMt940(broken);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

/* ── the property that makes automation safe ──────────────────────────── */

describe('exactDedupe is only claimed when it is true', () => {
  it('is true only for formats that carry a bank-assigned id on every row', () => {
    expect(parseOfx(OFX).exactDedupe).toBe(true);
    expect(parseMt940(MT940).exactDedupe).toBe(true);
    expect(parseQif(QIF).exactDedupe).toBe(false);
  });

  it('is false when even one row lacks an id', () => {
    // A mixed file must not be reported as safe to re-ingest unattended.
    const mixed = OFX.replace('<FITID>2026070500987654\n', '');
    const r = parseOfx(mixed);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.some((x) => !x.externalId)).toBe(true);
    expect(r.exactDedupe, 'one missing id must sink the claim for the whole file').toBe(false);
  });
});

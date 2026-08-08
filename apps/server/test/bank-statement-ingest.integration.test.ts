/**
 * Statement ingestion, against a REAL database.
 *
 * Everything shipped so far was proven with mocks: a fake Prisma, a fake
 * `ingest`, fake Drive and Gmail. The parsers were unit-tested on strings and
 * the routing was unit-tested on an in-memory array. None of it had ever put a
 * row in a table.
 *
 * That gap matters more here than it usually does, because the whole point of
 * the feature is that it runs UNATTENDED at 5am. A defect in an interactive
 * path gets reported by the person who hit it. A defect in this path is
 * discovered by an accountant at year end, and the evidence — a month of
 * transactions in the wrong place, or absent — is by then very expensive.
 *
 * Four things are proven here that a mock cannot prove, because in each case
 * the mock was written by the same person who wrote the assumption:
 *
 *  1. A real bank file becomes real rows. The parsers agree with Prisma about
 *     Decimal, about Date, and about which columns are nullable.
 *  2. Re-importing the same file inserts NOTHING. This is the property the
 *     entire nightly automation rests on. If it is false, the cron manufactures
 *     duplicate transactions every morning and the ledger drifts silently.
 *  3. A sign is preserved end to end. MT940 carries direction as a D/C mark
 *     rather than a minus, so a debit that survives parsing as a positive
 *     number reconciles to the exact wrong side of the book.
 *  4. Business B cannot import into business A's account, even naming its id
 *     directly — the interceptor is HTTP-only and this path has no request.
 *
 * Requires DATABASE_URL. Fixtures are prefixed and removed afterwards.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'zz_ingest_';
const ID = {
  userA: `${P}userA`, userB: `${P}userB`,
  bizA: `${P}bizA`, bizB: `${P}bizB`,
  coaA: `${P}coaA`, coaB: `${P}coaB`,
  acctA: `${P}acctA`, acctB: `${P}acctB`,
};

let db: any;
let importer: any;

/* ── Fixtures shaped like what a bank actually emits ──────────────────── */

/** OFX, as exported by most retail banking portals. FITID is bank-assigned. */
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>TTD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260703120000
<TRNAMT>-1250.75
<FITID>2026070300001
<NAME>MASSY STORES
<MEMO>POS PURCHASE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260705120000
<TRNAMT>18400.00
<FITID>2026070500002
<NAME>CLIENT PAYMENT
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

/**
 * MT940 — the SWIFT statement format, and the one most likely to be got wrong.
 * The comma is the DECIMAL separator, and the sign lives in the D/C mark
 * rather than in the number.
 */
const MT940 = `:20:STMT260703
:25:RBL/001234567
:28C:00142/001
:60F:C260701TTD45000,00
:61:2607030703D1250,75NTRFNONREF//BANKREF001
:86:MASSY STORES POS
:61:2607050705C18400,00NTRFNONREF//BANKREF002
:86:CLIENT PAYMENT
:62F:C260705TTD62149,25`;

/** CSV — no transaction id anywhere, so dedupe falls back to a heuristic. */
const CSV = `Date,Description,Amount,Reference
2026-07-03,MASSY STORES,-1250.75,POS001
2026-07-05,CLIENT PAYMENT,18400.00,DEP002`;

async function cleanup() {
  for (const sql of [
    `DELETE FROM bank_transactions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_accounts WHERE id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Rows currently in an account, oldest first. */
async function rowsIn(accountId: string) {
  return db.bankTransaction.findMany({
    where: { accountId },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { FinanceAuditService } = await import('../src/modules/finance/finance-audit.service');
  const { BankImportService } = await import('../src/modules/finance/bank-import.service');
  const prisma = new PrismaService() as any;
  importer = new BankImportService(prisma, new FinanceAuditService(prisma) as any);

  await cleanup();
  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', ownerId: ID.userB } });
  await db.chartOfAccount.create({ data: { id: ID.coaA, businessId: ID.bizA, name: 'Bank', type: 'ASSET' } });
  await db.chartOfAccount.create({ data: { id: ID.coaB, businessId: ID.bizB, name: 'Bank', type: 'ASSET' } });
  await db.financialAccount.create({
    data: { id: ID.acctA, businessId: ID.bizA, chartOfAccountId: ID.coaA, name: 'Republic', type: 'BANK', currency: 'TTD' },
  });
  await db.financialAccount.create({
    data: { id: ID.acctB, businessId: ID.bizB, chartOfAccountId: ID.coaB, name: 'FCB', type: 'BANK', currency: 'TTD' },
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await db.$disconnect?.();
});

describe('a real bank file becomes real rows', () => {
  it('an OFX statement lands with the right count, signs and dates', async () => {
    const r = await importer.ingest(ID.bizA, ID.acctA, OFX, { source: 'test:ofx' });

    expect(r.format).toBe('ofx');
    expect(r.parsed).toBe(2);
    expect(r.inserted).toBe(2);
    expect(r.errors).toEqual([]);

    const rows = await rowsIn(ID.acctA);
    expect(rows).toHaveLength(2);

    // The debit must still be negative after a round trip through
    // Prisma.Decimal and a numeric column.
    expect(Number(rows[0].amount)).toBe(-1250.75);
    expect(Number(rows[1].amount)).toBe(18400);
    expect(rows[0].date.toISOString().slice(0, 10)).toBe('2026-07-03');
    expect(rows[0].description).toMatch(/MASSY/i);
  });

  it('the bank-assigned id is stored, which is what makes re-import safe', async () => {
    // BankTransaction has no externalId COLUMN — the id lives in the rawData
    // JSON (schema.prisma:9522-9547) and dedupe reads it back out of there.
    // Asserting on a column was this test's own first bug, and a mock would
    // never have caught it because the mock returned whatever it was told to.
    const rows = await rowsIn(ID.acctA);
    const ids = rows.map((t: any) => t.rawData?.externalId);
    expect(ids).toContain('2026070300001');
    expect(ids).toContain('2026070500002');
  });

  it('the same file imported twice inserts nothing the second time', async () => {
    // The property the entire nightly sweep rests on. If this is false, the
    // cron manufactures duplicates every morning.
    const before = (await rowsIn(ID.acctA)).length;

    const again = await importer.ingest(ID.bizA, ID.acctA, OFX, { source: 'test:ofx-again' });

    expect(again.inserted, 're-import must insert nothing').toBe(0);
    expect(again.duplicates).toBe(2);
    expect(again.exactDedupe, 'OFX carries FITID, so dedupe is exact').toBe(true);
    expect((await rowsIn(ID.acctA)).length).toBe(before);
  });
});

describe('two sweeps of the same statement at the same time', () => {
  it('does not insert the statement twice', async () => {
    // Dedupe is done in application memory: persist() reads the existing rows
    // in the date range, builds a Set, and decides. There is no unique
    // constraint behind it. So if two ingests interleave — the 5am cron and
    // someone pressing "Sweep now", or two accounts sharing one Drive folder —
    // both can read an empty Set and both can insert.
    //
    // This is exactly the failure that only ever happens unattended, and the
    // duplicate it creates is indistinguishable from a real transaction.
    const acct = `${P}acctRace`;
    await db.financialAccount.create({
      data: { id: acct, businessId: ID.bizA, chartOfAccountId: ID.coaA, name: 'Race', type: 'BANK', currency: 'TTD' },
    });

    const [a, b] = await Promise.all([
      importer.ingest(ID.bizA, acct, OFX, { source: 'test:race-1' }),
      importer.ingest(ID.bizA, acct, OFX, { source: 'test:race-2' }),
    ]);

    const rows = await rowsIn(acct);
    const fitIds = rows.map((t: any) => t.rawData?.externalId).sort();

    expect(
      rows.length,
      `two concurrent imports of a 2-row statement produced ${rows.length} rows ` +
        `(inserted ${a.inserted} and ${b.inserted}); FITIDs: ${JSON.stringify(fitIds)}`,
    ).toBe(2);
    expect(new Set(fitIds).size, 'every stored FITID must be distinct').toBe(2);

    // The report must still add up, or a skipped duplicate reads the same as a
    // dropped transaction.
    for (const r of [a, b]) {
      expect(r.inserted + r.duplicates + r.invalid).toBe(r.parsed);
    }
  });

  it('the database itself refuses a second row with the same bank id', async () => {
    // The test above depends on two ingests interleaving, which on a local
    // socket they usually do not — it passed against the broken code for that
    // reason alone, and only a deliberately widened window exposed the race.
    //
    // This assertion has no timing in it. It goes at the constraint directly,
    // so the guarantee is pinned whether or not the race reproduces on the
    // machine running the suite.
    const acct = `${P}acctIdx`;
    await db.financialAccount.create({
      data: { id: acct, businessId: ID.bizA, chartOfAccountId: ID.coaA, name: 'Idx', type: 'BANK', currency: 'TTD' },
    });
    const row = (n: number) => ({
      id: `${P}idx${n}`,
      businessId: ID.bizA,
      accountId: acct,
      date: new Date('2026-07-03'),
      description: 'MASSY STORES',
      amount: '-1250.75',
      currency: 'TTD',
      reference: null,
      status: 'UNMATCHED',
      rawData: { externalId: 'DUPLICATE-FITID' },
    });

    await db.bankTransaction.create({ data: row(1) });
    await expect(
      db.bankTransaction.create({ data: row(2) }),
      'a second row with the same (account, externalId) must be rejected',
    ).rejects.toThrow();

    // ...and the index must be PARTIAL: rows with no bank id are the CSV and
    // QIF case, where two legitimately identical-looking lines can both be
    // real (the same amount to the same payee twice in one day).
    const noId = (n: number) => ({ ...row(n), id: `${P}noid${n}`, rawData: { memo: 'no external id' } });
    await db.bankTransaction.create({ data: noId(1) });
    await db.bankTransaction.create({ data: noId(2) });
    const idless = await db.bankTransaction.count({
      where: { accountId: acct, rawData: { equals: { memo: 'no external id' } } },
    });
    expect(idless, 'rows without a bank id must not be constrained').toBe(2);
  });
});

describe('MT940 keeps the sign it encodes in a letter', () => {
  it('a D mark becomes a negative amount and a C mark a positive one', async () => {
    // Comma is the decimal separator here, and D/C carries the direction. Get
    // either wrong and the row reconciles to the exact opposite side of the
    // book — a mistake that balances arithmetically and is wrong in fact.
    const r = await importer.ingest(ID.bizB, ID.acctB, MT940, { source: 'test:mt940' });

    expect(r.format).toBe('mt940');
    expect(r.inserted).toBe(2);

    const rows = await rowsIn(ID.acctB);
    const amounts = rows.map((t: any) => Number(t.amount)).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([-1250.75, 18400]);
  });

  it('re-importing an MT940 is also a no-op — it carries a reference', async () => {
    const before = (await rowsIn(ID.acctB)).length;
    const again = await importer.ingest(ID.bizB, ID.acctB, MT940, { source: 'test:mt940-again' });

    expect(again.inserted).toBe(0);
    expect((await rowsIn(ID.acctB)).length).toBe(before);
  });
});

describe('a format with no transaction id says so', () => {
  it('CSV imports, but reports that dedupe was a heuristic', async () => {
    // Not a defect — a disclosure. A nightly job running on a guess is a
    // choice, and the person who turned it on should be able to see they
    // made it.
    const fresh = `${P}acctC`;
    await db.financialAccount.create({
      data: { id: fresh, businessId: ID.bizA, chartOfAccountId: ID.coaA, name: 'Petty', type: 'BANK', currency: 'TTD' },
    });

    const r = await importer.ingest(ID.bizA, fresh, CSV, { source: 'test:csv' });

    expect(r.format).toBe('csv');
    expect(r.inserted).toBe(2);
    expect(r.exactDedupe, 'CSV has no bank id — dedupe is (date, amount, reference)').toBe(false);

    // The heuristic still has to work: same file twice is still a no-op.
    const again = await importer.ingest(ID.bizA, fresh, CSV, { source: 'test:csv-again' });
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(2);
  });
});

describe('a statement cannot cross a tenant boundary', () => {
  it('business B naming business A\'s account imports nothing', async () => {
    // There is no HTTP request on the sweep path, so TenantInterceptor is inert
    // by construction and the businessId in the WHERE is the only thing
    // standing here. A Prisma findFirst that omitted it would return A's
    // account to B and post the rows.
    const before = (await rowsIn(ID.acctA)).length;

    await expect(
      importer.ingest(ID.bizB, ID.acctA, OFX, { source: 'test:cross-tenant' }),
    ).rejects.toThrow();

    expect(
      (await rowsIn(ID.acctA)).length,
      "business A's account must be untouched",
    ).toBe(before);
  });

  it('rows carry the businessId of the account, not of the caller', async () => {
    const rows = await rowsIn(ID.acctA);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.businessId).toBe(ID.bizA);
    }
  });
});

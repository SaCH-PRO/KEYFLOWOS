/**
 * V1-15-DM-LEDGER-WRITE-DOOR — the ledger has one write door (CF-40).
 *
 * PostingService (finance/posting.service.ts) is documented as "the single
 * entry point for writing to the ledger": it validates that debits equal
 * credits, that every account belongs to the posting business, dedupes on the
 * per-business externalRef, refuses to reverse an entry a reconciliation has
 * locked, and (V1-15) refuses a posting dated inside a CLOSED accounting period.
 * None of that holds for a row written anywhere else. At the V1 base,
 * ExpensesService.voidExpense wrote its reversal by hand
 * (expenses.service.ts:313 financialTransaction.create, :332 ledgerEntry.create),
 * so a void skipped the reconciliation lock, the closed-period check, the
 * externalRef dedupe and the REVERSED status on the original.
 *
 * This spec reads apps/server/src and pins:
 *   LWI-01  no FinancialTransaction or LedgerEntry INSERT outside posting.service.ts
 *           (delegate create/createMany/upsert, a nested `entries: { create }`,
 *           or raw `INSERT INTO financial_transactions|ledger_entries`);
 *   LWI-02  the UPDATE writers of those two tables are exactly the inventory below
 *           (each with its reason), and nothing DELETEs from them or reaches the
 *           delegates by a computed name;
 *   LWI-03  the scanner names an injected writer by file and line (self-test, so
 *           the two cases above are known to bite);
 *   LWI-04  the posting door consults the accounting periods: PostingService
 *           takes AccountingPeriodService, and every Nest module that provides
 *           PostingService also provides AccountingPeriodService, so the
 *           (optional, see posting.service.ts) dependency is never silently absent
 *           in the running app.
 *
 * What the scan cannot see, stated plainly: a delegate reached through a
 * destructured or aliased variable (`const { ledgerEntry } = tx`), and raw SQL
 * whose table name is computed at runtime (gdpr-purge.service.ts erases a whole
 * tenant by cascade, which is not a ledger write). Full-line comments are
 * skipped; every other match counts, so a false positive fails loudly.
 *
 * The real-database behaviour behind this door (closed periods answer 409 and
 * write nothing; a locked expense void answers 409; a trial balance balances
 * per currency) is proven in test/ledger-write-door.integration.test.ts and
 * test/expense-void-reversal.integration.test.ts.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTIONAL_DEPS_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { PostingService } from './posting.service';
import { AccountingPeriodService } from './accounting-period.service';

const SERVER = join(__dirname, '..', '..', '..');
const REPO = join(SERVER, '..', '..');
const SRC = join(SERVER, 'src');

/** The one file allowed to INSERT ledger rows. */
const DOOR = 'apps/server/src/modules/finance/posting.service.ts';

type Model = 'FinancialTransaction' | 'LedgerEntry';
type Kind = 'insert' | 'update' | 'delete' | 'dynamic';

export interface LedgerWrite {
  file: string;
  line: number;
  model: Model;
  op: string;
  kind: Kind;
}

const DELEGATE_MODEL: Record<string, Model> = { financialTransaction: 'FinancialTransaction', ledgerEntry: 'LedgerEntry' };
const TABLE_MODEL: Record<string, Model> = { financial_transactions: 'FinancialTransaction', ledger_entries: 'LedgerEntry' };
/** Relation fields whose nested writes land in a ledger table (schema.prisma). */
const RELATION_MODEL: Record<string, Model> = {
  entries: 'LedgerEntry',
  ledgerEntries: 'LedgerEntry',
  financialTransactions: 'FinancialTransaction',
  reversedBy: 'FinancialTransaction',
  reversalOf: 'FinancialTransaction',
};

function kindOf(op: string): Kind {
  const o = op.toLowerCase();
  if (o.startsWith('create') || o === 'upsert' || o === 'connectorcreate' || o.startsWith('insert')) return 'insert';
  if (o.startsWith('update')) return 'update';
  return 'delete';
}

/** Blank full-line comments (`//`, `/*`, ` * `) so prose about a writer is not a writer. Line numbers are kept. */
function codeLines(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
    .join('\n');
}

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

const DELEGATE_WRITE =
  /\??\.\s*(financialTransaction|ledgerEntry)\s*\??\.\s*(createManyAndReturn|createMany|create|upsert|updateManyAndReturn|updateMany|update|deleteMany|delete)\s*\(/g;
const NESTED_WRITE =
  /\b(entries|ledgerEntries|financialTransactions|reversedBy|reversalOf)\s*:\s*\{\s*(createMany|create|connectOrCreate|upsert|updateMany|update|deleteMany|delete)\b/g;
const RAW_WRITE = /\b(insert\s+into|update|delete\s+from)\s+(?:"?public"?\.)?"?(financial_transactions|ledger_entries)\b/gi;
/** A computed member access (`tx['ledgerEntry']`), not an array literal. */
const DYNAMIC_DELEGATE = /(?<=[\w$)\]])\s*\[\s*(['"`])(financialTransaction|ledgerEntry)\1\s*\]/g;

/** Every ledger write in one source file. `file` is repo-relative. */
export function scanLedgerWrites(file: string, source: string): LedgerWrite[] {
  const src = codeLines(source);
  const out: LedgerWrite[] = [];
  for (const m of src.matchAll(DELEGATE_WRITE)) {
    out.push({ file, line: lineAt(src, m.index ?? 0), model: DELEGATE_MODEL[m[1]], op: m[2], kind: kindOf(m[2]) });
  }
  for (const m of src.matchAll(NESTED_WRITE)) {
    out.push({ file, line: lineAt(src, m.index ?? 0), model: RELATION_MODEL[m[1]], op: `nested ${m[2]}`, kind: kindOf(m[2]) });
  }
  for (const m of src.matchAll(RAW_WRITE)) {
    const verb = m[1].toLowerCase().replace(/\s+/g, ' ');
    out.push({ file, line: lineAt(src, m.index ?? 0), model: TABLE_MODEL[m[2].toLowerCase()], op: `raw ${verb}`, kind: kindOf(verb) });
  }
  for (const m of src.matchAll(DYNAMIC_DELEGATE)) {
    out.push({ file, line: lineAt(src, m.index ?? 0), model: DELEGATE_MODEL[m[2]], op: 'computed delegate', kind: 'dynamic' });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** INSERTs outside the posting door, as `file:line Model.op` messages. */
export function insertsOutsideDoor(writes: LedgerWrite[]): string[] {
  return writes
    .filter((w) => w.kind === 'insert' && w.file !== DOOR)
    .map((w) => `${w.file}:${w.line} ${w.model}.${w.op} writes the ledger outside ${DOOR}; post or reverse through PostingService`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

function rel(file: string): string {
  return relative(REPO, file).split(sep).join('/');
}

const FILES = sourceFiles(SRC);
const WRITES = FILES.flatMap((f) => scanLedgerWrites(rel(f), readFileSync(f, 'utf8')));

/**
 * The UPDATE writers of financial_transactions / ledger_entries. None of them
 * changes an amount, an account or a side: the ledger is append-only and a
 * correction is a reversal. A new entry here needs the same justification.
 */
const UPDATE_INVENTORY: Array<{ write: string; why: string }> = [
  {
    write: 'apps/server/src/modules/finance/posting.service.ts FinancialTransaction.update',
    why: 'PostingService.reverse marks the original REVERSED in the reversal\'s own transaction',
  },
  {
    write: 'apps/server/src/modules/finance/accounting-period.service.ts FinancialTransaction.update',
    why: 'close(): stamps metadata.lockedByPeriod on the period\'s transactions',
  },
  {
    write: 'apps/server/src/modules/finance/accounting-period.service.ts FinancialTransaction.update',
    why: 'reopen(): clears metadata.lockedByPeriod',
  },
  {
    write: 'apps/server/src/modules/finance/reconciliation.service.ts LedgerEntry.updateMany',
    why: 'ReconciliationService.complete sets lockedByReconciliationId (the lock PostingService.reverse enforces)',
  },
];

describe('V1-15 ledger write door: one INSERT path into the ledger (CF-40)', () => {
  it('reads the server source and finds the door itself (this gate is not vacuous)', () => {
    expect(FILES.length, 'apps/server/src walker found no source files').toBeGreaterThan(300);
    const door = WRITES.filter((w) => w.file === DOOR && w.kind === 'insert');
    // post() and reverse() each create one FinancialTransaction with nested entries.
    expect(door.filter((w) => w.op === 'create').length, 'the scanner no longer sees PostingService.post/reverse').toBe(2);
    expect(door.filter((w) => w.op === 'nested create').length).toBe(2);
  });

  it('LWI-01: no FinancialTransaction or LedgerEntry INSERT outside posting.service.ts (expense void included)', () => {
    expect(insertsOutsideDoor(WRITES)).toEqual([]);
  });

  it('LWI-02: the UPDATE writers are exactly the inventory; nothing DELETEs ledger rows or reaches the delegates by a computed name', () => {
    const updates = WRITES.filter((w) => w.kind === 'update').map((w) => `${w.file} ${w.model}.${w.op}`).sort();
    expect(updates.length, 'the scanner sees no ledger UPDATE at all').toBeGreaterThan(0);
    expect(updates, 'a new ledger UPDATE writer needs an inventory entry and a reason').toEqual(
      UPDATE_INVENTORY.map((u) => u.write).sort(),
    );
    const deletes = WRITES.filter((w) => w.kind === 'delete' || w.kind === 'dynamic').map((w) => `${w.file}:${w.line} ${w.model}.${w.op}`);
    expect(deletes, 'ledger rows are append-only: reverse, never delete').toEqual([]);
  });

  it('LWI-03: an injected writer outside the door fails, naming the file and line (scanner self-test)', () => {
    const file = 'apps/server/src/modules/rogue/rogue-ledger.service.ts';
    const injected = [
      'export class RogueLedger {',
      '  // tx.ledgerEntry.create({ data }) in a comment is not a writer',
      '  async run(tx: any) {',
      '    await tx.ledgerEntry.create({ data: {} });',
      '    await this.prisma.client.financialTransaction.createMany({ data: [] });',
      '    await tx.financialTransaction.update({ where: { id: "x" }, data: { entries: { create: [] } } });',
      '    await tx.$executeRawUnsafe(`INSERT INTO "ledger_entries" (id) VALUES ($1)`, "x");',
      '    await tx.ledgerEntry.deleteMany({});',
      "    await (tx as any)['financialTransaction'].create({});",
      '  }',
      '}',
    ].join('\n');
    const writes = scanLedgerWrites(file, injected);
    expect(insertsOutsideDoor(writes)).toEqual([
      `${file}:4 LedgerEntry.create writes the ledger outside ${DOOR}; post or reverse through PostingService`,
      `${file}:5 FinancialTransaction.createMany writes the ledger outside ${DOOR}; post or reverse through PostingService`,
      `${file}:6 LedgerEntry.nested create writes the ledger outside ${DOOR}; post or reverse through PostingService`,
      `${file}:7 LedgerEntry.raw insert into writes the ledger outside ${DOOR}; post or reverse through PostingService`,
    ]);
    expect(writes.filter((w) => w.kind === 'update').map((w) => w.line)).toEqual([6]);
    expect(writes.filter((w) => w.kind === 'delete').map((w) => w.line)).toEqual([8]);
    expect(writes.filter((w) => w.kind === 'dynamic').map((w) => w.line)).toEqual([9]);
    // The same text inside the door is allowed.
    expect(insertsOutsideDoor(scanLedgerWrites(DOOR, injected))).toEqual([]);
  });

  it('LWI-04: the posting door consults the accounting periods, and every module that provides it provides them', () => {
    // Constructor dependency, as Nest sees it (@Inject records self:paramtypes).
    const deps: Array<{ index: number; param: unknown }> = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, PostingService) ?? [];
    expect(
      deps.map((d) => d.param),
      'PostingService does not take AccountingPeriodService: a CLOSED period is never consulted when posting',
    ).toContain(AccountingPeriodService);

    // The dependency is optional so hand-built PostingService instances in unit
    // specs keep working; this keeps it from being silently absent in the app.
    const optional: number[] = Reflect.getMetadata(OPTIONAL_DEPS_METADATA, PostingService) ?? [];
    const periodIndex = deps.find((d) => d.param === AccountingPeriodService)?.index;
    if (periodIndex !== undefined && optional.includes(periodIndex)) {
      const modules = FILES.filter((f) => f.endsWith('.module.ts'));
      expect(modules.length).toBeGreaterThan(20);
      const providing = modules.filter((f) => /providers\s*:\s*\[[^\]]*(?<![A-Za-z])PostingService\b/.test(readFileSync(f, 'utf8')));
      expect(providing.map(rel), 'no module provides PostingService: the scan is broken').toContain(
        'apps/server/src/modules/finance/finance.module.ts',
      );
      const missing = providing
        .filter((f) => !/providers\s*:\s*\[[^\]]*\bAccountingPeriodService\b/.test(readFileSync(f, 'utf8')))
        .map(rel);
      expect(missing, 'a module provides PostingService without AccountingPeriodService: closed periods would not be enforced there').toEqual([]);
    }
  });
});

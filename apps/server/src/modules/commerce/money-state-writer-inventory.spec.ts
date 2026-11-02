/**
 * V1-15-DM-LEDGER-WRITE-DOOR — money-state writer ratchet.
 *
 * A Payment row is money state: computeBalance reads it to decide what an
 * invoice still owes, and the ledger posting that should accompany it is the
 * caller's responsibility. Every place that creates, updates or deletes one is
 * a place where the payment and the books can disagree (M27: a DRAFT invoice
 * accepted money; CF-09: mark-paid wrote an unposted payment; M32: untrusted
 * evidence settled money). Those were found by reading the code. This file
 * makes the next writer visible without reading it: the Payment writers in
 * apps/server/src are an exact inventory, per file and operation.
 *
 *   MSW-01  every Payment writer is in the inventory, at its recorded count; a
 *           new writer (or a new call site in a listed file) fails, naming
 *           file:line.
 *   MSW-02  a writer that disappears fails too: lower the inventory (it only
 *           shrinks without review).
 *   MSW-03  an injected payment.create outside the inventory fails, naming the
 *           file (scanner self-test).
 *
 * Forms read: `<x>.payment.<op>(` (create, createMany, createManyAndReturn,
 * upsert, update, updateMany, updateManyAndReturn, delete, deleteMany), a
 * nested `payments: { <op> }` under another model, raw INSERT / UPDATE /
 * DELETE on the payments table, and `['payment']` computed delegate access.
 * Not read: a delegate reached through a destructured or aliased variable, and
 * a table name computed at runtime. Full-line comments are skipped.
 *
 * The ledger side of the same rule (FinancialTransaction / LedgerEntry inserts
 * only through PostingService) is apps/server/src/modules/finance/ledger-writer-integrity.spec.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER = join(__dirname, '..', '..', '..');
const REPO = join(SERVER, '..', '..');
const SRC = join(SERVER, 'src');

export interface MoneyWrite {
  file: string;
  line: number;
  op: string;
}

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
  /\??\.\s*payment\s*\??\.\s*(createManyAndReturn|createMany|create|upsert|updateManyAndReturn|updateMany|update|deleteMany|delete)\s*\(/g;
const NESTED_WRITE = /\bpayments\s*:\s*\{\s*(createMany|create|connectOrCreate|upsert|updateMany|update|deleteMany|delete)\b/g;
const RAW_WRITE = /\b(insert\s+into|update|delete\s+from)\s+(?:"?public"?\.)?"?payments\b/gi;
/** A computed member access (`tx['payment']`), not an array literal (`['payment']`). */
const DYNAMIC_DELEGATE = /(?<=[\w$)\]])\s*\[\s*(['"`])payment\1\s*\]/g;

/** Every Payment write in one source file. `file` is repo-relative. */
export function scanMoneyWrites(file: string, source: string): MoneyWrite[] {
  const src = codeLines(source);
  const out: MoneyWrite[] = [];
  for (const m of src.matchAll(DELEGATE_WRITE)) out.push({ file, line: lineAt(src, m.index ?? 0), op: m[1] });
  for (const m of src.matchAll(NESTED_WRITE)) out.push({ file, line: lineAt(src, m.index ?? 0), op: `nested ${m[1]}` });
  for (const m of src.matchAll(RAW_WRITE)) {
    out.push({ file, line: lineAt(src, m.index ?? 0), op: `raw ${m[1].toLowerCase().replace(/\s+/g, ' ')}` });
  }
  for (const m of src.matchAll(DYNAMIC_DELEGATE)) out.push({ file, line: lineAt(src, m.index ?? 0), op: 'computed delegate' });
  return out.sort((a, b) => a.line - b.line);
}

type Inventory = Record<string, { ops: Record<string, number>; why: string }>;

/**
 * The Payment writers at V1-15. Each entry says why the file writes money
 * state; the counts are exact.
 */
export const MONEY_STATE_WRITERS: Inventory = {
  'apps/server/src/modules/commerce/commerce.service.ts': {
    ops: { create: 3, update: 2 },
    why:
      'recordPayment (manual payment + posting + reconcile in one transaction, R0-PL-03); markPaymentRefunded ' +
      '(V1-29, D-14: a separate negative REFUNDED row linked to the kept SUCCESSFUL original + reversal + reconcile ' +
      'in one transaction; the compare-and-set flip to REFUNDED it replaced is gone); retryPayment (FAILED -> PENDING); ' +
      'recordPublicPaymentIntent (PENDING intent row: create, or amount update on the existing intent)',
  },
  'apps/server/src/modules/payments/payments.service.ts': {
    ops: { create: 8 },
    why:
      'provider settlement: createPaymentWithPosting / createRefundWithPosting(ByInvoice) (row + posting in one ' +
      'transaction), WiPay callback, store payment, PayPal capture',
  },
  'apps/server/src/modules/payments/payments-ops.service.ts': {
    ops: { create: 1 },
    why: 'refundCharge: provider refund row',
  },
  'apps/server/src/modules/site/store-order.service.ts': {
    ops: { create: 1 },
    why: 'completeCheckout: storefront order payment',
  },
};

/** Ratchet: findings against the inventory, as messages naming the file. */
export function compareToInventory(writes: MoneyWrite[], inventory: Inventory): string[] {
  const problems: string[] = [];
  const byFileOp = new Map<string, MoneyWrite[]>();
  for (const w of writes) {
    const key = `${w.file}\u0000${w.op}`;
    byFileOp.set(key, [...(byFileOp.get(key) ?? []), w]);
  }
  for (const [key, ws] of byFileOp) {
    const [file, op] = key.split('\u0000');
    const allowed = inventory[file]?.ops[op] ?? 0;
    if (!inventory[file]) {
      for (const w of ws) problems.push(`${w.file}:${w.line} writes Payment (${w.op}) outside the money-state writer inventory`);
    } else if (ws.length > allowed) {
      problems.push(
        `${file} has ${ws.length} Payment ${op} call site(s) at lines ${ws.map((w) => w.line).join(', ')}; the inventory allows ${allowed}`,
      );
    }
  }
  for (const [file, entry] of Object.entries(inventory)) {
    for (const [op, allowed] of Object.entries(entry.ops)) {
      const found = byFileOp.get(`${file}\u0000${op}`)?.length ?? 0;
      if (found < allowed) problems.push(`${file} now has ${found} Payment ${op} call site(s), the inventory records ${allowed}: lower it`);
    }
  }
  return problems.sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

const FILES = sourceFiles(SRC);
const WRITES = FILES.flatMap((f) => scanMoneyWrites(relative(REPO, f).split(sep).join('/'), readFileSync(f, 'utf8')));

describe('V1-15 money-state writer inventory (Payment rows)', () => {
  it('reads the server source and finds the known writers (this gate is not vacuous)', () => {
    expect(FILES.length, 'apps/server/src walker found no source files').toBeGreaterThan(300);
    expect(WRITES.length).toBeGreaterThan(10);
    expect(WRITES.map((w) => w.file)).toContain('apps/server/src/modules/commerce/commerce.service.ts');
  });

  it('MSW-01 / MSW-02: the Payment writers in apps/server/src are exactly the inventory', () => {
    expect(compareToInventory(WRITES, MONEY_STATE_WRITERS)).toEqual([]);
  });

  it('MSW-03: an injected payment.create outside the inventory fails, naming the file (scanner self-test)', () => {
    const file = 'apps/server/src/modules/rogue/rogue-settlement.service.ts';
    const injected = [
      'export class RogueSettlement {',
      '  // tx.payment.create({ data }) in a comment is not a writer',
      '  async settle(tx: any) {',
      "    return tx.payment.create({ data: { amount: 1, status: 'SUCCESSFUL' } });",
      '  }',
      '}',
    ].join('\n');
    expect(compareToInventory([...WRITES, ...scanMoneyWrites(file, injected)], MONEY_STATE_WRITERS)).toEqual([
      `${file}:4 writes Payment (create) outside the money-state writer inventory`,
    ]);

    // A new call site inside a listed file is caught by count, naming the file and lines.
    const extra = scanMoneyWrites('apps/server/src/modules/site/store-order.service.ts', 'x\n await this.prisma.client.payment.update({});');
    const grown = compareToInventory([...WRITES, ...extra], MONEY_STATE_WRITERS);
    expect(grown).toHaveLength(1);
    expect(grown[0]).toMatch(/^apps\/server\/src\/modules\/site\/store-order\.service\.ts has 1 Payment update call site\(s\) at lines 2; the inventory allows 0$/);

    // Nested, raw and computed forms are writers too.
    const forms = scanMoneyWrites(
      file,
      [
        'await tx.invoice.update({ data: { payments: { create: { amount: 1 } } } });',
        'await tx.$executeRaw`UPDATE payments SET status = ${s}`;',
        "await (tx as any)['payment'].upsert({});",
      ].join('\n'),
    );
    expect(forms.map((w) => `${w.line} ${w.op}`)).toEqual(['1 nested create', '2 raw update', '3 computed delegate']);

    // A writer that disappears is a stale entry: the inventory shrinks with it.
    const fewer = WRITES.filter((w) => !(w.file.endsWith('payments-ops.service.ts') && w.op === 'create'));
    expect(compareToInventory(fewer, MONEY_STATE_WRITERS)).toEqual([
      'apps/server/src/modules/payments/payments-ops.service.ts now has 0 Payment create call site(s), the inventory records 1: lower it',
    ]);
  });
});

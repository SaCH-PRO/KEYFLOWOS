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
  'apps/server/src/modules/commerce/payment-evidence.service.ts': {
    ops: { create: 1, updateMany: 1 },
    why:
      'V1-41 (M32, D-27): recordPendingPayment writes an evidence-extracted or Drive-intake payment PENDING (no ' +
      'posting, no balance move); confirmPendingPayment records the money through recordPayment as the confirming ' +
      'member and retires the pending row PENDING -> CONFIRMED (compare-and-set on status)',
  },
  'apps/server/src/modules/payments/payments.service.ts': {
    ops: { create: 5 },
    why:
      'provider settlement: createPaymentWithPosting / createRefundWithPosting(ByInvoice) (row + posting in one ' +
      'transaction); FAILED records (PayPal capture; the WiPay callback writes none since V1-05); the CASH / MANUAL PENDING ' +
      'store checkout intent (the Stripe store checkout writes none since the trial-N review, G6ML-4). ' +
      'Per function: PAYMENTS_MODULE_WRITERS below (V1-15c). payments-ops.service.ts writes none since ' +
      'W10-REFUND-CHARGE-DOOR (D-14): refundCharge records through createRefundWithPosting (PAYMENTS_MODULE_DOOR_CALLERS)',
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
    // (W10-REFUND-CHARGE-DOOR: payments-ops.service.ts, the example before, writes none any more.)
    const fewer = WRITES.filter((w) => !(w.file.endsWith('store-order.service.ts') && w.op === 'create'));
    expect(compareToInventory(fewer, MONEY_STATE_WRITERS)).toEqual([
      'apps/server/src/modules/site/store-order.service.ts now has 0 Payment create call site(s), the inventory records 1: lower it',
    ]);
  });
});

/**
 * V1-15c-PAYMENT-INGRESS-AND-READERS — the payments module's Payment writers,
 * by the function that holds each one. MONEY_STATE_WRITERS counts call sites
 * per file, and its entry for the payments module allowed refundCharge,
 * createStorePayment and capturePaypalOrder to write Payment rows with no
 * posting without saying so. Here every writer in apps/server/src/modules/payments
 * is one of:
 *
 *   door      the row and its ledger posting in one transaction (the function
 *             runs a $transaction and calls RevenuePostingService.onPayment*)
 *   no-money  only PENDING or FAILED rows, each with its status written as a
 *             literal: nothing moved, nothing to post until it settles
 *   unposted  money state written without a posting: listed with its reason
 *             and the packet that owns routing it through the door, which an
 *             it.todo below names (no silent allowance)
 *
 *   MSW-04  every Payment writer of the module is classified by its function;
 *           each class is checked against the source; a stale entry fails
 *   MSW-05  capturePaypalOrder records a captured payment through the door
 *           (createPaymentWithPosting); its only direct write is the FAILED
 *           record of a capture that failed, and it sits before the door call
 *           (in the capture call's catch), so a recording that aborts after
 *           PayPal completed the capture never reaches it (review SEC-V15C-2;
 *           the behaviour is LWD-25 / LWD-25c)
 *   MSW-06  every todo names an owning packet that is in the build map
 */
const PAYMENTS_MODULE = 'apps/server/src/modules/payments/';

type WriterClass =
  | { kind: 'door'; why: string }
  | { kind: 'no-money'; why: string; todo?: { owner: string; what: string } }
  | { kind: 'unposted'; why: string; todo: { owner: string; what: string } };

export const PAYMENTS_MODULE_WRITERS: Record<string, WriterClass> = {
  'apps/server/src/modules/payments/payments.service.ts#createPaymentWithPosting': {
    kind: 'door',
    why: 'provider settlements (Stripe, PayPal webhooks and capture, WiPay callback): row + onPaymentRecorded in one transaction',
  },
  'apps/server/src/modules/payments/payments.service.ts#createRefundWithPosting': {
    kind: 'door',
    why: 'provider refunds keyed by the original capture: negative REFUNDED row + onPaymentRefunded in one transaction',
  },
  'apps/server/src/modules/payments/payments.service.ts#createRefundWithPostingByInvoice': {
    kind: 'door',
    why: 'provider refunds without the capture id: the same, the original resolved by invoice',
  },
  'apps/server/src/modules/payments/payments.service.ts#capturePaypalOrder': {
    kind: 'no-money',
    why:
      'the FAILED record of a PayPal capture call that failed (PayPal took nothing); a COMPLETED capture goes through ' +
      'createPaymentWithPosting (V1-15c) and is never recorded FAILED, even when that transaction aborts (review SEC-V15C-2, CR-V15C-1)',
  },
  'apps/server/src/modules/payments/payments.service.ts#createStorePayment': {
    kind: 'no-money',
    why:
      'the PENDING checkout intent of a CASH / MANUAL storefront order; the settled row is written through the door by ' +
      'StoreOrderService.completeCheckout (the offline completion). The Stripe store checkout writes no intent since the ' +
      'trial-N review (G6ML-4)',
    todo: {
      owner: 'V1-33-PUB-CHECKOUT-RETRY-OFFLINE',
      what:
        'the intent puts the MarketplaceOrder id in payments.invoice_id, which has a foreign key to invoices, so the write ' +
        'fails for a storefront order, and nothing settles or retires a PENDING intent. The storefront checkout never ' +
        'reaches it (CASH / MANUAL start no session); only the generic checkout with a cash or manual gateway does, and gets 500',
    },
  },
};

/**
 * W10-REFUND-CHARGE-DOOR (SOT-10b; the V1-29 refund convention, D-14, D-102):
 * the payments module's money writes that reach a door by calling it, with no
 * Payment write of their own. payments-ops refundCharge was 'unposted' here
 * (its owner V1-29-DM-REFUND-CONVENTION, an it.todo): it wrote the provider
 * refund's negative REFUNDED row itself, with no reversal of the original
 * posting, and the provider refund webhook then found the row by its refund id
 * and posted nothing either. It now records through the refund door.
 *
 *   MSW-07  each caller writes no Payment row itself and calls its door method;
 *           the door method writes none either and records through a function
 *           PAYMENTS_MODULE_WRITERS classifies as door
 */
export const PAYMENTS_MODULE_DOOR_CALLERS: Record<string, { calls: string; door: string; why: string }> = {
  'apps/server/src/modules/payments/payments-ops.service.ts#refundCharge': {
    calls: 'apps/server/src/modules/payments/payments.service.ts#recordGatewayRefund',
    door: 'createRefundWithPosting',
    why:
      'the operator / KEY provider refund: the linked negative REFUNDED row and onPaymentRefunded in one transaction ' +
      '(deduped on the refund id, so the provider refund webhook then writes and posts nothing), then the reconcile that ' +
      'reopens the invoice (D-14, D-102)',
  },
};

/** MSW-07: findings for the door callers against the source. */
export function compareDoorCallers(
  files: Record<string, string>,
  callers: Record<string, { calls: string; door: string }>,
  classes: Record<string, WriterClass>,
): string[] {
  const problems: string[] = [];
  for (const [key, c] of Object.entries(callers)) {
    const [file, fn] = key.split('#');
    const [doorFile, method] = c.calls.split('#');
    const body = memberSource(files[file] ?? '', fn);
    const doorBody = memberSource(files[doorFile] ?? '', method);
    if (!body) problems.push(`${key} is not in the source`);
    if (writeSites(file, files[file] ?? '').some((s) => s.fn === fn)) problems.push(`${key} writes Payment itself`);
    if (!new RegExp(`\\.\\s*${method}\\s*\\(`).test(body)) problems.push(`${key} does not call ${method}`);
    if (!doorBody) problems.push(`${c.calls} is not in the source`);
    if (writeSites(doorFile, files[doorFile] ?? '').some((s) => s.fn === method)) problems.push(`${c.calls} writes Payment itself`);
    if (!new RegExp(`this\\.${c.door}\\s*\\(`).test(doorBody)) problems.push(`${c.calls} does not record through ${c.door}`);
    if (classes[`${doorFile}#${c.door}`]?.kind !== 'door') problems.push(`${doorFile}#${c.door} is not classified door`);
  }
  return problems.sort();
}

interface WriteSite extends MoneyWrite {
  fn: string;
  /** Status literals written by the call (`status: 'X'`); empty when the data is not a literal. */
  statuses: string[];
}

/** A class member declaration at the member indent (two spaces). */
const MEMBER_DECL =
  /^ {2}(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\(/;
const NOT_A_MEMBER = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'function', 'new', 'typeof']);

/** The class members of a source file: name and [start, end) line range of each (1-based). */
function members(source: string): Array<{ name: string; start: number; end: number }> {
  const lines = codeLines(source).split('\n');
  const decls: Array<{ name: string; start: number }> = [];
  lines.forEach((l, i) => {
    const m = MEMBER_DECL.exec(l);
    if (m && !NOT_A_MEMBER.has(m[1])) decls.push({ name: m[1], start: i + 1 });
  });
  return decls.map((d, i) => ({ ...d, end: decls[i + 1]?.start ?? lines.length + 1 }));
}

/** The text of the call whose `(` is at `open`. */
function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** Every delegate Payment write of one file, with the member that holds it and the statuses it writes. */
export function writeSites(file: string, source: string): WriteSite[] {
  const src = codeLines(source);
  const ms = members(source);
  const out: WriteSite[] = [];
  for (const m of src.matchAll(DELEGATE_WRITE)) {
    const index = m.index ?? 0;
    const line = lineAt(src, index);
    const fn = ms.find((x) => line >= x.start && line < x.end)?.name ?? '<top level>';
    const text = callText(src, index + m[0].length - 1);
    out.push({ file, line, op: m[1], fn, statuses: [...text.matchAll(/\bstatus\s*:\s*'([A-Z_]+)'/g)].map((s) => s[1]) });
  }
  return out;
}

/** The source of one member of a file (comments blanked). */
function memberSource(source: string, name: string): string {
  const m = members(source).find((x) => x.name === name);
  if (!m) return '';
  return codeLines(source).split('\n').slice(m.start - 1, m.end - 1).join('\n');
}

/** MSW-04: findings for a module's Payment writers against their classification. */
export function compareToClassification(files: Record<string, string>, classes: Record<string, WriterClass>): string[] {
  const problems: string[] = [];
  const sites = Object.entries(files).flatMap(([file, source]) => writeSites(file, source));
  for (const [file, source] of Object.entries(files)) {
    const scanned = scanMoneyWrites(file, source).length;
    const attributed = sites.filter((s) => s.file === file).length;
    if (scanned !== attributed) {
      problems.push(
        `${file}: ${scanned} Payment write(s), ${attributed} attributed to a function (a nested, raw or computed write is not classifiable)`,
      );
    }
  }
  for (const s of sites) {
    const key = `${s.file}#${s.fn}`;
    const c = classes[key];
    if (!c) {
      problems.push(`${s.file}:${s.line} (${s.fn}) writes Payment (${s.op}) and is not classified`);
    } else if (c.kind === 'no-money' && (s.statuses.length === 0 || s.statuses.some((st) => st !== 'PENDING' && st !== 'FAILED'))) {
      problems.push(`${s.file}:${s.line} (${s.fn}) is classified no-money but writes status ${s.statuses.join('/') || '<not a literal>'}`);
    }
  }
  for (const [key, c] of Object.entries(classes)) {
    const [file, fn] = key.split('#');
    if (!sites.some((s) => s.file === file && s.fn === fn)) {
      problems.push(`${key} is classified but writes no Payment row: remove it`);
    } else if (c.kind === 'door') {
      const body = memberSource(files[file] ?? '', fn);
      if (!/\$transaction\s*\(/.test(body) || !/revenuePosting\s*\.\s*onPayment(Recorded|Refunded)\s*\(/.test(body)) {
        problems.push(`${key} is classified door but does not post in its transaction`);
      }
    }
  }
  return problems.sort();
}

const MODULE_FILES: Record<string, string> = Object.fromEntries(
  FILES.map((f) => [relative(REPO, f).split(sep).join('/'), f] as const)
    .filter(([rel]) => rel.startsWith(PAYMENTS_MODULE))
    .map(([rel, f]) => [rel, readFileSync(f, 'utf8')]),
);

describe('V1-15c Payment writers of the payments module, by function (no silent allowance)', () => {
  it('reads the payments module and attributes its writers (this gate is not vacuous)', () => {
    const sites = Object.entries(MODULE_FILES).flatMap(([file, source]) => writeSites(file, source));
    // W10-REFUND-CHARGE-DOOR: refundCharge writes no Payment row any more (MSW-07); createRefundWithPosting is its door.
    expect(sites.map((s) => s.fn)).toEqual(expect.arrayContaining(['createPaymentWithPosting', 'createRefundWithPosting', 'createStorePayment']));
  });

  it('MSW-04: every Payment writer of the payments module is classified, and each class holds in the source', () => {
    expect(compareToClassification(MODULE_FILES, PAYMENTS_MODULE_WRITERS)).toEqual([]);
  });

  it('MSW-04: the check fails a SUCCESSFUL row written outside the door, an unclassified writer and a stale entry (self-test)', () => {
    const file = `${PAYMENTS_MODULE}rogue.service.ts`;
    const source = [
      'export class Rogue {',
      '  async settle(tx: any) {',
      "    await tx.payment.create({ data: { amount: 1, status: 'SUCCESSFUL' } });",
      '  }',
      '',
      '  async intend(tx: any) {',
      "    await tx.payment.create({ data: { amount: 1, status: 'PENDING' } });",
      '  }',
      '}',
    ].join('\n');
    expect(
      compareToClassification(
        { [file]: source },
        {
          [`${file}#settle`]: { kind: 'no-money', why: 'claims to move no money' },
          [`${file}#gone`]: { kind: 'door', why: 'stale' },
        },
      ),
    ).toEqual([
      `${file}#gone is classified but writes no Payment row: remove it`,
      `${file}:3 (settle) is classified no-money but writes status SUCCESSFUL`,
      `${file}:7 (intend) writes Payment (create) and is not classified`,
    ]);
  });

  it('MSW-05: capturePaypalOrder records a COMPLETED capture through createPaymentWithPosting; its only direct write is the FAILED record', () => {
    const file = `${PAYMENTS_MODULE}payments.service.ts`;
    const source = MODULE_FILES[file];
    const body = memberSource(source, 'capturePaypalOrder');
    expect(body).toMatch(/this\.createPaymentWithPosting\(/);
    expect(writeSites(file, source).filter((s) => s.fn === 'capturePaypalOrder').map((s) => s.statuses)).toEqual([['FAILED']]);
    // Review SEC-V15C-2: at 1504b037 the door call sat inside the capture's try, so its abort fell into the catch that writes FAILED.
    const failedWrite = body.search(/\.payment\s*\.\s*create\s*\(/);
    expect(failedWrite, 'the FAILED write (the capture call failed) comes before the door call (the capture completed)').toBeGreaterThan(-1);
    expect(failedWrite).toBeLessThan(body.search(/this\.createPaymentWithPosting\(/));
  });

  it('MSW-06: every todo names an owning packet that is in the build map, and every unposted writer has one', () => {
    const map = readFileSync(join(REPO, 'docs', 'reconstruction', 'BUILD-MAP-001.md'), 'utf8');
    const owners = Object.entries(PAYMENTS_MODULE_WRITERS).flatMap(([key, c]) => ('todo' in c && c.todo ? [[key, c.todo.owner]] : []));
    // W10-REFUND-CHARGE-DOOR: refundCharge's todo is closed (MSW-07 below), so createStorePayment's is the one left.
    expect(owners.map(([key]) => key)).toEqual(
      expect.arrayContaining(['apps/server/src/modules/payments/payments.service.ts#createStorePayment']),
    );
    for (const [key, owner] of owners) expect(map, `${key} names ${owner}`).toContain(`\`${owner}\``);
    for (const [key, c] of Object.entries(PAYMENTS_MODULE_WRITERS)) {
      if (c.kind === 'unposted') expect(c.todo?.owner, `${key} is unposted with no owning packet`).toMatch(/^V1-\d+[a-z]?-[A-Z0-9-]+$/);
    }
  });

  it('V1-29-DM-REFUND-CONVENTION: refundCharge records through the refund door (W10-REFUND-CHARGE-DOOR, D-14, was it.todo): it writes no Payment row itself and calls PaymentsService.recordGatewayRefund, which records through createRefundWithPosting (row + onPaymentRefunded in one transaction)', () => {
    const key = 'apps/server/src/modules/payments/payments-ops.service.ts#refundCharge';
    expect(PAYMENTS_MODULE_DOOR_CALLERS[key]).toMatchObject({
      calls: 'apps/server/src/modules/payments/payments.service.ts#recordGatewayRefund',
      door: 'createRefundWithPosting',
    });
    expect(PAYMENTS_MODULE_WRITERS[key], 'refundCharge is no longer classified as a writer').toBeUndefined();
    // MSW-07 over every door caller of the module.
    expect(compareDoorCallers(MODULE_FILES, PAYMENTS_MODULE_DOOR_CALLERS, PAYMENTS_MODULE_WRITERS)).toEqual([]);
    // Self-test: refundCharge as it was at 416696dc (the row written itself, no door call) fails both checks.
    const file = `${PAYMENTS_MODULE}payments-ops.service.ts`;
    const before = [
      'export class PaymentsOpsService {',
      '  async refundCharge(businessId: string) {',
      "    await this.prisma.client.payment.create({ data: { businessId, amount: -1, status: 'REFUNDED' } });",
      '  }',
      '}',
    ].join('\n');
    expect(compareDoorCallers({ ...MODULE_FILES, [file]: before }, PAYMENTS_MODULE_DOOR_CALLERS, PAYMENTS_MODULE_WRITERS)).toEqual([
      `${key} does not call recordGatewayRefund`,
      `${key} writes Payment itself`,
    ]);
  });

  for (const [key, c] of Object.entries(PAYMENTS_MODULE_WRITERS)) {
    if ('todo' in c && c.todo) it.todo(`${c.todo.owner}: ${key.split('#')[1]} (${c.kind}): ${c.todo.what}`);
  }
});

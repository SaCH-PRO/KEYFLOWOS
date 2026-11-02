/**
 * V1-42-DM-LIFECYCLE-OWNER-CAS — invoice status-writer ratchet (CF-39).
 *
 * InvoiceWorkflowService is the single owner of Invoice.status: it holds the
 * transition map, posts the accrual recognition on SENT / PENDING and its
 * reversal on VOID, stamps paidAt and posts COGS on PAID, and emits the
 * matching invoice.* event exactly once, after a compare-and-set write that
 * only one concurrent caller can win. A writer that sets the status anywhere
 * else skips all of that: the DelegationLoop's payment recovery raw-set
 * OVERDUE and emitted a flat `invoice.overdue` payload no listener reads; the
 * commerce `ai-execute` command raw-set PAID (no payment, no posting) and VOID
 * (no AR reversal, from any status); the AI undo raw-set an issued invoice
 * back to DRAFT with its receivable still open. Those were found by reading
 * the code. This file is the reading, run on every test run.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src):
 *   - every `<x>.invoice.update|updateMany|updateManyAndReturn|upsert(...)`
 *     call (also `<x>['invoice'].<op>(`), and the keys of its `data` (for
 *     upsert: `update` and `create`). An object literal is read key by key,
 *     spreads and conditional spreads included; an identifier is resolved in
 *     the enclosing function (its initializer, and every `name.key =` /
 *     `name['key'] =` assignment). A computed key, a parameter or any other
 *     expression the reader cannot see into is OPAQUE.
 *   - a nested write under another model: `invoice: { update | updateMany |
 *     upsert: ... }` (or `invoices:`), read the same way.
 *   - raw SQL in a string or template literal: `UPDATE invoices SET ... status`.
 *
 * A writer is a status writer when it writes `status` or is opaque. Writers
 * are keyed `<file under src>#<Class>.<method>`. The owner
 * (InvoiceWorkflowService in invoice-workflow.service.ts) is not counted.
 * Creates are not read: a create sets an initial status, it is not a move of
 * an existing row (creating an invoice straight into a later state is a
 * separate question, not this ratchet's).
 *
 * WHAT IS REQUIRED:
 *   ISW-01 every status writer outside the owner is in BYPASS_ALLOWLIST, with
 *          exactly the writes recorded there; a new one fails, naming it.
 *   ISW-02 every allow-list entry still matches a writer (a fixed writer is
 *          removed from the list), and the list never grows: it is at most
 *          ALLOWLIST_CEILING entries. Lower the ceiling with the list; never
 *          raise it.
 *   ISW-03 no writer in a V1-42 write-set file bypasses the workflow
 *          (DelegationLoopService, CommerceAiService, CommerceService).
 *   ISW-04 scanner self-test: injected writers in every form are found, and a
 *          non-status write is not.
 *
 * WHAT THIS CANNOT DO: it cannot see a delegate reached through a
 * destructured or aliased variable (`const inv = tx.invoice; inv.update(...)`)
 * or a table name computed at runtime. Behaviour is proven on a real database
 * by test/invoice-transition-concurrency.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');
const OPAQUE = '<opaque>';
const OWNER = 'modules/commerce/invoice-workflow.service.ts#InvoiceWorkflowService';

const WRITE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'upsert']);
const RAW_STATUS_UPDATE = /\bupdate\s+(?:"?public"?\.)?"?invoices"?\s+set\b[\s\S]*?\bstatus\b/i;

export interface StatusWriter {
  key: string;
  line: number;
  writes: string[];
}

type Entry = { writes: string[]; why: string };

/**
 * The invoice status writers that still bypass the workflow, at V1-42. Each
 * is outside the V1-42 write set and names the packet that closes it.
 * Shrink-only: remove an entry when its writer moves into the workflow, and
 * lower ALLOWLIST_CEILING with it.
 */
export const BYPASS_ALLOWLIST: Record<string, Entry> = {
  'modules/finance/credit-note.service.ts#CreditNoteService.apply': {
    writes: ['status'],
    why:
      'Applying a credit note writes PARTIALLY_CREDITED / FULLY_CREDITED, statuses the transition map does not know. ' +
      'V1-44-DM-CREDIT-NOTE moves this into the workflow ("statuses owned by the workflow").',
  },
  'modules/trash/trash.controller.ts#TrashController.updateModel': {
    writes: [OPAQUE],
    why:
      'The generic trash restore writes whatever `data` it is handed (a parameter, so opaque). Its one caller passes ' +
      '{ deletedAt: null }: no status. Kept visible so a status written through it is a reviewed change.',
  },
};

/** The allow-list size at V1-42. It only goes down. */
export const ALLOWLIST_CEILING = 2;

/** The V1-42 write-set files: none of them may carry a bypassing status writer. */
const V1_42_WRITE_SET = [
  'modules/autopilot/delegation-loop.service.ts',
  'modules/commerce/commerce-ai.service.ts',
  'modules/commerce/commerce-ai.controller.ts',
  'modules/commerce/commerce.service.ts',
];

// --------------------------------------------------------------------------
// Reader
// --------------------------------------------------------------------------

function propName(name: ts.PropertyName | ts.MemberName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null; // computed
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x)) {
    x = x.expression;
  }
  return x;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isFunctionLike(p) && (p as ts.FunctionLikeDeclaration).body) return p;
    p = p.parent;
  }
  return undefined;
}

/** The keys an expression used as Prisma `data` writes, or OPAQUE. */
function readKeys(expr: ts.Expression, at: ts.Node, seen = new Set<ts.Node>()): Set<string> {
  const e = unwrap(expr);
  const out = new Set<string>();
  if (seen.has(e)) return out;
  seen.add(e);
  if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
        const n = propName(p.name);
        out.add(n ?? OPAQUE);
      } else if (ts.isSpreadAssignment(p)) {
        for (const k of readKeys(p.expression, at, seen)) out.add(k);
      } else {
        out.add(OPAQUE);
      }
    }
    return out;
  }
  if (ts.isConditionalExpression(e)) {
    for (const k of readKeys(e.whenTrue, at, seen)) out.add(k);
    for (const k of readKeys(e.whenFalse, at, seen)) out.add(k);
    return out;
  }
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    // `...(cond && { a })`: the object side is what can be spread.
    for (const k of readKeys(e.right, at, seen)) out.add(k);
    if (e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) for (const k of readKeys(e.left, at, seen)) out.add(k);
    return out;
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.UndefinedKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return out;
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return out;
    const fn = enclosingFunction(at);
    if (!fn) return new Set([OPAQUE]);
    let declared = false;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text) {
        declared = true;
        if (n.initializer) for (const k of readKeys(n.initializer, n, seen)) out.add(k);
      } else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left)) &&
        ts.isIdentifier(unwrap(n.left.expression)) &&
        (unwrap(n.left.expression) as ts.Identifier).text === e.text
      ) {
        if (ts.isPropertyAccessExpression(n.left)) out.add(n.left.name.text);
        else {
          const arg = unwrap(n.left.argumentExpression);
          out.add(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : OPAQUE);
        }
      } else if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.getText() === 'Object.assign' &&
        n.arguments[0] &&
        ts.isIdentifier(unwrap(n.arguments[0])) &&
        (unwrap(n.arguments[0]) as ts.Identifier).text === e.text
      ) {
        out.add(OPAQUE);
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    if (!declared) out.add(OPAQUE); // a parameter, a closure variable, an import
    return out;
  }
  return new Set([OPAQUE]);
}

function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propName(p.name) === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

/** The data keys of a delegate write's first argument. */
function writeKeys(op: string, arg: ts.Expression | undefined, at: ts.Node): Set<string> {
  if (!arg) return new Set([OPAQUE]);
  const a = unwrap(arg);
  if (!ts.isObjectLiteralExpression(a)) return new Set([OPAQUE]);
  const fields = op === 'upsert' ? ['update', 'create'] : ['data'];
  const out = new Set<string>();
  for (const f of fields) {
    const v = objectProp(a, f);
    if (v) for (const k of readKeys(v, at)) out.add(k);
  }
  if (a.properties.some((p) => ts.isSpreadAssignment(p))) out.add(OPAQUE);
  return out;
}

/** A nested `invoice(s): { update: ... }` value: `{ where, data }` or the data itself. */
function nestedKeys(value: ts.Expression, at: ts.Node): Set<string> {
  const v = unwrap(value);
  if (ts.isObjectLiteralExpression(v)) {
    const data = objectProp(v, 'data');
    if (data) return readKeys(data, at);
    const update = objectProp(v, 'update');
    if (update && objectProp(v, 'create')) return readKeys(update, at); // nested upsert
    return readKeys(v, at);
  }
  if (ts.isArrayLiteralExpression(v)) {
    const out = new Set<string>();
    for (const el of v.elements) for (const k of nestedKeys(el, at)) out.add(k);
    return out;
  }
  return new Set([OPAQUE]);
}

function ownerKey(rel: string, node: ts.Node): string {
  let method: string | null = null;
  let cls: string | null = null;
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (!method) {
      if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) method = propName(p.name) ?? '<computed>';
      else if (ts.isConstructorDeclaration(p)) method = 'constructor';
      else if (ts.isPropertyDeclaration(p)) method = propName(p.name) ?? '<computed>';
      else if (ts.isFunctionDeclaration(p)) method = p.name?.text ?? '<anonymous>';
    }
    if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) {
      cls = p.name?.text ?? '<anonymous class>';
      break;
    }
  }
  return `${rel}#${cls ?? '<module>'}.${method ?? '<top-level>'}`;
}

function isInvoiceDelegate(e: ts.Expression): boolean {
  const x = unwrap(e);
  if (ts.isPropertyAccessExpression(x)) return x.name.text === 'invoice';
  if (ts.isElementAccessExpression(x)) {
    const a = unwrap(x.argumentExpression);
    return (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === 'invoice';
  }
  return false;
}

/** Every Invoice status writer in one source file (`rel` is the path under src). */
export function scanStatusWriters(rel: string, source: string): StatusWriter[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Array<{ key: string; line: number; writes: Set<string> }> = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const record = (n: ts.Node, writes: Set<string>) => {
    const status = new Set([...writes].filter((k) => k === 'status' || k === OPAQUE || k === 'raw status'));
    if (status.size) found.push({ key: ownerKey(rel, n), line: lineOf(n), writes: status });
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee) && WRITE_OPS.has(callee.name.text) && isInvoiceDelegate(callee.expression)) {
        record(n, writeKeys(callee.name.text, n.arguments[0], n));
      }
    } else if (ts.isPropertyAssignment(n) && ['invoice', 'invoices'].includes(propName(n.name) ?? '')) {
      const v = unwrap(n.initializer);
      if (ts.isObjectLiteralExpression(v)) {
        for (const op of ['update', 'updateMany', 'upsert']) {
          const inner = objectProp(v, op);
          if (inner) record(n, nestedKeys(inner, n));
        }
      }
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      if (RAW_STATUS_UPDATE.test(n.getText(sf))) record(n, new Set(['raw status']));
      return; // a template's spans are inside its text already
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const byKey = new Map<string, StatusWriter>();
  for (const f of found) {
    const prev = byKey.get(f.key);
    const writes = new Set([...(prev?.writes ?? []), ...f.writes]);
    byKey.set(f.key, { key: f.key, line: prev?.line ?? f.line, writes: [...writes].sort() });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Ratchet: findings against the allow-list, as messages naming the writer. */
export function compareToAllowlist(writers: StatusWriter[], allowlist: Record<string, Entry>): string[] {
  const problems: string[] = [];
  const outside = writers.filter((w) => !w.key.startsWith(`${OWNER}.`));
  for (const w of outside) {
    const entry = allowlist[w.key];
    const at = `${w.key.split('#')[0]}:${w.line}`;
    if (!entry) {
      problems.push(`${w.key} (${at}) writes Invoice.status [${w.writes.join(', ')}] outside InvoiceWorkflowService`);
    } else if (JSON.stringify([...entry.writes].sort()) !== JSON.stringify(w.writes)) {
      problems.push(`${w.key} (${at}) writes [${w.writes.join(', ')}]; the allow-list records [${[...entry.writes].sort().join(', ')}]`);
    }
  }
  const keys = new Set(outside.map((w) => w.key));
  for (const k of Object.keys(allowlist)) {
    if (!keys.has(k)) problems.push(`${k} no longer writes Invoice.status: remove it from the allow-list and lower ALLOWLIST_CEILING`);
  }
  return problems.sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.ts$/.test(d.name) && !/\.(spec|test)\.ts$/.test(d.name) && !d.name.endsWith('.d.ts') ? [p] : [];
  });
}

const FILES = sourceFiles(SRC);
const WRITERS = FILES.flatMap((f) => scanStatusWriters(relative(SRC, f).split(sep).join('/'), readFileSync(f, 'utf8')));

describe('V1-42 invoice status writers: InvoiceWorkflowService is the single owner', () => {
  it('reads the server source and finds the owner (this gate is not vacuous)', () => {
    expect(FILES.length, 'apps/server/src walker found no source files').toBeGreaterThan(300);
    expect(WRITERS.some((w) => w.key.startsWith(`${OWNER}.`)), 'the workflow itself writes the status').toBe(true);
  });

  it('ISW-01 / ISW-02: every Invoice.status writer outside the workflow is exactly the allow-list', () => {
    expect(compareToAllowlist(WRITERS, BYPASS_ALLOWLIST)).toEqual([]);
  });

  it('ISW-02: the allow-list is shrink-only (at most ALLOWLIST_CEILING entries)', () => {
    expect(Object.keys(BYPASS_ALLOWLIST).length).toBeLessThanOrEqual(ALLOWLIST_CEILING);
    expect(ALLOWLIST_CEILING, 'the V1-42 ceiling; lower it, never raise it').toBeLessThanOrEqual(2);
  });

  it('ISW-03: no V1-42 write-set file writes Invoice.status around the workflow (DelegationLoop, CommerceAi, CommerceService)', () => {
    const bypass = WRITERS.filter((w) => V1_42_WRITE_SET.includes(w.key.split('#')[0])).map((w) => `${w.key} [${w.writes.join(', ')}]`);
    expect(bypass).toEqual([]);
    for (const k of Object.keys(BYPASS_ALLOWLIST)) expect(V1_42_WRITE_SET).not.toContain(k.split('#')[0]);
  });

  it('ISW-04: the scanner finds an injected writer in every form, and ignores a non-status write (self-test)', () => {
    const rel = 'modules/rogue/rogue-invoice.service.ts';
    const injected = [
      'export class RogueInvoice {',
      '  // tx.invoice.update({ data: { status: "PAID" } }) in a comment is not a writer',
      '  async direct(tx: any) {',
      "    await tx.invoice.update({ where: { id: 'i' }, data: { status: 'PAID', paidAt: new Date() } });",
      '  }',
      '  async viaVariable(tx: any, flag: boolean) {',
      '    const data: Record<string, unknown> = {};',
      "    if (flag) data.status = 'VOID';",
      '    await tx.invoice.updateMany({ where: { id: { in: [] } }, data });',
      '  }',
      '  async viaSpread(tx: any, flag: boolean) {',
      "    await (tx as any)['invoice'].update({ where: { id: 'i' }, data: { notes: 'x', ...(flag ? { status: 'SENT' } : {}) } });",
      '  }',
      '  async opaque(tx: any, data: any) {',
      "    await tx.invoice.update({ where: { id: 'i' }, data });",
      '  }',
      '  async nested(tx: any) {',
      "    await tx.booking.update({ where: { id: 'b' }, data: { invoice: { update: { status: 'OVERDUE' } } } });",
      '  }',
      '  async raw(tx: any, id: string) {',
      '    await tx.$executeRaw`UPDATE invoices SET status = ${"VOID"} WHERE id = ${id}`;',
      '  }',
      '  async harmless(tx: any) {',
      "    await tx.invoice.update({ where: { id: 'i', status: 'SENT' }, data: { receiptSentAt: new Date() } });",
      "    await tx.invoice.findMany({ where: { status: 'SENT' } });",
      "    await tx.invoice.create({ data: { status: 'DRAFT' } });",
      '  }',
      '}',
    ].join('\n');
    const scanned = scanStatusWriters(rel, injected);
    expect(scanned.map((w) => `${w.key.split('#')[1]} ${w.line} [${w.writes.join(', ')}]`)).toEqual([
      'RogueInvoice.direct 4 [status]',
      'RogueInvoice.nested 18 [status]',
      `RogueInvoice.opaque 15 [${OPAQUE}]`,
      'RogueInvoice.raw 21 [raw status]',
      'RogueInvoice.viaSpread 12 [status]',
      'RogueInvoice.viaVariable 9 [status]',
    ]);
    // Findings the injection adds (independent of what the tree holds today).
    const baseline = new Set(compareToAllowlist(WRITERS, BYPASS_ALLOWLIST));
    const added = (ws: StatusWriter[]) => compareToAllowlist(ws, BYPASS_ALLOWLIST).filter((p) => !baseline.has(p));
    const problems = added([...WRITERS, ...scanned]);
    expect(problems).toHaveLength(6);
    expect(problems[0]).toBe(`${rel}#RogueInvoice.direct (${rel}:4) writes Invoice.status [status] outside InvoiceWorkflowService`);

    // A stale entry fails too: the list shrinks with the code.
    const fewer = WRITERS.filter((w) => !w.key.startsWith('modules/trash/'));
    expect(added(fewer)).toEqual([
      'modules/trash/trash.controller.ts#TrashController.updateModel no longer writes Invoice.status: remove it from the allow-list and lower ALLOWLIST_CEILING',
    ]);

    // The owner's own writes are not counted.
    const owner = scanStatusWriters('modules/commerce/invoice-workflow.service.ts', readFileSync(join(__dirname, 'invoice-workflow.service.ts'), 'utf8'));
    expect(owner.length).toBeGreaterThan(0);
    expect(compareToAllowlist(owner, {})).toEqual([]);
  });
});

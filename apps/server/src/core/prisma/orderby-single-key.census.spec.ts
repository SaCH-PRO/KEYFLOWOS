/**
 * V1-63 (SWP-ORDERBY-SINGLE-KEY), sweep BUG-012 and BUG-036: a Prisma orderBy
 * object names one field.
 *
 * Prisma refuses an orderBy object with two fields at run time
 * (PrismaClientValidationError: 'Argument `orderBy`: Invalid value provided.
 * Expected SkillOrderByWithRelationInput[], provided Object'), and the route
 * answers 500. Settings > AI > Skills (AiSettingsService.listSkills,
 * `{ category: 'asc', name: 'asc' }`) and a customer's Tasks tab
 * (CrmTimelineService.listContactTasks, `{ dueDate: 'asc', createdAt: 'desc' }`)
 * failed on every visit. TypeScript accepts the shape (the generated input types
 * make every field optional), so nothing caught it before a person opened the
 * page. Two fields are an array, one object each, in order:
 * `[{ category: 'asc' }, { name: 'asc' }]`.
 *
 * Measured on Postgres 16 with the generated client (Prisma 6), so the rule is
 * Prisma's own and not a guess:
 *   - a top-level orderBy object, and each object of an orderBy array, takes at
 *     most one field (findMany and groupBy alike);
 *   - so does a relation's object inside it (`{ contact: { firstName, lastName } }`:
 *     'needs at most one argument') and an aggregate's (`{ _count: { a, b } }`:
 *     'needs exactly one argument');
 *   - the one object with two keys Prisma takes is a field's sort-and-nulls
 *     input, `{ dueDate: { sort: 'asc', nulls: 'last' } }`.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src
 * and packages/api/src; *.spec.ts and *.test.ts hold stand-ins, not queries):
 *   - every orderBy position: a property `orderBy: <expr>` (but not a JSON
 *     Schema's `properties: { orderBy: {...} }`, which describes a tool
 *     argument), a shorthand `{ orderBy }`, and an assignment `<x>.orderBy = <expr>`
 *     or `<x>['orderBy'] = <expr>`;
 *   - every value typed as a Prisma orderBy input: a variable, class field or
 *     `as`/`satisfies`/`<T>` whose type names `...OrderBy...Input`, and the
 *     returns of a function declared to return one;
 *   - every object literal of two or more members whose values are all sort
 *     directions ('asc', 'desc', `SortOrder.asc`, ...), wherever it is: such an
 *     object is an orderBy in all but name, even when it reaches Prisma through
 *     a helper this reading cannot follow.
 * An orderBy expression is followed through parentheses, type assertions, `!`,
 * `a ? b : c`, `a ?? b`, `a || b`, array elements and spreads, and a local name
 * to its declaration in scope: the initializer, every `name = <expr>`, and every
 * `name.key = <expr>` (a sort built key by key). A parameter, an import, a call
 * or a member read (`input.orderBy`) is opaque: counted, not judged.
 *
 * WHAT IS REQUIRED (OB-01): no orderBy object of more than one member, at the top
 * of an orderBy or as an array element, and none inside it but a sort-and-nulls
 * input. A spread counts as a member; a lone spread is followed. A sort built key
 * by key may set different keys only on paths that exclude each other (the two
 * branches of one `if`, or two `switch` cases of which the first ends in
 * `break`, `return`, `throw` or `continue`), and not beside a key its initializer
 * already has.
 *
 * OB-02 pins the two sweep sites in the shape the lists promise; OB-03 proves
 * the reading is not vacuous; OB-SELF runs the reader over sources that must and
 * must not fail.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const REPO = resolve(__dirname, '../../../../..');
const ROOTS = ['apps/server/src', 'packages/api/src'] as const;
const TEST_FILE = /\.(spec|test)\.ts$/;
const ORDER_BY_TYPE = /OrderBy\w*Input\b/;
const DIRECTIONS = new Set(['asc', 'desc']);

type Rule = 'orderBy' | 'typed' | 'built' | 'directions';
type Finding = { site: string; rule: Rule; keys: string[] };
type ScanResult = { findings: Finding[]; positions: number; opaque: number; schemaProperties: number };

function unwrap(e: ts.Expression): ts.Expression {
  for (;;) {
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e)
    ) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

function nameText(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const inner = unwrap(name.expression);
    return ts.isStringLiteralLike(inner) ? inner.text : undefined;
  }
  return undefined;
}

function memberKey(m: ts.ObjectLiteralElementLike): string {
  if (ts.isSpreadAssignment(m)) return `...${m.expression.getText()}`;
  return nameText(m.name) ?? `[${m.name.getText()}]`;
}

/** 'asc' / 'desc', or `SortOrder.asc` / `Prisma.SortOrder.desc`. */
function isDirection(e: ts.Expression): boolean {
  const u = unwrap(e);
  if (ts.isStringLiteralLike(u)) return DIRECTIONS.has(u.text);
  return ts.isPropertyAccessExpression(u) && DIRECTIONS.has(u.name.text) && /\bSortOrder$/.test(u.expression.getText());
}

/** `Class.method` (or the function, or `<module>`) a node sits in. */
function ownerOf(node: ts.Node): string {
  let member: string | undefined;
  let cls: string | undefined;
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (!member) {
      if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isPropertyDeclaration(n)) && n.name) member = nameText(n.name);
      else if (ts.isConstructorDeclaration(n)) member = 'constructor';
      else if (ts.isFunctionDeclaration(n) && n.name) member = n.name.text;
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isFunctionLike(unwrap(n.initializer))) member = n.name.text;
    }
    if ((ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.name) {
      cls = n.name.text;
      break;
    }
  }
  return [cls, member].filter(Boolean).join('.') || '<module>';
}

/** The declarations, assignments and key-by-key writes of every local name in a file. */
type FileIndex = {
  decls: Map<string, ts.VariableDeclaration[]>;
  params: Map<string, ts.ParameterDeclaration[]>;
  assigns: Map<string, ts.BinaryExpression[]>;
  keyed: Map<string, Array<{ node: ts.BinaryExpression; key: string }>>;
};

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function indexFile(sf: ts.SourceFile): FileIndex {
  const index: FileIndex = { decls: new Map(), params: new Map(), assigns: new Map(), keyed: new Map() };
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) push(index.decls, n.name.text, n);
    else if (ts.isParameter(n) && ts.isIdentifier(n.name)) push(index.params, n.name.text, n);
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = n.left;
      if (ts.isIdentifier(left)) push(index.assigns, left.text, n);
      else if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression)) {
        push(index.keyed, left.expression.text, { node: n, key: left.name.text });
      } else if (ts.isElementAccessExpression(left) && ts.isIdentifier(left.expression)) {
        const arg = unwrap(left.argumentExpression);
        push(index.keyed, left.expression.text, { node: n, key: ts.isStringLiteralLike(arg) ? arg.text : `[${arg.getText()}]` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return index;
}

/** The node a declaration is visible in: its block, or the function a parameter belongs to. */
function scopeOf(n: ts.Node): ts.Node {
  let s: ts.Node = n.parent;
  while (
    s &&
    !(ts.isBlock(s) || ts.isSourceFile(s) || ts.isCaseBlock(s) || ts.isModuleBlock(s) || ts.isFunctionLike(s) ||
      ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s))
  ) {
    s = s.parent;
  }
  return s;
}

const within = (outer: ts.Node, inner: ts.Node) => inner.pos >= outer.pos && inner.end <= outer.end;

/** True when `a` and `b` lie on paths of one statement that exclude each other. */
function exclusive(a: ts.Node, b: ts.Node): boolean {
  const pathA = new Set<ts.Node>();
  for (let n: ts.Node | undefined = a; n; n = n.parent) pathA.add(n);
  let childB: ts.Node = b;
  let lca: ts.Node | undefined = b.parent;
  while (lca && !pathA.has(lca)) {
    childB = lca;
    lca = lca.parent;
  }
  if (!lca) return false;
  let childA: ts.Node = a;
  while (childA.parent && childA.parent !== lca) childA = childA.parent;
  if (ts.isIfStatement(lca)) {
    return (childA === lca.thenStatement && childB === lca.elseStatement) || (childA === lca.elseStatement && childB === lca.thenStatement);
  }
  if (ts.isConditionalExpression(lca)) {
    return (childA === lca.whenTrue && childB === lca.whenFalse) || (childA === lca.whenFalse && childB === lca.whenTrue);
  }
  if (ts.isCaseBlock(lca) && childA !== childB && ts.isCaseOrDefaultClause(childA) && ts.isCaseOrDefaultClause(childB)) {
    const first = childA.pos < childB.pos ? childA : childB;
    const last = first.statements[first.statements.length - 1];
    return !!last && (ts.isBreakStatement(last) || ts.isReturnStatement(last) || ts.isThrowStatement(last) || ts.isContinueStatement(last));
  }
  return false;
}

/** Read one source file. `file` is the path the findings name. */
function scanSource(file: string, text: string): ScanResult {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const index = indexFile(sf);
  const result: ScanResult = { findings: [], positions: 0, opaque: 0, schemaProperties: 0 };
  const reported = new Set<number>();
  const seen = new Set<ts.Node>();

  const report = (node: ts.Node, rule: Rule, keys: string[]) => {
    const start = node.getStart(sf);
    if (reported.has(start)) return;
    reported.add(start);
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    result.findings.push({ site: `${file}:${line} ${ownerOf(node)}`, rule, keys });
  };

  /** An object at an orderBy's top (or an element of an orderBy array): one member. */
  const checkObject = (obj: ts.ObjectLiteralExpression, nested: boolean, rule: Rule) => {
    const members = obj.properties;
    const keys = members.map(memberKey);
    const sortInput = nested && members.every((m) => !ts.isSpreadAssignment(m)) && keys.every((k) => k === 'sort' || k === 'nulls');
    if (members.length > 1 && !sortInput) report(obj, rule, keys);
    const only = members.length === 1 ? members[0] : undefined;
    if (only && ts.isSpreadAssignment(only)) follow(only.expression, rule);
    for (const m of members) if (ts.isPropertyAssignment(m)) checkNested(m.initializer, rule);
  };

  /** A field's value inside an orderBy object: a relation's or an aggregate's object, or a sort-and-nulls input. */
  const checkNested = (value: ts.Expression, rule: Rule) => {
    const v = unwrap(value);
    if (ts.isObjectLiteralExpression(v)) checkObject(v, true, rule);
    else if (ts.isConditionalExpression(v)) {
      checkNested(v.whenTrue, rule);
      checkNested(v.whenFalse, rule);
    }
  };

  /** A sort built key by key on a local object (`const orderBy: any = {}; orderBy.x = ...`). */
  const checkBuilt = (decl: ts.VariableDeclaration, writes: Array<{ node: ts.BinaryExpression; key: string }>, rule: Rule) => {
    const init = decl.initializer ? unwrap(decl.initializer) : undefined;
    const initKeys = init && ts.isObjectLiteralExpression(init) ? init.properties.map(memberKey) : [];
    for (const w of writes) checkNested(w.node.right, rule);
    const keys = [...new Set([...initKeys, ...writes.map((w) => w.key)])];
    if (keys.length < 2) return;
    const clash =
      (initKeys.length > 0 && writes.some((w) => !initKeys.includes(w.key))) ||
      writes.some((a, i) => writes.slice(i + 1).some((b) => a.key !== b.key && !exclusive(a.node, b.node)));
    if (clash) report(decl, 'built', keys);
  };

  /**
   * The declaration (or parameter) a use of `name` at `at` binds to: the
   * innermost one whose scope holds it. Undefined for an import or a global.
   */
  const bindingOf = (name: string, at: ts.Node): ts.Node | undefined => {
    let best: { node: ts.Node; scope: ts.Node } | undefined;
    const consider = (node: ts.Node, scope: ts.Node) => {
      if (!within(scope, at)) return;
      if (!best || (scope.pos >= best.scope.pos && scope.end <= best.scope.end)) best = { node, scope };
    };
    for (const d of index.decls.get(name) ?? []) consider(d, scopeOf(d.parent));
    for (const p of index.params.get(name) ?? []) consider(p, p.parent);
    return best?.node;
  };

  /**
   * A local name used as an orderBy: its declaration in scope, and every
   * reassignment and keyed write bound to that same declaration (a same-named
   * declaration in an inner block has its own).
   */
  const resolveName = (id: ts.Identifier, rule: Rule) => {
    if (id.text === 'undefined') return;
    const decl = bindingOf(id.text, id);
    if (!decl || !ts.isVariableDeclaration(decl)) {
      result.opaque++; // an import, a global or a parameter
      return;
    }
    if (decl.initializer) follow(decl.initializer, rule);
    for (const a of index.assigns.get(id.text) ?? []) if (bindingOf(id.text, a) === decl) follow(a.right, rule);
    const writes = (index.keyed.get(id.text) ?? []).filter((w) => bindingOf(id.text, w.node) === decl);
    if (writes.length > 0) checkBuilt(decl, writes, rule);
  };

  /** An expression whose value is an orderBy. */
  const follow = (expr: ts.Expression, rule: Rule) => {
    const e = unwrap(expr);
    if (seen.has(e)) return;
    seen.add(e);
    if (ts.isObjectLiteralExpression(e)) checkObject(e, false, rule);
    else if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) follow(ts.isSpreadElement(el) ? el.expression : el, rule);
    } else if (ts.isConditionalExpression(e)) {
      follow(e.whenTrue, rule);
      follow(e.whenFalse, rule);
    } else if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) {
      if (e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) follow(e.left, rule);
      follow(e.right, rule);
    } else if (ts.isIdentifier(e)) resolveName(e, rule);
    else if (ts.isStringLiteralLike(e) || ts.isTemplateExpression(e) || e.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(e)) {
      // Not a Prisma orderBy (a Drive API sort string), or nothing.
    } else result.opaque++;
  };

  const typedOrderBy = (type: ts.TypeNode | undefined) => !!type && ORDER_BY_TYPE.test(type.getText(sf));

  const returnsOf = (fn: ts.SignatureDeclaration): ts.Expression[] => {
    const body = (fn as { body?: ts.Node }).body;
    if (!body) return [];
    if (!ts.isBlock(body)) return [body as ts.Expression];
    const out: ts.Expression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
      if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
    };
    ts.forEachChild(body, visit);
    return out;
  };

  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && nameText(n.name) === 'orderBy') {
      const holder = n.parent.parent;
      if (holder && ts.isPropertyAssignment(holder) && nameText(holder.name) === 'properties') {
        result.schemaProperties++; // a JSON Schema describing a tool argument named orderBy
      } else {
        result.positions++;
        follow(n.initializer, 'orderBy');
      }
    } else if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'orderBy') {
      result.positions++;
      resolveName(n.name, 'orderBy');
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = n.left;
      const key = ts.isPropertyAccessExpression(left)
        ? left.name.text
        : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(unwrap(left.argumentExpression))
          ? (unwrap(left.argumentExpression) as ts.StringLiteralLike).text
          : undefined;
      if (key === 'orderBy') {
        result.positions++;
        follow(n.right, 'orderBy');
      }
    }
    if ((ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n)) && n.initializer && typedOrderBy(n.type)) {
      result.positions++;
      follow(n.initializer, 'typed');
    }
    if ((ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) && typedOrderBy(n.type)) {
      result.positions++;
      follow(n.expression, 'typed');
    }
    if (ts.isFunctionLike(n) && typedOrderBy(n.type)) {
      for (const r of returnsOf(n)) {
        result.positions++;
        follow(r, 'typed');
      }
    }
    if (ts.isObjectLiteralExpression(n) && n.properties.length > 1) {
      if (n.properties.every((m) => ts.isPropertyAssignment(m) && isDirection(m.initializer))) report(n, 'directions', n.properties.map(memberKey));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return result;
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist') walk(p);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !TEST_FILE.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(join(REPO, root));
  return out.sort();
}

const repoPath = (abs: string) => relative(REPO, abs).split(sep).join('/');

function scanRoots() {
  const perRoot: Record<string, ScanResult & { files: number }> = {};
  const findings: Finding[] = [];
  for (const root of ROOTS) {
    const total: ScanResult & { files: number } = { findings: [], positions: 0, opaque: 0, schemaProperties: 0, files: 0 };
    for (const abs of sourceFiles(root)) {
      const r = scanSource(repoPath(abs), readFileSync(abs, 'utf8'));
      total.files++;
      total.positions += r.positions;
      total.opaque += r.opaque;
      total.schemaProperties += r.schemaProperties;
      total.findings.push(...r.findings);
    }
    perRoot[root] = total;
    findings.push(...total.findings);
  }
  return { perRoot, findings };
}

const PRODUCT = scanRoots();

const describeFindings = (fs: Finding[]) =>
  fs.map((f) => `  ${f.site} [${f.rule}] {${f.keys.join(', ')}}`).join('\n');

/** The orderBy of `Class.method` in a server source file, its text without spaces. */
function orderByOf(file: string, cls: string, method: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(join(REPO, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && nameText(n.name) === 'orderBy' && ownerOf(n) === `${cls}.${method}`) {
      out.push(n.initializer.getText(sf).replace(/\s+/g, '').replace(/,(?=[\]}])/g, ''));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('OB-01: no Prisma orderBy object names two fields (apps/server/src, packages/api/src)', () => {
  it('every orderBy object, array element, relation and aggregate names one field', () => {
    expect(
      PRODUCT.findings,
      `A Prisma orderBy object with more than one field answers 500 (PrismaClientValidationError). ` +
        `Write the fields as an array, one object each, in order ([{ a: 'asc' }, { b: 'desc' }]):\n${describeFindings(PRODUCT.findings)}`,
    ).toEqual([]);
  });
});

describe('OB-02: the two sweep sites sort by two fields, as an array (BUG-012, BUG-036)', () => {
  it("AiSettingsService.listSkills: by category, then by name (Settings > AI > Skills)", () => {
    expect(orderByOf('apps/server/src/modules/ai/ai-settings.service.ts', 'AiSettingsService', 'listSkills')).toEqual([
      "[{category:'asc'},{name:'asc'}]",
    ]);
  });

  it("CrmTimelineService.listContactTasks: by due date, then the newest first (a customer's Tasks tab)", () => {
    expect(orderByOf('apps/server/src/modules/crm/crm-timeline.service.ts', 'CrmTimelineService', 'listContactTasks')).toEqual([
      "[{dueDate:'asc'},{createdAt:'desc'}]",
    ]);
  });
});

describe('OB-03: the reading is not vacuous', () => {
  it('reads both trees and the orderBy positions in them', () => {
    const server = PRODUCT.perRoot['apps/server/src'];
    const api = PRODUCT.perRoot['packages/api/src'];
    expect(server.files).toBeGreaterThan(1000);
    expect(server.positions).toBeGreaterThan(1000);
    expect(api.files).toBeGreaterThan(10);
    expect(api.positions).toBeGreaterThan(10);
  });

  it("tells KEY's query tool schema (properties.orderBy) from a query", () => {
    expect(PRODUCT.perRoot['apps/server/src'].schemaProperties).toBeGreaterThanOrEqual(1);
  });
});

describe('OB-SELF: the reader fails what Prisma refuses and passes what it takes', () => {
  const head = `declare const db: any; declare const dir: 'asc' | 'desc'; declare const flag: boolean; declare const s: string; declare const Prisma: any;\n`;
  const findingsOf = (body: string) => scanSource('fixture.ts', head + body).findings;
  const ruleOf = (body: string) => findingsOf(body).map((f) => f.rule);

  const MUST_FAIL: Array<[string, string, Rule]> = [
    ['two fields in one object', `db.skill.findMany({ orderBy: { category: dir, name: dir } });`, 'orderBy'],
    ['two fields in an array element', `db.skill.findMany({ orderBy: [{ category: dir, name: dir }] });`, 'orderBy'],
    ['a relation with two fields', `db.task.findMany({ orderBy: { contact: { firstName: dir, lastName: dir } } });`, 'orderBy'],
    ['an aggregate with two fields', `db.task.groupBy({ by: ['a', 'b'], orderBy: { _count: { a: dir, b: dir } } });`, 'orderBy'],
    ['one branch of a conditional', `db.x.findMany({ orderBy: flag ? { a: dir } : { a: dir, b: dir } });`, 'orderBy'],
    ['a relation orderBy under include', `db.x.findMany({ include: { tasks: { orderBy: { a: dir, b: dir } } } });`, 'orderBy'],
    ['a local name', `function f() { const order = { a: dir, b: dir }; return db.x.findMany({ orderBy: order }); }`, 'orderBy'],
    ['a shorthand orderBy', `function f() { const orderBy = { a: dir, b: dir }; return db.x.findMany({ orderBy }); }`, 'orderBy'],
    ['a reassignment', `function f() { let orderBy: any = { a: dir }; if (flag) orderBy = { a: dir, b: dir }; return db.x.findMany({ orderBy }); }`, 'orderBy'],
    ['an args.orderBy assignment', `function f() { const args: any = {}; args.orderBy = { a: dir, b: dir }; return db.x.findMany(args); }`, 'orderBy'],
    ['args["orderBy"]', `function f() { const args: any = {}; args['orderBy'] = { a: dir, b: dir }; return db.x.findMany(args); }`, 'orderBy'],
    ['a spread beside a field', `function f() { const base = { a: dir }; return db.x.findMany({ orderBy: { ...base, b: dir } }); }`, 'orderBy'],
    ['a lone spread of two fields', `function f() { const base = { a: dir, b: dir }; return db.x.findMany({ orderBy: { ...base } }); }`, 'orderBy'],
    ['an element of an orderBy array by name', `function f() { const first = { a: dir, b: dir }; return db.x.findMany({ orderBy: [first, { c: dir }] }); }`, 'orderBy'],
    ['keys built on paths that meet', `function f() { const orderBy: any = {}; orderBy.a = dir; if (flag) orderBy.b = dir; return db.x.findMany({ orderBy }); }`, 'built'],
    [
      'keys built that meet, beside an inner block with its own declaration of the name',
      `function f() { if (flag) { const orderBy: any = {}; orderBy.a = dir; return db.x.findMany({ orderBy }); }\n` +
        `const orderBy: any = {}; orderBy.c = dir; orderBy.d = dir; return db.y.findMany({ orderBy }); }`,
      'built',
    ],
    ['a key built beside its initializer', `function f() { const orderBy: any = { a: dir }; if (flag) orderBy.b = dir; return db.x.findMany({ orderBy }); }`, 'built'],
    ['a switch case that falls through', `function f() { const orderBy: any = {}; switch (s) { case 'a': orderBy.a = dir; case 'b': orderBy.b = dir; break; } return db.x.findMany({ orderBy }); }`, 'built'],
    ['a typed constant', `const ORDER: Prisma.SkillOrderByWithRelationInput = { a: dir, b: dir };`, 'typed'],
    ['a typed array constant', `const ORDER: Prisma.SkillOrderByWithRelationInput[] = [{ a: dir, b: dir }];`, 'typed'],
    ['a type assertion', `const ORDER = { a: dir, b: dir } as Prisma.SkillOrderByWithRelationInput;`, 'typed'],
    ['a typed return', `function order(): Prisma.SkillOrderByWithRelationInput { return { a: dir, b: dir }; }`, 'typed'],
    ['sort directions anywhere', `function order() { return { category: 'asc', name: 'asc' as const }; }`, 'directions'],
    ['SortOrder members anywhere', `function order() { return { a: Prisma.SortOrder.asc, b: Prisma.SortOrder.desc }; }`, 'directions'],
  ];
  for (const [what, body, rule] of MUST_FAIL) {
    it(`fails: ${what}`, () => {
      expect(ruleOf(body)).toEqual([rule]);
    });
  }

  it('names the file, line, class and method of a finding, and its keys', () => {
    const f = scanSource(
      'apps/server/src/modules/ai/fixture.service.ts',
      `class FixtureService {\n  listThings(db: any) {\n    return db.thing.findMany({ orderBy: { category: 'asc', name: 'asc' } });\n  }\n}\n`,
    ).findings;
    expect(f).toEqual([{ site: 'apps/server/src/modules/ai/fixture.service.ts:3 FixtureService.listThings', rule: 'orderBy', keys: ['category', 'name'] }]);
  });

  const MUST_PASS: Array<[string, string]> = [
    ['arrays of one-field objects', `db.x.findMany({ orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] });`],
    ['a sort-and-nulls input', `db.x.findMany({ orderBy: { dueDate: { sort: 'asc', nulls: 'last' } } });`],
    ['a sort-and-nulls input in an array', `db.x.findMany({ orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] });`],
    ['an aggregate of one field', `db.x.groupBy({ by: ['serviceId'], orderBy: { _count: { serviceId: 'desc' } } });`],
    ['a relation of one field', `db.x.findMany({ orderBy: { product: { name: 'asc' } } });`],
    ['a relation count', `db.x.findMany({ orderBy: { invoices: { _count: 'desc' } } });`],
    ['a computed field', `function f(field: string) { return db.x.findMany({ orderBy: { [field]: dir } }); }`],
    ['a JSON Schema property named orderBy', `const tool = { parameters: { type: 'object', properties: { orderBy: { type: 'object', description: 'sort' } } } };`],
    ['a Drive API sort string', `const q = { orderBy: 'modifiedTime desc', pageSize: 10 };`],
    ['an opaque member read', `function f(input: any) { const args: any = {}; args.orderBy = input.orderBy; return db.x.findMany(args); }`],
    ['a parameter', `function f(orderBy: any) { return db.x.findMany({ orderBy }); }`],
    ['keys built on if / else if / else', `function f() { const orderBy: any = {}; if (s === 'a') orderBy.a = dir; else if (s === 'b') orderBy.b = dir; else orderBy.c = dir; return db.x.findMany({ orderBy }); }`],
    ['keys built in switch cases that break', `function f() { const orderBy: any = {}; switch (s) { case 'a': orderBy.a = dir; break; case 'b': orderBy.b = dir; break; default: orderBy.c = dir; } return db.x.findMany({ orderBy }); }`],
    ['one key built on every path', `function f() { const orderBy: any = {}; if (flag) orderBy.a = 'asc'; else orderBy.a = 'desc'; return db.x.findMany({ orderBy }); }`],
    ['a reassignment chain of one-field objects and arrays', `function f() { let orderBy: any; if (s === 'a') orderBy = { a: dir }; else if (s === 'b') orderBy = [{ b: dir }, { c: dir }]; else orderBy = { d: dir }; return db.x.findMany({ orderBy }); }`],
    ['a typed array constant of one-field objects', `const ORDER: Prisma.SkillOrderByWithRelationInput[] = [{ a: 'asc' }, { b: 'desc' }];`],
    [
      'a builder in an inner block with its own declaration of the name',
      `function f() { if (flag) { const orderBy: any = {}; if (s === 'a') orderBy.a = dir; else orderBy.b = { _count: dir }; return db.x.findMany({ orderBy }); }\n` +
        `const orderBy: any = {}; if (s === 'c') orderBy.c = dir; else orderBy.d = dir; return db.y.findMany({ orderBy }); }`,
    ],
    ['a name declared with two fields in another function', `function g() { const order = { a: dir, b: dir }; return order; }\nfunction f() { const order = { a: dir }; return db.x.findMany({ orderBy: order }); }`],
    ['an object of one direction and other values', `const opts = { direction: 'asc', take: 10 };`],
    ['args that are not an orderBy', `db.x.findMany({ where: { a: 1, b: 2 }, select: { id: true, name: true }, orderBy: { a: 'asc' } });`],
  ];
  for (const [what, body] of MUST_PASS) {
    it(`passes: ${what}`, () => {
      expect(findingsOf(body)).toEqual([]);
    });
  }
});

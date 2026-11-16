/**
 * FIX-CONTACT-PARAMS (v1 step 3, sweep BUG-038): the census of the App Router's
 * route modules. Next 16 hands a page, layout, default, template, their
 * generateMetadata / generateViewport and a route handler their `params` and
 * `searchParams` as Promises, and only as Promises: the synchronous property
 * access Next 15 still shimmed is gone (next/dist/server/request/params.js
 * makeUntrackedParams is `Promise.resolve(underlyingParams)`). A module that
 * reads `params.contactId` without awaiting `params` reads `undefined`, and
 * nothing fails to compile: a prop typed `{ params: { contactId: string } }`
 * still type-checks. That is BUG-038: app/app/crm/contacts/[contactId]/page.tsx
 * redirected every link to a contact to /app/crm/contacts/undefined/overview,
 * which shows 'Could not load this contact - Missing id'.
 *
 * The census parses every route module under src/app (the TypeScript parser,
 * no type checker) and fails, naming the file, the line and the expression, for
 * any entry function that reads `params` or `searchParams` from its props
 * without `await` or React's `use()`:
 *   - the default export of page / layout / default / template, and their
 *     exported generateMetadata and generateViewport (first argument);
 *   - a route handler's exported GET / POST / PUT / PATCH / DELETE / HEAD /
 *     OPTIONS (second argument).
 * A read counts as unwrapped when the reference is the operand of `await` or
 * the first argument of `use(...)` / `React.use(...)`. Anything else fails
 * closed: a property read (`params.id`), destructuring in the parameter list
 * (`{ params: { id } }`) or from the props (`const { id } = props.params`),
 * passing the Promise on (`{ params }`, `f(params)`), spreading it.
 * generateStaticParams is not an entry here: Next hands it the parent
 * segments' params as a plain object.
 *
 * A client component reading the route with useParams() is untouched: that
 * hook returns a plain object and is not a prop.
 *
 * The census checks itself first: synthetic modules it must flag and must
 * pass, so a parser change cannot make it pass by seeing nothing; and on the
 * real tree it must find the dynamic pages, the contact page among them, and
 * the server modules that do read their params.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(__dirname, "../..");
const APP = path.join(WEB, "src/app");

const ROUTE_MODULE = /^(page|layout|default|template|route)\.(tsx|ts|jsx|js)$/;
const PROPS_KEYS = new Set(["params", "searchParams"]);
const PROPS_EXPORTS = new Set(["generateMetadata", "generateViewport"]);
const HANDLERS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

type Finding = { file: string; line: number; entry: string; read: string };
type Entry = { name: string; fn: ts.SignatureDeclaration & { body?: ts.ConciseBody }; propsIndex: number };
type CensusResult = { findings: Finding[]; entries: string[]; checkedReads: number };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (ROUTE_MODULE.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(APP, file).split(path.sep).join("/");

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** A function expression or arrow, through parentheses and `as` / `satisfies`. */
function asFunction(node: ts.Expression | undefined): Entry["fn"] | undefined {
  let e = node;
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
  if (e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e))) return e;
  return undefined;
}

/** The entry functions of a route module (see the file comment). */
function entriesOf(sf: ts.SourceFile, fileName: string): Entry[] {
  const isRoute = /^route\./.test(path.basename(fileName));
  const entries: Entry[] = [];
  const topFunctions = new Map<string, Entry["fn"]>();

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) topFunctions.set(stmt.name.text, stmt);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        const fn = asFunction(d.initializer);
        if (fn && ts.isIdentifier(d.name)) topFunctions.set(d.name.text, fn);
      }
    }
  }

  const named = (name: string, fn: Entry["fn"]) => {
    if (isRoute) {
      if (HANDLERS.has(name)) entries.push({ name, fn, propsIndex: 1 });
    } else if (PROPS_EXPORTS.has(name)) {
      entries.push({ name, fn, propsIndex: 0 });
    }
  };

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) {
        if (!isRoute) entries.push({ name: stmt.name?.text ?? "default", fn: stmt, propsIndex: 0 });
      } else if (stmt.name) {
        named(stmt.name.text, stmt);
      }
    } else if (ts.isVariableStatement(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      for (const d of stmt.declarationList.declarations) {
        const fn = asFunction(d.initializer);
        if (fn && ts.isIdentifier(d.name)) named(d.name.text, fn);
      }
    } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && !isRoute) {
      const direct = asFunction(stmt.expression);
      if (direct) entries.push({ name: "default", fn: direct, propsIndex: 0 });
      else if (ts.isIdentifier(stmt.expression)) {
        const fn = topFunctions.get(stmt.expression.text);
        if (fn) entries.push({ name: stmt.expression.text, fn, propsIndex: 0 });
      }
    } else if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        const local = (spec.propertyName ?? spec.name).text;
        const fn = topFunctions.get(local);
        if (!fn) continue;
        if (spec.name.text === "default") {
          if (!isRoute) entries.push({ name: local, fn, propsIndex: 0 });
        } else named(spec.name.text, fn);
      }
    }
  }
  return entries;
}

/** Skip parentheses, `as`, `satisfies` and `!` upward from an expression. */
function outerOf(node: ts.Node): ts.Node {
  let n = node;
  while (
    n.parent &&
    (ts.isParenthesizedExpression(n.parent) ||
      ts.isAsExpression(n.parent) ||
      ts.isSatisfiesExpression(n.parent) ||
      ts.isNonNullExpression(n.parent))
  ) {
    n = n.parent;
  }
  return n;
}

/** The reference is unwrapped: `await x` or `use(x)` / `React.use(x)`. */
function isUnwrapped(ref: ts.Node): boolean {
  const outer = outerOf(ref);
  const parent = outer.parent;
  if (!parent) return false;
  if (ts.isAwaitExpression(parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments[0] === outer) {
    const callee = parent.expression;
    if (ts.isIdentifier(callee) && callee.text === "use") return true;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "use" && ts.isIdentifier(callee.expression) && callee.expression.text === "React") return true;
  }
  return false;
}

/** The text a finding names: the reference and the property read off it, if any. */
function readText(ref: ts.Node, sf: ts.SourceFile): string {
  const outer = outerOf(ref);
  const parent = outer.parent;
  if (parent && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === outer) {
    return parent.getText(sf);
  }
  if (parent && ts.isShorthandPropertyAssignment(parent)) return `{ ${ref.getText(sf)} } (passed on unawaited)`;
  return ref.getText(sf);
}

function isInType(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isTypeNode(n)) return true;
    if (ts.isBlock(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/** Does a function-like node declare `name` as one of its own parameters (shadowing it)? */
function declaresParam(fn: ts.SignatureDeclaration, name: string): boolean {
  const names = (b: ts.BindingName): string[] =>
    ts.isIdentifier(b) ? [b.text] : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : names(e.name)));
  return fn.parameters.some((p) => names(p.name).includes(name));
}

/**
 * Every value reference to `name` inside `body` (nested functions that declare
 * their own `name` parameter are skipped). A declaration of the name (`const p
 * = props.params`) is not a reference; a later local that shadows it is not
 * told apart, so its reads are checked too (the census fails closed).
 */
function referencesTo(name: string, body: ts.Node): ts.Identifier[] {
  const refs: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (node !== body && ts.isFunctionLike(node) && declaresParam(node, name)) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const p = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isBindingElement(p) && (p.propertyName === node || p.name === node)) ||
        (ts.isVariableDeclaration(p) && p.name === node) ||
        (ts.isFunctionDeclaration(p) && p.name === node) ||
        (ts.isPropertySignature(p) && p.name === node) ||
        (ts.isMethodDeclaration(p) && p.name === node) ||
        (ts.isJsxAttribute(p) && p.name === node);
      if (!isName && !isInType(node)) refs.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return refs;
}

/** The census of one module's source. */
function censusSource(text: string, fileName: string): CensusResult {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const findings: Finding[] = [];
  const entries: string[] = [];
  let checkedReads = 0;
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const entry of entriesOf(sf, fileName)) {
    entries.push(entry.name);
    const param = entry.fn.parameters[entry.propsIndex];
    const body = entry.fn.body;
    if (!param || !body) continue;
    const flag = (node: ts.Node, read: string) => findings.push({ file: fileName, line: lineOf(node), entry: entry.name, read });

    /** A local bound to the props' params / searchParams Promise: each use must unwrap it. */
    const checkLocal = (local: string) => {
      for (const ref of referencesTo(local, body)) {
        checkedReads++;
        if (!isUnwrapped(ref)) flag(ref, readText(ref, sf));
      }
    };

    /** `{ params, searchParams: sp, params: { id } }` destructured from the props. */
    const checkPattern = (pattern: ts.ObjectBindingPattern, propsLocals: string[]) => {
      for (const el of pattern.elements) {
        if (el.dotDotDotToken) {
          if (ts.isIdentifier(el.name)) propsLocals.push(el.name.text);
          continue;
        }
        const key = el.propertyName
          ? ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName)
            ? el.propertyName.text
            : undefined
          : ts.isIdentifier(el.name)
            ? el.name.text
            : undefined;
        if (!key || !PROPS_KEYS.has(key)) continue;
        if (ts.isIdentifier(el.name)) checkLocal(el.name.text);
        else {
          checkedReads++;
          flag(el, `${key} destructured as ${el.name.getText(sf)} without awaiting it`);
        }
      }
    };

    const propsLocals: string[] = [];
    if (ts.isObjectBindingPattern(param.name)) checkPattern(param.name, propsLocals);
    else if (ts.isIdentifier(param.name)) propsLocals.push(param.name.text);

    // props.params / props["params"], and `const { params } = props` inside the body.
    for (const props of propsLocals) {
      for (const ref of referencesTo(props, body)) {
        const outer = outerOf(ref);
        const p = outer.parent;
        let key: string | undefined;
        let access: ts.Expression | undefined;
        if (p && ts.isPropertyAccessExpression(p) && p.expression === outer) {
          key = p.name.text;
          access = p;
        } else if (p && ts.isElementAccessExpression(p) && p.expression === outer && ts.isStringLiteralLike(p.argumentExpression)) {
          key = p.argumentExpression.text;
          access = p;
        } else if (p && ts.isVariableDeclaration(p) && p.initializer === outer && ts.isObjectBindingPattern(p.name)) {
          checkPattern(p.name, []);
          continue;
        }
        if (!key || !access || !PROPS_KEYS.has(key)) continue;
        checkedReads++;
        if (isUnwrapped(access)) continue;
        const accessParent = outerOf(access).parent;
        if (accessParent && ts.isVariableDeclaration(accessParent) && accessParent.initializer === outerOf(access)) {
          if (ts.isIdentifier(accessParent.name)) {
            // `const params = props.params;` is a Promise held in a local: its uses must unwrap it.
            checkedReads--;
            checkLocal(accessParent.name.text);
            continue;
          }
        }
        flag(access, readText(access, sf));
      }
    }
  }
  return { findings, entries, checkedReads };
}

function censusTree() {
  const files = walk(APP).sort();
  const findings: Finding[] = [];
  const reading: string[] = [];
  const modulesWithEntries: string[] = [];
  for (const file of files) {
    const result = censusSource(fs.readFileSync(file, "utf8"), file);
    for (const f of result.findings) findings.push({ ...f, file: rel(file) });
    if (result.entries.length) modulesWithEntries.push(rel(file));
    if (result.checkedReads > 0) reading.push(rel(file));
  }
  const pages = files.map(rel).filter((f) => /(^|\/)page\.(tsx|ts|jsx|js)$/.test(f));
  const dynamicPages = pages.filter((f) => /(^|\/)\[[^/]+\]\//.test(f));
  return { files: files.map(rel), pages, dynamicPages, findings, reading, modulesWithEntries };
}

const describeFinding = (f: Finding) => `${f.file}:${f.line} ${f.entry} reads ${f.read} without awaiting it`;

// ── the census checks itself ────────────────────────────────────────────

describe("the census flags a route module that reads params or searchParams without awaiting them", () => {
  const flagged: Array<[string, string, string]> = [
    [
      "BUG-038's shape: the contact page's redirect",
      "page.tsx",
      `import { redirect } from "next/navigation";
       export default function ContactDetailIndex({ params }: { params: { contactId: string } }) {
         redirect(\`/app/crm/contacts/\${params.contactId}/overview\`);
       }`,
    ],
    ["props.params read off the props", "page.tsx", `export default function P(props: any) { return props.params.id; }`],
    ["destructured in the parameter list", "page.tsx", `export default function P({ params: { id } }: any) { return id; }`],
    ["destructured from props in the body", "page.tsx", `export default async function P(props: any) { const { id } = props.params; return id; }`],
    ["searchParams read synchronously", "page.tsx", `export default async function P({ searchParams }: any) { return searchParams.tab; }`],
    ["generateMetadata", "page.tsx", `export async function generateMetadata({ params }: any) { return { title: params.slug }; }`],
    ["an arrow default export", "layout.tsx", `const L = ({ params, children }: any) => <div data-id={params.id}>{children}</div>; export default L;`],
    ["export { X as default }", "page.tsx", `function P({ params }: any) { return params.id; } export { P as default };`],
    ["a route handler's context", "route.ts", `export async function GET(req: Request, { params }: any) { return Response.json(params.id); }`],
    ["a Promise passed on unawaited", "page.tsx", `export default function P({ params }: any) { return <Child params={params} />; }`],
    ["a local copy of props.params read synchronously", "page.tsx", `export default async function P(props: any) { const p = props.params; return p.id; }`],
  ];
  it.each(flagged)("%s", (_label, file, src) => {
    const { findings } = censusSource(src, `/virtual/app/x/[id]/${file}`);
    expect(findings.map(describeFinding), "the census names the unawaited read").not.toEqual([]);
  });

  const passed: Array<[string, string, string]> = [
    [
      "awaited in a server page",
      "page.tsx",
      `export default async function P({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return id; }`,
    ],
    ["(await params).id", "page.tsx", `export default async function P({ params }: any) { return (await params).id; }`],
    ["props.params awaited", "page.tsx", `export default async function P(props: any) { const { id } = await props.params; return id; }`],
    [
      "a local copy awaited",
      "page.tsx",
      `export default async function P(props: any) { const p = props.params; const { id } = await p; return id; }`,
    ],
    [
      "React's use() in a client page",
      "page.tsx",
      `"use client"; import { use } from "react"; export default function P({ params }: any) { const { id } = use(params); return id; }`,
    ],
    ["React.use()", "page.tsx", `"use client"; import React from "react"; export default function P({ params }: any) { return React.use(params).id; }`],
    [
      "useParams() in a client page (a plain object, not a prop)",
      "page.tsx",
      `"use client"; import { useParams } from "next/navigation"; export default function P() { const params = useParams(); return params.id as string; }`,
    ],
    [
      "generateStaticParams gets a plain object",
      "page.tsx",
      `export function generateStaticParams({ params }: any) { return [{ id: params.parent }]; } export default async function P({ params }: any) { return (await params).id; }`,
    ],
    [
      "a nested function's own params parameter",
      "page.tsx",
      `export default async function P({ params }: any) { const { id } = await params; const f = (params: any) => params.x; return f({ x: id }); }`,
    ],
    ["awaited in a route handler", "route.ts", `export async function GET(req: Request, { params }: any) { const { id } = await params; return Response.json(id); }`],
  ];
  it.each(passed)("passes %s", (_label, file, src) => {
    const { findings } = censusSource(src, `/virtual/app/x/[id]/${file}`);
    expect(findings.map(describeFinding)).toEqual([]);
  });
});

// ── the real tree ───────────────────────────────────────────────────────

describe("census: every App Router module awaits params and searchParams before reading them (Next 16)", () => {
  const tree = censusTree();

  it("sees the tree: the dynamic pages, the contact page among them, and the server modules that read their params", () => {
    expect(tree.pages.length, "pages under src/app").toBeGreaterThan(200);
    expect(tree.dynamicPages.length, "app/**/[param]/page.tsx pages").toBeGreaterThanOrEqual(40);
    expect(tree.dynamicPages).toContain("app/crm/contacts/[contactId]/page.tsx");
    for (const reads of [
      "app/crm/contacts/[contactId]/page.tsx",
      "site/[slug]/page.tsx",
      "site/preview/[token]/page.tsx",
      "book/[slug]/layout.tsx",
      "book/[slug]/product/[productId]/layout.tsx",
      "app/commerce/collections/page.tsx",
    ]) {
      expect(tree.reading, `the census checks the params / searchParams reads of ${reads}`).toContain(reads);
    }
  });

  it("every app/**/[param]/page.tsx awaits params before reading it", () => {
    const dynamic = new Set(tree.dynamicPages);
    const onDynamicPages = tree.findings.filter((f) => dynamic.has(f.file)).map(describeFinding);
    expect(onDynamicPages, "dynamic pages that read params without awaiting it").toEqual([]);
  });

  it("no page, layout, default, template or route handler reads params or searchParams without awaiting them", () => {
    expect(tree.findings.map(describeFinding)).toEqual([]);
  });
});

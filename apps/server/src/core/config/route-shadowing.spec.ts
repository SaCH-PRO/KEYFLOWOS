/**
 * R0-13e-ROUTE-SHADOWING — no route is shadowed by a parameterised sibling.
 *
 * Nest registers a controller's handlers with Express in declaration order, and
 * Express answers a request with the first route whose pattern matches it. So
 * when a controller declares `PATCH contacts/:contactId` before
 * `PATCH contacts/bulk`, every `PATCH contacts/bulk` request is answered by the
 * parameterised handler with contactId 'bulk', and the literal route is dead.
 * That is M15, observed on a real database by the R0-13d builder: the web's
 * bulk edit (apps/web/src/lib/client.ts bulkUpdateContacts) reached
 * CrmService.updateContact with contactId 'bulk' and answered 404, so bulk
 * update had never worked over HTTP. `GET contacts/unread-counts` sat behind
 * `GET contacts/:contactId` the same way.
 *
 * What this file checks, with the TypeScript compiler API over every
 * *.controller.ts under apps/server/src:
 *   - the reader: the prefix of each @Controller class plus the path of each
 *     method decorator (@Get, @Post, @Put, @Patch, @Delete, @Options, @Head,
 *     @Search, @All, and @Sse as GET), in declaration order; every path it
 *     meets is a string literal it can read, so a form it was never taught
 *     fails here instead of passing by being skipped;
 *   - the detector, on inline fixtures: a later route is an offender when an
 *     earlier route of the same HTTP method (or @All) has the same number of
 *     segments, every segment either equal or a whole ':param' on the earlier
 *     side, and at least one ':param' segment where the later route has a
 *     literal (contacts/:contactId before contacts/bulk). A literal declared
 *     first is the fix, not an offender;
 *   - the tree: no controller has an offender beyond ALLOW_LISTED, the
 *     offenders in controllers outside the R0-13e write set (named with the
 *     file:line seen when this landed and 'outside R0-13e write set,
 *     follow-up'), which keeps the spec green and the debt visible. The
 *     allow-list may only shrink: an entry whose offender is gone fails here,
 *     and crm.controller.ts (the write set) may never appear in it.
 *
 * R0-13f-ROUTE-SHADOWING-SIBLINGS took six entries off the allow-list: GET
 * approvals/pending-for-me, POST command items/bulk/complete and
 * items/bulk/dismiss, POST deals/bulk/move-stage and GET procurement
 * suppliers and stats are declared before their parameterised siblings. Each
 * of those handlers had never run over HTTP, so the R0-13f cases below also
 * check, from the decorators, that each carries at least the guards and the
 * module scope of the single-item sibling that used to answer it (Nest reads
 * @RequireModuleScope from the handler only, so only the method's counts);
 * test/shadowed-routes-live.integration.test.ts proves the same on a real
 * database, with the tenant binding. The R0-13f controllers may never appear in
 * ALLOW_LISTED again.
 *
 * Allow-list entries match on file, method, path and shadowing path, not on the
 * line: an unrelated edit above a listed route moves it without hiding it, and
 * the failure message prints the current line.
 *
 * WHAT THIS CANNOT SEE: the order across controllers. Two controllers that
 * share a prefix are registered in module and `controllers` array order, which
 * no single file states; a parameterised route in one can shadow a literal in
 * the other. Express 5 (path-to-regexp 8) segment semantics are assumed: a
 * whole ':name' segment matches any one non-empty segment; a segment carrying
 * anything else is compared literally (no route here uses one).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { LEVEL_RANK } from '../authority/module-vocabulary';

const SERVER_SRC = resolve(__dirname, '../..');
const CRM_CONTROLLER = 'modules/crm/crm.controller.ts';

/** Nest's method decorators and the HTTP method each registers. */
const METHOD_DECORATORS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'OPTIONS',
  Head: 'HEAD',
  Search: 'SEARCH',
  All: 'ALL',
  Sse: 'GET',
};

interface Route {
  file: string;
  cls: string;
  handler: string;
  /** The line of the method decorator. */
  line: number;
  method: string;
  path: string;
  segments: string[];
}

interface Unreadable {
  file: string;
  line: number;
  what: string;
}

interface Offender {
  route: Route;
  shadowedBy: Route;
}

interface DecoratorCall {
  name: string;
  call: ts.CallExpression | undefined;
  node: ts.Decorator;
}

function decoratorCalls(node: ts.Node): DecoratorCall[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((d): DecoratorCall[] => {
    const e = d.expression;
    if (ts.isCallExpression(e)) return [{ name: e.expression.getText(), call: e, node: d }];
    if (ts.isIdentifier(e)) return [{ name: e.text, call: undefined, node: d }];
    return [];
  });
}

/**
 * The path(s) a @Controller or method decorator argument names: '' for none,
 * one per element of an array of literals, the `path` of an options object.
 * undefined when the argument is not a form this reader can resolve.
 */
function pathsOf(arg: ts.Expression | undefined): string[] | undefined {
  if (!arg) return [''];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
  if (ts.isArrayLiteralExpression(arg)) {
    const out: string[] = [];
    for (const el of arg.elements) {
      const p = pathsOf(el);
      if (!p || el.kind === ts.SyntaxKind.OmittedExpression) return undefined;
      out.push(...p);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(arg)) {
    const prop = arg.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'path',
    ) as ts.PropertyAssignment | undefined;
    return prop ? pathsOf(prop.initializer) : [''];
  }
  return undefined;
}

function joinPath(prefix: string, path: string): string {
  const joined = `/${prefix}/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Every route of every @Controller class in one source text, in declaration order. */
function readControllers(file: string, text: string): { routes: Route[]; unreadable: Unreadable[]; controllers: number } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes: Route[] = [];
  const unreadable: Unreadable[] = [];
  let controllers = 0;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node)) {
      const ctl = decoratorCalls(node).find((d) => d.name === 'Controller');
      if (ctl) {
        controllers += 1;
        const prefixes = pathsOf(ctl.call?.arguments[0]);
        if (!prefixes) unreadable.push({ file, line: lineOf(ctl.node), what: ctl.node.getText(sf) });
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          for (const d of decoratorCalls(member)) {
            const method = METHOD_DECORATORS[d.name];
            if (!method) continue;
            const paths = pathsOf(d.call?.arguments[0]);
            if (!paths) {
              unreadable.push({ file, line: lineOf(d.node), what: d.node.getText(sf) });
              continue;
            }
            for (const prefix of prefixes ?? []) {
              for (const p of paths) {
                const full = joinPath(prefix, p);
                routes.push({
                  file,
                  cls: node.name?.text ?? '<anonymous>',
                  handler: member.name.getText(sf),
                  line: lineOf(d.node),
                  method,
                  path: full,
                  segments: segmentsOf(full),
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { routes, unreadable, controllers };
}

/** A whole-segment Express parameter, which matches any one non-empty segment. */
const isParam = (segment: string) => /^:[A-Za-z_$][\w$]*$/.test(segment);

/**
 * True when every request `later` would answer is answered first by `earlier`,
 * and `earlier` takes at least one of later's literal segments as a parameter.
 */
function shadows(earlier: Route, later: Route): boolean {
  if (earlier.method !== later.method && earlier.method !== 'ALL') return false;
  if (earlier.segments.length !== later.segments.length) return false;
  let literalTaken = false;
  for (let i = 0; i < earlier.segments.length; i += 1) {
    const e = earlier.segments[i];
    const l = later.segments[i];
    if (e.toLowerCase() === l.toLowerCase()) continue; // Express routes case-insensitively
    if (isParam(e)) {
      if (!isParam(l)) literalTaken = true;
      continue;
    }
    return false;
  }
  return literalTaken;
}

/** Each route declared after a parameterised sibling that answers it, within one controller class. */
function findOffenders(routes: Route[]): Offender[] {
  const offenders: Offender[] = [];
  const byClass = new Map<string, Route[]>();
  for (const r of routes) {
    const key = `${r.file}#${r.cls}`;
    byClass.set(key, [...(byClass.get(key) ?? []), r]);
  }
  for (const list of byClass.values()) {
    for (let j = 0; j < list.length; j += 1) {
      for (let i = 0; i < j; i += 1) {
        if (shadows(list[i], list[j])) {
          offenders.push({ route: list[j], shadowedBy: list[i] });
          break;
        }
      }
    }
  }
  return offenders;
}

const describeOffender = (o: Offender) =>
  `${o.route.file}:${o.route.line} ${o.route.method} ${o.route.path} (${o.route.handler}) ` +
  `is answered by :${o.shadowedBy.line} ${o.shadowedBy.method} ${o.shadowedBy.path} (${o.shadowedBy.handler})`;

function controllerFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
      out = out.concat(controllerFiles(p));
    } else if (e.name.endsWith('.controller.ts')) {
      out.push(p);
    }
  }
  return out;
}

function scanTree() {
  const files = controllerFiles(SERVER_SRC).sort();
  const routes: Route[] = [];
  const unreadable: Unreadable[] = [];
  let controllers = 0;
  for (const abs of files) {
    const file = relative(SERVER_SRC, abs).split(sep).join('/');
    const read = readControllers(file, readFileSync(abs, 'utf8'));
    routes.push(...read.routes);
    unreadable.push(...read.unreadable);
    controllers += read.controllers;
  }
  return { files, controllers, routes, unreadable, offenders: findOffenders(routes) };
}

interface AllowListed {
  /** Relative to apps/server/src. */
  file: string;
  /** The line of the shadowed route's decorator when this entry was recorded. */
  line: number;
  method: string;
  /** The shadowed (literal) route. */
  path: string;
  /** The earlier parameterised route that answers it. */
  shadowedBy: string;
  reason: string;
}

/**
 * Offenders in controllers outside the R0-13e write set, recorded when this
 * landed. Each is a live defect owned by a follow-up packet; this list may only
 * shrink. R0-13f removed the six in its four controllers; the two key-cortex
 * flows routes are owned by a later packet.
 */
const FOLLOW_UP = 'outside R0-13e write set, follow-up';
const ALLOW_LISTED: AllowListed[] = [
  {
    file: 'modules/key-cortex/key-cortex.controller.ts',
    line: 2638,
    method: 'GET',
    path: '/api/v1/cortex/flows/templates',
    shadowedBy: '/api/v1/cortex/flows/:id',
    reason: `${FOLLOW_UP}: answered by flowGet as flow 'templates'`,
  },
  {
    file: 'modules/key-cortex/key-cortex.controller.ts',
    line: 2691,
    method: 'GET',
    path: '/api/v1/cortex/flows/nodes',
    shadowedBy: '/api/v1/cortex/flows/:id',
    reason: `${FOLLOW_UP}: answered by flowGet as flow 'nodes'`,
  },
];

const allowKey = (file: string, method: string, path: string, shadowedBy: string) =>
  `${file} ${method} ${path} <- ${shadowedBy}`;

/**
 * R0-13f-ROUTE-SHADOWING-SIBLINGS: the six routes it made live, each with the
 * single-item sibling that answered it before (and whose guards it must carry
 * at least), and the web screens that call it.
 */
interface LiveRoute {
  file: string;
  method: string;
  path: string;
  handler: string;
  sibling: string;
  siblingHandler: string;
  web: string;
}
const R0_13F_ROUTES: LiveRoute[] = [
  {
    file: 'modules/approvals/approval.controller.ts',
    method: 'GET',
    path: '/businesses/:businessId/approvals/pending-for-me',
    handler: 'pendingForMe',
    sibling: '/businesses/:businessId/approvals/:approvalId',
    siblingHandler: 'getById',
    web: 'fetchPendingApprovalsForMe: app/approvals/page.tsx, app/operations/page.tsx',
  },
  {
    file: 'modules/command/command.controller.ts',
    method: 'POST',
    path: '/command/businesses/:businessId/items/bulk/complete',
    handler: 'bulkComplete',
    sibling: '/command/businesses/:businessId/items/:id/complete',
    siblingHandler: 'complete',
    web: 'bulkCompleteCommands (lib/api/command.ts; no screen calls it)',
  },
  {
    file: 'modules/command/command.controller.ts',
    method: 'POST',
    path: '/command/businesses/:businessId/items/bulk/dismiss',
    handler: 'bulkDismiss',
    sibling: '/command/businesses/:businessId/items/:id/dismiss',
    siblingHandler: 'dismiss',
    web: 'bulkDismissCommands (lib/api/command.ts; no screen calls it)',
  },
  {
    file: 'modules/crm/crm-deals.controller.ts',
    method: 'POST',
    path: '/crm/businesses/:businessId/deals/bulk/move-stage',
    handler: 'bulkMoveStage',
    sibling: '/crm/businesses/:businessId/deals/:dealId/move-stage',
    siblingHandler: 'moveStage',
    web: 'bulkMoveDealStage: app/crm/deals/deals-board-view.tsx, deals-list-view.tsx',
  },
  {
    file: 'modules/procurement/procurement.controller.ts',
    method: 'GET',
    path: '/procurement/businesses/:businessId/suppliers',
    handler: 'listSuppliers',
    sibling: '/procurement/businesses/:businessId/:id',
    siblingHandler: 'get',
    web: 'fetchProcurementSuppliers: app/procurement/suppliers/page.tsx, app/procurement/[requestId]/page.tsx',
  },
  {
    file: 'modules/procurement/procurement.controller.ts',
    method: 'GET',
    path: '/procurement/businesses/:businessId/stats',
    handler: 'stats',
    sibling: '/procurement/businesses/:businessId/:id',
    siblingHandler: 'get',
    web: 'fetchProcurementStats: app/procurement/page.tsx',
  },
];
const R0_13F_FILES = [...new Set(R0_13F_ROUTES.map((r) => r.file))];

interface HandlerGuards {
  /** The @UseGuards arguments of the class and the method, as written. */
  guards: string[];
  /** The method's @RequireModuleScope (Nest reads it from the handler only). */
  scope: { module: string; level: string } | undefined;
}

/** The guards and module scope a handler of a controller class runs behind, read from its decorators. */
function handlerGuards(file: string, text: string, cls: string, handler: string): HandlerGuards | undefined {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: HandlerGuards | undefined;
  const literal = (e: ts.Expression | undefined) =>
    e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined;
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === cls) {
      const onClass = decoratorCalls(node);
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || member.name.getText(sf) !== handler) continue;
        const onMethod = decoratorCalls(member);
        const guards = [...onClass, ...onMethod]
          .filter((d) => d.name === 'UseGuards')
          .flatMap((d) => d.call?.arguments.map((a) => a.getText(sf)) ?? []);
        const scopeCall = onMethod.find((d) => d.name === 'RequireModuleScope')?.call;
        found = {
          guards: [...new Set(guards)].sort(),
          scope: scopeCall
            ? { module: literal(scopeCall.arguments[0]) ?? '<unreadable>', level: literal(scopeCall.arguments[1]) ?? 'read' }
            : undefined,
        };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// ---------------------------------------------------------------------------

describe('the reader: controller prefixes and method decorator paths, in declaration order', () => {
  it('joins the @Controller prefix with each method path, reads @Get() with no path, arrays of paths, @Sse as GET, and keeps declaration order', () => {
    const { routes, unreadable, controllers } = readControllers('fixture.controller.ts', `
      @Controller('crm')
      export class A {
        @Get() root() {}
        @Get('businesses/:businessId/contacts/:contactId') one() {}
        @UseGuards(X) @Patch(['a/b', 'c/']) two() {}
        @Sse('/stream/') three() {}
        helper() {}
      }
      @Controller()
      export class B {
        @Post('/x//y') four() {}
      }
      export class NotAController {
        @Get('ignored') five() {}
      }
    `);
    expect(controllers).toBe(2);
    expect(unreadable).toEqual([]);
    expect(routes.map((r) => `${r.cls}.${r.handler} ${r.method} ${r.path}`)).toEqual([
      'A.root GET /crm',
      'A.one GET /crm/businesses/:businessId/contacts/:contactId',
      'A.two PATCH /crm/a/b',
      'A.two PATCH /crm/c',
      'A.three GET /crm/stream',
      'B.four POST /x/y',
    ]);
    expect(routes[1].line).toBe(5);
  });

  it('reports a path argument it cannot resolve instead of skipping it', () => {
    const { routes, unreadable } = readControllers('fixture.controller.ts', `
      @Controller(PREFIX)
      export class A {
        @Get(SOME_PATH) one() {}
        @Get('fine') two() {}
      }
    `);
    expect(unreadable.map((u) => `${u.line} ${u.what}`)).toEqual(['2 @Controller(PREFIX)', '4 @Get(SOME_PATH)']);
    expect(routes).toHaveLength(0);
  });
});

describe('the detector: a literal route declared after a parameterised sibling of the same method', () => {
  const offendersIn = (body: string) =>
    findOffenders(readControllers('fixture.controller.ts', `@Controller('crm')\nexport class A {\n${body}\n}`).routes).map(
      (o) => `${o.route.method} ${o.route.path} <- ${o.shadowedBy.path}`,
    );

  it('flags contacts/:contactId before contacts/bulk (the M15 shape), and every later literal it answers', () => {
    expect(offendersIn(`
      @Patch('b/:businessId/contacts/:contactId') update() {}
      @Patch('b/:businessId/contacts/bulk') bulk() {}
      @Patch('b/:businessId/contacts/merge') merge() {}
    `)).toEqual([
      'PATCH /crm/b/:businessId/contacts/bulk <- /crm/b/:businessId/contacts/:contactId',
      'PATCH /crm/b/:businessId/contacts/merge <- /crm/b/:businessId/contacts/:contactId',
    ]);
  });

  it('does not flag the fix: the literal declared first', () => {
    expect(offendersIn(`
      @Patch('b/:businessId/contacts/bulk') bulk() {}
      @Patch('b/:businessId/contacts/:contactId') update() {}
    `)).toEqual([]);
  });

  it('does not flag a different method, a different segment count, a different literal, or a more specific route declared first', () => {
    expect(offendersIn(`
      @Get('b/:businessId/contacts/:contactId') get() {}
      @Patch('b/:businessId/contacts/bulk') patchBulk() {}
      @Get('b/:businessId/contacts/:contactId/notes') notes() {}
      @Get('b/:businessId/contacts/bulk/reassign') deeper() {}
      @Get('b/:businessId/deals/open') deals() {}
      @Get('b/:businessId/x/one/:y') specificFirst() {}
      @Get('b/:businessId/x/:id/:y') general() {}
    `)).toEqual([]);
  });

  it('flags a parameter anywhere in the path, case-insensitively, and an @All route against every method', () => {
    expect(offendersIn(`
      @Get(':kind/:id/summary') a() {}
      @Get('contacts/:id/Summary') b() {}
      @All('hooks/:provider') c() {}
      @Post('hooks/stripe') d() {}
    `)).toEqual([
      'GET /crm/contacts/:id/Summary <- /crm/:kind/:id/summary',
      'POST /crm/hooks/stripe <- /crm/hooks/:provider',
    ]);
  });

  it('checks order within one controller class only', () => {
    const { routes } = readControllers('fixture.controller.ts', `
      @Controller('crm') export class A { @Get('contacts/:id') a() {} }
      @Controller('crm') export class B { @Get('contacts/bulk') b() {} }
    `);
    expect(routes).toHaveLength(2);
    expect(findOffenders(routes)).toEqual([]);
  });
});

describe('the tree: no controller under apps/server/src answers a literal route with a parameterised sibling', () => {
  const tree = scanTree();
  const allowed = new Set(ALLOW_LISTED.map((a) => allowKey(a.file, a.method, a.path, a.shadowedBy)));
  const keyOf = (o: Offender) => allowKey(o.route.file, o.route.method, o.route.path, o.shadowedBy.path);

  it('the reader saw the controllers and read every route path (anti-vacuity)', () => {
    expect(tree.files.length, 'no *.controller.ts found: the walker is broken').toBeGreaterThan(100);
    expect(tree.controllers).toBeGreaterThan(100);
    expect(tree.routes.length).toBeGreaterThan(1000);
    expect(tree.routes.map((r) => `${r.method} ${r.path}`)).toContain('PATCH /crm/businesses/:businessId/contacts/bulk');
    expect(tree.routes.map((r) => `${r.method} ${r.path}`)).toContain('PATCH /crm/businesses/:businessId/contacts/:contactId');
    expect(tree.unreadable.map((u) => `${u.file}:${u.line} ${u.what}`)).toEqual([]);
  });

  it(`${CRM_CONTROLLER} (the R0-13e write set) declares every literal contacts route before its parameterised sibling: PATCH contacts/bulk reaches bulkUpdateContacts, GET contacts/unread-counts reaches unreadCounts`, () => {
    const crm = tree.offenders.filter((o) => o.route.file === CRM_CONTROLLER);
    expect(crm.map(describeOffender)).toEqual([]);
    const at = (method: string, path: string) =>
      tree.routes.find((r) => r.file === CRM_CONTROLLER && r.method === method && r.path === path);
    const bulk = at('PATCH', '/crm/businesses/:businessId/contacts/bulk');
    const update = at('PATCH', '/crm/businesses/:businessId/contacts/:contactId');
    const unread = at('GET', '/crm/businesses/:businessId/contacts/unread-counts');
    const detail = at('GET', '/crm/businesses/:businessId/contacts/:contactId');
    expect(bulk?.handler).toBe('bulkUpdateContacts');
    expect(unread?.handler).toBe('unreadCounts');
    expect(bulk!.line).toBeLessThan(update!.line);
    expect(unread!.line).toBeLessThan(detail!.line);
  });

  it('no offender outside the allow-list, listing every one', () => {
    const unlisted = tree.offenders.filter((o) => !allowed.has(keyOf(o)));
    expect(
      unlisted.map(describeOffender),
      'Each route below is declared after a parameterised route of the same method that matches every ' +
        'request it would answer, so Express never reaches it. Declare the literal route first.',
    ).toEqual([]);
  });

  it('the allow-list only shrinks: every entry is a live offender outside the write set, with its reason', () => {
    const live = new Map(tree.offenders.map((o) => [keyOf(o), o]));
    const ghosts = ALLOW_LISTED.filter((a) => !live.has(allowKey(a.file, a.method, a.path, a.shadowedBy)));
    expect(
      ghosts.map((a) => `${a.file}:${a.line} ${a.method} ${a.path}`),
      'These allow-listed routes are no longer shadowed: remove them from ALLOW_LISTED.',
    ).toEqual([]);
    for (const a of ALLOW_LISTED) {
      expect(a.file, 'the R0-13e write set is fixed, never allow-listed').not.toBe(CRM_CONTROLLER);
      expect(R0_13F_FILES, 'the R0-13f controllers are fixed, never allow-listed').not.toContain(a.file);
      expect(a.reason).toContain('outside R0-13e write set, follow-up');
    }
    expect(new Set(ALLOW_LISTED.map((a) => allowKey(a.file, a.method, a.path, a.shadowedBy))).size).toBe(ALLOW_LISTED.length);
  });
});

describe('R0-13f: the six formerly shadowed routes are declared before their parameterised siblings and carry at least their guards', () => {
  const tree = scanTree();
  const at = (file: string, method: string, path: string) =>
    tree.routes.find((r) => r.file === file && r.method === method && r.path === path);

  it('approval.controller.ts, command.controller.ts, crm-deals.controller.ts and procurement.controller.ts have no offender, and each of the six routes reaches its own handler, declared above the sibling that answered it', () => {
    expect(tree.offenders.filter((o) => R0_13F_FILES.includes(o.route.file)).map(describeOffender)).toEqual([]);
    for (const r of R0_13F_ROUTES) {
      const route = at(r.file, r.method, r.path);
      const sibling = at(r.file, r.method, r.sibling);
      expect(route?.handler, `${r.method} ${r.path}`).toBe(r.handler);
      expect(sibling?.handler, `${r.method} ${r.sibling}`).toBe(r.siblingHandler);
      expect(route!.line, `${r.method} ${r.path} (${r.web}) is declared after ${r.sibling}`).toBeLessThan(sibling!.line);
    }
  });

  it('each of the six handlers runs behind every guard of its single-item sibling and requires at least its module scope (class and method @UseGuards, method @RequireModuleScope)', () => {
    for (const r of R0_13F_ROUTES) {
      const text = readFileSync(join(SERVER_SRC, r.file), 'utf8');
      const route = at(r.file, r.method, r.path)!;
      const own = handlerGuards(r.file, text, route.cls, r.handler);
      const sib = handlerGuards(r.file, text, route.cls, r.siblingHandler);
      const label = `${route.cls}.${r.handler} vs ${r.siblingHandler}`;
      expect(own, label).toBeDefined();
      expect(sib, label).toBeDefined();
      expect(own!.guards, label).toEqual(expect.arrayContaining(sib!.guards));
      expect(own!.guards, `${label}: no handler here runs unauthenticated`).toEqual(expect.arrayContaining(['AuthGuard', 'BusinessGuard']));
      if (sib!.scope) {
        expect(own!.scope?.module, label).toBe(sib!.scope.module);
        expect(LEVEL_RANK[own!.scope!.level as keyof typeof LEVEL_RANK], label).toBeGreaterThanOrEqual(
          LEVEL_RANK[sib!.scope.level as keyof typeof LEVEL_RANK],
        );
      }
    }
    // The one sibling with a module scope: the bulk move needs the single move's crm write.
    const deals = R0_13F_ROUTES.find((r) => r.handler === 'bulkMoveStage')!;
    const text = readFileSync(join(SERVER_SRC, deals.file), 'utf8');
    expect(handlerGuards(deals.file, text, 'CrmDealsController', 'bulkMoveStage')?.scope).toEqual({ module: 'crm', level: 'write' });
  });

  it('the guard reader sees class and method guards and the method scope only (anti-vacuity)', () => {
    const text = `
      @Controller('x') @UseGuards(AuthGuard, RateLimitGuard)
      export class A {
        @UseGuards(BusinessGuard, ModuleScopeGuard) @RequireModuleScope('crm', 'write') @Post('a/:id') one() {}
        @UseGuards(BusinessGuard) @Get('b') two() {}
        @RequireModuleScope('crm') @Get('c') three() {}
      }
      @Controller('y') @RequireModuleScope('crm', 'admin')
      export class B {
        @Get('d') four() {}
      }
    `;
    expect(handlerGuards('f.controller.ts', text, 'A', 'one')).toEqual({
      guards: ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard', 'RateLimitGuard'],
      scope: { module: 'crm', level: 'write' },
    });
    expect(handlerGuards('f.controller.ts', text, 'A', 'two')).toEqual({ guards: ['AuthGuard', 'BusinessGuard', 'RateLimitGuard'], scope: undefined });
    expect(handlerGuards('f.controller.ts', text, 'A', 'three')?.scope).toEqual({ module: 'crm', level: 'read' });
    expect(handlerGuards('f.controller.ts', text, 'B', 'four')).toEqual({ guards: [], scope: undefined });
    expect(handlerGuards('f.controller.ts', text, 'A', 'missing')).toBeUndefined();
  });
});

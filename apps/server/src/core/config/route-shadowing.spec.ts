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

function decoratorCalls(node: ts.Node): Array<{ name: string; call: ts.CallExpression | undefined; node: ts.Decorator }> {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((d) => {
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
 * shrink.
 */
const FOLLOW_UP = 'outside R0-13e write set, follow-up';
const ALLOW_LISTED: AllowListed[] = [
  {
    file: 'modules/approvals/approval.controller.ts',
    line: 121,
    method: 'GET',
    path: '/businesses/:businessId/approvals/pending-for-me',
    shadowedBy: '/businesses/:businessId/approvals/:approvalId',
    reason: `${FOLLOW_UP}: answered by getById as approval 'pending-for-me'`,
  },
  {
    file: 'modules/command/command.controller.ts',
    line: 171,
    method: 'POST',
    path: '/command/businesses/:businessId/items/bulk/complete',
    shadowedBy: '/command/businesses/:businessId/items/:id/complete',
    reason: `${FOLLOW_UP}: answered by complete as item 'bulk'`,
  },
  {
    file: 'modules/command/command.controller.ts',
    line: 179,
    method: 'POST',
    path: '/command/businesses/:businessId/items/bulk/dismiss',
    shadowedBy: '/command/businesses/:businessId/items/:id/dismiss',
    reason: `${FOLLOW_UP}: answered by dismiss as item 'bulk'`,
  },
  {
    file: 'modules/crm/crm-deals.controller.ts',
    line: 244,
    method: 'POST',
    path: '/crm/businesses/:businessId/deals/bulk/move-stage',
    shadowedBy: '/crm/businesses/:businessId/deals/:dealId/move-stage',
    reason: `${FOLLOW_UP}: answered by moveStage as deal 'bulk'`,
  },
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
  {
    file: 'modules/procurement/procurement.controller.ts',
    line: 63,
    method: 'GET',
    path: '/procurement/businesses/:businessId/suppliers',
    shadowedBy: '/procurement/businesses/:businessId/:id',
    reason: `${FOLLOW_UP}: answered by get as procurement request 'suppliers'`,
  },
  {
    file: 'modules/procurement/procurement.controller.ts',
    line: 105,
    method: 'GET',
    path: '/procurement/businesses/:businessId/stats',
    shadowedBy: '/procurement/businesses/:businessId/:id',
    reason: `${FOLLOW_UP}: answered by get as procurement request 'stats'`,
  },
];

const allowKey = (file: string, method: string, path: string, shadowedBy: string) =>
  `${file} ${method} ${path} <- ${shadowedBy}`;

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
      expect(a.reason).toContain('outside R0-13e write set, follow-up');
    }
    expect(new Set(ALLOW_LISTED.map((a) => allowKey(a.file, a.method, a.path, a.shadowedBy))).size).toBe(ALLOW_LISTED.length);
  });
});

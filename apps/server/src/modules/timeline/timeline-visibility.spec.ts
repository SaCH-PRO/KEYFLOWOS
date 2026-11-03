/**
 * V1-84 (FOLLOW3-D1-TIMELINE-SCOPE): the Activity.module census.
 *
 * The business feed (GET /timeline/businesses/:id/events, .../summary/:date,
 * .../upcoming and the legacy GET /api/flows/businesses/:id/activity) shows a
 * member only the Activity rows whose module maps, through
 * ACTIVITY_MODULE_SCOPES (timeline-visibility.ts), to a canonical module the
 * member reads. Owner ruling D-63: a row whose module the table does not map
 * is shown to OWNER and ADMIN only. That deny branch is meant to stay EMPTY:
 * who sees a module is decided by an entry in the table, not by an omission.
 * Activity.module is free text written in both cases ('commerce' and
 * 'COMMERCE', 'projects' and 'PROJECT'), so the table is keyed case-folded.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src):
 *   - `<recv>.recordEvent(arg)` where <recv> is a TimelineService (a field of
 *     the class typed TimelineService, or `this` inside TimelineService);
 *   - `<recv>.log(arg)` where <recv> is the flow ActivityService;
 *   - `<recv>.createActivity(arg)` (ActivityLogService, the only class with
 *     that method);
 *   - any `.log` / `.recordEvent` / `.createActivity` call whose receiver the
 *     reader cannot type, if its object argument has the Activity input shape
 *     (module, action, entityType and title);
 *   - every Prisma write on the Activity delegate: `<x>.activity.create |
 *     createMany | upsert | update | updateMany(...)` (also `['activity']`),
 *     the `module` of its `data` (`create` / `update` for upsert).
 *   The module value is read as a string literal, both arms of a conditional
 *   or `??` / `||`, an identifier whose initializer in the enclosing function
 *   is one of those, or `<id>.module` where <id> is an object literal declared
 *   in the enclosing function. Anything else is OPAQUE.
 *   The three writer implementations (TimelineService.recordEvent,
 *   ActivityService.log, ActivityLogService.createActivity) pass their
 *   caller's `input.module` through and are not counted.
 *
 * WHAT IS REQUIRED:
 *   TV-01 every module literal written at head is mapped (case-folded); a new
 *         writer with an unmapped module fails here, naming the file and line.
 *   TV-02 no writer's module is OPAQUE unless OPAQUE_WRITERS names it with a
 *         reason (empty at V1-84).
 *   TV-03 the reader finds the writers it must find (one per writer family).
 *   TV-04 scanner self-test: every writer form above is found; a .log on a
 *         non-Activity service (AiExecutionLogService) is not.
 *   TV-05 the table's values are canonical modules, its keys case-folded, and
 *         it pins D-63: KEY/AI rows -> ai, settings rows -> settings,
 *         communications / messages / inbox -> crm, genome / site /
 *         notifications -> settings, analytics -> analytics.
 *   TV-06 classification is case-folded: 'REVENUE', 'BOOKINGS', 'EXPENSE'
 *         classify as 'revenue', 'bookings', 'expenses' do.
 *
 * WHAT THIS CANNOT DO: it cannot see a writer reached through an alias it
 * cannot type, or a module computed at runtime (those land in OPAQUE).
 * Behaviour is proven on a real database by
 * apps/server/test/timeline-scope.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');
const OPAQUE = '<opaque>';

/** The table and classifier under test (dynamic, so a missing module fails per case). */
async function visibility() {
  return import('./timeline-visibility');
}

/**
 * Writers whose module the reader cannot see, with the reason each is safe.
 * Empty at V1-84: every writer at head writes a literal the table maps.
 */
const OPAQUE_WRITERS: Record<string, string> = {};

/** The writer implementations: they pass the caller's module through. */
const PASS_THROUGH = new Set([
  'modules/timeline/timeline.service.ts#TimelineService.recordEvent',
  'modules/flow/activity.service.ts#ActivityService.log',
  'modules/activity/activity.service.ts#ActivityLogService.createActivity',
]);

const PRISMA_OPS = new Set(['create', 'createMany', 'upsert', 'update', 'updateMany']);
const ACTIVITY_SHAPE = ['module', 'action', 'entityType', 'title'];

export interface ActivityWriter {
  /** `<file under src>#<Class>.<method>` */
  key: string;
  line: number;
  /** Module literals as written (not case-folded), or OPAQUE. */
  modules: string[];
}

// --------------------------------------------------------------------------
// Reader
// --------------------------------------------------------------------------

function propName(name: ts.PropertyName | ts.MemberName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x)) {
    x = x.expression;
  }
  return x;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && (p as ts.FunctionLikeDeclaration).body) return p;
  }
  return undefined;
}

function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) return p;
  }
  return undefined;
}

function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propName(p.name) === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

/** The initializer of `name` declared in the function enclosing `at`, if any. */
function initializerOf(name: string, at: ts.Node): ts.Expression | undefined {
  const fn = enclosingFunction(at);
  if (!fn) return undefined;
  let found: ts.Expression | undefined;
  const visit = (n: ts.Node) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

/** The literal values an expression used as Activity.module can take, or OPAQUE. */
function moduleValues(expr: ts.Expression, at: ts.Node, seen = new Set<ts.Node>()): Set<string> {
  const e = unwrap(expr);
  if (seen.has(e)) return new Set([OPAQUE]);
  seen.add(e);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return new Set([e.text]);
  if (ts.isConditionalExpression(e)) return new Set([...moduleValues(e.whenTrue, at, seen), ...moduleValues(e.whenFalse, at, seen)]);
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return new Set([...moduleValues(e.left, at, seen), ...moduleValues(e.right, at, seen)]);
  }
  if (ts.isIdentifier(e)) {
    const init = initializerOf(e.text, at);
    return init ? moduleValues(init, at, seen) : new Set([OPAQUE]);
  }
  if (ts.isPropertyAccessExpression(e) && e.name.text === 'module' && ts.isIdentifier(unwrap(e.expression))) {
    return inputModules(e.expression, at, seen);
  }
  return new Set([OPAQUE]);
}

/** The module values of an Activity input object (a literal, or a variable holding one). */
function inputModules(arg: ts.Expression | undefined, at: ts.Node, seen = new Set<ts.Node>()): Set<string> {
  if (!arg) return new Set([OPAQUE]);
  const a = unwrap(arg);
  if (ts.isIdentifier(a)) {
    const init = initializerOf(a.text, at);
    return init ? inputModules(init, at, seen) : new Set([OPAQUE]);
  }
  if (!ts.isObjectLiteralExpression(a)) return new Set([OPAQUE]);
  const value = objectProp(a, 'module');
  if (value) return moduleValues(value, at, seen);
  return new Set([OPAQUE]); // module is required on every Activity input: unseen means opaque
}

/** The module values a Prisma Activity write's first argument writes (null: it writes no module). */
function prismaModules(op: string, arg: ts.Expression | undefined, at: ts.Node): Set<string> | null {
  if (!arg) return new Set([OPAQUE]);
  const a = unwrap(arg);
  if (!ts.isObjectLiteralExpression(a)) return new Set([OPAQUE]);
  const fields = op === 'upsert' ? ['create', 'update'] : ['data'];
  const out = new Set<string>();
  let writesModule = op === 'create' || op === 'createMany' || op === 'upsert';
  for (const f of fields) {
    const v0 = objectProp(a, f);
    if (!v0) continue;
    const v = unwrap(v0);
    const items = ts.isArrayLiteralExpression(v) ? v.elements : [v];
    for (const item of items) {
      const obj = unwrap(item as ts.Expression);
      if (ts.isObjectLiteralExpression(obj) && !objectProp(obj, 'module') && !obj.properties.some(ts.isSpreadAssignment)) {
        if (op === 'create' || op === 'createMany' || (op === 'upsert' && f === 'create')) out.add(OPAQUE);
        continue;
      }
      writesModule = true;
      for (const m of inputModules(obj, at)) out.add(m);
    }
  }
  if (!writesModule) return null;
  if (out.size === 0) out.add(OPAQUE);
  return out;
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

function typeName(t: ts.TypeNode | undefined): string | null {
  if (!t) return null;
  if (ts.isTypeReferenceNode(t)) return ts.isIdentifier(t.typeName) ? t.typeName.text : t.typeName.right.text;
  if (ts.isUnionTypeNode(t)) {
    for (const u of t.types) {
      const n = typeName(u);
      if (n) return n;
    }
  }
  return null;
}

/** Field name -> declared type name, for the class's constructor parameters and properties. */
function fieldTypes(cls: ts.ClassLikeDeclaration): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cls.members) {
    if (ts.isPropertyDeclaration(m)) {
      const n = propName(m.name);
      const t = typeName(m.type);
      if (n && t) out.set(n, t);
    }
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        if (ts.isIdentifier(p.name)) {
          const t = typeName(p.type);
          if (t) out.set(p.name.text, t);
        }
      }
    }
  }
  return out;
}

/** The class a getter method returns: its return type, or `return <x>.get(Class, ...)`. */
function getterType(cls: ts.ClassLikeDeclaration, method: string): string | null {
  for (const m of cls.members) {
    if (!ts.isMethodDeclaration(m) || propName(m.name) !== method) continue;
    const declared = typeName(m.type);
    if (declared) return declared;
    let found: string | null = null;
    const visit = (n: ts.Node) => {
      if (!found && ts.isReturnStatement(n) && n.expression) {
        const r = unwrap(n.expression);
        if (ts.isCallExpression(r) && r.arguments[0] && ts.isIdentifier(unwrap(r.arguments[0]))) found = (unwrap(r.arguments[0]) as ts.Identifier).text;
      }
      ts.forEachChild(n, visit);
    };
    visit(m);
    return found;
  }
  return null;
}

/** The declared class of a call's receiver, when the reader can tell. */
function receiverType(recv: ts.Expression, at: ts.Node): string | null {
  const r = unwrap(recv);
  const cls = enclosingClass(at);
  if (!cls) return null;
  if (r.kind === ts.SyntaxKind.ThisKeyword) return cls.name?.text ?? null;
  if (ts.isPropertyAccessExpression(r) && unwrap(r.expression).kind === ts.SyntaxKind.ThisKeyword) {
    return fieldTypes(cls).get(r.name.text) ?? null;
  }
  if (ts.isCallExpression(r)) {
    const c = unwrap(r.expression);
    if (ts.isPropertyAccessExpression(c) && unwrap(c.expression).kind === ts.SyntaxKind.ThisKeyword) return getterType(cls, c.name.text);
  }
  return null;
}

function isActivityDelegate(e: ts.Expression): boolean {
  const x = unwrap(e);
  if (ts.isPropertyAccessExpression(x)) return x.name.text === 'activity';
  if (ts.isElementAccessExpression(x)) {
    const a = unwrap(x.argumentExpression);
    return (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === 'activity';
  }
  return false;
}

function hasActivityShape(arg: ts.Expression | undefined): boolean {
  if (!arg) return false;
  const a = unwrap(arg);
  return ts.isObjectLiteralExpression(a) && ACTIVITY_SHAPE.every((k) => objectProp(a, k) !== undefined);
}

/** Every Activity writer in one source file (`rel` is the path under src). */
export function scanActivityWriters(rel: string, source: string): ActivityWriter[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: ActivityWriter[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const record = (n: ts.Node, modules: Set<string>) => {
    const key = ownerKey(rel, n);
    if (PASS_THROUGH.has(key)) return;
    found.push({ key, line: lineOf(n), modules: [...modules].sort() });
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const arg = n.arguments[0];
        if (PRISMA_OPS.has(method) && isActivityDelegate(callee.expression)) {
          const modules = prismaModules(method, arg, n);
          if (modules) record(n, modules);
        } else if (method === 'recordEvent' || method === 'log' || method === 'createActivity') {
          const type = receiverType(callee.expression, n);
          const typed =
            (method === 'recordEvent' && type === 'TimelineService') ||
            (method === 'log' && type === 'ActivityService') ||
            method === 'createActivity';
          if (typed || (type === null && hasActivityShape(arg))) record(n, inputModules(arg, n));
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

function scanAll(): ActivityWriter[] {
  return sourceFiles(SRC).flatMap((f) => scanActivityWriters(relative(SRC, f).split(sep).join('/'), readFileSync(f, 'utf8')));
}

const at = (w: ActivityWriter) => `${w.key.split('#')[0]}:${w.line} (${w.key.split('#')[1]})`;

// --------------------------------------------------------------------------
// Cases
// --------------------------------------------------------------------------

describe('V1-84: every Activity.module written at head is mapped (D-63 census)', () => {
  const writers = scanAll();

  it('TV-01: every module literal an Activity writer writes has an entry in ACTIVITY_MODULE_SCOPES (case-folded)', async () => {
    const { activityModuleScope } = await visibility();
    const unmapped = writers.flatMap((w) =>
      w.modules.filter((m) => m !== OPAQUE && activityModuleScope(m) === null).map((m) => `${at(w)} writes module '${m}', which ACTIVITY_MODULE_SCOPES does not map`),
    );
    expect(unmapped).toEqual([]);
  });

  it('TV-02: no writer writes a module the reader cannot see, unless OPAQUE_WRITERS names it with a reason', async () => {
    await visibility();
    const opaque = writers.filter((w) => w.modules.includes(OPAQUE) && !OPAQUE_WRITERS[w.key]).map((w) => `${at(w)} writes a module the census cannot read`);
    expect(opaque).toEqual([]);
    const keys = new Set(writers.map((w) => w.key));
    expect(Object.keys(OPAQUE_WRITERS).filter((k) => !keys.has(k)), 'stale OPAQUE_WRITERS entries').toEqual([]);
  });

  it('TV-03: the reader finds one writer of every family (TimelineService, ActivityService, ActivityLogService, Prisma) and resolves a variable input', async () => {
    await visibility();
    const by = (file: string, module: string) => writers.some((w) => w.key.startsWith(`${file}#`) && w.modules.includes(module));
    expect(by('modules/procurement/procurement.service.ts', 'procurement'), 'TimelineService.recordEvent').toBe(true);
    expect(by('modules/timeline/timeline.service.ts', 'crm'), "TimelineService's own wrappers").toBe(true);
    expect(by('modules/flow/activity-event.listener.ts', 'commerce'), 'ActivityService.log').toBe(true);
    expect(by('modules/ai/flow-orchestrator.service.ts', 'ai'), 'ActivityLogService.createActivity via a getter').toBe(true);
    expect(by('modules/site/presence/presence.service.ts', 'site'), 'prisma activity.create').toBe(true);
    expect(by('modules/commerce/payment-evidence.service.ts', 'COMMERCE'), 'tx.activity.create').toBe(true);
    // revenue-posting writes `entry` (a const object) and `entry.module`.
    expect(writers.filter((w) => w.key.startsWith('modules/finance/revenue-posting.service.ts#') && w.modules.includes('FINANCE')).length).toBeGreaterThanOrEqual(3);
    // The AI execution log has its own table and its own `module`; it is not an Activity writer.
    expect(writers.some((w) => w.key.startsWith('modules/autopilot/delegation-loop.service.ts#'))).toBe(false);
  });

  it('TV-04: scanner self-test: each writer form is found with its module; a non-Activity .log is not', async () => {
    await visibility();
    const src = `
      class TimelineService { async recordEvent(input: any) { return this.prisma.client.activity.create({ data: { module: input.module } }); }
        async a() { return this.recordEvent({ module: 'self_wrapper', action: 'x', entityType: 'y', title: 't' }); } }
      class A {
        constructor(private readonly timeline: TimelineService, private readonly activity: ActivityService, private readonly executionLog: AiExecutionLogService, private readonly moduleRef: any) {}
        private getActivityLog() { return this.moduleRef.get(ActivityLogService, { strict: false }); }
        async w(flag: boolean, dynamic: string) {
          await this.timeline.recordEvent({ businessId: 'b', module: flag ? 'tl_a' : 'tl_b', action: 'x', entityType: 'y', title: 't' });
          await this.timeline?.recordEvent({ module: 'tl_optional', action: 'x', entityType: 'y', title: 't' });
          await this.activity.log({ module: 'act_log', action: 'x', entityType: 'y', title: 't' });
          await this.getActivityLog().createActivity({ module: 'act_create', action: 'x', entityType: 'y', title: 't' });
          await this.executionLog.log({ module: 'not_activity', action: 'x' });
          const entry = { module: 'via_entry', action: 'x', entityType: 'y', title: 't' };
          await this.timeline.recordEvent(entry);
          await db.activity.create({ data: { module: entry.module, action: 'x' } });
          await tx['activity'].createMany({ data: [{ module: 'many_a' }, { module: 'many_b' }] });
          await this.prisma.client.activity.update({ where: { id: 'i' }, data: { title: 'no module' } });
          await this.prisma.client.activity.upsert({ where: { id: 'i' }, create: { module: 'up_create' }, update: { module: 'UP_UPDATE' } });
          const m = 'via_const';
          await someone.log({ module: m, action: 'x', entityType: 'y', title: 't' });
          await this.activity.log({ module: dynamic, action: 'x', entityType: 'y', title: 't' });
        }
      }`;
    const found = scanActivityWriters('modules/x/x.ts', src);
    const modules = found.flatMap((w) => w.modules).sort();
    // OPAQUE twice: the implementation-shaped TimelineService.recordEvent (its
    // `input.module`, a parameter, outside the pass-through list under this
    // path) and the `dynamic` parameter.
    expect(modules).toEqual(
      [OPAQUE, OPAQUE, 'UP_UPDATE', 'act_create', 'act_log', 'many_a', 'many_b', 'self_wrapper', 'tl_a', 'tl_b', 'tl_optional', 'up_create', 'via_const', 'via_entry', 'via_entry'].sort(),
    );
    expect(modules).not.toContain('not_activity');
    // The implementation's own pass-through is not a writer.
    expect(scanActivityWriters('modules/timeline/timeline.service.ts', src).some((w) => w.key.endsWith('TimelineService.recordEvent'))).toBe(false);
  });

  it('TV-05: the table maps onto canonical modules only, keyed case-folded, and pins D-63', async () => {
    const { ACTIVITY_MODULE_SCOPES } = await visibility();
    const { CANONICAL_MODULES } = await import('../../core/authority/module-vocabulary');
    for (const [key, scope] of Object.entries(ACTIVITY_MODULE_SCOPES)) {
      expect(key, 'keys are case-folded and trimmed').toBe(key.trim().toLowerCase());
      expect(CANONICAL_MODULES as readonly string[], `${key} -> ${scope}`).toContain(scope);
    }
    const pinned: Record<string, string> = {
      // D-63 (i) KEY / AI rows
      ai: 'ai', agent: 'ai', 'key-ai': 'ai', key_cortex: 'ai', key_inbox: 'ai', intelligence: 'ai', autopilot: 'ai',
      // D-63 (ii) settings rows; (iv) genome, site, notifications per this table
      settings: 'settings', genome: 'settings', site: 'settings', notifications: 'settings',
      // D-63 (iii) communications / messages / inbox
      communications: 'crm', messages: 'crm', inbox: 'crm',
      // D-63 (iv) analytics
      analytics: 'analytics',
      // the canonical families (cluster D)
      crm: 'crm', contacts: 'crm',
      commerce: 'revenue', revenue: 'revenue', finance: 'revenue', invoicing: 'revenue',
      bookings: 'bookings',
      operations: 'operations', procurement: 'operations', command: 'operations', commandcenter: 'operations',
      expenses: 'expenses', expense: 'expenses',
      projects: 'projects', project: 'projects',
      automation: 'automations', flow: 'automations',
      content: 'content', social: 'content', marketing: 'content',
      storefront: 'storefront',
      connect: 'connect',
    };
    for (const [key, scope] of Object.entries(pinned)) expect(ACTIVITY_MODULE_SCOPES[key], key).toBe(scope);
  });

  it("TV-06: classification is case-folded: 'REVENUE', 'BOOKINGS' and 'EXPENSE' classify as their lower-case forms; an unmapped module classifies as null", async () => {
    const { activityModuleScope } = await visibility();
    expect(activityModuleScope('REVENUE')).toBe('revenue');
    expect(activityModuleScope('revenue')).toBe('revenue');
    expect(activityModuleScope('BOOKINGS')).toBe('bookings');
    expect(activityModuleScope('bookings')).toBe('bookings');
    expect(activityModuleScope('EXPENSE')).toBe('expenses');
    expect(activityModuleScope('expenses')).toBe('expenses');
    expect(activityModuleScope('COMMERCE')).toBe('revenue');
    expect(activityModuleScope('PROJECT')).toBe('projects');
    expect(activityModuleScope('Key_Cortex')).toBe('ai');
    expect(activityModuleScope('v84a_unmapped')).toBeNull();
    expect(activityModuleScope('')).toBeNull();
    expect(activityModuleScope(null)).toBeNull();
  });
});

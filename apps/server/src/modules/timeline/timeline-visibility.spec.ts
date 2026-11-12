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
 *   TV-08 (review ST-1) a row names the contact of its contactId, and of its
 *         entityId when its entityType is 'contact'; such a row needs crm.
 *   TV-07 (review ST-2) a writer whose title / detail interpolates a contact
 *         (CONTACT_TEXT) but sets neither contactId nor entityType 'contact'
 *         + entityId is listed in TEXT_ONLY_CONTACT_WRITERS as a follow-up:
 *         the feed's contact rule cannot see which contact such a row names.
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

/**
 * TV-07 (review ST-2): writers whose row names a contact only in its title or
 * detail text, with no contactId and no entityType 'contact' + entityId, so
 * the feed's contact rule cannot withhold it from a member who may not open
 * that contact (the row is still governed by its module and by revenue).
 * Each entry is an open FOLLOW-UP outside V1-84's write set: the writer must
 * set contactId (then it leaves this list, and TV-07 fails until it does).
 * Detection is a heuristic (CONTACT_TEXT in title / detail); entries the
 * heuristic cannot see are listed by hand and marked so.
 *
 * Empty since W9-TEXT-ONLY-CONTACT-WRITERS (review ST-2, owner ruling D-63):
 * the two follow-ups V1-84 listed now carry the contactId of the contact they
 * name, proven on a real database by timeline-scope TS-13a..c:
 *   - KEY send_invoice ('Invoice <n> sent to <contactName>', module commerce,
 *     FlowOrchestratorService.executeToolAction): contactId: invoice.contactId;
 *   - message_intake.approved (detail = the intake plan's summary of the
 *     inbound message, module communications,
 *     MessageIntakeOrchestrator.executePlan): the intake's contactId. It was
 *     listed by hand (the heuristic cannot see a summary's content), so TV-07
 *     cannot see it regress; TS-13b does.
 * The list judges writers, not stored rows: rows these two writers stored
 * before the packet keep contactId null and are still served to a member who
 * may not open the contact they name (review SEC-W9TO-1, D-63), a follow-up
 * outside the packet's write set recorded as timeline-scope TS-13d (it.todo).
 * A new entry is a writer that genuinely cannot name its contact, with why.
 */
const TEXT_ONLY_CONTACT_WRITERS: Record<string, string> = {};
/** Entries above the heuristic does not flag, kept on purpose (none since W9-TEXT-ONLY-CONTACT-WRITERS). */
const TEXT_ONLY_BY_HAND = new Set<string>();

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
  /**
   * TV-07 (review ST-2): the row's title or detail interpolates a contact's
   * name or record (an identifier matching CONTACT_TEXT) while the input sets
   * no contactId and no entityType 'contact' with an entityId, so the
   * feed's contact rule (namedContacts) cannot see which contact it names.
   */
  textOnlyContact: boolean;
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

/** Identifiers in a title / detail expression that carry a contact's name or record. */
const CONTACT_TEXT = /contact|customer|client|firstname|lastname|fullname/i;

/** Whether `expr` mentions an identifier matching CONTACT_TEXT anywhere inside it. */
function mentionsContact(expr: ts.Node): boolean {
  if ((ts.isIdentifier(expr) || ts.isPrivateIdentifier(expr)) && CONTACT_TEXT.test(expr.text)) return true;
  return ts.forEachChild(expr, (c) => (mentionsContact(c) ? true : undefined)) === true;
}

/** The object literal(s) a writer call writes: the input of a service writer, the `data` (or upsert create/update) of a Prisma write. */
function writtenObjects(arg: ts.Expression | undefined, at: ts.Node, prismaOp?: string): ts.ObjectLiteralExpression[] {
  if (!arg) return [];
  let a = unwrap(arg);
  if (ts.isIdentifier(a)) {
    const init = initializerOf(a.text, at);
    if (!init) return [];
    a = unwrap(init);
  }
  if (!ts.isObjectLiteralExpression(a)) return [];
  if (!prismaOp) return [a];
  const out: ts.ObjectLiteralExpression[] = [];
  for (const f of prismaOp === 'upsert' ? ['create', 'update'] : ['data']) {
    const v0 = objectProp(a, f);
    if (!v0) continue;
    const v = unwrap(v0);
    for (const item of ts.isArrayLiteralExpression(v) ? v.elements : [v]) {
      const obj = unwrap(item as ts.Expression);
      if (ts.isObjectLiteralExpression(obj)) out.push(obj);
    }
  }
  return out;
}

/** TV-07: the object names a contact in its text but not in contactId / entityType 'contact' + entityId. */
function textOnlyContact(obj: ts.ObjectLiteralExpression): boolean {
  if (obj.properties.some(ts.isSpreadAssignment)) return false; // a spread may carry contactId: not judged
  if (objectProp(obj, 'contactId')) return false;
  const entityType = objectProp(obj, 'entityType');
  const et = entityType ? unwrap(entityType) : undefined;
  if (et && (ts.isStringLiteral(et) || ts.isNoSubstitutionTemplateLiteral(et)) && et.text.trim().toLowerCase() === 'contact' && objectProp(obj, 'entityId')) {
    return false;
  }
  return ['title', 'detail'].some((k) => {
    const v = objectProp(obj, k);
    return v !== undefined && mentionsContact(v);
  });
}

/** Every Activity writer in one source file (`rel` is the path under src). */
export function scanActivityWriters(rel: string, source: string): ActivityWriter[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: ActivityWriter[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const record = (n: ts.Node, modules: Set<string>, objects: ts.ObjectLiteralExpression[]) => {
    const key = ownerKey(rel, n);
    if (PASS_THROUGH.has(key)) return;
    found.push({ key, line: lineOf(n), modules: [...modules].sort(), textOnlyContact: objects.some(textOnlyContact) });
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const arg = n.arguments[0];
        if (PRISMA_OPS.has(method) && isActivityDelegate(callee.expression)) {
          const modules = prismaModules(method, arg, n);
          if (modules) record(n, modules, writtenObjects(arg, n, method));
        } else if (method === 'recordEvent' || method === 'log' || method === 'createActivity') {
          const type = receiverType(callee.expression, n);
          const typed =
            (method === 'recordEvent' && type === 'TimelineService') ||
            (method === 'log' && type === 'ActivityService') ||
            method === 'createActivity';
          if (typed || (type === null && hasActivityShape(arg))) record(n, inputModules(arg, n), writtenObjects(arg, n));
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

  it('TV-07 (review ST-2): every writer whose title / detail names a contact without contactId or entityType contact + entityId is a listed follow-up (TEXT_ONLY_CONTACT_WRITERS), and no entry is stale', async () => {
    await visibility();
    const flagged = [...new Set(writers.filter((w) => w.textOnlyContact).map((w) => w.key))].sort();
    const unlisted = flagged.filter((k) => !TEXT_ONLY_CONTACT_WRITERS[k]).map((k) => `${k} names a contact only in its text: set contactId, or list it with a follow-up`);
    expect(unlisted).toEqual([]);
    const keys = new Set(writers.map((w) => w.key));
    expect(Object.keys(TEXT_ONLY_CONTACT_WRITERS).filter((k) => !keys.has(k)), 'entries that are no writer').toEqual([]);
    expect(
      Object.keys(TEXT_ONLY_CONTACT_WRITERS).filter((k) => !TEXT_ONLY_BY_HAND.has(k) && !flagged.includes(k)),
      'entries the heuristic no longer flags (the writer now names its contact): remove them',
    ).toEqual([]);
    // The detector: a contact name in the title without contactId is flagged;
    // with contactId, or with entityType 'contact' + entityId, it is not.
    const probe = scanActivityWriters('modules/x/y.ts', `
      class B { constructor(private readonly activity: ActivityService) {}
        async a(contactName: string, id: string, c: any) {
          await this.activity.log({ module: 'commerce', action: 'a', entityType: 'invoice', entityId: id, title: \`Invoice sent to \${contactName}\` });
          await this.activity.log({ module: 'commerce', action: 'b', entityType: 'invoice', entityId: id, contactId: c.id, title: \`Invoice sent to \${contactName}\` });
          await this.activity.log({ module: 'ai', action: 'c', entityType: 'Contact', entityId: id, title: \`Message to \${c.firstName}\` });
          await this.activity.log({ module: 'ai', action: 'd', entityType: 'job', entityId: id, title: 'Nightly run' });
        } }`);
    expect(probe.map((w) => w.textOnlyContact)).toEqual([true, false, false, false]);
  });

  it("TV-08 (review ST-1): a row names the contact of its contactId and, when its entityType is 'contact' (case-folded), of its entityId; such a row needs crm read", async () => {
    const { namedContacts, canReadActivityRow } = await visibility();
    expect(namedContacts({ contactId: 'c1' })).toEqual(['c1']);
    expect(namedContacts({ entityType: 'contact', entityId: 'c2' })).toEqual(['c2']);
    expect(namedContacts({ entityType: ' Contact ', entityId: 'c2' })).toEqual(['c2']);
    expect(namedContacts({ entityType: 'contact', entityId: 'c2', contactId: 'c1' })).toEqual(['c1', 'c2']);
    expect(namedContacts({ entityType: 'contact', entityId: 'c1', contactId: 'c1' })).toEqual(['c1']);
    expect(namedContacts({ entityType: 'invoice', entityId: 'i1' })).toEqual([]);
    expect(namedContacts({ entityType: 'contact', entityId: '' })).toEqual([]);
    expect(namedContacts({ entityType: 'contact', entityId: null })).toEqual([]);
    const viewer = (readable: string[]) => ({
      businessId: 'b', userId: 'u', readsUnmapped: false, readable: new Set(readable) as any, crmAccess: {} as any,
    });
    const keyRow = { module: 'ai', entityType: 'contact', entityId: 'c2' };
    expect(canReadActivityRow(viewer(['ai']), keyRow)).toBe(false);
    expect(canReadActivityRow(viewer(['ai', 'crm']), keyRow)).toBe(true);
    expect(canReadActivityRow(viewer(['ai']), { module: 'ai', entityType: 'key_command', entityId: 'k1' })).toBe(true);
  });

  it("TV-09 (W5-FEED-CATEGORIES review SEC-W5FC-2 / CR-W5FC-1 / CR-W5FC-2; D-63, D-90): a crm-scope row whose data carries an amount, or whose action is a sales_revenue ContactEvent type, needs revenue read whatever its category; an EXPENSE row with data.amount keeps D-63's binding (expenses read)", async () => {
    const { canReadActivityRow } = await visibility();
    const viewer = (readable: string[]) => ({
      businessId: 'b', userId: 'u', readsUnmapped: false, readable: new Set(readable) as any, crmAccess: {} as any,
    });
    // D-63: ExpensesService's rows (data.amount, no category) are governed by expenses, not revenue.
    const expense = { module: 'EXPENSE', action: 'created', entityType: 'expense', entityId: 'e1', category: null, data: { amount: 12.5, currency: 'TTD' } };
    expect(canReadActivityRow(viewer(['expenses']), expense)).toBe(true);
    expect(canReadActivityRow(viewer(['expenses', 'revenue']), expense)).toBe(true);
    expect(canReadActivityRow(viewer(['crm', 'revenue']), expense)).toBe(false);
    // SEC-FCC-1: a crm copy stored as CONTACT (or none) carrying an amount, as an object or a JSON string.
    const payment = { module: 'crm', action: 'invoice.payment_recorded', category: 'CONTACT', contactId: 'c1', data: { amount: 10, invoiceTotal: 20 } };
    expect(canReadActivityRow(viewer(['crm']), payment)).toBe(false);
    expect(canReadActivityRow(viewer(['crm', 'revenue']), payment)).toBe(true);
    const order = { module: 'crm', action: 'store_order.paid', category: null, contactId: 'c1', data: JSON.stringify({ total: 9 }) };
    expect(canReadActivityRow(viewer(['crm']), order)).toBe(false);
    // D-63 (iii): communications rows are crm-scope rows too.
    expect(canReadActivityRow(viewer(['crm']), { module: 'communications', action: 'sent', category: null, contactId: 'c1', data: { amount: 5 } })).toBe(false);
    // CR-W5FC-2: a sales_revenue copy (the deal amount is data.value), by its action or its type.
    const dealWon = { module: 'crm', action: 'deal.won', category: 'CONTACT', contactId: 'c1', data: { dealId: 'd1', value: 5000, currency: 'TTD' } };
    expect(canReadActivityRow(viewer(['crm']), dealWon)).toBe(false);
    expect(canReadActivityRow(viewer(['crm', 'revenue']), dealWon)).toBe(true);
    expect(canReadActivityRow(viewer(['crm']), { module: 'CRM', action: 'logged', type: 'deal.lost', category: null, contactId: 'c1', data: { value: 1 } })).toBe(false);
    // A crm copy with no amount and a type outside sales_revenue stays a crm row.
    expect(canReadActivityRow(viewer(['crm']), { module: 'crm', action: 'communication.call', category: 'CONTACT', contactId: 'c1', data: { summary: 'x', amountNote: 1 } })).toBe(true);
    expect(canReadActivityRow(viewer(['crm']), { module: 'crm', action: 'note.created', category: null, contactId: 'c1', data: { amount: null } })).toBe(true);
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

/**
 * W11-D118-NAME-MISMATCH-OWNER-ONLY (owner ruling D-118, narrowing D-115; review
 * SEC-W10DCS-2, ruling R-1). The D-115 backfill (scripts/backfill-timeline-contact-links.ts)
 * files a row it cannot tie to a contact under module 'd115_withheld' (unmapped, D-63) with
 * data.d115.withheld = 'source_gone' or 'name_mismatch'. A name_mismatch row is an invoice
 * row whose invoice is there but names another contact: its title may name a PRIVATE
 * contact, so D-118 serves it to the OWNER and SUPER_ADMIN only (TimelineViewer
 * readsOwnerWithheld). A source_gone row keeps D-115 (OWNER and ADMIN). A withheld row
 * whose reason is absent or unknown is read as owner-only (fail closed). "The OWNER" is an
 * OWNER-role Membership of the business: D-116 as read by D-125 (a recorded owner holding
 * only ADMIN or STAFF is that role; a co-owner holding OWNER is the owner).
 */
describe('W11-D118-NAME-MISMATCH-OWNER-ONLY (D-118): name_mismatch withheld rows are served to the OWNER and SUPER_ADMIN only', () => {
  const crmAccess = { isOwner: false, isSuperAdmin: false, viewAll: true, editScope: 'any', reassign: false, deleteScope: 'none', level: 'admin' } as any;
  const viewer = (readable: string[], extra: { readsUnmapped?: boolean; readsOwnerWithheld?: boolean } = {}) => ({
    businessId: 'b', userId: 'u', readsUnmapped: true, readable: new Set(readable) as any, crmAccess, ...extra,
  });
  const nameMismatch = {
    module: 'd115_withheld',
    category: 'COMMERCE',
    entityType: 'invoice',
    data: { d115: { withheld: 'name_mismatch', module: 'commerce', category: null } } as unknown,
  };
  const sourceGone = { ...nameMismatch, data: { d115: { withheld: 'source_gone', module: 'commerce', category: null } } };

  it("TV-10 (D-118): a d115_withheld row with reason name_mismatch is not served to an ADMIN reading revenue (readsUnmapped, no readsOwnerWithheld), is served with readsOwnerWithheld, and still needs revenue read (the money term binds the owner too); the same row with reason source_gone stays served to that ADMIN (D-115); a d115_withheld row with no or an unknown d115.withheld is owner-only (fail closed); another unmapped module keeps D-63's OWNER and ADMIN branch", async () => {
    const { canReadActivityRow } = await visibility();
    const admin = viewer(['crm', 'revenue', 'ai']);
    const owner = viewer(['crm', 'revenue', 'ai'], { readsOwnerWithheld: true });
    const ownerNoRevenue = viewer(['crm', 'ai'], { readsOwnerWithheld: true });

    expect(canReadActivityRow(admin, nameMismatch), 'ADMIN reading revenue, name_mismatch').toBe(false);
    expect(canReadActivityRow({ ...admin, readsOwnerWithheld: false }, nameMismatch), 'readsOwnerWithheld false').toBe(false);
    expect(canReadActivityRow(owner, nameMismatch), 'readsOwnerWithheld').toBe(true);
    expect(canReadActivityRow(ownerNoRevenue, nameMismatch), 'owner without revenue read: the money term binds').toBe(false);
    // readsOwnerWithheld never replaces the D-63 unmapped term: a viewer without readsUnmapped is refused all the same.
    expect(canReadActivityRow({ ...owner, readsUnmapped: false }, nameMismatch), 'no readsUnmapped').toBe(false);
    // Nor the SEC-W10DCS-1 source-scope term (data.d115.module 'commerce' -> revenue).
    expect(canReadActivityRow(owner, { ...nameMismatch, category: null }), 'owner reading revenue, no category').toBe(true);
    expect(canReadActivityRow(ownerNoRevenue, { ...nameMismatch, category: null }), 'source scope revenue not read').toBe(false);

    // D-115 unchanged for source_gone rows: OWNER and ADMIN (revenue read for an invoice row).
    expect(canReadActivityRow(admin, sourceGone), 'ADMIN reading revenue, source_gone').toBe(true);
    expect(canReadActivityRow(owner, sourceGone), 'owner, source_gone').toBe(true);
    expect(canReadActivityRow(viewer(['crm', 'ai']), sourceGone), 'ADMIN without revenue read, source_gone').toBe(false);
    expect(canReadActivityRow(viewer(['crm', 'revenue'], { readsUnmapped: false }), sourceGone), 'STAFF, source_gone').toBe(false);

    // Case-folded module, as withheldSourceScope reads it.
    expect(canReadActivityRow(admin, { ...nameMismatch, module: ' D115_Withheld ' }), 'case-folded module').toBe(false);
    expect(canReadActivityRow(owner, { ...nameMismatch, module: ' D115_Withheld ' }), 'case-folded module, owner').toBe(true);

    // Fail closed: no data, no d115, no or an unknown reason, or data that is not an object.
    const unclear: Array<Record<string, unknown>> = [
      { ...nameMismatch, data: undefined },
      { ...nameMismatch, data: null },
      { ...nameMismatch, data: {} },
      { ...nameMismatch, data: { d115: null } },
      { ...nameMismatch, data: { d115: { module: 'commerce', category: null } } },
      { ...nameMismatch, data: { d115: { withheld: 'other', module: 'commerce', category: null } } },
      { ...nameMismatch, data: { d115: { withheld: 'SOURCE_GONE', module: 'commerce', category: null } } },
      { ...nameMismatch, data: { d115: { withheld: null, module: 'commerce', category: null } } },
      { ...nameMismatch, data: JSON.stringify({ d115: { withheld: 'source_gone', module: 'commerce', category: null } }) },
      { module: 'd115_withheld', category: 'COMMERCE', entityType: 'invoice', entityId: 'i1' },
    ];
    for (const row of unclear) {
      expect(canReadActivityRow(admin, row), `ADMIN: ${JSON.stringify(row.data)}`).toBe(false);
      expect(canReadActivityRow(owner, row), `owner: ${JSON.stringify(row.data)}`).toBe(true);
    }

    // D-63's unmapped branch for any other unmapped module: OWNER and ADMIN, whatever its data says.
    const otherUnmapped = { module: 'v118_unmapped', category: null, entityType: 'job', data: { d115: { withheld: 'name_mismatch' } } };
    expect(canReadActivityRow(admin, otherUnmapped), 'another unmapped module, ADMIN').toBe(true);
    expect(canReadActivityRow(viewer(['crm', 'revenue'], { readsUnmapped: false }), otherUnmapped), 'another unmapped module, STAFF').toBe(false);
    // A mapped row that carries a d115 marker in its data is judged by its module only.
    expect(canReadActivityRow(viewer(['revenue'], { readsUnmapped: false }), { ...nameMismatch, module: 'commerce' }), 'a mapped row').toBe(true);
  });

  it('TV-10b (D-118 with D-116 / D-125): resolveTimelineViewer sets readsOwnerWithheld for a SUPER_ADMIN and for an OWNER membership, and not for an ADMIN or STAFF membership (a recorded owner holding only ADMIN included, D-116); readsUnmapped is unchanged (OWNER, ADMIN, SUPER_ADMIN)', async () => {
    const { resolveTimelineViewer } = await visibility();
    const prismaFor = (userRole: string, membership: Record<string, unknown> | null) =>
      ({
        client: {
          user: { findUnique: async () => ({ id: 'u', role: userRole }) },
          membership: { findUnique: async () => membership },
        },
      }) as any;

    const superAdmin = await resolveTimelineViewer(prismaFor('SUPER_ADMIN', null), 'b', 'u');
    expect([superAdmin.readsOwnerWithheld, superAdmin.readsUnmapped], 'SUPER_ADMIN').toEqual([true, true]);
    const owner = await resolveTimelineViewer(prismaFor('USER', { role: 'OWNER', permissionScopes: null }), 'b', 'u');
    expect([owner.readsOwnerWithheld, owner.readsUnmapped], 'OWNER membership').toEqual([true, true]);
    const admin = await resolveTimelineViewer(prismaFor('USER', { role: 'ADMIN', permissionScopes: null }), 'b', 'u');
    expect([admin.readsOwnerWithheld, admin.readsUnmapped], 'ADMIN membership (a recorded owner holding ADMIN too, D-116)').toEqual([false, true]);
    const staff = await resolveTimelineViewer(prismaFor('USER', { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } }), 'b', 'u');
    expect([staff.readsOwnerWithheld, staff.readsUnmapped], 'STAFF membership').toEqual([false, false]);
  });
});

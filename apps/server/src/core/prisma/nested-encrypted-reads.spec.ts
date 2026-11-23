/**
 * FU-DELIVERY-TOKEN-DECRYPT (V1-71) — census of NESTED reads of encrypted columns.
 *
 * The Prisma token-encryption extension (packages/db/src/middleware/token-encryption.ts) encrypts the columns in
 * its field map (ENCRYPTED_FIELDS: Business OAuth tokens, SocialConnection and ChannelConnection token and
 * refreshToken, Webhook secret) on write and decrypts them on read, but only in the TOP-LEVEL rows of a query on
 * that model. A row of an encrypted model read as a nested include or select of another query
 * (`outboundDelivery.findUnique({ include: { destination: { include: { connection: true } } } })`) comes back with the
 * stored ciphertext ('enc:v1:...'). DeliveryQueueService.claimDeliveries read the sending account that way, so
 * every queued Gmail and WhatsApp send put the ciphertext in its Authorization header and the provider refused it.
 *
 * The decrypt step for a nested row is the extension's own helper, decryptNestedRecord(model, row) (exported by
 * @keyflow/db): it decrypts exactly the fields the extension decrypts at the top level, with the same key.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src and packages/api/src):
 *   every call `<x>.<delegate>.<op>(args)` (also `<x>['<delegate>'].<op>(`, and a local const alias of either:
 *   `const d = tx.channelDestination; d.findMany(...)`) whose delegate is a Prisma model (schema.prisma) and whose
 *   receiver is not `this` (a Nest service named like a model is not a delegate). A delegate chosen at run time
 *   (`(db as any)[model]`, or an alias of it) is OPAQUE (SEC-DTD-2). Its args are read when they are an object
 *   literal, or resolve to one: a name declared in the scope it is used in (V71-COR-1: the innermost enclosing
 *   block, function or file that declares it, or a relative module it is imported from; a parameter, a destructured,
 *   loop or catch binding, a package import, or a binding written after its declaration — reassigned, a member set
 *   or deleted, `Object.assign` — is OPAQUE), a static or instance class property (`this.x`, `Cls.X`), a function's
 *   returned object literal, `Prisma.validator<T>()({...})`, `skipTenantIsolation({...})`, every branch of a `? :`,
 *   with spreads expanded and `as` / `satisfies` / `!` looked through. The include / select tree is walked with the
 *   schema's relation types. A relation hop into a model in the field map READS ITS ENCRYPTED FIELDS when it is
 *   `true`, an object without `select` (`{ include }`, `{ where }`, ...), or a `select` naming one of the encrypted
 *   fields. Args, or a relation value, the reader cannot see into are OPAQUE.
 *   Reads are keyed `<repo path>#<Class>.<method> <delegate>.<op> <relation path>` (no line numbers).
 *
 * WHAT IS REQUIRED:
 *   NR-01 every nested encrypted read is DECRYPTED — the function that makes it calls decryptNestedRecord('<Model>',
 *         ...) for the model read, directly or through a same-file helper whose body does — or is in NEVER_USED with
 *         the reason its value never reaches an outbound call or a decision. A new nested read with neither fails,
 *         naming it.
 *   NR-02 every NEVER_USED entry still names a nested read that is not decrypted (a fixed or removed read is taken
 *         off the list), and the function that makes it names none of the model's encrypted fields (`.token`,
 *         `['gmailAccessToken']`, `{ secret }`): the day it starts to, it needs the decrypt step.
 *   NR-03 the delivery queue's reads of the sending account (claimDeliveries: every queued, scheduled and retried
 *         send; retry and retryAllFailed: the manual re-send decision) are DECRYPTED, never listed.
 *   NR-04 every OPAQUE call is in OPAQUE_REVIEWED with the reason it reads no encrypted column, or in OPAQUE_OPEN
 *         naming the open issue that tracks it (it does reach an encrypted column and the fix is not a decrypt
 *         step: KEY's safeQuery, SEC-DTD-2); no stale entry; the dynamic delegate read of safeQuery is seen.
 *   NR-05 the field map is the extension's own: it names exactly the models the extension hooks, and
 *         decryptNestedRecord decrypts exactly those fields (rows, arrays, null).
 *   NR-06 scanner self-test: injected reads in every form are found (a local include reusing a name declared
 *         elsewhere in the file, a delegate alias), opaque forms are reported (a parameter, a binding written after
 *         its declaration, a dynamic delegate); a nested read added without the decrypt step makes the census fail,
 *         and the same read with it passes.
 *
 * WHAT THIS CANNOT DO: it judges the decrypt step by function, not by data flow (it does not prove the decrypted
 * copy is the one used), it does not follow a nested row returned to another file, it does not see a delegate
 * destructured from the client or passed in as a parameter, and it does not see an include object changed by a
 * function it is passed to. The behaviour is proven on a real database by
 * test/delivery-token-decrypt.integration.test.ts (the tapped bearer is the saved token; no response, log line or
 * row carries it).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import * as encryption from '../../../../../packages/db/src/middleware/token-encryption';

const REPO = resolve(__dirname, '../../../../..');
const SCAN_ROOTS = [join(REPO, 'apps/server/src'), join(REPO, 'packages/api/src')];
const SCHEMA = join(REPO, 'packages/db/prisma/schema.prisma');
const EXTENSION = join(REPO, 'packages/db/src/middleware/token-encryption.ts');
const DECRYPT_FN = 'decryptNestedRecord';
/** Pass-through wrappers: the call's first argument is the args. */
const PASS_THROUGH = new Set(['skipTenantIsolation']);
const OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'create', 'createManyAndReturn', 'update', 'updateManyAndReturn', 'upsert', 'delete',
]);

type FieldMap = Record<string, readonly string[]>;
/** The extension's own field map (undefined until the extension exports it). */
const FIELD_MAP: FieldMap = ((encryption as Record<string, unknown>).ENCRYPTED_FIELDS ?? {}) as FieldMap;

/**
 * Nested reads of encrypted columns whose value never reaches an outbound call or a decision. Each reason says where
 * the row goes. Keep it short: a new read that USES a token gets the decrypt step instead.
 */
const NEVER_USED: Record<string, string> = {
  'apps/server/src/modules/communications/channel-connection.service.ts#ChannelConnectionService.listDestinations channelDestination.findMany connection':
    'GET destinations: every row goes through stripSecretsFromDestination, which drops connection.token and refreshToken before the response.',
  'apps/server/src/modules/communications/channel-connection.service.ts#ChannelConnectionService.getDestination channelDestination.findUnique connection':
    'the destination is returned through stripSecretsFromDestination (connection.token and refreshToken dropped); its callers read no token.',
  'apps/server/src/modules/communications/communications.service.ts#CommunicationsService.sendBroadcast channelDestination.findFirst connection':
    'only destination.id is used (publishNow re-reads the connection without its token; the send itself goes through claimDeliveries, which decrypts).',
  'apps/server/src/modules/actions/actions.controller.ts#ActionsController.sendReceipt invoice.findUnique business':
    'answers invoiceNumber, total, currency and the contact email; the business row is not read.',
  'apps/server/src/modules/bookings/calendar.service.ts#CalendarService.syncBookingToCalendar booking.findFirst business':
    'reads business.timezone only; the Calendar token comes from refreshAccessToken(businessId), a top-level (decrypted) read.',
  'apps/server/src/modules/commerce/commerce.service.ts#CommerceService.sendInvoiceReminder invoice.findFirst business':
    'the invoice goes to the deliver callback (buildInvoiceEmailContext reads name, logoUrl, email, phone, primaryColor) and to two events; the mail is sent by GmailService.sendEmail(businessId), which reads its tokens top-level. The events carry the token ciphertext (open issue).',
  'apps/server/src/modules/commerce/invoice-receipt-builder.service.ts#InvoiceReceiptBuilderService.buildReceipt invoice.findFirst business':
    'the receipt projects business.name only.',
  'apps/server/src/modules/portal/portal.service.ts#PortalService.findByToken portalAccess.findUnique business':
    'GET portal/validate answers businessId, contactId and settings; the business row is not read.',
  'apps/server/src/modules/identity/identity.service.ts#IdentityService.ensureBootstrapWorkspace membership.findFirst business':
    'POST identity/bootstrap answers sanitizeBusiness(business), which drops every OAuth token column.',
};

/** Prisma calls whose args the reader cannot see into, each with the reason it reads no encrypted column. */
const OPAQUE_REVIEWED: Record<string, string> = {
  'apps/server/src/modules/ai/flow-orchestrator.service.ts#FlowOrchestratorService.idWithinBusiness <dynamic>.findFirst <delegate>':
    'the model is a DispatcherTenantModel (contentRequest, evidence, approvalRequest, bookingWaitlistEntry, service, staffMember, procurementRequest), none in the field map, and select is { id: true }.',
  'apps/server/src/modules/key-cortex/key-cortex-actions.service.ts#KeyCortexActionsService.handleUpdateCrm <dynamic>.update <delegate>':
    'args are { where, data } with no include or select, and only updated.id is answered (the receiver is PrismaService, which has no model delegates, so the call throws before any query).',
  'apps/server/src/modules/key-cortex/key-cortex-actions.service.ts#KeyCortexActionsService.handleUpdateRecord <dynamic>.update <delegate>':
    'the fallback when no safe database is wired: args are { where, data } with no include or select, and only updated.id is answered (PrismaService has no model delegates, so it throws before any query).',
  'apps/server/src/modules/key-cortex/key-cortex-safe-database.service.ts#KeyCortexSafeDatabaseService.safeUpdate <dynamic>.findFirst <delegate>':
    'select is { id: true }, on a model in UPDATABLE_MODELS (none in the field map).',
  'apps/server/src/modules/key-cortex/key-cortex-safe-database.service.ts#KeyCortexSafeDatabaseService.safeUpdate <dynamic>.update <delegate>':
    'args are { where, data } with no include or select, on a model in UPDATABLE_MODELS (none in the field map), and data keys are allow-listed per model (ALLOWED_UPDATE_FIELDS), so no relation is written or read.',
};

/**
 * Prisma calls whose args the reader cannot see into and that DO reach an encrypted column, where the fix is not a
 * decrypt step. Each value starts with `OPEN <issue id>:` and names the fix. Listing one here records a known open
 * issue; it does not make the read acceptable.
 */
const OPAQUE_OPEN: Record<string, string> = {
  'apps/server/src/modules/key-cortex/key-cortex-safe-database.service.ts#KeyCortexSafeDatabaseService.safeQuery <dynamic>.findMany <delegate>':
    "OPEN SEC-DTD-2: KEY's cortex.query_business_data builds select from the model's field list with no field allow-list (buildSelect), so select ['business'] on a readable model returns the nested Business row to the model provider: its OAuth token columns as ciphertext, and Business.metaData's payment secrets as plaintext. The fix is to refuse relation names in select (server-key chain), not to decrypt.",
};

/** Every opaque call that is accounted for: reviewed (reads no encrypted column) or a recorded open issue. */
const OPAQUE_LISTED: Record<string, string> = { ...OPAQUE_REVIEWED, ...OPAQUE_OPEN };

// ---------------------------------------------------------------------------------------------------------------
// The schema: each model's relation fields and their target model.

function relationsOf(schemaText: string): Map<string, Map<string, string>> {
  const models = new Map<string, string>();
  for (const m of schemaText.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) models.set(m[1], m[2]);
  const out = new Map<string, Map<string, string>>();
  for (const [name, body] of models) {
    const rel = new Map<string, string>();
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
      const mm = /^(\w+)\s+(\w+)(\[\])?\??/.exec(t);
      if (mm && models.has(mm[2])) rel.set(mm[1], mm[2]);
    }
    out.set(name, rel);
  }
  return out;
}

const RELATIONS = relationsOf(readFileSync(SCHEMA, 'utf8'));
const DELEGATES = new Map([...RELATIONS.keys()].map((m) => [m[0].toLowerCase() + m.slice(1), m]));

// ---------------------------------------------------------------------------------------------------------------
// The reader.

interface Source { rel: string; text: string; abs?: string }
interface NestedRead { key: string; site: string; model: string; fields: string[]; decrypted: boolean; namesField: string[] }
interface Census { reads: NestedRead[]; opaque: string[] }

function stripE(e: ts.Expression | undefined): ts.Expression | undefined {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e))) {
    e = e.expression;
  }
  return e;
}

function nameOf(n: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

type Decl = { kind: 'init'; node: ts.Expression; sf: ts.SourceFile } | { kind: 'fn'; node: ts.FunctionLikeDeclaration; sf: ts.SourceFile };

const parsed = new Map<string, ts.SourceFile>();
function parse(abs: string, text?: string): ts.SourceFile {
  let sf = parsed.get(abs);
  if (!sf || text !== undefined) {
    sf = ts.createSourceFile(abs, text ?? readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    if (text === undefined) parsed.set(abs, sf);
  }
  return sf;
}

/** Does the binding (a name or a destructuring pattern) declare `name`? */
function bindsName(b: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(b)) return b.text === name;
  return b.elements.some((el) => !ts.isOmittedExpression(el) && bindsName(el.name, name));
}

/** A name's declaration: `decl` is what the reader can see into (null: a parameter, a pattern, a class, a package import...). */
type Lookup = { decl: Decl | null; binding: ts.Node; scope: ts.Node; isConst: boolean };

/** The declaration of `name` made directly in `scope` (not in a scope nested in it), if any. */
function declaredIn(scope: ts.Node, name: string, depth: number): Lookup | undefined {
  const sf = scope.getSourceFile();
  const opaque = (binding: ts.Node): Lookup => ({ decl: null, binding, scope, isConst: false });
  if (ts.isFunctionLike(scope)) {
    const p = scope.parameters.find((x) => bindsName(x.name, name));
    if (p) return opaque(p);
    if ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name?.text === name) return opaque(scope);
    return undefined;
  }
  if (ts.isCatchClause(scope)) {
    return scope.variableDeclaration && bindsName(scope.variableDeclaration.name, name) ? opaque(scope.variableDeclaration) : undefined;
  }
  if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
    const d = scope.initializer.declarations.find((x) => bindsName(x.name, name));
    return d ? opaque(d) : undefined;
  }
  const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
    ? scope.statements
    : ts.isCaseBlock(scope) ? scope.clauses.flatMap((c) => [...c.statements]) : undefined;
  if (!statements) return undefined;
  for (const st of statements) {
    if (ts.isVariableStatement(st)) {
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!bindsName(d.name, name)) continue;
        if (!ts.isIdentifier(d.name) || !d.initializer) return opaque(d);
        return { decl: { kind: 'init', node: d.initializer, sf }, binding: d, scope, isConst };
      }
    } else if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
      return { decl: st.body ? { kind: 'fn', node: st, sf } : null, binding: st, scope, isConst: true };
    } else if ((ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name && nameOf(st.name as ts.Identifier) === name) {
      return opaque(st);
    } else if (ts.isImportDeclaration(st) && st.importClause) {
      const clause = st.importClause;
      const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.find((el) => el.name.text === name) : undefined;
      const binds = clause.name?.text === name || !!named || (!!clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name);
      if (!binds) continue;
      // A named import from a relative module is read in that module (its top level); a package import is opaque.
      if (!named || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith('.') || depth > 3) return opaque(st);
      const base = resolve(dirname(sf.fileName), st.moduleSpecifier.text.replace(/\.js$/, ''));
      const file = [`${base}.ts`, join(base, 'index.ts')].find((cand) => existsSync(cand));
      const there = file ? declaredIn(parse(file), (named.propertyName ?? named.name).text, depth + 1) : undefined;
      return there ?? opaque(st);
    }
  }
  return undefined;
}

/** The declaration `id` refers to where it is used: the innermost enclosing scope that declares its name. */
function lookup(id: ts.Identifier): Lookup | undefined {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    const hit = declaredIn(scope, id.text, 0);
    if (hit) return hit;
  }
  return undefined;
}

/** The identifier an expression is rooted at (`x`, `x.a`, `x['a'].b`, `(x as any).a`). */
function rootIdent(e: ts.Expression | undefined): ts.Identifier | null {
  let x = stripE(e);
  while (x && (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x))) x = stripE(x.expression);
  return x && ts.isIdentifier(x) ? x : null;
}

/** Is the binding written after its declaration: reassigned (`x = ...`), or a member of it set or removed (`x.k = ...`,
 *  `x[k] ??= ...`, `delete x.k`, `Object.assign(x, ...)`)? Then its initializer is not what a later read sees. */
function writtenAfter(l: Lookup, name: string): boolean {
  let hit = false;
  const isOurs = (e: ts.Expression | undefined) => {
    const r = rootIdent(e);
    return !!r && r.text === name && lookup(r)?.binding === l.binding;
  };
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && isOurs(n.left)) hit = true;
    else if (ts.isDeleteExpression(n) && isOurs(n.expression)) hit = true;
    else if (ts.isCallExpression(n) && /^Object\.(assign|defineProperty|defineProperties)$/.test(stripE(n.expression)?.getText() ?? '') && isOurs(n.arguments[0])) hit = true;
    else ts.forEachChild(n, visit);
  };
  visit(l.scope);
  return hit;
}

/**
 * V71-COR-1: what `id` names where it is used, through its enclosing scopes (innermost first): a local `inc` in one
 * method never resolves to another method's `inc`, and a parameter never resolves to a same-named const elsewhere in
 * the file. null (OPAQUE: the reader cannot see into it) for a parameter, a destructured, loop or catch binding, a
 * class, a package import, a name with no declaration in scope, or a binding written after its declaration.
 */
function resolveIdent(id: ts.Identifier): Decl | null {
  const l = lookup(id);
  if (!l?.decl) return null;
  if (l.decl.kind === 'init' && writtenAfter(l, id.text)) return null;
  return l.decl;
}

function classProperty(sf: ts.SourceFile, from: ts.Node, cls: string | null, prop: string): ts.Expression | null {
  let target: ts.ClassDeclaration | undefined;
  if (cls === null) {
    let p: ts.Node | undefined = from.parent;
    while (p && !ts.isClassDeclaration(p)) p = p.parent;
    target = p as ts.ClassDeclaration | undefined;
  } else {
    const visit = (n: ts.Node): void => {
      if (target) return;
      if (ts.isClassDeclaration(n) && n.name?.text === cls) target = n;
      else ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const m = target?.members.find((x) => ts.isPropertyDeclaration(x) && nameOf(x.name) === prop && x.initializer) as ts.PropertyDeclaration | undefined;
  return m?.initializer ?? null;
}

type Obj = { o: ts.ObjectLiteralExpression; sf: ts.SourceFile };

/** Every object literal the expression may evaluate to, or null when one branch cannot be seen into. */
function resolveObjs(expr: ts.Expression | undefined, sf: ts.SourceFile, depth = 0): Obj[] | null {
  const e = stripE(expr);
  if (!e || depth > 10) return null;
  if (ts.isObjectLiteralExpression(e)) return [{ o: e, sf }];
  if (ts.isConditionalExpression(e)) {
    const a = resolveObjs(e.whenTrue, sf, depth + 1);
    const b = resolveObjs(e.whenFalse, sf, depth + 1);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isCallExpression(e)) {
    const callee = stripE(e.expression);
    if (callee && ts.isCallExpression(callee) && e.arguments.length === 1) return resolveObjs(e.arguments[0], sf, depth + 1); // Prisma.validator<T>()({...})
    if (callee && ts.isIdentifier(callee) && PASS_THROUGH.has(callee.text)) return resolveObjs(e.arguments[0], sf, depth + 1);
    if (callee && ts.isIdentifier(callee)) {
      const d = resolveIdent(callee);
      if (d?.kind === 'fn' && d.node.body) {
        const returns: ts.Expression[] = [];
        const visit = (n: ts.Node): void => {
          if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
          else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
        };
        if (ts.isBlock(d.node.body)) ts.forEachChild(d.node.body, visit);
        else returns.push(d.node.body as ts.Expression);
        const all: Obj[] = [];
        for (const r of returns) {
          const x = resolveObjs(r, d.sf, depth + 1);
          if (!x) return null;
          all.push(...x);
        }
        return all.length ? all : null;
      }
    }
    return null;
  }
  if (ts.isIdentifier(e)) {
    const d = resolveIdent(e);
    return d?.kind === 'init' ? resolveObjs(d.node, d.sf, depth + 1) : null;
  }
  if (ts.isPropertyAccessExpression(e)) {
    if (e.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const init = classProperty(sf, e, null, e.name.text);
      return init ? resolveObjs(init, sf, depth + 1) : null;
    }
    if (ts.isIdentifier(e.expression)) {
      const init = classProperty(sf, e, e.expression.text, e.name.text);
      if (init) return resolveObjs(init, sf, depth + 1);
    }
    // A member of an object literal: `SHAPE.payments.select`.
    const parents = resolveObjs(e.expression, sf, depth + 1);
    if (!parents) return null;
    const all: Obj[] = [];
    for (const parent of parents) {
      const props = propsOf(parent.o, parent.sf);
      const member = props?.find((q) => nameOf((q.p as ts.PropertyAssignment).name) === e.name.text);
      const value = member ? resolveObjs(propValue(member.p), member.sf, depth + 1) : null;
      if (!value) return null;
      all.push(...value);
    }
    return all.length ? all : null;
  }
  return null;
}

type Prop = { p: ts.ObjectLiteralElementLike; sf: ts.SourceFile };

/** The properties of an object literal with spreads expanded; null when a spread cannot be seen into. */
function propsOf(o: ts.ObjectLiteralExpression, sf: ts.SourceFile, depth = 0): Prop[] | null {
  const out: Prop[] = [];
  for (const p of o.properties) {
    if (ts.isSpreadAssignment(p)) {
      // `...(cond && { k: v })` contributes `{ k: v }` or nothing.
      let inner = stripE(p.expression);
      if (inner && ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) inner = stripE(inner.right);
      const r = resolveObjs(inner, sf);
      if (!r || depth > 6) return null;
      for (const x of r) {
        const q = propsOf(x.o, x.sf, depth + 1);
        if (!q) return null;
        out.push(...q);
      }
      continue;
    }
    out.push({ p, sf });
  }
  return out;
}

function propValue(p: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(p)) return p.initializer;
  if (ts.isShorthandPropertyAssignment(p)) return p.name;
  return undefined;
}

function enclosingFunction(n: ts.Node): { name: string; node: ts.Node | null } {
  const names: string[] = [];
  let fn: ts.Node | null = null;
  let p: ts.Node | undefined = n.parent;
  while (p) {
    if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isConstructorDeclaration(p)) && !fn) fn = p;
    if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) names.unshift(p.name.getText());
    if (ts.isConstructorDeclaration(p)) names.unshift('constructor');
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer)) && !fn) {
      fn = p.initializer;
      names.unshift(p.name.text);
    }
    if (ts.isClassDeclaration(p)) {
      names.unshift(p.name?.text ?? '<class>');
      break;
    }
    p = p.parent;
  }
  return { name: names.join('.') || '<module>', node: fn };
}

/** Does `node` call decryptNestedRecord('<model>', ...)? */
function callsDecrypt(node: ts.Node, model: string): boolean {
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const c = stripE(n.expression);
      const name = c && ts.isIdentifier(c) ? c.text : c && ts.isPropertyAccessExpression(c) ? c.name.text : null;
      const first = n.arguments[0];
      if (name === DECRYPT_FN && first && ts.isStringLiteral(first) && first.text === model) {
        hit = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return hit;
}

/** Same-file functions (declarations, const arrows, class methods) whose body decrypts `model`. */
function decryptingHelpers(sf: ts.SourceFile, model: string): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && n.body && callsDecrypt(n.body, model)) out.add(n.name.getText());
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && callsDecrypt(n.initializer, model)) out.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function decrypts(fn: ts.Node | null, sf: ts.SourceFile, model: string): boolean {
  if (!fn) return false;
  if (callsDecrypt(fn, model)) return true;
  const helpers = decryptingHelpers(sf, model);
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const c = stripE(n.expression);
      const name = c && ts.isIdentifier(c) ? c.text : c && ts.isPropertyAccessExpression(c) && c.expression.kind === ts.SyntaxKind.ThisKeyword ? c.name.text : null;
      if (name && helpers.has(name)) {
        hit = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return hit;
}

/** The model's encrypted field names the function mentions (`.f`, `['f']`, `{ f }` destructuring). */
function fieldsNamed(fn: ts.Node | null, fields: readonly string[]): string[] {
  if (!fn) return [];
  const named = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && fields.includes(n.name.text)) named.add(n.name.text);
    if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && fields.includes(n.argumentExpression.text)) named.add(n.argumentExpression.text);
    if (ts.isBindingElement(n)) {
      const key = nameOf(n.propertyName ?? (ts.isIdentifier(n.name) ? n.name : undefined));
      if (key && fields.includes(key)) named.add(key);
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return [...named];
}

const DYNAMIC = '<dynamic>';

/**
 * The model delegate a call's receiver is: `db.channelDestination`, `db['channelDestination']`, or a local const alias of
 * one (`const d = tx.channelDestination; d.findMany(...)`); DYNAMIC when the model is computed at run time
 * (`(db as any)[name]`, or an alias of that, as KEY's safeQuery does); null when the receiver is not a delegate. A
 * receiver on `this` is a Nest service named like a model, not a delegate.
 */
function delegateOf(recv: ts.Expression, depth = 0): string | null {
  const r = stripE(recv);
  if (!r) return null;
  if (ts.isPropertyAccessExpression(r)) {
    return r.expression.kind !== ts.SyntaxKind.ThisKeyword && DELEGATES.has(r.name.text) ? r.name.text : null;
  }
  if (ts.isElementAccessExpression(r)) {
    if (r.expression.kind === ts.SyntaxKind.ThisKeyword) return null;
    const key = stripE(r.argumentExpression);
    if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) return DELEGATES.has(key.text) ? key.text : null;
    return DYNAMIC;
  }
  if (ts.isIdentifier(r) && depth < 3) {
    const l = lookup(r);
    return l?.decl?.kind === 'init' ? delegateOf(l.decl.node, depth + 1) : null;
  }
  return null;
}

function scan(sources: Source[], fieldMap: FieldMap): Census {
  const reads: NestedRead[] = [];
  const opaque: string[] = [];
  for (const src of sources) {
    const sf = parse(src.abs ?? join(REPO, src.rel), src.text);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && OPS.has(n.expression.name.text)) {
        const delegate = delegateOf(n.expression.expression);
        if (delegate === DYNAMIC) {
          // SEC-DTD-2: the model is chosen at run time, so neither the model nor its relations can be read.
          opaque.push(`${src.rel}#${enclosingFunction(n).name} <dynamic>.${n.expression.name.text} <delegate>`);
        }
        const model = delegate && delegate !== DYNAMIC ? DELEGATES.get(delegate) : undefined;
        if (model && delegate) {
          const fn = enclosingFunction(n);
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          const head = `${src.rel}#${fn.name} ${delegate}.${n.expression.name.text}`;
          const args = n.arguments[0];
          const objs = args ? resolveObjs(args, sf) : [];
          if (args && !objs) opaque.push(`${head} <args>`);

          const hit = (target: string, path: string, fields: string[]) => {
            reads.push({
              key: `${head} ${path}`,
              site: `${src.rel}:${line}`,
              model: target,
              fields,
              decrypted: decrypts(fn.node, sf, target),
              namesField: fieldsNamed(fn.node, fieldMap[target] ?? []),
            });
          };

          const walk = (m: string, o: ts.ObjectLiteralExpression, osf: ts.SourceFile, path: string): void => {
            const props = propsOf(o, osf);
            if (!props) {
              opaque.push(`${head} ${path || '<root>'} <spread>`);
              return;
            }
            for (const { p, sf: psf } of props) {
              const key = nameOf((p as ts.PropertyAssignment).name);
              const target = key ? RELATIONS.get(m)?.get(key) : undefined;
              if (!key || !target) continue;
              const here = path ? `${path}.${key}` : key;
              const value = stripE(propValue(p));
              const encrypted = fieldMap[target];
              if (!value || value.kind === ts.SyntaxKind.FalseKeyword) continue;
              if (value.kind === ts.SyntaxKind.TrueKeyword) {
                if (encrypted) hit(target, here, [...encrypted]);
                continue;
              }
              const vos = resolveObjs(value, psf);
              if (!vos) {
                opaque.push(`${head} ${here}`);
                continue;
              }
              for (const { o: vo, sf: vsf } of vos) {
                const vprops = propsOf(vo, vsf);
                if (!vprops) {
                  opaque.push(`${head} ${here} <spread>`);
                  continue;
                }
                const sel = vprops.find((q) => nameOf((q.p as ts.PropertyAssignment).name) === 'select');
                const inc = vprops.find((q) => nameOf((q.p as ts.PropertyAssignment).name) === 'include');
                if (sel) {
                  const sos = resolveObjs(propValue(sel.p), sel.sf);
                  if (!sos) {
                    opaque.push(`${head} ${here} <select>`);
                    continue;
                  }
                  for (const { o: so, sf: ssf } of sos) {
                    const sprops = propsOf(so, ssf);
                    if (!sprops) {
                      opaque.push(`${head} ${here} <spread>`);
                      continue;
                    }
                    if (encrypted) {
                      const got = sprops
                        .filter((q) => encrypted.includes(nameOf((q.p as ts.PropertyAssignment).name) ?? '') && stripE(propValue(q.p))?.kind !== ts.SyntaxKind.FalseKeyword)
                        .map((q) => nameOf((q.p as ts.PropertyAssignment).name) as string);
                      if (got.length) hit(target, here, got);
                    }
                    walk(target, so, ssf, here);
                  }
                } else {
                  if (encrypted) hit(target, here, [...encrypted]);
                  if (inc) {
                    const ios = resolveObjs(propValue(inc.p), inc.sf);
                    if (!ios) opaque.push(`${head} ${here} <include>`);
                    else for (const x of ios) walk(target, x.o, x.sf, here);
                  }
                }
              }
            }
          };

          for (const { o, sf: osf } of objs ?? []) {
            const props = propsOf(o, osf);
            if (!props) {
              opaque.push(`${head} <args spread>`);
              continue;
            }
            for (const k of ['include', 'select']) {
              const p = props.find((q) => nameOf((q.p as ts.PropertyAssignment).name) === k);
              if (!p) continue;
              const os = resolveObjs(propValue(p.p), p.sf);
              if (!os) opaque.push(`${head} <${k}>`);
              else for (const x of os) walk(model, x.o, x.sf, '');
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { reads, opaque };
}

function sourceFiles(): Source[] {
  const out: Source[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        out.push({ rel: relative(REPO, p).split(sep).join('/'), text: readFileSync(p, 'utf8'), abs: p });
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(root);
  return out;
}

interface Verdict { undecided: string[]; staleNeverUsed: string[]; neverUsedNamesField: string[]; unreviewedOpaque: string[]; staleOpaque: string[] }

function judge(census: Census, neverUsed: Record<string, string>, opaqueReviewed: Record<string, string>): Verdict {
  const undecided = census.reads.filter((r) => !r.decrypted && !neverUsed[r.key]).map((r) => `${r.key} (${r.site}; ${r.model}: ${r.fields.join(', ')})`);
  const notDecrypted = new Set(census.reads.filter((r) => !r.decrypted).map((r) => r.key));
  const staleNeverUsed = Object.keys(neverUsed).filter((k) => !notDecrypted.has(k));
  const neverUsedNamesField = census.reads.filter((r) => !r.decrypted && neverUsed[r.key] && r.namesField.length).map((r) => `${r.key} names ${r.namesField.join(', ')}`);
  const opaque = new Set(census.opaque);
  return {
    undecided: [...new Set(undecided)],
    staleNeverUsed,
    neverUsedNamesField: [...new Set(neverUsedNamesField)],
    unreviewedOpaque: [...opaque].filter((k) => !opaqueReviewed[k]),
    staleOpaque: Object.keys(opaqueReviewed).filter((k) => !opaque.has(k)),
  };
}

const SOURCES = sourceFiles();
const CENSUS = scan(SOURCES, FIELD_MAP);

describe('nested reads of encrypted columns are decrypted or never used (FU-DELIVERY-TOKEN-DECRYPT, V1-71)', () => {
  it('the reader finds the schema, the sources and the nested reads: this gate is not vacuous', () => {
    expect(DELEGATES.size, 'schema.prisma models').toBeGreaterThan(200);
    expect(SOURCES.length, 'source files scanned').toBeGreaterThan(500);
    expect(Object.keys(FIELD_MAP).length, 'the extension exports its field map (ENCRYPTED_FIELDS)').toBeGreaterThan(0);
    expect(CENSUS.reads.length, 'nested encrypted reads found').toBeGreaterThanOrEqual(Object.keys(NEVER_USED).length + 3);
  });

  it('NR-01: every nested encrypted read is decrypted with decryptNestedRecord or listed in NEVER_USED with its reason', () => {
    expect(
      judge(CENSUS, NEVER_USED, OPAQUE_LISTED).undecided,
      'these read an encrypted column through a nested include/select, where the extension does not decrypt it: ' +
        "call decryptNestedRecord('<Model>', row) from @keyflow/db before the value is used, or add the read to " +
        'NEVER_USED with the reason it never reaches an outbound call or a decision',
    ).toEqual([]);
  });

  it('NR-02: every NEVER_USED entry still names an undecrypted nested read, and its function names none of the encrypted fields', () => {
    const verdict = judge(CENSUS, NEVER_USED, OPAQUE_LISTED);
    expect(verdict.staleNeverUsed, 'no longer an undecrypted nested read: take it off NEVER_USED').toEqual([]);
    expect(verdict.neverUsedNamesField, 'a listed read whose function now names an encrypted field needs the decrypt step').toEqual([]);
  });

  it("NR-03: the delivery queue's reads of the sending account (claimDeliveries, retry, retryAllFailed) are decrypted", () => {
    const file = 'apps/server/src/modules/communications/delivery-queue.service.ts';
    for (const [method, op] of [['claimDeliveries', 'findUnique'], ['retry', 'findFirst'], ['retryAllFailed', 'findMany']] as const) {
      const key = `${file}#DeliveryQueueService.${method} outboundDelivery.${op} destination.connection`;
      const read = CENSUS.reads.find((r) => r.key === key);
      expect(read, `${key} is found`).toBeDefined();
      expect(read?.model).toBe('ChannelConnection');
      expect(read?.decrypted, `${key} decrypts the connection`).toBe(true);
      expect(NEVER_USED[key], `${key} is never on NEVER_USED`).toBeUndefined();
    }
  });

  it('NR-04: every Prisma call whose args the reader cannot see into is reviewed, or recorded as an open issue', () => {
    const verdict = judge(CENSUS, NEVER_USED, OPAQUE_LISTED);
    expect(verdict.unreviewedOpaque, 'add each to OPAQUE_REVIEWED with the reason it reads no encrypted column, or make its args readable').toEqual([]);
    expect(verdict.staleOpaque, 'no longer opaque: take it off OPAQUE_REVIEWED / OPAQUE_OPEN').toEqual([]);
    expect(Object.keys(OPAQUE_REVIEWED).filter((k) => k in OPAQUE_OPEN), 'a call is reviewed or open, not both').toEqual([]);
    expect(Object.entries(OPAQUE_OPEN).filter(([, why]) => !/^OPEN [A-Z][A-Z0-9]*(-[A-Z0-9]+)+: /.test(why)).map(([k]) => k), 'each open entry names its issue').toEqual([]);
    // SEC-DTD-2: a delegate chosen at run time is seen (KEY's safeQuery: `(this.prisma.client as any)[model]`, aliased).
    expect(CENSUS.opaque).toContain('apps/server/src/modules/key-cortex/key-cortex-safe-database.service.ts#KeyCortexSafeDatabaseService.safeQuery <dynamic>.findMany <delegate>');
  });

  it("NR-05: the field map is the extension's own, and decryptNestedRecord decrypts exactly its fields", () => {
    const extension = readFileSync(EXTENSION, 'utf8');
    const queryBlock = extension.slice(extension.indexOf('query: {'));
    const hooked = [...queryBlock.matchAll(/^ {4}(\w+): \{/gm)].map((m) => m[1][0].toUpperCase() + m[1].slice(1)).sort();
    expect(hooked.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(FIELD_MAP).sort(), 'ENCRYPTED_FIELDS names exactly the models the extension hooks').toEqual(hooked);

    const { encryptToken, decryptNestedRecord } = encryption as unknown as {
      encryptToken: (v: string) => string;
      decryptNestedRecord: <T>(model: string, row: T) => T;
    };
    expect(typeof decryptNestedRecord, 'the extension exports decryptNestedRecord').toBe('function');
    for (const [model, fields] of Object.entries(FIELD_MAP)) {
      const row: Record<string, unknown> = { id: `${model}-1`, label: encryptToken('not-a-secret-field') };
      for (const f of fields) row[f] = encryptToken(`${model}.${f}`);
      const out = decryptNestedRecord(model, row) as Record<string, unknown>;
      for (const f of fields) expect(out[f], `${model}.${f}`).toBe(`${model}.${f}`);
      expect(out.label, 'a field outside the map is left as stored').toBe(row.label);
      expect(row[fields[0]], 'the row read is not changed in place').not.toBe(`${model}.${fields[0]}`);
      const many = decryptNestedRecord(model, [row, row]) as Array<Record<string, unknown>>;
      expect(many.map((r) => r[fields[0]])).toEqual([`${model}.${fields[0]}`, `${model}.${fields[0]}`]);
    }
    expect(decryptNestedRecord('ChannelConnection', null)).toBeNull();
    expect(decryptNestedRecord('ChannelConnection', undefined)).toBeUndefined();
    expect(() => decryptNestedRecord('Contact', {}), 'a model outside the map is refused').toThrow();
  });

  // The scanner self-tests (NR-06, NR-06b) read one injected source file with this field map.
  const selfTestFieldMap: FieldMap = {
    ChannelConnection: ['token', 'refreshToken'],
    Business: ['gmailAccessToken', 'driveAccessToken'],
    Webhook: ['secret'],
  };
  const injected = (body: string): Source => ({
    rel: 'apps/server/src/modules/zz-injected/zz.service.ts',
    abs: join(REPO, 'apps/server/src/modules/zz-injected/zz.service.ts'),
    text: `
        import { Prisma } from '@prisma/client';
        import { decryptNestedRecord } from '@keyflow/db';
        const CONN_INCLUDE = { destination: { include: { connection: true } } }; const CONN_ONLY = { connection: true };
        const VALIDATED = Prisma.validator<Prisma.InvoiceInclude>()({ business: { select: { gmailAccessToken: true } } });
        function decryptConnection(d: any) { return { ...d, destination: { ...d.destination, connection: decryptNestedRecord('ChannelConnection', d.destination.connection) } }; }
        export class ZzService {
          private readonly hookSelect = { webhooks: { select: { url: true, secret: true } } };
          ${body}
        }`,
  });
  const census = (body: string) => scan([injected(body)], selfTestFieldMap);
  const keyOf = (c: Census) => c.reads.map((r) => `${r.key}|${r.model}|${r.fields.join(',')}|${r.decrypted ? 'D' : '-'}`);

  it('NR-06: scanner self-test — injected reads are found and judged; a nested read added without the decrypt step fails the census', () => {

    // found: true, { include }, a const, a validator, a narrowed select naming a secret, a class property, `? :`, a spread
    expect(keyOf(census('async a() { return this.prisma.client.outboundDelivery.findUnique({ where: { id: 1 }, include: { destination: { include: { connection: true } } } }); }')))
      .toEqual(['apps/server/src/modules/zz-injected/zz.service.ts#ZzService.a outboundDelivery.findUnique destination.connection|ChannelConnection|token,refreshToken|-']);
    expect(keyOf(census('async b() { return tx.outboundDelivery.findMany({ include: CONN_INCLUDE }); }'))).toHaveLength(1);
    expect(keyOf(census('async c() { return db.invoice.findFirst({ include: VALIDATED }); }')))
      .toEqual(['apps/server/src/modules/zz-injected/zz.service.ts#ZzService.c invoice.findFirst business|Business|gmailAccessToken|-']);
    expect(keyOf(census('async d() { return db.business.findUnique({ where: { id: 1 }, include: this.hookSelect }); }'))).toEqual([
      'apps/server/src/modules/zz-injected/zz.service.ts#ZzService.d business.findUnique webhooks|Webhook|secret|-',
    ]);
    expect(keyOf(census('async e(f: boolean) { return db.channelDestination.findMany({ include: f ? { connection: true } : { connection: { select: { provider: true } } } }); }'))).toHaveLength(1);
    expect(keyOf(census("async g() { return db.channelDestination['findFirst']; }"))).toEqual([]);
    expect(keyOf(census('async h() { return db.channelDestination.findMany({ include: { ...CONN_ONLY } }); }'))).toEqual([
      'apps/server/src/modules/zz-injected/zz.service.ts#ZzService.h channelDestination.findMany connection|ChannelConnection|token,refreshToken|-',
    ]);
    expect(keyOf(census("async i() { return db.channelDestination.findMany({ select: { id: true, connection: { select: { provider: true, token: false } } } }); }"))).toEqual([]);
    expect(keyOf(census('async j() { return db.membership.findFirst(skipTenantIsolation({ where: {}, select: { business: true as const } })); }')))
      .toEqual(['apps/server/src/modules/zz-injected/zz.service.ts#ZzService.j membership.findFirst business|Business|gmailAccessToken,driveAccessToken|-']);
    // not a delegate: a Nest service named like a model
    expect(keyOf(census('async k() { return this.channelDestination.findMany({ include: { connection: true } }); }'))).toEqual([]);
    // opaque
    expect(census('async l(args: any) { return db.outboundDelivery.findMany(args); }').opaque).toEqual([
      'apps/server/src/modules/zz-injected/zz.service.ts#ZzService.l outboundDelivery.findMany <args>',
    ]);

    // decrypted: a direct call, or a same-file helper that decrypts the model
    expect(keyOf(census("async m() { const d = await db.outboundDelivery.findUnique({ include: CONN_INCLUDE }); return decryptNestedRecord('ChannelConnection', d.destination.connection); }"))[0]).toMatch(/\|D$/);
    expect(keyOf(census('async n() { const d = await db.outboundDelivery.findUnique({ include: CONN_INCLUDE }); return decryptConnection(d); }'))[0]).toMatch(/\|D$/);
    // the decrypt step for another model does not count
    expect(keyOf(census("async o() { const d = await db.outboundDelivery.findUnique({ include: CONN_INCLUDE }); return decryptNestedRecord('Business', d); }"))[0]).toMatch(/\|-$/);
    // a function that names an encrypted field is seen
    expect(census('async p() { const d: any = await db.outboundDelivery.findUnique({ include: CONN_INCLUDE }); return d.destination.connection.token; }').reads[0].namesField).toEqual(['token']);

    // The census over the real sources plus one new nested read: it fails, naming the read; with the step it passes.
    const added = census("async addedRead() { const d: any = await db.outboundDelivery.findUnique({ where: { id: 'x' }, include: { destination: { include: { connection: true } } } }); return d.destination.connection.token; }");
    const failing = judge({ reads: [...CENSUS.reads, ...added.reads], opaque: CENSUS.opaque }, NEVER_USED, OPAQUE_LISTED);
    expect(failing.undecided).toEqual([
      'apps/server/src/modules/zz-injected/zz.service.ts#ZzService.addedRead outboundDelivery.findUnique destination.connection (apps/server/src/modules/zz-injected/zz.service.ts:9; ChannelConnection: token, refreshToken)',
    ]);
    const fixed = census("async addedRead() { const d: any = await db.outboundDelivery.findUnique({ where: { id: 'x' }, include: { destination: { include: { connection: true } } } }); const c = decryptNestedRecord('ChannelConnection', d.destination.connection); return c.token; }");
    expect(judge({ reads: [...CENSUS.reads, ...fixed.reads], opaque: CENSUS.opaque }, NEVER_USED, OPAQUE_LISTED).undecided).toEqual([]);
  });

  it('NR-06b: scanner self-test (review repair V71-COR-1, SEC-DTD-2) — names resolve in their own scope, delegate aliases are read, run-time delegates are opaque', () => {
    // V71-COR-1: a name is resolved in the scope it is used in, never to the first same-named declaration in the file.
    const z = 'apps/server/src/modules/zz-injected/zz.service.ts#ZzService';
    expect.soft(keyOf(census([
      'async q1(businessId: string) { const inc = { destinations: true }; return db.channelConnection.findMany({ where: { businessId }, include: inc }); }',
      'async q2(businessId: string) { const inc = { connection: true }; const rows = await db.channelDestination.findMany({ where: { businessId }, include: inc }); return rows.map((r: any) => r.connection.token); }',
    ].join('\n')))).toEqual([`${z}.q2 channelDestination.findMany connection|ChannelConnection|token,refreshToken|-`]);
    expect.soft(keyOf(census('async q3() { const inc = { connection: { select: { provider: true } } }; { const inc = { connection: true }; return db.channelDestination.findMany({ include: inc }); } }')))
      .toEqual([`${z}.q3 channelDestination.findMany connection|ChannelConnection|token,refreshToken|-`]);
    // a parameter (here shadowing the file's CONN_ONLY), a destructured or loop binding, or a binding written after
    // its declaration is opaque, never its initializer or a same-named const
    expect.soft(census('async q4(CONN_ONLY: any) { return db.channelDestination.findMany({ include: CONN_ONLY }); }').opaque).toEqual([`${z}.q4 channelDestination.findMany <include>`]);
    expect.soft(census('async q5(o: any) { const { inc } = o; return db.channelDestination.findMany({ include: inc }); }').opaque).toEqual([`${z}.q5 channelDestination.findMany <include>`]);
    expect.soft(census('async q6(f: boolean) { let inc: any = { connection: { select: { provider: true } } }; if (f) inc = { connection: true }; return db.channelDestination.findMany({ include: inc }); }').opaque)
      .toEqual([`${z}.q6 channelDestination.findMany <include>`]);
    expect.soft(census('async q7() { const inc: any = { connection: { select: { provider: true } } }; inc.connection = true; return db.channelDestination.findMany({ include: inc }); }').opaque)
      .toEqual([`${z}.q7 channelDestination.findMany <include>`]);
    expect.soft(census('async q8() { const inc: any = { connection: { select: { provider: true } } }; Object.assign(inc, CONN_ONLY); return db.channelDestination.findMany({ include: inc }); }').opaque)
      .toEqual([`${z}.q8 channelDestination.findMany <include>`]);
    // ...while a same-named binding written in another scope leaves this one readable
    expect.soft(keyOf(census('async q9() { const inc = { connection: true }; const other = () => { const inc: any = {}; inc.x = 1; return inc; }; other(); return db.channelDestination.findMany({ include: inc }); }')))
      .toEqual([`${z}.q9 channelDestination.findMany connection|ChannelConnection|token,refreshToken|-`]);
    // SEC-DTD-2: a delegate reached through a const alias is read as that delegate; one chosen at run time is opaque
    expect.soft(keyOf(census('async q10() { const d = db.channelDestination; return d.findMany({ include: { connection: true } }); }')))
      .toEqual([`${z}.q10 channelDestination.findMany connection|ChannelConnection|token,refreshToken|-`]);
    expect.soft(census("async q11(model: string, fields: string[]) { const delegate = (db as any)[model]; return delegate.findMany({ select: Object.fromEntries(fields.map((f) => [f, true])) }); }").opaque)
      .toEqual([`${z}.q11 <dynamic>.findMany <delegate>`]);
    expect.soft(census('async q12(model: string) { return (db as any)[model].update({ where: { id: 1 }, data: {} }); }').opaque).toEqual([`${z}.q12 <dynamic>.update <delegate>`]);
    expect.soft(census('async q13(model: string) { return this[model].findMany({}); }').opaque, 'a receiver on `this` is not a delegate').toEqual([]);
  });

  it('[V72S-N1] RR-BANK-TOKEN-ENCRYPT (V1-72): BankConnection.accessToken is in the field map, and no nested read of it exists', () => {
    // The census of nested reads of BankConnection, stated: at the packet's base there is none (no include or select
    // of bankConnections / a BankConnection relation carries accessToken; BankConnectionService reads it top-level
    // only, where the extension decrypts, and strips it before every response). A new one fails NR-01 here.
    expect(FIELD_MAP.BankConnection, 'ENCRYPTED_FIELDS.BankConnection').toEqual(['accessToken']);
    expect(CENSUS.reads.filter((r) => r.model === 'BankConnection').map((r) => r.key)).toEqual([]);
    // Not vacuous: with the real field map, a nested read of it through either relation is found and judged.
    const real = (body: string) => scan([injected(body)], FIELD_MAP);
    expect(keyOf(real('async b1() { return db.financialAccount.findMany({ include: { bankConnections: true } }); }'))).toEqual([
      'apps/server/src/modules/zz-injected/zz.service.ts#ZzService.b1 financialAccount.findMany bankConnections|BankConnection|accessToken|-',
    ]);
    expect(keyOf(real('async b2() { return db.business.findUnique({ where: { id: 1 }, select: { bankConnections: { select: { accessToken: true } } } }); }'))).toEqual([
      'apps/server/src/modules/zz-injected/zz.service.ts#ZzService.b2 business.findUnique bankConnections|BankConnection|accessToken|-',
    ]);
    expect(keyOf(real('async b3() { return db.business.findUnique({ where: { id: 1 }, select: { bankConnections: { select: { id: true, provider: true } } } }); }'))).toEqual([]);
  });
});

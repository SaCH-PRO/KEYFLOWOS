/**
 * R0-09f-D11-FINANCE-TAX-AND-WEB — owner ruling D-11 (2026-10-31: editing the
 * business profile is OWNER only, regardless of granted scopes) has a static
 * guard, so a new writer of an owner-only Business field cannot appear
 * silently.
 *
 * WHY: R0-09 closed PATCH /identity/businesses/:id. R0-09b, then R0-09d, each
 * found one more route writing the same fields with only AuthGuard and
 * BusinessGuard (presence publish, concierge auto-configure and chat intake,
 * genesis answers, template apply), and R0-09d's grep found a fourth
 * (PATCH /finance/businesses/:id/settings writing Business.defaultTaxRate).
 * Each sweep was a person reading code. This file is the sweep, run on every
 * test run.
 *
 * OWNER-ONLY FIELDS: every property of UpdateBusinessDto (the fields the
 * owner-only PATCH writes; read from the DTO source, so a new DTO field joins
 * the list by itself) except metaData, plus archetype, onboardingComplete and
 * onboardingCompletedAt (the completion flag left the DTO in R0-09 and is
 * written by the owner-only completion path). Business.metaData is not
 * owner-only as a bag (R0-09b review CR-2: gamification, SEO, storefront and
 * concierge display state live there and stay open to their routes); its
 * owner-only keys are the setup configuration auto-configure writes
 * (OWNER_ONLY_META_KEYS).
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src):
 *   - every `<x>.business.update|updateMany|upsert(...)` call, and the keys of
 *     its `data` (for upsert: `update` and `create`). An object literal is read
 *     key by key, conditional spreads included; an identifier is resolved
 *     inside the enclosing function (its initializer and every `name.key =` /
 *     `name['key'] =` assignment). A computed key, a parameter or any other
 *     expression the reader cannot see into is OPAQUE: the writer must be in
 *     the allow-list with a reason.
 *   - inside `metaData`, literal keys only (object literals, resolved
 *     initializers and assignments); a spread of an identifier is taken to copy
 *     the stored metaData (the pattern of every metaData writer today) and a
 *     computed metaData key is not read.
 *   - the call graph through `this.method(...)` and `this.<injected>.method(...)`
 *     where the injected property's declared type is a class in apps/server/src.
 *
 * WHAT IS REQUIRED:
 *   W02 every writer of an owner-only field, and every opaque writer, is in
 *       OWNER_WRITES with exactly the owner-only fields it writes; every entry
 *       still matches a writer.
 *   W03 an entry of kind 'owner' is reached only through one of its named owner
 *       checks: walking up the resolved callers from the write, every path meets
 *       a call to one of `guards` before the call it guards (in the same
 *       function, and in the same `case` clause when the call sits in one). A
 *       root (a route handler, a listener, a dispatcher entry point) reached
 *       without one is an unguarded path.
 *   W04 every named owner check implements the owner rule — the OWNER
 *       membership, Business.ownerId and the SUPER_ADMIN bypass appear in its
 *       body — or calls an owner check that does.
 *   W05 an entry of kind 'open' (a writer known to be unguarded and tracked by
 *       an it.todo, outside this packet's write set) is still unguarded: when it
 *       is fixed this fails, and the fix moves it to kind 'owner'.
 *   W06 a file that resolves a writer's class through moduleRef calls none of
 *       the writer's unguarded chain methods (calls the call graph cannot see).
 *
 * WHAT THIS CANNOT DO, stated plainly: it proves a named owner check is called
 * before every write on every path it can resolve, not that the check's result
 * is enforced (`await this.isOwner(); write()` would pass), and it cannot see a
 * call made through an untyped receiver or a dynamic dispatch other than
 * moduleRef. The enforcement is proven on a real database by
 * test/identity-business-config, d11-sibling-writes, d11-genesis-templates,
 * d11-finance-settings and onboarding-manual-complete. This file is what makes
 * a NEW writer visible.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');
const DTO_FILE = join(SRC, 'modules/identity/dto/update-business.dto.ts');

/** Owner-only Business columns that are not (or no longer) UpdateBusinessDto properties. */
const EXTRA_OWNER_COLUMNS = ['archetype', 'onboardingComplete', 'onboardingCompletedAt'];
/** UpdateBusinessDto properties that are not owner-only as a whole (R0-09b review CR-2). */
const NOT_OWNER_ONLY_AS_A_BAG = ['metaData'];
/** The setup configuration auto-configure keeps in Business.metaData (R0-09b, case D11-C02). */
const OWNER_ONLY_META_KEYS = ['conciergeTemplateId', 'conciergeSetupAt', 'paymentMethodsConfigured', 'paymentRecommendations', 'setupMilestones'];
/** The marker the reader writes for data it cannot see into. */
const OPAQUE = '<opaque>';

type OwnerEntry = { kind: 'owner'; writes: string[]; guards: string[]; why: string };
type OpenEntry = { kind: 'open'; writes: string[]; why: string };
type NotProfileEntry = { kind: 'not-profile'; writes: string[]; why: string };
type Entry = OwnerEntry | OpenEntry | NotProfileEntry;

/**
 * Every Business writer that writes an owner-only field, or that the reader
 * cannot see into. Keyed `<file under src>#<Class>.<method>`. `writes` is the
 * sorted list of owner-only columns, `metaData.<key>` for owner-only metaData
 * keys, and '<opaque>' when some of the data cannot be read.
 */
const OWNER_WRITES: Record<string, Entry> = {
  'modules/identity/identity.service.ts#IdentityService.updateBusiness': {
    kind: 'owner',
    writes: [OPAQUE, 'acceptingWork', 'budgetFit', 'currentCapacity', 'interests', 'lastHealthCheck', 'leadTime', 'positioningStatement', 'preferredProjectTypes', 'skills'],
    guards: ['assertBusinessOwner', 'assertProfileOwner'],
    why: 'The owner-only profile PATCH (R0-09): the rest of UpdateBusinessDto is copied by key (opaque). PATCH /identity/businesses/:id runs IdentityService.assertBusinessOwner; the KEY settings adapter runs assertProfileOwner (R0-09c).',
  },
  'modules/site/presence/presence.service.ts#PresenceService.publish': {
    kind: 'owner',
    writes: ['slug'],
    guards: ['isSlugOwner'],
    why: 'R0-09b: a publish moves Business.slug only when isSlugOwner admits the actor; a non-owner publishes at the current slug.',
  },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.autoConfigureFromTemplate': {
    kind: 'owner',
    writes: ['businessHours', 'metaData.conciergeSetupAt', 'metaData.conciergeTemplateId', 'metaData.paymentMethodsConfigured', 'metaData.paymentRecommendations', 'name', 'slug', 'storeEnabled'],
    guards: ['assertProfileOwner'],
    why: 'R0-09b: POST .../auto-configure is owner-only as a whole (the controller runs assertProfileOwner first).',
  },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.persistIntakeAnswers': {
    kind: 'owner',
    writes: ['archetype', 'businessIntent', 'country', 'industry'],
    guards: ['isProfileOwner'],
    why: "R0-09b review SEC-2: the concierge chat answers any member, but only the owner's answers are persisted (generateConciergeResponse checks isProfileOwner first).",
  },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.markOnboardingComplete': {
    kind: 'owner',
    writes: ['onboardingComplete', 'onboardingCompletedAt'],
    guards: ['resolveCompletionActor'],
    why: 'R0-SEC-03: completion is the owner-only system path for the flag R0-09 took out of the PATCH; resolveCompletionActor admits the owner or SUPER_ADMIN before the claim.',
  },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.awardSetupMilestone': {
    kind: 'owner',
    writes: ['metaData.setupMilestones'],
    guards: ['assertProfileOwner', 'resolveCompletionActor'],
    why: 'Setup milestones are awarded by auto-configure (assertProfileOwner) and completion (resolveCompletionActor) only.',
  },
  'modules/business-genesis/business-genesis.service.ts#BusinessGenesisService.submitAnswers': {
    kind: 'owner',
    writes: [OPAQUE],
    guards: ['assertProfileAnswersOwner'],
    why: 'R0-09d: the answers copied onto name, currency, country and businessIntent (GENESIS_BUSINESS_ANSWER_COLUMNS, by key: opaque); the controller runs assertProfileAnswersOwner first.',
  },
  'modules/templates/templates.service.ts#TemplatesService.applyTemplate': {
    kind: 'owner',
    writes: ['archetype', 'industry'],
    guards: ['assertProfileOwner'],
    why: 'R0-09d: template apply is owner-only as a whole (the controller runs assertProfileOwner first).',
  },
  'modules/finance/finance-settings.service.ts#FinanceSettingsService.update': {
    kind: 'owner',
    writes: ['defaultTaxRate'],
    guards: ['assertTaxRateOwner'],
    why: "R0-09f: PATCH /finance/businesses/:id/settings writes Business.defaultTaxRate; FinanceController.patchSettings runs FinanceSettingsService.assertTaxRateOwner first. The route's other settings (basis, fiscal year, default accounts, accountant email) are not owner-only.",
  },
  'modules/commerce/commerce.controller.ts#CommerceController.setDocumentTemplate': {
    kind: 'open',
    writes: ['invoiceTemplate', 'quoteTemplate'],
    why: 'Found by this sweep (R0-09f): PATCH /commerce/businesses/:id/document-templates writes Business.invoiceTemplate and quoteTemplate (UpdateBusinessDto fields) behind revenue:write, not the owner rule. commerce/** belongs to another running packet; tracked by the it.todo in identity-boundary.integration.test.ts, "OPEN DEFECTS — D-11 sibling write paths".',
  },
  'core/connectors/google-suite.service.ts#GoogleSuiteService.handleCallback': {
    kind: 'not-profile',
    writes: [OPAQUE],
    why: 'OAuth callback: googleSuiteEmail and the per-service token columns named by fieldsForService (computed keys).',
  },
  'modules/connect/google-token.helper.ts#GoogleTokenHelper.getValidAccessToken': {
    kind: 'not-profile',
    writes: [OPAQUE],
    why: "Token refresh: the access-token and expiry columns named by the caller's TokenFields (computed keys).",
  },
};

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !/\.(spec|test)\.ts$/.test(e.name) ? [p] : [];
  });
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');

interface Fn { key: string; file: string; className?: string; name: string; node: ts.Node; text: string }
interface WriteSite { fn: string; line: number; call: ts.CallExpression; keys: string[] }
interface Edge { from: string; to: string; call: ts.CallExpression }

function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  for (;;) {
    if (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
    else if (ts.isSatisfiesExpression?.(x)) x = x.expression;
    else return x;
  }
}

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)
    || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}

/** The function-like ancestors of a node, innermost first. */
function scopesOf(node: ts.Node): ts.FunctionLikeDeclaration[] {
  const out: ts.FunctionLikeDeclaration[] = [];
  for (let p = node.parent; p; p = p.parent) if (isFunctionLike(p)) out.push(p);
  return out;
}

function forEachDeep(node: ts.Node, cb: (n: ts.Node) => void) {
  const visit = (n: ts.Node) => { cb(n); ts.forEachChild(n, visit); };
  ts.forEachChild(node, visit);
}

/** Collects the Business keys a `data` expression writes (columns, `metaData.<key>`, OPAQUE). */
function dataKeys(expr: ts.Expression, scopes: ts.FunctionLikeDeclaration[]): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();

  const resolveIdentifier = (name: string, onValue: (v: ts.Expression) => void, onKey: (k: string, v: ts.Expression) => void, onOpaque: () => void) => {
    if (name === 'undefined') return;
    if (seen.has(name)) return;
    seen.add(name);
    let found = false;
    for (const scope of scopes) {
      if (scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) { onOpaque(); return; }
      if (!scope.body) continue;
      forEachDeep(scope.body, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
          found = true;
          if (n.initializer) onValue(n.initializer);
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const left = n.left;
          if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === name) {
            found = true;
            onKey(left.name.text, n.right);
          } else if (ts.isElementAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === name) {
            found = true;
            const arg = left.argumentExpression;
            if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) onKey(arg.text, n.right);
            else onOpaque();
          }
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'assign'
          && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Object'
          && n.arguments[0] && ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === name) {
          found = true;
          for (const a of n.arguments.slice(1)) onValue(a);
        }
      });
      if (found) return;
    }
    if (!found) onOpaque();
  };

  const meta = (e: ts.Expression) => {
    const x = unwrap(e);
    if (ts.isObjectLiteralExpression(x)) {
      for (const p of x.properties) {
        if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
          const k = propName(p.name);
          if (k) out.add(`metaData.${k}`);
        } else if (ts.isSpreadAssignment(p)) {
          const s = unwrap(p.expression);
          if (!ts.isIdentifier(s)) meta(s); // an identifier spread copies the stored metaData
        }
      }
    } else if (ts.isConditionalExpression(x)) { meta(x.whenTrue); meta(x.whenFalse); }
    else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) meta(x.right);
    else if (ts.isIdentifier(x)) {
      resolveIdentifier(x.text, (v) => {
        const u = unwrap(v);
        if (ts.isObjectLiteralExpression(u)) meta(u);
      }, (k) => out.add(`metaData.${k}`), () => { /* not read: see the header */ });
    }
  };

  const columns = (e: ts.Expression) => {
    const x = unwrap(e);
    if (ts.isObjectLiteralExpression(x)) {
      for (const p of x.properties) {
        if (ts.isPropertyAssignment(p)) {
          const k = propName(p.name);
          if (!k) { out.add(OPAQUE); continue; }
          out.add(k);
          if (k === 'metaData') meta(p.initializer);
        } else if (ts.isShorthandPropertyAssignment(p)) {
          out.add(p.name.text);
          if (p.name.text === 'metaData') meta(p.name);
        } else if (ts.isSpreadAssignment(p)) {
          columns(p.expression);
        }
      }
    } else if (ts.isConditionalExpression(x)) { columns(x.whenTrue); columns(x.whenFalse); }
    else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) columns(x.right);
    else if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.BarBarToken || x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      columns(x.left); columns(x.right);
    } else if (ts.isIdentifier(x)) {
      resolveIdentifier(x.text, (v) => columns(v), (k, v) => { out.add(k); if (k === 'metaData') meta(v); }, () => out.add(OPAQUE));
    } else {
      out.add(OPAQUE);
    }
  };

  columns(expr);
  return out;
}

function typeName(t: ts.TypeNode | undefined): string | undefined {
  if (t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) return t.typeName.text;
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function analyse() {
  const files = walk(SRC);
  const fns = new Map<string, Fn>();
  const classFile = new Map<string, string>();
  const propTypes = new Map<string, Map<string, string>>();
  const writes: WriteSite[] = [];
  const rawEdges: Array<{ from: string; className: string; prop?: string; method: string; call: ts.CallExpression }> = [];
  const fileText = new Map<string, string>();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const r = rel(file);
    fileText.set(r, text);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const register = (key: string, name: string, node: ts.Node, className?: string) => {
      fns.set(key, { key, file: r, className, name, node, text: node.getText(sf) });
    };

    const visitTop = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const cls = node.name.text;
        if (!classFile.has(cls)) classFile.set(cls, r);
        const types = new Map<string, string>();
        for (const m of node.members) {
          if (ts.isConstructorDeclaration(m)) {
            for (const p of m.parameters) {
              if (ts.isIdentifier(p.name) && (ts.getModifiers(p) ?? []).length > 0) {
                const t = typeName(p.type);
                if (t) types.set(p.name.text, t);
              }
            }
          } else if (ts.isPropertyDeclaration(m) && m.name && ts.isIdentifier(m.name)) {
            const t = typeName(m.type);
            if (t) types.set(m.name.text, t);
            if (m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
              register(`${r}#${cls}.${m.name.text}`, m.name.text, m.initializer, cls);
            }
          } else if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) && m.body && m.name) {
            const n = propName(m.name);
            if (n) register(`${r}#${cls}.${n}`, n, m, cls);
          }
        }
        propTypes.set(cls, types);
      } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        register(`${r}#${node.name.text}`, node.name.text, node);
      } else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            register(`${r}#${d.name.text}`, d.name.text, d.initializer);
          }
        }
      }
      ts.forEachChild(node, visitTop);
    };
    visitTop(sf);
  }

  /** The registered function a node belongs to (the innermost one). */
  const ownerOf = new Map<ts.Node, string>();
  for (const fn of fns.values()) ownerOf.set(fn.node, fn.key);
  const enclosing = (n: ts.Node): string | undefined => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      const k = ownerOf.get(p);
      if (k) return k;
    }
    return undefined;
  };

  for (const fn of fns.values()) {
    forEachDeep(fn.node, (n) => {
      if (!ts.isCallExpression(n) || enclosing(n) !== fn.key) return;
      const e = n.expression;
      if (!ts.isPropertyAccessExpression(e)) return;
      const method = e.name.text;
      // Business writes.
      if (['update', 'updateMany', 'upsert'].includes(method)) {
        const target = e.expression;
        const last = ts.isPropertyAccessExpression(target) ? target.name.text : ts.isIdentifier(target) ? target.text : undefined;
        if (last === 'business') {
          const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined;
          const keys = new Set<string>();
          if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const p of arg.properties) {
              if (ts.isPropertyAssignment(p) && ['data', 'update', 'create'].includes(propName(p.name) ?? '')) {
                for (const k of dataKeys(p.initializer, scopesOf(n))) keys.add(k);
              } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'data') {
                for (const k of dataKeys(p.name, scopesOf(n))) keys.add(k);
              }
            }
          } else {
            keys.add(OPAQUE);
          }
          const sf = n.getSourceFile();
          writes.push({ fn: fn.key, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, call: n, keys: [...keys] });
        }
      }
      // Call edges: this.m(...) and this.<prop>.m(...).
      if (fn.className) {
        if (e.expression.kind === ts.SyntaxKind.ThisKeyword) {
          rawEdges.push({ from: fn.key, className: fn.className, method, call: n });
        } else if (ts.isPropertyAccessExpression(e.expression) && e.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
          rawEdges.push({ from: fn.key, className: fn.className, prop: e.expression.name.text, method, call: n });
        }
      }
    });
  }

  const edges: Edge[] = [];
  for (const raw of rawEdges) {
    const cls = raw.prop ? propTypes.get(raw.className)?.get(raw.prop) : raw.className;
    if (!cls) continue;
    const file = classFile.get(cls);
    if (!file) continue;
    const to = `${file}#${cls}.${raw.method}`;
    if (fns.has(to)) edges.push({ from: raw.from, to, call: raw.call });
  }

  return { files, fns, writes, edges, fileText };
}

function ownerOnlyColumns(): string[] {
  const text = readFileSync(DTO_FILE, 'utf8');
  const sf = ts.createSourceFile(DTO_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fields: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isClassDeclaration(n) && n.name?.text === 'UpdateBusinessDto') {
      for (const m of n.members) if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name)) fields.push(m.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...fields.filter((f) => !NOT_OWNER_ONLY_AS_A_BAG.includes(f)), ...EXTRA_OWNER_COLUMNS];
}

const A = analyse();
const OWNER_COLUMNS = new Set(ownerOnlyColumns());
const OWNER_META = new Set(OWNER_ONLY_META_KEYS.map((k) => `metaData.${k}`));

/** The owner-only fields (and OPAQUE) each writer function writes. */
function ownerWritesByFn(): Map<string, string[]> {
  const by = new Map<string, Set<string>>();
  for (const w of A.writes) {
    const owned = w.keys.filter((k) => k === OPAQUE || OWNER_COLUMNS.has(k) || OWNER_META.has(k));
    if (owned.length === 0) continue;
    const s = by.get(w.fn) ?? new Set<string>();
    for (const k of owned) s.add(k);
    by.set(w.fn, s);
  }
  return new Map([...by].map(([k, v]) => [k, [...v].sort()]));
}

function caseClauseOf(n: ts.Node, stop: ts.Node): ts.Node | undefined {
  for (let p = n.parent; p && p !== stop; p = p.parent) if (ts.isCaseClause(p) || ts.isDefaultClause(p)) return p;
  return undefined;
}

/** Whether `call`, inside function `fnKey`, is preceded by a call to one of `guards` (same case clause, if any). */
function guardedAt(fnKey: string, call: ts.CallExpression, guards: string[]): boolean {
  const fn = A.fns.get(fnKey);
  if (!fn) return false;
  const pos = call.getStart();
  const clause = caseClauseOf(call, fn.node);
  let ok = false;
  forEachDeep(fn.node, (n) => {
    if (ok || !ts.isCallExpression(n)) return;
    const name = calleeName(n);
    if (!name || !guards.includes(name) || n.getStart() >= pos) return;
    const c = caseClauseOf(n, fn.node);
    if (c === undefined || c === clause) ok = true;
  });
  return ok;
}

/** Every resolved path from the writer up to a root that meets none of `guards`, and the functions on unguarded chains. */
function unguardedPaths(writer: string, guards: string[]): { paths: string[]; chain: Set<string> } {
  const paths: string[] = [];
  const chain = new Set<string>();
  const sites = A.writes.filter((w) => w.fn === writer);
  if (sites.length > 0 && sites.every((w) => guardedAt(writer, w.call, guards))) return { paths, chain };
  const up = (fnKey: string, path: string[]) => {
    chain.add(fnKey);
    const callers = A.edges.filter((e) => e.to === fnKey);
    if (callers.length === 0) { paths.push(path.join(' <- ')); return; }
    for (const e of callers) {
      if (guardedAt(e.from, e.call, guards)) continue;
      if (path.includes(e.from)) continue;
      up(e.from, [...path, e.from]);
    }
  };
  up(writer, [writer]);
  return { paths, chain };
}

/** Whether every function named `name` implements the owner rule, directly or through another owner check. */
function implementsOwnerRule(name: string, depth = 0): boolean {
  const decls = [...A.fns.values()].filter((f) => f.name === name);
  if (decls.length === 0 || depth > 4) return false;
  return decls.every((f) => {
    if (/['"]OWNER['"]/.test(f.text) && /\bownerId\b/.test(f.text) && /['"]SUPER_ADMIN['"]/.test(f.text)) return true;
    const called = new Set<string>();
    forEachDeep(f.node, (n) => { if (ts.isCallExpression(n)) { const c = calleeName(n); if (c && c !== name) called.add(c); } });
    return [...called].some((c) => /^(assert|is|resolve)\w*(Owner|Actor)$/.test(c) && implementsOwnerRule(c, depth + 1));
  });
}

describe('R0-09f D-11 static guard: every write of an owner-only Business field is accounted for and sits behind a named owner check', () => {
  it('[D11W-01] the reader sees the tree: over 400 source files, over 80 Business writes in over 40 files, the UpdateBusinessDto field list (over 40 fields, defaultTaxRate among them) and a call graph', () => {
    expect(A.files.length, 'no source files: the walker is broken').toBeGreaterThan(400);
    expect(A.writes.length, 'no business.update/updateMany/upsert found: the reader is broken').toBeGreaterThan(80);
    expect(new Set(A.writes.map((w) => w.fn.split('#')[0])).size).toBeGreaterThan(40);
    expect(OWNER_COLUMNS.size, 'UpdateBusinessDto was not read').toBeGreaterThan(40);
    for (const f of ['name', 'slug', 'currency', 'timezone', 'defaultTaxRate', 'storeEnabled', 'industry', 'country', 'businessIntent', 'archetype', 'onboardingComplete']) {
      expect(OWNER_COLUMNS.has(f), `owner-only field ${f}`).toBe(true);
    }
    expect(OWNER_COLUMNS.has('metaData')).toBe(false);
    expect(A.edges.length, 'no call edges resolved').toBeGreaterThan(1000);
    // The reader resolves a data identifier and its assignments (finance settings builds `data` key by key).
    const finance = A.writes.find((w) => w.fn === 'modules/finance/finance-settings.service.ts#FinanceSettingsService.update');
    expect(finance?.keys.sort()).toEqual([
      'accountantEmail', 'accountingBasis', 'defaultApAccountId', 'defaultArAccountId', 'defaultCashAccountId', 'defaultTaxAccountId', 'defaultTaxRate', 'fiscalYearStartMonth',
    ]);
  });

  it('[D11W-02] every writer of an owner-only field (or that the reader cannot see into) is in the allow-list with exactly the owner-only fields it writes, and every allow-list entry still matches a writer', () => {
    const found = ownerWritesByFn();
    expect(found.size, 'no owner-only writer found: the field list or the reader is broken').toBeGreaterThan(5);
    const unlisted = [...found].filter(([fn]) => !OWNER_WRITES[fn]).map(([fn, w]) => `${fn} writes ${w.join(', ')}`);
    expect(unlisted, 'a writer of an owner-only Business field that no allow-list entry accounts for').toEqual([]);
    const drifted = Object.entries(OWNER_WRITES)
      .filter(([fn, e]) => JSON.stringify(found.get(fn) ?? []) !== JSON.stringify([...e.writes].sort()))
      .map(([fn, e]) => `${fn}: recorded ${JSON.stringify([...e.writes].sort())}, found ${JSON.stringify(found.get(fn) ?? [])}`);
    expect(drifted, 'an allow-list entry whose writer moved, vanished or writes other owner-only fields').toEqual([]);
  });

  it('[D11W-03] RED-BEFORE: every owner-guarded writer is reached only through one of its named owner checks, on every path the reader resolves (the finance settings writer was reached from PATCH /finance/businesses/:id/settings without one)', () => {
    const owner = Object.entries(OWNER_WRITES).filter((e): e is [string, OwnerEntry] => e[1].kind === 'owner');
    expect(owner.length).toBeGreaterThan(5);
    const unguarded = owner.flatMap(([fn, e]) => unguardedPaths(fn, e.guards).paths.map((p) => `${p} (needs one of ${e.guards.join(', ')})`));
    expect(unguarded, 'a path to an owner-only write with no owner check on it').toEqual([]);
  });

  it('[D11W-04] RED-BEFORE: every named owner check exists and implements the owner rule (OWNER membership, Business.ownerId, SUPER_ADMIN bypass), directly or through another owner check', () => {
    const guards = [...new Set(Object.values(OWNER_WRITES).flatMap((e) => (e.kind === 'owner' ? e.guards : [])))].sort();
    expect(guards).toContain('assertBusinessOwner');
    expect(guards.filter((g) => !implementsOwnerRule(g)), 'an owner check that is missing or does not apply the owner rule').toEqual([]);
  });

  it('[D11W-05] the open writers are still unguarded (pinned: when one is fixed this fails, and the fix moves its entry to kind owner and removes its it.todo)', () => {
    const open = Object.entries(OWNER_WRITES).filter(([, e]) => e.kind === 'open');
    expect(open.map(([fn]) => fn)).toEqual(['modules/commerce/commerce.controller.ts#CommerceController.setDocumentTemplate']);
    for (const [fn] of open) {
      const { paths } = unguardedPaths(fn, ['assertBusinessOwner', 'assertProfileOwner', 'isProfileOwner']);
      expect(paths.length, `${fn} now passes an owner check: move it to kind 'owner'`).toBeGreaterThan(0);
    }
  });

  it('[D11W-06] no file that resolves a writer class through moduleRef calls a method on an unguarded chain behind the call graph', () => {
    const guarded = Object.entries(OWNER_WRITES).filter((e): e is [string, OwnerEntry] => e[1].kind === 'owner');
    const chainMethods = new Map<string, Set<string>>();
    for (const [fn, e] of guarded) {
      const sites = A.writes.filter((w) => w.fn === fn);
      const inner = sites.every((w) => guardedAt(fn, w.call, e.guards));
      // The writer itself and every function above it up to the owner check.
      const visited = new Set<string>([fn]);
      if (!inner) {
        const up = (key: string) => {
          for (const edge of A.edges.filter((x) => x.to === key)) {
            if (guardedAt(edge.from, edge.call, e.guards) || visited.has(edge.from)) continue;
            visited.add(edge.from);
            up(edge.from);
          }
        };
        up(fn);
      }
      for (const key of visited) {
        const f = A.fns.get(key);
        if (!f?.className) continue;
        const s = chainMethods.get(f.className) ?? new Set<string>();
        s.add(f.name);
        chainMethods.set(f.className, s);
      }
    }
    expect(chainMethods.size).toBeGreaterThan(3);
    const offenders: string[] = [];
    for (const [file, text] of A.fileText) {
      for (const [cls, methods] of chainMethods) {
        if (!new RegExp(`moduleRef\\.(get|resolve)\\(\\s*${cls}\\b`).test(text)) continue;
        for (const m of methods) if (new RegExp(`\\.${m}\\(`).test(text)) offenders.push(`${file} resolves ${cls} and calls .${m}(`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

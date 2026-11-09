/**
 * FOLLOW3-D12-METADATA-LOCKED-WRITES — Business.metaData writer census.
 *
 * Business.metaData is one jsonb column that many writers read, change and
 * write back whole. A writer that reads it without the business row lock and
 * writes its copy back undoes every write that committed in between: the
 * public storefront event (SiteService.trackEvent) wrote an owner's cleared
 * payment secret back (R0-SEC2c review SEC2c-ST-1, it.todo SEC2c-C03), and two
 * events in flight together recorded one. The fix is the lock
 * IdentityService.updateBusiness and GmailService already take (SELECT id
 * FROM businesses WHERE id = $1 FOR NO KEY UPDATE), taken through one helper,
 * lockBusinessMeta (core/prisma/business-meta.ts), in the writer's
 * transaction before it reads. This file is the reading of every writer, run
 * on every test run, so a writer that forgets the lock is named.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src):
 *   - every `<x>.business.update|updateMany|updateManyAndReturn|upsert(...)`
 *     call (also `<x>['business'].<op>(`), and the keys of its `data` (for
 *     upsert: `update`; a create is not a read-modify-write). An object
 *     literal is read key by key, spreads included; an identifier is resolved
 *     in the enclosing function (its initializer, and every `name.key =` /
 *     `name['key'] =` assignment). A computed key, a parameter or any other
 *     expression the reader cannot see into is OPAQUE.
 *   - a nested write under another model: `business: { update | upsert: ... }`.
 *   - raw SQL in a string or template literal: `UPDATE businesses SET ... meta_data`.
 * A write is a metaData write when its data has the key `metaData` or is
 * OPAQUE. Writers are keyed `<file under src>#<Class>.<method>`.
 *
 * A metaData write is LOCKED when, in the function that makes it (the
 * transaction callback), a call `lockBusinessMeta(<rx>, ...)` on the same
 * client `<rx>` as the write comes before the write, and every value spread
 * into the written metaData (`{ ...meta, key }`) is the `.metaData` of that
 * call's result (directly, or through a local initialised from it): the copy
 * written back is the one read under the lock. IdentityService.updateBusiness
 * takes the same lock inline (INLINE_LOCK_OWNERS); it must still run the
 * `FOR NO KEY UPDATE` statement on the same client before its write.
 *
 * WHAT IS REQUIRED:
 *   MW-03a every unlocked metaData writer is in D13_ALLOWLIST (FOLLOW3-D13
 *          converts them); a new one fails, naming it. Every entry still
 *          matches an unlocked writer (a converted writer is removed), and
 *          the list never grows: at most ALLOWLIST_CEILING entries.
 *   MW-03b no D12 write-set file has an unlocked metaData writer
 *          (SiteService, MarketplaceService, WhatsAppService).
 *   MW-03c the helper takes the row lock before it reads, and
 *          IdentityService.updateBusiness still locks inline.
 *   MW-03d every OPAQUE writer (data the reader cannot see into) is in
 *          OPAQUE_NOT_META with the reason it cannot carry metaData.
 *   MW-03e scanner self-test: injected writers in every form are found and
 *          classified, a locked writer passes and a non-metaData write is not
 *          a writer.
 *
 * WHAT THIS CANNOT DO: it cannot see a delegate reached through a
 * destructured or aliased variable (`const b = tx.business; b.update(...)`),
 * a table name computed at runtime, or whether the lock call's business id is
 * the written row's. Behaviour is proven on a real database by
 * test/business-meta-writers.integration.test.ts and SEC2c-C03 of
 * test/payment-secrets-write-only.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');
const HELPER_FILE = 'core/prisma/business-meta.ts';
const LOCK_FN = 'lockBusinessMeta';
const OPAQUE = '<opaque>';
const RAW = 'raw meta_data';

const WRITE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'upsert']);
const RAW_META_UPDATE = /\bupdate\s+(?:"?public"?\.)?"?businesses"?\s+set\b[\s\S]*?\bmeta_data\b/i;
const INLINE_LOCK = /\bSELECT\s+id\s+FROM\s+businesses\s+WHERE\s+id\s*=\s*\$\{[^}]+\}\s+FOR\s+NO\s+KEY\s+UPDATE\b/i;

type Entry = { why: string };

/**
 * The Business.metaData writers that still read and write without the row
 * lock, at FOLLOW3-D12. Each is converted by FOLLOW3-D13-METADATA-LOCKED-WRITES-REST
 * (outside this packet's write set). Shrink-only: remove an entry when its
 * writer takes the lock, and lower ALLOWLIST_CEILING with it.
 */
export const D13_ALLOWLIST: Record<string, Entry> = {
  // Named by FOLLOW3-D13's evidence (bb6b86d4).
  'modules/autopilot/autopilot.service.ts#AutopilotService.updateSettings': { why: "FOLLOW3-D13 (MW-11): metaData.autopilot, the owner's autopilot settings." },
  'modules/conversion/lead-magnet.service.ts#LeadMagnetService.createLeadMagnet': { why: 'FOLLOW3-D13 (MW-11): metaData lead magnets.' },
  'modules/gamification/gamification.listener.ts#GamificationListener.handleInvoicePaid': { why: 'FOLLOW3-D13 (MW-10): firstSaleMade on invoice.paid (event-driven).' },
  'modules/gamification/gamification.listener.ts#GamificationListener.handlePostPublished': { why: 'FOLLOW3-D13: gamification flag (event-driven).' },
  'modules/gamification/gamification.listener.ts#GamificationListener.handleFirstBooking': { why: 'FOLLOW3-D13: gamification flag (event-driven).' },
  'modules/gamification/gamification.listener.ts#GamificationListener.handleProductCreated': { why: 'FOLLOW3-D13: gamification flag (event-driven).' },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.checkAndGenerateNudges': { why: 'FOLLOW3-D13: concierge nudges.' },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.snoozeNudge': { why: 'FOLLOW3-D13: concierge nudge snooze.' },
  'modules/seo/seo-ga4.service.ts#SeoGoogleAnalyticsService.saveConnection': { why: 'FOLLOW3-D13: metaData GA4 connection.' },
  'modules/seo/seo-ga4.service.ts#SeoGoogleAnalyticsService.disconnectGa4': { why: 'FOLLOW3-D13: metaData GA4 connection.' },
  'modules/seo/seo-gsc.service.ts#SeoGoogleSearchConsoleService.saveConnection': { why: 'FOLLOW3-D13: metaData Search Console connection.' },
  'modules/seo/seo-gsc.service.ts#SeoGoogleSearchConsoleService.disconnectGsc': { why: 'FOLLOW3-D13: metaData Search Console connection.' },
  'modules/site/case-study.service.ts#CaseStudyService.saveMeta': { why: 'FOLLOW3-D13: metaData.caseStudies.' },
  'modules/site/qualification.service.ts#QualificationService.updateQualificationConfig': { why: 'FOLLOW3-D13: metaData qualification config.' },
  // Found by this census, not in FOLLOW3-D13's evidence list: D13 converts
  // them too to empty this list ("the remaining internal writers").
  'modules/conversion/sales-team.service.ts#SalesTeamService.setCommissionRate': { why: 'FOLLOW3-D13 (found by this census): metaData sales-team commission rate.' },
  'modules/crm/crm-ai.service.ts#CrmAiService.saveGuidelines': { why: 'FOLLOW3-D13 (found by this census): metaData CRM AI guidelines.' },
  'modules/gamification/gamification.service.ts#GamificationService.awardXp': { why: 'FOLLOW3-D13 (found by this census): metaData gamification XP.' },
  'modules/gamification/gamification.service.ts#GamificationService.updateStreak': { why: 'FOLLOW3-D13 (found by this census): metaData gamification streak.' },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.autoConfigureFromTemplate': { why: 'FOLLOW3-D13 (found by this census): concierge setup configuration (D-11 owner-only keys).' },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.awardSetupMilestone': { why: 'FOLLOW3-D13 (found by this census): setup milestones (D-11 owner-only key).' },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.dismissConcierge': { why: 'FOLLOW3-D13 (found by this census): concierge dismissal.' },
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.resumeConcierge': { why: 'FOLLOW3-D13 (found by this census): concierge resume.' },
  'modules/seo/seo-ga4.service.ts#SeoGoogleAnalyticsService.syncAnalyticsData': { why: 'FOLLOW3-D13 (found by this census): metaData GA4 sync state.' },
  'modules/seo/seo-gsc.service.ts#SeoGoogleSearchConsoleService.syncSearchData': { why: 'FOLLOW3-D13 (found by this census): metaData Search Console sync state.' },
};

/** The allow-list size at FOLLOW3-D12. It only goes down (FOLLOW3-D13 empties it). */
export const ALLOWLIST_CEILING = 24;

/** Writers that lock the business row inline (the same statement the helper runs). */
const INLINE_LOCK_OWNERS: Record<string, Entry> = {
  'modules/identity/identity.service.ts#IdentityService.updateBusiness': {
    why: 'R0-SEC2c review SEC2c-ST-1: the profile PATCH locks the row FOR NO KEY UPDATE, reads and writes in one transaction.',
  },
};

/** Writers whose data the reader cannot see into, and why it cannot carry metaData. */
const OPAQUE_NOT_META: Record<string, Entry> = {
  'core/connectors/google-suite.service.ts#GoogleSuiteService.handleCallback': {
    why: 'OAuth callback: `data` holds googleSuiteEmail and the per-service token columns named by fieldsForService (computed keys; never metaData).',
  },
  'modules/business-genesis/business-genesis.service.ts#BusinessGenesisService.submitAnswers': {
    why: 'The answers copied onto the columns GENESIS_BUSINESS_ANSWER_COLUMNS names (name, businessIntent, country, currency; computed keys, never metaData).',
  },
  'modules/connect/google-token.helper.ts#GoogleTokenHelper.getValidAccessToken': {
    why: "Token refresh: the access-token and expiry columns named by the caller's TokenFields (computed keys, typed as column names; never metaData).",
  },
};

/** The D12 write-set files: none of them may carry an unlocked metaData writer. */
const D12_WRITE_SET = [
  'modules/site/site.service.ts',
  'modules/marketplace/marketplace.service.ts',
  'modules/whatsapp/whatsapp.service.ts',
];

// --------------------------------------------------------------------------
// Reader
// --------------------------------------------------------------------------

export interface MetaWriter {
  key: string;
  line: number;
  locked: boolean;
  opaque: boolean;
  raw: boolean;
}

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

/** Like unwrap, also through `await` and the `?? {}` / `|| {}` fallbacks. */
function unwrapValue(e: ts.Expression): ts.Expression {
  let x = unwrap(e);
  for (;;) {
    if (ts.isAwaitExpression(x)) x = unwrap(x.expression);
    else if (
      ts.isBinaryExpression(x) &&
      (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      ts.isObjectLiteralExpression(unwrap(x.right)) &&
      (unwrap(x.right) as ts.ObjectLiteralExpression).properties.length === 0
    ) {
      x = unwrap(x.left);
    } else return x;
  }
}

function functionsOf(node: ts.Node): ts.FunctionLikeDeclaration[] {
  const out: ts.FunctionLikeDeclaration[] = [];
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && (p as ts.FunctionLikeDeclaration).body) out.push(p as ts.FunctionLikeDeclaration);
  }
  return out;
}

/** The initializer of the nearest variable `name` declared in the enclosing functions, or null. */
function declaredInit(name: string, at: ts.Node): ts.Expression | null | undefined {
  for (const fn of functionsOf(at)) {
    if (fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) return null;
    let found: ts.Expression | null | undefined;
    const visit = (n: ts.Node) => {
      if (found !== undefined) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
        found = n.initializer ?? null;
        return;
      }
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
    if (found !== undefined) return found;
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
        out.add(propName(p.name) ?? OPAQUE);
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
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) {
    for (const k of readKeys(e.right, at, seen)) out.add(k);
    if (e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) for (const k of readKeys(e.left, at, seen)) out.add(k);
    return out;
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.UndefinedKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return out;
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return out;
    const fns = functionsOf(at);
    if (!fns.length) return new Set([OPAQUE]);
    let declared = false;
    for (const fn of fns) {
      if (fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === e.text)) return new Set([...out, OPAQUE]);
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
      if (fn.body) visit(fn.body);
      if (declared) break;
    }
    if (!declared) out.add(OPAQUE); // a closure variable, an import
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

/** The expression a delegate write's data assigns to `metaData`, when it is a literal property. */
function metaValue(dataExpr: ts.Expression | undefined, at: ts.Node): ts.Expression | undefined {
  if (!dataExpr) return undefined;
  let d = unwrap(dataExpr);
  if (ts.isIdentifier(d)) {
    const init = declaredInit(d.text, at);
    if (!init) return undefined;
    d = unwrap(init);
  }
  return ts.isObjectLiteralExpression(d) ? objectProp(d, 'metaData') : undefined;
}

function isBusinessDelegate(e: ts.Expression): boolean {
  const x = unwrap(e);
  if (ts.isPropertyAccessExpression(x)) return x.name.text === 'business';
  if (ts.isElementAccessExpression(x)) {
    const a = unwrap(x.argumentExpression);
    return (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === 'business';
  }
  return false;
}

function receiverText(delegate: ts.Expression, sf: ts.SourceFile): string {
  const x = unwrap(delegate);
  const inner = ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) ? x.expression : x;
  return unwrap(inner).getText(sf);
}

/** The `lockBusinessMeta(<rx>, ...)` calls in `fn` before `pos` on the client `rx`. */
function lockCallsBefore(fn: ts.Node, rx: string, pos: number, sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      n.getStart(sf) < pos &&
      ts.isIdentifier(unwrap(n.expression)) &&
      (unwrap(n.expression) as ts.Identifier).text === LOCK_FN &&
      n.arguments[0] &&
      unwrap(n.arguments[0]).getText(sf) === rx
    ) {
      out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return out;
}

/** Whether `fn` runs the inline row lock on `rx` before `pos`. */
function inlineLockBefore(fn: ts.Node, rx: string, pos: number, sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isTaggedTemplateExpression(n) && n.getStart(sf) < pos) {
      const tag = unwrap(n.tag);
      if (ts.isPropertyAccessExpression(tag) && ['$queryRaw', '$executeRaw'].includes(tag.name.text) && unwrap(tag.expression).getText(sf) === rx && INLINE_LOCK.test(n.template.getText(sf))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

/** Whether `e` is (a local holding) the `.metaData` of a value returned by one of `locks`. */
function fromLockedRead(e: ts.Expression, at: ts.Node, locks: ts.CallExpression[], depth = 0): boolean {
  if (depth > 6) return false;
  const x = unwrapValue(e);
  if (ts.isIdentifier(x)) {
    const init = declaredInit(x.text, at);
    return init ? fromLockedRead(init, at, locks, depth + 1) : false;
  }
  if (ts.isPropertyAccessExpression(x) && x.name.text === 'metaData') {
    const base = unwrapValue(x.expression);
    if (ts.isCallExpression(base)) return locks.includes(base);
    if (!ts.isIdentifier(base)) return false;
    const init = declaredInit(base.text, at);
    if (!init) return false;
    const call = unwrapValue(init);
    return ts.isCallExpression(call) && locks.includes(call);
  }
  return false;
}

/** Whether every value spread into the written metaData is the locked read. */
function spreadsLockedRead(meta: ts.Expression | undefined, at: ts.Node, locks: ts.CallExpression[]): boolean {
  if (!meta) return false;
  const m = unwrap(meta);
  if (!ts.isObjectLiteralExpression(m)) return false;
  return m.properties.every((p) => !ts.isSpreadAssignment(p) || fromLockedRead(p.expression, at, locks));
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

/** Every Business.metaData writer in one source file (`rel` is the path under src), one row per write. */
export function scanMetaWrites(rel: string, source: string): MetaWriter[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: MetaWriter[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee) && WRITE_OPS.has(callee.name.text) && isBusinessDelegate(callee.expression)) {
        const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined;
        const dataExpr = arg && ts.isObjectLiteralExpression(arg) ? objectProp(arg, callee.name.text === 'upsert' ? 'update' : 'data') : undefined;
        const keys = !arg || !ts.isObjectLiteralExpression(arg) || arg.properties.some((p) => ts.isSpreadAssignment(p))
          ? new Set([OPAQUE])
          : dataExpr ? readKeys(dataExpr, n) : new Set<string>();
        if (keys.has('metaData') || keys.has(OPAQUE)) {
          const key = ownerKey(rel, n);
          const fn = functionsOf(n)[0];
          const rx = receiverText(callee.expression, sf);
          const pos = n.getStart(sf);
          let locked = false;
          if (fn && keys.has('metaData')) {
            const locks = lockCallsBefore(fn, rx, pos, sf);
            locked = locks.length > 0 && spreadsLockedRead(metaValue(dataExpr, n), n, locks);
            if (!locked && INLINE_LOCK_OWNERS[key]) locked = inlineLockBefore(fn, rx, pos, sf);
          }
          found.push({ key, line: lineOf(n), locked, opaque: !keys.has('metaData'), raw: false });
        }
      }
    } else if (ts.isPropertyAssignment(n) && propName(n.name) === 'business') {
      const v = unwrap(n.initializer);
      if (ts.isObjectLiteralExpression(v)) {
        for (const op of ['update', 'upsert']) {
          const inner = objectProp(v, op);
          if (!inner) continue;
          const iv = unwrap(inner);
          const data = ts.isObjectLiteralExpression(iv) ? (objectProp(iv, 'data') ?? (op === 'upsert' ? objectProp(iv, 'update') : iv)) : inner;
          const keys = data ? readKeys(data, n) : new Set([OPAQUE]);
          if (keys.has('metaData') || keys.has(OPAQUE)) found.push({ key: ownerKey(rel, n), line: lineOf(n), locked: false, opaque: !keys.has('metaData'), raw: false });
        }
      }
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      if (RAW_META_UPDATE.test(n.getText(sf))) found.push({ key: ownerKey(rel, n), line: lineOf(n), locked: false, opaque: false, raw: true });
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found.sort((a, b) => a.key.localeCompare(b.key) || a.line - b.line);
}

/** Census findings, as messages naming the writer. */
export function censusProblems(writes: MetaWriter[], allowlist: Record<string, Entry>, opaqueNotMeta: Record<string, Entry>): string[] {
  const problems: string[] = [];
  const unlocked = new Map<string, MetaWriter>();
  const opaque = new Map<string, MetaWriter>();
  for (const w of writes) {
    if (w.key.startsWith(`${HELPER_FILE}#`)) continue;
    if (w.opaque) { if (!opaque.has(w.key)) opaque.set(w.key, w); continue; }
    if (!w.locked && !unlocked.has(w.key)) unlocked.set(w.key, w);
  }
  for (const [key, w] of unlocked) {
    if (!allowlist[key]) {
      const how = w.raw ? 'with raw SQL' : 'without lockBusinessMeta on its client before the write (or spreads a metaData copy not read under it)';
      problems.push(`${key} (${key.split('#')[0]}:${w.line}) writes Business.metaData ${how}`);
    }
  }
  for (const key of Object.keys(allowlist)) {
    if (!unlocked.has(key)) problems.push(`${key} no longer writes Business.metaData unlocked: remove it from D13_ALLOWLIST and lower ALLOWLIST_CEILING`);
  }
  for (const [key, w] of opaque) {
    if (!opaqueNotMeta[key]) problems.push(`${key} (${key.split('#')[0]}:${w.line}) writes Business data the reader cannot see into (${OPAQUE}): it may write metaData`);
  }
  for (const key of Object.keys(opaqueNotMeta)) {
    if (!opaque.has(key)) problems.push(`${key} is no longer an opaque Business writer: remove it from OPAQUE_NOT_META`);
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
const WRITES = FILES.flatMap((f) => scanMetaWrites(relative(SRC, f).split(sep).join('/'), readFileSync(f, 'utf8')));

describe('FOLLOW3-D12 Business.metaData writers take the business row lock (census)', () => {
  it('reads the server source and finds the profile PATCH writer (this gate is not vacuous)', () => {
    expect(FILES.length, 'apps/server/src walker found no source files').toBeGreaterThan(300);
    expect(WRITES.some((w) => w.key === 'modules/identity/identity.service.ts#IdentityService.updateBusiness'), 'IdentityService.updateBusiness writes metaData').toBe(true);
  });

  it('[MW-03a] RED-BEFORE: every unlocked Business.metaData writer is exactly the FOLLOW3-D13 allow-list, and every opaque writer is classified', () => {
    expect(censusProblems(WRITES, D13_ALLOWLIST, OPAQUE_NOT_META)).toEqual([]);
  });

  it('[MW-03a] the allow-list is shrink-only (at most ALLOWLIST_CEILING entries)', () => {
    expect(Object.keys(D13_ALLOWLIST).length).toBeLessThanOrEqual(ALLOWLIST_CEILING);
    expect(ALLOWLIST_CEILING, 'the FOLLOW3-D12 ceiling; lower it, never raise it').toBeLessThanOrEqual(24);
  });

  it('[MW-03b] RED-BEFORE: no D12 write-set file writes Business.metaData unlocked (SiteService, MarketplaceService, WhatsAppService), and each still writes it under the lock', () => {
    const unlocked = WRITES.filter((w) => D12_WRITE_SET.includes(w.key.split('#')[0]) && !w.locked).map((w) => `${w.key} (line ${w.line})`);
    expect(unlocked).toEqual([]);
    for (const k of Object.keys(D13_ALLOWLIST)) expect(D12_WRITE_SET).not.toContain(k.split('#')[0]);
    const locked = WRITES.filter((w) => w.locked).map((w) => w.key);
    for (const writer of [
      'modules/site/site.service.ts#SiteService.trackEvent',
      'modules/site/site.service.ts#SiteService.updateStorefrontConfig',
      'modules/marketplace/marketplace.service.ts#MarketplaceService.updateDeliveryConfig',
      'modules/whatsapp/whatsapp.service.ts#WhatsAppService.saveConfig',
      'modules/identity/identity.service.ts#IdentityService.updateBusiness',
    ]) {
      expect(locked, `${writer} writes metaData under the row lock`).toContain(writer);
    }
  });

  it('[MW-03c] RED-BEFORE: the helper takes the business row lock (FOR NO KEY UPDATE) on the caller\'s transaction client before it reads metaData', () => {
    const file = join(SRC, HELPER_FILE);
    expect(existsSync(file), `${HELPER_FILE} exists`).toBe(true);
    const sf = ts.createSourceFile(HELPER_FILE, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === LOCK_FN);
    expect(fn, `${HELPER_FILE} declares ${LOCK_FN}`).toBeDefined();
    expect(fn!.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword), `${LOCK_FN} is exported`).toBe(true);
    const client = fn!.parameters[0] && ts.isIdentifier(fn!.parameters[0].name) ? fn!.parameters[0].name.text : '';
    const body = fn!.body!;
    let lockAt = -1;
    let readAt = -1;
    const visit = (n: ts.Node) => {
      if (ts.isTaggedTemplateExpression(n) && INLINE_LOCK.test(n.template.getText(sf)) && unwrap((n.tag as ts.PropertyAccessExpression).expression ?? n.tag).getText(sf) === client) lockAt = n.getStart(sf);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && isBusinessDelegate(n.expression.expression) && /^find/.test(n.expression.name.text) && /\bmetaData\b/.test(n.getText(sf))) readAt = n.getStart(sf);
      ts.forEachChild(n, visit);
    };
    visit(body);
    expect(lockAt, `${LOCK_FN} runs SELECT id FROM businesses WHERE id = ... FOR NO KEY UPDATE on its client`).toBeGreaterThan(-1);
    expect(readAt, `${LOCK_FN} reads metaData`).toBeGreaterThan(lockAt);
    // The inline owner keeps its own lock.
    const identity = WRITES.filter((w) => INLINE_LOCK_OWNERS[w.key]);
    expect(identity.length).toBeGreaterThan(0);
    expect(identity.every((w) => w.locked), 'IdentityService.updateBusiness still locks the row before its write').toBe(true);
  });

  it('[MW-03e] the scanner finds an injected writer in every form, passes a locked one and ignores a non-metaData write (self-test)', () => {
    const rel = 'modules/rogue/rogue-meta.service.ts';
    const injected = [
      "import { lockBusinessMeta } from '../../core/prisma/business-meta';",
      'export class RogueMeta {',
      '  // tx.business.update({ data: { metaData: {} } }) in a comment is not a writer',
      '  async unlocked(db: any, id: string) {',
      "    const b = await db.business.findUnique({ where: { id }, select: { metaData: true } });",
      "    await db.business.update({ where: { id }, data: { metaData: { ...(b.metaData as any), k: 1 } } });",
      '  }',
      '  async viaVariable(db: any, id: string, meta: any) {',
      '    const data: Record<string, unknown> = {};',
      '    data.metaData = { ...meta, k: 2 };',
      '    await db.business.updateMany({ where: { id }, data });',
      '  }',
      '  async lockedOtherClient(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const b = await lockBusinessMeta(db, id);',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...(b?.metaData as any), k: 3 } } });",
      '    });',
      '  }',
      '  async lockedStaleCopy(db: any, id: string) {',
      "    const stale = await db.business.findUnique({ where: { id }, select: { metaData: true } });",
      '    await db.$transaction(async (tx: any) => {',
      '      await lockBusinessMeta(tx, id);',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...(stale.metaData as any), k: 4 } } });",
      '    });',
      '  }',
      '  async opaque(tx: any, data: any) {',
      "    await tx.business.update({ where: { id: 'b' }, data });",
      '  }',
      '  async nested(tx: any) {',
      "    await tx.membership.update({ where: { id: 'm' }, data: { business: { update: { metaData: {} } } } });",
      '  }',
      '  async raw(tx: any, id: string) {',
      '    await tx.$executeRaw`UPDATE businesses SET meta_data = ${"{}"}::jsonb WHERE id = ${id}`;',
      '  }',
      '  async locked(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = (business?.metaData as Record<string, unknown> | null) ?? {};',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 5 } } });",
      '    });',
      '  }',
      '  async harmless(tx: any) {',
      "    await tx.business.update({ where: { id: 'b' }, data: { name: 'x' } });",
      "    await tx.business.findMany({ where: { metaData: { path: ['k'], equals: 1 } } });",
      "    await tx.business.create({ data: { metaData: {} } });",
      '  }',
      '}',
    ].join('\n');
    const scanned = scanMetaWrites(rel, injected);
    expect(scanned.map((w) => `${w.key.split('#')[1]} ${w.line} ${w.locked ? 'locked' : 'unlocked'}${w.opaque ? ' opaque' : ''}${w.raw ? ' raw' : ''}`)).toEqual([
      'RogueMeta.locked 39 locked',
      'RogueMeta.lockedOtherClient 16 unlocked',
      'RogueMeta.lockedStaleCopy 23 unlocked',
      'RogueMeta.nested 30 unlocked',
      'RogueMeta.opaque 27 unlocked opaque',
      'RogueMeta.raw 33 unlocked raw',
      'RogueMeta.unlocked 6 unlocked',
      'RogueMeta.viaVariable 11 unlocked',
    ]);
    // Findings the injection adds (independent of what the tree holds today).
    const baseline = new Set(censusProblems(WRITES, D13_ALLOWLIST, OPAQUE_NOT_META));
    const added = censusProblems([...WRITES, ...scanned], D13_ALLOWLIST, OPAQUE_NOT_META).filter((p) => !baseline.has(p));
    expect(added).toHaveLength(7);
    expect(added).toContain(`${rel}#RogueMeta.unlocked (${rel}:6) writes Business.metaData without lockBusinessMeta on its client before the write (or spreads a metaData copy not read under it)`);
    expect(added).toContain(`${rel}#RogueMeta.raw (${rel}:33) writes Business.metaData with raw SQL`);
    expect(added).toContain(`${rel}#RogueMeta.opaque (${rel}:27) writes Business data the reader cannot see into (${OPAQUE}): it may write metaData`);

    // A stale allow-list entry fails too: the list shrinks with the code.
    const first = Object.keys(D13_ALLOWLIST)[0];
    const fewer = WRITES.filter((w) => w.key !== first);
    const stale = censusProblems(fewer, D13_ALLOWLIST, OPAQUE_NOT_META).filter((p) => !baseline.has(p));
    expect(stale).toEqual([`${first} no longer writes Business.metaData unlocked: remove it from D13_ALLOWLIST and lower ALLOWLIST_CEILING`]);
  });
});

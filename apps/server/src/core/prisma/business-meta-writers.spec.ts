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
 * The other safe shape is one atomic statement (ATOMIC_STATEMENT_OWNERS): an
 * `UPDATE businesses SET meta_data = <expression over the row's own
 * meta_data>` that changes only its own key and reads nothing beforehand. The
 * UPDATE takes the row lock itself and computes from the newest committed row
 * after any wait, and it holds no lock or pooled connection across round trips.
 * The public storefront event (SiteService.trackEvent) has that shape since
 * review D12-ST-1 / CR-D12-1: under the row lock in an interactive
 * transaction, an anonymous burst of events held the shared pool and failed
 * other tenants' queries.
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
 *   - raw SQL in a string or template literal: `UPDATE businesses [[AS] alias] SET ... meta_data`.
 * A write is a metaData write when its data has the key `metaData` or is
 * OPAQUE. Writers are keyed `<file under src>#<Class>.<method>`.
 *
 * A metaData write is LOCKED when, in the function that makes it (the
 * transaction callback), a call `lockBusinessMeta(<rx>, ...)` on the same
 * client `<rx>` as the write comes before the write, and every value spread
 * into the written metaData (`{ ...meta, key }`) is the `.metaData` of that
 * call's result (directly, through a local initialised from it, or through a
 * pass-through normaliser: a top-level function of the same file, of one
 * parameter, whose every `return` is that parameter or `{}` and which only
 * tests its parameter otherwise (`raw && typeof raw === 'object'`), never
 * writes into it or hands it on, such as `parseMetaData`): the copy written
 * back is the one read under the lock (FOLLOW3-D13). The written metaData may
 * also be that locked copy itself, changed in place (`delete meta.ga4`), or a
 * local initialised with an object literal over it. No name the copy passes
 * through may be reassigned, `Object.assign`ed (or `Reflect.set`) into, or
 * written or deleted under a computed key (`meta[k] = stale[k]`): those copy
 * keys the reader cannot name (review CR-D13-1). A private method whose
 * write's client and spread values are its parameters
 * (CaseStudyService.saveMeta) is LOCKED when it is reached only by direct
 * `this.<method>(...)` calls in its class, and every such call passes a
 * client its calling function locked first (lockBusinessMeta) and the
 * metaData read under that lock. Any other reference to a member of that
 * name, anywhere in its file or in any other source file (`probe.<method>(`
 * on an `any`-typed instance, `this['<method>']`, a destructuring), fails it
 * (review D13-ST-1); a `this.<method>` in another class that declares its
 * own member of that name is that class's own. IdentityService.updateBusiness
 * takes the same lock inline (INLINE_LOCK_OWNERS); it must still run the
 * `FOR NO KEY UPDATE` statement on the same client before its write. A raw
 * write is LOCKED (and ATOMIC) only when its writer is in
 * ATOMIC_STATEMENT_OWNERS, its `SET meta_data =` expression reads the row's
 * own meta_data (before the statement's last WHERE), no value interpolated
 * into it mentions metaData, and its function reads no metaData before it
 * (no business find* naming metaData, no lockBusinessMeta, no raw SELECT of
 * meta_data).
 *
 * WHAT IS REQUIRED:
 *   MW-03a every unlocked metaData writer is in D13_ALLOWLIST; a new one
 *          fails, naming it. Every entry still matches an unlocked writer (a
 *          converted writer is removed), and the list never grows: at most
 *          ALLOWLIST_CEILING entries. FOLLOW3-D13 converted every writer in
 *          its write set; the four left are outside it (it.todo MW-03h).
 *   MW-03b no D12 write-set file has an unlocked metaData writer
 *          (SiteService, MarketplaceService, WhatsAppService).
 *   MW-03g no FOLLOW3-D13 write-set file has an unlocked metaData writer, and
 *          each writer FOLLOW3-D13 converted writes under the lock.
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
const RAW_META_UPDATE = /\bupdate\s+(?:only\s+)?(?:"?public"?\.)?"?businesses"?(?:\s+(?:as\s+)?(?!set\b)"?\w+"?)?\s+set\b[\s\S]*?\bmeta_data\b/i;
/** `SET meta_data =` (optionally alias-qualified): where an atomic statement's new value starts. */
const META_SET = /\bset\s+(?:"?\w+"?\.)?"?meta_data"?\s*=/i;
const RAW_META_READ = /\bselect\b[\s\S]*\bmeta_data\b/i;
const INLINE_LOCK = /\bSELECT\s+id\s+FROM\s+businesses\s+WHERE\s+id\s*=\s*\$\{[^}]+\}\s+FOR\s+NO\s+KEY\s+UPDATE\b/i;

type Entry = { why: string };

/**
 * The Business.metaData writers that still read and write without the row
 * lock. FOLLOW3-D12 listed 24; FOLLOW3-D13-METADATA-LOCKED-WRITES-REST
 * converted the 20 in its write set (D13_CONVERTED, checked by MW-03g). The
 * four left were found by this census and sit outside FOLLOW3-D13's write set:
 * a follow-up packet converts them and empties this list (it.todo MW-03h).
 * Shrink-only: remove an entry when its writer takes the lock, and lower
 * ALLOWLIST_CEILING with it.
 */
export const D13_ALLOWLIST: Record<string, Entry> = {
  'modules/conversion/sales-team.service.ts#SalesTeamService.setCommissionRate': { why: 'Found by this census (FOLLOW3-D12), outside the FOLLOW3-D13 write set: metaData sales-team commission rate. Follow-up packet.' },
  'modules/crm/crm-ai.service.ts#CrmAiService.saveGuidelines': { why: 'Found by this census (FOLLOW3-D12), outside the FOLLOW3-D13 write set: metaData CRM AI guidelines. Follow-up packet.' },
  'modules/gamification/gamification.service.ts#GamificationService.awardXp': { why: 'Found by this census (FOLLOW3-D12), outside the FOLLOW3-D13 write set (which holds gamification.listener.ts only): metaData gamification XP. Follow-up packet.' },
  'modules/gamification/gamification.service.ts#GamificationService.updateStreak': { why: 'Found by this census (FOLLOW3-D12), outside the FOLLOW3-D13 write set (which holds gamification.listener.ts only): metaData gamification streak. Follow-up packet.' },
};

/** The allow-list size after FOLLOW3-D13 (24 at FOLLOW3-D12). It only goes down. */
export const ALLOWLIST_CEILING = 4;

/** The FOLLOW3-D13 write-set files: none of them may carry an unlocked metaData writer. */
const D13_WRITE_SET = [
  'modules/gamification/gamification.listener.ts',
  'modules/autopilot/autopilot.service.ts',
  'modules/conversion/lead-magnet.service.ts',
  'modules/onboarding-concierge/onboarding-concierge.service.ts',
  'modules/seo/seo-ga4.service.ts',
  'modules/seo/seo-gsc.service.ts',
  'modules/site/case-study.service.ts',
  'modules/site/qualification.service.ts',
];

/**
 * The writers FOLLOW3-D13 took off the allow-list (its evidence at bb6b86d4,
 * plus those this census found in the same files). Each now writes metaData
 * under the row lock (MW-03g). The SEO writers carry the Google OAuth tokens
 * (review D12-ST-2): a stale copy written after a disconnect restored them.
 */
const D13_CONVERTED = [
  'modules/autopilot/autopilot.service.ts#AutopilotService.updateSettings',
  'modules/conversion/lead-magnet.service.ts#LeadMagnetService.createLeadMagnet',
  'modules/gamification/gamification.listener.ts#GamificationListener.handleFirstBooking',
  'modules/gamification/gamification.listener.ts#GamificationListener.handleInvoicePaid',
  'modules/gamification/gamification.listener.ts#GamificationListener.handlePostPublished',
  'modules/gamification/gamification.listener.ts#GamificationListener.handleProductCreated',
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.autoConfigureFromTemplate',
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.awardSetupMilestone',
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.checkAndGenerateNudges',
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.dismissConcierge',
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.resumeConcierge',
  'modules/onboarding-concierge/onboarding-concierge.service.ts#OnboardingConciergeService.snoozeNudge',
  'modules/seo/seo-ga4.service.ts#SeoGoogleAnalyticsService.disconnectGa4',
  'modules/seo/seo-ga4.service.ts#SeoGoogleAnalyticsService.saveConnection',
  'modules/seo/seo-ga4.service.ts#SeoGoogleAnalyticsService.syncAnalyticsData',
  'modules/seo/seo-gsc.service.ts#SeoGoogleSearchConsoleService.disconnectGsc',
  'modules/seo/seo-gsc.service.ts#SeoGoogleSearchConsoleService.saveConnection',
  'modules/seo/seo-gsc.service.ts#SeoGoogleSearchConsoleService.syncSearchData',
  'modules/site/case-study.service.ts#CaseStudyService.saveMeta',
  'modules/site/qualification.service.ts#QualificationService.updateQualificationConfig',
];

/** Writers that lock the business row inline (the same statement the helper runs). */
const INLINE_LOCK_OWNERS: Record<string, Entry> = {
  'modules/identity/identity.service.ts#IdentityService.updateBusiness': {
    why: 'R0-SEC2c review SEC2c-ST-1: the profile PATCH locks the row FOR NO KEY UPDATE, reads and writes in one transaction.',
  },
};

/**
 * Writers that change metaData in one atomic SQL statement computed from the
 * row's own meta_data (the shape the reader checks is in the header). Each
 * entry is reviewed: the statement must write back no key but its own.
 */
export const ATOMIC_STATEMENT_OWNERS: Record<string, Entry> = {
  'modules/site/site.service.ts#SiteService.trackEvent': {
    why: 'FOLLOW3-D12 review D12-ST-1 / CR-D12-1: the public, unauthenticated storefront event appends its event to storefrontEvents (newest 1000 kept) in one UPDATE ... WHERE deleted_at IS NULL; no read lock or pooled connection held across round trips.',
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
  /** A registered single-statement writer of the checked shape (locked by its own UPDATE). */
  atomic?: boolean;
  /** Locked by its callers: the private write helper's member name (D13-ST-1: checked in every other file too). */
  helper?: string;
  /** D13-ST-1: `<file>:<line>` of a reference outside the helper's file that reaches it. */
  stray?: string;
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

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Calls that write into their first argument. */
const WRITING_CALLS = new Set(['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Reflect.set', 'Reflect.defineProperty', 'Reflect.deleteProperty']);

function literalKey(e: ts.Expression): boolean {
  const k = unwrap(e);
  return ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k) || ts.isNumericLiteral(k);
}

/**
 * Whether the name `name` (seen from `at`) is reassigned (`name = ...`,
 * `name ??= ...`), has values `Object.assign`ed (or `Reflect.set`, ...) into
 * it, or is written or deleted under a computed key (`name[k] = stale[k]`,
 * `delete name[k]`: review CR-D13-1, keys the reader cannot name) anywhere in
 * the outermost function enclosing `at`. Any same-named variable there counts.
 * A literal key (`name.ga4 = ...`, `name['ga4'] = ...`) is the writer's own
 * key, as in `{ ...name, ga4 }`.
 */
function overwritten(name: string, at: ts.Node): boolean {
  const fns = functionsOf(at);
  const outer = fns[fns.length - 1];
  if (!outer?.body) return false;
  let hit = false;
  const named = (e: ts.Expression | undefined) => !!e && ts.isIdentifier(unwrap(e)) && (unwrap(e) as ts.Identifier).text === name;
  const computedOn = (e: ts.Expression) => {
    const x = unwrap(e);
    return ts.isElementAccessExpression(x) && named(x.expression) && !literalKey(x.argumentExpression);
  };
  const visit = (n: ts.Node) => {
    if (hit) return;
    if (ts.isBinaryExpression(n) && isAssignment(n.operatorToken.kind) && (named(n.left) || computedOn(n.left))) hit = true;
    else if (ts.isDeleteExpression(n) && computedOn(n.expression)) hit = true;
    else if (ts.isCallExpression(n) && WRITING_CALLS.has(unwrap(n.expression).getText()) && named(n.arguments[0])) hit = true;
    ts.forEachChild(n, visit);
  };
  visit(outer.body);
  return hit;
}

function isWrapper(n: ts.Node): boolean {
  return ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n);
}

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.InKeyword,
]);
const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);

/**
 * Whether the reference `id` only tests the value or returns it: `return id`,
 * `typeof id`, a comparison operand, `Array.isArray(id)`, `!id`, or (through
 * `&&` / `||` / `??`) an if, while or `?:` condition. Anything else (a write
 * into it, `Object.assign(id, ...)`, a call it is handed to, an alias) may
 * change the value or let it be changed.
 */
function testsOrReturns(id: ts.Identifier): boolean {
  let n: ts.Node = id;
  const climb = () => { while (n.parent && isWrapper(n.parent)) n = n.parent; };
  climb();
  let p = n.parent;
  if (!p) return false;
  if (ts.isReturnStatement(p) || ts.isTypeOfExpression(p)) return true;
  if (ts.isBinaryExpression(p) && COMPARISONS.has(p.operatorToken.kind)) return true;
  if (ts.isCallExpression(p) && p.expression.getText() === 'Array.isArray' && p.arguments.length === 1 && p.arguments[0] === n) return true;
  for (;;) {
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
    if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === n) return true;
    if (ts.isConditionalExpression(p) && p.condition === n) return true;
    if (!ts.isBinaryExpression(p) || !LOGICAL.has(p.operatorToken.kind)) return false;
    n = p;
    climb();
    if (!n.parent) return false;
    p = n.parent;
  }
}

/**
 * Whether `name` is a pass-through normaliser of the file holding `at`
 * (FOLLOW3-D13: `parseMetaData`): a top-level function of one parameter whose
 * every `return` (nested functions aside) is that parameter or `{}`, and whose
 * every other mention of the parameter only tests it (testsOrReturns; none in
 * a nested function). Review CR-D13-1: a write into the parameter
 * (`Object.assign(raw, stale)`, `raw[k] = ...`), a call it is handed to or an
 * alias of it may fill it with another copy, so the function is not one. Its
 * result is its argument unchanged or an empty bag, never another copy.
 */
function passThrough(name: string, at: ts.Node): boolean {
  const fn = at.getSourceFile().statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!fn?.body || fn.parameters.length !== 1 || !ts.isIdentifier(fn.parameters[0].name)) return false;
  const param = fn.parameters[0].name.text;
  const returns: ts.ReturnStatement[] = [];
  let other = false;
  const visit = (n: ts.Node, nested: boolean) => {
    if (other) return;
    if (ts.isReturnStatement(n) && !nested) returns.push(n);
    if (ts.isIdentifier(n) && n.text === param) {
      const p = n.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
      if (!isName && (nested || !testsOrReturns(n))) other = true;
    }
    ts.forEachChild(n, (c) => visit(c, nested || ts.isFunctionLike(c)));
  };
  ts.forEachChild(fn.body, (c) => visit(c, ts.isFunctionLike(c)));
  return !other && returns.length > 0 && returns.every((r) => {
    const v = r.expression ? unwrap(r.expression) : undefined;
    return !!v && ((ts.isIdentifier(v) && v.text === param) || (ts.isObjectLiteralExpression(v) && v.properties.length === 0));
  });
}

/**
 * Whether `e` is (a local holding, or a pass-through normaliser of) the
 * `.metaData` of a value returned by one of `locks`.
 */
function fromLockedRead(e: ts.Expression, at: ts.Node, locks: ts.CallExpression[], depth = 0): boolean {
  if (depth > 6) return false;
  const x = unwrapValue(e);
  if (ts.isIdentifier(x)) {
    if (overwritten(x.text, at)) return false;
    const init = declaredInit(x.text, at);
    return init ? fromLockedRead(init, at, locks, depth + 1) : false;
  }
  if (ts.isCallExpression(x) && x.arguments.length === 1 && ts.isIdentifier(unwrap(x.expression)) && passThrough((unwrap(x.expression) as ts.Identifier).text, at)) {
    return fromLockedRead(x.arguments[0], at, locks, depth + 1);
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

/** Whether `fn` reads metaData before `pos`: a business find* naming metaData, a lockBusinessMeta call or a raw SELECT of meta_data. */
function readsMetaBefore(fn: ts.Node, pos: number, sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n.getStart(sf) < pos) {
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isIdentifier(callee) && callee.text === LOCK_FN) found = true;
        else if (ts.isPropertyAccessExpression(callee) && /^find/.test(callee.name.text) && isBusinessDelegate(callee.expression) && /\bmetaData\b/.test(n.getText(sf))) found = true;
        else if (ts.isPropertyAccessExpression(callee) && /^\$queryRaw/.test(callee.name.text) && RAW_META_READ.test(n.getText(sf))) found = true;
      } else if (ts.isTaggedTemplateExpression(n)) {
        const tag = unwrap(n.tag);
        if (ts.isPropertyAccessExpression(tag) && /^\$queryRaw/.test(tag.name.text) && RAW_META_READ.test(n.template.getText(sf))) found = true;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

/**
 * Whether the raw statement `lit` is an atomic metaData writer: its
 * `SET meta_data =` value reads the row's own meta_data (before the
 * statement's last WHERE), no interpolated value mentions metaData, and its
 * function reads no metaData before it.
 */
function atomicStatement(lit: ts.Node, sf: ts.SourceFile): boolean {
  const text = lit.getText(sf);
  const set = META_SET.exec(text);
  if (!set) return false;
  const from = set.index + set[0].length;
  const where = text.toLowerCase().lastIndexOf('where');
  const value = text.slice(from, where > from ? where : undefined);
  if (!/\bmeta_data\b/i.test(value)) return false;
  if (ts.isTemplateExpression(lit) && lit.templateSpans.some((s) => /\bmetaData\b/.test(s.expression.getText(sf)))) return false;
  const fn = functionsOf(lit)[0];
  return !!fn && !readsMetaBefore(fn, lit.getStart(sf), sf);
}

/**
 * Whether the written metaData copies only the locked read: an object literal
 * whose every spread is the locked read; or (FOLLOW3-D13) the locked copy
 * itself, changed in place (`delete meta.ga4; ... metaData: meta`); or a local
 * initialised with such an object literal (later `name.key = ...` adds keys).
 * A name reassigned, `Object.assign`ed into or written under a computed key
 * (`meta[k] = stale[k]`, review CR-D13-1) is not (overwritten).
 */
function spreadsLockedRead(meta: ts.Expression | undefined, at: ts.Node, locks: ts.CallExpression[], depth = 0): boolean {
  if (!meta || depth > 4) return false;
  const m = unwrap(meta);
  if (ts.isObjectLiteralExpression(m)) return m.properties.every((p) => !ts.isSpreadAssignment(p) || fromLockedRead(p.expression, at, locks));
  if (!ts.isIdentifier(m) || overwritten(m.text, at)) return false;
  if (fromLockedRead(m, at, locks)) return true;
  const init = declaredInit(m.text, at);
  return !!init && ts.isObjectLiteralExpression(unwrap(init)) && spreadsLockedRead(init, at, locks, depth + 1);
}

/** The class `this` is bound to at `n` (an arrow function sees through; a `function` or an object-literal method rebinds it), or undefined. */
function thisClass(n: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isArrowFunction(p)) continue;
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) return undefined;
    if (ts.isMethodDeclaration(p) || ts.isConstructorDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isClassStaticBlockDeclaration(p)) {
      return ts.isClassLike(p.parent) ? p.parent : undefined;
    }
  }
  return undefined;
}

/**
 * Review D13-ST-1: every reference in the whole file `sf` to a member named
 * `name`. `calls` are the direct `this.<name>(...)` calls whose `this` is
 * `cls`. `stray` holds the line of every other reference that may reach the
 * member (TS `private` does not hold against an `any`-typed value): any other
 * receiver (`probe.<name>(`, `(this as any).<name>`), `x['<name>']`, a
 * destructuring, `this.<name>` of `cls` not called, or `this.<name>` in a
 * class (or function) without a member of that name of its own. A
 * `this.<name>` in another class that declares its own `name` member is that
 * class's own and not counted. With no `cls` (another file), every reference
 * but those is stray.
 */
export function memberReferences(sf: ts.SourceFile, name: string, cls?: ts.ClassLikeDeclaration): { calls: ts.CallExpression[]; stray: number[] } {
  const calls: ts.CallExpression[] = [];
  const stray: number[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const ownMember = (c: ts.ClassLikeDeclaration) => c.members.some((m) => propName(m.name) === name);
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === name) {
      if (n.expression.kind !== ts.SyntaxKind.ThisKeyword) stray.push(lineOf(n));
      else {
        const c = thisClass(n);
        if (c && c === cls) {
          if (ts.isCallExpression(n.parent) && n.parent.expression === n) calls.push(n.parent);
          else stray.push(lineOf(n));
        } else if (!c || !ownMember(c)) stray.push(lineOf(n));
      }
    } else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === name) {
      stray.push(lineOf(n));
    } else if (ts.isBindingElement(n) && (propName(n.propertyName) ?? (ts.isIdentifier(n.name) ? n.name.text : null)) === name) {
      stray.push(lineOf(n));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { calls, stray };
}

/**
 * FOLLOW3-D13 (CaseStudyService.saveMeta): whether the write in the private
 * method `fn`, whose client `rx` and every value spread into the written
 * metaData are `fn`'s parameters, is locked by its callers. `fn` must be
 * reached only by direct `this.<name>(...)` calls in its class (at least
 * one). Any other reference to a member of that name anywhere in the file
 * fails it (memberReferences, review D13-ST-1); references in other files
 * are checked by helperReachedElsewhere. Each call must pass a client its
 * calling function locked first (lockBusinessMeta on it, before the call)
 * and, for each spread parameter, the metaData read under that lock.
 */
function lockedByCallers(fn: ts.FunctionLikeDeclaration, rx: string, meta: ts.Expression | undefined, sf: ts.SourceFile): boolean {
  if (!ts.isMethodDeclaration(fn) || !meta) return false;
  const isPrivate = ts.isPrivateIdentifier(fn.name) || (ts.getModifiers(fn) ?? []).some((mod) => mod.kind === ts.SyntaxKind.PrivateKeyword);
  const name = propName(fn.name);
  const m = unwrap(meta);
  if (!isPrivate || !name || !ts.isObjectLiteralExpression(m)) return false;
  const paramAt = (p: string) => fn.parameters.findIndex((q) => ts.isIdentifier(q.name) && q.name.text === p);
  const clientAt = paramAt(rx);
  if (clientAt < 0 || overwritten(rx, m)) return false;
  const spreadAt: number[] = [];
  for (const p of m.properties) {
    if (!ts.isSpreadAssignment(p)) continue;
    const v = unwrap(p.expression);
    const i = ts.isIdentifier(v) ? paramAt(v.text) : -1;
    if (i < 0 || overwritten((v as ts.Identifier).text, m)) return false;
    spreadAt.push(i);
  }
  const cls = fn.parent;
  if (!ts.isClassLike(cls)) return false;
  const { calls, stray } = memberReferences(sf, name, cls);
  if (stray.length > 0 || calls.length === 0) return false;
  return calls.every((call) => {
    const client = call.arguments[clientAt] ? unwrap(call.arguments[clientAt]) : undefined;
    const caller = functionsOf(call)[0];
    if (!client || !ts.isIdentifier(client) || !caller) return false;
    const locks = lockCallsBefore(caller, client.text, call.getStart(sf), sf);
    return locks.length > 0 && spreadAt.every((i) => !!call.arguments[i] && fromLockedRead(call.arguments[i], call, locks));
  });
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

/**
 * Every Business.metaData writer in one source file (`rel` is the path under
 * src), one row per write. `atomicOwners` is the reviewed list of
 * single-statement writers (ATOMIC_STATEMENT_OWNERS unless a test passes one).
 */
export function scanMetaWrites(rel: string, source: string, atomicOwners: Record<string, Entry> = ATOMIC_STATEMENT_OWNERS): MetaWriter[] {
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
          let helper: string | undefined;
          if (fn && keys.has('metaData')) {
            const locks = lockCallsBefore(fn, rx, pos, sf);
            const meta = metaValue(dataExpr, n);
            locked = locks.length > 0 && spreadsLockedRead(meta, n, locks);
            if (!locked && INLINE_LOCK_OWNERS[key]) locked = inlineLockBefore(fn, rx, pos, sf);
            if (!locked && lockedByCallers(fn, rx, meta, sf)) {
              locked = true;
              helper = propName((fn as ts.MethodDeclaration).name) ?? undefined;
            }
          }
          found.push({ key, line: lineOf(n), locked, opaque: !keys.has('metaData'), raw: false, ...(helper ? { helper } : {}) });
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
      if (RAW_META_UPDATE.test(n.getText(sf))) {
        const key = ownerKey(rel, n);
        const atomic = Boolean(atomicOwners[key]) && atomicStatement(n, sf);
        found.push({ key, line: lineOf(n), locked: atomic, opaque: false, raw: true, ...(atomic ? { atomic } : {}) });
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found.sort((a, b) => a.key.localeCompare(b.key) || a.line - b.line);
}

/**
 * Review D13-ST-1: a private write helper is locked by its callers only while
 * nothing outside its file reaches it either (TS `private` does not hold
 * against an `any`-typed instance, which can pass an unlocked client and a
 * stale copy). Returns `writes` with each helper-locked writer that another
 * source file references (memberReferences, no class) marked unlocked, with
 * `stray` naming the first such reference. A `#private` name cannot be
 * reached from another file.
 */
export function helperReachedElsewhere(writes: MetaWriter[], sources: { rel: string; source: string }[]): MetaWriter[] {
  const parsed = new Map<string, ts.SourceFile>();
  return writes.map((w) => {
    if (!w.helper || !w.locked || w.helper.startsWith('#')) return w;
    const file = w.key.split('#')[0];
    for (const { rel, source } of sources) {
      if (rel === file || !source.includes(w.helper)) continue;
      let sf = parsed.get(rel);
      if (!sf) parsed.set(rel, (sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)));
      const { stray } = memberReferences(sf, w.helper);
      if (stray.length > 0) return { ...w, locked: false, stray: `${rel}:${stray[0]}` };
    }
    return w;
  });
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
      const how = w.raw
        ? 'with raw SQL'
        : w.stray
          ? `through a private write helper that ${w.stray} also reaches (only direct this-calls from callers that lock first may)`
          : 'without lockBusinessMeta on its client before the write (or spreads a metaData copy not read under it)';
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
const SOURCES = FILES.map((f) => ({ rel: relative(SRC, f).split(sep).join('/'), source: readFileSync(f, 'utf8') }));
const WRITES = helperReachedElsewhere(SOURCES.flatMap(({ rel, source }) => scanMetaWrites(rel, source)), SOURCES);

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
    expect(ALLOWLIST_CEILING, 'the FOLLOW3-D13 ceiling (24 at FOLLOW3-D12); lower it, never raise it').toBeLessThanOrEqual(4);
  });

  it('[MW-03g] RED-BEFORE: no FOLLOW3-D13 write-set file writes Business.metaData unlocked, none is on the allow-list, and every writer FOLLOW3-D13 converted writes under the lock', () => {
    const unlocked = WRITES.filter((w) => D13_WRITE_SET.includes(w.key.split('#')[0]) && !w.locked).map((w) => `${w.key} (line ${w.line})`);
    expect(unlocked).toEqual([]);
    for (const k of Object.keys(D13_ALLOWLIST)) expect(D13_WRITE_SET).not.toContain(k.split('#')[0]);
    const locked = new Set(WRITES.filter((w) => w.locked).map((w) => w.key));
    expect(D13_CONVERTED.filter((writer) => !locked.has(writer)), 'converted writers not found writing metaData under the row lock').toEqual([]);
    expect(D13_CONVERTED.filter((writer) => D13_ALLOWLIST[writer])).toEqual([]);
  });

  // FOLLOW3-D13's proof asks for an empty allow-list. Four writers this census
  // found (FOLLOW3-D12) are in files outside FOLLOW3-D13's write set
  // (conversion/sales-team.service.ts, crm/crm-ai.service.ts,
  // gamification/gamification.service.ts): a follow-up packet converts them,
  // then sets ALLOWLIST_CEILING to 0 and turns this into a test.
  it.todo('[MW-03h] the allow-list is empty: SalesTeamService.setCommissionRate, CrmAiService.saveGuidelines, GamificationService.awardXp and updateStreak write under the lock (outside the FOLLOW3-D13 write set)');

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

  // Review D12-ST-2, outside the D12 write set (core/security/sanitize-business.ts
  // and the SEO services): the SEO connections store Google OAuth tokens in
  // metaData.ga4 / metaData.gsc, and maskMetaData masks only whatsapp and the
  // four payment secrets, so GET /identity/businesses/:id answers the refresh
  // tokens to any member. FOLLOW3-D13 put the writers under the row lock (a
  // stale copy no longer restores a disconnected token); the read mask needs
  // its own packet.
  it.todo('[D12-ST-2] a Business read masks metaData.ga4 and metaData.gsc OAuth tokens (accessToken, refreshToken) as it masks the payment secrets (follow-up packet: sanitize-business.ts and the SEO writers are outside the FOLLOW3-D12 write set)');

  it('[MW-03f] the public storefront event (SiteService.trackEvent) is one atomic statement, not a read under the row lock in an interactive transaction (review D12-ST-1 / CR-D12-1), and every ATOMIC_STATEMENT_OWNERS entry still is one', () => {
    const trackEvent = WRITES.filter((w) => w.key === 'modules/site/site.service.ts#SiteService.trackEvent');
    expect(trackEvent.map((w) => `${w.raw ? 'raw' : 'client'} ${w.atomic ? 'atomic' : 'not atomic'} ${w.locked ? 'locked' : 'unlocked'}`)).toEqual(['raw atomic locked']);
    for (const key of Object.keys(ATOMIC_STATEMENT_OWNERS)) {
      expect(WRITES.some((w) => w.key === key && w.atomic), `${key} is still an atomic metaData statement (else remove it from ATOMIC_STATEMENT_OWNERS)`).toBe(true);
      expect(WRITES.filter((w) => w.key === key && !w.atomic), `${key} writes metaData only in its atomic statement`).toEqual([]);
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
      '  async atomicMerge(tx: any, id: string, event: string) {',
      "    await tx.$executeRaw`UPDATE businesses SET meta_data = COALESCE(meta_data, '{}'::jsonb) || jsonb_build_object('k', ${event}::jsonb) WHERE id = ${id}`;",
      '  }',
      '  async atomicAfterRead(tx: any, id: string) {',
      '    const b = await tx.business.findUnique({ where: { id }, select: { metaData: true } });',
      '    await tx.$executeRaw`UPDATE businesses SET meta_data = meta_data || ${JSON.stringify(b.metaData)}::jsonb WHERE id = ${id}`;',
      '  }',
      '  async aliased(tx: any, id: string) {',
      "    await tx.$executeRaw`UPDATE businesses AS b SET meta_data = ${'{}'}::jsonb WHERE b.id = ${id}`;",
      '  }',
      // FOLLOW3-D13 forms: a pass-through normaliser, the locked copy changed
      // in place, a local over it, and a private write helper whose callers lock.
      '  async normalised(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = asBag(business?.metaData);',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 6 } } });",
      '    });',
      '  }',
      '  async notPassThrough(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = cached(business?.metaData);',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 7 } } });",
      '    });',
      '  }',
      '  async inPlace(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = (business?.metaData as Record<string, unknown> | null) ?? {};',
      '      delete meta.k;',
      "      await tx.business.update({ where: { id }, data: { metaData: meta } });",
      '    });',
      '  }',
      '  async localOverLocked(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = (business?.metaData as Record<string, unknown> | null) ?? {};',
      '      const next = { ...meta };',
      '      next.k = 8;',
      "      await tx.business.update({ where: { id }, data: { metaData: next } });",
      '    });',
      '  }',
      '  async localMergedStale(db: any, id: string, stale: any) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const next = { ...((business?.metaData as Record<string, unknown> | null) ?? {}) };',
      '      Object.assign(next, stale);',
      "      await tx.business.update({ where: { id }, data: { metaData: next } });",
      '    });',
      '  }',
      '  async viaHelper(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      await this.writeBag(tx, id, (business?.metaData as Record<string, unknown> | null) ?? {});',
      '    });',
      '  }',
      '  private async writeBag(tx: any, id: string, meta: Record<string, unknown>) {',
      "    await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 9 } } });",
      '  }',
      '  async viaHelperStale(db: any, id: string) {',
      "    const stale = await db.business.findUnique({ where: { id }, select: { metaData: true } });",
      '    await db.$transaction(async (tx: any) => {',
      '      await lockBusinessMeta(tx, id);',
      '      await this.writeBagStale(tx, id, stale.metaData);',
      '    });',
      '  }',
      '  private async writeBagStale(tx: any, id: string, meta: Record<string, unknown>) {',
      "    await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 10 } } });",
      '  }',
      // Review CR-D13-1: a "normaliser" that fills its argument with a stale
      // copy, and computed-key copies of a stale bag into the locked copy
      // (written in place, or spread); a literal own key still passes.
      '  async normalisedStale(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = keepStale(business?.metaData);',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 11 } } });",
      '    });',
      '  }',
      '  async inPlaceStale(db: any, id: string, stale: any) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = (business?.metaData as Record<string, unknown> | null) ?? {};',
      '      for (const k of Object.keys(stale)) meta[k] = stale[k];',
      "      await tx.business.update({ where: { id }, data: { metaData: meta } });",
      '    });',
      '  }',
      '  async spreadStaleFilled(db: any, id: string, stale: any) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = (business?.metaData as Record<string, unknown> | null) ?? {};',
      '      Object.keys(stale).forEach((k) => { meta[k] = stale[k]; });',
      "      await tx.business.update({ where: { id }, data: { metaData: { ...meta, k: 12 } } });",
      '    });',
      '  }',
      '  async inPlaceOwnKey(db: any, id: string) {',
      '    await db.$transaction(async (tx: any) => {',
      '      const business = await lockBusinessMeta(tx, id);',
      '      const meta = (business?.metaData as Record<string, unknown> | null) ?? {};',
      "      meta['k'] = 13;",
      "      await tx.business.update({ where: { id }, data: { metaData: meta } });",
      '    });',
      '  }',
      '}',
      'function asBag(raw: unknown) {',
      "  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;",
      '  return {};',
      '}',
      'function cached(raw: unknown) {',
      '  return raw ? CACHE : {};',
      '}',
      'function keepStale(raw: any) {',
      '  Object.assign(raw, (globalThis as any).staleCopy);',
      '  return raw;',
      '}',
    ].join('\n');
    const row = (w: MetaWriter) => `${w.key.split('#')[1]} ${w.line} ${w.locked ? 'locked' : 'unlocked'}${w.opaque ? ' opaque' : ''}${w.raw ? ' raw' : ''}${w.atomic ? ' atomic' : ''}`;
    const scanned = scanMetaWrites(rel, injected);
    expect(scanned.map(row)).toEqual([
      'RogueMeta.aliased 55 unlocked raw',
      'RogueMeta.atomicAfterRead 52 unlocked raw',
      'RogueMeta.atomicMerge 48 unlocked raw',
      'RogueMeta.inPlace 76 locked',
      'RogueMeta.inPlaceOwnKey 143 locked',
      'RogueMeta.inPlaceStale 127 unlocked',
      'RogueMeta.localMergedStale 93 unlocked',
      'RogueMeta.localOverLocked 85 locked',
      'RogueMeta.locked 39 locked',
      'RogueMeta.lockedOtherClient 16 unlocked',
      'RogueMeta.lockedStaleCopy 23 unlocked',
      'RogueMeta.nested 30 unlocked',
      'RogueMeta.normalised 61 locked',
      'RogueMeta.normalisedStale 119 unlocked',
      'RogueMeta.notPassThrough 68 unlocked',
      'RogueMeta.opaque 27 unlocked opaque',
      'RogueMeta.raw 33 unlocked raw',
      'RogueMeta.spreadStaleFilled 135 unlocked',
      'RogueMeta.unlocked 6 unlocked',
      'RogueMeta.viaVariable 11 unlocked',
      'RogueMeta.writeBag 103 locked',
      'RogueMeta.writeBagStale 113 unlocked',
    ]);
    // Findings the injection adds (independent of what the tree holds today).
    const baseline = new Set(censusProblems(WRITES, D13_ALLOWLIST, OPAQUE_NOT_META));
    const added = censusProblems([...WRITES, ...scanned], D13_ALLOWLIST, OPAQUE_NOT_META).filter((p) => !baseline.has(p));
    expect(added).toHaveLength(16);
    // FOLLOW3-D13 forms that must still fail: a one-argument call that is not
    // a pass-through, a local the stale copy is Object.assign'ed into, and a
    // private helper whose caller passes a copy read before its lock; review
    // CR-D13-1: a "normaliser" that Object.assigns a stale copy into its
    // argument, and a stale bag copied key by key into the locked copy.
    for (const [method, line] of [
      ['notPassThrough', 68], ['localMergedStale', 93], ['writeBagStale', 113],
      ['normalisedStale', 119], ['inPlaceStale', 127], ['spreadStaleFilled', 135],
    ] as const) {
      expect(added).toContain(`${rel}#RogueMeta.${method} (${rel}:${line}) writes Business.metaData without lockBusinessMeta on its client before the write (or spreads a metaData copy not read under it)`);
    }
    expect(added).toContain(`${rel}#RogueMeta.unlocked (${rel}:6) writes Business.metaData without lockBusinessMeta on its client before the write (or spreads a metaData copy not read under it)`);
    expect(added).toContain(`${rel}#RogueMeta.raw (${rel}:33) writes Business.metaData with raw SQL`);
    expect(added).toContain(`${rel}#RogueMeta.aliased (${rel}:55) writes Business.metaData with raw SQL`);
    expect(added).toContain(`${rel}#RogueMeta.opaque (${rel}:27) writes Business data the reader cannot see into (${OPAQUE}): it may write metaData`);

    // A reviewed single-statement writer passes only in the atomic shape: an
    // in-statement merge with no read before it. A registered writer that
    // reads metaData first, or writes a constant (not the row's own value), is
    // still a stale-copy writer.
    const reviewed = {
      [`${rel}#RogueMeta.atomicMerge`]: { why: 'self-test' },
      [`${rel}#RogueMeta.atomicAfterRead`]: { why: 'self-test' },
      [`${rel}#RogueMeta.raw`]: { why: 'self-test' },
    };
    const withReviewed = scanMetaWrites(rel, injected, reviewed);
    expect(withReviewed.filter((w) => w.raw).map(row)).toEqual([
      'RogueMeta.aliased 55 unlocked raw',
      'RogueMeta.atomicAfterRead 52 unlocked raw',
      'RogueMeta.atomicMerge 48 locked raw atomic',
      'RogueMeta.raw 33 unlocked raw',
    ]);
    expect(censusProblems([...WRITES, ...withReviewed], D13_ALLOWLIST, OPAQUE_NOT_META).filter((p) => !baseline.has(p))).toHaveLength(15);

    // Review CR-D13-1: a normaliser is a pass-through only while it does no
    // more than test its argument and return it (or {}): a write into it, a
    // call it is handed to or an alias of it fails the writer that uses it.
    const asBagGuard = "  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;";
    const normalisedRow = (prefix: string) =>
      scanMetaWrites(rel, injected.replace(asBagGuard, `${prefix}\n${asBagGuard}`)).filter((w) => w.key.endsWith('#RogueMeta.normalised')).map((w) => w.locked);
    expect([
      '  if (!raw) return {};',
      '  Object.assign(raw as object, STALE);',
      '  (raw as any).k = STALE;',
      '  (raw as any)[KEY] = STALE;',
      '  fill(raw);',
      '  const alias: any = raw;',
    ].map(normalisedRow)).toEqual([[true], [false], [false], [false], [false], [false]]);

    // A private write helper is locked by its callers only while every
    // reference to it is a direct call from a caller that locked first: one
    // more caller without the lock, or the helper passed as a value, fails it.
    const helperRow = (src: string) => scanMetaWrites(rel, src).filter((w) => w.key.endsWith('#RogueMeta.writeBag')).map((w) => w.locked);
    const unlockedCaller = injected.replace(
      '  private async writeBag(',
      '  async writeBagUnlocked(db: any, id: string) { await this.writeBag(db, id, {}); }\n  private async writeBag(',
    );
    const asValue = injected.replace(
      '  private async writeBag(',
      '  handOff() { return this.writeBag; }\n  private async writeBag(',
    );
    const notPrivate = injected.replace('  private async writeBag(', '  async writeBag(');
    expect([helperRow(injected), helperRow(unlockedCaller), helperRow(asValue), helperRow(notPrivate)]).toEqual([[true], [false], [false], [false]]);

    // Review D13-ST-1: every reference in the file counts, not only those in
    // the helper's class. TS `private` does not hold against an `any`-typed
    // instance: another class that passes an unlocked client and a stale copy
    // fails the helper, as do `(this as any).writeBag`, a destructuring and a
    // `this.writeBag` in a plain function. Another class's own `writeBag`
    // called on its own `this` is not a reference to this one.
    const outsideCaller = [
      'class Outsider {',
      '  async run(probe: any, db: any, id: string) {',
      "    const stale = await db.business.findUnique({ where: { id }, select: { metaData: true } });",
      '    await probe.writeBag(db, id, stale.metaData);',
      '  }',
      '}',
    ].join('\n');
    const ownWriteBag = [
      'class Neighbour {',
      '  async run(db: any) { await this.writeBag(db); }',
      '  private async writeBag(db: any) { return db; }',
      '}',
    ].join('\n');
    const withMethod = (method: string) => injected.replace('  private async writeBag(', `${method}\n  private async writeBag(`);
    expect([
      helperRow(`${injected}\n${outsideCaller}`),
      helperRow(withMethod('  async anyThis(db: any, id: string) { await (this as any).writeBag(db, id, {}); }')),
      helperRow(withMethod('  async destructured(db: any, id: string) { const { writeBag } = this as any; await writeBag(db, id, {}); }')),
      helperRow(`${injected}\nfunction loose(this: any, db: any, id: string) { return this.writeBag(db, id, {}); }`),
      helperRow(`${injected}\n${ownWriteBag}`),
    ]).toEqual([[false], [false], [false], [false], [true]]);

    // ... and every other source file counts too (the census passes every
    // file under src to helperReachedElsewhere): a caller there fails the
    // helper and the census names it; a class there with its own member of
    // the same name does not.
    const other = 'modules/other/other.service.ts';
    const elsewhere = (source: string) =>
      helperReachedElsewhere(scanned, [{ rel, source: injected }, { rel: other, source }]).filter((w) => w.key.endsWith('#RogueMeta.writeBag'));
    const reached = elsewhere(outsideCaller);
    expect(reached.map((w) => `${w.locked ? 'locked' : 'unlocked'} ${w.stray ?? ''}`)).toEqual([`unlocked ${other}:4`]);
    expect(censusProblems([...WRITES, ...reached], D13_ALLOWLIST, OPAQUE_NOT_META).filter((p) => !baseline.has(p))).toEqual([
      `${rel}#RogueMeta.writeBag (${rel}:103) writes Business.metaData through a private write helper that ${other}:4 also reaches (only direct this-calls from callers that lock first may)`,
    ]);
    expect(elsewhere(ownWriteBag).map((w) => w.locked)).toEqual([true]);
    expect(elsewhere('export const unrelated = 1;').map((w) => w.locked)).toEqual([true]);

    // A stale allow-list entry fails too: the list shrinks with the code.
    const first = Object.keys(D13_ALLOWLIST)[0];
    const fewer = WRITES.filter((w) => w.key !== first);
    const stale = censusProblems(fewer, D13_ALLOWLIST, OPAQUE_NOT_META).filter((p) => !baseline.has(p));
    expect(stale).toEqual([`${first} no longer writes Business.metaData unlocked: remove it from D13_ALLOWLIST and lower ALLOWLIST_CEILING`]);
  });
});

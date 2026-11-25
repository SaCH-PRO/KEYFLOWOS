/**
 * W11-OWNER-HELPER-REST (P73, owner rulings D-116, D-125, D-104; seam review
 * W11SEAM-OWN-3 / W11SEAM-OWN-CR-3):
 *
 * Static AST census pinning the single owner rule across `apps/server/src` and
 * `packages/api/src`:
 *
 *   (a) No non-test source file under `apps/server/src` or `packages/api/src`
 *       may execute a `.business.(findFirst|findFirstOrThrow|findUnique|
 *       findUniqueOrThrow|findMany|count)` query — whether raw, wrapped in
 *       `skipTenantIsolation({...})`, cast/parenthesized, using computed string
 *       keys (`['ownerId']`), or passed via local `where`/`args` variables —
 *       whose `where` clause references `ownerId` (bare, inside `OR`/`AND`/`NOT`,
 *       or paired with a `members` filter with or without `role: 'OWNER'`),
 *       except for an exact, count-pinned, non-`id`-filtered allowlist of
 *       audited bootstrap / placeholder-cleanup reads.
 *   (b) Every named owner / owner-or-admin authority check across the server
 *       exists uniquely, contains zero `.business.*` calls and zero `ownerId`
 *       references, and implements its check via `isBusinessOwnerMember` or a
 *       direct `membership.findUnique` role read.
 *   (c) Negative controls on synthetic sources prove (a), (b), allowlist count
 *       & `id`-filter pinning, real `skipTenantIsolation({...})` unwrapping,
 *       `*OrThrow` methods, aliased `where`/`args` variables, computed keys,
 *       and arrow/duplicate named checks are all non-vacuous.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_ROOT = path.join(REPO_ROOT, 'apps/server/src');
const API_SRC_ROOT = path.join(REPO_ROOT, 'packages/api/src');

const BUSINESS_READ_METHODS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
]);

export interface OwnerIdBusinessReadViolation {
  file: string;
  line: number;
  enclosingFunction: string;
  method: string;
  hasMembersClause: boolean;
  hasIdClause: boolean;
  snippet: string;
}

/**
 * Exact allowlist of legitimate non-owner-check `business.*` queries whose
 * `where` clause mentions `ownerId`, pinned to exact per-key occurrence counts.
 * Neither legitimate query filters by business `id`; any query inside an
 * allowlisted function whose `where` filters on `id` is unconditionally
 * rejected even if its key is listed here.
 */
const ALLOWED_OWNER_ID_BUSINESS_READS: ReadonlyMap<string, number> = new Map([
  // Onboarding bootstrap: 2 findFirst queries (exact owner workspace lookup & fallback) — neither filters by `id`.
  ['apps/server/src/modules/identity/identity.service.ts::ensureBootstrapWorkspace::findFirst', 2],
  // Invite acceptance: 1 count checking whether a placeholder user still owns any business before deleting it — does not filter by `id`.
  ['apps/server/src/modules/identity/identity.service.ts::assertAdoptableInvitePlaceholder::count', 1],
]);

/**
 * Named owner & owner-or-admin authority checks pinned to the single owner
 * rule (`isBusinessOwnerMember` or direct `membership.findUnique` role read,
 * never a `Business.ownerId` read).
 */
const NAMED_OWNER_CHECKS: ReadonlyArray<{
  file: string;
  name: string;
  mode: 'helper' | 'membership-only';
}> = [
  { file: 'apps/server/src/core/auth/business-owner.ts', name: 'isBusinessOwnerMember', mode: 'membership-only' },
  { file: 'apps/server/src/core/auth/business-owner.ts', name: 'assertBusinessOwnerMember', mode: 'helper' },
  { file: 'apps/server/src/modules/identity/identity.service.ts', name: 'assertBusinessOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/business-genesis/business-genesis.service.ts', name: 'isProfileOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/finance/finance-settings.service.ts', name: 'isProfileOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts', name: 'isProfileOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/templates/templates.service.ts', name: 'isProfileOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/site/presence/presence.service.ts', name: 'isSlugOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/whatsapp/whatsapp.service.ts', name: 'isConfigOwner', mode: 'helper' },
  { file: 'apps/server/src/core/connectors/google-suite.controller.ts', name: 'assertGoogleConnectOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/commerce/gmail.service.ts', name: 'connectStanding', mode: 'helper' },
  { file: 'apps/server/src/modules/seo/seo.controller.ts', name: 'assertConnectorOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/subscriptions/subscriptions.service.ts', name: 'assertPlanChangeAuthority', mode: 'helper' },
  { file: 'apps/server/src/modules/key-connector/key-connector.controller.ts', name: 'requireConnectorWriter', mode: 'membership-only' },
  { file: 'apps/server/src/modules/finance/accounting-period.service.ts', name: 'assertMayGate', mode: 'membership-only' },
  { file: 'apps/server/src/modules/onboarding-concierge/demo-data-seeder.service.ts', name: 'resolveSeedOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/ai/agent-trigger.service.ts', name: 'isBusinessOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/key-cortex/key-cortex-planner.service.ts', name: 'isBusinessOwner', mode: 'helper' },
  { file: 'apps/server/src/modules/ai/plan-step-authority.ts', name: 'memberToolRunAuthority', mode: 'membership-only' },
  { file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts', name: 'writerTier', mode: 'membership-only' },
];

function walkNonTestTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
      out.push(...walkNonTestTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

function propNameText(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const expr = name.expression;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }
  }
  return null;
}

function isSkipTenantIsolationCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression) && node.expression.text === 'skipTenantIsolation') {
    return true;
  }
  if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'skipTenantIsolation') {
    return true;
  }
  return false;
}

function isObjectOrArrayExpr(
  expr: ts.Expression,
  scope: ReadonlyMap<string, ts.Expression>,
  visited = new Set<string>(),
): boolean {
  const unwrapped = unwrapExpression(expr, scope, visited);
  return ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped);
}

function unwrapExpression(
  expr: ts.Expression,
  scope: ReadonlyMap<string, ts.Expression>,
  visited = new Set<string>(),
): ts.Expression {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isNonNullExpression(cur) || ts.isTypeAssertionExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isCallExpression(cur) && isSkipTenantIsolationCall(cur) && cur.arguments.length >= 1) {
      cur = cur.arguments[0];
      continue;
    }
    if (ts.isIdentifier(cur) && !visited.has(cur.text)) {
      const bound = scope.get(cur.text);
      if (bound) {
        const nextVisited = new Set(visited);
        nextVisited.add(cur.text);
        const resolved = unwrapExpression(bound, scope, nextVisited);
        if (ts.isObjectLiteralExpression(resolved) || ts.isArrayLiteralExpression(resolved)) {
          return resolved;
        }
      }
    }
    return cur;
  }
}

function objectLiteralHasKeyDeep(
  node: ts.Node,
  key: string,
  scope: ReadonlyMap<string, ts.Expression>,
  visitedNodes = new Set<ts.Node>(),
): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found || visitedNodes.has(n)) return;
    visitedNodes.add(n);
    if (ts.isPropertyAssignment(n)) {
      if (propNameText(n.name) === key) {
        found = true;
        return;
      }
      const val = unwrapExpression(n.initializer, scope);
      if (ts.isObjectLiteralExpression(val) || ts.isArrayLiteralExpression(val)) {
        visit(val);
      }
      return;
    }
    if (ts.isShorthandPropertyAssignment(n)) {
      if (n.name.text === key) {
        found = true;
        return;
      }
      if (isObjectOrArrayExpr(n.name, scope)) {
        const resolved = unwrapExpression(n.name, scope);
        visit(resolved);
      }
      return;
    }
    if (ts.isSpreadAssignment(n)) {
      const target = unwrapExpression(n.expression, scope);
      if (ts.isObjectLiteralExpression(target)) {
        visit(target);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) {
        const resolved = ts.isSpreadElement(el)
          ? unwrapExpression(el.expression, scope)
          : unwrapExpression(el, scope);
        if (ts.isObjectLiteralExpression(resolved) || ts.isArrayLiteralExpression(resolved)) {
          visit(resolved);
        }
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  const root = ts.isExpression(node) ? unwrapExpression(node, scope) : node;
  if (ts.isObjectLiteralExpression(root) || ts.isArrayLiteralExpression(root)) {
    visit(root);
  }
  return found;
}

function getPropertyInitializer(
  obj: ts.ObjectLiteralExpression,
  key: string,
  scope: ReadonlyMap<string, ts.Expression>,
  visitedNodes = new Set<ts.Node>(),
): ts.Expression | null {
  if (visitedNodes.has(obj)) return null;
  visitedNodes.add(obj);
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propNameText(prop.name) === key) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === key) {
      return prop.name;
    }
    if (ts.isSpreadAssignment(prop)) {
      const spreadTarget = unwrapExpression(prop.expression, scope);
      if (ts.isObjectLiteralExpression(spreadTarget)) {
        const fromSpread = getPropertyInitializer(spreadTarget, key, scope, visitedNodes);
        if (fromSpread) return fromSpread;
      }
    }
  }
  return null;
}

function enclosingFunctionName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isMethodDeclaration(cur) || ts.isFunctionDeclaration(cur)) {
      if (cur.name && ts.isIdentifier(cur.name)) return cur.name.text;
    }
    if (
      ts.isPropertyDeclaration(cur) &&
      cur.name &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return '<top-level>';
}

/**
 * Inspect a single TypeScript source string for any `.business.(findFirst|
 * findFirstOrThrow|findUnique|findUniqueOrThrow|findMany|count)` call whose
 * `where` clause references `ownerId`. Handles `skipTenantIsolation({...})`,
 * type assertions/parens, local variable `args`/`where` aliases, spread props,
 * and computed string-literal keys.
 */
export function scanSourceForOwnerIdBusinessReads(
  relFile: string,
  sourceText: string,
): OwnerIdBusinessReadViolation[] {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: OwnerIdBusinessReadViolation[] = [];

  const visit = (node: ts.Node, parentScope: ReadonlyMap<string, ts.Expression>) => {
    let scope: Map<string, ts.Expression> | ReadonlyMap<string, ts.Expression> = parentScope;

    // Collect local variable bindings declared directly inside block/source-file statements
    // before visiting child expressions in that scope.
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const localScope = new Map(parentScope);
      for (const stmt of node.statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer) {
              localScope.set(decl.name.text, decl.initializer);
            }
          }
        }
      }
      scope = localScope;
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const isBusinessReceiver =
        (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'business') ||
        (ts.isIdentifier(receiver) && receiver.text === 'business');

      if (isBusinessReceiver && BUSINESS_READ_METHODS.has(method)) {
        const firstArg = node.arguments[0];
        if (firstArg) {
          const queryObj = unwrapExpression(firstArg, scope);
          if (ts.isObjectLiteralExpression(queryObj)) {
            const whereInit = getPropertyInitializer(queryObj, 'where', scope);
            if (whereInit && objectLiteralHasKeyDeep(whereInit, 'ownerId', scope)) {
              const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
              violations.push({
                file: relFile,
                line: line + 1,
                enclosingFunction: enclosingFunctionName(node),
                method,
                hasMembersClause: objectLiteralHasKeyDeep(whereInit, 'members', scope),
                hasIdClause: objectLiteralHasKeyDeep(whereInit, 'id', scope),
                snippet: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, scope));
  };

  visit(sf, new Map());
  return violations;
}

/**
 * Evaluate scanned `Business.ownerId` violations against an exact count-pinned,
 * non-`id`-filtered allowlist. Returns unexpected violations plus count drift
 * mismatches (extra or missing occurrences).
 */
export function evaluateAllowlistViolations(
  violations: ReadonlyArray<OwnerIdBusinessReadViolation>,
  allowlist: ReadonlyMap<string, number>,
): { unexpected: OwnerIdBusinessReadViolation[]; countDrifts: string[] } {
  const unexpected: OwnerIdBusinessReadViolation[] = [];
  const seenCounts = new Map<string, number>();

  for (const v of violations) {
    const key = `${v.file}::${v.enclosingFunction}::${v.method}`;
    const expectedCount = allowlist.get(key);
    // An allowlisted non-owner-check query may never filter by business `id`.
    if (expectedCount !== undefined && !v.hasIdClause) {
      const next = (seenCounts.get(key) ?? 0) + 1;
      seenCounts.set(key, next);
      if (next > expectedCount) {
        unexpected.push(v);
      }
    } else {
      unexpected.push(v);
    }
  }

  const countDrifts: string[] = [];
  for (const [key, expected] of allowlist.entries()) {
    const actual = seenCounts.get(key) ?? 0;
    if (actual !== expected) {
      countDrifts.push(`${key}: expected ${expected} allowlisted read(s), found ${actual}`);
    }
  }

  return { unexpected, countDrifts };
}

/**
 * Inspect a named function/method/arrow-function body inside a source string to
 * ensure it exists uniquely and follows the single owner rule
 * (`isBusinessOwnerMember` or `membership.findUnique` role read) with zero
 * `.business.*` calls and zero `ownerId` references.
 */
export function inspectNamedOwnerCheck(
  relFile: string,
  sourceText: string,
  functionName: string,
  mode: 'helper' | 'membership-only',
): { found: boolean; problems: string[] } {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const targets: ts.Node[] = [];

  const findTargets = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === functionName &&
      node.body
    ) {
      targets.push(node.body);
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === functionName &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      targets.push(node.initializer.body);
    }
    ts.forEachChild(node, findTargets);
  };
  findTargets(sf);

  if (targets.length === 0) {
    return { found: false, problems: [`${relFile}: named owner check "${functionName}" not found`] };
  }

  const problems: string[] = [];
  if (targets.length > 1) {
    problems.push(`${relFile}::${functionName}: expected 1 symbol, found ${targets.length} ambiguous declarations`);
  }

  for (const targetBody of targets) {
    let callsHelper = false;
    let readsMembershipFindUnique = false;

    const inspectBody = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'isBusinessOwnerMember') {
          callsHelper = true;
        }
        if (ts.isPropertyAccessExpression(node.expression)) {
          const prop = node.expression.name.text;
          const recv = node.expression.expression;
          if (
            (ts.isPropertyAccessExpression(recv) && recv.name.text === 'business') ||
            (ts.isIdentifier(recv) && recv.text === 'business')
          ) {
            problems.push(`${relFile}::${functionName}: calls .business.${prop}() inside owner check`);
          }
          if (
            prop === 'findUnique' &&
            ((ts.isPropertyAccessExpression(recv) && recv.name.text === 'membership') ||
              (ts.isIdentifier(recv) && recv.text === 'membership'))
          ) {
            readsMembershipFindUnique = true;
          }
        }
      }
      if (ts.isIdentifier(node) && node.text === 'ownerId') {
        problems.push(`${relFile}::${functionName}: references ownerId inside owner check`);
      }
      ts.forEachChild(node, inspectBody);
    };
    inspectBody(targetBody);

    if (mode === 'helper' && !callsHelper) {
      problems.push(`${relFile}::${functionName}: must call isBusinessOwnerMember(...)`);
    }
    if (mode === 'membership-only' && !callsHelper && !readsMembershipFindUnique) {
      problems.push(`${relFile}::${functionName}: must call isBusinessOwnerMember(...) or read membership.findUnique(...)`);
    }
  }

  return { found: true, problems };
}

describe('W11-OWNER-HELPER-REST (D-116, D-125, W11SEAM-OWN-3): single owner rule static census', () => {
  it('[ORC-01] RED-BEFORE: no non-test file under apps/server/src or packages/api/src queries .business.* with ownerId in where outside the exact count-pinned non-id allowlist', () => {
    const serverFiles = walkNonTestTsFiles(SERVER_SRC_ROOT);
    const apiFiles = walkNonTestTsFiles(API_SRC_ROOT);
    expect(serverFiles.length, 'census must scan real server sources').toBeGreaterThan(200);
    expect(apiFiles.length, 'census must scan real packages/api sources').toBeGreaterThanOrEqual(12);

    const allViolations: OwnerIdBusinessReadViolation[] = [];
    for (const absPath of [...serverFiles, ...apiFiles]) {
      const rel = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
      const src = fs.readFileSync(absPath, 'utf8');
      allViolations.push(...scanSourceForOwnerIdBusinessReads(rel, src));
    }

    const { unexpected, countDrifts } = evaluateAllowlistViolations(
      allViolations,
      ALLOWED_OWNER_ID_BUSINESS_READS,
    );

    expect(
      unexpected.map((v) => `${v.file}:${v.line} (${v.enclosingFunction}) .business.${v.method}: ${v.snippet}`),
      'unexpected Business.ownerId query in where clause (use isBusinessOwnerMember / OWNER membership)',
    ).toEqual([]);

    expect(
      countDrifts,
      'allowlist occurrence count drift (every allowlisted entry must match its exact pinned count)',
    ).toEqual([]);
  });

  it('[ORC-02] RED-BEFORE: every named owner check calls isBusinessOwnerMember or reads only membership.findUnique, with zero .business.* or ownerId references', () => {
    const allProblems: string[] = [];
    for (const check of NAMED_OWNER_CHECKS) {
      const absPath = path.join(REPO_ROOT, check.file);
      const src = fs.readFileSync(absPath, 'utf8');
      const res = inspectNamedOwnerCheck(check.file, src, check.name, check.mode);
      allProblems.push(...res.problems);
    }
    expect(allProblems).toEqual([]);
  });

  it('[ORC-03] negative controls (W11SEAM-OWN-3 / W11SEAM-OWN-CR-3): synthetic retired D-104, redundant D-116, real skipTenantIsolation({...}), *OrThrow, aliased vars, computed keys, allowlist drift, and arrow/duplicate checks are flagged; clean helper & membership checks pass', () => {
    const d104Shape = `
      async function badD104(prisma: any, businessId: string, userId: string) {
        return prisma.client.business.findFirst({
          where: { id: businessId, ownerId: userId, members: { some: { userId } } },
          select: { id: true },
        });
      }
    `;
    const d116RedundantShape = `
      async function badD116(prisma: any, businessId: string, userId: string) {
        return prisma.client.business.findFirst({
          where: { id: businessId, ownerId: userId, members: { some: { userId, role: 'OWNER' } } },
          select: { id: true },
        });
      }
    `;
    const orArmShape = `
      async function badOr(ctx: any, businessId: string, userId: string) {
        return ctx.db.business.findFirst({
          where: { id: businessId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        });
      }
    `;
    // Real @keyflow/db API: skipTenantIsolation wraps the Prisma query args object, not a callback.
    const realSkipTenantShape = `
      async function badRealSkip(prisma: any, businessId: string, userId: string) {
        return prisma.client.business.findFirst(
          skipTenantIsolation({
            where: { id: businessId, ownerId: userId, members: { some: { userId } } },
            select: { id: true },
          }),
        );
      }
    `;
    const findFirstOrThrowShape = `
      async function badOrThrow(prisma: any, businessId: string, userId: string) {
        return prisma.client.business.findFirstOrThrow({
          where: { id: businessId, ownerId: userId },
        });
      }
    `;
    const findUniqueOrThrowShape = `
      async function badUniqueOrThrow(prisma: any, businessId: string, userId: string) {
        return prisma.client.business.findUniqueOrThrow({
          where: { id: businessId, ownerId: userId },
        });
      }
    `;
    const aliasedWhereShape = `
      async function badAliasedWhere(prisma: any, businessId: string, userId: string) {
        const where = { id: businessId, ownerId: userId };
        return prisma.client.business.findFirst({ where });
      }
    `;
    const aliasedArgsShape = `
      async function badAliasedArgs(prisma: any, businessId: string, userId: string) {
        const args = { where: { id: businessId, ownerId: userId } } as const;
        return prisma.client.business.findFirst(skipTenantIsolation(args));
      }
    `;
    const computedKeyShape = `
      async function badComputed(prisma: any, businessId: string, userId: string) {
        return prisma.client.business.findFirst({
          where: { id: businessId, ['ownerId']: userId },
        });
      }
    `;
    const bareCountShape = `
      async function badCount(db: any, businessId: string, userId: string) {
        return db.business.count({ where: { id: businessId, ownerId: userId } });
      }
    `;

    const d104Hits = scanSourceForOwnerIdBusinessReads('synthetic/d104.ts', d104Shape);
    expect(d104Hits).toHaveLength(1);
    expect(d104Hits[0].hasMembersClause).toBe(true);
    expect(d104Hits[0].hasIdClause).toBe(true);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/d116.ts', d116RedundantShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/or.ts', orArmShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/real-skip.ts', realSkipTenantShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/first-or-throw.ts', findFirstOrThrowShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/unique-or-throw.ts', findUniqueOrThrowShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/aliased-where.ts', aliasedWhereShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/aliased-args.ts', aliasedArgsShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/computed.ts', computedKeyShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/count.ts', bareCountShape)).toHaveLength(1);

    // Allowlist hardening negative controls:
    // (1) An id-filtered owner-check added inside an allowlisted function is rejected.
    const allowlistKey = 'synthetic/bootstrap.ts::ensureBootstrapWorkspace::findFirst';
    const syntheticAllowlist = new Map([[allowlistKey, 2]]);
    const idFilteredInsideAllowlisted = `
      async function ensureBootstrapWorkspace(tx: any, businessId: string, userId: string) {
        await tx.business.findFirst({ where: { ownerId: userId } });
        await tx.business.findFirst({ where: { ownerId: userId, deletedAt: null } });
        await tx.business.findFirst({ where: { id: businessId, ownerId: userId } });
      }
    `;
    const idEval = evaluateAllowlistViolations(
      scanSourceForOwnerIdBusinessReads('synthetic/bootstrap.ts', idFilteredInsideAllowlisted),
      syntheticAllowlist,
    );
    expect(idEval.unexpected).toHaveLength(1);
    expect(idEval.unexpected[0].hasIdClause).toBe(true);

    // (2) An extra 3rd non-id query inside an allowlisted function fails both unexpected and countDrift.
    const extraNonIdInsideAllowlisted = `
      async function ensureBootstrapWorkspace(tx: any, userId: string) {
        await tx.business.findFirst({ where: { ownerId: userId } });
        await tx.business.findFirst({ where: { ownerId: userId, deletedAt: null } });
        await tx.business.findFirst({ where: { ownerId: userId, slug: 'x' } });
      }
    `;
    const extraEval = evaluateAllowlistViolations(
      scanSourceForOwnerIdBusinessReads('synthetic/bootstrap.ts', extraNonIdInsideAllowlisted),
      syntheticAllowlist,
    );
    expect(extraEval.unexpected).toHaveLength(1);
    expect(extraEval.countDrifts).toHaveLength(1);

    // (3) Removing one allowlisted query fails countDrift (staleness).
    const missingOneAllowlisted = `
      async function ensureBootstrapWorkspace(tx: any, userId: string) {
        await tx.business.findFirst({ where: { ownerId: userId } });
      }
    `;
    const missingEval = evaluateAllowlistViolations(
      scanSourceForOwnerIdBusinessReads('synthetic/bootstrap.ts', missingOneAllowlisted),
      syntheticAllowlist,
    );
    expect(missingEval.unexpected).toHaveLength(0);
    expect(missingEval.countDrifts).toHaveLength(1);

    // Gate (b) negative controls: named function, arrow function, and duplicate symbol names.
    const badNamedCheck = inspectNamedOwnerCheck('synthetic/d116.ts', d116RedundantShape, 'badD116', 'helper');
    expect(badNamedCheck.found).toBe(true);
    expect(badNamedCheck.problems.length).toBeGreaterThanOrEqual(2);

    const badArrowCheck = `
      const isArrowOwner = async (prisma: any, businessId: string, userId: string) =>
        prisma.client.business.findFirst({ where: { id: businessId, ownerId: userId } });
    `;
    const arrowRes = inspectNamedOwnerCheck('synthetic/arrow.ts', badArrowCheck, 'isArrowOwner', 'helper');
    expect(arrowRes.found).toBe(true);
    expect(arrowRes.problems.length).toBeGreaterThanOrEqual(2);

    const duplicateSymbol = `
      class A { async isOwner(prisma: any, b: string, u: string) { return isBusinessOwnerMember(prisma, b, u); } }
      class B { async isOwner(prisma: any, b: string, u: string) { return isBusinessOwnerMember(prisma, b, u); } }
    `;
    const dupRes = inspectNamedOwnerCheck('synthetic/dup.ts', duplicateSymbol, 'isOwner', 'helper');
    expect(dupRes.found).toBe(true);
    expect(dupRes.problems.some((p) => p.includes('ambiguous'))).toBe(true);

    // Cyclic & shadowed variable-rebinding termination controls (must terminate cleanly without stack overflow).
    const cyclicPropertyShape = `
      function q(prisma: any) {
        const a: any = { x: b };
        const b: any = { x: a };
        return prisma.business.findFirst({ where: a });
      }
    `;
    const shadowedSpreadWhereShape = `
      const baseWhere = { deletedAt: null };
      const activeWhere = { ...baseWhere, status: 'ACTIVE' };
      function q(prisma: any) {
        const baseWhere = { ...activeWhere, archived: false };
        return prisma.business.findFirst({ where: baseWhere });
      }
    `;
    const shadowedSpreadWithOwnerId = `
      const baseWhere = { deletedAt: null };
      const activeWhere = { ...baseWhere, ownerId: 'u1' };
      function q(prisma: any) {
        const baseWhere = { ...activeWhere, id: 'b1' };
        return prisma.business.findFirst({ where: baseWhere });
      }
    `;
    const cyclicArrayShape = `
      function q(prisma: any) {
        const a: any = { AND: [b] };
        const b: any = { AND: [a] };
        return prisma.business.findFirst({ where: a });
      }
    `;
    const shadowedSpreadArgsShape = `
      const base = { select: { id: true } };
      const args = { ...base };
      function q(prisma: any) {
        const base = { ...args };
        return prisma.business.findFirst(base);
      }
    `;
    expect(scanSourceForOwnerIdBusinessReads('synthetic/cycle-prop.ts', cyclicPropertyShape)).toEqual([]);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/cycle-spread-where.ts', shadowedSpreadWhereShape)).toEqual([]);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/cycle-spread-owner.ts', shadowedSpreadWithOwnerId)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/cycle-array.ts', cyclicArrayShape)).toEqual([]);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/cycle-spread-args.ts', shadowedSpreadArgsShape)).toEqual([]);

    // Clean positive controls pass both (a) and (b).
    const cleanHelper = `
      async function isOwnerOk(prisma: any, businessId: string, userId: string) {
        return isBusinessOwnerMember(prisma.client, businessId, userId);
      }
    `;
    const cleanMembership = `
      async function writerOk(prisma: any, businessId: string, userId: string) {
        const m = await prisma.client.membership.findUnique({
          where: { userId_businessId: { userId, businessId } },
          select: { role: true },
        });
        return m?.role === 'OWNER' || m?.role === 'ADMIN';
      }
    `;
    expect(scanSourceForOwnerIdBusinessReads('synthetic/clean1.ts', cleanHelper)).toEqual([]);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/clean2.ts', cleanMembership)).toEqual([]);
    expect(inspectNamedOwnerCheck('synthetic/clean1.ts', cleanHelper, 'isOwnerOk', 'helper').problems).toEqual([]);
    expect(inspectNamedOwnerCheck('synthetic/clean2.ts', cleanMembership, 'writerOk', 'membership-only').problems).toEqual([]);
  });
});

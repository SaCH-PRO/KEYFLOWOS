/**
 * W11-OWNER-HELPER-REST (P73, owner rulings D-116, D-125, D-104; seam review
 * W11SEAM-OWN-3 / W11SEAM-OWN-CR-3):
 *
 * Static AST census pinning the single owner rule across `apps/server/src` and
 * `packages/api/src`:
 *
 *   (a) No non-test source file under `apps/server/src` or `packages/api/src`
 *       may execute a `.business.(findFirst|findUnique|findMany|count)` query
 *       (including inside `skipTenantIsolation(...)`) whose `where` clause
 *       references `ownerId` — whether bare, inside `OR`/`AND`/`NOT`, or paired
 *       with a `members` filter with or without `role: 'OWNER'` (explicitly
 *       refusing both the retired D-104 shape and redundant D-116 owner arms) —
 *       except for an exact, audited allowlist of non-owner-check bootstrap /
 *       placeholder-cleanup reads.
 *   (b) Every named owner / owner-or-admin authority check across the server
 *       exists, contains zero `.business.*` calls and zero `ownerId`
 *       references, and implements its check via `isBusinessOwnerMember` or a
 *       direct `membership.findUnique` role read.
 *   (c) Negative controls on synthetic sources prove (a) and (b) are non-vacuous
 *       and refuse every retired D-104 and redundant D-116 owner-arm shape.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'apps/server/src'),
  path.join(REPO_ROOT, 'packages/api/src'),
];

const BUSINESS_READ_METHODS = new Set(['findFirst', 'findUnique', 'findMany', 'count']);

export interface OwnerIdBusinessReadViolation {
  file: string;
  line: number;
  enclosingFunction: string;
  method: string;
  hasMembersClause: boolean;
  snippet: string;
}

/**
 * Exact allowlist of legitimate non-owner-check `business.*` queries whose
 * `where` clause mentions `ownerId`. Every entry must still exist in the tree
 * (stale allowlist entries fail the census).
 */
const ALLOWED_OWNER_ID_BUSINESS_READS = new Set([
  // Onboarding bootstrap: finds an existing live workspace the user founded before creating another.
  'apps/server/src/modules/identity/identity.service.ts::ensureBootstrapWorkspace::findFirst',
  // Invite acceptance: checks whether a placeholder user still owns any business before deleting the placeholder.
  'apps/server/src/modules/identity/identity.service.ts::assertAdoptableInvitePlaceholder::count',
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
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function objectLiteralHasKeyDeep(node: ts.Node, key: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      if (propNameText(n.name) === key) {
        found = true;
        return;
      }
    } else if (ts.isShorthandPropertyAssignment(n)) {
      if (n.name.text === key) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function getPropertyInitializer(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propNameText(prop.name) === key) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === key) {
      return prop.name;
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
 * Inspect a single TypeScript source string for any `.business.(findFirst|findUnique|findMany|count)`
 * call whose `where` clause references `ownerId`.
 */
export function scanSourceForOwnerIdBusinessReads(
  relFile: string,
  sourceText: string,
): OwnerIdBusinessReadViolation[] {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: OwnerIdBusinessReadViolation[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const isBusinessReceiver =
        (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'business') ||
        (ts.isIdentifier(receiver) && receiver.text === 'business');

      if (isBusinessReceiver && BUSINESS_READ_METHODS.has(method)) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          const whereInit = getPropertyInitializer(firstArg, 'where');
          if (whereInit && objectLiteralHasKeyDeep(whereInit, 'ownerId')) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            violations.push({
              file: relFile,
              line: line + 1,
              enclosingFunction: enclosingFunctionName(node),
              method,
              hasMembersClause: objectLiteralHasKeyDeep(whereInit, 'members'),
              snippet: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return violations;
}

/**
 * Inspect a named function/method body inside a source string to ensure it
 * follows the single owner rule (`isBusinessOwnerMember` or `membership.findUnique`
 * role read) with zero `.business.*` calls and zero `ownerId` references.
 */
export function inspectNamedOwnerCheck(
  relFile: string,
  sourceText: string,
  functionName: string,
  mode: 'helper' | 'membership-only',
): { found: boolean; problems: string[] } {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let targetBody: ts.Node | null = null;

  const findTarget = (node: ts.Node) => {
    if (targetBody) return;
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === functionName &&
      node.body
    ) {
      targetBody = node.body;
      return;
    }
    ts.forEachChild(node, findTarget);
  };
  findTarget(sf);

  if (!targetBody) {
    return { found: false, problems: [`${relFile}: named owner check "${functionName}" not found`] };
  }

  let callsHelper = false;
  let readsMembershipFindUnique = false;
  const problems: string[] = [];

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

  return { found: true, problems };
}

describe('W11-OWNER-HELPER-REST (D-116, D-125, W11SEAM-OWN-3): single owner rule static census', () => {
  it('[ORC-01] RED-BEFORE: no non-test file under apps/server/src or packages/api/src queries .business.* with ownerId in where outside the exact non-owner-check allowlist', () => {
    const files = SCAN_ROOTS.flatMap(walkNonTestTsFiles);
    expect(files.length, 'census must scan real server and api sources').toBeGreaterThan(200);

    const unexpected: OwnerIdBusinessReadViolation[] = [];
    const seenAllowed = new Set<string>();

    for (const absPath of files) {
      const rel = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
      const src = fs.readFileSync(absPath, 'utf8');
      for (const v of scanSourceForOwnerIdBusinessReads(rel, src)) {
        const key = `${v.file}::${v.enclosingFunction}::${v.method}`;
        if (ALLOWED_OWNER_ID_BUSINESS_READS.has(key)) {
          seenAllowed.add(key);
        } else {
          unexpected.push(v);
        }
      }
    }

    expect(
      unexpected.map((v) => `${v.file}:${v.line} (${v.enclosingFunction}) .business.${v.method}: ${v.snippet}`),
      'unexpected Business.ownerId query in where clause (use isBusinessOwnerMember / OWNER membership)',
    ).toEqual([]);

    // Pin allowlist non-staleness: every allowlisted entry must still exist.
    expect([...seenAllowed].sort()).toEqual([...ALLOWED_OWNER_ID_BUSINESS_READS].sort());
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

  it('[ORC-03] negative controls (W11SEAM-OWN-3 / W11SEAM-OWN-CR-3): synthetic retired D-104 and redundant D-116 owner-arm shapes are flagged; clean helper & membership checks pass', () => {
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
    const skipTenantShape = `
      async function badSkip(prisma: any, businessId: string, userId: string) {
        return skipTenantIsolation(() => prisma.client.business.findFirst({
          where: { id: businessId, ownerId: userId, members: { some: { userId } } },
        }));
      }
    `;
    const bareCountShape = `
      async function badCount(db: any, businessId: string, userId: string) {
        return db.business.count({ where: { id: businessId, ownerId: userId } });
      }
    `;

    expect(scanSourceForOwnerIdBusinessReads('synthetic/d104.ts', d104Shape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/d104.ts', d104Shape)[0].hasMembersClause).toBe(true);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/d116.ts', d116RedundantShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/or.ts', orArmShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/skip.ts', skipTenantShape)).toHaveLength(1);
    expect(scanSourceForOwnerIdBusinessReads('synthetic/count.ts', bareCountShape)).toHaveLength(1);

    // Gate (b) negative control: a named check that still queries business.findFirst fails inspection.
    const badNamedCheck = inspectNamedOwnerCheck('synthetic/d116.ts', d116RedundantShape, 'badD116', 'helper');
    expect(badNamedCheck.found).toBe(true);
    expect(badNamedCheck.problems.length).toBeGreaterThanOrEqual(2);

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

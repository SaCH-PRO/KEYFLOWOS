/**
 * SWP-READ-SCOPE-CENSUS (P143) — the read-side REST scope census is pinned:
 * docs/reconstruction/REST-READ-SCOPE-CENSUS.md.
 *
 * WHY: SWEEP-P0's write-side census (`rest-scope-census.spec.ts`) covers write verbs and
 * credential-binding starts only, yet two sweep bugs were reads: the webhook list answering
 * signing secrets (BUG-001) and the security audit GET run by STAFF (BUG-065). This spec
 * puts every membership-only `@Get(...)` route under the same AST reader and census discipline:
 * a new membership-only GET route must carry an enforced scope (`@RequireModuleScope` +
 * `ModuleScopeGuard`) or be explicitly accounted for in `REST-READ-SCOPE-CENSUS.md`.
 *
 * WHAT IS READ (TypeScript AST, every non-test `.ts` file under `apps/server/src`: `modules/`,
 * `core/` and the app root): each `@Controller` class, its class-level `@UseGuards`, and per
 * `@Get` handler the method-level `@UseGuards`, `@RequireModuleScope(module, level)` (level
 * defaults to `read`), the handler body, and 1-hop service return expressions for secret-bearing
 * reads.
 *
 * THE POPULATION: a route is a membership-only GET when its verb is `GET`, it runs a member guard
 * (`AuthGuard`, `BusinessGuard`, or `OptionalAuthGuard`), and it does not carry an ENFORCED scope
 * (`@RequireModuleScope` on the handler AND `ModuleScopeGuard` in its guard chain). Public routes
 * (no member guard) are pinned by `core/auth/public-surface.spec.ts` and are not this census.
 *
 * THE DOC: every census table row is `| \`Class.handler\` | GET | \`/path\` | disposition | reason |`.
 * Dispositions:
 *   applied           enforced scope (`module:level` via `@RequireModuleScope` + `ModuleScopeGuard`)
 *                     or per-member scope check (`check:<name>` / `service-check:<name>` + named scope).
 *   exempt-check      handler/service enforces an authority check beyond membership (`check:<name>`
 *                     or `service-check:<name>`).
 *   exempt-guard      dedicated authority guard runs (`guard:<Name>` in route guard chain).
 *   exempt-admin      platform admin read (`guard:AdminGuard` or verified super-admin check).
 *   exempt-owner      owner-only read (`guard:<OwnerGuard>` or verified owner check).
 *   exempt-own        acts on / reads only the caller's own record, own session/device, or
 *                     module-name-only navigation state (zero tenant records/counts/amounts).
 *   exempt-public     optional-auth / public-catalog read returning non-sensitive public data.
 *   exempt-membership intentional business-membership read shared by all members of the business.
 *   exempt-system     system/health/static-metadata read exposing no tenant business records.
 *   exempt-ruled      owner ruling keeps it open (cites `D-<n>`).
 *   open              membership-only today and recorded for a follow-up packet; reason MUST name
 *                     the canonical `<module>:<level>` scope it should require.
 *   secret-read       read touching credentials, tokens, or secrets (reviewed redaction, enforced
 *                     scope, or stop-the-line unprotected secret-read finding for immediate fix).
 *
 * WHAT IS REQUIRED:
 *   RCEN-01  the doc exists and parses; every row is unique, verb is GET, valid disposition, non-empty reason.
 *   RCEN-02  every membership-only GET route has a row in the census doc.
 *   RCEN-03  every row names a real GET route with its exact path, and its disposition matches reality
 *            (enforced/checked `applied`, verified `exempt-check`/`exempt-guard`, canonical `module:level`
 *            on `open`, ruling on `exempt-ruled`, and every AST-detected secret-bearing GET marked `secret-read`).
 *   RCEN-03b expected V1 plan rows (TODAY-AGGREGATE, READY-TO-SEND, CLAIM-LOOP, NAV-B-LEGACY-SERVER) are pinned.
 *   RCEN-04  negative controls: synthetic secret-bearing GET without `secret-read`, unregistered
 *            membership-only GET, stale/phantom row, `open` without scope, fake `applied`, and
 *            fake `exempt-guard` all FAIL the census validator.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { CANONICAL_MODULES } from '../authority/module-vocabulary';

const SRC = resolve(__dirname, '../..');
const REPO = resolve(SRC, '../../..');
const CENSUS = join(REPO, 'docs/reconstruction/REST-READ-SCOPE-CENSUS.md');

const MEMBER_GUARDS = ['AuthGuard', 'BusinessGuard', 'OptionalAuthGuard'];
const CANONICAL_MODULE_SET: ReadonlySet<string> = new Set(CANONICAL_MODULES);
const DISPOSITIONS = new Set([
  'applied',
  'exempt-check',
  'exempt-guard',
  'exempt-admin',
  'exempt-owner',
  'exempt-own',
  'exempt-public',
  'exempt-membership',
  'exempt-system',
  'exempt-ruled',
  'open',
  'secret-read',
]);

/** Property names that indicate an unmasked secret or bearer token returned in a GET response. */
const SECRET_FIELD_NAME =
  /^(signingSecret|webhookSecret|clientSecret|apiKey|privateKey|secretKey|passwordHash|password|accessToken|refreshToken|authToken|encryptedCredentials|accessTokenEncrypted|refreshTokenEncrypted|stripeSecretKey|stripeWebhookSecret|paypalClientSecret|wipayApiKey|byokOpenai|byokAnthropic|byokXai|byokKimi|byokGoogle|byokNative|secret|token|previewToken)$/i;

/** Prisma delegates whose raw rows contain secrets or bearer tokens if returned without a `select` projection. */
const RAW_SECRET_DELEGATE =
  /\.(portalAccess|webhook|socialConnection|channelConnection|channelDestination|supplierConnection|bankConnection|integrationConnection|connectorAccount)\s*\.\s*(findUnique|findFirst|findMany|findUniqueOrThrow|findFirstOrThrow)\s*\(/;

interface ParsedFile {
  file: string;
  text: string;
  sf: ts.SourceFile;
}

interface GetRoute {
  key: string;
  file: string;
  verb: 'GET';
  path: string;
  guards: string[];
  scope?: { module: string; minLevel: string };
  body: string;
  /** Secret/token property names or raw secret-bearing Prisma delegates directly or 1-hop returned. */
  secretSignals: string[];
}

interface CensusRow {
  key: string;
  verb: string;
  path: string;
  disposition: string;
  reason: string;
  line: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const unquote = (s: string): string => s.replace(/^['"`]|['"`]$/g, '');

let parsedCache: ParsedFile[] | null = null;
function parsedServerFiles(): ParsedFile[] {
  parsedCache ??= walk(SRC).map((file) => {
    const text = readFileSync(file, 'utf8');
    return { file, text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
  });
  return parsedCache;
}

function collectReturnedSecretSignals(body: ts.Block | undefined, sf: ts.SourceFile): string[] {
  const found = new Set<string>();
  if (!body) return [];

  const scanExpression = (expr: ts.Node): void => {
    if (ts.isPropertyAssignment(expr)) {
      const propName =
        ts.isIdentifier(expr.name) || ts.isStringLiteral(expr.name) ? expr.name.text : '';
      if (SECRET_FIELD_NAME.test(propName)) {
        const initText = expr.initializer.getText(sf).trim();
        // Explicit masking (`••••`, `****`), boolean checks (`!!x`), or literal null/undefined/boolean are safe.
        const isMasked = /•|\*{3,}|^!{1,2}|^null$|^undefined$|^false$|^true$/.test(initText);
        if (!isMasked) found.add(propName);
      }
    } else if (ts.isShorthandPropertyAssignment(expr)) {
      if (SECRET_FIELD_NAME.test(expr.name.text)) found.add(expr.name.text);
    }
    ts.forEachChild(expr, scanExpression);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      scanExpression(node.expression);
      const retText = node.expression.getText(sf);
      if (RAW_SECRET_DELEGATE.test(retText) && !/\bselect\s*:/.test(retText)) {
        const match = RAW_SECRET_DELEGATE.exec(retText);
        if (match) found.add(`raw:${match[1]}`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return [...found].sort();
}

function extractGetRoutes(files: ParsedFile[], rootDir = SRC): GetRoute[] {
  const methodAst = new Map<string, { body: ts.Block; sf: ts.SourceFile }>();
  for (const { sf } of files) {
    for (const stmt of sf.statements) {
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const className = stmt.name.getText(sf);
      for (const member of stmt.members) {
        if (ts.isMethodDeclaration(member) && member.body) {
          methodAst.set(`${className}.${member.name.getText(sf)}`, { body: member.body, sf });
        }
      }
    }
  }

  const out: GetRoute[] = [];
  for (const { file, text, sf } of files) {
    if (!text.includes('@Controller')) continue;
    const decoratorsOf = (n: ts.Node): readonly ts.Decorator[] =>
      ts.canHaveDecorators(n) ? (ts.getDecorators(n) ?? []) : [];
    const decName = (d: ts.Decorator): string =>
      ts.isCallExpression(d.expression) ? d.expression.expression.getText(sf) : d.expression.getText(sf);
    const decArgs = (d: ts.Decorator): string[] =>
      ts.isCallExpression(d.expression) ? d.expression.arguments.map((a) => a.getText(sf)) : [];

    for (const stmt of sf.statements) {
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const classDecs = decoratorsOf(stmt);
      const controller = classDecs.find((d) => decName(d) === 'Controller');
      if (!controller) continue;
      const prefix = unquote(decArgs(controller)[0] ?? '');
      const classGuards = classDecs.filter((d) => decName(d) === 'UseGuards').flatMap(decArgs);

      const propTypes: Record<string, string> = {};
      for (const m of stmt.members) {
        if (ts.isConstructorDeclaration(m)) {
          for (const param of m.parameters) {
            if (param.type && ts.isIdentifier(param.name)) {
              propTypes[param.name.text] = param.type.getText(sf);
            }
          }
        }
      }

      for (const member of stmt.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const ds = decoratorsOf(member);
        const getDec = ds.find((d) => decName(d) === 'Get');
        if (!getDec) continue;

        const guards = [...classGuards, ...ds.filter((d) => decName(d) === 'UseGuards').flatMap(decArgs)];
        const scopeDec = ds.find((d) => decName(d) === 'RequireModuleScope');
        const scopeArgs = scopeDec ? decArgs(scopeDec).map(unquote) : [];
        const scope = scopeDec ? { module: scopeArgs[0], minLevel: scopeArgs[1] ?? 'read' } : undefined;
        const path = '/' + [prefix, unquote(decArgs(getDec)[0] ?? '')].filter(Boolean).join('/');
        const bodyText = member.body?.getText(sf) ?? '';

        const directSecrets = collectReturnedSecretSignals(member.body, sf);
        const viaServiceSecrets = new Set<string>();
        for (const callMatch of bodyText.matchAll(/this\.(\w+)\.(\w+)\s*\(/g)) {
          const serviceType = propTypes[callMatch[1]];
          const target = serviceType ? methodAst.get(`${serviceType}.${callMatch[2]}`) : undefined;
          if (target) {
            for (const sig of collectReturnedSecretSignals(target.body, target.sf)) {
              viaServiceSecrets.add(sig);
            }
          }
        }

        out.push({
          key: `${stmt.name.getText(sf)}.${member.name.getText(sf)}`,
          file: relative(rootDir, file),
          verb: 'GET',
          path,
          guards,
          scope,
          body: bodyText,
          secretSignals: [...new Set([...directSecrets, ...viaServiceSecrets])].sort(),
        });
      }
    }
  }
  return out;
}

const isEnforced = (r: GetRoute): boolean => !!r.scope && r.guards.includes('ModuleScopeGuard');
const isMemberRoute = (r: GetRoute): boolean => r.guards.some((g) => MEMBER_GUARDS.includes(g));
const membershipOnlyGets = (allGets: GetRoute[]): GetRoute[] =>
  allGets.filter((r) => isMemberRoute(r) && !isEnforced(r));

function parseCensusRows(markdown: string): CensusRow[] {
  const rows: CensusRow[] = [];
  markdown.split('\n').forEach((line, index) => {
    const m =
      /^\|\s*`([A-Za-z0-9_]+\.[A-Za-z0-9_]+)`\s*\|\s*([A-Z]+)\s*\|\s*`?([^|`]*)`?\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*$/.exec(
        line,
      );
    if (m) {
      rows.push({
        key: m[1],
        verb: m[2],
        path: m[3].trim(),
        disposition: m[4],
        reason: m[5],
        line: index + 1,
      });
    }
  });
  return rows;
}

interface CensusValidationResult {
  schemaProblems: string[];
  missingRoutes: string[];
  realityProblems: string[];
  secretReadProblems: string[];
}

function validateReadCensus(
  allGets: GetRoute[],
  rows: CensusRow[],
  moduleSourceOf: (file: string) => string,
): CensusValidationResult {
  const byKey = new Map(allGets.map((r) => [r.key, r]));
  const population = membershipOnlyGets(allGets);
  const inPopulation = new Set(population.map((r) => r.key));
  const rowByKey = new Map<string, CensusRow>();

  const schemaProblems: string[] = [];
  const missingRoutes: string[] = [];
  const realityProblems: string[] = [];
  const secretReadProblems: string[] = [];

  for (const row of rows) {
    if (rowByKey.has(row.key)) {
      schemaProblems.push(`line ${row.line}: ${row.key} is listed twice`);
    }
    rowByKey.set(row.key, row);
    if (row.verb !== 'GET') {
      schemaProblems.push(`line ${row.line}: ${row.key} has verb ${row.verb}, expected GET`);
    }
    if (!DISPOSITIONS.has(row.disposition)) {
      schemaProblems.push(`line ${row.line}: ${row.key} has unknown disposition ${row.disposition}`);
    }
    if (!row.reason.trim()) {
      schemaProblems.push(`line ${row.line}: ${row.key} gives no reason`);
    }
  }

  // RCEN-02: every membership-only GET must have a row in the census.
  for (const r of population) {
    if (!rowByKey.has(r.key)) {
      missingRoutes.push(`${r.key} (${r.verb} ${r.path}, ${r.file})`);
    }
  }

  // RCEN-03: every row must name a real GET route and match reality.
  const verifyChecks = (row: CensusRow, route: GetRoute): boolean => {
    const handlerChecks = [...row.reason.matchAll(/(?<![a-z-])check:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    const serviceChecks = [...row.reason.matchAll(/service-check:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    if (!handlerChecks.length && !serviceChecks.length) return false;
    for (const c of handlerChecks) {
      if (!new RegExp(`\\b${c}\\b`).test(route.body)) {
        realityProblems.push(`line ${row.line}: ${row.key} does not use check:${c}`);
      }
    }
    for (const c of serviceChecks) {
      if (!new RegExp(`\\b${c}\\b`).test(moduleSourceOf(route.file))) {
        realityProblems.push(`line ${row.line}: ${row.key}'s module defines no service-check:${c}`);
      }
    }
    return true;
  };

  for (const row of rows) {
    const route = byKey.get(row.key);
    if (!route) {
      realityProblems.push(`line ${row.line}: ${row.key} is not a real GET route`);
      continue;
    }
    if (route.verb !== row.verb || route.path !== row.path) {
      realityProblems.push(
        `line ${row.line}: ${row.key} is ${route.verb} ${route.path}, not ${row.verb} ${row.path}`,
      );
    }

    const mustStayUnenforced = row.disposition !== 'applied' && row.disposition !== 'secret-read';
    if (mustStayUnenforced && !inPopulation.has(row.key)) {
      realityProblems.push(
        `line ${row.line}: ${row.key} (${row.disposition}) now carries an enforced scope: move it to applied or drop it`,
      );
    }

    if (row.disposition === 'applied') {
      const namedScopes = [...row.reason.matchAll(/`?\b([a-z]+):(read|write|admin)\b`?/g)].filter((m) =>
        CANONICAL_MODULE_SET.has(m[1]),
      );
      if (!namedScopes.length) {
        realityProblems.push(`line ${row.line}: ${row.key} (applied) names no canonical module:level scope`);
        continue;
      }
      if (isEnforced(route)) {
        const matchesEnforced = namedScopes.some(
          (m) => route.scope?.module === m[1] && route.scope?.minLevel === m[2],
        );
        if (!matchesEnforced) {
          realityProblems.push(
            `line ${row.line}: ${row.key} carries ${route.scope?.module}:${route.scope?.minLevel}, not ${namedScopes.map((m) => `${m[1]}:${m[2]}`).join(', ')}`,
          );
        }
      } else {
        const hasVerifiedCheck = verifyChecks(row, route);
        if (!hasVerifiedCheck) {
          realityProblems.push(
            `line ${row.line}: ${row.key} (applied) has no enforced @RequireModuleScope+ModuleScopeGuard and names no check:<name> or service-check:<name>`,
          );
        }
      }
    } else if (row.disposition === 'exempt-check') {
      const hasChecks = verifyChecks(row, route);
      if (!hasChecks) {
        realityProblems.push(`line ${row.line}: ${row.key} (exempt-check) names no check:<name> or service-check:<name>`);
      }
    } else if (row.disposition === 'exempt-guard') {
      const guards = [...row.reason.matchAll(/guard:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      if (!guards.length) {
        realityProblems.push(`line ${row.line}: ${row.key} (exempt-guard) names no guard:<Name>`);
      } else {
        for (const g of guards) {
          if (!route.guards.includes(g)) {
            realityProblems.push(`line ${row.line}: ${row.key} does not run guard:${g}`);
          }
        }
      }
    } else if (row.disposition === 'exempt-admin' || row.disposition === 'exempt-owner') {
      const guards = [...row.reason.matchAll(/guard:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      for (const g of guards) {
        if (!route.guards.includes(g)) {
          realityProblems.push(`line ${row.line}: ${row.key} does not run guard:${g}`);
        }
      }
      const hasCheckTag = /(?<![a-z-])check:|service-check:/.test(row.reason);
      if (hasCheckTag) verifyChecks(row, route);
      if (!guards.length && !hasCheckTag) {
        realityProblems.push(
          `line ${row.line}: ${row.key} (${row.disposition}) must cite guard:<Name>, check:<name>, or service-check:<name>`,
        );
      }
    } else if (row.disposition === 'exempt-ruled') {
      if (!/\bD-\d+\b/.test(row.reason)) {
        realityProblems.push(`line ${row.line}: ${row.key} (exempt-ruled) cites no owner ruling (D-<n>)`);
      }
    } else if (row.disposition === 'open') {
      const canonicalScopes = [...row.reason.matchAll(/`?\b([a-z]+):(read|write|admin)\b`?/g)].filter((m) =>
        CANONICAL_MODULE_SET.has(m[1]),
      );
      if (!canonicalScopes.length) {
        realityProblems.push(
          `line ${row.line}: ${row.key} (open) must explicitly name the canonical module:level scope it should need`,
        );
      }
    } else if (row.disposition === 'secret-read') {
      const leadingScope = /^`?([a-z]+):(read|write|admin)`?/.exec(row.reason);
      if (leadingScope && CANONICAL_MODULE_SET.has(leadingScope[1])) {
        if (!isEnforced(route) || route.scope?.module !== leadingScope[1] || route.scope?.minLevel !== leadingScope[2]) {
          realityProblems.push(
            `line ${row.line}: ${row.key} (secret-read) carries ${route.scope ? `${route.scope.module}:${route.scope.minLevel}` : 'no scope'}${isEnforced(route) ? '' : ' (not enforced)'}, not ${leadingScope[1]}:${leadingScope[2]}`,
          );
        }
      }
      if (/(?<![a-z-])check:|service-check:/.test(row.reason)) {
        verifyChecks(row, route);
      }
    }
  }

  // Secret-read invariant: any membership-only GET whose AST returns an unmasked secret/token
  // field or raw secret-bearing Prisma delegate MUST be classified as `secret-read`.
  for (const r of population) {
    if (r.secretSignals.length === 0) continue;
    const row = rowByKey.get(r.key);
    if (!row || row.disposition !== 'secret-read') {
      secretReadProblems.push(
        `${r.key} (${r.path}) exposes secret/token signal [${r.secretSignals.join(', ')}] without a secret-read row (found: ${row?.disposition ?? 'missing'})`,
      );
    }
  }

  return { schemaProblems, missingRoutes, realityProblems, secretReadProblems };
}

describe('REST read-side scope census (SWP-READ-SCOPE-CENSUS)', () => {
  const allGets = extractGetRoutes(parsedServerFiles());
  const byKey = new Map(allGets.map((r) => [r.key, r]));
  const population = membershipOnlyGets(allGets);

  const moduleSourceCache = new Map<string, string>();
  const moduleSourceOf = (file: string): string => {
    const dir = join(SRC, file.split('/').slice(0, 2).join('/'));
    if (!moduleSourceCache.has(dir)) {
      moduleSourceCache.set(
        dir,
        walk(dir)
          .map((f) => readFileSync(f, 'utf8'))
          .join('\n'),
      );
    }
    return moduleSourceCache.get(dir)!;
  };

  it('the AST reader sees the GET controllers (guards the guard)', () => {
    expect(allGets.length).toBeGreaterThan(800);
    expect(population.length).toBeGreaterThan(400);
    // Enforced GETs are recognized and excluded from the membership-only population
    expect(byKey.get('CommerceController.listPaymentClaims')?.scope).toEqual({
      module: 'revenue',
      minLevel: 'write',
    });
    expect(isEnforced(byKey.get('CommerceController.listPaymentClaims')!)).toBe(true);
    // Core controllers outside modules/ are included
    expect(byKey.get('ConnectorController.getCredentials')?.file).toBe('core/connectors/connector.controller.ts');
    // Expected V1 plan reads are visible
    expect(byKey.get('TodayController.getToday')?.path).toBe('/business-command-center/businesses/:businessId/today');
    expect(byKey.get('ReadyToSendController.listDue')?.path).toBe('/commerce/businesses/:businessId/ready-to-send');
    expect(byKey.get('IdentityController.getLegacyModules')?.path).toBe('/identity/businesses/:businessId/legacy-modules');
  });

  it('[RCEN-01] docs/reconstruction/REST-READ-SCOPE-CENSUS.md exists and parses cleanly with strict schema validation', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const rows = parseCensusRows(readFileSync(CENSUS, 'utf8'));
    expect(rows.length).toBeGreaterThanOrEqual(population.length);
    const { schemaProblems } = validateReadCensus(allGets, rows, moduleSourceOf);
    expect(schemaProblems).toEqual([]);
  });

  it('[RCEN-02] every membership-only GET route has an exact row in REST-READ-SCOPE-CENSUS.md', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const rows = parseCensusRows(readFileSync(CENSUS, 'utf8'));
    const { missingRoutes } = validateReadCensus(allGets, rows, moduleSourceOf);
    expect(missingRoutes).toEqual([]);
  });

  it('[RCEN-03] every row names a real GET route and its disposition matches codebase reality (including secret-read invariant)', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const rows = parseCensusRows(readFileSync(CENSUS, 'utf8'));
    const { realityProblems, secretReadProblems } = validateReadCensus(allGets, rows, moduleSourceOf);
    expect(realityProblems).toEqual([]);
    expect(secretReadProblems).toEqual([]);
  });

  it('[RCEN-03b] expected V1 plan rows are pinned accurately', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const rows = new Map(parseCensusRows(readFileSync(CENSUS, 'utf8')).map((r) => [r.key, r]));

    const today = rows.get('TodayController.getToday');
    expect(today?.disposition).toBe('applied');
    expect(today?.reason).toMatch(/revenue:read/);

    const readyToSend = rows.get('ReadyToSendController.listDue');
    expect(readyToSend?.disposition).toBe('applied');
    expect(readyToSend?.reason).toMatch(/revenue:read/);
    expect(readyToSend?.reason).toMatch(/bookings:read/);

    const claims = rows.get('CommerceController.listPaymentClaims');
    expect(claims?.disposition).toBe('applied');
    expect(claims?.reason).toMatch(/revenue:write/);

    const legacyModules = rows.get('IdentityController.getLegacyModules');
    expect(legacyModules?.disposition).toBe('exempt-own');
  });

  it('[RCEN-04] negative controls: synthetic secret-bearing GET without secret-read, unregistered GET, stale row, and bogus dispositions all FAIL', () => {
    const synthFile = join(SRC, 'modules/synthetic-rcen04/synthetic-rcen04.controller.ts');
    const synthSource = `
import { Controller, Get, Param, UseGuards } from '@nestjs/common';

@Controller('synthetic')
@UseGuards(AuthGuard, BusinessGuard)
export class SyntheticReadController {
  @Get('businesses/:businessId/webhook-secret')
  getWebhookSecret(@Param('businessId') businessId: string) {
    return { businessId, signingSecret: 'whsec_live_123', apiKey: 'kf_live_456', webhookSecret: 'wh_789' };
  }

  @Get('businesses/:businessId/raw-secrets')
  getRawSecrets(@Param('businessId') businessId: string) {
    return this.prisma.client.webhook.findMany({ where: { businessId } });
  }

  @Get('businesses/:businessId/unregistered-data')
  getUnregisteredData(@Param('businessId') businessId: string) {
    return { businessId, items: [] };
  }

  @Get('businesses/:businessId/open-data')
  getOpenData(@Param('businessId') businessId: string) {
    return { businessId, total: 42 };
  }
}
`;
    const parsedSynth: ParsedFile[] = [
      {
        file: synthFile,
        text: synthSource,
        sf: ts.createSourceFile(synthFile, synthSource, ts.ScriptTarget.Latest, true),
      },
    ];
    const synthRoutes = extractGetRoutes(parsedSynth, SRC);
    expect(synthRoutes).toHaveLength(4);
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getWebhookSecret')?.secretSignals).toEqual([
      'apiKey',
      'signingSecret',
      'webhookSecret',
    ]);
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getRawSecrets')?.secretSignals).toEqual([
      'raw:webhook',
    ]);

    const synthModuleSource = () => synthSource;

    // 1. Secret-bearing GETs misclassified as `open` or `exempt-own` (or missing) MUST fail secretReadProblems.
    const badSecretCensus = parseCensusRows(`
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | open | settings:read follow-up |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | exempt-own | caller owns business |
| \`SyntheticReadController.getOpenData\` | GET | \`/synthetic/businesses/:businessId/open-data\` | open | missing scope name |
| \`SyntheticReadController.phantomRoute\` | GET | \`/synthetic/businesses/:businessId/gone\` | open | revenue:read |
`);
    const badResult = validateReadCensus(synthRoutes, badSecretCensus, synthModuleSource);

    // Negative control 1: secret-bearing GET without `secret-read` FAILS
    expect(badResult.secretReadProblems).toHaveLength(2);
    expect(badResult.secretReadProblems[0]).toContain('SyntheticReadController.getWebhookSecret');
    expect(badResult.secretReadProblems[1]).toContain('SyntheticReadController.getRawSecrets');

    // Negative control 2: unregistered membership-only GET FAILS
    expect(badResult.missingRoutes).toHaveLength(1);
    expect(badResult.missingRoutes[0]).toContain('SyntheticReadController.getUnregisteredData');

    // Negative control 3: stale/phantom row AND `open` row without canonical module:level FAIL
    expect(badResult.realityProblems.some((p) => p.includes('phantomRoute') && p.includes('not a real GET route'))).toBe(
      true,
    );
    expect(badResult.realityProblems.some((p) => p.includes('getOpenData') && p.includes('canonical module:level'))).toBe(
      true,
    );

    // Negative control 4: fake `applied` and fake `exempt-guard` FAIL
    const fakeGateCensus = parseCensusRows(`
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | secret-read | stop-the-line secret read |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | secret-read | stop-the-line raw webhook read |
| \`SyntheticReadController.getUnregisteredData\` | GET | \`/synthetic/businesses/:businessId/unregistered-data\` | applied | revenue:read (claimed without guard or check) |
| \`SyntheticReadController.getOpenData\` | GET | \`/synthetic/businesses/:businessId/open-data\` | exempt-guard | guard:AdminGuard (not on route) |
`);
    const fakeGateResult = validateReadCensus(synthRoutes, fakeGateCensus, synthModuleSource);
    expect(fakeGateResult.secretReadProblems).toEqual([]);
    expect(fakeGateResult.missingRoutes).toEqual([]);
    expect(fakeGateResult.realityProblems.some((p) => p.includes('getUnregisteredData') && p.includes('applied'))).toBe(
      true,
    );
    expect(fakeGateResult.realityProblems.some((p) => p.includes('getOpenData') && p.includes('guard:AdminGuard'))).toBe(
      true,
    );

    // Control passes cleanly when every row is honest and valid
    const validCensus = parseCensusRows(`
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | secret-read | stop-the-line finding: returns signingSecret, apiKey, webhookSecret |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | secret-read | stop-the-line finding: returns raw webhook rows |
| \`SyntheticReadController.getUnregisteredData\` | GET | \`/synthetic/businesses/:businessId/unregistered-data\` | open | crm:read follow-up |
| \`SyntheticReadController.getOpenData\` | GET | \`/synthetic/businesses/:businessId/open-data\` | open | revenue:read follow-up |
`);
    const validResult = validateReadCensus(synthRoutes, validCensus, synthModuleSource);
    expect(validResult.schemaProblems).toEqual([]);
    expect(validResult.missingRoutes).toEqual([]);
    expect(validResult.realityProblems).toEqual([]);
    expect(validResult.secretReadProblems).toEqual([]);
  });
});

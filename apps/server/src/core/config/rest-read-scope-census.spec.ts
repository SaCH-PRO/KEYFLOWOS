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
 * defaults to `read`), the handler body, and 1-hop service bodies for secret-bearing reads.
 *
 * THE POPULATION: a route is a membership-only GET when its verb is `GET`, it runs a member guard
 * (`AuthGuard`, `BusinessGuard`, or `OptionalAuthGuard`), and it does not carry an ENFORCED scope
 * (`@RequireModuleScope` on the handler AND `ModuleScopeGuard` in its guard chain). Public routes
 * (no member guard) are pinned by `core/auth/public-surface.spec.ts` and are not this census.
 *
 * THE DOC: every census table row is `| \`Class.handler\` | GET | \`/path\` | disposition | reason |`.
 * Table parsing is FAIL-CLOSED: any non-header, non-separator pipe line outside the 2-column
 * Disposition summary table that fails the strict row grammar is recorded in `schemaProblems`
 * (failing RCEN-01 rather than being silently skipped).
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
 *   RCEN-01  the doc exists and parses fail-closed; every row is unique, verb is GET, valid disposition,
 *            non-empty reason, zero malformed table rows.
 *   RCEN-02  every membership-only GET route has a row in the census doc.
 *   RCEN-03  every row names a real GET route with its exact path, and its disposition matches reality
 *            (enforced/checked `applied`, verified `exempt-check`/`exempt-guard`, canonical `module:level`
 *            on `open`, ruling on `exempt-ruled`, and every AST-detected secret-bearing GET marked `secret-read`).
 *   RCEN-03b expected V1 plan rows (TODAY-AGGREGATE, READY-TO-SEND, CLAIM-LOOP, NAV-B-LEGACY-SERVER) are pinned.
 *   RCEN-04  negative controls: synthetic secret-bearing GETs (direct literal, variable-assigned secret
 *            object with `authData`, variable-assigned raw `portalAccess.findMany` even with nested
 *            `include: { ...: { select } }`), malformed/duplicate/non-GET/unknown-disposition/empty-reason
 *            table rows, unregistered GET, stale/phantom row, `open` without scope, fake `applied`, and
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

/** Property names that indicate an unmasked secret, credential, or bearer token returned in a GET response. */
const SECRET_FIELD_NAME =
  /^(signingSecret|webhookSecret|clientSecret|apiKey|privateKey|secretKey|passwordHash|password|accessToken|refreshToken|authToken|encryptedCredentials|accessTokenEncrypted|refreshTokenEncrypted|stripeSecretKey|stripeWebhookSecret|paypalClientSecret|wipayApiKey|byokOpenai|byokAnthropic|byokXai|byokKimi|byokGoogle|byokNative|authData|authDataRef|credentials|secret|token|previewToken)$/i;

/** Prisma delegates whose raw rows contain secrets or bearer tokens if queried without a top-level `select`. */
const RAW_SECRET_DELEGATES = new Set([
  'portalAccess',
  'webhook',
  'socialConnection',
  'channelConnection',
  'channelDestination',
  'supplierConnection',
  'bankConnection',
  'integrationConnection',
  'connectorAccount',
]);

const PRISMA_READ_METHODS = new Set([
  'findUnique',
  'findFirst',
  'findMany',
  'findUniqueOrThrow',
  'findFirstOrThrow',
]);

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
  /** Secret/token property names or raw secret-bearing Prisma delegates directly or 1-hop read/returned. */
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

interface ParsedCensus {
  rows: CensusRow[];
  parseProblems: string[];
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

/** Relation field names (singular and plural) mapping back to secret-bearing Prisma delegates for nested `include:` detection. */
const SECRET_RELATION_TO_DELEGATE: ReadonlyMap<string, string> = new Map(
  [...RAW_SECRET_DELEGATES].flatMap((d) => [
    [d, d],
    [`${d}s`, d],
    [`${d}es`, d],
  ]),
);

/** True only when an object literal carries a top-level `select` key. */
function objHasTopLevelSelect(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ((ts.isIdentifier(p.name) && p.name.text === 'select') ||
        (ts.isStringLiteral(p.name) && p.name.text === 'select')),
  );
}

/** True only when the Prisma find call's own options object literal carries a top-level `select` key. */
function hasTopLevelSelect(callExpr: ts.CallExpression): boolean {
  const firstArg = callExpr.arguments[0];
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return false;
  return objHasTopLevelSelect(firstArg);
}

function collectReturnedSecretSignals(body: ts.Block | undefined, sf: ts.SourceFile): string[] {
  const found = new Set<string>();
  if (!body) return [];

  const scanObjectProps = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const propName =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (SECRET_FIELD_NAME.test(propName)) {
        const initText = node.initializer.getText(sf).trim();
        // Explicit masking (`••••`, `****`), boolean checks (`!!x`), or literal null/undefined/boolean are safe.
        const isMasked = /•|\*{3,}|^!{1,2}|^null$|^undefined$|^false$|^true$/.test(initText);
        if (!isMasked) found.add(propName);
      }
    } else if (ts.isShorthandPropertyAssignment(node)) {
      if (SECRET_FIELD_NAME.test(node.name.text)) found.add(node.name.text);
    }
    ts.forEachChild(node, scanObjectProps);
  };

  // Track variable declarations so `const out = { authData: c.authData }; return out;` is detected.
  const varInits = new Map<string, ts.Expression>();
  const collectVars = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      varInits.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectVars);
  };
  collectVars(body);

  const unwrap = (e: ts.Expression): ts.Expression => (ts.isAwaitExpression(e) ? e.expression : e);

  const visit = (node: ts.Node): void => {
    // Detect ANY call to a secret-bearing Prisma delegate in the body lacking a top-level `select:`
    // (catches direct returns, variable assignments, Promise.all destructuring, and nested `include: { rel: { select } }`).
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (PRISMA_READ_METHODS.has(method)) {
        const recv = node.expression.expression;
        const delegateName = ts.isPropertyAccessExpression(recv)
          ? recv.name.text
          : ts.isIdentifier(recv)
            ? recv.text
            : '';
        if (RAW_SECRET_DELEGATES.has(delegateName) && !hasTopLevelSelect(node)) {
          found.add(`raw:${delegateName}`);
        }
      }
    }

    // Detect nested Prisma `include: { <secretRelation>: true }` or `include: { <secretRelation>: { ...without top-level select } }`
    // at any nesting depth (e.g. `include: { supplierProduct: { include: { supplierConnection: true } } }`).
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (key === 'include' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const relName =
            ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
          const delegate = SECRET_RELATION_TO_DELEGATE.get(relName);
          if (!delegate) continue;
          if (
            prop.initializer.kind === ts.SyntaxKind.TrueKeyword ||
            (ts.isObjectLiteralExpression(prop.initializer) && !objHasTopLevelSelect(prop.initializer))
          ) {
            found.add(`include:${delegate}`);
          }
        }
      }
    }

    if (ts.isReturnStatement(node) && node.expression) {
      scanObjectProps(node.expression);
      const ret = unwrap(node.expression);
      if (ts.isIdentifier(ret) && varInits.has(ret.text)) {
        scanObjectProps(varInits.get(ret.text)!);
      } else if (ts.isObjectLiteralExpression(ret)) {
        for (const prop of ret.properties) {
          if (ts.isShorthandPropertyAssignment(prop) && varInits.has(prop.name.text)) {
            scanObjectProps(varInits.get(prop.name.text)!);
          } else if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.initializer) &&
            varInits.has(prop.initializer.text)
          ) {
            scanObjectProps(varInits.get(prop.initializer.text)!);
          }
        }
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

const SUMMARY_TABLE_HEADER = /^\|\s*Disposition\s*\|\s*Count\s*\|\s*$/i;
const ROUTE_TABLE_HEADER = /^\|\s*route\s*\|\s*verb\s*\|\s*path\s*\|\s*disposition\s*\|\s*reason\s*\|\s*$/i;
const TABLE_SEPARATOR = /^\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const SUMMARY_TABLE_ROW = /^\|\s*[a-z-]+\s*\|\s*\d+\s*\|\s*$/;
const ROUTE_TABLE_ROW =
  /^\|\s*`([A-Za-z0-9_]+\.[A-Za-z0-9_]+)`\s*\|\s*([A-Z]+)\s*\|\s*`?([^|`]*)`?\s*\|\s*([a-z-]+)\s*\|\s*([^|]*)\s*\|\s*$/;

/**
 * Fail-closed markdown route table parser:
 * - Recognizes the 2-column Summary table (`| Disposition | Count |`) and skips its separator/numeric rows.
 * - Recognizes 5-column route table headers (`| route | verb | path | disposition | reason |`) and separators.
 * - Any other pipe-delimited line MUST match `ROUTE_TABLE_ROW` cleanly; otherwise an explicit error is
 *   recorded in `parseProblems` so typos (e.g. `OPEN`, `exempt_own`, missing backticks, wrong column count,
 *   unescaped `|` inside cells) fail RCEN-01 instead of silently disappearing.
 */
function parseCensus(markdown: string): ParsedCensus {
  const rows: CensusRow[] = [];
  const parseProblems: string[] = [];
  let inSummaryTable = false;

  markdown.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      inSummaryTable = false;
      return;
    }
    if (SUMMARY_TABLE_HEADER.test(line)) {
      inSummaryTable = true;
      return;
    }
    if (ROUTE_TABLE_HEADER.test(line)) {
      inSummaryTable = false;
      return;
    }
    if (TABLE_SEPARATOR.test(line)) {
      return;
    }
    if (inSummaryTable) {
      if (!SUMMARY_TABLE_ROW.test(line)) {
        parseProblems.push(`line ${index + 1}: malformed summary table row: ${line}`);
      }
      return;
    }

    const m = ROUTE_TABLE_ROW.exec(line);
    if (!m) {
      parseProblems.push(`line ${index + 1}: malformed route table row: ${line}`);
      return;
    }
    rows.push({
      key: m[1],
      verb: m[2],
      path: m[3].trim(),
      disposition: m[4],
      reason: m[5],
      line: index + 1,
    });
  });

  return { rows, parseProblems };
}

interface CensusValidationResult {
  schemaProblems: string[];
  missingRoutes: string[];
  realityProblems: string[];
  secretReadProblems: string[];
}

function validateReadCensus(
  allGets: GetRoute[],
  parsed: ParsedCensus,
  moduleSourceOf: (file: string) => string,
): CensusValidationResult {
  const { rows, parseProblems } = parsed;
  const byKey = new Map(allGets.map((r) => [r.key, r]));
  const population = membershipOnlyGets(allGets);
  const inPopulation = new Set(population.map((r) => r.key));
  const rowByKey = new Map<string, CensusRow>();

  const schemaProblems: string[] = [...parseProblems];
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

  // Secret-read invariant: any membership-only GET whose AST reads/returns an unmasked secret/token
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

  it('[RCEN-01] docs/reconstruction/REST-READ-SCOPE-CENSUS.md exists and parses cleanly with fail-closed schema validation', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const parsed = parseCensus(readFileSync(CENSUS, 'utf8'));
    expect(parsed.rows.length).toBeGreaterThanOrEqual(population.length);
    const { schemaProblems } = validateReadCensus(allGets, parsed, moduleSourceOf);
    expect(schemaProblems).toEqual([]);
  });

  it('[RCEN-02] every membership-only GET route has an exact row in REST-READ-SCOPE-CENSUS.md', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const parsed = parseCensus(readFileSync(CENSUS, 'utf8'));
    const { missingRoutes } = validateReadCensus(allGets, parsed, moduleSourceOf);
    expect(missingRoutes).toEqual([]);
  });

  it('[RCEN-03] every row names a real GET route and its disposition matches codebase reality (including secret-read invariant)', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const parsed = parseCensus(readFileSync(CENSUS, 'utf8'));
    const { realityProblems, secretReadProblems } = validateReadCensus(allGets, parsed, moduleSourceOf);
    expect(realityProblems).toEqual([]);
    expect(secretReadProblems).toEqual([]);
  });

  it('[RCEN-03b] expected V1 plan rows are pinned accurately', () => {
    expect(existsSync(CENSUS), `missing census doc: ${CENSUS}`).toBe(true);
    const rows = new Map(parseCensus(readFileSync(CENSUS, 'utf8')).rows.map((r) => [r.key, r]));

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

  it('[RCEN-04] negative controls: synthetic secret-bearing GETs, malformed/invalid schema rows, unregistered GET, stale row, and bogus dispositions all FAIL', () => {
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
  async getRawSecrets(@Param('businessId') businessId: string) {
    const rows = await this.prisma.client.portalAccess.findMany({
      where: { businessId },
      include: { business: { select: { id: true } } },
    });
    return rows;
  }

  @Get('businesses/:businessId/var-auth-data')
  getVarAuthData(@Param('businessId') businessId: string) {
    const c = { authData: { token: 'live_secret' }, authDataRef: 'ref_1' };
    const out = { businessId, authData: c.authData, authDataRef: c.authDataRef };
    return out;
  }

  @Get('businesses/:businessId/nested-include')
  getNestedInclude(@Param('businessId') businessId: string) {
    return this.prisma.client.supplierProduct.findMany({
      where: { businessId },
      include: { supplierConnection: true },
    });
  }

  @Get('businesses/:businessId/deep-nested-include')
  getDeepNestedInclude(@Param('businessId') businessId: string) {
    return this.prisma.client.productSourceLink.findMany({
      where: { businessId },
      include: { supplierProduct: { include: { supplierConnection: true } } },
    });
  }

  @Get('businesses/:businessId/safe-nested-select')
  getSafeNestedSelect(@Param('businessId') businessId: string) {
    return this.prisma.client.supplierProduct.findMany({
      where: { businessId },
      include: { supplierConnection: { select: { id: true, businessId: true } } },
    });
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
    expect(synthRoutes).toHaveLength(8);
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getWebhookSecret')?.secretSignals).toEqual([
      'apiKey',
      'signingSecret',
      'webhookSecret',
    ]);
    // Variable-assigned raw Prisma delegate read (even with nested `include: { business: { select } }`) is detected.
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getRawSecrets')?.secretSignals).toEqual([
      'raw:portalAccess',
    ]);
    // Variable-assigned secret object literal (`authData` / `authDataRef`) returned by identifier is detected.
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getVarAuthData')?.secretSignals).toEqual([
      'authData',
      'authDataRef',
    ]);
    // Direct and deeply nested `include: { supplierConnection: true }` are detected; explicit `select:` is NOT falsely flagged.
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getNestedInclude')?.secretSignals).toEqual([
      'include:supplierConnection',
    ]);
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getDeepNestedInclude')?.secretSignals).toEqual([
      'include:supplierConnection',
    ]);
    expect(synthRoutes.find((r) => r.key === 'SyntheticReadController.getSafeNestedSelect')?.secretSignals).toEqual([]);

    const synthModuleSource = () => synthSource;

    // 1. Secret-bearing GETs misclassified as `open` / `exempt-own` / omitted MUST fail secretReadProblems.
    const badSecretCensus = parseCensus(`
| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | open | settings:read follow-up |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | exempt-own | caller owns business |
| \`SyntheticReadController.getVarAuthData\` | GET | \`/synthetic/businesses/:businessId/var-auth-data\` | open | connect:read follow-up |
| \`SyntheticReadController.getNestedInclude\` | GET | \`/synthetic/businesses/:businessId/nested-include\` | open | storefront:read follow-up |
| \`SyntheticReadController.getDeepNestedInclude\` | GET | \`/synthetic/businesses/:businessId/deep-nested-include\` | open | storefront:read follow-up |
| \`SyntheticReadController.getSafeNestedSelect\` | GET | \`/synthetic/businesses/:businessId/safe-nested-select\` | open | storefront:read follow-up |
| \`SyntheticReadController.getOpenData\` | GET | \`/synthetic/businesses/:businessId/open-data\` | open | missing scope name |
| \`SyntheticReadController.phantomRoute\` | GET | \`/synthetic/businesses/:businessId/gone\` | open | revenue:read |
`);
    const badResult = validateReadCensus(synthRoutes, badSecretCensus, synthModuleSource);

    // Negative control 1: secret-bearing GETs (direct, variable raw Prisma, variable object, direct & deep nested include) FAIL; safe select does NOT.
    expect(badResult.secretReadProblems).toHaveLength(5);
    expect(badResult.secretReadProblems.some((p) => p.includes('getWebhookSecret'))).toBe(true);
    expect(badResult.secretReadProblems.some((p) => p.includes('getRawSecrets'))).toBe(true);
    expect(badResult.secretReadProblems.some((p) => p.includes('getVarAuthData'))).toBe(true);
    expect(badResult.secretReadProblems.some((p) => p.includes('getNestedInclude'))).toBe(true);
    expect(badResult.secretReadProblems.some((p) => p.includes('getDeepNestedInclude'))).toBe(true);
    expect(badResult.secretReadProblems.some((p) => p.includes('getSafeNestedSelect'))).toBe(false);

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
    const fakeGateCensus = parseCensus(`
| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | secret-read | stop-the-line secret read |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | secret-read | stop-the-line raw portalAccess read |
| \`SyntheticReadController.getVarAuthData\` | GET | \`/synthetic/businesses/:businessId/var-auth-data\` | secret-read | stop-the-line authData read |
| \`SyntheticReadController.getNestedInclude\` | GET | \`/synthetic/businesses/:businessId/nested-include\` | secret-read | stop-the-line nested include read |
| \`SyntheticReadController.getDeepNestedInclude\` | GET | \`/synthetic/businesses/:businessId/deep-nested-include\` | secret-read | stop-the-line deep nested include read |
| \`SyntheticReadController.getSafeNestedSelect\` | GET | \`/synthetic/businesses/:businessId/safe-nested-select\` | open | storefront:read follow-up |
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

    // Negative control 5 (fail-closed schemaProblems): malformed rows (uppercase/underscore disposition typo,
    // missing backticks, wrong column count), duplicate key, non-GET verb, unknown disposition, and empty reason ALL FAIL.
    const badSchemaCensus = parseCensus(`
| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| \`SyntheticReadController.getOpenData\` | GET | \`/synthetic/businesses/:businessId/open-data\` | OPEN | uppercase disposition typo |
| SyntheticReadController.getOpenData | GET | \`/synthetic/businesses/:businessId/open-data\` | open | missing backticks |
| \`SyntheticReadController.getOpenData\` | GET | \`/synthetic/businesses/:businessId/open-data\` | open | too | many | columns |
| \`SyntheticReadController.getWebhookSecret\` | POST | \`/synthetic/businesses/:businessId/webhook-secret\` | secret-read | non-GET verb |
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | bogus-disp | duplicate + unknown disposition |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | secret-read |   |
`);
    const badSchemaResult = validateReadCensus(synthRoutes, badSchemaCensus, synthModuleSource);
    expect(badSchemaResult.schemaProblems.length).toBeGreaterThanOrEqual(7);
    expect(badSchemaResult.schemaProblems.filter((p) => p.includes('malformed route table row'))).toHaveLength(3);
    expect(badSchemaResult.schemaProblems.some((p) => p.includes('expected GET'))).toBe(true);
    expect(badSchemaResult.schemaProblems.some((p) => p.includes('listed twice'))).toBe(true);
    expect(badSchemaResult.schemaProblems.some((p) => p.includes('unknown disposition bogus-disp'))).toBe(true);
    expect(badSchemaResult.schemaProblems.some((p) => p.includes('gives no reason'))).toBe(true);

    // Control passes cleanly when every row is honest and valid
    const validCensus = parseCensus(`
| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| \`SyntheticReadController.getWebhookSecret\` | GET | \`/synthetic/businesses/:businessId/webhook-secret\` | secret-read | stop-the-line finding: returns signingSecret, apiKey, webhookSecret |
| \`SyntheticReadController.getRawSecrets\` | GET | \`/synthetic/businesses/:businessId/raw-secrets\` | secret-read | stop-the-line finding: returns raw portalAccess rows |
| \`SyntheticReadController.getVarAuthData\` | GET | \`/synthetic/businesses/:businessId/var-auth-data\` | secret-read | stop-the-line finding: returns authData and authDataRef |
| \`SyntheticReadController.getNestedInclude\` | GET | \`/synthetic/businesses/:businessId/nested-include\` | secret-read | stop-the-line finding: nested include of supplierConnection |
| \`SyntheticReadController.getDeepNestedInclude\` | GET | \`/synthetic/businesses/:businessId/deep-nested-include\` | secret-read | stop-the-line finding: deep nested include of supplierConnection |
| \`SyntheticReadController.getSafeNestedSelect\` | GET | \`/synthetic/businesses/:businessId/safe-nested-select\` | open | storefront:read follow-up |
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

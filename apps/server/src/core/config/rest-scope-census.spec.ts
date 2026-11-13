/**
 * SWEEP-P0-SCOPES — the REST scope census is pinned: docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md.
 *
 * WHY: the 2026-11-13 browser sweep found member routes that checked a business membership and
 * nothing else (webhooks with their signing secrets, API keys, projects, stock and warehouses:
 * BUG-001, BUG-013, BUG-014, BUG-015). Each was a write a STAFF member with no access to the module
 * could make. The census lists every such route the server has; this file makes the next one
 * visible, so a new membership-only write route has to be gated or placed in the census on purpose.
 *
 * WHAT IS READ (typescript AST, every non-test .ts file under apps/server/src/modules): each
 * `@Controller` class, its class-level `@UseGuards`, and per handler the HTTP verb decorator, the
 * method-level `@UseGuards`, `@RequireModuleScope(module, level)` (level defaults to read, as the
 * decorator does) and the handler body text.
 *
 * THE POPULATION: a route is a membership-only write when its verb is POST, PUT, PATCH or DELETE,
 * it runs a member guard (AuthGuard, BusinessGuard or OptionalAuthGuard), and it does not carry an
 * ENFORCED scope: a `@RequireModuleScope` on the handler AND ModuleScopeGuard in its guard chain
 * (the guard reads the handler's metadata only, so a declaration without the guard is inert and the
 * route counts as membership-only). Public routes (no member guard) are pinned by
 * core/auth/public-surface.spec.ts and are not this census.
 *
 * THE DOC: every census table row is `| \`Class.handler\` | VERB | path | disposition | reason |`.
 * Dispositions:
 *   applied        this packet gated it; the reason is `module:level`, the scope it now carries.
 *   exempt-check   the handler calls an authority check beyond membership; the reason names it as
 *                  `check:<function>`, and the handler body must call it.
 *   exempt-guard   a dedicated authority guard runs; the reason names it as `guard:<Name>`, and the
 *                  route's guard chain must include it.
 *   exempt-own     the route acts on the caller's own record (own profile, own device, own session).
 *   exempt-ruled   an owner ruling keeps it open; the reason cites the ruling (D-<n>).
 *   deferred       another packet owns the gate; the route may leave the population (gated there)
 *                  without this file failing, but must still exist.
 *   open           membership-only and recorded for a follow-up packet (the reason names the
 *                  module the follow-up should apply and why it was not applied here).
 *   secret-read    (GET rows) a read that would carry a secret, reviewed: the reason says how the
 *                  secret is kept out (a scope, `check:<function>`, or the redaction it applies).
 *
 * WHAT IS REQUIRED:
 *   CEN-01 the doc parses; every row is unique, names a disposition above and a non-empty reason.
 *   CEN-02 every route of the population has a row (a new membership-only write route fails here).
 *   CEN-03 every row names a real route with the verb and path it states; every row other than
 *          `applied`, `deferred` and `secret-read` names a route still in the population (a route
 *          gated since must leave the census or move to `applied`).
 *   CEN-04 every `applied` row's route carries exactly the enforced scope its reason names.
 *   CEN-05 every `exempt-check` row's handler calls the check it names.
 *   CEN-06 every `exempt-guard` row's route runs the guard it names.
 *   CEN-07 every `exempt-ruled` row cites an owner ruling.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

const SRC = resolve(__dirname, '../..');
const MODULES = join(SRC, 'modules');
const REPO = resolve(SRC, '../../..');
const CENSUS = join(REPO, 'docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md');

const HTTP_VERBS: Record<string, string> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', All: 'ALL' };
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MEMBER_GUARDS = ['AuthGuard', 'BusinessGuard', 'OptionalAuthGuard'];
const DISPOSITIONS = new Set(['applied', 'exempt-check', 'exempt-guard', 'exempt-own', 'exempt-ruled', 'deferred', 'open', 'secret-read']);

interface Route {
  key: string;
  file: string;
  verb: string;
  path: string;
  guards: string[];
  scope?: { module: string; minLevel: string };
  body: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, '');

function routes(): Route[] {
  const out: Route[] = [];
  for (const file of walk(MODULES)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('@Controller')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const decorators = (n: ts.Node) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) ?? [] : []);
    const name = (d: ts.Decorator) => (ts.isCallExpression(d.expression) ? d.expression.expression.getText(sf) : d.expression.getText(sf));
    const args = (d: ts.Decorator) => (ts.isCallExpression(d.expression) ? d.expression.arguments.map((a) => a.getText(sf)) : []);
    for (const node of sf.statements) {
      if (!ts.isClassDeclaration(node) || !node.name) continue;
      const classDecorators = decorators(node);
      const controller = classDecorators.find((d) => name(d) === 'Controller');
      if (!controller) continue;
      const prefix = unquote(args(controller)[0] ?? '');
      const classGuards = classDecorators.filter((d) => name(d) === 'UseGuards').flatMap(args);
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const ds = decorators(member);
        const http = ds.find((d) => name(d) in HTTP_VERBS);
        if (!http) continue;
        const scopeDecorator = ds.find((d) => name(d) === 'RequireModuleScope');
        const scopeArgs = scopeDecorator ? args(scopeDecorator).map(unquote) : [];
        out.push({
          key: `${node.name.getText(sf)}.${member.name.getText(sf)}`,
          file: relative(SRC, file),
          verb: HTTP_VERBS[name(http)],
          path: '/' + [prefix, unquote(args(http)[0] ?? '')].filter(Boolean).join('/'),
          guards: [...classGuards, ...ds.filter((d) => name(d) === 'UseGuards').flatMap(args)],
          scope: scopeDecorator ? { module: scopeArgs[0], minLevel: scopeArgs[1] ?? 'read' } : undefined,
          body: member.body?.getText(sf) ?? '',
        });
      }
    }
  }
  return out;
}

const enforced = (r: Route) => !!r.scope && r.guards.includes('ModuleScopeGuard');
const isMember = (r: Route) => r.guards.some((g) => MEMBER_GUARDS.includes(g));

interface Row {
  key: string;
  verb: string;
  path: string;
  disposition: string;
  reason: string;
  line: number;
}

function censusRows(): Row[] {
  const rows: Row[] = [];
  readFileSync(CENSUS, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = /^\|\s*`([A-Za-z0-9_]+\.[A-Za-z0-9_]+)`\s*\|\s*([A-Z]+)\s*\|\s*`?([^|`]*)`?\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
      if (m) rows.push({ key: m[1], verb: m[2], path: m[3].trim(), disposition: m[4], reason: m[5], line: i + 1 });
    });
  return rows;
}

describe('REST scope census (SWEEP-P0-SCOPES)', () => {
  const all = routes();
  const byKey = new Map(all.map((r) => [r.key, r]));
  const population = all.filter((r) => WRITE_VERBS.has(r.verb) && isMember(r) && !enforced(r));

  it('the reader sees the controllers (guards the guard)', () => {
    expect(all.length).toBeGreaterThan(2000);
    expect(byKey.get('WebhooksController.create')?.scope).toEqual({ module: 'settings', minLevel: 'write' });
    expect(byKey.get('ApiKeysController.revoke')?.guards).toContain('ModuleScopeGuard');
    // a class-level guard reaches every handler
    expect(byKey.get('ProjectsController.createProject')?.guards).toEqual(['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']);
    // a declaration without the guard is inert: still membership-only
    expect(population.map((r) => r.key)).toContain('PushNotificationController.subscribe');
  });

  it('[CEN-01] the census doc parses: unique rows, known dispositions, a reason on every row', () => {
    expect(existsSync(CENSUS), CENSUS).toBe(true);
    const rows = censusRows();
    expect(rows.length).toBeGreaterThan(population.length);
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const r of rows) {
      if (seen.has(r.key)) problems.push(`line ${r.line}: ${r.key} is listed twice`);
      seen.add(r.key);
      if (!DISPOSITIONS.has(r.disposition)) problems.push(`line ${r.line}: ${r.key} has unknown disposition ${r.disposition}`);
      if (!r.reason.trim()) problems.push(`line ${r.line}: ${r.key} gives no reason`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-02] every membership-only write route is in the census (a new one must be gated or listed)', () => {
    const listed = new Set(censusRows().filter((r) => r.disposition !== 'applied' && r.disposition !== 'secret-read').map((r) => r.key));
    const missing = population.filter((r) => !listed.has(r.key)).map((r) => `${r.key} (${r.verb} ${r.path}, ${r.file})`);
    expect(missing).toEqual([]);
  });

  it('[CEN-03] every census row names a real route with its verb and path; a row still to act on is still membership-only', () => {
    const inPopulation = new Set(population.map((r) => r.key));
    const problems: string[] = [];
    for (const row of censusRows()) {
      const r = byKey.get(row.key);
      if (!r) { problems.push(`line ${row.line}: ${row.key} is not a route`); continue; }
      if (r.verb !== row.verb || r.path !== row.path) problems.push(`line ${row.line}: ${row.key} is ${r.verb} ${r.path}, not ${row.verb} ${row.path}`);
      const stays = !['applied', 'deferred', 'secret-read'].includes(row.disposition);
      if (stays && !inPopulation.has(row.key)) problems.push(`line ${row.line}: ${row.key} (${row.disposition}) is no longer membership-only: move it to applied or drop it`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-04] every applied row carries exactly the enforced scope it names', () => {
    const problems: string[] = [];
    for (const row of censusRows().filter((r) => r.disposition === 'applied')) {
      const r = byKey.get(row.key);
      const named = /`?([a-z]+):(read|write|admin)`?/.exec(row.reason);
      if (!r || !named) { problems.push(`line ${row.line}: ${row.key} names no route or scope`); continue; }
      if (!enforced(r) || r.scope?.module !== named[1] || r.scope?.minLevel !== named[2]) {
        problems.push(`line ${row.line}: ${row.key} carries ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no scope'}${enforced(r) ? '' : ' (not enforced)'}, not ${named[1]}:${named[2]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-05] every exempt-check row names a check its handler calls', () => {
    const problems: string[] = [];
    for (const row of censusRows().filter((r) => r.disposition === 'exempt-check' || (r.disposition === 'secret-read' && /check:/.test(r.reason)))) {
      const checks = [...row.reason.matchAll(/check:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
      if (!checks.length) { problems.push(`line ${row.line}: ${row.key} names no check:<function>`); continue; }
      const body = byKey.get(row.key)?.body ?? '';
      for (const c of checks) if (!new RegExp(`\\b${c}\\(`).test(body)) problems.push(`line ${row.line}: ${row.key} does not call ${c}`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-06] every exempt-guard row names a guard its route runs', () => {
    const problems: string[] = [];
    for (const row of censusRows().filter((r) => r.disposition === 'exempt-guard')) {
      const guards = [...row.reason.matchAll(/guard:([A-Za-z]+)/g)].map((m) => m[1]);
      if (!guards.length) { problems.push(`line ${row.line}: ${row.key} names no guard:<Name>`); continue; }
      const chain = byKey.get(row.key)?.guards ?? [];
      for (const g of guards) if (!chain.includes(g)) problems.push(`line ${row.line}: ${row.key} does not run ${g}`);
    }
    expect(problems).toEqual([]);
  });

  it('[CEN-07] every exempt-ruled row cites an owner ruling', () => {
    const problems = censusRows()
      .filter((r) => r.disposition === 'exempt-ruled' && !/\bD-\d+\b/.test(r.reason))
      .map((r) => `line ${r.line}: ${r.key} cites no ruling`);
    expect(problems).toEqual([]);
  });
});

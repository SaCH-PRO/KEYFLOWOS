/**
 * CI gate: every FlowTool in the registry must declare `manualEquivalentRoute`
 * pointing at the in-app screen where a human can perform the same action
 * without KEY. This guarantees the "AI is optional, never mandatory" principle
 * for the unified KEY agent surface.
 *
 * Usage: tsx apps/web/scripts/check-tool-routes.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function main() {
  const registryPath = path.resolve(
    __dirname,
    '../../server/src/modules/ai/flow-tool-registry.ts',
  );

  let mod: typeof import('../../server/src/modules/ai/flow-tool-registry');
  try {
    mod = await import(pathToFileURL(registryPath).href);
  } catch (err) {
    console.error(`[check-tool-routes] Failed to load registry: ${(err as Error).message}`);
    process.exit(2);
  }

  const tools = (mod as { FLOW_TOOLS?: Array<{ name: string; manualEquivalentRoute?: string; family?: string }> }).FLOW_TOOLS;
  if (!Array.isArray(tools)) {
    console.error('[check-tool-routes] FLOW_TOOLS export not found.');
    process.exit(2);
  }

  // Strict by default: every tool must declare an explicit
  // manualEquivalentRoute. Set TOOL_ROUTES_WARN_ONLY=1 to downgrade to
  // warnings (only useful while migrating new tools in).
  const WARN_ONLY = process.env.TOOL_ROUTES_WARN_ONLY === '1';
  const missing = tools.filter((t) => {
    const route = (t.manualEquivalentRoute ?? '').trim();
    return !route || !route.startsWith('/');
  });

  if (missing.length > 0) {
    const header = `[check-tool-routes] ${missing.length} of ${tools.length} tool(s) missing manualEquivalentRoute:`;
    if (WARN_ONLY) {
      console.warn(header);
      for (const t of missing) console.warn(`  - ${t.name} (family=${t.family})`);
      console.warn(
        'These tools will fall back to a family-default route via getManualEquivalentRoute(). Unset TOOL_ROUTES_WARN_ONLY to fail the build.',
      );
    } else {
      console.error(header);
      for (const t of missing) console.error(`  - ${t.name} (family=${t.family})`);
      console.error(
        'Every tool must declare an in-app screen where a human can perform the equivalent action manually. Set TOOL_ROUTES_WARN_ONLY=1 to downgrade to warnings during migration.',
      );
      process.exit(1);
    }
  }

  // And the route has to EXIST.
  //
  // The check above only ever asked whether the string was non-empty and began
  // with a slash, which a typo satisfies. Measured when this was added, four
  // routes across thirteen tools pointed at pages that were never built —
  // /app/marketing/seo, /app/support, /app/invoices, /app/catalog — so KEY's
  // "you can do this yourself here" link was a 404 for every SEO, helpdesk,
  // invoice-write and product-write tool. A promise that the AI is optional is
  // worth nothing if the manual path is a dead link.
  const appDir = path.resolve(__dirname, '../src/app');
  const unresolved = tools.filter((t) => !routeExists(appDir, (t.manualEquivalentRoute ?? '').trim()));

  if (unresolved.length > 0) {
    const header = `[check-tool-routes] ${unresolved.length} tool(s) point at a route with no page:`;
    if (WARN_ONLY) {
      console.warn(header);
      for (const t of unresolved) console.warn(`  - ${t.name} -> ${t.manualEquivalentRoute}`);
    } else {
      console.error(header);
      for (const t of unresolved) console.error(`  - ${t.name} -> ${t.manualEquivalentRoute}`);
      console.error('Point each at a screen that exists under apps/web/src/app.');
      process.exit(1);
    }
  }

  // ── Manual parity ──────────────────────────────────────────────────────
  const appRoot = path.resolve(__dirname, '../src');
  assertParityCheckWorks(appDir, appRoot);
  const writeTools = tools.filter((t) => WRITE_FAMILIES.has(t.family ?? ''));
  const noManualWrite = writeTools.filter((t) => {
    if (MANUAL_PARITY_EXEMPTIONS[t.name]) return false;
    const page = resolvePage(appDir, (t.manualEquivalentRoute ?? '').trim());
    return !page || !canWrite(page, appRoot);
  });

  if (noManualWrite.length > 0) {
    const header =
      `[check-tool-routes] ${noManualWrite.length} write tool(s) point at a screen a human cannot write from:`;
    if (WARN_ONLY) {
      console.warn(header);
      for (const t of noManualWrite) console.warn(`  - ${t.name} (${t.family}) -> ${t.manualEquivalentRoute}`);
    } else {
      console.error(header);
      for (const t of noManualWrite) console.error(`  - ${t.name} (${t.family}) -> ${t.manualEquivalentRoute}`);
      console.error(
        'KEY must be optional, never mandatory: anything it can change, a person must be able to change too.\n' +
          'Build the screen, point the tool at the screen that already does this, or add a reviewed entry to\n' +
          'MANUAL_PARITY_EXEMPTIONS with the reason.',
      );
      process.exit(1);
    }
  }

  console.log(
    `[check-tool-routes] Scan complete — ${tools.length - missing.length}/${tools.length} tools declare manualEquivalentRoute, ` +
      `${tools.length - unresolved.length}/${tools.length} resolve to a real page, ` +
      `${writeTools.length - noManualWrite.length}/${writeTools.length} write tools have manual parity.`,
  );
}

/**
 * MANUAL PARITY: a tool that CHANGES something must point at a screen where a
 * human can change the same thing without KEY.
 *
 * The product rule is that KEY is optional, never mandatory. The check above
 * only proves a page EXISTS, which a read-only screen satisfies — /app/accounting
 * passes it today while offering the user no way to do anything at all.
 *
 * This currently catches nothing, and that is the point: manual parity holds
 * right now, and this is the ratchet that keeps it holding. The two organs
 * queued next are exactly where it would otherwise break — inventory has no web
 * pages at all, and deep finance is read-only for humans, so building tools
 * first would give KEY powers the owner does not have.
 */
const WRITE_FAMILIES = new Set(['execute', 'crud', 'organize']);

/**
 * Tools whose manual equivalent is genuinely absent, with the reason.
 *
 * Empty today. An entry here is a deliberate, reviewed exception — not a place
 * to silence the gate. If this list grows without a matching plan to build the
 * screen, the rule has been abandoned rather than applied.
 */
const MANUAL_PARITY_EXEMPTIONS: Record<string, string> = {};

/**
 * The gate checks itself, on every run.
 *
 * This check passes today for every tool, which means a broken version of it
 * ALSO passes and looks identical. That is not hypothetical — two earlier
 * versions were silently unfailable:
 *
 *   1. Matching any verb-shaped call anywhere in the import graph. Every page
 *      imports workspace-shell -> navigation-context, which calls saveStack().
 *   2. Recursing into the api layer. lib/client.ts re-exports every module, so
 *      page -> lib/workspace -> lib/client -> lib/api/contracts "reached" all
 *      215 mutations from any screen at all.
 *
 * Both were caught only by deliberately pointing a write tool at a read-only
 * screen and noticing nothing happened. So that experiment is the check's own
 * regression test, run every time rather than remembered.
 *
 * Fixtures are real screens with known behaviour: /app/accounting reads ledger
 * data and offers no write, /app/contracts has full manual CRUD. If either
 * changes, this fails loudly and someone picks new fixtures — which is correct,
 * because the answer it was giving is no longer trustworthy.
 */
function assertParityCheckWorks(appDir: string, appRoot: string): void {
  const readOnly = resolvePage(appDir, '/app/accounting');
  const writable = resolvePage(appDir, '/app/contracts');

  const problems: string[] = [];
  if (!readOnly || !writable) {
    problems.push('self-test fixtures /app/accounting and /app/contracts no longer resolve');
  } else {
    if (canWrite(readOnly, appRoot)) {
      problems.push('/app/accounting reports a manual write path — the check cannot fail, so it proves nothing');
    }
    if (!canWrite(writable, appRoot)) {
      problems.push('/app/contracts reports NO manual write path — the check rejects screens that are fine');
    }
  }

  if (problems.length > 0) {
    console.error('[check-tool-routes] the manual-parity check is broken:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Fix the check, or pick fixtures whose behaviour still matches the comment above.');
    process.exit(2);
  }
}

/**
 * Does this app-router path render a page?
 *
 * Walks the segments under src/app, allowing a dynamic segment ([id], (group))
 * to stand in for a literal one, and requires a page file at the end — a
 * directory of components with no page.tsx is not a destination.
 */
function routeExists(appDir: string, route: string): boolean {
  return resolvePage(appDir, route) !== null;
}

/**
 * The page file a route renders, following redirect() stubs.
 *
 * Several routes are three-line `redirect("/app/elsewhere")` shims —
 * /app/inbox, /app/blueprint, /app/keyflow-command. A checker that stops at the
 * stub concludes those screens cannot do anything, which is how the first
 * version of the parity check below reported failures for tools that are fine.
 */
function resolvePage(appDir: string, route: string, hops = 0): string | null {
  if (!route || !route.startsWith('/') || hops > 3) return null;

  let dir = appDir;
  for (const segment of route.replace(/^\//, '').split('/').filter(Boolean)) {
    const literal = path.join(dir, segment);
    if (isDir(literal)) {
      dir = literal;
      continue;
    }
    const dynamic = isDir(dir)
      ? fs.readdirSync(dir).find((d) => /^[[(]/.test(d) && isDir(path.join(dir, d)))
      : undefined;
    if (!dynamic) return null;
    dir = path.join(dir, dynamic);
  }

  const page = ['page.tsx', 'page.ts', 'page.jsx', 'page.js']
    .map((f) => path.join(dir, f))
    .find((f) => fs.existsSync(f));
  if (!page) return null;

  const body = read(page);
  const redirected = body.match(/redirect\(\s*["'`](\/[^"'`?]+)/);
  if (redirected) {
    const target = resolvePage(appDir, redirected[1], hops + 1);
    if (target) return target;
  }
  return page;
}

/**
 * Can a human perform a write from this screen?
 *
 * Follows imports, because pages compose: /app/commerce renders
 * <CommerceOverviewTab> and <FinancePipeline>, /app/crm/pipeline pulls in
 * @/components/contacts. Reading only page.tsx reported 27 of 78 write tools as
 * lacking a manual equivalent, and every one was wrong.
 *
 * The signal is a MUTATION IMPORTED FROM THE API LAYER — createContract from
 * @/lib/api/contracts, updateAsset from @/lib/client. That is where every real
 * write in this app comes from (215 such exports), and it is what makes the
 * check precise.
 *
 * The obvious version — "does any verb-shaped call appear anywhere in the
 * graph" — silently passed EVERYTHING. Every page imports workspace-shell,
 * which imports navigation-context, which calls saveStack(). So a gate written
 * that way could never fail, which is worse than no gate: it reads as
 * protection while providing none. Verified by pointing a write tool at
 * /app/accounting, a screen with no write path, and watching it pass.
 */
const MUTATION_NAME =
  /^(create|update|delete|archive|publish|approve|send|cancel|assign|mark|resolve|submit|verify|remove|revoke|restore|import|generate)[A-Z]/;

/**
 * The generic writers. This app writes two ways — a named helper
 * (createContract) or a bare verb (apiPost). Matching only the first missed
 * /app/seo, which does all its writing through apiPatch/apiPost, and reported a
 * screen with 985 lines of editing UI as read-only.
 */
const GENERIC_WRITE = /^(apiPost|apiPatch|apiPut|apiDelete)$/;

const API_LAYER = /^@\/lib\/(api\b|client$)/;

/**
 * Depth 3, not 2. Pages compose through hooks as well as components —
 * /app/onboarding is page -> use-onboarding -> the api call — and stopping at 2
 * reported it as having no manual path when the whole screen is a wizard whose
 * entire job is writing those steps.
 */
function canWrite(file: string, appRoot: string, depth = 3, seen = new Set<string>()): boolean {
  if (depth < 0 || seen.has(file)) return false;
  seen.add(file);

  const body = read(file);

  // A mutation pulled in from the API layer, in this file.
  for (const imp of body.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!API_LAYER.test(imp[2])) continue;
    const named = imp[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
    if (named.some((n) => MUTATION_NAME.test(n) || GENERIC_WRITE.test(n))) return true;
  }

  // Recurse only through UI — pages, components, hooks. NEVER into the api
  // layer itself.
  //
  // lib/client.ts re-exports every api module, so following imports into lib/
  // means any screen that touches lib/workspace transitively "reaches" all 215
  // mutations. /app/accounting passed this check via
  // page -> lib/workspace -> lib/client -> lib/api/contracts, which is a module
  // graph, not a thing a user can click. The api layer is the DESTINATION of
  // this search; walking through it makes every screen look writable and the
  // gate unfailable.
  for (const match of body.matchAll(/from\s+["']([^"']+)["']/g)) {
    for (const resolved of resolveImport(match[1], file, appRoot)) {
      if (isApiLayerFile(resolved, appRoot)) continue;
      if (canWrite(resolved, appRoot, depth - 1, seen)) return true;
    }
  }
  return false;
}

function isApiLayerFile(file: string, appRoot: string): boolean {
  const rel = path.relative(appRoot, file).split(path.sep).join('/');
  return rel.startsWith('lib/');
}

function resolveImport(spec: string, fromFile: string, appRoot: string): string[] {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(appRoot, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return []; // node_modules — not our screens

  const candidates = [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')];
  const found = candidates.filter((c) => fs.existsSync(c));
  if (found.length) return found;

  return isDir(base)
    ? fs.readdirSync(base).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(base, f))
    : [];
}

function read(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function isDir(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

main().catch((err) => {
  console.error(`[check-tool-routes] Unexpected error: ${(err as Error).stack}`);
  process.exit(2);
});

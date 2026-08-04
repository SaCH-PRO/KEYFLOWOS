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

  console.log(
    `[check-tool-routes] Scan complete — ${tools.length - missing.length}/${tools.length} tools declare manualEquivalentRoute, ` +
      `${tools.length - unresolved.length}/${tools.length} resolve to a real page.`,
  );
}

/**
 * Does this app-router path render a page?
 *
 * Walks the segments under src/app, allowing a dynamic segment ([id], (group))
 * to stand in for a literal one, and requires a page file at the end — a
 * directory of components with no page.tsx is not a destination.
 */
function routeExists(appDir: string, route: string): boolean {
  if (!route || !route.startsWith('/')) return false;

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
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }

  return ['page.tsx', 'page.ts', 'page.jsx', 'page.js'].some((f) => fs.existsSync(path.join(dir, f)));
}

function isDir(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

main().catch((err) => {
  console.error(`[check-tool-routes] Unexpected error: ${(err as Error).stack}`);
  process.exit(2);
});

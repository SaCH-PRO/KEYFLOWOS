/**
 * CI gate: every FlowTool in the registry must declare `manualEquivalentRoute`
 * pointing at the in-app screen where a human can perform the same action
 * without KEY. This guarantees the "AI is optional, never mandatory" principle
 * for the unified KEY agent surface.
 *
 * Usage: tsx apps/web/scripts/check-tool-routes.ts
 */
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

  console.log(`[check-tool-routes] Scan complete — ${tools.length - missing.length}/${tools.length} tools declare manualEquivalentRoute explicitly.`);
}

main().catch((err) => {
  console.error(`[check-tool-routes] Unexpected error: ${(err as Error).stack}`);
  process.exit(2);
});

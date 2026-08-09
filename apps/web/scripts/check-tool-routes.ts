/**
 * CLI wrapper around the tool-route audit.
 *
 * The analysis lives in src/lib/tool-route-audit.ts so that a spec can run it
 * too — see src/lib/__tests__/tool-routes.spec.ts. This file exists for running
 * the check by hand and reading the output; CI gets its coverage from the spec,
 * because a gate that only runs when someone types the command is a gate that
 * reports after the fact.
 *
 * Usage: tsx apps/web/scripts/check-tool-routes.ts
 *
 * Exit codes:  0 clean   1 findings   2 the check itself could not run
 */
import { auditToolRoutes, describeFindings, summarise } from '../src/lib/tool-route-audit';

async function main() {
  const findings = await auditToolRoutes();
  const problems = describeFindings(findings);

  if (problems.length > 0) {
    // TOOL_ROUTES_WARN_ONLY=1 downgrades findings to warnings. Only useful while
    // migrating a batch of new tools in; it does not affect the spec, which is
    // the gate that actually holds the line.
    const warnOnly = process.env.TOOL_ROUTES_WARN_ONLY === '1';
    const write = warnOnly ? console.warn : console.error;
    for (const line of problems) write(`[check-tool-routes] ${line}`);
    if (!warnOnly) process.exit(1);
  }

  console.log(`[check-tool-routes] Scan complete — ${summarise(findings)}`);
}

main().catch((err: unknown) => {
  console.error(`[check-tool-routes] Unexpected error: ${(err as Error).stack ?? err}`);
  process.exit(2);
});

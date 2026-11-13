#!/usr/bin/env node
/**
 * Report the open implementation PRs whose gate main has moved out from under.
 *
 * Read-only: it reads GitHub through the `gh` CLI and changes nothing. It
 * never repairs. The repair it names makes a new semantic head, which owes a
 * fresh independent review (lib/stale-gates.mjs).
 *
 * Usage: node scripts/agent-control/stale-gates.mjs [--json]
 *
 * Exit codes: 0 no implementation PR is stale, 3 at least one is (listed),
 *             2 the facts could not be read in full; nothing is reported.
 */

import { ghRunner, DEFAULT_REPOSITORY } from './lib/truth.mjs';
import { reportStaleGates } from './lib/stale-gates.mjs';

const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;

try {
  const report = reportStaleGates(repository, ghRunner);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const lines = [`STALE GATES against main ${report.main}`, '='.repeat(60)];
    lines.push(`${report.open_total} open PR(s), ${report.impl_total} implementation; ${report.stale.length} stale, ${report.gate_would_fail_now.length} would fail the gate now, ${report.misleading_green.length} showing a green run that predates main`);
    for (const p of report.prs) {
      lines.push('');
      lines.push(`#${p.number} ${p.head_ref}${p.draft ? ' (draft)' : ''}: ${p.stale ? 'STALE' : 'current'}`);
      if (!p.stale) continue;
      lines.push(`  behind main by ${p.behind_main_by} commit(s), ${p.non_control_files_behind} non-control file(s)${p.compare_truncated ? ' (file list cut at the API limit)' : ''}`);
      lines.push(`  last gate run: ${p.last_gate_run ? `${p.last_gate_run.conclusion} at ${p.last_gate_run.created_at}` : 'none'}${p.misleading_green ? '  <- green, but from before main moved' : ''}`);
      lines.push(`  reasons: ${p.reasons.join(', ')}`);
    }
    if (report.stale.length) lines.push('', `Repair, per PR, by a released and reviewed action only: ${report.prs.find((p) => p.repair).repair}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exit(report.stale.length ? 3 : 0);
} catch (error) {
  process.stderr.write(`stale-gate report failed: ${String(error?.stderr || error?.message || error).trim().split('\n')[0]}\n`);
  process.exit(2);
}

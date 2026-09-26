#!/usr/bin/env node
/**
 * Prove the INACTIVE successor platform DAG is well formed: it parses with the
 * repository YAML codec, validates and fully drains with the programme DAG
 * tooling, and satisfies the gate and activation contract.
 * Exits non-zero with structured problems. Activates nothing.
 */

import { proveDrainable } from './lib/dag.mjs';
import { loadAutopilotPolicy, loadPlatformDag, validatePlatformContract } from './lib/platform-dag.mjs';

try {
  const { doc, dag } = loadPlatformDag(process.cwd());
  const proof = proveDrainable(dag);
  if (!proof.drained) {
    process.stderr.write(`PLATFORM DAG stalls after ${proof.stalled_after} of ${dag.phasesTotal} packets.\n`);
    process.exit(1);
  }

  const problems = validatePlatformContract(doc, loadAutopilotPolicy(process.cwd()));
  if (problems.length) {
    process.stderr.write(`PLATFORM DAG CONTRACT INVALID: ${problems.length} problem(s)\n`);
    for (const problem of problems) process.stderr.write(`  [${problem.code}] ${problem.detail}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `PLATFORM DAG OK: ${dag.packetsTotal} packets, fully drainable; ` +
      `${doc.human_gates.gates.length} human gates, ${doc.human_gates.inherited_never_automatic.length} inherited never_automatic effects; ` +
      `status ${doc.status}.\n`,
  );
  if (process.argv.includes('--print-order')) {
    proof.order.forEach((key, i) => process.stdout.write(`${String(i + 1).padStart(2)}. ${key}\n`));
  }
} catch (error) {
  process.stderr.write(`PLATFORM DAG INVALID: ${error.message}\n`);
  for (const problem of error.problems || []) {
    process.stderr.write(`  [${problem.code}] ${problem.detail}\n`);
  }
  process.exit(1);
}

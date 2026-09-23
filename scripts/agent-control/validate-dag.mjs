#!/usr/bin/env node
/**
 * Prove the programme DAG is executable: loads, validates and fully drains.
 * Exits non-zero with structured problems so CI cannot pass on a deadlock.
 */

import { loadDag, proveDrainable } from './lib/dag.mjs';

try {
  const dag = loadDag(process.cwd());
  const proof = proveDrainable(dag);

  if (!proof.drained) {
    process.stderr.write(
      `DAG stalls after ${proof.stalled_after} of ${dag.phasesTotal} phases.\n` +
        `Selected so far: ${proof.order.join(', ')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `DAG OK: ${dag.packetsTotal} packets / ${dag.phasesTotal} phases, fully drainable in wave order.\n`,
  );
  if (process.argv.includes('--print-order')) {
    proof.order.forEach((key, i) => process.stdout.write(`${String(i + 1).padStart(2)}. ${key}\n`));
  }
} catch (error) {
  process.stderr.write(`DAG INVALID: ${error.message}\n`);
  for (const problem of error.problems || []) {
    process.stderr.write(`  [${problem.code}] ${problem.detail}\n`);
  }
  process.exit(1);
}

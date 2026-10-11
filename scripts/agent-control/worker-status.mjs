#!/usr/bin/env node
/**
 * What the local worker is doing: queued, running, blocked, failed, completed.
 *
 * Read-only. It reads the worker's own state directory and nothing else; it
 * does not contact GitHub and does not touch the worker. The queue is the
 * worker's last snapshot of the control room, as old as its last tick.
 *
 * Usage:
 *   node scripts/agent-control/worker-status.mjs [--state-dir=<dir>] [--json]
 *
 * --state-dir defaults to .agent-control/.worker under the current directory,
 * which is right when run from the checkout the worker serves.
 *
 * Exit codes: 0 nothing needs attention, 3 something does (it is listed),
 *             2 the state could not be read at all.
 */

import path from 'node:path';
import { observeWorker, renderWorker } from './lib/worker-observation.mjs';

const stateArg = process.argv.find((a) => a.startsWith('--state-dir='));
const stateDir = path.resolve(stateArg ? stateArg.slice('--state-dir='.length) : path.join(process.cwd(), '.agent-control', '.worker'));

try {
  const observation = observeWorker(stateDir);
  process.stdout.write((process.argv.includes('--json') ? JSON.stringify(observation, null, 2) : renderWorker(observation)) + '\n');
  process.exit(observation.healthy ? 0 : 3);
} catch (error) {
  process.stderr.write(`worker status failed: ${error.message}\n`);
  process.exit(2);
}

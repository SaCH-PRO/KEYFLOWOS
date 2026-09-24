#!/usr/bin/env node
/**
 * AUTO-ORCHESTRATOR entry point.
 *
 * Reads the canonical live state, normalizes the incoming event, applies the
 * journal for replay safety, and prints the single next legal control action.
 *
 * It does not mutate anything unless --apply is passed, and even then it only
 * writes the journal and the derived next action. Merging, checkpointing and
 * directive release remain separate, separately-authorized steps.
 *
 * Usage:
 *   node scripts/agent-control/orchestrate.mjs [--apply] [--json]
 *   (reads GITHUB_EVENT_NAME / GITHUB_EVENT_PATH when present)
 */

import fs from 'node:fs';
import { loadState, saveState, recordEvent, hasProcessed } from './lib/state.mjs';
import { normalizeEvent, mutationLockKey, observationKey } from './lib/events.mjs';
import { loadDag } from './lib/dag.mjs';
import { decide } from './lib/orchestrator.mjs';
import { defaultRegistry } from './lib/adapters.mjs';

function readEvent() {
  const name = process.env.GITHUB_EVENT_NAME;
  const path = process.env.GITHUB_EVENT_PATH;
  if (!name || !path || !fs.existsSync(path)) return null;
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (process.env.GITHUB_RUN_ID) payload.__run_id = process.env.GITHUB_RUN_ID;
  return normalizeEvent(name, payload);
}

function main() {
  const repoRoot = process.cwd();
  const state = loadState(repoRoot);
  const dag = loadDag(repoRoot);
  const registry = defaultRegistry();
  const event = readEvent();

  const duplicate = event ? hasProcessed(state, event.idempotency_key) : false;
  const decision = decide({ state, event, dag, registry, duplicate });

  const output = {
    event: event ? { kind: event.kind, key: event.idempotency_key, actionable: event.actionable } : null,
    mutation_lock: mutationLockKey(),
    observation_key: observationKey(event, state.programme?.active_packet),
    duplicate,
    decision,
  };

  if (process.argv.includes('--apply') && event && !duplicate && event.actionable) {
    const recorded = recordEvent(state, event, { action: decision.action, rule: 'AUTO-ORCHESTRATOR', result: decision.reason });
    if (recorded.recorded) {
      recorded.state.next_legal_action = { action: decision.action, reason: decision.reason, derived_at: new Date().toISOString() };
      saveState(recorded.state, repoRoot);
      output.applied = true;
    }
  }

  return output;
}

try {
  const output = main();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    process.stdout.write(`ACTION : ${output.decision.action}\n`);
    process.stdout.write(`REASON : ${output.decision.reason}\n`);
    process.stdout.write(`LOCK   : ${output.mutation_lock} (mutation)\n`);
    process.stdout.write(`OBSERVE: ${output.observation_key}\n`);
    if (output.duplicate) process.stdout.write('NOTE   : duplicate event; no second effect\n');
  }
} catch (error) {
  // Never exit 0 on an unexpected failure: a silent orchestrator is worse than
  // a stopped one. (F5)
  process.stderr.write(`orchestrator failed: ${error.stack || error.message}\n`);
  process.exit(2);
}

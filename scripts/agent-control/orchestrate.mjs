#!/usr/bin/env node
/**
 * AUTO-ORCHESTRATOR entry point.
 *
 * Reads the derived programme-state (the reviewed checkpoint), folds newer
 * typed #80 authority over it (lib/authority-effects.mjs), reconciles the
 * effective projection against the newest #80 authority and repository truth,
 * normalizes the incoming event, applies the
 * journal for replay safety, and prints the single next legal control action.
 * If the projection cannot be shown consistent the action is REPORT_DRIFT.
 *
 * It does not mutate anything unless --apply is passed, and even then it only
 * writes the journal and the derived next action. With --apply and a stored
 * checkpoint the state contract rejects, it writes nothing: the result is the
 * same REPORT_DRIFT, with `apply_refused` naming the contract problems, and
 * the exit code is 0 as for any reported drift. Exit 2 means an unexpected
 * failure. Merging, checkpointing and
 * directive release remain separate, separately-authorized steps.
 *
 * Usage:
 *   node scripts/agent-control/orchestrate.mjs [--apply] [--json] [--truth-file <snapshot.json>]
 *   (reads GITHUB_EVENT_NAME / GITHUB_EVENT_PATH when present; reads #80 and
 *   the repository through `gh`, or from a recorded snapshot)
 */

import fs from 'node:fs';
import { loadState, saveState, validateState, recordEvent, hasProcessed } from './lib/state.mjs';
import { normalizeEvent, mutationLockKey, observationKey } from './lib/events.mjs';
import { loadDag } from './lib/dag.mjs';
import { decide } from './lib/orchestrator.mjs';
import { defaultRegistry } from './lib/adapters.mjs';
import { reconcileWithTruth } from './lib/truth.mjs';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

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
  // The reviewed checkpoint as committed. It is never rewritten from authority.
  const checkpoint = loadState(repoRoot);
  const dag = loadDag(repoRoot);
  const registry = defaultRegistry();
  const event = readEvent();

  const duplicate = event ? hasProcessed(checkpoint, event.idempotency_key) : false;
  const reconciliation = reconcileWithTruth(checkpoint, { truthFile: argValue('--truth-file'), dag });
  // The effective projection: the checkpoint plus every newer typed authority effect.
  const state = reconciliation.effective_state;
  const decision = decide({ state, reconciliation, event, dag, registry, duplicate });

  const output = {
    event: event ? { kind: event.kind, key: event.idempotency_key, actionable: event.actionable } : null,
    mutation_lock: mutationLockKey(),
    observation_key: observationKey(event, state.programme?.active_packet),
    duplicate,
    reconciliation,
    decision,
  };

  if (process.argv.includes('--apply') && event && !duplicate && event.actionable) {
    // The stored checkpoint is checked before anything is journaled
    // (FINAL-CORRECTION-020 K1; Copilot r4179736619). One the state contract
    // rejects is not journaled onto, repaired or rewritten: the journal helpers
    // are not called on it and no byte is written. The decision above is
    // already REPORT_DRIFT and names why; the refusal is reported beside it,
    // under the code the fold gives the same condition.
    const stored = validateState(checkpoint);
    if (!stored.ok) {
      output.applied = false;
      output.apply_refused = { code: 'CHECKPOINT_INVALID', problems: stored.problems };
      return output;
    }
    // Journal onto the checkpoint; the effective projection is never persisted.
    const recorded = recordEvent(checkpoint, event, { action: decision.action, rule: 'AUTO-ORCHESTRATOR', result: decision.reason });
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
    for (const f of output.reconciliation.findings) {
      process.stdout.write(`DRIFT  : ${f.code} ${f.detail === null ? '' : JSON.stringify(f.detail)}\n`);
    }
    if (output.apply_refused) {
      process.stdout.write(`APPLY  : refused, nothing journaled or written: ${output.apply_refused.code} ${JSON.stringify(output.apply_refused.problems)}\n`);
    }
  }
} catch (error) {
  // Never exit 0 on an unexpected failure: a silent orchestrator is worse than
  // a stopped one. (F5)
  process.stderr.write(`orchestrator failed: ${error.stack || error.message}\n`);
  process.exit(2);
}

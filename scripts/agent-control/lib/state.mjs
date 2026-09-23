/**
 * Canonical live programme state + append-only event journal.
 *
 * Authority boundary (CG-REVIEW-META-AUTO-001):
 *   - .agent-control/programme-state.yaml   THIS FILE'S SUBJECT. Single
 *     machine-readable authority for LIVE control state.
 *   - GitHub issue #80                      append-only event/audit log and
 *     inter-agent message bus. Not a second mutable state database.
 *   - docs/keyflow-intelligence-foundation  architecture/checkpoint/handoff
 *     record and topology history. NOT live state.
 *   - active-packet.yaml / claude-return.yaml   per-packet PR admission
 *     artifacts. Not the global programme authority.
 *
 * Automation must never decide live state by comparing these stores. It reads
 * this file, and reports drift in the others rather than following them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, stringifyYaml } from './yaml.mjs';
import { STATES, HEALTH } from './state-machine.mjs';

export const STATE_PATH = '.agent-control/programme-state.yaml';

/** Journal is bounded so the file stays reviewable; keys are kept far longer. */
export const JOURNAL_LIMIT = 200;
export const PROCESSED_KEY_LIMIT = 2000;

export function emptyState() {
  return {
    version: 1,
    schema: 'keyflowos.programme-state/v1',
    authority: 'canonical-live-programme-state',
    updated_at: null,
    programme: {
      packets_total: 35,
      checkpointed: [],
      active_packet: null,
      active_phase: null,
      state: null,
      health: null,
      source_main: null,
      implementation_branch: null,
      pr_number: null,
      merge_authority: false,
      production_touched: false,
    },
    hold: null,
    unresolved_contradictions: [],
    momentum: {
      operations_since_transition: 0,
      consecutive_identical_failures: 0,
      consecutive_ci_failures_without_new_root_cause: 0,
      last_failure_signature: null,
      last_transition_at: null,
      alarm_active: false,
    },
    correction: {
      attempts: 0,
      last_signature: null,
    },
    agents: {},
    last_processed_event_key: null,
    processed_event_keys: [],
    event_journal: [],
    next_legal_action: null,
  };
}

export function loadState(repoRoot = process.cwd()) {
  const file = path.join(repoRoot, STATE_PATH);
  if (!fs.existsSync(file)) return emptyState();
  const parsed = parseYaml(fs.readFileSync(file, 'utf8'));
  return normalizeState(parsed);
}

/** Fill in absent collections so callers never branch on undefined. */
export function normalizeState(raw) {
  const base = emptyState();
  const state = { ...base, ...(raw || {}) };
  state.programme = { ...base.programme, ...(raw?.programme || {}) };
  state.momentum = { ...base.momentum, ...(raw?.momentum || {}) };
  state.correction = { ...base.correction, ...(raw?.correction || {}) };
  state.agents = { ...(raw?.agents || {}) };
  state.programme.checkpointed = [...(state.programme.checkpointed || [])];
  state.unresolved_contradictions = [...(state.unresolved_contradictions || [])];
  state.processed_event_keys = [...(state.processed_event_keys || [])];
  state.event_journal = [...(state.event_journal || [])];
  return state;
}

export function validateState(state) {
  const problems = [];
  const p = state.programme || {};

  if (p.state !== null && p.state !== undefined && !STATES.includes(p.state)) {
    problems.push({ code: 'UNKNOWN_STATE', detail: `programme.state=${p.state}` });
  }
  if (p.health !== null && p.health !== undefined && !HEALTH.includes(p.health)) {
    problems.push({ code: 'UNKNOWN_HEALTH', detail: `programme.health=${p.health}` });
  }
  if (p.source_main && !/^[0-9a-f]{40}$/.test(String(p.source_main))) {
    problems.push({ code: 'SOURCE_MAIN_NOT_A_SHA', detail: String(p.source_main) });
  }
  if (p.production_touched === true) {
    problems.push({ code: 'PRODUCTION_TOUCHED', detail: 'production_touched must be false without out-of-band authorization' });
  }
  if (p.merge_authority === true && !state.merge_authority_marker) {
    problems.push({ code: 'MERGE_AUTHORITY_WITHOUT_MARKER', detail: 'merge_authority=true requires a recorded authority marker' });
  }
  if (new Set(state.processed_event_keys).size !== state.processed_event_keys.length) {
    problems.push({ code: 'DUPLICATE_PROCESSED_KEYS', detail: 'processed_event_keys must be a set' });
  }
  return { ok: problems.length === 0, problems };
}

export function saveState(state, repoRoot = process.cwd(), options = {}) {
  const verdict = validateState(state);
  if (!verdict.ok && !options.allowInvalid) {
    const err = new Error(`programme-state invalid: ${verdict.problems.map((x) => x.code).join(', ')}`);
    err.problems = verdict.problems;
    throw err;
  }
  const out = { ...state, updated_at: options.now || new Date().toISOString() };
  // Bound the growing collections, newest last.
  if (out.event_journal.length > JOURNAL_LIMIT) out.event_journal = out.event_journal.slice(-JOURNAL_LIMIT);
  if (out.processed_event_keys.length > PROCESSED_KEY_LIMIT) {
    out.processed_event_keys = out.processed_event_keys.slice(-PROCESSED_KEY_LIMIT);
  }
  const file = path.join(repoRoot, STATE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyYaml(out), 'utf8');
  return out;
}

/** True when this exact underlying event has already been applied. */
export function hasProcessed(state, idempotencyKey) {
  if (!idempotencyKey) return false;
  return state.processed_event_keys.includes(idempotencyKey);
}

/**
 * Append one event to the journal, exactly once.
 *
 * Returns {duplicate:true} without mutating when the key is already present,
 * so a crashed-and-retried workflow cannot double-post, double-merge or
 * double-checkpoint. (AUTO-RECOVERY)
 */
export function recordEvent(state, event, outcome = {}) {
  const key = event?.idempotency_key;
  if (!key) return { state, duplicate: false, recorded: false, reason: 'event carries no idempotency key' };
  if (hasProcessed(state, key)) return { state, duplicate: true, recorded: false, reason: 'already processed' };

  const next = {
    ...state,
    processed_event_keys: [...state.processed_event_keys, key],
    last_processed_event_key: key,
    event_journal: [
      ...state.event_journal,
      {
        key,
        kind: event.kind || null,
        source: event.source || null,
        packet_id: event.packet_id || null,
        pr_number: event.pr_number ?? null,
        head_sha: event.head_sha || null,
        observed_at: event.observed_at || null,
        action: outcome.action || 'recorded',
        result: outcome.result || null,
        rule: outcome.rule || null,
      },
    ],
  };
  return { state: next, duplicate: false, recorded: true };
}

/**
 * Detect projection drift against the durable intelligence board without
 * letting the stale projection advance anything. Reporting only.
 */
export function projectionDrift(state, boardProjection) {
  if (!boardProjection) return { drift: false, details: [] };
  const details = [];
  const p = state.programme || {};
  if (boardProjection.active_packet && boardProjection.active_packet !== p.active_packet) {
    details.push({
      field: 'active_packet',
      live: p.active_packet,
      projection: boardProjection.active_packet,
    });
  }
  if (boardProjection.state && boardProjection.state !== p.state) {
    details.push({ field: 'state', live: p.state, projection: boardProjection.state });
  }
  if (boardProjection.health && boardProjection.health !== p.health) {
    details.push({ field: 'health', live: p.health, projection: boardProjection.health });
  }
  return { drift: details.length > 0, details };
}

export default {
  STATE_PATH,
  emptyState,
  loadState,
  saveState,
  normalizeState,
  validateState,
  hasProcessed,
  recordEvent,
  projectionDrift,
};

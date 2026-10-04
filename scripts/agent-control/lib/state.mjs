/**
 * Derived programme-state projection + append-only event journal.
 *
 * Source precedence (CG-DIRECTIVE-META-STATE-RECONCILE-001, supersedes the
 * "canonical live state" model of CG-REVIEW-META-AUTO-001):
 *   - repository / PR / CI evidence         implementation truth.
 *   - newest valid ChatGPT DIRECTIVE, REVIEW, HOLD or RESUME on issue #80
 *                                           current execution authority. #80
 *     stays append-only; its history is the authority record.
 *   - .agent-control/programme-state.yaml   THIS FILE'S SUBJECT. A derived
 *     machine projection of the two above. It may be stale. `authority_basis`
 *     names the newest authority message it incorporates.
 *   - docs/keyflow-intelligence-foundation  durable intent/checkpoint history.
 *   - active-packet.yaml / claude-return.yaml   per-packet PR admission artifacts.
 *
 * The projection may summarize and accelerate a decision; it may never
 * override newer authority or repository truth. lib/reconcile.mjs performs the
 * comparison and decide() fails closed on any disagreement.
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
    authority: 'derived-programme-projection',
    updated_at: null,
    // {message_id, comment_id} of the newest #80 authority message this
    // projection incorporates. Absent means it cannot be checked, so it is unusable.
    authority_basis: null,
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
    // Legacy single hold. Superseded by `holds`; still honoured when present.
    hold: null,
    // Packet-keyed holds: {<packet_id>: {active, packet_id, reason, ...}}.
    // Several packets may be held at once (KF-META-STATE-REDUCER-LIVE-001, C1).
    holds: {},
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

/** The problem a container of the wrong structural type is reported as. */
export const SHAPE_INVALID = 'CHECKPOINT_SHAPE_INVALID';

/** Containers that are mappings, and containers that are lists, when present. */
const MAPPING_CONTAINERS = Object.freeze(['programme', 'momentum', 'correction', 'agents', 'holds']);
const LIST_CONTAINERS = Object.freeze(['unresolved_contradictions', 'processed_event_keys', 'event_journal']);

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const shapeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value === 'object' ? 'mapping' : typeof value;
};

/**
 * Containers that are present with the wrong structural type
 * (CONVERGED-CORRECTIONS-018 K2; Copilot review 5407820973). Absent means the
 * key is not there: only that is defaulted. An explicit null, a list where a
 * mapping belongs (`holds: []`), a mapping where a list belongs, or a scalar
 * is present and wrong. The legacy single `hold` is a mapping or null. Reads
 * a checkpoint as written or as normalizeState() returns it: the answer is
 * the same, because normalizeState() leaves a wrong container untouched.
 *
 * @returns {{code: string, detail: string}[]} empty when every present container has its type
 */
export function shapeProblems(raw) {
  const wrong = (name, expected, value) => ({ code: SHAPE_INVALID, detail: `${name} must be a ${expected} when present, found ${shapeOf(value)}` });
  if (!isMapping(raw)) return [wrong('programme-state', 'mapping', raw)];
  const problems = [];
  for (const name of MAPPING_CONTAINERS) {
    if (raw[name] !== undefined && !isMapping(raw[name])) problems.push(wrong(name, 'mapping', raw[name]));
  }
  if (isMapping(raw.programme) && raw.programme.checkpointed !== undefined && !Array.isArray(raw.programme.checkpointed)) {
    problems.push(wrong('programme.checkpointed', 'list', raw.programme.checkpointed));
  }
  for (const name of LIST_CONTAINERS) {
    if (raw[name] !== undefined && !Array.isArray(raw[name])) problems.push(wrong(name, 'list', raw[name]));
  }
  if (raw.hold !== undefined && raw.hold !== null && !isMapping(raw.hold)) problems.push(wrong('hold', 'mapping or null', raw.hold));
  return problems;
}

/**
 * Fill in absent collections so callers never branch on undefined. Only an
 * absent container gets its default. One that is present with the wrong type
 * is returned exactly as written, never coerced into the right one, so
 * validateState() rejects it (shapeProblems). A checkpoint that is not a
 * mapping at all is returned as written too.
 */
export function normalizeState(raw) {
  const base = emptyState();
  if (raw === undefined || raw === null) return base;
  if (!isMapping(raw)) return raw;
  const mapping = (written, fallback) => {
    if (written === undefined) return fallback;
    return isMapping(written) ? { ...fallback, ...written } : written;
  };
  const list = (written) => {
    if (written === undefined) return [];
    return Array.isArray(written) ? [...written] : written;
  };
  const state = { ...base, ...raw };
  state.programme = mapping(raw.programme, base.programme);
  state.momentum = mapping(raw.momentum, base.momentum);
  state.correction = mapping(raw.correction, base.correction);
  state.agents = mapping(raw.agents, {});
  state.holds = mapping(raw.holds, {});
  if (isMapping(state.programme)) state.programme.checkpointed = list(state.programme.checkpointed);
  state.unresolved_contradictions = list(raw.unresolved_contradictions);
  state.processed_event_keys = list(raw.processed_event_keys);
  state.event_journal = list(raw.event_journal);
  return state;
}

export function validateState(state) {
  // A container of the wrong type is reported alone: every check below reads
  // through the containers, so none of them means anything until the shape holds.
  const shape = shapeProblems(state);
  if (shape.length) return { ok: false, problems: shape };
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
  const basis = state.authority_basis;
  if (basis !== null && basis !== undefined
    && (typeof basis !== 'object' || !basis.message_id || basis.comment_id === undefined || basis.comment_id === null)) {
    problems.push({ code: 'AUTHORITY_BASIS_INVALID', detail: 'authority_basis must be {message_id, comment_id} or null' });
  }
  for (const [key, hold] of Object.entries(state.holds || {})) {
    if (!hold || typeof hold !== 'object' || hold.packet_id !== key) {
      problems.push({ code: 'HOLD_KEY_MISMATCH', detail: `holds.${key} must be an object whose packet_id is ${key}` });
    }
  }
  if (state.hold?.packet_id && Object.hasOwn(state.holds || {}, state.hold.packet_id)) {
    problems.push({ code: 'HOLD_REPRESENTATION_AMBIGUOUS', detail: `${state.hold.packet_id} is in both hold and holds` });
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

/**
 * Every active hold, packet-keyed holds first in packet order, then a legacy
 * single `hold` (which may name no packet). Deterministic.
 */
export function activeHolds(state) {
  const keyed = Object.keys(state?.holds || {})
    .sort()
    .map((key) => state.holds[key])
    .filter((hold) => hold && hold.active !== false);
  const legacy = state?.hold && state.hold.active !== false ? [state.hold] : [];
  return [...keyed, ...legacy];
}

/** True when this exact underlying event has already been applied. */
export function hasProcessed(state, idempotencyKey) {
  if (!idempotencyKey) return false;
  // A checkpoint whose key list is not a list has recorded nothing readable;
  // validateState() rejects it, so the caller's decision is REPORT_DRIFT.
  if (!Array.isArray(state?.processed_event_keys)) return false;
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
 * Detect drift between programme-state and the durable intelligence board.
 * Reporting only: neither projection advances anything. (`live` in the result
 * is the programme-state value, kept for compatibility.)
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
  shapeProblems,
  SHAPE_INVALID,
  validateState,
  activeHolds,
  hasProcessed,
  recordEvent,
  projectionDrift,
};

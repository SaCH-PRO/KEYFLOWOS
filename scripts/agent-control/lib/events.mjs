/**
 * AUTO-EVENTS — repository-native control event normalization.
 *
 * Every normalized event carries an `idempotency_key` derived from the
 * UNDERLYING event identity, never from the workflow run that observed it.
 * A re-run, a redelivery and a replay of the same underlying event all produce
 * the same key and therefore converge to one journal entry and one state
 * effect. (F3)
 */

import {
  PROFILES,
  claimedAuthorityType,
  envelopeField,
  parseEnvelope,
  rejectionOf,
  validateEnvelope,
} from './control-envelope.mjs';

export const CONTROL_ISSUE = 80;

/** Control-room message types that should wake the orchestrator. */
export const ACTIONABLE_MESSAGE_TYPES = Object.freeze(['RETURN', 'CONTRADICTION', 'MOMENTUM', 'DIRECTIVE', 'REVIEW']);

/** Workflows whose exact-head conclusions gate admission. */
export const REQUIRED_WORKFLOWS = Object.freeze([
  'CI/CD Pipeline',
  'Agent Control Gate',
  'Branch divergence',
  'DAST (HawkScan)',
  // Portable Ubuntu + Windows proof of the control plane and local worker
  // (WORKER-CI-PLATFORM-001). Deliberately NOT "KEYFLOWOS Agent Autopilot":
  // its workflow_run-triggered runs share the PR head sha but skip self-test,
  // so a latest-run-by-name lookup would count a run that proved nothing.
  'Agent Control Worker Proof',
]);

/**
 * Read a top-level `key: value` from a control message body, through the one
 * #80 envelope parser (lib/control-envelope.mjs). Anchored to line start so a
 * mention inside prose cannot spoof a field; null when absent, null or repeated.
 */
export function readField(body, key) {
  return envelopeField(parseEnvelope(body), key);
}

function messageFields(env) {
  return {
    message_id: envelopeField(env, 'message_id'),
    message_type: envelopeField(env, 'message_type'),
    packet_id: envelopeField(env, 'packet_id'),
    sender: envelopeField(env, 'sender'),
    state: envelopeField(env, 'state'),
    health: envelopeField(env, 'health'),
    source_main: envelopeField(env, 'source_main'),
    implementation_branch: envelopeField(env, 'implementation_branch'),
  };
}

export function parseControlMessage(body = '') {
  return messageFields(parseEnvelope(body));
}

/** Stable hour bucket so repeated scheduled ticks in one hour collapse. */
function hourBucket(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString().slice(0, 13);
}

function ignored(kind, source, detail) {
  return { actionable: false, kind, source, idempotency_key: null, detail: detail || null };
}

/**
 * @param {string} eventName GITHUB_EVENT_NAME
 * @param {object} payload   parsed GITHUB_EVENT_PATH contents
 * @param {object} [options] { now } for deterministic tests
 */
export function normalizeEvent(eventName, payload = {}, options = {}) {
  const now = options.now || new Date().toISOString();

  if (eventName === 'issue_comment') {
    if (payload.issue?.number !== CONTROL_ISSUE) return ignored('IGNORE', 'issue_comment', 'not the control issue');
    const comment = payload.comment || {};
    const env = parseEnvelope(comment.body || '');
    const msg = messageFields(env);
    // Comment id is stable across workflow re-runs and webhook redeliveries.
    if (comment.id === undefined || comment.id === null) {
      return ignored('MALFORMED', 'issue_comment', 'comment has no id; cannot derive a stable key');
    }
    // A repeated or badly quoted field makes the whole envelope ambiguous;
    // it is recorded, never acted on.
    const kind = env.problems.length ? 'MALFORMED' : msg.message_type || 'CONTROL_COMMENT';
    let actionable = ACTIONABLE_MESSAGE_TYPES.includes(kind);
    // An authority-typed message wakes nothing unless it IS authority under the
    // shared AUTHORITY profile: ChatGPT sender, allowlisted author, full envelope.
    let authority = null;
    if (kind !== 'MALFORMED' && claimedAuthorityType(env)) {
      const author = comment.user?.login || null;
      const rejection = rejectionOf(env, author);
      const problems = rejection ? [rejection] : validateEnvelope(env, PROFILES.AUTHORITY);
      authority = { valid: problems.length === 0, problems };
      if (problems.length) actionable = false;
    }
    return {
      actionable,
      kind,
      source: 'issue_comment',
      idempotency_key: `issue_comment:${comment.id}:${payload.action || 'created'}`,
      comment_id: comment.id,
      author: comment.user?.login || null,
      ref: comment.html_url || null,
      observed_at: now,
      ...msg,
      envelope_problems: env.problems,
      authority,
    };
  }

  if (eventName === 'pull_request_target' || eventName === 'pull_request') {
    const pr = payload.pull_request || {};
    const headRef = String(pr.head?.ref || '');
    if (!headRef.startsWith('impl/')) return ignored('IGNORE', eventName, 'not an implementation branch');
    const merged = payload.action === 'closed' && pr.merged === true;
    if (merged && !pr.merge_commit_sha) {
      return ignored('MALFORMED', eventName, 'merged PR without a merge commit sha');
    }
    return {
      actionable: merged,
      kind: merged ? 'PR_MERGED' : 'PR_EVENT',
      source: eventName,
      // Merge identity is the merge commit: replaying the close event converges.
      idempotency_key: merged
        ? `pr_merged:${pr.number}:${pr.merge_commit_sha}`
        : `pr_event:${pr.number}:${pr.head?.sha}:${payload.action || 'unknown'}`,
      pr_number: pr.number,
      head_sha: pr.head?.sha || null,
      base_sha: pr.base?.sha || null,
      merge_commit_sha: pr.merge_commit_sha || null,
      branch: headRef,
      ref: pr.html_url || null,
      observed_at: now,
    };
  }

  if (eventName === 'workflow_run') {
    const run = payload.workflow_run || {};
    if (run.id === undefined || run.id === null) {
      return ignored('MALFORMED', 'workflow_run', 'workflow_run has no id');
    }
    const pr = (run.pull_requests || [])[0];
    const completed = run.status === 'completed';
    return {
      // A workflow completion is only actionable when it belongs to a PR;
      // without one there is nothing to admit.
      actionable: completed && Boolean(pr),
      kind: pr ? 'WORKFLOW_COMPLETED' : 'WORKFLOW_NO_PR',
      source: 'workflow_run',
      // run id + attempt is the underlying identity; re-running the OBSERVER
      // workflow does not change it.
      idempotency_key: `workflow_run:${run.id}:${run.run_attempt || 1}`,
      workflow: run.name || null,
      conclusion: run.conclusion || null,
      head_sha: run.head_sha || null,
      pr_number: pr?.number ?? null,
      required_workflow: REQUIRED_WORKFLOWS.includes(run.name),
      ref: run.html_url || null,
      observed_at: now,
    };
  }

  if (eventName === 'schedule') {
    return {
      actionable: true,
      kind: 'SCHEDULED_RECONCILE',
      source: 'schedule',
      // Collapses duplicate ticks inside one hour; a genuinely new hour is new work.
      idempotency_key: `schedule:${hourBucket(payload.schedule_time || now)}`,
      observed_at: now,
    };
  }

  if (eventName === 'workflow_dispatch') {
    const runId = payload.__run_id || process.env.GITHUB_RUN_ID || 'manual';
    return {
      actionable: true,
      kind: 'MANUAL_RECONCILE',
      source: 'workflow_dispatch',
      // Manual dispatch is intentionally NOT deduplicated: an operator asking
      // twice means twice. This is the one place a run id is the right identity.
      idempotency_key: `manual:${runId}`,
      pr_number: payload.inputs?.pr_number ? Number(payload.inputs.pr_number) : null,
      observed_at: now,
    };
  }

  return ignored('IGNORE', eventName || 'unknown', 'unhandled event type');
}

/**
 * THE MUTATION LOCK. (F1, META-P1-CONCURRENCY-CROSS-PATH-001)
 *
 * Every path that can MUTATE programme state — merge, checkpoint, state
 * advancement — serializes on this one constant identity, whatever event
 * triggered it.
 *
 * It is deliberately a single global constant rather than a per-packet or
 * per-PR key. Any key that varies by event partitions the mutating paths, and
 * a partition is exactly the defect: a scheduled sweep iterating every open
 * impl/* PR and an event-driven job for one of those PRs would land in
 * different groups and run at the same time. Exact-head merge guards stop a
 * wrong tree being merged; they do not create mutual exclusion.
 *
 * The cost is that programme advancement is globally serialized. That is the
 * intended trade: the programme advances one packet at a time by design, so
 * there is nothing to gain from parallel mutation and a correctness invariant
 * to lose.
 */
export const MUTATION_LOCK = 'keyflow-agent-control-mutation';

export function mutationLockKey() {
  return MUTATION_LOCK;
}

/**
 * OBSERVATION grouping only — never a mutual-exclusion identity for mutation.
 *
 * Used to label and de-duplicate read-only event handling, where running two
 * observers for different PRs concurrently is fine and desirable. Callers that
 * are about to mutate must use mutationLockKey() instead.
 */
export function observationKey(event, activePacketId) {
  const packet = activePacketId || event?.packet_id || null;
  if (packet) return `packet:${packet}`;
  if (event?.pr_number) return `pr:${event.pr_number}`;
  return 'programme:KEYFLOWOS';
}

export default {
  normalizeEvent,
  parseControlMessage,
  readField,
  mutationLockKey,
  observationKey,
  MUTATION_LOCK,
  CONTROL_ISSUE,
  ACTIONABLE_MESSAGE_TYPES,
  REQUIRED_WORKFLOWS,
};

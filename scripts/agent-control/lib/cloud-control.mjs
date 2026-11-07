/**
 * CLOUD-CONTROL — Phase 1 Cloud-Native Multi-Agent Control Plane
 * (KF-META-CLOUD-DISPATCH-001)
 *
 * Provider-neutral engineering task contract, durable lease/ownership and
 * branch-collision protection, uncertain-execution replay gate, manual-trigger
 * GitHub cloud handoff interface, read-only preflight evaluator, and durable
 * cross-provider continuity/failover record.
 *
 * Hard safety invariants:
 *   1. No task envelope, lease, adapter, or workflow in Phase 1 may grant merge
 *      authority, authorize production mutation, or post action-triggering
 *      DIRECTIVE/REVIEW commands to Issue #80.
 *   2. Ownership is bound to (task_id, packet_id, implementation_branch,
 *      provider, agent_identity, lease_id). Two active tasks may never share a
 *      packet or implementation branch.
 *   3. An expired or revoked lease authorizes nothing.
 *   4. An uncertain execution outcome (timeout, transport drop, or partial run
 *      without a verified handoff) enters UNCERTAIN_RESULT and blocks replay or
 *      re-claim even after lease expiry until architecture_authority records an
 *      explicit reconciliation clearance bound to the observed branch head SHA.
 *   5. No provider may adversarially review work built by the same provider or
 *      agent identity.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AUTHORIZED_AUTHORS } from './control-envelope.mjs';
import { parseYaml, stringifyYaml } from './yaml.mjs';

const AUTHOR_ALLOWLIST = AUTHORIZED_AUTHORS;
const SHA40_RE = /^[0-9a-f]{40}$/;
function isSha40(v) {
  return typeof v === 'string' && SHA40_RE.test(v);
}

export const CLOUD_TASK_SCHEMA = 'keyflowos.cloud-task/v1';
export const CLOUD_HANDOFF_SCHEMA = 'keyflowos.cloud-handoff/v1';
export const CLOUD_REGISTRY_SCHEMA = 'keyflowos.cloud-registry/v1';
export const CANONICAL_REPOSITORY = 'SaCH-PRO/KEYFLOWOS';

export const CLOUD_PROVIDERS = Object.freeze({
  GEMINI: 'gemini',
  KIMI: 'kimi',
  CLAUDE_CLOUD: 'claude-cloud',
  CHATGPT: 'chatgpt',
  COPILOT: 'copilot',
});

export const CLOUD_ROLES = Object.freeze({
  BUILDER: 'builder',
  ADVERSARIAL_REVIEWER: 'adversarial_reviewer',
  ARCHITECTURE_AUTHORITY: 'architecture_authority',
});

/** Which roles each cloud provider may fill in the multi-agent ecosystem. */
export const PROVIDER_CAPABILITIES = Object.freeze({
  [CLOUD_PROVIDERS.GEMINI]: Object.freeze({
    vendor: 'google',
    roles: Object.freeze([CLOUD_ROLES.BUILDER, CLOUD_ROLES.ADVERSARIAL_REVIEWER]),
    id_prefix: 'gemini-',
  }),
  [CLOUD_PROVIDERS.KIMI]: Object.freeze({
    vendor: 'moonshot',
    roles: Object.freeze([CLOUD_ROLES.BUILDER, CLOUD_ROLES.ADVERSARIAL_REVIEWER]),
    id_prefix: 'kimi-',
  }),
  [CLOUD_PROVIDERS.CLAUDE_CLOUD]: Object.freeze({
    vendor: 'anthropic',
    roles: Object.freeze([CLOUD_ROLES.BUILDER]),
    id_prefix: 'claude-',
  }),
  [CLOUD_PROVIDERS.CHATGPT]: Object.freeze({
    vendor: 'openai',
    roles: Object.freeze([CLOUD_ROLES.ARCHITECTURE_AUTHORITY, CLOUD_ROLES.ADVERSARIAL_REVIEWER]),
    id_prefix: 'chatgpt-',
  }),
  [CLOUD_PROVIDERS.COPILOT]: Object.freeze({
    vendor: 'github',
    roles: Object.freeze([CLOUD_ROLES.ADVERSARIAL_REVIEWER]),
    id_prefix: 'copilot-',
  }),
});

export const CLOUD_TASK_STATES = Object.freeze({
  ISSUED: 'ISSUED',
  CLAIMED: 'CLAIMED',
  EXECUTING: 'EXECUTING',
  PROVING: 'PROVING',
  UNCERTAIN_RESULT: 'UNCERTAIN_RESULT',
  HANDOFF_READY: 'HANDOFF_READY',
  COMPLETED_DRAFT: 'COMPLETED_DRAFT',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
});

const ACTIVE_LEASE_STATES = new Set([
  CLOUD_TASK_STATES.CLAIMED,
  CLOUD_TASK_STATES.EXECUTING,
  CLOUD_TASK_STATES.PROVING,
]);

export const CLOUD_RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Allowed Phase 1 approval levels. Autonomous merge and production deployment
 * are explicitly excluded so a task envelope can never self-authorize them.
 */
export const CLOUD_APPROVAL_LEVELS = Object.freeze([
  'DRAFT_EVALUATION_ONLY',
  'PACKET_IMPLEMENTATION',
  'ADMISSION_CANDIDATE',
]);

export const CLOUD_AUTHORITY_KINDS = Object.freeze([
  'ISSUE_80_DIRECTIVE',
  'PR_COORDINATION_NOTE',
  'OPERATOR_CLOUD_HANDOFF',
]);

export const CLOUD_DISPATCH_STATUS = Object.freeze({
  MANUAL_GITHUB_HANDOFF_READY: 'MANUAL_GITHUB_HANDOFF_READY',
  DEFERRED_UNATTENDED_INVOCATION: 'DEFERRED_UNATTENDED_INVOCATION',
  REJECTED: 'REJECTED',
});

export const CLOUD_REASONS = Object.freeze({
  OK: 'ok',
  TASK_INVALID: 'cloud_task_invalid',
  AUTHORITY_MISSING: 'cloud_authority_missing',
  AUTHORITY_INVALID: 'cloud_authority_invalid',
  INVALID_SOURCE_COMMIT: 'cloud_invalid_source_commit',
  SOURCE_COMMIT_NOT_ON_MAIN: 'cloud_source_commit_not_on_main',
  WRONG_PROVIDER: 'cloud_wrong_provider',
  WRONG_RECIPIENT: 'cloud_wrong_recipient',
  ROLE_NOT_SUPPORTED: 'cloud_role_not_supported_by_provider',
  SELF_REVIEW_FORBIDDEN: 'cloud_self_review_forbidden',
  DUPLICATE_TASK_CLAIM: 'cloud_duplicate_task_claim',
  IDEMPOTENCY_REPLAY_BLOCKED: 'cloud_idempotency_replay_blocked',
  BRANCH_COLLISION: 'cloud_branch_collision',
  PACKET_COLLISION: 'cloud_packet_collision',
  LEASE_MISSING: 'cloud_lease_missing',
  LEASE_EXPIRED: 'cloud_lease_expired',
  LEASE_REVOKED: 'cloud_lease_revoked',
  OWNER_MISMATCH: 'cloud_owner_mismatch',
  UNCERTAIN_EXECUTION_REPLAY_BLOCKED: 'cloud_uncertain_execution_replay_blocked',
  RECONCILIATION_CLEARANCE_INVALID: 'cloud_reconciliation_clearance_invalid',
  MERGE_NOT_AUTHORIZED: 'cloud_merge_not_authorized',
  PRODUCTION_NOT_AUTHORIZED: 'cloud_production_not_authorized',
  LEGACY_ISSUE80_TRIGGER_FORBIDDEN: 'cloud_legacy_issue80_trigger_forbidden',
  SCOPE_VIOLATION: 'cloud_scope_violation',
  STALE_COMPLETION_EVIDENCE: 'cloud_stale_completion_evidence',
  HANDOFF_INVALID: 'cloud_handoff_invalid',
  PROVIDER_FAILOVER_UNSAFE: 'cloud_provider_failover_unsafe',
  REGISTRY_INTEGRITY_FAILED: 'cloud_registry_integrity_failed',
});

const TASK_ID_RE = /^CT-[A-Za-z0-9._-]{4,120}$/;
const PACKET_ID_RE = /^KF-[A-Z0-9-]{3,80}$/;
const LEASE_ID_RE = /^LEASE-[A-Za-z0-9._-]{4,120}$/;
const IMPL_BRANCH_RE = /^impl\/[a-z0-9._-]{3,120}$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '' && v === v.trim();
}

function isIsoUtc(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)) {
    return false;
  }
  return Number.isFinite(Date.parse(v));
}

function isSafeRepoPath(p) {
  if (!isNonEmptyString(p)) return false;
  if (p.startsWith('/') || p.startsWith('\\') || p.includes('..') || p.includes('\\')) return false;
  return true;
}

/**
 * Matches a repository-relative path against a task scope pattern.
 * Supports exact paths, directory prefixes ending with `/`, `/**` suffix globs,
 * and single-segment `*` wildcards.
 */
export function matchesScopePattern(filePath, pattern) {
  if (!isSafeRepoPath(filePath) || !isSafeRepoPath(pattern)) return false;
  if (filePath === pattern) return true;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern);
  }
  if (pattern.includes('*')) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]+');
    return new RegExp(`^${escaped}$`).test(filePath);
  }
  return false;
}

/**
 * Deterministic idempotency key for a cloud engineering task attempt.
 * Transient workflow run IDs are never accepted as part of the key.
 */
export function buildCloudIdempotencyKey({ task_id, packet_id, source_main, attempt = 1 }) {
  if (!TASK_ID_RE.test(String(task_id || ''))) {
    throw new Error(`Invalid task_id for idempotency key: ${task_id}`);
  }
  if (!PACKET_ID_RE.test(String(packet_id || ''))) {
    throw new Error(`Invalid packet_id for idempotency key: ${packet_id}`);
  }
  if (!isSha40(source_main)) {
    throw new Error(`Invalid source_main for idempotency key: ${source_main}`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Invalid attempt for idempotency key: ${attempt}`);
  }
  return `cloud_task:${task_id}:${packet_id}:${source_main}:${attempt}`;
}

/**
 * Validates the authority provenance block of a cloud task.
 */
export function validateTaskAuthority(authority, { allowlistedAuthors = AUTHOR_ALLOWLIST } = {}) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return { ok: false, reason: CLOUD_REASONS.AUTHORITY_MISSING, problems: ['authority block is required'] };
  }
  const problems = [];
  if (!CLOUD_AUTHORITY_KINDS.includes(authority.kind)) {
    problems.push(`authority.kind must be one of ${CLOUD_AUTHORITY_KINDS.join(', ')}`);
  }
  if (!isNonEmptyString(authority.reference)) {
    problems.push('authority.reference must be a non-empty string');
  }
  if (!isNonEmptyString(authority.author) || !allowlistedAuthors.includes(authority.author)) {
    problems.push(`authority.author must be in allowlist (${allowlistedAuthors.join(', ')})`);
  }
  if (authority.merge_authority !== false) {
    return { ok: false, reason: CLOUD_REASONS.MERGE_NOT_AUTHORIZED, problems: ['authority.merge_authority must be false'] };
  }
  if (authority.production_touched !== false) {
    return { ok: false, reason: CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED, problems: ['authority.production_touched must be false'] };
  }
  if (authority.triggers_legacy_issue80 === true) {
    return { ok: false, reason: CLOUD_REASONS.LEGACY_ISSUE80_TRIGGER_FORBIDDEN, problems: ['authority must not trigger legacy Issue #80 commands'] };
  }
  if (problems.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.AUTHORITY_INVALID, problems };
  }
  return { ok: true, reason: CLOUD_REASONS.OK, problems: [] };
}

/**
 * Validates a lease object attached to a cloud task.
 */
export function validateCloudLease(lease, task = null) {
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) {
    return { ok: false, reason: CLOUD_REASONS.LEASE_MISSING, problems: ['lease object is required'] };
  }
  const problems = [];
  if (!LEASE_ID_RE.test(String(lease.lease_id || ''))) {
    problems.push('lease.lease_id must match /^LEASE-[A-Za-z0-9._-]{4,120}$/');
  }
  if (!Object.values(CLOUD_PROVIDERS).includes(lease.holder_provider)) {
    problems.push('lease.holder_provider is invalid');
  }
  if (!isNonEmptyString(lease.holder_agent_id)) {
    problems.push('lease.holder_agent_id must be a non-empty string');
  }
  if (!IMPL_BRANCH_RE.test(String(lease.implementation_branch || ''))) {
    problems.push('lease.implementation_branch must be a valid impl/* branch');
  }
  if (!isIsoUtc(lease.acquired_at)) {
    problems.push('lease.acquired_at must be an ISO-8601 UTC timestamp');
  }
  if (!isIsoUtc(lease.expires_at)) {
    problems.push('lease.expires_at must be an ISO-8601 UTC timestamp');
  }
  if (isIsoUtc(lease.acquired_at) && isIsoUtc(lease.expires_at)) {
    if (Date.parse(lease.expires_at) <= Date.parse(lease.acquired_at)) {
      problems.push('lease.expires_at must be strictly after lease.acquired_at');
    }
  }
  if (typeof lease.revoked !== 'boolean') {
    problems.push('lease.revoked must be a boolean');
  }
  if (typeof lease.execution_uncertain !== 'boolean') {
    problems.push('lease.execution_uncertain must be a boolean');
  }
  if (task) {
    if (lease.holder_provider !== task.provider) {
      problems.push('lease.holder_provider must match task.provider');
    }
    if (lease.holder_agent_id !== task.agent_identity) {
      problems.push('lease.holder_agent_id must match task.agent_identity');
    }
    if (lease.implementation_branch !== task.implementation_branch) {
      problems.push('lease.implementation_branch must match task.implementation_branch');
    }
  }
  if (problems.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.TASK_INVALID, problems };
  }
  return { ok: true, reason: CLOUD_REASONS.OK, problems: [] };
}

/**
 * Validates a structured cloud engineering task envelope (Requirement 3.A).
 */
export function validateCloudTask(task, options = {}) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return { ok: false, reason: CLOUD_REASONS.TASK_INVALID, problems: ['task must be an object'] };
  }

  // Fast-path security and authority checks so specific reasons surface deterministically.
  if (task.merge_authority === true || task.approval_level === 'AUTONOMOUS_MERGE') {
    return { ok: false, reason: CLOUD_REASONS.MERGE_NOT_AUTHORIZED, problems: ['cloud tasks cannot grant merge authority'] };
  }
  if (task.production_touched === true || task.approval_level === 'PRODUCTION_DEPLOY') {
    return { ok: false, reason: CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED, problems: ['cloud tasks cannot authorize production deployment or mutation'] };
  }
  if (task.post_issue80_directive === true) {
    return { ok: false, reason: CLOUD_REASONS.LEGACY_ISSUE80_TRIGGER_FORBIDDEN, problems: ['cloud tasks must not post action-triggering directives to Issue #80'] };
  }

  const authCheck = validateTaskAuthority(task.authority, options);
  if (!authCheck.ok) {
    return authCheck;
  }

  if (!isSha40(task.source_main)) {
    return { ok: false, reason: CLOUD_REASONS.INVALID_SOURCE_COMMIT, problems: ['source_main must be a 40-character lowercase hex SHA'] };
  }
  if (options.expectedMainSha && task.source_main !== options.expectedMainSha) {
    return {
      ok: false,
      reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
      problems: [`source_main ${task.source_main} does not match expected main ${options.expectedMainSha}`],
    };
  }
  if (options.sourceMainOnMain === false) {
    return {
      ok: false,
      reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
      problems: [`source_main ${task.source_main} is not on main`],
    };
  }

  const capability = PROVIDER_CAPABILITIES[task.provider];
  if (!capability) {
    return { ok: false, reason: CLOUD_REASONS.WRONG_PROVIDER, problems: [`unknown provider: ${task.provider}`] };
  }
  const role = task.role || CLOUD_ROLES.BUILDER;
  if (!capability.roles.includes(role)) {
    return {
      ok: false,
      reason: CLOUD_REASONS.ROLE_NOT_SUPPORTED,
      problems: [`provider ${task.provider} does not support role ${role}`],
    };
  }
  if (!isNonEmptyString(task.agent_identity) || !task.agent_identity.startsWith(capability.id_prefix)) {
    return {
      ok: false,
      reason: CLOUD_REASONS.WRONG_RECIPIENT,
      problems: [`agent_identity "${task.agent_identity}" does not match provider prefix "${capability.id_prefix}"`],
    };
  }
  if (role === CLOUD_ROLES.ADVERSARIAL_REVIEWER) {
    const builderCap = PROVIDER_CAPABILITIES[task.builder_provider];
    if (
      !builderCap ||
      !builderCap.roles.includes(CLOUD_ROLES.BUILDER) ||
      !isNonEmptyString(task.builder_agent_identity) ||
      !task.builder_agent_identity.startsWith(builderCap.id_prefix)
    ) {
      return {
        ok: false,
        reason: CLOUD_REASONS.TASK_INVALID,
        problems: [
          'adversarial_reviewer task requires valid builder_provider and builder_agent_identity provenance',
        ],
      };
    }
    if (
      task.builder_provider === task.provider ||
      task.builder_agent_identity === task.agent_identity
    ) {
      return {
        ok: false,
        reason: CLOUD_REASONS.SELF_REVIEW_FORBIDDEN,
        problems: ['adversarial reviewer must not share provider or agent_identity with the builder'],
      };
    }
  }

  const problems = [];
  if (task.schema !== CLOUD_TASK_SCHEMA) {
    problems.push(`schema must be ${CLOUD_TASK_SCHEMA}`);
  }
  if (!TASK_ID_RE.test(String(task.task_id || ''))) {
    problems.push('task_id must match /^CT-[A-Za-z0-9._-]{4,120}$/');
  }
  if (!PACKET_ID_RE.test(String(task.packet_id || ''))) {
    problems.push('packet_id must match /^KF-[A-Z0-9-]{3,80}$/');
  }
  if (task.repository !== (options.expectedRepository || CANONICAL_REPOSITORY)) {
    problems.push(`repository must be ${options.expectedRepository || CANONICAL_REPOSITORY}`);
  }
  if (task.source_head !== null && task.source_head !== undefined && !isSha40(task.source_head)) {
    problems.push('source_head must be null or a 40-character lowercase hex SHA');
  }
  if (!IMPL_BRANCH_RE.test(String(task.implementation_branch || ''))) {
    problems.push('implementation_branch must match /^impl\\/[a-z0-9._-]{3,120}$/');
  }
  if (!Array.isArray(task.allowed_scope) || task.allowed_scope.length === 0 || !task.allowed_scope.every(isSafeRepoPath)) {
    problems.push('allowed_scope must be a non-empty array of safe repository-relative paths');
  }
  if (!Array.isArray(task.prohibited_scope) || !task.prohibited_scope.every(isSafeRepoPath)) {
    problems.push('prohibited_scope must be an array of safe repository-relative paths');
  }
  if (!Array.isArray(task.required_tests) || task.required_tests.length === 0 || !task.required_tests.every(isNonEmptyString)) {
    problems.push('required_tests must be a non-empty array of non-empty strings');
  }
  if (!Array.isArray(task.required_evidence) || task.required_evidence.length === 0 || !task.required_evidence.every(isNonEmptyString)) {
    problems.push('required_evidence must be a non-empty array of non-empty strings');
  }
  if (!CLOUD_RISK_LEVELS.includes(task.risk_level)) {
    problems.push(`risk_level must be one of ${CLOUD_RISK_LEVELS.join(', ')}`);
  }
  if (!CLOUD_APPROVAL_LEVELS.includes(task.approval_level)) {
    problems.push(`approval_level must be one of ${CLOUD_APPROVAL_LEVELS.join(', ')}`);
  }
  if (!Object.values(CLOUD_TASK_STATES).includes(task.state)) {
    problems.push(`state must be a valid CLOUD_TASK_STATES value`);
  }

  const attempt = task.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) {
    problems.push('attempt must be a positive integer');
  } else if (
    TASK_ID_RE.test(String(task.task_id || '')) &&
    PACKET_ID_RE.test(String(task.packet_id || '')) &&
    isSha40(task.source_main)
  ) {
    const expectedKey = buildCloudIdempotencyKey({
      task_id: task.task_id,
      packet_id: task.packet_id,
      source_main: task.source_main,
      attempt,
    });
    if (task.idempotency_key !== expectedKey) {
      problems.push(`idempotency_key must equal ${expectedKey}`);
    }
  }

  if (ACTIVE_LEASE_STATES.has(task.state) || task.lease !== null) {
    if (task.lease === null) {
      return { ok: false, reason: CLOUD_REASONS.LEASE_MISSING, problems: [`lease is required when state is ${task.state}`] };
    }
    const leaseCheck = validateCloudLease(task.lease, task);
    if (!leaseCheck.ok) return leaseCheck;
  }

  if (problems.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.TASK_INVALID, problems };
  }
  return { ok: true, reason: CLOUD_REASONS.OK, problems: [] };
}

/**
 * Verifies that every changed file in a candidate implementation falls within
 * `allowed_scope` and does not match any entry in `prohibited_scope`.
 */
export function verifyChangedFilesInScope(task, changedFiles) {
  if (!Array.isArray(changedFiles)) {
    return { ok: false, reason: CLOUD_REASONS.SCOPE_VIOLATION, violations: ['changedFiles must be an array'] };
  }
  const allowed = Array.isArray(task?.allowed_scope) ? task.allowed_scope : [];
  const prohibited = Array.isArray(task?.prohibited_scope) ? task.prohibited_scope : [];
  const violations = [];
  for (const file of changedFiles) {
    if (!isSafeRepoPath(file)) {
      violations.push(`${file} (unsafe path)`);
      continue;
    }
    if (prohibited.some((pat) => matchesScopePattern(file, pat))) {
      violations.push(`${file} (prohibited scope)`);
      continue;
    }
    if (!allowed.some((pat) => matchesScopePattern(file, pat))) {
      violations.push(`${file} (outside allowed_scope)`);
    }
  }
  if (violations.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.SCOPE_VIOLATION, violations };
  }
  return { ok: true, reason: CLOUD_REASONS.OK, violations: [] };
}

const RESERVED_BRANCH_STATES = new Set([
  CLOUD_TASK_STATES.CLAIMED,
  CLOUD_TASK_STATES.EXECUTING,
  CLOUD_TASK_STATES.PROVING,
  CLOUD_TASK_STATES.HANDOFF_READY,
  CLOUD_TASK_STATES.COMPLETED_DRAFT,
]);

/**
 * Evaluates whether a claimant (`provider`, `agent_identity`) can acquire a
 * lease on `task` given existing registry state (`existingTasks`,
 * `recordedIdempotencyKeys`) and the current UTC timestamp `nowIso`
 * (Requirement 3.B, Mandatory Verification 1, 2, 3, 4, 8).
 */
export function evaluateLeaseAcquisition({
  task,
  claimantProvider,
  claimantAgentId,
  leaseId,
  nowIso,
  ttlSeconds = 3600,
  existingTasks = [],
  recordedIdempotencyKeys = [],
  reconciliationClearance = null,
  observedBranchHead = null,
  consumedClearanceIds = [],
}) {
  const valid = validateCloudTask(task);
  if (!valid.ok) return valid;

  if (!isIsoUtc(nowIso)) {
    return { ok: false, reason: CLOUD_REASONS.TASK_INVALID, problems: ['nowIso must be an ISO-8601 UTC timestamp'] };
  }
  if (claimantProvider !== task.provider) {
    return {
      ok: false,
      reason: CLOUD_REASONS.WRONG_PROVIDER,
      problems: [`claimant provider "${claimantProvider}" does not match task provider "${task.provider}"`],
    };
  }
  if (claimantAgentId !== task.agent_identity) {
    return {
      ok: false,
      reason: CLOUD_REASONS.WRONG_RECIPIENT,
      problems: [`claimant agent "${claimantAgentId}" does not match task agent_identity "${task.agent_identity}"`],
    };
  }

  const persistedSameTask =
    existingTasks.find((t) => t && typeof t === 'object' && t.task_id === task.task_id) || null;
  const persistedUncertain =
    persistedSameTask &&
    (persistedSameTask.state === CLOUD_TASK_STATES.UNCERTAIN_RESULT ||
      persistedSameTask.lease?.execution_uncertain === true);
  const submittedUncertain =
    task.state === CLOUD_TASK_STATES.UNCERTAIN_RESULT || task.lease?.execution_uncertain === true;
  const clearanceTarget = persistedUncertain ? persistedSameTask : task;

  // Gate 8: Replay after an uncertain execution result is blocked even if the
  // prior lease expired, unless an explicit reconciliation clearance from
  // architecture_authority (chatgpt / SaCH-PRO) is provided.
  if (task.state === CLOUD_TASK_STATES.UNCERTAIN_RESULT || task.lease?.execution_uncertain === true) {
    const clearance = verifyUncertainExecutionClearance(clearanceTarget, reconciliationClearance, {
      observedBranchHead,
      consumedClearanceIds,
    });
    if (!clearance.ok) {
      return {
        ok: false,
        reason: clearance.reason,
        problems: clearance.problems,
      };
    }
  }

  if (persistedUncertain) {
    const clearance = verifyUncertainExecutionClearance(persistedSameTask, reconciliationClearance, {
      observedBranchHead,
      consumedClearanceIds,
    });
    if (!clearance.ok) {
      return {
        ok: false,
        reason: clearance.reason,
        problems: clearance.problems,
      };
    }
  }

  if (reconciliationClearance !== null) {
    if (!submittedUncertain && !persistedUncertain) {
      return {
        ok: false,
        reason: CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID,
        problems: ['reconciliation_clearance cannot be used when the task is not in UNCERTAIN_RESULT'],
      };
    }
    if (reconciliationClearance.disposition === 'ABORT_AND_REISSUE') {
      return {
        ok: false,
        reason: CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID,
        problems: ['reconciliation_clearance disposition ABORT_AND_REISSUE aborts this task; issue a new task_id'],
      };
    }
  }

  // Gate 1: Duplicate task claim or replayed idempotency key.
  if (recordedIdempotencyKeys.includes(task.idempotency_key) && !reconciliationClearance) {
    return {
      ok: false,
      reason: CLOUD_REASONS.DUPLICATE_TASK_CLAIM,
      problems: [`idempotency_key ${task.idempotency_key} has already been claimed`],
    };
  }

  const nowMs = Date.parse(nowIso);
  for (const other of existingTasks) {
    if (!other || typeof other !== 'object') continue;
    const otherLease = other.lease;
    const otherUncertain = other.state === CLOUD_TASK_STATES.UNCERTAIN_RESULT || otherLease?.execution_uncertain === true;
    const otherActive =
      otherLease &&
      otherLease.revoked === false &&
      Date.parse(otherLease.expires_at) > nowMs &&
      ACTIVE_LEASE_STATES.has(other.state);
    const otherReservesBranch =
      otherActive ||
      (otherLease &&
        otherLease.revoked === false &&
        RESERVED_BRANCH_STATES.has(other.state) &&
        (Date.parse(otherLease.expires_at) > nowMs ||
          other.state === CLOUD_TASK_STATES.HANDOFF_READY ||
          other.state === CLOUD_TASK_STATES.COMPLETED_DRAFT));

    if (other.task_id === task.task_id) {
      if (otherUncertain && !reconciliationClearance) {
        return {
          ok: false,
          reason: CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED,
          problems: [`task ${task.task_id} has an unresolved uncertain execution result`],
        };
      }
      if (otherReservesBranch && !reconciliationClearance) {
        return {
          ok: false,
          reason: CLOUD_REASONS.DUPLICATE_TASK_CLAIM,
          problems: [`task ${task.task_id} is already leased or completed by ${otherLease.holder_agent_id} (${otherLease.lease_id})`],
        };
      }
      continue;
    }

    // Gate 2: Conflicting branch or packet ownership across distinct tasks.
    if (otherReservesBranch || otherUncertain) {
      if (other.implementation_branch === task.implementation_branch) {
        return {
          ok: false,
          reason: CLOUD_REASONS.BRANCH_COLLISION,
          problems: [`branch ${task.implementation_branch} is already owned by task ${other.task_id}`],
        };
      }
      if (other.packet_id === task.packet_id) {
        return {
          ok: false,
          reason: CLOUD_REASONS.PACKET_COLLISION,
          problems: [`packet ${task.packet_id} is already owned by active task ${other.task_id}`],
        };
      }
    }
  }

  const effectiveAttempt = reconciliationClearance
    ? ((clearanceTarget.attempt ?? 1) + 1)
    : (task.attempt ?? 1);
  const effectiveIdempotencyKey = buildCloudIdempotencyKey({
    task_id: task.task_id,
    packet_id: task.packet_id,
    source_main: task.source_main,
    attempt: effectiveAttempt,
  });
  if (reconciliationClearance && recordedIdempotencyKeys.includes(effectiveIdempotencyKey)) {
    return {
      ok: false,
      reason: CLOUD_REASONS.DUPLICATE_TASK_CLAIM,
      problems: [`reconciled idempotency_key ${effectiveIdempotencyKey} has already been claimed`],
    };
  }

  const effectiveSourceHead = reconciliationClearance
    ? reconciliationClearance.disposition === 'CONTINUE_FROM_OBSERVED_HEAD'
      ? reconciliationClearance.observed_branch_head
      : null
    : task.source_head;

  const expiresIso = new Date(nowMs + ttlSeconds * 1000).toISOString();
  const lease = {
    lease_id: leaseId || `LEASE-${task.task_id}-${attemptSuffix(effectiveAttempt)}`,
    holder_provider: claimantProvider,
    holder_agent_id: claimantAgentId,
    implementation_branch: task.implementation_branch,
    acquired_at: nowIso,
    expires_at: expiresIso,
    heartbeat_at: nowIso,
    revoked: false,
    revoked_reason: null,
    execution_uncertain: false,
  };
  const leaseValid = validateCloudLease(lease, task);
  if (!leaseValid.ok) return leaseValid;

  return {
    ok: true,
    reason: CLOUD_REASONS.OK,
    lease,
    consumed_clearance_id: reconciliationClearance?.clearance_id || null,
    task: {
      ...task,
      source_head: effectiveSourceHead,
      attempt: effectiveAttempt,
      idempotency_key: effectiveIdempotencyKey,
      state: CLOUD_TASK_STATES.CLAIMED,
      lease,
    },
  };
}

function attemptSuffix(attempt) {
  return String(attempt).padStart(3, '0');
}

const CLEARANCE_ID_RE = /^CLR-[A-Za-z0-9._-]{4,120}$/;

/**
 * Verifies a reconciliation clearance required before replaying or re-claiming
 * a task whose previous execution ended in `UNCERTAIN_RESULT`.
 */
export function verifyUncertainExecutionClearance(
  task,
  clearance,
  { allowlistedAuthors = AUTHOR_ALLOWLIST, observedBranchHead = null, consumedClearanceIds = [] } = {},
) {
  if (!clearance || typeof clearance !== 'object') {
    return {
      ok: false,
      reason: CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED,
      problems: ['uncertain execution requires explicit reconciliation_clearance before replay'],
    };
  }
  const problems = [];
  if (!CLEARANCE_ID_RE.test(String(clearance.clearance_id || ''))) {
    problems.push('reconciliation_clearance.clearance_id must match /^CLR-[A-Za-z0-9._-]{4,120}$/');
  } else if (Array.isArray(consumedClearanceIds) && consumedClearanceIds.includes(clearance.clearance_id)) {
    problems.push(`reconciliation_clearance.clearance_id ${clearance.clearance_id} has already been consumed`);
  }
  if (clearance.task_id !== task.task_id) {
    problems.push('reconciliation_clearance.task_id does not match task.task_id');
  }
  if (clearance.packet_id !== task.packet_id) {
    problems.push('reconciliation_clearance.packet_id does not match task.packet_id');
  }
  if (task.lease?.lease_id && clearance.uncertain_lease_id !== task.lease.lease_id) {
    problems.push(`reconciliation_clearance.uncertain_lease_id must match uncertain lease (${task.lease.lease_id})`);
  }
  if (clearance.cleared_attempt !== undefined && clearance.cleared_attempt !== (task.attempt ?? 1)) {
    problems.push(`reconciliation_clearance.cleared_attempt (${clearance.cleared_attempt}) does not match task attempt (${task.attempt ?? 1})`);
  }
  if (clearance.cleared_by_provider !== CLOUD_PROVIDERS.CHATGPT) {
    problems.push('reconciliation_clearance.cleared_by_provider must be chatgpt');
  }
  if (!allowlistedAuthors.includes(clearance.author)) {
    problems.push(`reconciliation_clearance.author must be in allowlist (${allowlistedAuthors.join(', ')})`);
  }
  if (!isSha40(clearance.observed_branch_head)) {
    problems.push('reconciliation_clearance.observed_branch_head must be a verified 40-hex SHA');
  } else {
    const expectedObserved = observedBranchHead || task.observed_branch_head || null;
    if (expectedObserved && clearance.observed_branch_head !== expectedObserved) {
      problems.push(
        `reconciliation_clearance.observed_branch_head (${clearance.observed_branch_head}) does not match observed branch head (${expectedObserved})`,
      );
    }
    if (
      clearance.disposition === 'REPLAY_FROM_SOURCE_MAIN' &&
      isSha40(task.source_main) &&
      clearance.observed_branch_head !== task.source_main
    ) {
      problems.push('REPLAY_FROM_SOURCE_MAIN requires observed_branch_head to match task.source_main');
    }
  }
  if (!['REPLAY_FROM_SOURCE_MAIN', 'CONTINUE_FROM_OBSERVED_HEAD', 'ABORT_AND_REISSUE'].includes(clearance.disposition)) {
    problems.push('reconciliation_clearance.disposition must be REPLAY_FROM_SOURCE_MAIN, CONTINUE_FROM_OBSERVED_HEAD, or ABORT_AND_REISSUE');
  }
  if (problems.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID, problems };
  }
  return { ok: true, reason: CLOUD_REASONS.OK, problems: [] };
}

/**
 * Verifies that an actor (`actorProvider`, `actorAgentId`, `leaseId`) currently
 * holds a valid, non-expired, non-revoked, non-uncertain lease on `task` at
 * `nowIso` (Requirement 3.B, Mandatory Verification 2, 3, 4, 8).
 */
export function verifyTaskOwnership({
  task,
  actorProvider,
  actorAgentId,
  leaseId,
  nowIso,
  allowCompletedPreflight = false,
}) {
  const valid = validateCloudTask(task);
  if (!valid.ok) return valid;

  if (!isIsoUtc(nowIso)) {
    return { ok: false, reason: CLOUD_REASONS.TASK_INVALID, problems: ['nowIso must be an ISO-8601 UTC timestamp'] };
  }
  if (task.state === CLOUD_TASK_STATES.UNCERTAIN_RESULT || task.lease?.execution_uncertain === true) {
    return {
      ok: false,
      reason: CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED,
      problems: ['task execution outcome is uncertain; mutations and replays are blocked until reconciled'],
    };
  }
  if (!task.lease) {
    return { ok: false, reason: CLOUD_REASONS.LEASE_MISSING, problems: ['task has no active lease'] };
  }
  if (task.state === CLOUD_TASK_STATES.REVOKED || task.lease.revoked === true) {
    return {
      ok: false,
      reason: CLOUD_REASONS.LEASE_REVOKED,
      problems: [`lease ${task.lease.lease_id} has been revoked: ${task.lease.revoked_reason || 'unspecified'}`],
    };
  }
  if (Date.parse(nowIso) >= Date.parse(task.lease.expires_at)) {
    return {
      ok: false,
      reason: CLOUD_REASONS.LEASE_EXPIRED,
      problems: [`lease ${task.lease.lease_id} expired at ${task.lease.expires_at} (now ${nowIso})`],
    };
  }
  if (actorProvider !== task.provider || actorProvider !== task.lease.holder_provider) {
    return {
      ok: false,
      reason: CLOUD_REASONS.WRONG_PROVIDER,
      problems: [`actor provider "${actorProvider}" does not match lease holder provider "${task.lease.holder_provider}"`],
    };
  }
  if (actorAgentId !== task.agent_identity || actorAgentId !== task.lease.holder_agent_id || leaseId !== task.lease.lease_id) {
    return {
      ok: false,
      reason: CLOUD_REASONS.OWNER_MISMATCH,
      problems: ['actor identity or lease_id does not match active lease holder'],
    };
  }
  const permittedStates = allowCompletedPreflight ? RESERVED_BRANCH_STATES : ACTIVE_LEASE_STATES;
  if (!permittedStates.has(task.state)) {
    return {
      ok: false,
      reason: CLOUD_REASONS.OWNER_MISMATCH,
      problems: [`task in terminal/non-executing state ${task.state} does not authorize active execution`],
    };
  }
  return { ok: true, reason: CLOUD_REASONS.OK, problems: [] };
}

/**
 * Marks a leased task as `UNCERTAIN_RESULT` when an execution attempt times
 * out, drops transport, or fails to produce a deterministic completion record.
 */
export function markExecutionUncertain(task, { reason, nowIso, observedBranchHead = null }) {
  if (!task || !task.lease) {
    throw new Error('Cannot mark uncertain execution on a task without a lease');
  }
  return {
    ...task,
    state: CLOUD_TASK_STATES.UNCERTAIN_RESULT,
    observed_branch_head: isSha40(observedBranchHead)
      ? observedBranchHead
      : (task.source_head || task.source_main),
    lease: {
      ...task.lease,
      heartbeat_at: isIsoUtc(nowIso) ? nowIso : task.lease.heartbeat_at,
      execution_uncertain: true,
    },
    uncertain_reason: reason || 'execution outcome indeterminate',
  };
}

/**
 * Validates a machine-readable continuity/handoff record (Requirement 3.E) and
 * checks that its completion evidence is fresh and consistent with the task
 * and repository state (Mandatory Verification 7).
 */
export function validateCloudHandoff(handoff, { task = null, currentMainSha = null, currentPrHeadSha = null } = {}) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    return { ok: false, reason: CLOUD_REASONS.HANDOFF_INVALID, problems: ['handoff must be an object'] };
  }
  const problems = [];
  if (handoff.schema !== CLOUD_HANDOFF_SCHEMA) {
    problems.push(`handoff.schema must be ${CLOUD_HANDOFF_SCHEMA}`);
  }
  if (!TASK_ID_RE.test(String(handoff.task_id || ''))) {
    problems.push('handoff.task_id is invalid');
  }
  if (!PACKET_ID_RE.test(String(handoff.packet_id || ''))) {
    problems.push('handoff.packet_id is invalid');
  }
  if (!Object.values(CLOUD_PROVIDERS).includes(handoff.provider)) {
    problems.push('handoff.provider is invalid');
  }
  if (!isNonEmptyString(handoff.agent_identity)) {
    problems.push('handoff.agent_identity is required');
  }
  if (!IMPL_BRANCH_RE.test(String(handoff.implementation_branch || ''))) {
    problems.push('handoff.implementation_branch must be a valid impl/* branch');
  }
  if (!isSha40(handoff.source_main)) {
    problems.push('handoff.source_main must be a 40-hex SHA');
  }
  if (!isSha40(handoff.semantic_head)) {
    problems.push('handoff.semantic_head must be a 40-hex SHA');
  }
  if (!isSha40(handoff.pr_head)) {
    problems.push('handoff.pr_head must be a 40-hex SHA');
  }
  if (!isSha40(handoff.evidence_head)) {
    problems.push('handoff.evidence_head must be a 40-hex SHA');
  }
  if (handoff.pr_number !== null && (!Number.isInteger(handoff.pr_number) || handoff.pr_number < 1)) {
    problems.push('handoff.pr_number must be null or a positive integer');
  }
  if (!Array.isArray(handoff.changed_files) || handoff.changed_files.length === 0 || !handoff.changed_files.every(isSafeRepoPath)) {
    problems.push('handoff.changed_files must be a non-empty array of safe repo paths');
  }
  if (!Array.isArray(handoff.decisions) || handoff.decisions.length === 0) {
    problems.push('handoff.decisions must be a non-empty array');
  }
  if (!Array.isArray(handoff.proof_obligations) || handoff.proof_obligations.length === 0) {
    problems.push('handoff.proof_obligations must be a non-empty array');
  }
  if (!handoff.scope_ledger || typeof handoff.scope_ledger !== 'object') {
    problems.push('handoff.scope_ledger is required');
  } else {
    for (const key of ['declared', 'resolved', 'remaining', 'deferred']) {
      if (!Array.isArray(handoff.scope_ledger[key])) {
        problems.push(`handoff.scope_ledger.${key} must be an array`);
      }
    }
  }
  if (!handoff.next_authorized_action || typeof handoff.next_authorized_action !== 'object') {
    problems.push('handoff.next_authorized_action is required');
  } else {
    if (!isNonEmptyString(handoff.next_authorized_action.action)) {
      problems.push('handoff.next_authorized_action.action is required');
    }
    if (handoff.next_authorized_action.merge_authority !== false) {
      return {
        ok: false,
        reason: CLOUD_REASONS.MERGE_NOT_AUTHORIZED,
        problems: ['handoff.next_authorized_action.merge_authority must be false'],
      };
    }
    if (handoff.next_authorized_action.production_touched !== false) {
      return {
        ok: false,
        reason: CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED,
        problems: ['handoff.next_authorized_action.production_touched must be false'],
      };
    }
  }

  if (problems.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.HANDOFF_INVALID, problems };
  }

  // Gate 7: Stale completion evidence checks.
  const staleProblems = [];
  if (handoff.evidence_head !== handoff.pr_head) {
    staleProblems.push(`handoff.evidence_head (${handoff.evidence_head}) does not match handoff.pr_head (${handoff.pr_head})`);
  }
  if (handoff.semantic_head_is_ancestor === false) {
    staleProblems.push('handoff.semantic_head is not an ancestor of handoff.pr_head');
  }
  if (currentMainSha && handoff.source_main !== currentMainSha) {
    staleProblems.push(`handoff.source_main (${handoff.source_main}) is stale against current main (${currentMainSha})`);
  }
  if (currentPrHeadSha && handoff.pr_head !== currentPrHeadSha) {
    staleProblems.push(`handoff.pr_head (${handoff.pr_head}) is stale against current PR head (${currentPrHeadSha})`);
  }
  if (task) {
    if (handoff.provider !== task.provider || (task.lease && handoff.provider !== task.lease.holder_provider)) {
      return {
        ok: false,
        reason: CLOUD_REASONS.WRONG_PROVIDER,
        problems: [
          `handoff provider (${handoff.provider}) does not match task owner provider (${task.provider})`,
        ],
      };
    }
    if (
      handoff.agent_identity !== task.agent_identity ||
      (task.lease && handoff.agent_identity !== task.lease.holder_agent_id)
    ) {
      return {
        ok: false,
        reason: CLOUD_REASONS.OWNER_MISMATCH,
        problems: [
          `handoff agent_identity (${handoff.agent_identity}) does not match task owner (${task.agent_identity})`,
        ],
      };
    }
    if (handoff.task_id !== task.task_id || handoff.packet_id !== task.packet_id) {
      staleProblems.push('handoff task_id/packet_id does not match task');
    }
    if (handoff.source_main !== task.source_main) {
      staleProblems.push('handoff.source_main does not match task.source_main');
    }
    if (handoff.implementation_branch !== task.implementation_branch) {
      staleProblems.push('handoff.implementation_branch does not match task.implementation_branch');
    }
    if (task.lease && handoff.lease_id !== task.lease.lease_id) {
      staleProblems.push(`handoff.lease_id (${handoff.lease_id}) does not match active task lease (${task.lease.lease_id})`);
    }
    const scopeCheck = verifyChangedFilesInScope(task, handoff.changed_files);
    if (!scopeCheck.ok) {
      return scopeCheck;
    }
  }
  if (staleProblems.length > 0) {
    return { ok: false, reason: CLOUD_REASONS.STALE_COMPLETION_EVIDENCE, problems: staleProblems };
  }

  return { ok: true, reason: CLOUD_REASONS.OK, problems: [] };
}

/**
 * Transitions a leased task to `HANDOFF_READY` or `COMPLETED_DRAFT` after
 * verifying lease ownership, scope compliance, and fresh completion evidence.
 */
export function recordTaskCompletion({
  task,
  handoff,
  actorProvider,
  actorAgentId,
  leaseId,
  nowIso,
  currentMainSha = null,
  currentPrHeadSha = null,
}) {
  const ownership = verifyTaskOwnership({ task, actorProvider, actorAgentId, leaseId, nowIso });
  if (!ownership.ok) return ownership;

  const handoffCheck = validateCloudHandoff(handoff, { task, currentMainSha, currentPrHeadSha });
  if (!handoffCheck.ok) return handoffCheck;

  const nextState = handoff.pr_number ? CLOUD_TASK_STATES.COMPLETED_DRAFT : CLOUD_TASK_STATES.HANDOFF_READY;
  return {
    ok: true,
    reason: CLOUD_REASONS.OK,
    task: {
      ...task,
      source_head: handoff.semantic_head,
      state: nextState,
      lease: {
        ...task.lease,
        heartbeat_at: nowIso,
      },
      completion_record: {
        recorded_at: nowIso,
        semantic_head: handoff.semantic_head,
        pr_head: handoff.pr_head,
        evidence_head: handoff.evidence_head,
        pr_number: handoff.pr_number,
        changed_files: [...handoff.changed_files],
        next_authorized_action: handoff.next_authorized_action,
      },
    },
  };
}

/**
 * Prepares a safe cross-provider failover handoff when the current provider
 * fails or exhausts capacity (Requirement 3.E, Mandatory Verification 9).
 *
 * Refuses failover if:
 *   - the previous task is in `UNCERTAIN_RESULT` without a reconciliation clearance;
 *   - the handoff record is invalid or has stale/mismatched heads;
 *   - the new provider/agent does not support the task role; or
 *   - authority is missing/invalid.
 */
export function prepareProviderFailoverHandoff({
  task,
  handoff,
  nextProvider,
  nextAgentIdentity,
  nextTaskId,
  nextLeaseId,
  authority,
  nowIso,
  ttlSeconds = 3600,
  reconciliationClearance = null,
  observedBranchHead = null,
  consumedClearanceIds = [],
}) {
  const taskCheck = validateCloudTask(task);
  if (!taskCheck.ok) return taskCheck;

  if (task.state === CLOUD_TASK_STATES.UNCERTAIN_RESULT || task.lease?.execution_uncertain === true) {
    const clearance = verifyUncertainExecutionClearance(task, reconciliationClearance, {
      observedBranchHead: observedBranchHead || handoff?.pr_head || null,
      consumedClearanceIds,
    });
    if (!clearance.ok) {
      return {
        ok: false,
        reason: CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED,
        problems: clearance.problems,
      };
    }
    if (reconciliationClearance.disposition === 'ABORT_AND_REISSUE') {
      return {
        ok: false,
        reason: CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED,
        problems: ['reconciliation_clearance disposition ABORT_AND_REISSUE aborts this task; failover continuation is forbidden'],
      };
    }
  }

  const handoffCheck = validateCloudHandoff(handoff, { task });
  if (!handoffCheck.ok) return handoffCheck;

  if (nextProvider === task.provider && nextAgentIdentity === task.agent_identity) {
    return {
      ok: false,
      reason: CLOUD_REASONS.PROVIDER_FAILOVER_UNSAFE,
      problems: ['failover target must be a distinct provider or agent identity'],
    };
  }

  const revokedPreviousTask = {
    ...task,
    state: CLOUD_TASK_STATES.REVOKED,
    lease: task.lease
      ? {
          ...task.lease,
          revoked: true,
          revoked_reason: `superseded by provider failover to ${nextProvider}:${nextAgentIdentity}`,
          heartbeat_at: nowIso,
          execution_uncertain: false,
        }
      : null,
  };

  const nextAttempt = (task.attempt ?? 1) + 1;
  const candidateNextTask = {
    ...task,
    task_id: nextTaskId || `${task.task_id}-FAILOVER-${attemptSuffix(nextAttempt)}`,
    provider: nextProvider,
    agent_identity: nextAgentIdentity,
    source_head: handoff.semantic_head,
    attempt: nextAttempt,
    authority: authority || task.authority,
    state: CLOUD_TASK_STATES.ISSUED,
    lease: null,
    idempotency_key: buildCloudIdempotencyKey({
      task_id: nextTaskId || `${task.task_id}-FAILOVER-${attemptSuffix(nextAttempt)}`,
      packet_id: task.packet_id,
      source_main: task.source_main,
      attempt: nextAttempt,
    }),
    continuity_from: {
      previous_task_id: task.task_id,
      previous_provider: task.provider,
      previous_agent_identity: task.agent_identity,
      previous_lease_id: task.lease?.lease_id || null,
      verified_semantic_head: handoff.semantic_head,
      verified_pr_head: handoff.pr_head,
      pr_number: handoff.pr_number,
    },
  };

  const acquired = evaluateLeaseAcquisition({
    task: candidateNextTask,
    claimantProvider: nextProvider,
    claimantAgentId: nextAgentIdentity,
    leaseId: nextLeaseId,
    nowIso,
    ttlSeconds,
    existingTasks: [revokedPreviousTask],
  });
  if (!acquired.ok) return acquired;

  return {
    ok: true,
    reason: CLOUD_REASONS.OK,
    previous_task: revokedPreviousTask,
    next_task: acquired.task,
    lease: acquired.lease,
  };
}

// ---------------------------------------------------------------------------
// Component C: Provider-Neutral Cloud Execution Interface
// ---------------------------------------------------------------------------

function createCloudProviderAdapter({ provider, vendor, roles }) {
  return {
    id: `${provider}-cloud-adapter`,
    provider,
    vendor,
    roles: [...roles],
    automated_provider_invocation: 'DEFERRED_PHASE_2',
    probeStatus() {
      return {
        provider,
        vendor,
        roles: [...roles],
        mode: 'MANUAL_GITHUB_HANDOFF',
        automated_provider_invocation: 'DEFERRED_PHASE_2',
        detail: `${provider} cloud adapter ready for GitHub-native branch/PR handoff; unattended remote API invocation is deferred to Phase 2`,
      };
    },
    prepareHandoff(task, lease = task?.lease) {
      const continuityHead = task.continuity_from?.verified_semantic_head || task.source_head || null;
      const startingCommit = continuityHead || task.source_main;
      const checkoutInstruction = continuityHead
        ? `Checkout isolated branch ${task.implementation_branch} at verified continuity checkpoint ${continuityHead} (branched from main ${task.source_main})`
        : `Checkout isolated branch ${task.implementation_branch} from verified main ${task.source_main}`;
      return {
        status: CLOUD_DISPATCH_STATUS.MANUAL_GITHUB_HANDOFF_READY,
        provider,
        agent_identity: task.agent_identity,
        task_id: task.task_id,
        packet_id: task.packet_id,
        implementation_branch: task.implementation_branch,
        source_main: task.source_main,
        source_head: continuityHead,
        starting_commit: startingCommit,
        lease_id: lease?.lease_id || null,
        expires_at: lease?.expires_at || null,
        automated_provider_invocation: 'DEFERRED_PHASE_2',
        instructions: [
          checkoutInstruction,
          `Modify only files matching allowed_scope (${task.allowed_scope.join(', ')})`,
          `Run required_tests (${task.required_tests.join('; ')})`,
          `Commit semantic changes first (recording source_head) and control artifacts second`,
          `Open or update a DRAFT PR only; do not merge, deploy, or post to Issue #80`,
        ],
      };
    },
  };
}

export function geminiCloudAdapter() {
  return createCloudProviderAdapter({
    provider: CLOUD_PROVIDERS.GEMINI,
    vendor: 'google',
    roles: PROVIDER_CAPABILITIES[CLOUD_PROVIDERS.GEMINI].roles,
  });
}

export function kimiCloudAdapter() {
  return createCloudProviderAdapter({
    provider: CLOUD_PROVIDERS.KIMI,
    vendor: 'moonshot',
    roles: PROVIDER_CAPABILITIES[CLOUD_PROVIDERS.KIMI].roles,
  });
}

export function claudeCloudAdapter() {
  return createCloudProviderAdapter({
    provider: CLOUD_PROVIDERS.CLAUDE_CLOUD,
    vendor: 'anthropic',
    roles: PROVIDER_CAPABILITIES[CLOUD_PROVIDERS.CLAUDE_CLOUD].roles,
  });
}

export function chatgptAuthorityAdapter() {
  return createCloudProviderAdapter({
    provider: CLOUD_PROVIDERS.CHATGPT,
    vendor: 'openai',
    roles: PROVIDER_CAPABILITIES[CLOUD_PROVIDERS.CHATGPT].roles,
  });
}

export function defaultCloudProviderRegistry() {
  return [
    geminiCloudAdapter(),
    kimiCloudAdapter(),
    claudeCloudAdapter(),
    chatgptAuthorityAdapter(),
  ];
}

/**
 * Dispatches a cloud task through the provider-neutral interface.
 * In Phase 1, unattended API invocation is explicitly deferred; if `requireUnattended`
 * is requested, it returns `DEFERRED_UNATTENDED_INVOCATION` without faking execution.
 */
export function dispatchCloudTask({
  task,
  registry = defaultCloudProviderRegistry(),
  nowIso,
  expectedMainSha = null,
  existingTasks = [],
  recordedIdempotencyKeys = [],
  requireUnattended = false,
}) {
  const valid = validateCloudTask(task, { expectedMainSha });
  if (!valid.ok) {
    return { status: CLOUD_DISPATCH_STATUS.REJECTED, ...valid };
  }

  const adapter = registry.find((a) => a.provider === task.provider);
  if (!adapter) {
    return {
      status: CLOUD_DISPATCH_STATUS.REJECTED,
      ok: false,
      reason: CLOUD_REASONS.WRONG_PROVIDER,
      problems: [`no registered cloud adapter for provider ${task.provider}`],
    };
  }
  const role = task.role || CLOUD_ROLES.BUILDER;
  if (!adapter.roles.includes(role)) {
    return {
      status: CLOUD_DISPATCH_STATUS.REJECTED,
      ok: false,
      reason: CLOUD_REASONS.ROLE_NOT_SUPPORTED,
      problems: [`adapter ${adapter.id} does not support role ${role}`],
    };
  }

  const leaseResult = task.lease
    ? verifyTaskOwnership({
        task,
        actorProvider: task.provider,
        actorAgentId: task.agent_identity,
        leaseId: task.lease.lease_id,
        nowIso,
      })
    : evaluateLeaseAcquisition({
        task,
        claimantProvider: task.provider,
        claimantAgentId: task.agent_identity,
        nowIso,
        existingTasks,
        recordedIdempotencyKeys,
      });

  if (!leaseResult.ok) {
    return { status: CLOUD_DISPATCH_STATUS.REJECTED, ...leaseResult };
  }

  const activeLease = task.lease || leaseResult.lease;
  if (requireUnattended) {
    return {
      status: CLOUD_DISPATCH_STATUS.DEFERRED_UNATTENDED_INVOCATION,
      ok: false,
      reason: CLOUD_DISPATCH_STATUS.DEFERRED_UNATTENDED_INVOCATION,
      automated_provider_invocation: 'DEFERRED_PHASE_2',
      detail: `Unattended API invocation for ${task.provider} is deferred to Phase 2; use GitHub-native manual cloud handoff`,
    };
  }

  return {
    status: CLOUD_DISPATCH_STATUS.MANUAL_GITHUB_HANDOFF_READY,
    ok: true,
    reason: CLOUD_REASONS.OK,
    handoff_bundle: adapter.prepareHandoff(leaseResult.task || task, activeLease),
    task: leaseResult.task || task,
    lease: activeLease,
  };
}

// ---------------------------------------------------------------------------
// Component B.2: Durable File-Backed Cloud Registry
// ---------------------------------------------------------------------------

function computeRegistryDigest(tasks, idempotencyKeys, consumedClearanceIds = []) {
  const payload = JSON.stringify({
    tasks,
    idempotency_keys: [...idempotencyKeys].sort(),
    consumed_clearance_ids: [...consumedClearanceIds].sort(),
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Durable file-backed task & lease registry with SHA-256 tamper/corruption
 * detection, cross-process lockfile serialization, and atomic temp-file write.
 */
export class FileBackedCloudRegistry {
  constructor(filePath, { lockTimeoutMs = 5000, lockStaleMs = 30000 } = {}) {
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockStaleMs = lockStaleMs;
  }

  withLock(fn) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    let fd = null;
    while (fd === null) {
      try {
        fd = fs.openSync(this.lockPath, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquired_at: Date.now() }), 'utf8');
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          const stat = fs.statSync(this.lockPath);
          if (Date.now() - stat.mtimeMs > this.lockStaleMs) {
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          // Lock was released concurrently; retry immediately.
          continue;
        }
        if (Date.now() >= deadline) {
          const lockErr = new Error(`Timed out waiting for cloud registry lock: ${this.lockPath}`);
          lockErr.reason = CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED;
          throw lockErr;
        }
      }
    }
    try {
      return fn();
    } finally {
      try {
        if (fd !== null) fs.closeSync(fd);
      } catch {
        // ignore close error
      }
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // ignore unlink error
      }
    }
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return {
        schema: CLOUD_REGISTRY_SCHEMA,
        tasks: [],
        idempotency_keys: [],
        consumed_clearance_ids: [],
        sha256: computeRegistryDigest([], [], []),
      };
    }
    const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    const consumed = Array.isArray(raw.consumed_clearance_ids) ? raw.consumed_clearance_ids : [];
    if (raw.schema !== CLOUD_REGISTRY_SCHEMA || !Array.isArray(raw.tasks) || !Array.isArray(raw.idempotency_keys)) {
      const err = new Error('Cloud registry schema is invalid');
      err.reason = CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED;
      throw err;
    }
    const expected = computeRegistryDigest(raw.tasks, raw.idempotency_keys, consumed);
    if (raw.sha256 !== expected) {
      const err = new Error(`Cloud registry sha256 mismatch: expected ${expected}, found ${raw.sha256}`);
      err.reason = CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED;
      throw err;
    }
    return {
      ...raw,
      consumed_clearance_ids: consumed,
    };
  }

  save(state) {
    const tasks = state.tasks || [];
    const keys = [...new Set(state.idempotency_keys || [])].sort();
    const consumed = [...new Set(state.consumed_clearance_ids || [])].sort();
    const doc = {
      schema: CLOUD_REGISTRY_SCHEMA,
      updated_at: new Date().toISOString(),
      tasks,
      idempotency_keys: keys,
      consumed_clearance_ids: consumed,
      sha256: computeRegistryDigest(tasks, keys, consumed),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.filePath);
    return doc;
  }

  claimTask({
    task,
    claimantProvider,
    claimantAgentId,
    leaseId,
    nowIso,
    ttlSeconds = 3600,
    reconciliationClearance = null,
    observedBranchHead = null,
  }) {
    return this.withLock(() => {
      const current = this.load();
      const res = evaluateLeaseAcquisition({
        task,
        claimantProvider,
        claimantAgentId,
        leaseId,
        nowIso,
        ttlSeconds,
        existingTasks: current.tasks,
        recordedIdempotencyKeys: current.idempotency_keys,
        reconciliationClearance,
        observedBranchHead,
        consumedClearanceIds: current.consumed_clearance_ids,
      });
      if (!res.ok) return res;

      const tasks = current.tasks.filter((t) => t.task_id !== task.task_id);
      tasks.push(res.task);
      const idempotency_keys = [...new Set([...current.idempotency_keys, res.task.idempotency_key])];
      const consumed_clearance_ids = res.consumed_clearance_id
        ? [...new Set([...current.consumed_clearance_ids, res.consumed_clearance_id])]
        : current.consumed_clearance_ids;
      this.save({ tasks, idempotency_keys, consumed_clearance_ids });
      return res;
    });
  }
}

// ---------------------------------------------------------------------------
// Component D: GitHub-Native Read-Only Preflight Evaluator
// ---------------------------------------------------------------------------

/**
 * Performs read-only preflight verification of the repository's cloud task,
 * handoff record, and branch control artifacts (`active-packet.yaml` and
 * `claude-return.yaml`). Never mutates state, merges, deploys, or posts to #80.
 */
export function evaluateCloudPreflight({
  task,
  handoff = null,
  activePacket = null,
  returnArtifact = null,
  branchName = null,
  headSha = null,
  mainSha = null,
  changedFiles = null,
  nonControlTailFiles = null,
  semanticHeadIsAncestor = null,
  nowIso = new Date().toISOString(),
}) {
  const problems = [];
  const taskCheck = validateCloudTask(task, { expectedMainSha: mainSha });
  if (!taskCheck.ok) {
    return {
      ok: false,
      mode: 'READ_ONLY_PREFLIGHT',
      reason: taskCheck.reason,
      problems: taskCheck.problems,
    };
  }

  if (branchName && task.implementation_branch !== branchName) {
    problems.push(`task.implementation_branch (${task.implementation_branch}) does not match current branch (${branchName})`);
  }

  if (task.lease) {
    const own = verifyTaskOwnership({
      task,
      actorProvider: task.provider,
      actorAgentId: task.agent_identity,
      leaseId: task.lease.lease_id,
      nowIso,
      allowCompletedPreflight: true,
    });
    if (!own.ok) {
      return {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: own.reason,
        problems: own.problems,
      };
    }
  }

  if (Array.isArray(changedFiles)) {
    const scopeCheck = verifyChangedFilesInScope(task, changedFiles);
    if (!scopeCheck.ok) {
      return {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: scopeCheck.reason,
        problems: scopeCheck.violations,
      };
    }
  }

  if (activePacket) {
    if (activePacket.packet_id !== task.packet_id) {
      problems.push(`active-packet.yaml packet_id (${activePacket.packet_id}) does not match task.packet_id (${task.packet_id})`);
    }
    if (activePacket.implementation_branch !== task.implementation_branch) {
      problems.push(`active-packet.yaml implementation_branch (${activePacket.implementation_branch}) does not match task.implementation_branch (${task.implementation_branch})`);
    }
    if (activePacket.source_main !== task.source_main) {
      problems.push(`active-packet.yaml source_main (${activePacket.source_main}) does not match task.source_main (${task.source_main})`);
    }
    if (activePacket.production_touched !== false) {
      return {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED,
        problems: ['active-packet.yaml production_touched must be false'],
      };
    }
  }

  if (returnArtifact) {
    if (returnArtifact.packet_id !== task.packet_id) {
      problems.push(`claude-return.yaml packet_id (${returnArtifact.packet_id}) does not match task.packet_id (${task.packet_id})`);
    }
    if (returnArtifact.implementation_branch !== task.implementation_branch) {
      problems.push(`claude-return.yaml implementation_branch (${returnArtifact.implementation_branch}) does not match task.implementation_branch (${task.implementation_branch})`);
    }
    if (returnArtifact.merge_authority !== false) {
      return {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.MERGE_NOT_AUTHORIZED,
        problems: ['claude-return.yaml merge_authority must be false'],
      };
    }
  }

  if (handoff) {
    if (Array.isArray(nonControlTailFiles) && nonControlTailFiles.length > 0) {
      return {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.STALE_COMPLETION_EVIDENCE,
        problems: [
          `non-control files modified after semantic_head (${handoff.semantic_head}): ${nonControlTailFiles.join(', ')}`,
        ],
      };
    }
    const verifiedControlOnlyTail =
      semanticHeadIsAncestor === true &&
      Array.isArray(nonControlTailFiles) &&
      nonControlTailFiles.length === 0;
    const expectedHead =
      headSha && handoff.pr_head === handoff.semantic_head && verifiedControlOnlyTail
        ? handoff.semantic_head
        : headSha;
    const hCheck = validateCloudHandoff(handoff, {
      task,
      currentMainSha: mainSha,
      currentPrHeadSha: expectedHead,
    });
    if (!hCheck.ok) {
      return {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: hCheck.reason,
        problems: hCheck.problems,
      };
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      mode: 'READ_ONLY_PREFLIGHT',
      reason: CLOUD_REASONS.TASK_INVALID,
      problems,
    };
  }

  return {
    ok: true,
    mode: 'READ_ONLY_PREFLIGHT',
    reason: CLOUD_REASONS.OK,
    problems: [],
    summary: {
      task_id: task.task_id,
      packet_id: task.packet_id,
      provider: task.provider,
      agent_identity: task.agent_identity,
      implementation_branch: task.implementation_branch,
      source_main: task.source_main,
      source_head: returnArtifact?.source_head || handoff?.semantic_head || task.source_head || null,
      pr_head: headSha || handoff?.pr_head || null,
      pr_number: handoff?.pr_number ?? returnArtifact?.pr_number ?? activePacket?.pr_number ?? null,
      state: task.state,
      lease_id: task.lease?.lease_id || null,
      lease_expires_at: task.lease?.expires_at || null,
      automated_provider_invocation: 'DEFERRED_PHASE_2',
      mutating_actions_performed: 0,
    },
  };
}

export function loadCloudYamlFile(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}

export function saveCloudYamlFile(filePath, data) {
  fs.writeFileSync(filePath, stringifyYaml(data), 'utf8');
}

export default {
  CLOUD_TASK_SCHEMA,
  CLOUD_HANDOFF_SCHEMA,
  CLOUD_REGISTRY_SCHEMA,
  CANONICAL_REPOSITORY,
  CLOUD_PROVIDERS,
  CLOUD_ROLES,
  PROVIDER_CAPABILITIES,
  CLOUD_TASK_STATES,
  CLOUD_RISK_LEVELS,
  CLOUD_APPROVAL_LEVELS,
  CLOUD_AUTHORITY_KINDS,
  CLOUD_DISPATCH_STATUS,
  CLOUD_REASONS,
  matchesScopePattern,
  buildCloudIdempotencyKey,
  validateTaskAuthority,
  validateCloudLease,
  validateCloudTask,
  verifyChangedFilesInScope,
  evaluateLeaseAcquisition,
  verifyUncertainExecutionClearance,
  verifyTaskOwnership,
  markExecutionUncertain,
  validateCloudHandoff,
  recordTaskCompletion,
  prepareProviderFailoverHandoff,
  geminiCloudAdapter,
  kimiCloudAdapter,
  claudeCloudAdapter,
  chatgptAuthorityAdapter,
  defaultCloudProviderRegistry,
  dispatchCloudTask,
  FileBackedCloudRegistry,
  evaluateCloudPreflight,
  loadCloudYamlFile,
  saveCloudYamlFile,
};
